package claude

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"time"

	"ropcode/internal/provider"
)

func (d *Driver) ParseOutput(line []byte) *provider.OutputEvent {
	var raw map[string]interface{}
	if err := json.Unmarshal(line, &raw); err != nil {
		return &provider.OutputEvent{
			Type: "raw",
			Raw:  string(line),
		}
	}

	eventType, _ := raw["type"].(string)

	switch eventType {
	case "system":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: getString(raw, "subtype"),
			Message: raw,
		}
	case "assistant":
		return &provider.OutputEvent{
			Type:    "assistant",
			Message: raw,
		}
	case "user":
		return &provider.OutputEvent{
			Type:    "user",
			Message: raw,
		}
	case "tool_progress":
		return &provider.OutputEvent{
			Type:    "tool_use",
			Subtype: "progress",
			Message: raw,
		}
	case "result":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "result",
			Message: raw,
		}
	case "rate_limit_event":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "rate_limit",
			Message: raw,
		}
	case "control_response":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "control_response",
			Message: raw,
		}
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
	}
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	return &provider.StderrEvent{
		Level:   "error",
		Message: string(line),
	}
}

func (d *Driver) CompleteOutputEvent(event *provider.OutputEvent, config provider.SessionConfig) (*provider.OutputEvent, bool) {
	if event == nil || event.Type != "assistant" || event.Subtype == "result" || getString(event.Message, "type") == "result" || hasStopReason(event.Message) {
		return event, false
	}
	uuid := getString(event.Message, "uuid")
	providerSessionID := firstNonEmptyString(getString(event.Message, "sessionId"), getString(event.Message, "session_id"))
	if uuid == "" || providerSessionID == "" {
		return event, false
	}
	claudeDir, err := ClaudeDir()
	if err != nil {
		return event, false
	}
	projectID := GetProjectHash(config.ProjectPath)
	filePath, err := FindSessionFile(claudeDir, projectID, providerSessionID)
	if err != nil {
		log.Printf("[claude] complete transcript lookup failed session=%s uuid=%s project=%s err=%v",
			providerSessionID,
			uuid,
			config.ProjectPath,
			err,
		)
		return event, false
	}
	deadline := time.Now().Add(1200 * time.Millisecond)
	for {
		if completed, ok := completeEventFromTranscriptFile(event, filePath); ok {
			log.Printf("[claude] completed assistant event from transcript session=%s uuid=%s path=%s stop=%s",
				providerSessionID,
				uuid,
				filePath,
				stopReason(completed.Message),
			)
			return completed, true
		}
		if time.Now().After(deadline) {
			log.Printf("[claude] complete transcript timed out session=%s uuid=%s path=%s",
				providerSessionID,
				uuid,
				filePath,
			)
			return event, false
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func completeEventFromTranscriptFile(event *provider.OutputEvent, filePath string) (*provider.OutputEvent, bool) {
	file, err := os.Open(filePath)
	if err != nil {
		return event, false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, maxScanCapacity)
	scanner.Buffer(buf, maxScanCapacity)
	var matched []byte
	uuid := getString(event.Message, "uuid")
	for scanner.Scan() {
		line := scanner.Bytes()
		if !lineReferencesUUID(line, uuid) {
			continue
		}
		matched = append(matched[:0], line...)
	}
	if len(matched) == 0 {
		return event, false
	}
	return completeEventFromTranscript(event, matched)
}

func completeEventFromTranscript(event *provider.OutputEvent, line []byte) (*provider.OutputEvent, bool) {
	if event == nil || event.Message == nil {
		return event, false
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(line, &raw); err != nil {
		return event, false
	}
	if getString(raw, "uuid") == "" || getString(raw, "uuid") != getString(event.Message, "uuid") {
		return event, false
	}
	if !hasStopReason(raw) {
		return event, false
	}
	completed := *event
	completed.Message = mergeTranscriptMessage(event.Message, raw)
	return &completed, true
}

func mergeTranscriptMessage(base, transcript map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{}, len(base)+len(transcript))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range transcript {
		if key == "message" {
			baseMessage, _ := base[key].(map[string]interface{})
			transcriptMessage, _ := value.(map[string]interface{})
			merged[key] = mergeNestedMap(baseMessage, transcriptMessage)
			continue
		}
		if _, exists := merged[key]; !exists {
			merged[key] = value
		}
	}
	return merged
}

func mergeNestedMap(base, overlay map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{}, len(base)+len(overlay))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range overlay {
		merged[key] = value
	}
	return merged
}

func hasStopReason(raw map[string]interface{}) bool {
	return stopReason(raw) != ""
}

func stopReason(raw map[string]interface{}) string {
	if stop := getString(raw, "stop_reason"); stop != "" {
		return stop
	}
	message, _ := raw["message"].(map[string]interface{})
	return getString(message, "stop_reason")
}

func lineReferencesUUID(line []byte, uuid string) bool {
	if uuid == "" || len(line) == 0 {
		return false
	}
	return jsonContainsString(line, `"uuid":"`+uuid+`"`) || jsonContainsString(line, `"uuid": "`+uuid+`"`)
}

func jsonContainsString(line []byte, needle string) bool {
	return len(needle) > 0 && stringContains(string(line), needle)
}

func stringContains(value, needle string) bool {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func getString(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
