// internal/checkpoint/manager.go
package checkpoint

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// CheckpointManager manages checkpoint state and operations for sessions
type CheckpointManager struct {
	storage   *Storage
	mu        sync.RWMutex
	sessions  map[string]*SessionState
	projectID string
}

// SessionState tracks checkpoint state for a single session
type SessionState struct {
	SessionID         string
	MessageCount      int
	LastCheckpointAt  int
	Config            *CheckpointConfig
	CurrentCheckpoint *Checkpoint
	FileModifications []string
	mu                sync.RWMutex
}

// CheckpointConfig holds checkpoint configuration
type CheckpointConfig struct {
	AutoCheckpointEnabled bool   `json:"auto_checkpoint_enabled"`
	CheckpointStrategy    string `json:"checkpoint_strategy"` // "manual", "auto", "hybrid"
	MaxCheckpoints        int    `json:"max_checkpoints"`
	CheckpointInterval    int    `json:"checkpoint_interval"` // messages between checkpoints
}

// DefaultConfig returns default checkpoint configuration
func DefaultConfig() *CheckpointConfig {
	return &CheckpointConfig{
		AutoCheckpointEnabled: false,
		CheckpointStrategy:    "manual",
		MaxCheckpoints:        50,
		CheckpointInterval:    10,
	}
}

// NewManager creates a new checkpoint manager
func NewManager(storage *Storage, projectID string) *CheckpointManager {
	return &CheckpointManager{
		storage:   storage,
		sessions:  make(map[string]*SessionState),
		projectID: projectID,
	}
}

// GetOrCreateSession gets or creates session state
func (m *CheckpointManager) GetOrCreateSession(sessionID string) *SessionState {
	m.mu.Lock()
	defer m.mu.Unlock()

	if session, exists := m.sessions[sessionID]; exists {
		return session
	}

	session := &SessionState{
		SessionID:         sessionID,
		MessageCount:      0,
		LastCheckpointAt:  0,
		Config:            DefaultConfig(),
		FileModifications: []string{},
	}
	m.sessions[sessionID] = session
	return session
}

// TrackMessage tracks a message for auto-checkpoint logic
func (m *CheckpointManager) TrackMessage(sessionID string, messageIndex int) error {
	session := m.GetOrCreateSession(sessionID)
	session.mu.Lock()
	defer session.mu.Unlock()

	session.MessageCount = messageIndex
	return nil
}

// TrackMessages tracks multiple messages at once
func (m *CheckpointManager) TrackMessages(sessionID string, messages []interface{}) error {
	session := m.GetOrCreateSession(sessionID)
	session.mu.Lock()
	defer session.mu.Unlock()

	session.MessageCount = len(messages)
	return nil
}

// ShouldAutoCheckpoint checks if conditions are met for auto-checkpoint
func (m *CheckpointManager) ShouldAutoCheckpoint(sessionID string) (bool, error) {
	session := m.GetOrCreateSession(sessionID)
	session.mu.RLock()
	defer session.mu.RUnlock()

	if !session.Config.AutoCheckpointEnabled {
		return false, nil
	}

	if session.Config.CheckpointStrategy == "manual" {
		return false, nil
	}

	// Check if interval has been reached
	messagesSinceCheckpoint := session.MessageCount - session.LastCheckpointAt
	if messagesSinceCheckpoint >= session.Config.CheckpointInterval {
		return true, nil
	}

	return false, nil
}

// UpdateConfig updates checkpoint configuration
func (m *CheckpointManager) UpdateConfig(sessionID string, config *CheckpointConfig) error {
	session := m.GetOrCreateSession(sessionID)
	session.mu.Lock()
	defer session.mu.Unlock()

	session.Config = config
	return nil
}

// GetConfig returns current checkpoint configuration
func (m *CheckpointManager) GetConfig(sessionID string) *CheckpointConfig {
	session := m.GetOrCreateSession(sessionID)
	session.mu.RLock()
	defer session.mu.RUnlock()

	return session.Config
}

// RestoreCheckpoint restores a checkpoint with options
func (m *CheckpointManager) RestoreCheckpoint(projectID, sessionID, checkpointID string, opts map[string]interface{}) (*CheckpointResult, error) {
	// Load checkpoint data
	checkpoint, _, _, err := m.storage.Load(projectID, sessionID, checkpointID)
	if err != nil {
		return nil, fmt.Errorf("load checkpoint: %w", err)
	}

	// Load file snapshots
	fileSnapshots, err := m.loadFileSnapshots(projectID, sessionID, checkpointID)
	if err != nil {
		return nil, fmt.Errorf("load file snapshots: %w", err)
	}

	result := &CheckpointResult{
		Checkpoint: checkpoint,
		Warnings:   []string{},
	}

	// Restore files if requested
	restoreFiles := true
	if val, ok := opts["restore_files"].(bool); ok {
		restoreFiles = val
	}

	if restoreFiles {
		for _, snapshot := range fileSnapshots {
			if snapshot.IsDeleted {
				// Remove deleted files
				if err := os.Remove(snapshot.FilePath); err != nil && !os.IsNotExist(err) {
					result.Warnings = append(result.Warnings, fmt.Sprintf("Failed to remove %s: %v", snapshot.FilePath, err))
				}
			} else {
				// Restore file content
				dir := filepath.Dir(snapshot.FilePath)
				if err := os.MkdirAll(dir, 0755); err != nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("Failed to create dir for %s: %v", snapshot.FilePath, err))
					continue
				}

				if err := os.WriteFile(snapshot.FilePath, []byte(snapshot.Content), os.FileMode(snapshot.Permissions)); err != nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("Failed to restore %s: %v", snapshot.FilePath, err))
				} else {
					result.FilesProcessed++
				}
			}
		}
	}

	// Update session state
	session := m.GetOrCreateSession(sessionID)
	session.mu.Lock()
	session.CurrentCheckpoint = checkpoint
	session.MessageCount = checkpoint.MessageIndex
	session.mu.Unlock()

	return result, nil
}

// ForkFromCheckpoint creates a new session from a checkpoint
func (m *CheckpointManager) ForkFromCheckpoint(projectID, checkpointID, oldSessionID, newSessionID string) (*CheckpointResult, error) {
	// Load the checkpoint
	checkpoint, _, _, err := m.storage.Load(projectID, oldSessionID, checkpointID)
	if err != nil {
		return nil, fmt.Errorf("load checkpoint: %w", err)
	}

	// Load file snapshots
	fileSnapshots, err := m.loadFileSnapshots(projectID, oldSessionID, checkpointID)
	if err != nil {
		return nil, fmt.Errorf("load file snapshots: %w", err)
	}

	// Create new checkpoint in new session
	newCheckpoint := &Checkpoint{
		ID:                 GenerateID(),
		SessionID:          newSessionID,
		ParentCheckpointID: checkpointID,
		MessageIndex:       checkpoint.MessageIndex,
		Timestamp:          time.Now(),
		Description:        fmt.Sprintf("Forked from checkpoint %s", checkpointID),
		TriggerType:        "fork",
	}

	// Save to new session (empty messages for forked checkpoint)
	result, err := m.storage.Save(projectID, newSessionID, newCheckpoint, fileSnapshots, "")
	if err != nil {
		return nil, fmt.Errorf("save forked checkpoint: %w", err)
	}

	// Initialize new session state
	newSession := m.GetOrCreateSession(newSessionID)
	newSession.mu.Lock()
	newSession.CurrentCheckpoint = newCheckpoint
	newSession.MessageCount = checkpoint.MessageIndex
	newSession.mu.Unlock()

	return result, nil
}

// GetTimeline builds the checkpoint timeline tree
func (m *CheckpointManager) GetTimeline(projectID, sessionID string) (*SessionTimeline, error) {
	checkpoints, err := m.storage.List(projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list checkpoints: %w", err)
	}

	timeline := &SessionTimeline{
		SessionID:        sessionID,
		TotalCheckpoints: len(checkpoints),
	}

	if len(checkpoints) == 0 {
		return timeline, nil
	}

	// Build tree structure
	nodeMap := make(map[string]*TimelineNode)
	for i := range checkpoints {
		cp := &checkpoints[i]
		node := &TimelineNode{
			Checkpoint: *cp,
			Children:   []TimelineNode{},
		}
		nodeMap[cp.ID] = node
	}

	// Link parent-child relationships
	var rootNode *TimelineNode
	for _, node := range nodeMap {
		if node.Checkpoint.ParentCheckpointID == "" {
			if rootNode == nil {
				rootNode = node
			}
		} else {
			if parent, ok := nodeMap[node.Checkpoint.ParentCheckpointID]; ok {
				parent.Children = append(parent.Children, *node)
			}
		}
	}

	timeline.RootNode = rootNode

	// Set current checkpoint
	session := m.GetOrCreateSession(sessionID)
	session.mu.RLock()
	if session.CurrentCheckpoint != nil {
		timeline.CurrentCheckpointID = session.CurrentCheckpoint.ID
	}
	session.mu.RUnlock()

	return timeline, nil
}

// GetDiff compares two checkpoints
func (m *CheckpointManager) GetDiff(projectID, sessionID, fromID, toID string) (map[string]interface{}, error) {
	fromFiles, err := m.loadFileSnapshots(projectID, sessionID, fromID)
	if err != nil {
		return nil, fmt.Errorf("load from checkpoint: %w", err)
	}

	toFiles, err := m.loadFileSnapshots(projectID, sessionID, toID)
	if err != nil {
		return nil, fmt.Errorf("load to checkpoint: %w", err)
	}

	// Build file maps
	fromMap := make(map[string]FileSnapshot)
	for _, f := range fromFiles {
		fromMap[f.FilePath] = f
	}

	toMap := make(map[string]FileSnapshot)
	for _, f := range toFiles {
		toMap[f.FilePath] = f
	}

	var modified, added, deleted []map[string]interface{}

	// Find modified and deleted files
	for path, fromFile := range fromMap {
		if toFile, exists := toMap[path]; exists {
			if fromFile.Hash != toFile.Hash {
				modified = append(modified, map[string]interface{}{
					"path":      path,
					"from_hash": fromFile.Hash,
					"to_hash":   toFile.Hash,
					"from_size": fromFile.Size,
					"to_size":   toFile.Size,
				})
			}
		} else {
			deleted = append(deleted, map[string]interface{}{
				"path": path,
				"hash": fromFile.Hash,
			})
		}
	}

	// Find added files
	for path, toFile := range toMap {
		if _, exists := fromMap[path]; !exists {
			added = append(added, map[string]interface{}{
				"path": path,
				"hash": toFile.Hash,
				"size": toFile.Size,
			})
		}
	}

	return map[string]interface{}{
		"from_checkpoint_id": fromID,
		"to_checkpoint_id":   toID,
		"modified_files":     modified,
		"added_files":        added,
		"deleted_files":      deleted,
	}, nil
}

// CleanupOld removes old checkpoints based on retention policy
func (m *CheckpointManager) CleanupOld(projectID, sessionID string) (int, error) {
	session := m.GetOrCreateSession(sessionID)
	session.mu.RLock()
	maxCheckpoints := session.Config.MaxCheckpoints
	session.mu.RUnlock()

	checkpoints, err := m.storage.List(projectID, sessionID)
	if err != nil {
		return 0, fmt.Errorf("list checkpoints: %w", err)
	}

	if len(checkpoints) <= maxCheckpoints {
		return 0, nil
	}

	// Sort by timestamp (oldest first)
	// For simplicity, we'll delete the oldest ones
	toDelete := len(checkpoints) - maxCheckpoints
	deleted := 0

	for i := 0; i < toDelete; i++ {
		if err := m.storage.Delete(projectID, sessionID, checkpoints[i].ID); err != nil {
			// Continue even if delete fails
			continue
		}
		deleted++
	}

	return deleted, nil
}

// ClearSession clears checkpoint state for a session
func (m *CheckpointManager) ClearSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.sessions, sessionID)
	return nil
}

// loadFileSnapshots loads file snapshots for a checkpoint
func (m *CheckpointManager) loadFileSnapshots(projectID, sessionID, checkpointID string) ([]FileSnapshot, error) {
	baseDir := m.storage.checkpointsDir(projectID, sessionID)
	refsDir := filepath.Join(baseDir, "refs", checkpointID)

	entries, err := os.ReadDir(refsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []FileSnapshot{}, nil
		}
		return nil, err
	}

	var snapshots []FileSnapshot
	contentPoolDir := filepath.Join(baseDir, "content_pool")

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		// Read reference metadata
		refPath := filepath.Join(refsDir, entry.Name())
		refData, err := os.ReadFile(refPath)
		if err != nil {
			continue
		}

		var refMeta map[string]interface{}
		if err := json.Unmarshal(refData, &refMeta); err != nil {
			continue
		}

		path, _ := refMeta["path"].(string)
		hash, _ := refMeta["hash"].(string)
		isDeleted, _ := refMeta["is_deleted"].(bool)
		permissions, _ := refMeta["permissions"].(float64)
		size, _ := refMeta["size"].(float64)

		snapshot := FileSnapshot{
			CheckpointID: checkpointID,
			FilePath:     path,
			Hash:         hash,
			IsDeleted:    isDeleted,
			Permissions:  uint32(permissions),
			Size:         int64(size),
		}

		// Load content if not deleted
		if !isDeleted {
			contentFile := filepath.Join(contentPoolDir, hash)
			compressed, err := os.ReadFile(contentFile)
			if err == nil {
				decoder, _ := m.storage.decoder.DecodeAll(compressed, nil)
				snapshot.Content = string(decoder)
			}
		}

		snapshots = append(snapshots, snapshot)
	}

	return snapshots, nil
}
