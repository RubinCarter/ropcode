// internal/codex/history.go
package codex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/provider"

)

// CodexDir returns the Codex config directory. Honours $CODEX_HOME (set by
// the Codex CLI itself for Windows/Mac/Linux users who want a non-default
// location); otherwise falls back to ~/.codex on every platform.
func CodexDir() (string, error) {
	if env := strings.TrimSpace(os.Getenv("CODEX_HOME")); env != "" {
		return env, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}

// FindSessionFile searches for a session file in the Codex sessions directory
// Codex stores sessions in ~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-{session_id}.jsonl
func FindSessionFile(codexDir, sessionID string) (string, error) {
	sessionsDir := filepath.Join(codexDir, "sessions")

	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		return "", fmt.Errorf("sessions directory does not exist: %s", sessionsDir)
	}

	var foundPath string

	// Walk through YYYY/MM/DD directory structure
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if info.IsDir() {
			return nil
		}

		// Check if filename contains session ID
		if strings.Contains(info.Name(), sessionID) && strings.HasSuffix(info.Name(), ".jsonl") {
			foundPath = path
			return filepath.SkipAll // Stop walking
		}
		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return "", fmt.Errorf("error walking sessions directory: %w", err)
	}

	if foundPath == "" {
		return "", fmt.Errorf("session file not found for session: %s", sessionID)
	}

	return foundPath, nil
}

// LoadHistoryEvents reads a Codex session JSONL and returns normalized OutputEvents
// with cross-event state tracking (spawn → agent_id mapping for subagent association).
// This is the single source of truth for stateful history normalization.
func LoadHistoryEvents(codexDir, sessionID string) ([]provider.OutputEvent, error) {
	filePath, err := FindSessionFile(codexDir, sessionID)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open session file: %w", err)
	}
	defer file.Close()

	var events []provider.OutputEvent
	threadToSpawn := map[string]string{}
	lsCallIDs := map[string]bool{}
	lastSpawnCallID := ""
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		// Track spawn_agent → agent_id mapping and ls call_ids
		if str(raw, "type") == "response_item" {
			payload := mval(raw["payload"])
			if str(payload, "type") == "function_call" {
				name := str(payload, "name")
				callID := str(payload, "call_id")
				if name == "spawn_agent" {
					lastSpawnCallID = callID
				} else if name == "exec_command" {
					argsStr := str(payload, "arguments")
					var args map[string]interface{}
					if json.Unmarshal([]byte(argsStr), &args) == nil {
						cmd, _ := args["cmd"].(string)
						if cmd == "" {
							cmd, _ = args["command"].(string)
						}
						// Strip cd prefix
						if idx := strings.Index(cmd, " && "); idx > 0 && strings.HasPrefix(cmd, "cd ") {
							cmd = cmd[idx+4:]
						}
						if strings.HasPrefix(cmd, "ls") {
							lsCallIDs[callID] = true
						}
					}
				}
			} else if str(payload, "type") == "function_call_output" && lastSpawnCallID != "" {
				output := str(payload, "output")
				var outputObj map[string]interface{}
				if json.Unmarshal([]byte(output), &outputObj) == nil {
					if agentID, ok := outputObj["agent_id"].(string); ok && agentID != "" {
						threadToSpawn[agentID] = lastSpawnCallID
					}
				}
				lastSpawnCallID = ""
			} else if str(payload, "type") != "function_call" {
				lastSpawnCallID = ""
			}
		}

		ev := NormalizeHistoryEntry(raw)

		// Fix parent_tool_use_id for subagent_notification using state map
		if ev.Message != nil {
			if parentID, _ := ev.Message["parent_tool_use_id"].(string); parentID != "" {
				if spawnID, ok := threadToSpawn[parentID]; ok {
					ev.Message["parent_tool_use_id"] = spawnID
				}
			}
		}

		// Format LS tool_result content as directory tree
		if ev.Type == "user" && ev.Message != nil {
			if inner, ok := ev.Message["message"].(map[string]interface{}); ok {
				if content, ok := inner["content"].([]interface{}); ok && len(content) > 0 {
					if block, ok := content[0].(map[string]interface{}); ok {
						if block["type"] == "tool_result" {
							if toolUseID, _ := block["tool_use_id"].(string); lsCallIDs[toolUseID] {
								if text, _ := block["content"].(string); text != "" {
									block["content"] = formatDirectoryListing(text)
								}
							}
						}
					}
				}
			}
		}

		events = append(events, ev)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading session file: %w", err)
	}
	return events, nil
}

// LoadSessionHistory loads history as []Message by converting OutputEvents.
func LoadSessionHistory(codexDir, projectID, sessionID string) ([]provider.Message, error) {
	events, err := LoadHistoryEvents(codexDir, sessionID)
	if err != nil {
		return nil, err
	}

	log.Printf("[Codex History] Converting %d events to messages", len(events))

	messages := make([]provider.Message, 0, len(events))
	for _, ev := range events {
		if ev.Message == nil {
			continue
		}

		isSidechain, _ := ev.Message["isSidechain"].(bool)
		msgContent := ev.Message
		if inner, ok := ev.Message["message"].(map[string]interface{}); ok {
			msgContent = inner
		}
		if _, hasParent := ev.Message["parent_tool_use_id"]; hasParent {
			msgContent["parent_tool_use_id"] = ev.Message["parent_tool_use_id"]
			isSidechain = true
		}
		if isSidechain {
			msgContent["isSidechain"] = true
		}

		parentToolUseID, _ := ev.Message["parent_tool_use_id"].(string)

		msg := provider.Message{
			Type:            ev.Type,
			IsSidechain:     isSidechain,
			ParentToolUseID: parentToolUseID,
			Cwd:             projectID,
			Timestamp:       str(ev.Message, "timestamp"),
			Message:         msgContent,
		}
		messages = append(messages, msg)
	}

	log.Printf("[Codex History] Loaded %d messages", len(messages))
	return messages, nil
}

// LoadSubagentTranscripts extracts subagent responses from the session JSONL.
// Returns a map of spawn_call_id → subagent messages (extracted from subagent_notification).
func LoadSubagentTranscripts(codexDir, sessionID string) (map[string][]provider.Message, error) {
	filePath, err := FindSessionFile(codexDir, sessionID)
	if err != nil {
		return map[string][]provider.Message{}, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return map[string][]provider.Message{}, nil
	}
	defer file.Close()

	// First pass: build spawn_call_id → agent_id mapping
	threadToSpawn := map[string]string{}
	lastSpawnCallID := ""
	var notifications []map[string]interface{}

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		if str(raw, "type") == "response_item" {
			payload := mval(raw["payload"])
			if str(payload, "type") == "function_call" && str(payload, "name") == "spawn_agent" {
				lastSpawnCallID = str(payload, "call_id")
			} else if str(payload, "type") == "function_call_output" && lastSpawnCallID != "" {
				output := str(payload, "output")
				var outputObj map[string]interface{}
				if json.Unmarshal([]byte(output), &outputObj) == nil {
					if agentID, ok := outputObj["agent_id"].(string); ok && agentID != "" {
						threadToSpawn[agentID] = lastSpawnCallID
					}
				}
				lastSpawnCallID = ""
			} else if str(payload, "type") != "function_call" {
				lastSpawnCallID = ""
			}

			// Detect subagent_notification in user messages
			if str(payload, "type") == "message" && str(payload, "role") == "user" {
				text := payloadText(payload)
				if strings.Contains(text, "<subagent_notification>") {
					notifications = append(notifications, raw)
				}
			}
		}
	}

	// Build transcripts from notifications
	transcripts := map[string][]provider.Message{}
	for _, raw := range notifications {
		payload := mval(raw["payload"])
		text := payloadText(payload)
		parsed := parseSubagentNotification(text)
		if parsed == nil {
			continue
		}
		agentPath, _ := parsed["parent_tool_use_id"].(string)
		spawnID := agentPath
		if mapped, ok := threadToSpawn[agentPath]; ok {
			spawnID = mapped
		}
		if spawnID == "" {
			continue
		}

		inner, _ := parsed["message"].(map[string]any)
		if inner == nil {
			continue
		}

		msg := provider.Message{
			Type:    "assistant",
			Message: inner,
		}
		transcripts[spawnID] = append(transcripts[spawnID], msg)
	}

	return transcripts, nil
}

// ReadAllHistoryEntries reads Codex JSONL history and returns raw entries for frame conversion.
func ReadAllHistoryEntries(codexDir, sessionID string) ([]map[string]interface{}, error) {
	filePath, err := FindSessionFile(codexDir, sessionID)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open session file: %w", err)
	}
	defer file.Close()

	var entries []map[string]interface{}
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}
		entries = append(entries, raw)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading session file: %w", err)
	}
	return entries, nil
}

var maxLimitedProjectSessionScanFiles = 200

const maxSessionTitleScanLines = 20

// ListProjectSessions lists all sessions for a specific project path
// It scans the ~/.codex/sessions directory structure and extracts session info
func ListProjectSessions(codexDir, projectPath string) ([]provider.HistorySessionInfo, error) {
	result, err := ListProjectSessionsLimit(codexDir, projectPath, 0)
	if err != nil {
		return nil, err
	}
	return result.Sessions, nil
}

func ListProjectSessionsLimit(codexDir, projectPath string, limit int) (provider.HistorySessionsResult, error) {
	sessionsDir := filepath.Join(codexDir, "sessions")

	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		log.Printf("[Codex History] Sessions directory does not exist: %s", sessionsDir)
		return provider.HistorySessionsResult{}, nil
	}

	type candidate struct {
		path    string
		modTime time.Time
	}
	candidates := make([]candidate, 0)

	// Walk through YYYY/MM/DD directory structure
	err := filepath.Walk(sessionsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if info.IsDir() {
			return nil
		}

		// Only process .jsonl files
		if !strings.HasSuffix(info.Name(), ".jsonl") {
			return nil
		}
		candidates = append(candidates, candidate{path: path, modTime: info.ModTime()})
		return nil
	})

	if err != nil {
		return provider.HistorySessionsResult{}, fmt.Errorf("error walking sessions directory: %w", err)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].modTime.After(candidates[j].modTime)
	})

	var sessions []provider.HistorySessionInfo
	hasMore := false
	for index, candidate := range candidates {
		if limit > 0 && index >= maxLimitedProjectSessionScanFiles {
			hasMore = index < len(candidates)
			break
		}
		// Extract session info from the file
		sessionInfo, err := extractSessionInfo(candidate.path, projectPath)
		if err != nil {
			// Skip files that can't be parsed
			continue
		}

		// Only include sessions that match the project path
		if sessionInfo != nil {
			sessions = append(sessions, *sessionInfo)
			if limit > 0 && len(sessions) >= limit {
				hasMore = index+1 < len(candidates)
				break
			}
		}
	}

	log.Printf("[Codex History] Found %d sessions for project: %s", len(sessions), projectPath)
	return provider.HistorySessionsResult{Sessions: sessions, HasMore: hasMore}, nil
}

// extractSessionInfo extracts session info from a Codex session file
// Returns nil if the session doesn't match the project path
func extractSessionInfo(filePath, targetProjectPath string) (*provider.HistorySessionInfo, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	var sessionID string
	var sessionProjectPath string
	var createdAt int64
	var lastTimestamp string
	var firstMessage string

	// Read only enough lines to extract session metadata
	lineCount := 0
	for scanner.Scan() && lineCount < maxSessionTitleScanLines {
		line := scanner.Text()
		if line == "" {
			continue
		}
		lineCount++

		var event map[string]interface{}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)

		if eventType == "session_meta" {
			payload, ok := event["payload"].(map[string]interface{})
			if !ok {
				continue
			}
			sessionID, _ = payload["id"].(string)
			sessionProjectPath, _ = payload["cwd"].(string)
			if targetProjectPath != "" && sessionProjectPath != "" && !sameCodexProjectPath(sessionProjectPath, targetProjectPath) {
				return nil, nil
			}
			if ts, ok := payload["timestamp"].(string); ok && ts != "" {
				if t, err := time.Parse(time.RFC3339, ts); err == nil {
					createdAt = t.Unix()
				}
			}
		}

		if eventType == "response_item" && firstMessage == "" {
			payload, ok := event["payload"].(map[string]interface{})
			if !ok {
				continue
			}
			payloadType, _ := payload["type"].(string)
			role, _ := payload["role"].(string)
			if payloadType == "message" && role == "user" {
				firstMessage = extractFirstUserText(payload)
			}
		}

		// Update last timestamp
		if ts, ok := event["timestamp"].(string); ok && ts != "" {
			lastTimestamp = ts
		}
	}

	if sessionID == "" {
		return nil, fmt.Errorf("could not extract session_meta payload id from file: %s", filePath)
	}

	// Get file modification time as fallback for createdAt
	if createdAt == 0 {
		if fileInfo, err := os.Stat(filePath); err == nil {
			createdAt = fileInfo.ModTime().Unix()
		}
	}

	// Check if this session matches the target project path
	// Only return sessions that explicitly match the target project
	if targetProjectPath != "" {
		if !sameCodexProjectPath(sessionProjectPath, targetProjectPath) {
			// Session belongs to a different project - skip
			return nil, nil
		}
	}

	return &provider.HistorySessionInfo{
		ID:               sessionID,
		ProjectID:        sessionProjectPath,
		ProjectPath:      sessionProjectPath,
		CreatedAt:        createdAt,
		MessageTimestamp: lastTimestamp,
		FirstMessage:     firstMessage,
	}, nil
}

func sameCodexProjectPath(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	return strings.EqualFold(a, b)
}

func extractFirstUserText(payload map[string]interface{}) string {
	contentArr, ok := payload["content"].([]interface{})
	if !ok {
		return ""
	}
	for _, item := range contentArr {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		text, _ := itemMap["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" || isInjectedCodexUserContext(text) {
			continue
		}
		return text
	}
	return ""
}

func isInjectedCodexUserContext(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return true
	}
	if strings.HasPrefix(trimmed, "<environment_context>") {
		return true
	}
	if strings.Contains(trimmed, " instructions for ") && strings.Contains(trimmed, "<INSTRUCTIONS>") {
		return true
	}
	return false
}

