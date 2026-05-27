package pi

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"ropcode/internal/provider"
)

func TestDriverIdentity(t *testing.T) {
	d := &Driver{}

	if got := d.ID(); got != "pi" {
		t.Fatalf("ID() = %q, want pi", got)
	}
	if got := d.BinaryName(); got != "pi" {
		t.Fatalf("BinaryName() = %q, want pi", got)
	}
}

func TestBuildArgs(t *testing.T) {
	d := &Driver{}

	args := d.BuildArgs(provider.SessionConfig{
		Model: "anthropic/claude-sonnet-4-20250514",
		Extra: map[string]string{
			"session_dir": `C:\tmp\pi-sessions`,
		},
	})

	want := []string{
		"--mode", "rpc",
		"--model", "anthropic/claude-sonnet-4-20250514",
		"--session-dir", `C:\tmp\pi-sessions`,
	}
	if !slices.Equal(args, want) {
		t.Fatalf("BuildArgs() = %#v, want %#v", args, want)
	}
}

func TestPromptCommand(t *testing.T) {
	data, err := promptCommand("req-1", "Continue", true)
	if err != nil {
		t.Fatalf("promptCommand returned error: %v", err)
	}
	if !strings.HasSuffix(string(data), "\n") {
		t.Fatalf("promptCommand must return newline-terminated JSONL, got %q", string(data))
	}

	var got map[string]interface{}
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("promptCommand returned invalid JSON: %v", err)
	}
	if got["id"] != "req-1" || got["type"] != "prompt" || got["message"] != "Continue" {
		t.Fatalf("promptCommand returned unexpected command: %#v", got)
	}
	if got["streamingBehavior"] != "followUp" {
		t.Fatalf("streamingBehavior = %#v, want followUp", got["streamingBehavior"])
	}
}

func TestWindowsCandidates(t *testing.T) {
	candidates := windowsCandidates()
	if !slices.Contains(candidates, `C:\Program Files\nodejs\pi.cmd`) {
		t.Fatalf("windowsCandidates() missing Program Files nodejs candidate: %#v", candidates)
	}
}
