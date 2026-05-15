package claudeactivity

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	backgroundOutputPathPattern = regexp.MustCompile(`Output is being written to:\s*(.+?)(?:\.?$|\r?\n)`)
	backgroundIDPattern         = regexp.MustCompile(`Command running in background with ID:\s*([A-Za-z0-9_-]+)`)
)

func (s *Service) ObserveClaudeEvent(sessionID string, event map[string]interface{}) {
	if sessionID == "" || event == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	bucket := s.ensureBucketLocked(sessionID)
	now := s.now()
	eventType, _ := event["type"].(string)
	subtype, _ := event["subtype"].(string)

	if eventType == "system" {
		switch subtype {
		case "task_started":
			s.observeTaskStarted(bucket, event, now)
		case "task_progress":
			s.observeTaskProgress(bucket, event, now)
		case "task_notification":
			s.observeTaskNotification(bucket, event, now)
		}
		return
	}

	if eventType == "user" {
		s.observeToolResult(bucket, event, now)
	}
}

func (s *Service) observeTaskStarted(bucket *sessionBucket, event map[string]interface{}, now time.Time) {
	id := stringField(event, "task_id")
	taskType := stringField(event, "task_type")
	activity := bucket.ensureActivity(id, taskType, now)
	if activity == nil {
		return
	}
	if ts := parseEventTime(event); ts != nil {
		activity.StartedAt = ts
		activity.UpdatedAt = *ts
	} else {
		activity.UpdatedAt = now
	}
	activity.Status = ActivityStatusRunning
	setStringIfPresent(&activity.Description, event, "description")
	setStringIfPresent(&activity.Summary, event, "summary")
	setStringIfPresent(&activity.LastActivity, event, "last_tool_name")
}

func (s *Service) observeTaskProgress(bucket *sessionBucket, event map[string]interface{}, now time.Time) {
	id := stringField(event, "task_id")
	taskType := stringField(event, "task_type")
	activity := bucket.ensureActivity(id, taskType, now)
	if activity == nil {
		return
	}
	activity.UpdatedAt = eventTimeOrNow(event, now)
	setStringIfPresent(&activity.Description, event, "description")
	setStringIfPresent(&activity.Summary, event, "summary")
	setStringIfPresent(&activity.LastActivity, event, "last_tool_name")
	if usage, ok := usageFromValue(event["usage"]); ok {
		activity.Usage = usage
	}
}

func (s *Service) observeTaskNotification(bucket *sessionBucket, event map[string]interface{}, now time.Time) {
	id := stringField(event, "task_id")
	taskType := stringField(event, "task_type")
	activity := bucket.ensureActivity(id, taskType, now)
	if activity == nil {
		return
	}
	updatedAt := eventTimeOrNow(event, now)
	activity.UpdatedAt = updatedAt
	activity.EndedAt = &updatedAt
	setStringIfPresent(&activity.Description, event, "description")
	setStringIfPresent(&activity.Summary, event, "summary")
	setStringIfPresent(&activity.OutputFile, event, "output_file")
	setStringIfPresent(&activity.Error, event, "error")
	if usage, ok := usageFromValue(event["usage"]); ok {
		activity.Usage = usage
	}

	switch strings.ToLower(stringField(event, "status")) {
	case "completed", "success", "done":
		activity.Status = ActivityStatusCompleted
	case "failed", "error":
		activity.Status = ActivityStatusFailed
	case "stopped", "cancelled", "canceled":
		activity.Status = ActivityStatusStopped
	default:
		if activity.Status == "" {
			activity.Status = ActivityStatusCompleted
		}
	}
}

func (s *Service) observeToolResult(bucket *sessionBucket, event map[string]interface{}, now time.Time) {
	message, _ := event["message"].(map[string]interface{})
	content, _ := message["content"].([]interface{})
	for _, item := range content {
		block, ok := item.(map[string]interface{})
		if !ok || stringField(block, "type") != "tool_result" {
			continue
		}
		text := stringify(block["content"])
		outputFile := extractBackgroundOutputPath(text)
		if outputFile == "" {
			continue
		}
		id := extractBackgroundID(text)
		if id == "" {
			id = stringField(block, "tool_use_id")
		}
		if id == "" {
			continue
		}
		activity := bucket.ensureActivity(id, "local_bash", now)
		if activity == nil {
			continue
		}
		activity.OutputFile = outputFile
		activity.UpdatedAt = now
		if activity.Description == "" {
			activity.Description = id
		}
	}
}

func extractBackgroundOutputPath(text string) string {
	match := backgroundOutputPathPattern.FindStringSubmatch(text)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(strings.TrimSuffix(match[1], "."))
}

func extractBackgroundID(text string) string {
	match := backgroundIDPattern.FindStringSubmatch(text)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func stringField(values map[string]interface{}, key string) string {
	value, _ := values[key].(string)
	return value
}

func setStringIfPresent(target *string, values map[string]interface{}, key string) {
	if value := stringField(values, key); value != "" {
		*target = value
	}
}

func parseEventTime(event map[string]interface{}) *time.Time {
	raw := stringField(event, "timestamp")
	if raw == "" {
		return nil
	}
	formats := []string{
		"2006-01-02T15:04:05.000Z",
		time.RFC3339,
		time.RFC3339Nano,
	}
	for _, format := range formats {
		if parsed, err := time.Parse(format, raw); err == nil {
			utc := parsed.UTC()
			return &utc
		}
	}
	return nil
}

func eventTimeOrNow(event map[string]interface{}, now time.Time) time.Time {
	if parsed := parseEventTime(event); parsed != nil {
		return *parsed
	}
	return now
}

func usageFromValue(value interface{}) (Usage, bool) {
	values, ok := value.(map[string]interface{})
	if !ok {
		return Usage{}, false
	}
	return Usage{
		InputTokens:              intField(values, "input_tokens"),
		OutputTokens:             intField(values, "output_tokens"),
		CacheCreationInputTokens: intField(values, "cache_creation_input_tokens"),
		CacheReadInputTokens:     intField(values, "cache_read_input_tokens"),
		TotalTokens:              intField(values, "total_tokens"),
		ToolUses:                 intField(values, "tool_uses"),
	}, true
}

func intField(values map[string]interface{}, key string) int {
	switch value := values[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case float32:
		return int(value)
	default:
		return 0
	}
}

func stringify(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case []interface{}:
		var parts []string
		for _, item := range v {
			parts = append(parts, stringify(item))
		}
		return strings.Join(parts, "\n")
	case map[string]interface{}:
		if text, _ := v["text"].(string); text != "" {
			return text
		}
		return fmt.Sprint(v)
	default:
		if value == nil {
			return ""
		}
		return fmt.Sprint(value)
	}
}
