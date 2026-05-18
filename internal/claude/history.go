// internal/claude/history.go
package claude

import (
	"bufio"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// maxScanCapacity is the maximum buffer size for bufio.Scanner.
// Claude JSONL files can contain very long lines (base64 images, large tool results),
// so we need a generous limit.
const maxScanCapacity = 10 * 1024 * 1024 // 10MB

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
	// Claude replaces both "/" and "." with "-" in the path
	normalized := strings.ReplaceAll(projectPath, "/", "-")
	normalized = strings.ReplaceAll(normalized, ".", "-")
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

// GetSubagentSessionDir returns the directory where Claude stores sidechain subagent JSONL files.
func GetSubagentSessionDir(claudeDir, projectID, sessionID string) string {
	return filepath.Join(claudeDir, "projects", projectID, sessionID, "subagents")
}

func sessionFileReferencesID(filePath, sessionID string) bool {
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

	lineCount := 0
	for scanner.Scan() {
		lineCount++
		var raw map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue
		}
		if raw["session_id"] == sessionID || raw["sessionId"] == sessionID || raw["claude_session_id"] == sessionID {
			return true
		}
		if lineCount >= 50 {
			break
		}
	}

	return false
}

func findSubagentSessionDir(claudeDir, projectID, sessionID string) (string, error) {
	subagentsDir := GetSubagentSessionDir(claudeDir, projectID, sessionID)
	if info, err := os.Stat(subagentsDir); err == nil && info.IsDir() {
		return subagentsDir, nil
	} else if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("failed to stat subagents directory: %w", err)
	}

	projectDir := filepath.Join(claudeDir, "projects", projectID)
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read project directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}

		filePath := filepath.Join(projectDir, entry.Name())
		if sessionFileReferencesID(filePath, sessionID) {
			candidate := filepath.Join(projectDir, strings.TrimSuffix(entry.Name(), ".jsonl"), "subagents")
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				return candidate, nil
			}
		}
	}

	var match string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate := filepath.Join(projectDir, entry.Name(), "subagents")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			if match != "" {
				return "", nil
			}
			match = candidate
		}
	}

	return match, nil
}

// ReadSubagentTranscripts reads all sidechain subagent transcripts for a parent session.
func ReadSubagentTranscripts(claudeDir, projectID, sessionID string) (map[string][]Message, error) {
	subagentsDir, err := findSubagentSessionDir(claudeDir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	if subagentsDir == "" {
		return map[string][]Message{}, nil
	}

	entries, err := os.ReadDir(subagentsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read subagents directory: %w", err)
	}

	transcripts := map[string][]Message{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}

		filePath := filepath.Join(subagentsDir, entry.Name())
		messages, err := ReadAllMessages(filePath)
		if err != nil {
			continue
		}
		if len(messages) == 0 {
			continue
		}

		agentID := messages[0].AgentID
		if agentID == "" {
			agentID = strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "agent-"), ".jsonl")
		}
		transcripts[agentID] = messages
	}

	return transcripts, nil
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

	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

	for scanner.Scan() {
		lineNum++
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

	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

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

// ReadAllMessages reads all messages from a JSONL file.
// For large files (>5MB), only the last 500 messages are returned to avoid
// excessive memory usage and WebSocket transfer overhead.
func ReadAllMessages(filePath string) ([]Message, error) {
	const maxMessages = 500
	const largeSizeThreshold = 5 * 1024 * 1024 // 5MB

	stat, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if stat.Size() > largeSizeThreshold {
		// Large file: count lines first (fast, no JSON parsing), then read last N
		totalLines, err := countLines(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to count lines: %w", err)
		}
		start := totalLines - maxMessages + 1
		if start < 1 {
			start = 1
		}
		return ReadMessagesRange(filePath, start, totalLines)
	}

	// Small file: read all messages
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	messages := []Message{}
	scanner := bufio.NewScanner(file)

	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

	for scanner.Scan() {
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		messages = append(messages, msg)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error scanning file: %w", err)
	}

	return messages, nil
}

// countLines counts the number of lines in a file by counting newline bytes.
// This avoids bufio.Scanner's line-length limits which fail on very long lines.
func countLines(filePath string) (int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	buf := make([]byte, 64*1024)
	count := 0
	for {
		n, err := file.Read(buf)
		for i := 0; i < n; i++ {
			if buf[i] == '\n' {
				count++
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return 0, err
		}
	}
	return count, nil
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

	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

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

// SessionInfo represents metadata about a Claude session
type SessionInfo struct {
	ID               string `json:"id"`
	ProjectID        string `json:"project_id"`
	ProjectPath      string `json:"project_path"`
	CreatedAt        int64  `json:"created_at"`
	MessageTimestamp string `json:"message_timestamp,omitempty"`
	FirstMessage     string `json:"first_message,omitempty"`
}

type ProjectSessionsResult struct {
	Sessions []SessionInfo
	HasMore  bool
}

// ListProjectSessions scans ~/.claude/projects/{projectHash}/ for JSONL session files
// and returns metadata for each session found
func ListProjectSessions(claudeDir, projectPath string) ([]SessionInfo, error) {
	result, err := ListProjectSessionsLimit(claudeDir, projectPath, 0)
	if err != nil {
		return nil, err
	}
	return result.Sessions, nil
}

func ListProjectSessionsLimit(claudeDir, projectPath string, limit int) (ProjectSessionsResult, error) {
	projectHash := GetProjectHash(projectPath)
	projectDir := filepath.Join(claudeDir, "projects", projectHash)

	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		return ProjectSessionsResult{}, nil
	}

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return ProjectSessionsResult{}, fmt.Errorf("failed to read project directory: %w", err)
	}

	type candidate struct {
		name    string
		modTime time.Time
	}
	candidates := make([]candidate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".jsonl") || strings.HasPrefix(name, "agent-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		candidates = append(candidates, candidate{name: name, modTime: info.ModTime()})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].modTime.After(candidates[j].modTime)
	})

	var sessions []SessionInfo
	hasMore := false
	for index, candidate := range candidates {
		name := candidate.name
		sessionID := strings.TrimSuffix(name, ".jsonl")
		filePath := filepath.Join(projectDir, name)

		info, err := extractClaudeSessionInfo(filePath, sessionID, projectHash, projectPath)
		if err != nil {
			// Skip files that can't be parsed
			continue
		}
		sessions = append(sessions, *info)
		if limit > 0 && len(sessions) >= limit {
			hasMore = index+1 < len(candidates)
			break
		}
	}

	return ProjectSessionsResult{Sessions: sessions, HasMore: hasMore}, nil
}

// extractClaudeSessionInfo reads a JSONL file to extract session metadata
// Only reads the first few lines and the file stat for timestamps
func extractClaudeSessionInfo(filePath, sessionID, projectHash, projectPath string) (*SessionInfo, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}

	scanner := bufio.NewScanner(file)
	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)

	var firstTimestamp string
	var firstMessage string
	lineCount := 0
	const maxLinesToScan = 50

	for scanner.Scan() {
		lineCount++

		var raw map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue
		}

		// Capture first timestamp for createdAt
		if firstTimestamp == "" {
			if ts, ok := raw["timestamp"].(string); ok {
				firstTimestamp = ts
			}
		}

		// Look for first user message content
		if firstMessage == "" {
			if msg, ok := raw["message"].(map[string]interface{}); ok {
				if role, _ := msg["role"].(string); role == "user" {
					firstMessage = extractTextContent(msg)
				}
			}
		}

		// Stop scanning after the preview window; title extraction must not read
		// through the whole transcript when early lines contain no user message.
		if lineCount >= maxLinesToScan {
			break
		}
	}

	// If we haven't found a lastTimestamp from scanning (file might be large),
	// use file modification time
	var createdAt int64
	if firstTimestamp != "" {
		if t, err := parseTimestamp(firstTimestamp); err == nil {
			createdAt = t.Unix()
		}
	}
	if createdAt == 0 {
		createdAt = stat.ModTime().Unix()
	}

	// Use file mod time as message_timestamp since it reflects the latest activity
	messageTimestamp := stat.ModTime().UTC().Format("2006-01-02T15:04:05.000Z")

	// Truncate first message
	if len(firstMessage) > 100 {
		firstMessage = firstMessage[:100] + "..."
	}

	return &SessionInfo{
		ID:               sessionID,
		ProjectID:        projectHash,
		ProjectPath:      projectPath,
		CreatedAt:        createdAt,
		MessageTimestamp: messageTimestamp,
		FirstMessage:     firstMessage,
	}, nil
}

// extractTextContent extracts text from a Claude message content field
func extractTextContent(msg map[string]interface{}) string {
	content := msg["content"]
	switch c := content.(type) {
	case string:
		return c
	case []interface{}:
		for _, item := range c {
			if m, ok := item.(map[string]interface{}); ok {
				if t, _ := m["type"].(string); t == "text" {
					if text, ok := m["text"].(string); ok {
						return text
					}
				}
			}
		}
	}
	return ""
}

// parseTimestamp parses an ISO 8601 timestamp string
func parseTimestamp(ts string) (time.Time, error) {
	// Try common formats
	formats := []string{
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05.999Z",
		time.RFC3339,
		time.RFC3339Nano,
	}
	for _, format := range formats {
		if t, err := time.Parse(format, ts); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse timestamp: %s", ts)
}

// ComputeProjectHash computes the MD5 hash of a project path (as used by Claude)
func ComputeProjectHash(projectPath string) string {
	hash := md5.Sum([]byte(projectPath))
	return hex.EncodeToString(hash[:])
}
