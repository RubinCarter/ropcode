// internal/session/history.go
package session

import (
	"fmt"

	"ropcode/internal/claude"
)

// HistoryManager handles session history operations
type HistoryManager struct {
	claudeDir string
}

// NewHistoryManager creates a new HistoryManager
func NewHistoryManager(claudeDir string) *HistoryManager {
	return &HistoryManager{
		claudeDir: claudeDir,
	}
}

// GetMessageIndex returns line numbers for each message in a session
func (h *HistoryManager) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	filePath, err := claude.FindSessionFile(h.claudeDir, projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session file: %w", err)
	}

	index, err := claude.BuildMessageIndex(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to build message index: %w", err)
	}

	return index.LineNumbers, nil
}

// GetMessagesRange returns messages between start and end indices
func (h *HistoryManager) GetMessagesRange(projectID, sessionID string, start, end int) ([]claude.Message, error) {
	filePath, err := claude.FindSessionFile(h.claudeDir, projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session file: %w", err)
	}

	// Adjust indices to be 1-based (JSONL line numbers start at 1)
	if start < 1 {
		start = 1
	}

	messages, err := claude.ReadMessagesRange(filePath, start, end)
	if err != nil {
		return nil, fmt.Errorf("failed to read messages range: %w", err)
	}

	return messages, nil
}

// LoadSessionHistory loads all messages for a session
func (h *HistoryManager) LoadSessionHistory(projectID, sessionID string) ([]claude.Message, error) {
	filePath, err := claude.FindSessionFile(h.claudeDir, projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to find session file: %w", err)
	}

	messages, err := claude.ReadAllMessages(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read messages: %w", err)
	}

	return messages, nil
}

// LoadAgentSessionHistory loads all messages for an agent session
func (h *HistoryManager) LoadAgentSessionHistory(sessionID string) ([]claude.Message, error) {
	filePath := claude.GetAgentSessionFilePath(h.claudeDir, sessionID)

	messages, err := claude.ReadAllMessages(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read agent session messages: %w", err)
	}

	return messages, nil
}

// StreamSessionOutput streams JSONL content via channels
func (h *HistoryManager) StreamSessionOutput(projectID, sessionID string, eventChan chan<- claude.Message, errorChan chan<- error) {
	filePath, err := claude.FindSessionFile(h.claudeDir, projectID, sessionID)
	if err != nil {
		errorChan <- fmt.Errorf("failed to find session file: %w", err)
		close(eventChan)
		close(errorChan)
		return
	}

	claude.StreamMessages(filePath, eventChan, errorChan)
}

// GetSessionFilePath returns the file path for a session
func (h *HistoryManager) GetSessionFilePath(projectID, sessionID string) (string, error) {
	return claude.FindSessionFile(h.claudeDir, projectID, sessionID)
}

// GetAgentSessionFilePath returns the file path for an agent session
func (h *HistoryManager) GetAgentSessionFilePath(sessionID string) string {
	return claude.GetAgentSessionFilePath(h.claudeDir, sessionID)
}
