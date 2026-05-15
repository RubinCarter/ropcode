//go:build windows

package pathutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeClientPathAcceptsWindowsDrivePathWithLeadingSlash(t *testing.T) {
	got := NormalizeClientPath(`/E:\bit_master\ropcode\app.go`)
	want := filepath.Clean(`E:\bit_master\ropcode\app.go`)
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestFileMetadataAndReadFileUseNormalizedPath(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "sample.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile fixture failed: %v", err)
	}

	slashed := "/" + filePath
	got := NormalizeClientPath(slashed)
	if got != filePath {
		t.Fatalf("expected %q, got %q", filePath, got)
	}
}
