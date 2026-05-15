package claudeactivity

import (
	"os"
	"path/filepath"
	"testing"
)

type recordingControlSender struct {
	requestID string
	taskID    string
}

func (s *recordingControlSender) SendStopTask(requestID, taskID string) error {
	s.requestID = requestID
	s.taskID = taskID
	return nil
}

func TestObserveTaskLifecycle(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, &recordingControlSender{})

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_started",
		"task_id":     "agent-1",
		"task_type":   "local_agent",
		"description": "Investigate parser",
		"timestamp":   "2026-05-15T01:00:00.000Z",
	})
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":      "system",
		"subtype":   "task_progress",
		"task_id":   "agent-1",
		"summary":   "reading files",
		"timestamp": "2026-05-15T01:00:01.000Z",
		"usage": map[string]interface{}{
			"input_tokens": float64(10),
		},
	})
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_notification",
		"task_id":     "agent-1",
		"status":      "completed",
		"output_file": filepath.Join(t.TempDir(), "agent.jsonl"),
		"timestamp":   "2026-05-15T01:00:02.000Z",
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.RunningCount != 0 {
		t.Fatalf("expected no running activities, got %d", snapshot.RunningCount)
	}
	if len(snapshot.Activities) != 1 {
		t.Fatalf("expected one activity, got %d", len(snapshot.Activities))
	}
	activity := snapshot.Activities[0]
	if activity.ID != "agent-1" || activity.Type != ActivityTypeLocalAgent {
		t.Fatalf("unexpected activity identity: %#v", activity)
	}
	if activity.Status != ActivityStatusCompleted {
		t.Fatalf("expected completed, got %q", activity.Status)
	}
	if activity.Description != "Investigate parser" || activity.Summary != "reading files" {
		t.Fatalf("progress fields were not retained: %#v", activity)
	}
	if activity.CanStop {
		t.Fatal("completed activity must not be stoppable")
	}
}

func TestExtractsBackgroundOutputPathFromToolResult(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	outputPath := filepath.Join(t.TempDir(), "bash-output.txt")

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"message": map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":    "tool_result",
					"content": "Command running in background with ID: b123. Output is being written to: " + outputPath + "\n",
				},
			},
		},
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.BackgroundTasks) != 1 {
		t.Fatalf("expected one background task, got %d", len(snapshot.BackgroundTasks))
	}
	activity := snapshot.BackgroundTasks[0]
	if activity.ID != "b123" {
		t.Fatalf("expected b123, got %q", activity.ID)
	}
	if activity.OutputFile != outputPath {
		t.Fatalf("expected output path %q, got %q", outputPath, activity.OutputFile)
	}
	if !activity.Async {
		t.Fatal("expected background tool result to mark activity async")
	}
}

func TestLocalBashWithoutBackgroundOutputIsNotShownAsBackgroundTask(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_started",
		"task_id":     "sync-bash",
		"task_type":   "local_bash",
		"description": "List release tags",
	})
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":      "system",
		"subtype":   "task_notification",
		"task_id":   "sync-bash",
		"task_type": "local_bash",
		"status":    "completed",
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.BackgroundTasks) != 0 {
		t.Fatalf("expected no background tasks, got %d", len(snapshot.BackgroundTasks))
	}
	if len(snapshot.Other) != 0 {
		t.Fatalf("expected sync bash to be ignored, got %d other activities", len(snapshot.Other))
	}
	if len(snapshot.Activities) != 0 {
		t.Fatalf("expected sync bash to be ignored, got %d activities", len(snapshot.Activities))
	}
}

func TestSystemTaskWithoutTaskTypeIsIgnoredUnlessTracked(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_started",
		"task_id":     "sync-tool",
		"description": "git log --oneline -30",
	})
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":    "system",
		"subtype": "task_notification",
		"task_id": "sync-tool",
		"status":  "completed",
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Activities) != 0 {
		t.Fatalf("expected untyped sync task to be ignored, got %d activities", len(snapshot.Activities))
	}
}

func TestUntrackedLocalBashNotificationWithOutputFileIsCaptured(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	outputPath := filepath.Join(t.TempDir(), "bash-output.txt")

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_notification",
		"task_id":     "bash-1",
		"task_type":   "local_bash",
		"status":      "completed",
		"output_file": outputPath,
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.BackgroundTasks) != 1 {
		t.Fatalf("expected one background task, got %d", len(snapshot.BackgroundTasks))
	}
	activity := snapshot.BackgroundTasks[0]
	if activity.ID != "bash-1" || !activity.Async || activity.OutputFile != outputPath {
		t.Fatalf("unexpected background task: %#v", activity)
	}
	if activity.Status != ActivityStatusCompleted {
		t.Fatalf("expected completed, got %q", activity.Status)
	}
}

func TestStructuredBackgroundToolResultMarksLocalBashAsync(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	outputPath := filepath.Join(t.TempDir(), "bash-output.txt")

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"backgroundTaskId":          "b123",
			"assistantAutoBackgrounded": false,
			"stdout":                    "",
			"stderr":                    "",
			"interrupted":               false,
			"isImage":                   false,
			"noOutputExpected":          false,
		},
		"message": map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":    "tool_result",
					"content": "Command running in background with ID: b123. Output is being written to: " + outputPath,
				},
			},
		},
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.BackgroundTasks) != 1 {
		t.Fatalf("expected one background task, got %d", len(snapshot.BackgroundTasks))
	}
	activity := snapshot.BackgroundTasks[0]
	if activity.ID != "b123" || !activity.Async {
		t.Fatalf("unexpected activity: %#v", activity)
	}
	if activity.OutputFile != outputPath {
		t.Fatalf("expected output path %q, got %q", outputPath, activity.OutputFile)
	}
}

func TestStructuredAsyncAgentResultMarksSubagentAsync(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	outputPath := filepath.Join(t.TempDir(), "agent.output")

	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"isAsync":           true,
			"status":            "async_launched",
			"agentId":           "agent-1",
			"description":       "Investigate history",
			"outputFile":        outputPath,
			"canReadOutputFile": true,
		},
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Subagents) != 1 {
		t.Fatalf("expected one subagent, got %d", len(snapshot.Subagents))
	}
	activity := snapshot.Subagents[0]
	if activity.ID != "agent-1" || !activity.Async {
		t.Fatalf("unexpected activity: %#v", activity)
	}
	if activity.Description != "Investigate history" || activity.OutputFile != outputPath {
		t.Fatalf("structured fields were not retained: %#v", activity)
	}
}

func TestStructuredAsyncAgentResultResolvesTranscriptOutputFile(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "claude", "project-slug", "claude-session", "tasks", "agent-1.output")
	transcriptPath := filepath.Join(dir, ".claude", "projects", "project-slug", "claude-session", "subagents", "agent-agent-1.jsonl")

	service := NewService()
	service.claudeHomeDir = filepath.Join(dir, ".claude")
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"isAsync":     true,
			"status":      "async_launched",
			"agentId":     "agent-1",
			"description": "Investigate history",
			"outputFile":  outputPath,
		},
	})

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Subagents) != 1 {
		t.Fatalf("expected one subagent, got %d", len(snapshot.Subagents))
	}
	if snapshot.Subagents[0].OutputFile != transcriptPath {
		t.Fatalf("expected transcript path %q, got %q", transcriptPath, snapshot.Subagents[0].OutputFile)
	}
}

func TestSnapshotUsesEmptySlicesForJSONLists(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Activities == nil {
		t.Fatal("activities must be an empty slice, not nil")
	}
	if snapshot.Subagents == nil {
		t.Fatal("subagents must be an empty slice, not nil")
	}
	if snapshot.BackgroundTasks == nil {
		t.Fatal("background tasks must be an empty slice, not nil")
	}
	if snapshot.Other == nil {
		t.Fatal("other activities must be an empty slice, not nil")
	}
}

func TestCompleteSessionMarksRunningActivitiesStale(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, &recordingControlSender{})
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"backgroundTaskId": "b123",
		},
	})

	service.CompleteSession("runtime-1")

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if got := snapshot.Activities[0].Status; got != ActivityStatusStale {
		t.Fatalf("expected stale, got %q", got)
	}
	if snapshot.Activities[0].CanStop {
		t.Fatal("stale activity must not be stoppable")
	}
}

func TestKeepsOnlyMostRecentActivities(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)

	for i := 0; i < maxActivitiesPerSession+5; i++ {
		service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
			"type":      "system",
			"subtype":   "task_started",
			"task_id":   "task-" + string(rune('a'+i)),
			"task_type": "local_agent",
		})
	}

	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Activities) != maxActivitiesPerSession {
		t.Fatalf("expected %d activities, got %d", maxActivitiesPerSession, len(snapshot.Activities))
	}
	if snapshot.Activities[0].ID == "task-a" {
		t.Fatal("oldest activity was not trimmed")
	}
}

func TestLogTailReadsLastLines(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "output.txt")
	if err := os.WriteFile(logPath, []byte("one\ntwo\nthree\nfour\n"), 0644); err != nil {
		t.Fatal(err)
	}

	service := NewService()
	service.EnsureSession("runtime-1", dir, true, nil)
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"backgroundTaskId": "b123",
			"outputFile":       logPath,
		},
	})

	tail, err := service.GetLogTail("runtime-1", "b123", 2)
	if err != nil {
		t.Fatal(err)
	}
	if tail.Content != "three\nfour" {
		t.Fatalf("unexpected tail content %q", tail.Content)
	}
	if tail.TruncatedLines != 2 {
		t.Fatalf("expected two truncated lines, got %d", tail.TruncatedLines)
	}
}

func TestLogTailFallsBackToClaudeSubagentTranscript(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "claude", "project-slug", "claude-session", "tasks", "agent-1.output")
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outputPath, nil, 0644); err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(dir, ".claude", "projects", "project-slug", "claude-session", "subagents", "agent-agent-1.jsonl")
	if err := os.MkdirAll(filepath.Dir(transcriptPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(transcriptPath, []byte("alpha\nbeta\n"), 0644); err != nil {
		t.Fatal(err)
	}

	service := NewService()
	service.claudeHomeDir = filepath.Join(dir, ".claude")
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type":        "system",
		"subtype":     "task_notification",
		"task_id":     "agent-1",
		"task_type":   "local_agent",
		"output_file": outputPath,
	})

	tail, err := service.GetLogTail("runtime-1", "agent-1", 80)
	if err != nil {
		t.Fatal(err)
	}
	if tail.Content != "alpha\nbeta" {
		t.Fatalf("unexpected tail content %q", tail.Content)
	}
	if tail.ResolvedBy != "claude_subagent_transcript" {
		t.Fatalf("expected fallback resolver, got %q", tail.ResolvedBy)
	}
}

func TestLogTailFindsClaudeSubagentTranscriptWithoutOutputFile(t *testing.T) {
	dir := t.TempDir()
	transcriptPath := filepath.Join(dir, ".claude", "projects", "project-slug", "claude-session", "subagents", "agent-agent-1.jsonl")
	if err := os.MkdirAll(filepath.Dir(transcriptPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(transcriptPath, []byte("alpha\nbeta\n"), 0644); err != nil {
		t.Fatal(err)
	}

	service := NewService()
	service.claudeHomeDir = filepath.Join(dir, ".claude")
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"isAsync":     true,
			"status":      "async_launched",
			"agentId":     "agent-1",
			"description": "Investigate history",
		},
	})

	tail, err := service.GetLogTail("runtime-1", "agent-1", 80)
	if err != nil {
		t.Fatal(err)
	}
	if tail.Content != "alpha\nbeta" {
		t.Fatalf("unexpected tail content %q", tail.Content)
	}
	if tail.Path != transcriptPath {
		t.Fatalf("expected path %q, got %q", transcriptPath, tail.Path)
	}
	if tail.ResolvedBy != "claude_subagent_transcript" {
		t.Fatalf("expected fallback resolver, got %q", tail.ResolvedBy)
	}
}

func TestStopActivitySendsControlRequestAndMarksStopping(t *testing.T) {
	sender := &recordingControlSender{}
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, sender)
	service.ObserveClaudeEvent("runtime-1", map[string]interface{}{
		"type": "user",
		"toolUseResult": map[string]interface{}{
			"backgroundTaskId": "b123",
		},
	})

	if err := service.StopActivity("runtime-1", "b123"); err != nil {
		t.Fatal(err)
	}
	if sender.taskID != "b123" || sender.requestID == "" {
		t.Fatalf("stop request was not sent: %#v", sender)
	}
	snapshot, err := service.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if got := snapshot.Activities[0].Status; got != ActivityStatusStopping {
		t.Fatalf("expected stopping, got %q", got)
	}
}
