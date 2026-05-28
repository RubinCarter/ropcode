package pi

import "ropcode/internal/provider"

func assistantDelta(text string) *provider.OutputEvent {
	event := assistantText(text)
	event.IsDelta = true
	return event
}

func assistantText(text string) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{
					{"type": "text", "text": text},
				},
			},
		},
	}
}

func resultEvent(success bool) *provider.OutputEvent {
	return resultEventWithMessage(success, "")
}

func resultEventWithMessage(success bool, message string) *provider.OutputEvent {
	subtype := "success"
	if !success {
		subtype = "error"
	}
	msg := map[string]interface{}{
		"type":    "result",
		"subtype": subtype,
	}
	if message != "" {
		msg["error"] = message
		msg["message"] = message
	}
	return &provider.OutputEvent{
		Type:    "assistant",
		Subtype: "result",
		Message: msg,
	}
}

func errorEvent(message string) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "error",
		Message: map[string]interface{}{
			"type":    "error",
			"message": message,
		},
	}
}
