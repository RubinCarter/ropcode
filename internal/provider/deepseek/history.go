package deepseek

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/provider"
	"ropcode/internal/stream"
)

func DeepSeekDir() (string, error) {
	if env := strings.TrimSpace(os.Getenv("DEEPSEEK_HOME")); env != "" {
		return env, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".deepseek"), nil
}

func LoadSessionHistory(deepseekDir, projectID, sessionID string) ([]provider.Message, error) {
	path, err := findSessionJSON(deepseekDir, sessionID)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read deepseek session: %w", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse deepseek session: %w", err)
	}
	return deepseekSessionToMessages(raw, projectID), nil
}

// LoadSessionHistoryFrames loads DeepSeek JSON history as stable frontend session frames.
func LoadSessionHistoryFrames(deepseekDir, projectPath, sessionID string) ([]stream.SessionFrame, error) {
	path, err := findSessionJSON(deepseekDir, sessionID)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read deepseek session: %w", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse deepseek session: %w", err)
	}
	return stream.AdaptDeepSeekHistoryDocument(stream.ProviderOutputContext{
		RuntimeSessionID: sessionID,
		ProjectPath:      projectPath,
	}, raw, 1)
}

func findSessionJSON(deepseekDir, sessionID string) (string, error) {
	sessionsDir := filepath.Join(deepseekDir, "sessions")
	var found string
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if strings.Contains(info.Name(), sessionID) && strings.HasSuffix(strings.ToLower(info.Name()), ".json") {
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

func deepseekSessionToMessages(raw map[string]interface{}, projectID string) []provider.Message {
	var messages []provider.Message
	timestamp := time.Now().Format(time.RFC3339)

	candidates := [][]interface{}{}
	for _, key := range []string{"messages", "turns", "items"} {
		if values, ok := raw[key].([]interface{}); ok {
			candidates = append(candidates, values)
		}
	}
	for _, values := range candidates {
		for _, item := range values {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			role, _ := itemMap["role"].(string)
			if role == "" {
				role, _ = itemMap["type"].(string)
			}
			content := textFromHistoryItem(itemMap)
			if strings.TrimSpace(content) == "" {
				continue
			}
			msgType := "assistant"
			if role == "user" || role == "user_message" {
				msgType = "user"
			}
			if msgType == "assistant" && appendTextToLastAssistant(messages, content) {
				continue
			}
			messages = append(messages, provider.Message{
				Type:      msgType,
				Cwd:       projectID,
				Timestamp: timestamp,
				Message: map[string]interface{}{
					"role": msgType,
					"content": []map[string]interface{}{
						{"type": "text", "text": content},
					},
				},
			})
		}
	}
	return messages
}

func appendTextToLastAssistant(messages []provider.Message, text string) bool {
	if len(messages) == 0 || text == "" {
		return false
	}
	last := &messages[len(messages)-1]
	if last.Type != "assistant" || last.Message == nil {
		return false
	}
	content, ok := last.Message["content"].([]map[string]interface{})
	if !ok || len(content) == 0 {
		return false
	}
	lastBlock := content[len(content)-1]
	if lastBlock["type"] != "text" {
		return false
	}
	existing, _ := lastBlock["text"].(string)
	lastBlock["text"] = existing + text
	return true
}

func textFromHistoryItem(item map[string]interface{}) string {
	for _, key := range []string{"content", "text", "detail", "summary", "prompt"} {
		if text, ok := item[key].(string); ok && strings.TrimSpace(text) != "" {
			return cleanHistoryText(text)
		}
	}
	if content, ok := item["content"].([]interface{}); ok {
		var parts []string
		for _, block := range content {
			if blockMap, ok := block.(map[string]interface{}); ok {
				if text, ok := blockMap["text"].(string); ok && strings.TrimSpace(text) != "" {
					if cleaned := cleanHistoryText(text); cleaned != "" {
						parts = append(parts, cleaned)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func cleanHistoryText(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "<turn_meta>") {
		if end := strings.Index(text, "</turn_meta>"); end >= 0 {
			text = strings.TrimSpace(text[end+len("</turn_meta>"):])
		} else {
			return ""
		}
	}
	return text
}

func ListProjectSessions(deepseekDir, projectPath string) ([]provider.HistorySessionInfo, error) {
	result, err := ListProjectSessionsLimit(deepseekDir, projectPath, 0)
	if err != nil {
		return nil, err
	}
	return result.Sessions, nil
}

func ListProjectSessionsLimit(deepseekDir, projectPath string, limit int) (provider.HistorySessionsResult, error) {
	sessionsDir := filepath.Join(deepseekDir, "sessions")
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		log.Printf("[DeepSeek History] Sessions directory does not exist: %s", sessionsDir)
		return provider.HistorySessionsResult{}, nil
	}

	type candidate struct {
		path    string
		modTime time.Time
	}
	var cands []candidate
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(info.Name()), ".json") {
			cands = append(cands, candidate{path: path, modTime: info.ModTime()})
		}
		return nil
	})
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	sort.SliceStable(cands, func(i, j int) bool {
		return cands[i].modTime.After(cands[j].modTime)
	})

	var sessions []provider.HistorySessionInfo
	hasMore := false
	for index, c := range cands {
		if limit > 0 && index >= 200 {
			hasMore = index < len(cands)
			break
		}
		info, err := extractDeepseekSessionInfo(c.path, projectPath)
		if err != nil || info == nil {
			continue
		}
		sessions = append(sessions, *info)
		if limit > 0 && len(sessions) >= limit {
			hasMore = index+1 < len(cands)
			break
		}
	}
	return provider.HistorySessionsResult{Sessions: sessions, HasMore: hasMore}, nil
}

func extractDeepseekSessionInfo(path, targetProjectPath string) (*provider.HistorySessionInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	meta := objectMap(raw, "metadata", "meta")
	id := firstString(raw, "id", "session_id", "sessionId")
	if id == "" {
		id = firstString(meta, "id", "session_id", "sessionId")
	}
	if id == "" {
		id = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	workspace := firstString(raw, "workspace", "cwd", "project_path", "projectPath")
	if workspace == "" {
		workspace = firstString(meta, "workspace", "cwd", "project_path", "projectPath")
	}
	if targetProjectPath != "" && workspace != "" && !sameProjectPath(workspace, targetProjectPath) {
		return nil, nil
	}
	if targetProjectPath != "" && workspace == "" {
		return nil, nil
	}
	stat, _ := os.Stat(path)
	createdAt := int64(0)
	if stat != nil {
		createdAt = stat.ModTime().Unix()
	}
	if created := firstString(raw, "created_at", "createdAt", "timestamp"); created == "" {
		if created = firstString(meta, "created_at", "createdAt", "timestamp"); created != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, created); err == nil {
				createdAt = parsed.Unix()
			}
		}
	} else {
		if parsed, err := time.Parse(time.RFC3339, created); err == nil {
			createdAt = parsed.Unix()
		}
	}
	messageTimestamp := time.Unix(createdAt, 0).Format(time.RFC3339)
	if updated := firstString(raw, "updated_at", "updatedAt", "message_timestamp", "messageTimestamp"); updated == "" {
		updated = firstString(meta, "updated_at", "updatedAt", "message_timestamp", "messageTimestamp")
		if parsed, err := time.Parse(time.RFC3339Nano, updated); err == nil {
			messageTimestamp = parsed.Format(time.RFC3339)
		}
	} else if parsed, err := time.Parse(time.RFC3339Nano, updated); err == nil {
		messageTimestamp = parsed.Format(time.RFC3339)
	}

	firstMessage := ""
	for _, msg := range deepseekSessionToMessages(raw, workspace) {
		if msg.Type == "user" {
			if content, ok := msg.Message["content"].([]map[string]interface{}); ok && len(content) > 0 {
				firstMessage, _ = content[0]["text"].(string)
			}
			break
		}
	}
	if firstMessage == "" {
		firstMessage = strings.TrimSpace(firstString(meta, "title", "summary"))
	}

	return &provider.HistorySessionInfo{
		ID:               id,
		ProjectID:        workspace,
		ProjectPath:      workspace,
		CreatedAt:        createdAt,
		MessageTimestamp: messageTimestamp,
		FirstMessage:     firstMessage,
	}, nil
}

func objectMap(raw map[string]interface{}, keys ...string) map[string]interface{} {
	for _, key := range keys {
		if value, ok := raw[key].(map[string]interface{}); ok {
			return value
		}
	}
	return nil
}

func firstString(raw map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func sameProjectPath(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	return strings.EqualFold(a, b)
}
