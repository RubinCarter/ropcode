package deepseek

import "testing"

func TestParseStderrClassifiesPlainDeepSeekOutputAsWarning(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseStderr([]byte("DeepSeek CLI telemetry disabled"))

	if got == nil {
		t.Fatal("expected stderr event")
	}
	if got.Level != "warning" {
		t.Fatalf("expected warning level, got %q", got.Level)
	}
}

func TestParseStderrClassifiesDeepSeekErrors(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseStderr([]byte("ERROR request failed"))

	if got == nil {
		t.Fatal("expected stderr event")
	}
	if got.Level != "error" {
		t.Fatalf("expected error level, got %q", got.Level)
	}
}
