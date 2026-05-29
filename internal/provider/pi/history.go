package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/provider"
)

const maxPiHistoryScanFiles = 200

func PiDir() (string, error) {
	if env := strings.TrimSpace(os.Getenv("PI_CODING_AGENT_DIR")); env != "" {
		return env, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".pi", "agent"), nil
}

func projectDirName(projectPath string) string {
	clean := filepath.Clean(strings.TrimSpace(projectPath))
	clean = filepath.ToSlash(clean)
	clean = strings.Trim(clean, "/")
	clean = strings.ReplaceAll(clean, ":", "")
	clean = strings.ReplaceAll(clean, "/", "--")
	return "--" + clean + "--"
}

func FindSessionFile(piDir, sessionID string) (string, error) {
	sessionsDir := filepath.Join(piDir, "sessions")
	var found string
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(info.Name()), ".jsonl") && strings.Contains(info.Name(), sessionID) {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil && err != filepath.SkipAll {
		return "", err
	}
	if found == "" {
		return "", fmt.Errorf("session file not found for session: %s", sessionID)
	}
	return found, nil
}

func ListProjectSessions(piDir, projectPath string) ([]provider.HistorySessionInfo, error) {
	result, err := ListProjectSessionsLimit(piDir, projectPath, 0)
	if err != nil {
		return nil, err
	}
	return result.Sessions, nil
}

func ListProjectSessionsLimit(piDir, projectPath string, limit int) (provider.HistorySessionsResult, error) {
	sessionsDir := filepath.Join(piDir, "sessions", projectDirName(projectPath))
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		return provider.HistorySessionsResult{}, nil
	}

	type candidate struct {
		path    string
		modTime time.Time
	}
	var candidates []candidate
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(info.Name()), ".jsonl") {
			candidates = append(candidates, candidate{path: path, modTime: info.ModTime()})
		}
		return nil
	})
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].modTime.After(candidates[j].modTime)
	})

	var sessions []provider.HistorySessionInfo
	hasMore := false
	for index, candidate := range candidates {
		if limit > 0 && index >= maxPiHistoryScanFiles {
			hasMore = index < len(candidates)
			break
		}
		info, err := extractSessionInfo(candidate.path, projectPath)
		if err != nil {
			continue
		}
		sessions = append(sessions, info)
		if limit > 0 && len(sessions) >= limit {
			hasMore = index+1 < len(candidates)
			break
		}
	}
	return provider.HistorySessionsResult{Sessions: sessions, HasMore: hasMore}, nil
}

func LoadSessionHistory(piDir, projectID, sessionID string) ([]provider.Message, error) {
	entries, err := readHistoryEntries(piDir, sessionID)
	if err != nil {
		return nil, err
	}

	var messages []provider.Message
	for _, raw := range entries {
		msg := historyEntryToMessage(raw, projectID)
		if msg == nil {
			continue
		}
		messages = append(messages, *msg)
	}
	return messages, nil
}

func LoadHistoryEvents(piDir, sessionID string) ([]provider.OutputEvent, error) {
	entries, err := readHistoryEntries(piDir, sessionID)
	if err != nil {
		return nil, err
	}
	driver := &Driver{}
	events := make([]provider.OutputEvent, 0, len(entries))
	for _, raw := range entries {
		data, err := json.Marshal(raw)
		if err != nil {
			continue
		}
		event := driver.ParseOutput(data)
		if event != nil {
			events = append(events, *event)
		}
	}
	return events, nil
}

func GetMessageIndex(piDir, projectID, sessionID string) ([]int, error) {
	messages, err := LoadSessionHistory(piDir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	index := make([]int, len(messages))
	for i := range messages {
		index[i] = i + 1
	}
	return index, nil
}

func GetMessagesRange(piDir, projectID, sessionID string, start, end int) ([]provider.Message, error) {
	messages, err := LoadSessionHistory(piDir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	if start < 1 {
		start = 1
	}
	if end < start {
		return nil, nil
	}
	startIdx := start - 1
	if startIdx >= len(messages) {
		return nil, nil
	}
	if end > len(messages) {
		end = len(messages)
	}
	return messages[startIdx:end], nil
}

func LoadSubagentTranscripts(piDir, sessionID string) (map[string][]provider.Message, error) {
	return map[string][]provider.Message{}, nil
}

func readHistoryEntries(piDir, sessionID string) ([]map[string]interface{}, error) {
	filePath, err := FindSessionFile(piDir, sessionID)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []map[string]interface{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal(line, &raw); err != nil {
			continue
		}
		entries = append(entries, raw)
	}
	return entries, scanner.Err()
}

func extractSessionInfo(path, projectPath string) (provider.HistorySessionInfo, error) {
	entries, err := readHistoryEntriesFromFile(path)
	if err != nil {
		return provider.HistorySessionInfo{}, err
	}
	stat, _ := os.Stat(path)
	createdAt := int64(0)
	messageTimestamp := ""
	if stat != nil {
		createdAt = stat.ModTime().Unix()
		messageTimestamp = stat.ModTime().Format(time.RFC3339)
	}

	id := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	firstMessage := ""
	for _, raw := range entries {
		if sid := sessionIDFromEntry(raw); sid != "" {
			id = sid
		}
		if ts := firstString(raw, "timestamp"); ts != "" {
			messageTimestamp = ts
			if createdAt == 0 {
				if parsed, err := time.Parse(time.RFC3339Nano, ts); err == nil {
					createdAt = parsed.Unix()
				}
			}
		}
		if firstMessage == "" && firstString(raw, "type") == "prompt" {
			firstMessage = strings.TrimSpace(firstString(raw, "message"))
		}
	}

	return provider.HistorySessionInfo{
		ID:               id,
		ProjectID:        projectPath,
		ProjectPath:      projectPath,
		CreatedAt:        createdAt,
		MessageTimestamp: messageTimestamp,
		FirstMessage:     firstMessage,
	}, nil
}

func readHistoryEntriesFromFile(path string) ([]map[string]interface{}, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []map[string]interface{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var raw map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue
		}
		entries = append(entries, raw)
	}
	return entries, scanner.Err()
}

func historyEntryToMessage(raw map[string]interface{}, projectID string) *provider.Message {
	eventType := firstString(raw, "type")
	timestamp := firstString(raw, "timestamp")
	switch eventType {
	case "prompt":
		text := strings.TrimSpace(firstString(raw, "message", "prompt"))
		if text == "" {
			return nil
		}
		return &provider.Message{
			Type:      "user",
			Cwd:       projectID,
			Timestamp: timestamp,
			Message:   textMessage("user", text),
		}
	case "message", "message_update":
		text := strings.TrimSpace(firstString(raw, "content", "delta", "message"))
		if text == "" {
			return nil
		}
		return &provider.Message{
			Type:      "assistant",
			Cwd:       projectID,
			Timestamp: timestamp,
			Message:   textMessage("assistant", text),
		}
	default:
		return nil
	}
}

func textMessage(role, text string) map[string]interface{} {
	return map[string]interface{}{
		"role": role,
		"content": []map[string]interface{}{
			{"type": "text", "text": text},
		},
	}
}

func sessionIDFromEntry(raw map[string]interface{}) string {
	if sid := firstString(raw, "session_id", "sessionId"); sid != "" {
		return sid
	}
	data, ok := raw["data"].(map[string]interface{})
	if !ok {
		return ""
	}
	return firstString(data, "sessionId", "session_id")
}
