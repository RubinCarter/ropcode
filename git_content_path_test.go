package main

import (
	"os"
	"strings"
	"testing"
)

func TestGitContentKeepsPlatformPathRulesSplit(t *testing.T) {
	data, err := os.ReadFile("git_content.go")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}

	source := string(data)
	for _, needle := range []string{
		`ReplaceAll`,
		`path.Clean`,
		`filepath.Clean`,
	} {
		if strings.Contains(source, needle) {
			t.Fatalf("expected git_content.go to delegate platform path rules; found %q", needle)
		}
	}
}
