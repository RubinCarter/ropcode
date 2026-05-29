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

	var lines []string

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
		if isInjectedSystemPromptText(text) {
			continue
		}

		label := "[User]"
		switch frame.Role {
		case stream.RoleAssistant:
			label = "[Assistant]"
		}
		lines = append(lines, fmt.Sprintf("%s: %s", label, text))
	}

	if len(lines) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("<previous_conversation>\n")
	for _, line := range lines {
		b.WriteString(line)
		b.WriteByte('\n')
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
	text := StripInjectedContext(strings.Join(parts, "\n"))
	return strings.TrimSpace(text)
}

func StripInjectedContext(text string) string {
	trimmed := strings.TrimSpace(text)
	for {
		next := stripDelimitedBlocks(trimmed, "<previous_conversation>", "</previous_conversation>")
		next = stripDelimitedBlocks(next, "<system_instruction>", "</system_instruction>")
		next = stripDelimitedBlocks(next, "<system-instruction>", "</system-instruction>")
		next = stripDelimitedBlocks(next, "<environment_context>", "</environment_context>")
		next = stripInjectedInstructionSections(next)
		next = strings.TrimSpace(next)
		if next == trimmed {
			return next
		}
		trimmed = next
	}
}

func stripDelimitedBlocks(text, openTag, closeTag string) string {
	out := text
	for {
		start := strings.Index(out, openTag)
		if start < 0 {
			return out
		}
		afterOpen := start + len(openTag)
		relativeEnd := strings.Index(out[afterOpen:], closeTag)
		if relativeEnd < 0 {
			return out
		}
		end := afterOpen + relativeEnd + len(closeTag)
		out = out[:start] + out[end:]
	}
}

func isInjectedSystemPromptText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return true
	}
	if strings.HasPrefix(trimmed, "<environment_context>") {
		return true
	}
	if strings.HasPrefix(trimmed, "<system_instruction>") || strings.HasPrefix(trimmed, "<system-instruction>") {
		return true
	}
	if strings.Contains(trimmed, "<INSTRUCTIONS>") && strings.Contains(trimmed, " instructions for ") {
		return true
	}
	if strings.Contains(trimmed, "<INSTRUCTIONS>") && strings.Contains(trimmed, "AGENTS.md instructions") {
		return true
	}
	return false
}

func stripInjectedInstructionSections(text string) string {
	out := text
	for {
		start := injectedInstructionSectionStart(out)
		if start < 0 {
			return out
		}
		openRel := strings.Index(out[start:], "<INSTRUCTIONS>")
		if openRel < 0 {
			return out
		}
		afterOpen := start + openRel + len("<INSTRUCTIONS>")
		closeRel := strings.Index(out[afterOpen:], "</INSTRUCTIONS>")
		if closeRel < 0 {
			return strings.TrimSpace(out[:start])
		}
		end := afterOpen + closeRel + len("</INSTRUCTIONS>")
		out = out[:start] + out[end:]
	}
}

func injectedInstructionSectionStart(text string) int {
	markerIdx := strings.Index(text, "AGENTS.md instructions")
	if markerIdx < 0 {
		markerIdx = strings.Index(text, " instructions for ")
		if markerIdx < 0 || !strings.Contains(text[markerIdx:], "<INSTRUCTIONS>") {
			return -1
		}
	}
	lineStart := strings.LastIndex(text[:markerIdx], "\n")
	if lineStart < 0 {
		return 0
	}
	return lineStart + 1
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
