//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeClientPathAcceptsWindowsDrivePathWithLeadingSlash(t *testing.T) {
	got := normalizeClientPath(`/E:\bit_master\ropcode\app.go`)
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
	app := &App{}

	content, err := app.ReadFile(slashed)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if content != "hello" {
		t.Fatalf("expected file content, got %q", content)
	}

	metadata, err := app.GetFileMetadata(slashed)
	if err != nil {
		t.Fatalf("GetFileMetadata failed: %v", err)
	}
	if metadata.Size != 5 || metadata.IsBinary || metadata.Extension != "txt" {
		t.Fatalf("unexpected metadata: %+v", metadata)
	}
}
