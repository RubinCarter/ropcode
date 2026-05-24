package codex

import "testing"

func TestParseStderrIgnoresCodexStdinNotice(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseStderr([]byte("Reading additional input from stdin..."))

	if got != nil {
		t.Fatalf("expected stdin notice to be ignored, got %#v", got)
	}
}

func TestParseStderrClassifiesCodexWarnings(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseStderr([]byte("2026-05-24T05:34:10Z  WARN codex_core_plugins::manager: retrying"))

	if got == nil {
		t.Fatal("expected warning event")
	}
	if got.Level != "warning" {
		t.Fatalf("expected warning level, got %q", got.Level)
	}
}
