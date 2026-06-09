package rpc

import (
	"encoding/json"
	"testing"
)

func TestGetCurrentBranchReturnsEmptyForNonGitDirectory(t *testing.T) {
	handlers := GitHandlers(&Deps{})
	params, err := json.Marshal([]string{t.TempDir()})
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	result, err := handlers["GetCurrentBranch"](params)
	if err != nil {
		t.Fatalf("expected non-git directory to return no error, got %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty branch for non-git directory, got %#v", result)
	}
}
