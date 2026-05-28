package projectchat

import (
	"fmt"
	"strings"

	"ropcode/internal/stream"
)

var contextWindows = map[string]int{
	"claude":   200000,
	"gemini":   1000000,
	"codex":    128000,
	"deepseek": 64000,
}

func getContextWindow(provider, model string) int {
	if strings.Contains(model, "[1m]") || strings.Contains(model, "1m") {
		return 1000000
	}
	if w, ok := contextWindows[provider]; ok {
		return w
	}
	return 128000
}

func EstimateTokens(text string) int {
	return len(text) / 4
}

func ShouldSummarize(contextTokens int, targetProvider, model string) bool {
	window := getContextWindow(targetProvider, model)
	return contextTokens > window/2
}

func BuildContextFromFrames(frames []stream.SessionFrame) string {
	if len(frames) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("<previous_conversation>\n")

	for _, frame := range frames {
		if frame.Kind != stream.FrameKindMessage && frame.Kind != stream.FrameKindResult && frame.Kind != stream.FrameKindDelta {
			continue
		}
		if frame.Role == "" {
			continue
		}
		if frame.Sidechain {
			continue
		}
		// Skip system/init messages (like AGENTS.md instructions)
		if frame.Role == stream.RoleSystem {
			continue
		}
		// Skip frames with subtype "init" (session initialization)
		if frame.Subtype == "init" || frame.Subtype == "thread_created" {
			continue
		}

		text := extractTextFromFrame(frame)
		if text == "" {
			continue
		}

		label := "[User]"
		switch frame.Role {
		case stream.RoleAssistant:
			label = "[Assistant]"
		}
		b.WriteString(fmt.Sprintf("%s: %s\n", label, text))
	}

	b.WriteString("</previous_conversation>")
	return b.String()
}

func extractTextFromFrame(frame stream.SessionFrame) string {
	var parts []string
	for _, block := range frame.Content {
		switch block.Type {
		case stream.ContentText:
			if block.Text != "" {
				parts = append(parts, block.Text)
			}
		case stream.ContentToolUse:
			if block.Name != "" {
				parts = append(parts, fmt.Sprintf("[tool_use: %s]", block.Name))
			}
		case stream.ContentToolResult:
			if block.Text != "" {
				parts = append(parts, fmt.Sprintf("[tool_result: %s]", truncate(block.Text, 200)))
			}
		}
	}
	return strings.Join(parts, "\n")
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func InjectContext(userMessage, contextText string) string {
	if contextText == "" {
		return userMessage
	}
	if userMessage == "" {
		return contextText
	}
	return contextText + "\n\n" + userMessage
}

func BuildSummarizationPrompt(contextText string) string {
	return `Summarize the following conversation concisely. Preserve:
- Key decisions and conclusions
- File paths, function names, and code changes mentioned
- Current task state and next steps
- Any constraints or requirements discussed

Keep the summary under 2000 words.

` + contextText
}
