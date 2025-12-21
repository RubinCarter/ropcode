// internal/gemini/history.go
package gemini

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ropcode/internal/claude"
)

// GeminiDir returns the default Gemini config directory
func GeminiDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".gemini"), nil
}

// FindSessionFile searches for a session file in the Gemini sessions directory
// Gemini stores sessions in ~/.gemini/tmp/{project_hash}/chats/session-{session_id}.json
func FindSessionFile(geminiDir, projectID, sessionID string) (string, error) {
	tmpDir := filepath.Join(geminiDir, "tmp")

	if _, err := os.Stat(tmpDir); os.IsNotExist(err) {
		return "", fmt.Errorf("tmp directory does not exist: %s", tmpDir)
	}

	var foundPath string

	// Walk through project directories
	err := filepath.Walk(tmpDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if info.IsDir() {
			return nil
		}

		// Only look at .json files in chats directories
		if !strings.HasSuffix(info.Name(), ".json") {
			return nil
		}

		// Check if this is a session file containing our session ID
		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		var data map[string]interface{}
		if err := json.Unmarshal(content, &data); err != nil {
			return nil
		}

		// Check if sessionId matches
		if sid, ok := data["sessionId"].(string); ok && sid == sessionID {
			foundPath = path
			return filepath.SkipAll
		}

		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return "", fmt.Errorf("error walking tmp directory: %w", err)
	}

	if foundPath == "" {
		return "", fmt.Errorf("session file not found for session: %s", sessionID)
	}

	return foundPath, nil
}

// LoadSessionHistory loads the history for a Gemini session
func LoadSessionHistory(geminiDir, projectID, sessionID string) ([]claude.Message, error) {
	filePath, err := FindSessionFile(geminiDir, projectID, sessionID)
	if err != nil {
		return nil, err
	}

	log.Printf("[Gemini History] Loading session from: %s", filePath)

	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read session file: %w", err)
	}

	var sessionData map[string]interface{}
	if err := json.Unmarshal(content, &sessionData); err != nil {
		return nil, fmt.Errorf("failed to parse session file: %w", err)
	}

	var messages []claude.Message
	timestamp := time.Now().Format(time.RFC3339)

	// Extract messages from the session data
	messagesData, ok := sessionData["messages"].([]interface{})
	if !ok {
		log.Printf("[Gemini History] No messages found in session data")
		return messages, nil
	}

	for _, msgData := range messagesData {
		msgMap, ok := msgData.(map[string]interface{})
		if !ok {
			continue
		}

		claudeMessages := geminiSessionMessageToClaudeHistory(msgMap, projectID, timestamp)
		messages = append(messages, claudeMessages...)
	}

	log.Printf("[Gemini History] Loaded %d messages", len(messages))
	return messages, nil
}

// geminiSessionMessageToClaudeHistory converts a Gemini session message to Claude history format
// Based on Tauri version's gemini_session_message_to_claude_history function
func geminiSessionMessageToClaudeHistory(msgMap map[string]interface{}, projectID, timestamp string) []claude.Message {
	var messages []claude.Message

	msgType, _ := msgMap["type"].(string)
	content, _ := msgMap["content"].(string)

	switch msgType {
	case "user":
		// Extract actual user message (remove system_instruction parts if present)
		userText := extractUserMessageFromText(content)
		if strings.TrimSpace(userText) == "" {
			return messages
		}

		msg := claude.Message{
			Type:      "user",
			Cwd:       projectID,
			Timestamp: timestamp,
			Message: map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": userText},
				},
			},
		}
		messages = append(messages, msg)

	case "gemini":
		var contentBlocks []map[string]interface{}

		// 1. Process thoughts (thinking process) -> thinking blocks
		if thoughts, ok := msgMap["thoughts"].([]interface{}); ok {
			for _, thought := range thoughts {
				if thoughtMap, ok := thought.(map[string]interface{}); ok {
					if description, ok := thoughtMap["description"].(string); ok && strings.TrimSpace(description) != "" {
						contentBlocks = append(contentBlocks, map[string]interface{}{
							"type":     "thinking",
							"thinking": description,
						})
					}
				}
			}
		}

		// 2. Add main text content if not empty
		if strings.TrimSpace(content) != "" {
			contentBlocks = append(contentBlocks, map[string]interface{}{
				"type": "text",
				"text": content,
			})
		}

		// If there's any non-tool content, send assistant message first
		if len(contentBlocks) > 0 {
			msg := claude.Message{
				Type:      "assistant",
				Cwd:       projectID,
				Timestamp: timestamp,
				Message: map[string]interface{}{
					"role":    "assistant",
					"content": contentBlocks,
				},
			}
			messages = append(messages, msg)
		}

		// 3. Process toolCalls array
		if toolCalls, ok := msgMap["toolCalls"].([]interface{}); ok {
			for _, tc := range toolCalls {
				toolCall, ok := tc.(map[string]interface{})
				if !ok {
					continue
				}

				toolID, _ := toolCall["id"].(string)
				toolName, _ := toolCall["name"].(string)
				args := toolCall["args"]
				if args == nil {
					args = map[string]interface{}{}
				}

				// Map Gemini tool name to Claude standard tool name
				claudeName, claudeInput := adaptGeminiToolToClaude(toolName, args)

				// Add tool_use message
				toolUseMsg := claude.Message{
					Type:      "assistant",
					Cwd:       projectID,
					Timestamp: timestamp,
					Message: map[string]interface{}{
						"role": "assistant",
						"content": []map[string]interface{}{
							{
								"type":  "tool_use",
								"id":    toolID,
								"name":  claudeName,
								"input": claudeInput,
							},
						},
					},
				}
				messages = append(messages, toolUseMsg)

				// Process result array
				if resultArr, ok := toolCall["result"].([]interface{}); ok {
					for _, result := range resultArr {
						resultMap, ok := result.(map[string]interface{})
						if !ok {
							continue
						}

						if funcResponse, ok := resultMap["functionResponse"].(map[string]interface{}); ok {
							var output string
							if response, ok := funcResponse["response"].(map[string]interface{}); ok {
								output, _ = response["output"].(string)
							}

							status, _ := toolCall["status"].(string)
							isError := status != "success" && status != ""

							toolResultMsg := claude.Message{
								Type:      "user",
								Cwd:       projectID,
								Timestamp: timestamp,
								Message: map[string]interface{}{
									"role": "user",
									"content": []map[string]interface{}{
										{
											"type":        "tool_result",
											"tool_use_id": toolID,
											"content":     output,
											"is_error":    isError,
										},
									},
								},
							}
							messages = append(messages, toolResultMsg)
						}
					}
				}
			}
		}
	}

	return messages
}

// extractUserMessageFromText extracts actual user message from text that may contain system_instruction tags
func extractUserMessageFromText(text string) string {
	// If text contains </system_instruction> or </system-instruction>, extract content after it
	markers := []string{"</system_instruction>", "</system-instruction>"}

	for _, marker := range markers {
		if pos := strings.Index(text, marker); pos != -1 {
			afterMarker := strings.TrimSpace(text[pos+len(marker):])
			if afterMarker != "" {
				return afterMarker
			}
		}
	}

	// If no system instruction marker found, check for <system_instruction> without closing tag
	if strings.Contains(text, "<system_instruction>") || strings.Contains(text, "<system-instruction>") {
		// Check if there's content after the opening tag that's not part of system instruction
		if pos := strings.LastIndex(text, "\n"); pos != -1 {
			lastPart := strings.TrimSpace(text[pos:])
			if lastPart != "" && !strings.HasPrefix(lastPart, "<") && !strings.HasSuffix(lastPart, ">") {
				return lastPart
			}
		}
		return ""
	}

	// No markers found, return original text
	return text
}

// adaptGeminiToolToClaude maps Gemini tool names and parameters to Claude format
func adaptGeminiToolToClaude(toolName string, parameters interface{}) (string, interface{}) {
	params, _ := parameters.(map[string]interface{})
	if params == nil {
		params = map[string]interface{}{}
	}

	switch toolName {
	case "run_shell_command":
		command, _ := params["command"].(string)
		return "Bash", map[string]interface{}{"command": command}

	case "read_file":
		filePath, _ := params["file_path"].(string)
		input := map[string]interface{}{"file_path": filePath}
		if offset, ok := params["offset"].(float64); ok {
			input["offset"] = int(offset)
		}
		if limit, ok := params["limit"].(float64); ok {
			input["limit"] = int(limit)
		}
		return "Read", input

	case "write_file":
		filePath, _ := params["file_path"].(string)
		content, _ := params["content"].(string)
		return "Write", map[string]interface{}{"file_path": filePath, "content": content}

	case "replace":
		return "Edit", params

	case "google_web_search":
		query, _ := params["query"].(string)
		return "WebSearch", map[string]interface{}{"query": query}

	case "write_todos":
		// Convert Gemini todo format to Claude TodoWrite format
		if todos, ok := params["todos"].([]interface{}); ok {
			convertedTodos := make([]map[string]interface{}, 0, len(todos))
			for _, todo := range todos {
				if todoMap, ok := todo.(map[string]interface{}); ok {
					description, _ := todoMap["description"].(string)
					status, _ := todoMap["status"].(string)
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
		return "TodoWrite", params

	case "list_directory":
		return "LS", params

	case "glob", "find_files":
		return "Glob", params

	case "grep", "search":
		return "Grep", params

	default:
		return toolName, params
	}
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
