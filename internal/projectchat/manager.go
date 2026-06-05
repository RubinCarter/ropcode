package projectchat

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ropcode/internal/database"
	"ropcode/internal/provider"
	"ropcode/internal/stream"
)

type SwitchResult struct {
	ChatID           string `json:"chat_id"`
	SegmentID        string `json:"segment_id"`
	RuntimeSessionID string `json:"runtime_session_id"`
	StreamID         string `json:"stream_id"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
}

type ProjectChatDetail struct {
	Chat     *database.ProjectChat   `json:"chat"`
	Segments []*database.ChatSegment `json:"segments"`
}

type Manager struct {
	db             *database.Database
	provider       *provider.Manager
	emitter        provider.EventEmitter
	streamHub      *stream.Hub
	configResolver SessionConfigResolver
	mu             sync.Mutex
}

const projectChatContextSyncSubtype = "projectchat_context_sync"

type SessionConfigResolver func(providerID, projectPath, model, providerApiID, reasoningEffort string) provider.SessionConfig

func NewManager(db *database.Database, prov *provider.Manager, emitter provider.EventEmitter, hub *stream.Hub) *Manager {
	return &Manager{
		db:        db,
		provider:  prov,
		emitter:   emitter,
		streamHub: hub,
	}
}

func (m *Manager) SetSessionConfigResolver(resolver SessionConfigResolver) {
	m.configResolver = resolver
}

func (m *Manager) EnsureChat(projectPath, providerID, model, providerApiID, existingProviderSessionID string, forceNew bool) (*SwitchResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	existingProviderSessionID = strings.TrimSpace(existingProviderSessionID)
	if !forceNew {
		if reusable, err := m.ensureExistingProjectChat(projectPath, providerID, model, providerApiID, existingProviderSessionID); err != nil {
			return nil, err
		} else if reusable != nil {
			return reusable, nil
		}
	}

	return m.createChatLocked(projectPath, providerID, model, providerApiID, existingProviderSessionID)
}

func (m *Manager) createChatLocked(projectPath, providerID, model, providerApiID, existingProviderSessionID string) (*SwitchResult, error) {
	chatID := uuid.New().String()
	segmentID := uuid.New().String()
	now := time.Now().Unix()

	chat := &database.ProjectChat{
		ID:              chatID,
		ProjectPath:     projectPath,
		ActiveProvider:  providerID,
		ActiveSegmentID: segmentID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := m.db.CreateProjectChat(chat); err != nil {
		return nil, fmt.Errorf("create project chat: %w", err)
	}

	seg := &database.ChatSegment{
		ID:            segmentID,
		ProjectChatID: chatID,
		Provider:      providerID,
		Model:         model,
		Seq:           0,
		Status:        database.SegmentStatusActive,
		CreatedAt:     now,
	}
	if err := m.db.CreateChatSegment(seg); err != nil {
		return nil, fmt.Errorf("create initial segment: %w", err)
	}

	runtimeSessionID := ""
	providerSessionID := ""
	if existingProviderSessionID != "" {
		runtimeSessionID = m.provider.ResolveRunningSessionID(providerID, projectPath, existingProviderSessionID)
		if runtimeSessionID == "" {
			providerSessionID = existingProviderSessionID
		}
	}

	if providerSessionID == "" {
		providerSessionID = m.captureProviderSessionID(segmentID, runtimeSessionID)
	}
	_ = m.db.UpdateChatSegmentRuntime(segmentID, runtimeSessionID, providerSessionID)

	if m.streamHub != nil && runtimeSessionID != "" {
		m.streamHub.RegisterAlias(streamID(providerID, runtimeSessionID), chatID)
	}

	m.emitEvent("projectchat:created", map[string]any{
		"chat_id":    chatID,
		"provider":   providerID,
		"session_id": runtimeSessionID,
		"stream_id":  chatID,
	})

	return &SwitchResult{
		ChatID:           chatID,
		SegmentID:        segmentID,
		RuntimeSessionID: runtimeSessionID,
		StreamID:         chatID,
		Provider:         providerID,
		Model:            model,
	}, nil
}

func (m *Manager) ensureExistingProjectChat(projectPath, providerID, model, providerApiID, existingProviderSessionID string) (*SwitchResult, error) {
	if existingProviderSessionID != "" {
		if chat, seg, err := m.db.FindChatSegmentByProviderSession(projectPath, providerID, existingProviderSessionID); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return nil, fmt.Errorf("find project chat by provider session: %w", err)
			}
		} else {
			if model == "" {
				model = seg.Model
			}
			providerSessionID := seg.ProviderSessionID
			if providerSessionID == "" {
				providerSessionID = existingProviderSessionID
			}
			runtimeSessionID := ""
			if seg.RuntimeSessionID != "" {
				runtimeSessionID = m.provider.ResolveRunningSessionID(providerID, projectPath, seg.RuntimeSessionID)
			}
			if runtimeSessionID == "" {
				runtimeSessionID = m.provider.ResolveRunningSessionID(providerID, projectPath, providerSessionID)
			}
			if runtimeSessionID != seg.RuntimeSessionID || providerSessionID != seg.ProviderSessionID {
				_ = m.db.UpdateChatSegmentRuntime(seg.ID, runtimeSessionID, providerSessionID)
			}
			if m.streamHub != nil && runtimeSessionID != "" {
				m.streamHub.RegisterAlias(streamID(providerID, runtimeSessionID), chat.ID)
			}
			_ = m.db.UpdateProjectChatActive(chat.ID, providerID, seg.ID)
			m.emitEvent("projectchat:reused", map[string]any{
				"chat_id":    chat.ID,
				"provider":   providerID,
				"session_id": runtimeSessionID,
				"stream_id":  chat.ID,
			})
			return &SwitchResult{
				ChatID:           chat.ID,
				SegmentID:        seg.ID,
				RuntimeSessionID: runtimeSessionID,
				StreamID:         chat.ID,
				Provider:         providerID,
				Model:            model,
			}, nil
		}
	}

	chat, err := m.db.GetActiveChatForProject(projectPath)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get active chat: %w", err)
	}

	segments, err := m.db.ListChatSegments(chat.ID)
	if err != nil {
		return nil, fmt.Errorf("list existing segments: %w", err)
	}

	currentSeg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return nil, fmt.Errorf("get current segment: %w", err)
	}

	if currentSeg.Provider != providerID {
		if existingProviderSessionID == "" {
			return &SwitchResult{
				ChatID:           chat.ID,
				SegmentID:        currentSeg.ID,
				RuntimeSessionID: currentSeg.RuntimeSessionID,
				StreamID:         chat.ID,
				Provider:         currentSeg.Provider,
				Model:            currentSeg.Model,
			}, nil
		}
		return m.switchProviderLocked(chat, currentSeg, segments, providerID, model, providerApiID)
	}

	if len(segments) != 1 || currentSeg.Seq != 0 || currentSeg.Status != database.SegmentStatusActive {
		return &SwitchResult{
			ChatID:           chat.ID,
			SegmentID:        currentSeg.ID,
			RuntimeSessionID: currentSeg.RuntimeSessionID,
			StreamID:         chat.ID,
			Provider:         currentSeg.Provider,
			Model:            currentSeg.Model,
		}, nil
	}

	if currentSeg.RuntimeSessionID != "" || currentSeg.ProviderSessionID != "" {
		return &SwitchResult{
			ChatID:           chat.ID,
			SegmentID:        currentSeg.ID,
			RuntimeSessionID: currentSeg.RuntimeSessionID,
			StreamID:         chat.ID,
			Provider:         currentSeg.Provider,
			Model:            currentSeg.Model,
		}, nil
	}

	if currentSeg.Provider != providerID {
		return nil, nil
	}

	if model == "" {
		model = currentSeg.Model
	}

	runtimeSessionID := ""
	providerSessionID := ""
	if existingProviderSessionID != "" {
		runtimeSessionID = m.provider.ResolveRunningSessionID(providerID, projectPath, existingProviderSessionID)
		if runtimeSessionID == "" {
			providerSessionID = existingProviderSessionID
		}
	}
	if providerSessionID == "" {
		providerSessionID = m.captureProviderSessionID(currentSeg.ID, runtimeSessionID)
	}
	_ = m.db.UpdateChatSegmentRuntime(currentSeg.ID, runtimeSessionID, providerSessionID)

	if m.streamHub != nil && runtimeSessionID != "" {
		m.streamHub.RegisterAlias(streamID(providerID, runtimeSessionID), chat.ID)
	}
	_ = m.db.UpdateProjectChatActive(chat.ID, providerID, currentSeg.ID)

	m.emitEvent("projectchat:reused", map[string]any{
		"chat_id":    chat.ID,
		"provider":   providerID,
		"session_id": runtimeSessionID,
		"stream_id":  chat.ID,
	})

	return &SwitchResult{
		ChatID:           chat.ID,
		SegmentID:        currentSeg.ID,
		RuntimeSessionID: runtimeSessionID,
		StreamID:         chat.ID,
		Provider:         providerID,
		Model:            model,
	}, nil
}

func (m *Manager) SendMessage(chatID, message, model, providerApiID, reasoningEffort string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return "", fmt.Errorf("get chat: %w", err)
	}

	seg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return "", fmt.Errorf("get active segment: %w", err)
	}
	if err := m.db.UpdateProjectChatActive(chat.ID, seg.Provider, seg.ID); err == nil {
		chat.ActiveProvider = seg.Provider
		seg.Status = database.SegmentStatusActive
		seg.CompletedAt = nil
	}

	// Update providerSessionID if not yet captured
	if needsProviderSessionCapture(seg.ProviderSessionID) && seg.RuntimeSessionID != "" {
		seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, seg.RuntimeSessionID)
	}
	if m.streamHub != nil && seg.RuntimeSessionID != "" {
		m.streamHub.RegisterAlias(streamID(seg.Provider, seg.RuntimeSessionID), chatID)
	}

	// If this segment has context to inject (first message after switch),
	// prepend the context to the user's message
	actualMessage := message
	contextSyncMessage := ""
	isProviderCommand := m.provider != nil && m.provider.IsProviderCommand(seg.Provider, message)
	if !isProviderCommand && m.provider != nil {
		expandedMessage, err := m.provider.ExpandProviderCapability(seg.Provider, chat.ProjectPath, actualMessage)
		if err != nil {
			return "", fmt.Errorf("prepare provider message: %w", err)
		}
		actualMessage = expandedMessage
	}
	if seg.ContextInjected && seg.Seq > 0 && !isProviderCommand {
		segments, err := m.db.ListChatSegments(chatID)
		if err == nil && len(segments) > 0 {
			// Find segments to include: incremental (after last segment of same provider) or full
			lastSameProviderIdx := -1
			currentSegIdx := -1
			for i, s := range segments {
				if s.ID == seg.ID {
					currentSegIdx = i
					continue
				}
				if s.Provider == seg.Provider {
					lastSameProviderIdx = i
				}
			}

			var contextSegments []*database.ChatSegment
			if lastSameProviderIdx >= 0 {
				// Incremental: only segments between last same-provider segment and current
				contextSegments = segments[lastSameProviderIdx+1 : currentSegIdx]
			} else if currentSegIdx > 0 {
				// Full: all segments before current
				contextSegments = segments[:currentSegIdx]
			}

			if len(contextSegments) > 0 {
				contextText, err := m.buildContextFromSegments(contextSegments, chat.ProjectPath)
				if err == nil && contextText != "" {
					tokens := EstimateTokens(contextText)
					if ShouldSummarize(tokens, seg.Provider, model) {
						summarized, err := m.summarizeContext(seg.Provider, chat.ProjectPath, contextText, model, providerApiID)
						if err == nil && summarized != "" {
							contextText = summarized
						}
					}
					actualMessage = InjectContext(actualMessage, contextText)
					contextSyncMessage = contextText
				}
			}
		}
		// Mark context as delivered
		_ = m.db.UpdateChatSegmentContextDelivered(seg.ID)
	}

	sentRuntimeSessionID := seg.RuntimeSessionID
	if seg.RuntimeSessionID == "" {
		config := m.sessionConfig(seg.Provider, chat.ProjectPath, model, providerApiID, reasoningEffort)
		if seg.ProviderSessionID != "" {
			config.Resume = true
			config.ResumeSessionID = seg.ProviderSessionID
		}
		resolvedRuntimeSessionID, err := m.provider.EnsureUserSession(seg.Provider, config)
		if err != nil {
			return "", fmt.Errorf("start session: %w", err)
		}
		sentRuntimeSessionID = resolvedRuntimeSessionID
		if needsProviderSessionCapture(seg.ProviderSessionID) {
			seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, resolvedRuntimeSessionID)
		}
		_ = m.db.UpdateChatSegmentRuntime(seg.ID, resolvedRuntimeSessionID, seg.ProviderSessionID)
		if m.streamHub != nil {
			m.streamHub.RegisterAlias(streamID(seg.Provider, resolvedRuntimeSessionID), chatID)
		}

		if contextSyncMessage != "" {
			m.emitContextSyncFrame(chatID, chat.ProjectPath, seg, sentRuntimeSessionID, contextSyncMessage)
			contextSyncMessage = ""
		}

		dispatchedRuntimeSessionID, err := m.provider.SendUserMessage(seg.Provider, chat.ProjectPath, resolvedRuntimeSessionID, actualMessage)
		if err != nil {
			return "", fmt.Errorf("send message: %w", err)
		}
		sentRuntimeSessionID = dispatchedRuntimeSessionID
		if dispatchedRuntimeSessionID != resolvedRuntimeSessionID {
			if needsProviderSessionCapture(seg.ProviderSessionID) {
				seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, dispatchedRuntimeSessionID)
			}
			_ = m.db.UpdateChatSegmentRuntime(seg.ID, dispatchedRuntimeSessionID, seg.ProviderSessionID)
			if m.streamHub != nil {
				m.streamHub.RegisterAlias(streamID(seg.Provider, dispatchedRuntimeSessionID), chatID)
			}
		}
	} else if resolvedRuntimeSessionID, err := m.provider.SendUserMessage(seg.Provider, chat.ProjectPath, activeProviderSessionID(seg), actualMessage); err != nil {
		// Session might be gone (after restart/hot-reload) - try to restart it
		config := m.sessionConfig(seg.Provider, chat.ProjectPath, model, providerApiID, reasoningEffort)
		config.ResumeSessionID = activeProviderSessionID(seg)
		config.Resume = config.ResumeSessionID != ""
		newRuntimeID, startErr := m.provider.EnsureUserSession(seg.Provider, config)
		if startErr != nil {
			return "", fmt.Errorf("send message: %w (restart also failed: %v)", err, startErr)
		}
		if needsProviderSessionCapture(seg.ProviderSessionID) {
			seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, newRuntimeID)
		}
		_ = m.db.UpdateChatSegmentRuntime(seg.ID, newRuntimeID, seg.ProviderSessionID)
		// Update stream alias
		realStream := streamID(seg.Provider, newRuntimeID)
		if m.streamHub != nil {
			m.streamHub.RegisterAlias(realStream, chatID)
		}
		sentRuntimeSessionID = newRuntimeID
		if needsProviderSessionCapture(seg.ProviderSessionID) {
			seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, newRuntimeID)
		}
		_ = m.db.UpdateChatSegmentRuntime(seg.ID, newRuntimeID, seg.ProviderSessionID)

		dispatchedRuntimeSessionID, sendErr := m.provider.SendUserMessage(seg.Provider, chat.ProjectPath, newRuntimeID, actualMessage)
		if sendErr != nil {
			return "", fmt.Errorf("send message after restart: %w", sendErr)
		}
		sentRuntimeSessionID = dispatchedRuntimeSessionID
		if dispatchedRuntimeSessionID != newRuntimeID {
			_ = m.db.UpdateChatSegmentRuntime(seg.ID, dispatchedRuntimeSessionID, seg.ProviderSessionID)
			if m.streamHub != nil {
				m.streamHub.RegisterAlias(streamID(seg.Provider, dispatchedRuntimeSessionID), chatID)
			}
		}
	} else {
		sentRuntimeSessionID = resolvedRuntimeSessionID
		if needsProviderSessionCapture(seg.ProviderSessionID) {
			seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, resolvedRuntimeSessionID)
		}
		_ = m.db.UpdateChatSegmentRuntime(seg.ID, resolvedRuntimeSessionID, seg.ProviderSessionID)
		if m.streamHub != nil {
			m.streamHub.RegisterAlias(streamID(seg.Provider, resolvedRuntimeSessionID), chatID)
		}
	}

	if contextSyncMessage != "" {
		m.emitContextSyncFrame(chatID, chat.ProjectPath, seg, sentRuntimeSessionID, contextSyncMessage)
	}

	return streamID(seg.Provider, sentRuntimeSessionID), nil
}

func (m *Manager) ClearChat(chatID string) (*SwitchResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return nil, fmt.Errorf("get chat: %w", err)
	}

	currentSeg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return nil, fmt.Errorf("get active segment: %w", err)
	}

	if currentSeg.ProviderSessionID == "" && currentSeg.RuntimeSessionID != "" {
		currentSeg.ProviderSessionID = m.captureProviderSessionID(currentSeg.ID, currentSeg.RuntimeSessionID)
		_ = m.db.UpdateChatSegmentRuntime(currentSeg.ID, currentSeg.RuntimeSessionID, currentSeg.ProviderSessionID)
	}
	if currentSeg.RuntimeSessionID != "" && m.provider != nil {
		_ = m.provider.InterruptSession(currentSeg.RuntimeSessionID)
	}

	now := time.Now().Unix()
	status := database.SegmentStatusCompleted
	if currentSeg.Status == database.SegmentStatusActive {
		status = database.SegmentStatusInterrupted
	}
	_ = m.db.UpdateChatSegmentStatus(currentSeg.ID, status, &now)

	newSegmentID := uuid.New().String()
	newSeg := &database.ChatSegment{
		ID:                newSegmentID,
		ProjectChatID:     chatID,
		Provider:          currentSeg.Provider,
		Model:             currentSeg.Model,
		ProviderSessionID: provider.FreshSessionSentinel,
		Seq:               currentSeg.Seq + 1,
		Status:            database.SegmentStatusActive,
		CreatedAt:         now,
	}
	if err := m.db.CreateChatSegment(newSeg); err != nil {
		return nil, fmt.Errorf("create clear segment: %w", err)
	}
	_ = m.db.UpdateProjectChatActive(chatID, currentSeg.Provider, newSegmentID)

	m.emitEvent("projectchat:cleared", map[string]any{
		"chat_id":             chatID,
		"provider":            currentSeg.Provider,
		"previous_segment_id": currentSeg.ID,
		"segment_id":          newSegmentID,
		"stream_id":           chatID,
	})

	return &SwitchResult{
		ChatID:           chatID,
		SegmentID:        newSegmentID,
		RuntimeSessionID: "",
		StreamID:         chatID,
		Provider:         currentSeg.Provider,
		Model:            currentSeg.Model,
	}, nil
}

func (m *Manager) SwitchProvider(chatID, newProviderID, model, providerApiID string) (*SwitchResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return nil, fmt.Errorf("get chat: %w", err)
	}

	currentSeg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return nil, fmt.Errorf("get current segment: %w", err)
	}
	if currentSeg.Provider == newProviderID {
		return &SwitchResult{
			ChatID:           chatID,
			SegmentID:        currentSeg.ID,
			RuntimeSessionID: currentSeg.RuntimeSessionID,
			StreamID:         chatID,
			Provider:         currentSeg.Provider,
			Model:            currentSeg.Model,
		}, nil
	}

	segments, err := m.db.ListChatSegments(chatID)
	if err != nil {
		return nil, fmt.Errorf("list segments: %w", err)
	}

	return m.switchProviderLocked(chat, currentSeg, segments, newProviderID, model, providerApiID)
}

func (m *Manager) switchProviderLocked(chat *database.ProjectChat, currentSeg *database.ChatSegment, segments []*database.ChatSegment, newProviderID, model, providerApiID string) (*SwitchResult, error) {
	chatID := chat.ID

	// Resolve providerSessionID BEFORE terminating (session still in live list)
	if currentSeg.ProviderSessionID == "" && currentSeg.RuntimeSessionID != "" {
		currentSeg.ProviderSessionID = m.captureProviderSessionID(currentSeg.ID, currentSeg.RuntimeSessionID)
	}

	// Mark current segment as completed/interrupted
	now := time.Now().Unix()
	status := database.SegmentStatusCompleted
	if currentSeg.Status == database.SegmentStatusActive {
		status = database.SegmentStatusInterrupted
	}
	_ = m.db.UpdateChatSegmentStatus(currentSeg.ID, status, &now)

	// Build context from previous segments
	// Incremental: if target provider already had a segment, only include segments after its last one
	// Full: if target provider never had a segment, include all segments
	// Find the last segment index for the target provider (incremental sync)
	lastTargetSegIdx := -1
	var lastTargetSeg *database.ChatSegment
	for i, seg := range segments {
		if seg.Provider == newProviderID {
			lastTargetSegIdx = i
			lastTargetSeg = seg
		}
	}

	resumeProviderSessionID := ""
	if lastTargetSeg != nil {
		resumeProviderSessionID = lastTargetSeg.ProviderSessionID
		if resumeProviderSessionID == "" && lastTargetSeg.RuntimeSessionID != "" {
			resumeProviderSessionID = m.captureProviderSessionID(lastTargetSeg.ID, lastTargetSeg.RuntimeSessionID)
			lastTargetSeg.ProviderSessionID = resumeProviderSessionID
		}
	}

	var contextSegments []*database.ChatSegment
	if lastTargetSegIdx >= 0 {
		// Incremental: only segments after the target provider's last segment
		contextSegments = segments[lastTargetSegIdx+1:]
	} else {
		// Full: all segments (target provider never had a session)
		contextSegments = segments
	}

	contextText, err := m.buildContextFromSegments(contextSegments, chat.ProjectPath)
	if err != nil {
		contextText = ""
	}

	// Create new segment
	newSegmentID := uuid.New().String()
	newSeg := &database.ChatSegment{
		ID:                newSegmentID,
		ProjectChatID:     chatID,
		Provider:          newProviderID,
		Model:             model,
		Seq:               currentSeg.Seq + 1,
		Status:            database.SegmentStatusActive,
		ContextInjected:   contextText != "",
		ProviderSessionID: resumeProviderSessionID,
		CreatedAt:         time.Now().Unix(),
	}
	if err := m.db.CreateChatSegment(newSeg); err != nil {
		return nil, fmt.Errorf("create segment: %w", err)
	}

	runtimeSessionID := ""
	if resumeProviderSessionID != "" {
		runtimeSessionID = m.provider.ResolveRunningSessionID(newProviderID, chat.ProjectPath, resumeProviderSessionID)
	}
	if runtimeSessionID == "" && lastTargetSeg != nil && lastTargetSeg.RuntimeSessionID != "" {
		runtimeSessionID = m.provider.ResolveRunningSessionID(newProviderID, chat.ProjectPath, lastTargetSeg.RuntimeSessionID)
	}

	// Don't send context here - it will be prepended to the user's first message
	// in SendMessage (when segment.ContextInjected is true but no message sent yet)

	_ = m.db.UpdateChatSegmentRuntime(newSegmentID, runtimeSessionID, resumeProviderSessionID)
	_ = m.db.UpdateProjectChatActive(chatID, newProviderID, newSegmentID)

	// Register stream alias: new real stream → projectChatId
	if m.streamHub != nil && runtimeSessionID != "" {
		m.streamHub.RegisterAlias(streamID(newProviderID, runtimeSessionID), chatID)
	}

	result := &SwitchResult{
		ChatID:           chatID,
		SegmentID:        newSegmentID,
		RuntimeSessionID: runtimeSessionID,
		StreamID:         chatID, // Frontend uses chatID as stream
		Provider:         newProviderID,
		Model:            model,
	}

	m.emitEvent("projectchat:switched", map[string]any{
		"chat_id":    chatID,
		"provider":   newProviderID,
		"segment_id": newSegmentID,
		"session_id": runtimeSessionID,
		"stream_id":  chatID,
	})

	return result, nil
}

func (m *Manager) InterruptActiveSegment(chatID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return fmt.Errorf("get chat: %w", err)
	}

	seg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return fmt.Errorf("get segment: %w", err)
	}

	if seg.RuntimeSessionID != "" {
		if err := m.provider.InterruptSession(seg.RuntimeSessionID); err != nil && !strings.Contains(err.Error(), "session not found") {
			return fmt.Errorf("interrupt provider session: %w", err)
		}
	}

	// Interrupting stops the current provider turn, not the ProjectChat segment.
	// Keeping the segment active lets the next prompt continue the same provider
	// session/thread instead of treating the chat as a closed segment.
	return nil
}

func (m *Manager) GetChat(chatID string) (*ProjectChatDetail, error) {
	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return nil, err
	}
	segments, err := m.db.ListChatSegments(chatID)
	if err != nil {
		return nil, err
	}
	return &ProjectChatDetail{Chat: chat, Segments: segments}, nil
}

func (m *Manager) GetActiveChatForProject(projectPath string) (*database.ProjectChat, error) {
	chat, err := m.db.GetActiveChatForProject(projectPath)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return chat, nil
}

func (m *Manager) ListChats(projectPath string) ([]*database.ProjectChat, error) {
	return m.db.ListProjectChats(projectPath)
}

func (m *Manager) ResumeChat(chatID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return "", fmt.Errorf("get chat: %w", err)
	}

	seg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return "", fmt.Errorf("get segment: %w", err)
	}

	if seg.ProviderSessionID == "" && seg.RuntimeSessionID == "" {
		return "", fmt.Errorf("no provider session to resume")
	}

	config := m.sessionConfig(seg.Provider, chat.ProjectPath, seg.Model, "", "")
	config.Resume = true
	config.ResumeSessionID = seg.ProviderSessionID
	if config.ResumeSessionID == "" {
		config.ResumeSessionID = seg.RuntimeSessionID
	}

	runtimeSessionID, err := m.provider.EnsureUserSession(seg.Provider, config)
	if err != nil {
		return "", fmt.Errorf("resume session: %w", err)
	}
	if seg.ProviderSessionID == "" {
		seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, runtimeSessionID)
	}

	_ = m.db.UpdateChatSegmentRuntime(seg.ID, runtimeSessionID, seg.ProviderSessionID)
	if m.streamHub != nil {
		m.streamHub.RegisterAlias(streamID(seg.Provider, runtimeSessionID), chat.ID)
	}
	return streamID(seg.Provider, runtimeSessionID), nil
}

func (m *Manager) LoadAllSegmentFrames(chatID string) ([]stream.SessionFrame, error) {
	segments, err := m.db.ListChatSegments(chatID)
	if err != nil {
		return []stream.SessionFrame{}, nil
	}

	return m.loadSegmentFrames(chatID, segments)
}

func (m *Manager) LoadActiveSegmentFrames(chatID string) ([]stream.SessionFrame, error) {
	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return []stream.SessionFrame{}, nil
	}
	seg, err := m.db.GetChatSegment(chat.ActiveSegmentID)
	if err != nil {
		return []stream.SessionFrame{}, nil
	}

	return m.loadSegmentFrames(chatID, []*database.ChatSegment{seg})
}

func (m *Manager) loadSegmentFrames(chatID string, segments []*database.ChatSegment) ([]stream.SessionFrame, error) {
	chat, err := m.db.GetProjectChat(chatID)
	if err != nil {
		return []stream.SessionFrame{}, nil
	}

	projectID := projectPathToID(chat.ProjectPath)

	var allFrames []stream.SessionFrame
	for _, seg := range segments {
		if seg.ProviderSessionID == "" && seg.RuntimeSessionID == "" {
			continue
		}

		sessionID := seg.ProviderSessionID
		if sessionID == "" {
			sessionID = seg.RuntimeSessionID
		}
		frameRuntimeSessionID := seg.RuntimeSessionID
		if frameRuntimeSessionID == "" {
			frameRuntimeSessionID = sessionID
		}

		events, err := m.provider.LoadHistoryEvents(seg.Provider, projectID, sessionID)
		if err != nil {
			continue
		}

		frames, err := stream.FramesFromEvents(seg.Provider, stream.ProviderOutputContext{
			RuntimeSessionID:  frameRuntimeSessionID,
			ProviderSessionID: seg.ProviderSessionID,
			ProjectPath:       chat.ProjectPath,
		}, events)
		if err != nil {
			continue
		}

		allFrames = append(allFrames, frames...)
	}

	if allFrames == nil {
		allFrames = []stream.SessionFrame{}
	}
	return stream.RebaseFramesToStream(chatID, allFrames), nil
}

// --- Private helpers ---

func (m *Manager) buildContextFromSegments(segments []*database.ChatSegment, projectPath string) (string, error) {
	// Resolve providerSessionIDs from live sessions if missing
	liveSessions := m.provider.ListAllSessions()
	for _, seg := range segments {
		if seg.ProviderSessionID == "" && seg.RuntimeSessionID != "" {
			for _, s := range liveSessions {
				if s.SessionID == seg.RuntimeSessionID && s.ProviderSessionID != "" {
					seg.ProviderSessionID = s.ProviderSessionID
					_ = m.db.UpdateChatSegmentRuntime(seg.ID, seg.RuntimeSessionID, s.ProviderSessionID)
					break
				}
			}
		}
	}

	projectID := projectPathToID(projectPath)

	var allFrames []stream.SessionFrame
	for _, seg := range segments {
		sessionID := seg.ProviderSessionID
		if sessionID == "" {
			sessionID = seg.RuntimeSessionID
		}
		if sessionID == "" {
			continue
		}
		frameRuntimeSessionID := seg.RuntimeSessionID
		if frameRuntimeSessionID == "" {
			frameRuntimeSessionID = sessionID
		}

		events, err := m.provider.LoadHistoryEvents(seg.Provider, projectID, sessionID)
		if err != nil {
			continue
		}

		frames, err := stream.FramesFromEvents(seg.Provider, stream.ProviderOutputContext{
			RuntimeSessionID:  frameRuntimeSessionID,
			ProviderSessionID: seg.ProviderSessionID,
			ProjectPath:       projectPath,
		}, events)
		if err != nil {
			continue
		}

		allFrames = append(allFrames, frames...)
	}

	contextText := BuildContextFromFrames(allFrames)
	return contextText, nil
}

func (m *Manager) sessionConfig(providerID, projectPath, model, providerApiID, reasoningEffort string) provider.SessionConfig {
	var config provider.SessionConfig
	if m.configResolver != nil {
		config = m.configResolver(providerID, projectPath, model, providerApiID, reasoningEffort)
	} else {
		config = provider.SessionConfig{
			ProjectPath:   projectPath,
			Model:         model,
			ProviderApiID: providerApiID,
		}
		if reasoningEffort != "" {
			config.Extra = map[string]string{"reasoning_effort": reasoningEffort}
		}
	}
	if config.ProjectPath == "" {
		config.ProjectPath = projectPath
	}
	if config.Model == "" {
		config.Model = model
	}
	if config.ProviderApiID == "" {
		config.ProviderApiID = providerApiID
	}
	if reasoningEffort != "" {
		if config.Extra == nil {
			config.Extra = make(map[string]string)
		}
		if config.Extra["reasoning_effort"] == "" {
			config.Extra["reasoning_effort"] = reasoningEffort
		}
	}
	return config
}

func (m *Manager) captureProviderSessionID(segmentID, runtimeSessionID string) string {
	if runtimeSessionID == "" {
		return ""
	}
	for _, s := range m.provider.ListAllSessions() {
		if s.SessionID != runtimeSessionID || s.ProviderSessionID == "" {
			continue
		}
		_ = m.db.UpdateChatSegmentRuntime(segmentID, runtimeSessionID, s.ProviderSessionID)
		return s.ProviderSessionID
	}
	return ""
}

func activeProviderSessionID(seg *database.ChatSegment) string {
	if !needsProviderSessionCapture(seg.ProviderSessionID) {
		return seg.ProviderSessionID
	}
	return seg.RuntimeSessionID
}

func needsProviderSessionCapture(providerSessionID string) bool {
	return providerSessionID == "" || providerSessionID == provider.FreshSessionSentinel
}

func (m *Manager) emitContextSyncFrame(chatID, projectPath string, seg *database.ChatSegment, runtimeSessionID, message string) {
	if m.streamHub == nil || message == "" {
		return
	}
	frame := newContextSyncFrame(chatID, projectPath, seg, runtimeSessionID, message)
	_ = m.streamHub.AppendVirtual(chatID, frame)
}

func newContextSyncFrame(chatID, projectPath string, seg *database.ChatSegment, runtimeSessionID, message string) stream.SessionFrame {
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	eventID := fmt.Sprintf("%s:%s:%s", chatID, seg.ID, projectChatContextSyncSubtype)
	raw := map[string]any{
		"type":               "user",
		"event_id":           eventID,
		"source":             projectChatContextSyncSubtype,
		"subtype":            projectChatContextSyncSubtype,
		"provider":           seg.Provider,
		"session_id":         runtimeSessionID,
		"runtime_session_id": runtimeSessionID,
		"cwd":                projectPath,
		"timestamp":          timestamp,
		"message": map[string]any{
			"role": "user",
			"content": []map[string]any{
				{
					"type": "text",
					"text": message,
				},
			},
		},
	}
	if seg.ProviderSessionID != "" {
		raw["provider_session_id"] = seg.ProviderSessionID
	}
	return stream.SessionFrame{
		StreamID:          chatID,
		FrameID:           eventID,
		Provider:          seg.Provider,
		RuntimeSessionID:  runtimeSessionID,
		ProviderSessionID: seg.ProviderSessionID,
		ProjectPath:       projectPath,
		Seq:               0,
		Timestamp:         timestamp,
		Kind:              stream.FrameKindMessage,
		Role:              stream.RoleUser,
		Subtype:           projectChatContextSyncSubtype,
		Content: []stream.ContentBlock{
			{Type: stream.ContentText, Text: message},
		},
		Meta: stream.Meta{Raw: raw},
	}
}

func (m *Manager) summarizeContext(targetProvider, projectPath, contextText, model, providerApiID string) (string, error) {
	config := m.sessionConfig(targetProvider, projectPath, model, providerApiID, "")
	config.Prompt = BuildSummarizationPrompt(contextText)

	sessionID, err := m.provider.StartSession(targetProvider, config)
	if err != nil {
		return "", err
	}

	// Wait for the summarization session to complete (up to 60s)
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		output, err := m.provider.GetSessionOutput(sessionID)
		if err != nil {
			break
		}
		sessions := m.provider.ListAllSessions()
		var done bool
		for _, s := range sessions {
			if s.SessionID == sessionID && (s.Status == "completed" || s.Status == "failed") {
				done = true
				break
			}
		}
		if done {
			return output, nil
		}
	}

	// Timeout: terminate and fall back to truncation
	_ = m.provider.TerminateSession(sessionID)
	return truncateContext(contextText, 20000), nil
}

func truncateContext(text string, maxChars int) string {
	if len(text) <= maxChars {
		return text
	}
	return text[len(text)-maxChars:]
}

func (m *Manager) emitEvent(name string, data any) {
	if m.emitter != nil {
		m.emitter.Emit(name, data)
	}
}

func streamID(providerID, runtimeSessionID string) string {
	if providerID == "" {
		return runtimeSessionID
	}
	return providerID + ":" + runtimeSessionID
}

func projectPathToID(projectPath string) string {
	normalized := strings.ReplaceAll(projectPath, "/", "-")
	normalized = strings.ReplaceAll(normalized, "\\", "-")
	normalized = strings.ReplaceAll(normalized, ":", "-")
	normalized = strings.ReplaceAll(normalized, ".", "-")
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return normalized
}
