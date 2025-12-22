// internal/codex/history.go
package codex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ropcode/internal/claude"
)

// CodexDir returns the default Codex config directory
func CodexDir() (string, error) {
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

// LoadSessionHistory loads the history for a Codex session
func LoadSessionHistory(codexDir, projectID, sessionID string) ([]claude.Message, error) {
	filePath, err := FindSessionFile(codexDir, sessionID)
	if err != nil {
		return nil, err
	}

	log.Printf("[Codex History] Loading session from: %s", filePath)

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open session file: %w", err)
	}
	defer file.Close()

	var messages []claude.Message
	scanner := bufio.NewScanner(file)

	// Increase buffer size for large lines
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var event map[string]interface{}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		// Convert Codex event to Claude message format
		claudeMessages := codexEventToClaudeHistory(event, projectID)
		messages = append(messages, claudeMessages...)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading session file: %w", err)
	}

	log.Printf("[Codex History] Loaded %d messages", len(messages))
	return messages, nil
}

// codexEventToClaudeHistory converts a Codex event to Claude history format
// Based on Tauri version's codex_event_to_claude_history function
func codexEventToClaudeHistory(event map[string]interface{}, projectID string) []claude.Message {
	var messages []claude.Message

	eventType, _ := event["type"].(string)
	timestamp := time.Now().Format(time.RFC3339)

	switch eventType {
	case "item.completed":
		// Process item.completed event - extract item content
		item, ok := event["item"].(map[string]interface{})
		if !ok {
			return messages
		}

		itemType, _ := item["type"].(string)
		if itemType == "" {
			itemType, _ = item["item_type"].(string)
		}

		text, _ := item["text"].(string)
		if text == "" {
			return messages
		}

		switch itemType {
		case "agent_message", "reasoning", "assistant_message":
			msg := claude.Message{
				Type:      "assistant",
				Cwd:       projectID,
				Timestamp: timestamp,
				Message: map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "text", "text": text},
					},
				},
			}
			messages = append(messages, msg)
		}

	case "response_item":
		payload, ok := event["payload"].(map[string]interface{})
		if !ok {
			return messages
		}

		role, _ := payload["role"].(string)
		payloadType, _ := payload["type"].(string)

		switch payloadType {
		case "message":
			if role == "user" {
				// Extract content and normalize type from "input_text" to "text"
				content := normalizeCodexContent(payload, true)
				if len(content) == 0 {
					return messages
				}

				msg := claude.Message{
					Type:      "user",
					Cwd:       projectID,
					Timestamp: timestamp,
					Message: map[string]interface{}{
						"role":    "user",
						"content": content,
					},
				}
				messages = append(messages, msg)

			} else if role == "assistant" {
				// Extract content and normalize type from "output_text" to "text"
				content := normalizeCodexContent(payload, false)

				msg := claude.Message{
					Type:      "assistant",
					Cwd:       projectID,
					Timestamp: timestamp,
					Message: map[string]interface{}{
						"role":    "assistant",
						"content": content,
					},
				}
				messages = append(messages, msg)
			}

		case "reasoning":
			// Extract thinking text from summary
			thinkingText := ""
			if summary, ok := payload["summary"].([]interface{}); ok && len(summary) > 0 {
				if firstItem, ok := summary[0].(map[string]interface{}); ok {
					thinkingText, _ = firstItem["text"].(string)
				}
			}

			if thinkingText != "" {
				msg := claude.Message{
					Type:      "assistant",
					Cwd:       projectID,
					Timestamp: timestamp,
					Message: map[string]interface{}{
						"role": "assistant",
						"content": []map[string]interface{}{
							{
								"type":     "thinking",
								"thinking": thinkingText,
							},
						},
					},
				}
				messages = append(messages, msg)
			}

		case "function_call":
			// Extract tool use information
			name, _ := payload["name"].(string)
			arguments, _ := payload["arguments"].(string)
			callID, _ := payload["call_id"].(string)

			if callID == "" {
				return messages
			}

			// Parse arguments JSON
			var argsValue map[string]interface{}
			if err := json.Unmarshal([]byte(arguments), &argsValue); err != nil {
				argsValue = map[string]interface{}{}
			}

			// Adapt Codex tools to Claude specialized tools
			adaptedName, adaptedInput := adaptCodexToolToClaude(name, argsValue)

			msg := claude.Message{
				Type:      "assistant",
				Cwd:       projectID,
				Timestamp: timestamp,
				Message: map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{
							"type":  "tool_use",
							"id":    callID,
							"name":  adaptedName,
							"input": adaptedInput,
						},
					},
				},
			}
			messages = append(messages, msg)

		case "function_call_output":
			// Extract tool result information
			callID, _ := payload["call_id"].(string)
			output, _ := payload["output"].(string)

			if callID == "" {
				return messages
			}

			// Parse the output which is JSON stringified
			var outputData map[string]interface{}
			if err := json.Unmarshal([]byte(output), &outputData); err == nil {
				if actualOutput, ok := outputData["output"].(string); ok {
					output = actualOutput
				}
			}

			msg := claude.Message{
				Type:      "user",
				Cwd:       projectID,
				Timestamp: timestamp,
				Message: map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{
							"type":        "tool_result",
							"tool_use_id": callID,
							"content":     output,
						},
					},
				},
			}
			messages = append(messages, msg)
		}

	case "thread.started":
		// Session init
		threadID, _ := event["thread_id"].(string)
		msg := claude.Message{
			Type:      "system",
			SessionID: threadID,
			Cwd:       projectID,
			Timestamp: timestamp,
		}
		messages = append(messages, msg)

	case "turn.completed":
		msg := claude.Message{
			Type:      "result",
			Cwd:       projectID,
			Timestamp: timestamp,
		}
		messages = append(messages, msg)

	case "thread.completed", "thread.cancelled", "thread.error":
		success := eventType == "thread.completed"
		msg := claude.Message{
			Type:      "result",
			Cwd:       projectID,
			Timestamp: timestamp,
			Message: map[string]interface{}{
				"success": success,
			},
		}
		messages = append(messages, msg)
	}

	return messages
}

// normalizeCodexContent extracts and normalizes content from Codex payload
func normalizeCodexContent(payload map[string]interface{}, isUser bool) []map[string]interface{} {
	contentArr, ok := payload["content"].([]interface{})
	if !ok {
		return nil
	}

	var normalized []map[string]interface{}
	for _, item := range contentArr {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		itemType, _ := itemMap["type"].(string)
		text, _ := itemMap["text"].(string)

		// Filter out environment context messages for user messages
		if isUser && strings.HasPrefix(text, "<environment_context>") {
			continue
		}

		// Normalize type: input_text/output_text -> text
		if itemType == "input_text" || itemType == "output_text" {
			itemType = "text"
		}

		normalized = append(normalized, map[string]interface{}{
			"type": itemType,
			"text": text,
		})
	}

	return normalized
}

// adaptCodexToolToClaude maps Codex tool names and parameters to Claude format
func adaptCodexToolToClaude(toolName string, args map[string]interface{}) (string, interface{}) {
	switch toolName {
	case "shell", "shell_command":
		// Check if it's actually a read/write operation
		command, _ := args["command"].(string)

		// Check for cat commands -> Read
		if strings.HasPrefix(command, "cat ") {
			filePath := strings.TrimPrefix(command, "cat ")
			filePath = strings.TrimSpace(filePath)
			return "Read", map[string]interface{}{"file_path": filePath}
		}

		// Check for echo/cat with redirect -> Write
		if strings.Contains(command, " > ") || strings.Contains(command, " >> ") {
			return "Write", map[string]interface{}{"command": command}
		}

		return "Bash", map[string]interface{}{"command": command}

	case "update_plan":
		// Adapt update_plan to TodoWrite format
		if tasks, ok := args["tasks"].([]interface{}); ok {
			convertedTodos := make([]map[string]interface{}, 0, len(tasks))
			for _, task := range tasks {
				if taskMap, ok := task.(map[string]interface{}); ok {
					description, _ := taskMap["description"].(string)
					status, _ := taskMap["status"].(string)
					if status == "" {
						status = "pending"
					}
					activeForm := generateActiveForm(description)
					convertedTodos = append(convertedTodos, map[string]interface{}{
						"content":    description,
						"status":     status,
						"activeForm": activeForm,
					})
				}
			}
			return "TodoWrite", map[string]interface{}{"todos": convertedTodos}
		}
		return "TodoWrite", args

	case "apply_patch":
		return "Edit", args

	default:
		return toolName, args
	}
}

// SessionInfo represents basic information about a Codex session
type SessionInfo struct {
	ID               string `json:"id"`
	ProjectID        string `json:"project_id"`
	ProjectPath      string `json:"project_path"`
	CreatedAt        int64  `json:"created_at"`
	MessageTimestamp string `json:"message_timestamp,omitempty"`
}

// ListProjectSessions lists all sessions for a specific project path
// It scans the ~/.codex/sessions directory structure and extracts session info
func ListProjectSessions(codexDir, projectPath string) ([]SessionInfo, error) {
	sessionsDir := filepath.Join(codexDir, "sessions")

	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		log.Printf("[Codex History] Sessions directory does not exist: %s", sessionsDir)
		return []SessionInfo{}, nil
	}

	var sessions []SessionInfo

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

		// Extract session info from the file
		sessionInfo, err := extractSessionInfo(path, projectPath)
		if err != nil {
			// Skip files that can't be parsed
			return nil
		}

		// Only include sessions that match the project path
		if sessionInfo != nil {
			sessions = append(sessions, *sessionInfo)
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking sessions directory: %w", err)
	}

	log.Printf("[Codex History] Found %d sessions for project: %s", len(sessions), projectPath)
	return sessions, nil
}

// extractSessionInfo extracts session info from a Codex session file
// Returns nil if the session doesn't match the project path
func extractSessionInfo(filePath, targetProjectPath string) (*SessionInfo, error) {
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

	// Read only enough lines to extract session metadata
	lineCount := 0
	for scanner.Scan() && lineCount < 100 { // Limit to first 100 lines for performance
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

		// Extract session ID from thread.started event
		if eventType == "thread.started" {
			if threadID, ok := event["thread_id"].(string); ok {
				sessionID = threadID
			}
			// Try to get timestamp
			if ts, ok := event["timestamp"].(string); ok {
				lastTimestamp = ts
				if t, err := time.Parse(time.RFC3339, ts); err == nil {
					createdAt = t.Unix()
				}
			}
		}

		// Extract project path from response_item with user message
		if eventType == "response_item" {
			if payload, ok := event["payload"].(map[string]interface{}); ok {
				if role, _ := payload["role"].(string); role == "user" {
					// Try to get cwd from the event
					if cwd, ok := event["cwd"].(string); ok && cwd != "" {
						sessionProjectPath = cwd
					}
				}
			}
		}

		// Also check for cwd in top-level event
		if cwd, ok := event["cwd"].(string); ok && cwd != "" && sessionProjectPath == "" {
			sessionProjectPath = cwd
		}

		// Update last timestamp
		if ts, ok := event["timestamp"].(string); ok && ts != "" {
			lastTimestamp = ts
		}
	}

	// If we couldn't find the session ID from thread.started, extract from filename
	// Filename format: rollout-YYYY-MM-DDTHH-MM-SS-{session_id}.jsonl
	if sessionID == "" {
		baseName := filepath.Base(filePath)
		// Try to extract session ID from filename
		parts := strings.Split(baseName, "-")
		if len(parts) >= 7 {
			// Last part before .jsonl is the session ID
			lastPart := parts[len(parts)-1]
			sessionID = strings.TrimSuffix(lastPart, ".jsonl")
		}
	}

	// If we still don't have a session ID, use file modification time as fallback
	if sessionID == "" {
		return nil, fmt.Errorf("could not extract session ID from file: %s", filePath)
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
		if sessionProjectPath == "" {
			// Cannot determine project path from session file - skip to avoid mixing sessions
			log.Printf("[Codex History] Skipping session %s: cannot determine project path", sessionID)
			return nil, nil
		}
		if sessionProjectPath != targetProjectPath {
			// Session belongs to a different project - skip
			return nil, nil
		}
	}

	return &SessionInfo{
		ID:               sessionID,
		ProjectID:        sessionProjectPath,
		ProjectPath:      sessionProjectPath,
		CreatedAt:        createdAt,
		MessageTimestamp: lastTimestamp,
	}, nil
}

// generateActiveForm generates activeForm from a task description
// Converts imperative form to present continuous (e.g., "Create file" -> "Creating file")
func generateActiveForm(description string) string {
	trimmed := strings.TrimSpace(description)
	if trimmed == "" {
		return ""
	}

	// Find the first word (verb) and try to convert to present continuous
	parts := strings.SplitN(trimmed, " ", 2)
	firstWord := parts[0]
	rest := ""
	if len(parts) > 1 {
		rest = parts[1]
	}

	// Common verb conversions
	verbMap := map[string]string{
		"create":    "Creating",
		"add":       "Adding",
		"update":    "Updating",
		"fix":       "Fixing",
		"remove":    "Removing",
		"delete":    "Deleting",
		"implement": "Implementing",
		"write":     "Writing",
		"read":      "Reading",
		"build":     "Building",
		"test":      "Testing",
		"run":       "Running",
		"check":     "Checking",
		"install":   "Installing",
		"configure": "Configuring",
		"setup":     "Setting up",
		"set":       "Setting up",
		"modify":    "Modifying",
		"refactor":  "Refactoring",
		"debug":     "Debugging",
		"analyze":   "Analyzing",
		"review":    "Reviewing",
		"merge":     "Merging",
		"deploy":    "Deploying",
		"migrate":   "Migrating",
		"optimize":  "Optimizing",
		"validate":  "Validating",
		"verify":    "Verifying",
		"ensure":    "Ensuring",
	}

	lowerWord := strings.ToLower(firstWord)
	if activeVerb, ok := verbMap[lowerWord]; ok {
		if rest != "" {
			return activeVerb + " " + rest
		}
		return activeVerb
	}

	// For unknown verbs, try to add "ing" suffix
	if strings.HasSuffix(firstWord, "e") && !strings.HasSuffix(firstWord, "ee") {
		base := firstWord[:len(firstWord)-1]
		if rest != "" {
			return base + "ing " + rest
		}
		return base + "ing"
	} else if len(firstWord) > 2 {
		if rest != "" {
			return firstWord + "ing " + rest
		}
		return firstWord + "ing"
	}

	return trimmed
}
