package projectchat

import (
	"strings"
	"testing"

	"ropcode/internal/database"
	"ropcode/internal/stream"
)

func TestBuildContextFromFramesStripsPreviouslyInjectedContextFromUserMessage(t *testing.T) {
	injected := InjectContext("hi again", "<previous_conversation>\n[User]: hi\n[Assistant]: hello\n</previous_conversation>")

	contextText := BuildContextFromFrames([]stream.SessionFrame{
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleUser,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: injected}},
		},
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleAssistant,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: "reply"}},
		},
	})

	if strings.Count(contextText, "<previous_conversation>") != 1 {
		t.Fatalf("expected one context wrapper, got %q", contextText)
	}
	if strings.Contains(contextText, "[User]: <previous_conversation>") {
		t.Fatalf("previous context wrapper must not be nested as user text: %q", contextText)
	}
	if !strings.Contains(contextText, "[User]: hi again") {
		t.Fatalf("expected real user message to remain, got %q", contextText)
	}
	if !strings.Contains(contextText, "[Assistant]: reply") {
		t.Fatalf("expected assistant message to remain, got %q", contextText)
	}
}

func TestBuildContextFromFramesStripsSystemInstructionsFromUserMessage(t *testing.T) {
	wrapped := `<system_instruction>
Work only in /tmp/worktree.
</system_instruction>

real request

<system-instruction>
Rename the branch first.
</system-instruction>`

	contextText := BuildContextFromFrames([]stream.SessionFrame{
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleUser,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: wrapped}},
		},
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleAssistant,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: "done"}},
		},
	})

	if strings.Contains(contextText, "system_instruction") || strings.Contains(contextText, "system-instruction") {
		t.Fatalf("system instruction wrappers must not be synced as conversation: %q", contextText)
	}
	if !strings.Contains(contextText, "[User]: real request") {
		t.Fatalf("expected real user request to remain, got %q", contextText)
	}
	if !strings.Contains(contextText, "[Assistant]: done") {
		t.Fatalf("expected assistant response to remain, got %q", contextText)
	}
}

func TestBuildContextFromFramesSkipsInjectedAgentsInstructions(t *testing.T) {
	contextText := BuildContextFromFrames([]stream.SessionFrame{
		{
			Kind: stream.FrameKindMessage,
			Role: stream.RoleAssistant,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: `# AGENTS.md instructions for /tmp/project

<INSTRUCTIONS>
Language Requirements
  Chinese Expression: Use English for reasoning.
</INSTRUCTIONS>`}},
		},
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleAssistant,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: "real assistant reply"}},
		},
	})

	if strings.Contains(contextText, "AGENTS.md instructions") || strings.Contains(contextText, "<INSTRUCTIONS>") {
		t.Fatalf("AGENTS instructions must not be synced as conversation: %q", contextText)
	}
	if !strings.Contains(contextText, "[Assistant]: real assistant reply") {
		t.Fatalf("expected real assistant text to remain, got %q", contextText)
	}
}

func TestBuildContextFromFramesReturnsEmptyForOnlyInjectedPromptText(t *testing.T) {
	contextText := BuildContextFromFrames([]stream.SessionFrame{
		{
			Kind: stream.FrameKindMessage,
			Role: stream.RoleAssistant,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: `# AGENTS.md instructions for /tmp/project

<INSTRUCTIONS>
Rules
</INSTRUCTIONS>`}},
		},
		{
			Kind:    stream.FrameKindMessage,
			Role:    stream.RoleSystem,
			Content: []stream.ContentBlock{{Type: stream.ContentText, Text: "init"}},
		},
	})

	if contextText != "" {
		t.Fatalf("only injected prompt/system text should not produce previous_conversation, got %q", contextText)
	}
}

func TestContextSyncFrameIsAliasOnlyVisibleUserFrame(t *testing.T) {
	seg := testContextSyncSegment("seg-1", "codex", "provider-session-1")
	frame := newContextSyncFrame(
		"chat-1",
		"/tmp/project",
		seg,
		"runtime-1",
		"<previous_conversation>\n[User]: hello\n[Assistant]: hey\n</previous_conversation>",
	)

	if frame.StreamID != "chat-1" {
		t.Fatalf("context sync frame must be emitted on project chat alias stream, got %q", frame.StreamID)
	}
	if frame.Role != stream.RoleUser {
		t.Fatalf("context sync frame must render as user-visible context, got role %q", frame.Role)
	}
	if frame.Subtype != projectChatContextSyncSubtype {
		t.Fatalf("expected subtype %q, got %q", projectChatContextSyncSubtype, frame.Subtype)
	}
	if len(frame.Content) != 1 || frame.Content[0].Type != stream.ContentText {
		t.Fatalf("expected one text content block, got %#v", frame.Content)
	}
	if !strings.Contains(frame.Content[0].Text, "<previous_conversation>") {
		t.Fatalf("expected visible injected context text, got %q", frame.Content[0].Text)
	}
	if strings.Contains(frame.Content[0].Text, "\n\nhi") {
		t.Fatalf("context sync frame must not include the newly sent user message: %q", frame.Content[0].Text)
	}
	rawSource, _ := frame.Meta.Raw["source"].(string)
	if rawSource != projectChatContextSyncSubtype {
		t.Fatalf("expected raw source to identify context sync, got %q", rawSource)
	}
}

func testContextSyncSegment(id, provider, providerSessionID string) *database.ChatSegment {
	return &database.ChatSegment{
		ID:                id,
		Provider:          provider,
		ProviderSessionID: providerSessionID,
	}
}
