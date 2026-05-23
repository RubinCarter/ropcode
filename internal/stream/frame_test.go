package stream

import (
	"encoding/json"
	"testing"
)

func TestSessionFrameJSONUsesStableFrontendNames(t *testing.T) {
	frame := SessionFrame{
		StreamID:          "stream-runtime-1",
		FrameID:           "frame-1",
		Provider:          "claude",
		RuntimeSessionID:  "runtime-1",
		ProviderSessionID: "provider-1",
		Cwd:               "E:/repo",
		ProjectPath:       "E:/repo",
		Seq:               7,
		Timestamp:         "2026-05-23T08:00:00Z",
		Kind:              FrameKindMessage,
		Role:              RoleAssistant,
		Subtype:           "text",
		Content: []ContentBlock{
			{Type: ContentText, Text: "hello"},
			{Type: ContentThinking, Text: "plan"},
			{Type: ContentToolUse, ToolUseID: "toolu_1", Name: "Read", Input: map[string]any{"file_path": "README.md"}},
			{Type: ContentToolResult, ToolUseID: "toolu_1", Text: "done", IsError: false},
		},
		ParentToolUseID: "toolu_parent",
		TaskID:          "task-1",
		ToolUseID:       "toolu_1",
		AgentID:         "agent-1",
		Sidechain:       true,
		Success:         boolPtr(true),
		DurationMs:      1200,
		Result:          "ok",
		Usage: &Usage{
			InputTokens:  11,
			OutputTokens: 13,
			TotalTokens:  24,
			ToolUseCount: 1,
		},
		Runtime: &RuntimeSnapshot{
			Phase:        "tool_running",
			ActiveTool:   "Read",
			ProgressText: "Reading README.md",
			Retry:        &RetrySnapshot{Attempt: 2, MaxAttempts: 5, NextRetryMs: 8000},
		},
		Meta: Meta{Raw: map[string]any{"provider_field": "kept"}},
	}

	data, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{
		"streamId", "frameId", "runtimeSessionId", "providerSessionId", "projectPath",
		"parentToolUseId", "taskId", "toolUseId", "agentId", "durationMs",
	} {
		if _, ok := got[key]; !ok {
			t.Fatalf("expected JSON key %q in %s", key, data)
		}
	}
	for _, key := range []string{
		"stream_id", "frame_id", "runtime_session_id", "provider_session_id", "project_path",
		"parent_tool_use_id", "task_id", "tool_use_id", "agent_id", "duration_ms",
	} {
		if _, ok := got[key]; ok {
			t.Fatalf("did not expect snake_case JSON key %q in %s", key, data)
		}
	}
}

func TestFixtureFramesCoverRequiredProviders(t *testing.T) {
	frames := []SessionFrame{
		{
			StreamID:          "claude-runtime",
			FrameID:           "claude-1",
			Provider:          "claude",
			RuntimeSessionID:  "runtime-claude",
			ProviderSessionID: "85432b6a-bb51-47af-9c03-f3d6dd391cb6",
			Seq:               1,
			Timestamp:         "2026-05-23T08:00:01Z",
			Kind:              FrameKindMessage,
			Role:              RoleAssistant,
			Content:           []ContentBlock{{Type: ContentToolUse, ToolUseID: "tooluse_QbkfnYH7RjvBiP8PMKdV9G", Name: "Task"}},
			ParentToolUseID:   "tooluse_parent",
			TaskID:            "task-claude",
			AgentID:           "agent-claude",
			Sidechain:         true,
			Meta:              Meta{Raw: map[string]any{"uuid": "d482f473-abf6-44db-8701-334a9f29dc3e"}},
		},
		{
			StreamID:         "codex-runtime",
			FrameID:          "codex-1",
			Provider:         "codex",
			RuntimeSessionID: "runtime-codex",
			Seq:              1,
			Timestamp:        "2026-05-23T08:00:02Z",
			Kind:             FrameKindMessage,
			Role:             RoleAssistant,
			Content: []ContentBlock{
				{Type: ContentThinking, Text: "reasoning"},
				{Type: ContentToolUse, ToolUseID: "call-1", Name: "shell"},
				{Type: ContentToolResult, ToolUseID: "call-1", Text: "ok"},
			},
		},
		{
			StreamID:          "deepseek-runtime",
			FrameID:           "deepseek-1",
			Provider:          "deepseek",
			RuntimeSessionID:  "runtime-deepseek",
			ProviderSessionID: "provider-deepseek",
			Seq:               1,
			Timestamp:         "2026-05-23T08:00:03Z",
			Kind:              FrameKindDelta,
			Role:              RoleAssistant,
			Content:           []ContentBlock{{Type: ContentText, Text: "delta"}},
			Meta:              Meta{Raw: map[string]any{"metadata": map[string]any{"model": "deepseek-chat"}}},
		},
	}

	for _, frame := range frames {
		if frame.StreamID == "" || frame.FrameID == "" || frame.Provider == "" || frame.RuntimeSessionID == "" {
			t.Fatalf("frame missing required UI identity: %#v", frame)
		}
		if len(frame.Content) == 0 {
			t.Fatalf("frame for %s must expose UI content without meta", frame.Provider)
		}
	}
}

func boolPtr(v bool) *bool {
	return &v
}
