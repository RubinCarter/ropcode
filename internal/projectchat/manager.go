package projectchat

import (
	"fmt"
	"log"
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
	db        *database.Database
	provider  *provider.Manager
	emitter   provider.EventEmitter
	streamHub *stream.Hub
	mu        sync.Mutex
}

const projectChatContextSyncSubtype = "projectchat_context_sync"

func NewManager(db *database.Database, prov *provider.Manager, emitter provider.EventEmitter, hub *stream.Hub) *Manager {
	return &Manager{
		db:        db,
		provider:  prov,
		emitter:   emitter,
		streamHub: hub,
	}
}

func (m *Manager) CreateChat(projectPath, providerID, model, providerApiID string, existingSessionID ...string) (*SwitchResult, error) {
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

	// If an existing session ID is provided, wrap it (no need to start or wait)
	var runtimeSessionID string
	if len(existingSessionID) > 0 && existingSessionID[0] != "" {
		runtimeSessionID = existingSessionID[0]
	} else {
		config := provider.SessionConfig{
			ProjectPath:   projectPath,
			Model:         model,
			Interactive:   true,
			ProviderApiID: providerApiID,
		}
		var err error
		runtimeSessionID, err = m.provider.StartSession(providerID, config)
		if err != nil {
			return nil, fmt.Errorf("start session: %w", err)
		}
		if err := m.provider.WaitForInit(runtimeSessionID, 30*time.Second); err != nil {
			_ = err
		}
	}

	providerSessionID := m.captureProviderSessionID(segmentID, runtimeSessionID)
	_ = m.db.UpdateChatSegmentRuntime(segmentID, runtimeSessionID, providerSessionID)

	// Register stream alias: real stream → projectChatId
	realStream := streamID(providerID, runtimeSessionID)
	if m.streamHub != nil {
		m.streamHub.RegisterAlias(realStream, chatID)
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

	if seg.RuntimeSessionID == "" {
		return "", fmt.Errorf("no active runtime session for segment %s", seg.ID)
	}

	// Update providerSessionID if not yet captured
	if seg.ProviderSessionID == "" {
		seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, seg.RuntimeSessionID)
	}

	// If this segment has context to inject (first message after switch),
	// prepend the context to the user's message
	actualMessage := message
	contextSyncMessage := ""
	if seg.ContextInjected && seg.Seq > 0 {
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
					actualMessage = InjectContext(message, contextText)
					contextSyncMessage = contextText
				}
			}
		}
		// Mark context as delivered
		_ = m.db.UpdateChatSegmentContextDelivered(seg.ID)
	}

	sentRuntimeSessionID := seg.RuntimeSessionID
	if err := m.provider.SendMessage(seg.RuntimeSessionID, actualMessage); err != nil {
		// Session might be gone (after restart/hot-reload) - try to restart it
		config := provider.SessionConfig{
			ProjectPath:     chat.ProjectPath,
			Model:           model,
			Interactive:     true,
			ProviderApiID:   providerApiID,
			Resume:          seg.ProviderSessionID != "",
			ResumeSessionID: seg.ProviderSessionID,
		}
		newRuntimeID, startErr := m.provider.StartSession(seg.Provider, config)
		if startErr != nil {
			return "", fmt.Errorf("send message: %w (restart also failed: %v)", err, startErr)
		}
		if initErr := m.provider.WaitForInit(newRuntimeID, 30*time.Second); initErr != nil {
			_ = initErr
		}
		if seg.ProviderSessionID == "" {
			seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, newRuntimeID)
		}
		_ = m.db.UpdateChatSegmentRuntime(seg.ID, newRuntimeID, seg.ProviderSessionID)
		// Update stream alias
		realStream := streamID(seg.Provider, newRuntimeID)
		if m.streamHub != nil {
			m.streamHub.RegisterAlias(realStream, chatID)
		}
		if err := m.provider.SendMessage(newRuntimeID, actualMessage); err != nil {
			return "", fmt.Errorf("send message after restart: %w", err)
		}
		sentRuntimeSessionID = newRuntimeID
	}

	if contextSyncMessage != "" {
		m.emitContextSyncFrame(chatID, chat.ProjectPath, seg, sentRuntimeSessionID, contextSyncMessage)
	}

	return streamID(seg.Provider, sentRuntimeSessionID), nil
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

	// Resolve providerSessionID BEFORE terminating (session still in live list)
	if currentSeg.ProviderSessionID == "" && currentSeg.RuntimeSessionID != "" {
		currentSeg.ProviderSessionID = m.captureProviderSessionID(currentSeg.ID, currentSeg.RuntimeSessionID)
	}

	// Terminate current session
	if currentSeg.RuntimeSessionID != "" {
		_ = m.provider.TerminateSession(currentSeg.RuntimeSessionID)
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
	segments, err := m.db.ListChatSegments(chatID)
	if err != nil {
		return nil, fmt.Errorf("list segments: %w", err)
	}

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

	// Check if summarization is needed
	if contextText != "" {
		tokens := EstimateTokens(contextText)
		if ShouldSummarize(tokens, newProviderID, model) {
			m.emitEvent("projectchat:context-injecting", map[string]any{
				"chat_id":     chatID,
				"summarizing": true,
			})
			summarized, err := m.summarizeContext(newProviderID, chat.ProjectPath, contextText, model, providerApiID)
			if err == nil && summarized != "" {
				contextText = summarized
			}
		}
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

	if runtimeSessionID == "" {
		// Start or resume provider session (without context in prompt - send after init)
		config := provider.SessionConfig{
			ProjectPath:   chat.ProjectPath,
			Model:         model,
			Interactive:   true,
			ProviderApiID: providerApiID,
		}
		if resumeProviderSessionID != "" {
			config.Resume = true
			config.ResumeSessionID = resumeProviderSessionID
		}

		var startErr error
		runtimeSessionID, startErr = m.provider.StartSession(newProviderID, config)
		if startErr != nil {
			return nil, fmt.Errorf("start new session: %w", startErr)
		}

		// Wait for session initialization
		if err := m.provider.WaitForInit(runtimeSessionID, 30*time.Second); err != nil {
			_ = err
		}
		if resumeProviderSessionID == "" {
			resumeProviderSessionID = m.captureProviderSessionID(newSegmentID, runtimeSessionID)
		}
	}

	// Don't send context here - it will be prepended to the user's first message
	// in SendMessage (when segment.ContextInjected is true but no message sent yet)

	_ = m.db.UpdateChatSegmentRuntime(newSegmentID, runtimeSessionID, resumeProviderSessionID)
	_ = m.db.UpdateProjectChatActive(chatID, newProviderID, newSegmentID)

	// Register stream alias: new real stream → projectChatId
	realStream := streamID(newProviderID, runtimeSessionID)
	if m.streamHub != nil {
		m.streamHub.RegisterAlias(realStream, chatID)
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
		_ = m.provider.TerminateSession(seg.RuntimeSessionID)
	}

	now := time.Now().Unix()
	return m.db.UpdateChatSegmentStatus(seg.ID, database.SegmentStatusInterrupted, &now)
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
	return m.db.GetActiveChatForProject(projectPath)
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

	if seg.ProviderSessionID == "" {
		return "", fmt.Errorf("no provider session to resume")
	}

	config := provider.SessionConfig{
		ProjectPath:     chat.ProjectPath,
		Model:           seg.Model,
		Interactive:     true,
		Resume:          true,
		ResumeSessionID: seg.ProviderSessionID,
	}

	runtimeSessionID, err := m.provider.StartSession(seg.Provider, config)
	if err != nil {
		return "", fmt.Errorf("resume session: %w", err)
	}
	if initErr := m.provider.WaitForInit(runtimeSessionID, 30*time.Second); initErr != nil {
		_ = initErr
	}
	if seg.ProviderSessionID == "" {
		seg.ProviderSessionID = m.captureProviderSessionID(seg.ID, runtimeSessionID)
	}

	_ = m.db.UpdateChatSegmentRuntime(seg.ID, runtimeSessionID, seg.ProviderSessionID)
	return streamID(seg.Provider, runtimeSessionID), nil
}

func (m *Manager) LoadAllSegmentFrames(chatID string) ([]stream.SessionFrame, error) {
	segments, err := m.db.ListChatSegments(chatID)
	if err != nil {
		return []stream.SessionFrame{}, nil
	}

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

		events, err := m.provider.LoadHistoryEvents(seg.Provider, projectID, sessionID)
		if err != nil {
			continue
		}

		frames, err := stream.FramesFromEvents(seg.Provider, stream.ProviderOutputContext{
			RuntimeSessionID: seg.RuntimeSessionID,
			ProjectPath:      chat.ProjectPath,
		}, events)
		if err != nil {
			continue
		}

		allFrames = append(allFrames, frames...)
	}

	if allFrames == nil {
		allFrames = []stream.SessionFrame{}
	}
	return allFrames, nil
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

		events, err := m.provider.LoadHistoryEvents(seg.Provider, projectID, sessionID)
		if err != nil {
			continue
		}

		frames, err := stream.FramesFromEvents(seg.Provider, stream.ProviderOutputContext{
			RuntimeSessionID: seg.RuntimeSessionID,
			ProjectPath:      projectPath,
		}, events)
		if err != nil {
			continue
		}

		allFrames = append(allFrames, frames...)
	}

	contextText := BuildContextFromFrames(allFrames)
	return contextText, nil
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

func (m *Manager) emitContextSyncFrame(chatID, projectPath string, seg *database.ChatSegment, runtimeSessionID, message string) {
	if m.streamHub == nil || message == "" {
		return
	}
	frame := newContextSyncFrame(chatID, projectPath, seg, runtimeSessionID, message)
	if err := m.streamHub.Append(frame); err != nil {
		log.Printf("[projectchat] SendMessage: failed to emit context sync frame: %v", err)
	}
}

func newContextSyncFrame(chatID, projectPath string, seg *database.ChatSegment, runtimeSessionID, message string) stream.SessionFrame {
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	raw := map[string]any{
		"type":               "user",
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
		FrameID:           fmt.Sprintf("%s:%s:%s", chatID, seg.ID, projectChatContextSyncSubtype),
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
	config := provider.SessionConfig{
		ProjectPath:   projectPath,
		Prompt:        BuildSummarizationPrompt(contextText),
		Model:         model,
		ProviderApiID: providerApiID,
	}

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
