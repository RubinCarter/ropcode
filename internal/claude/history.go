// internal/claude/history.go
package claude

import (
	"bufio"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Message represents a single message in the session history
type Message struct {
	ParentUUID  *string                `json:"parentUuid"`
	IsSidechain bool                   `json:"isSidechain"`
	UserType    string                 `json:"userType,omitempty"`
	Cwd         string                 `json:"cwd,omitempty"`
	SessionID   string                 `json:"sessionId,omitempty"`
	Version     string                 `json:"version,omitempty"`
	GitBranch   string                 `json:"gitBranch,omitempty"`
	AgentID     string                 `json:"agentId,omitempty"`
	Message     map[string]interface{} `json:"message,omitempty"`
	Type        string                 `json:"type"`
	UUID        string                 `json:"uuid"`
	Timestamp   string                 `json:"timestamp"`
}

// MessageIndex represents the line number index for messages
type MessageIndex struct {
	LineNumbers []int `json:"line_numbers"`
	TotalLines  int   `json:"total_lines"`
}

// GetProjectHash computes the hash used by Claude for project directory names
func GetProjectHash(projectPath string) string {
	// Claude uses MD5 hash of the project path, then replaces / with -
	normalized := strings.ReplaceAll(projectPath, "/", "-")
	return normalized
}

// GetSessionFilePath returns the full path to a session's JSONL file
func GetSessionFilePath(claudeDir, projectID, sessionID string) string {
	// For regular sessions: ~/.claude/projects/{project_hash}/{session_id}.jsonl
	return filepath.Join(claudeDir, "projects", projectID, sessionID+".jsonl")
}

// GetAgentSessionFilePath returns the full path to an agent session's JSONL file
func GetAgentSessionFilePath(claudeDir, sessionID string) string {
	// For agent sessions: ~/.claude/projects/-Users-{user}/agent-{session_id}.jsonl
	// We need to find the main project directory (typically -Users-username)
	projectsDir := filepath.Join(claudeDir, "projects")

	// Try to find in the main user directory
	homeDir, _ := os.UserHomeDir()
	userHash := GetProjectHash(homeDir)

	return filepath.Join(projectsDir, userHash, "agent-"+sessionID+".jsonl")
}

// BuildMessageIndex scans a JSONL file and builds an index of message line numbers
func BuildMessageIndex(filePath string) (*MessageIndex, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	lineNumbers := []int{}
	lineNum := 0
	scanner := bufio.NewScanner(file)

	// Increase buffer size for potentially large lines
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	for scanner.Scan() {
		lineNum++
		// Every line in a JSONL file is a message
		lineNumbers = append(lineNumbers, lineNum)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error scanning file: %w", err)
	}

	return &MessageIndex{
		LineNumbers: lineNumbers,
		TotalLines:  lineNum,
	}, nil
}

// ReadMessagesRange reads messages from a JSONL file within a specified range
func ReadMessagesRange(filePath string, start, end int) ([]Message, error) {
	if start < 0 || end < start {
		return nil, fmt.Errorf("invalid range: start=%d, end=%d", start, end)
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	messages := []Message{}
	lineNum := 0
	scanner := bufio.NewScanner(file)

	// Increase buffer size for potentially large lines
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	for scanner.Scan() {
		lineNum++

		// Skip lines before start
		if lineNum < start {
			continue
		}

		// Stop if we've reached the end
		if lineNum > end {
			break
		}

		// Parse the JSON line
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			// Skip malformed lines but continue processing
			continue
		}

		messages = append(messages, msg)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error scanning file: %w", err)
	}

	return messages, nil
}

// ReadAllMessages reads all messages from a JSONL file
func ReadAllMessages(filePath string) ([]Message, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	messages := []Message{}
	scanner := bufio.NewScanner(file)

	// Increase buffer size for potentially large lines
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	for scanner.Scan() {
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			// Skip malformed lines but continue processing
			continue
		}

		messages = append(messages, msg)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error scanning file: %w", err)
	}

	return messages, nil
}

// StreamMessages reads messages from a JSONL file and sends them via a channel
func StreamMessages(filePath string, eventChan chan<- Message, errorChan chan<- error) {
	defer close(eventChan)
	defer close(errorChan)

	file, err := os.Open(filePath)
	if err != nil {
		errorChan <- fmt.Errorf("failed to open file: %w", err)
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)

	// Increase buffer size for potentially large lines
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	lineNum := 0
	for scanner.Scan() {
		lineNum++

		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			// Skip malformed lines but continue processing
			continue
		}

		// Send message through channel
		eventChan <- msg
	}

	if err := scanner.Err(); err != nil {
		errorChan <- fmt.Errorf("error scanning file: %w", err)
		return
	}
}

// FindSessionFile tries to find a session file in the Claude directory
func FindSessionFile(claudeDir, projectID, sessionID string) (string, error) {
	// Try the standard path first
	standardPath := GetSessionFilePath(claudeDir, projectID, sessionID)
	if _, err := os.Stat(standardPath); err == nil {
		return standardPath, nil
	}

	// Try agent session path
	agentPath := GetAgentSessionFilePath(claudeDir, sessionID)
	if _, err := os.Stat(agentPath); err == nil {
		return agentPath, nil
	}

	// Try to search in the project directory
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if info, err := os.Stat(projectDir); err == nil && info.IsDir() {
		// List all JSONL files and try to find one matching the session ID
		entries, err := os.ReadDir(projectDir)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".jsonl") {
					// Check if the filename contains the session ID
					if strings.Contains(entry.Name(), sessionID) {
						return filepath.Join(projectDir, entry.Name()), nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("session file not found for session %s in project %s", sessionID, projectID)
}

// ComputeProjectHash computes the MD5 hash of a project path (as used by Claude)
func ComputeProjectHash(projectPath string) string {
	hash := md5.Sum([]byte(projectPath))
	return hex.EncodeToString(hash[:])
}
