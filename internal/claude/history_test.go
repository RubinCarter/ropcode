package claude

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractClaudeSessionInfoDoesNotReadPastPreviewWindowForTitle(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "session.jsonl")
	var builder strings.Builder
	for i := 0; i < 55; i++ {
		builder.WriteString(fmt.Sprintf(`{"timestamp":"2026-05-18T06:00:%02dZ","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"working"}]}}`, i%60))
		builder.WriteByte('\n')
	}
	builder.WriteString(`{"timestamp":"2026-05-18T06:01:00Z","type":"user","message":{"role":"user","content":"late title should not be read"}}`)
	builder.WriteByte('\n')

	if err := os.WriteFile(filePath, []byte(builder.String()), 0644); err != nil {
		t.Fatal(err)
	}

	info, err := extractClaudeSessionInfo(filePath, "session", "project", `E:\bit_master\ropcode`)
	if err != nil {
		t.Fatal(err)
	}
	if info.FirstMessage != "" {
		t.Fatalf("first message = %q, want empty title preview after scan limit", info.FirstMessage)
	}
}
