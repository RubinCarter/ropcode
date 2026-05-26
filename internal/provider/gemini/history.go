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

	"ropcode/internal/provider"
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
func LoadSessionHistory(geminiDir, projectID, sessionID string) ([]provider.Message, error) {
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

	var messages []provider.Message
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
func geminiSessionMessageToClaudeHistory(msgMap map[string]interface{}, projectID, timestamp string) []provider.Message {
	var messages []provider.Message

	msgType, _ := msgMap["type"].(string)
	content, _ := msgMap["content"].(string)

	switch msgType {
	case "user":
		// Extract actual user message (remove system_instruction parts if present)
		userText := extractUserMessageFromText(content)
		if strings.TrimSpace(userText) == "" {
			return messages
		}

		msg := provider.Message{
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
			msg := provider.Message{
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
				argsMap, _ := toolCall["args"].(map[string]interface{})
				if argsMap == nil {
					argsMap = map[string]interface{}{}
				}

				// Map Gemini tool name to Claude standard tool name
				claudeName, claudeInput := adaptGeminiToolCall(toolName, argsMap)

				// Add tool_use message
				toolUseMsg := provider.Message{
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

							toolResultMsg := provider.Message{
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
