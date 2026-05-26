package gemini

import "strings"

// normalize.go — Single source of truth for Gemini → Claude tool/content adaptation.

// adaptGeminiToolCall maps Gemini tool names and parameters to Claude equivalents.
func adaptGeminiToolCall(name string, params map[string]interface{}) (string, interface{}) {
	if params == nil {
		params = map[string]interface{}{}
	}
	switch name {
	case "run_shell_command":
		command, _ := params["command"].(string)
		return "Bash", map[string]interface{}{"command": command}

	case "read_file":
		filePath, _ := params["file_path"].(string)
		input := map[string]interface{}{"file_path": filePath}
		if v, ok := params["offset"]; ok {
			input["offset"] = v
		}
		if v, ok := params["limit"]; ok {
			input["limit"] = v
		}
		return "Read", input

	case "write_file":
		return "Write", map[string]interface{}{
			"file_path": stringVal(params, "file_path"),
			"content":   stringVal(params, "content"),
		}

	case "replace":
		return "Edit", params

	case "google_web_search":
		return "WebSearch", map[string]interface{}{"query": stringVal(params, "query")}

	case "write_todos":
		if todos, ok := params["todos"].([]interface{}); ok {
			convertedTodos := make([]map[string]interface{}, 0, len(todos))
			for _, todo := range todos {
				if todoMap, ok := todo.(map[string]interface{}); ok {
					description, _ := todoMap["description"].(string)
					status, _ := todoMap["status"].(string)
					if status == "" {
						status = "pending"
					}
					convertedTodos = append(convertedTodos, map[string]interface{}{
						"content":    description,
						"status":     status,
						"activeForm": generateActiveForm(description),
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
		return name, params
	}
}

func generateActiveForm(description string) string {
	trimmed := strings.TrimSpace(description)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, " ", 2)
	firstWord := parts[0]
	rest := ""
	if len(parts) > 1 {
		rest = parts[1]
	}
	verbMap := map[string]string{
		"create": "Creating", "add": "Adding", "update": "Updating",
		"fix": "Fixing", "remove": "Removing", "delete": "Deleting",
		"implement": "Implementing", "write": "Writing", "read": "Reading",
		"build": "Building", "test": "Testing", "run": "Running",
		"check": "Checking", "install": "Installing", "configure": "Configuring",
		"setup": "Setting up", "set": "Setting up", "modify": "Modifying",
		"refactor": "Refactoring", "debug": "Debugging", "analyze": "Analyzing",
		"review": "Reviewing", "merge": "Merging", "deploy": "Deploying",
		"migrate": "Migrating", "optimize": "Optimizing", "validate": "Validating",
		"verify": "Verifying", "ensure": "Ensuring",
	}
	lowerWord := strings.ToLower(firstWord)
	if activeVerb, ok := verbMap[lowerWord]; ok {
		if rest != "" {
			return activeVerb + " " + rest
		}
		return activeVerb
	}
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
