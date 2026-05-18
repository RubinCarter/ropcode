package main

import (
	"errors"
	"testing"
)

func TestBuildSpaceSessionsSortsMixedProvidersAndLimits(t *testing.T) {
	result := buildSpaceSessions([]ProviderSessionSummary{
		{ID: "claude-old", Provider: "claude", LastActivity: 10},
		{ID: "codex-new", Provider: "codex", LastActivity: 30},
		{ID: "claude-mid", Provider: "claude", LastActivity: 20},
	}, 2)

	if len(result.Sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(result.Sessions))
	}
	if !result.HasMore {
		t.Fatal("expected HasMore for truncated result")
	}
	if result.Sessions[0].ID != "codex-new" || result.Sessions[1].ID != "claude-mid" {
		t.Fatalf("unexpected order: %#v", result.Sessions)
	}
}

func TestBuildSpaceSessionsLimitZeroReturnsAll(t *testing.T) {
	result := buildSpaceSessions([]ProviderSessionSummary{
		{ID: "one", LastActivity: 1},
		{ID: "two", LastActivity: 2},
	}, 0)

	if len(result.Sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(result.Sessions))
	}
	if result.HasMore {
		t.Fatal("expected HasMore false when limit <= 0")
	}
	if result.Sessions[0].ID != "two" || result.Sessions[1].ID != "one" {
		t.Fatalf("unexpected order: %#v", result.Sessions)
	}
}

func TestListSpaceSessionsFromScannersKeepsSuccessfulProviderResults(t *testing.T) {
	result, err := listSpaceSessionsFromScanners("E:/repo", 10, []spaceSessionScanner{
		{
			provider: "claude",
			scan: func(projectPath string) ([]ProviderSessionSummary, error) {
				return []ProviderSessionSummary{
					{ID: "claude-session", Provider: "claude", ProjectPath: projectPath, LastActivity: 100},
				}, nil
			},
		},
		{
			provider: "codex",
			scan: func(projectPath string) ([]ProviderSessionSummary, error) {
				return nil, errors.New("codex unavailable")
			},
		},
	})

	if err != nil {
		t.Fatalf("expected partial success, got error: %v", err)
	}
	if len(result.Sessions) != 1 || result.Sessions[0].ID != "claude-session" {
		t.Fatalf("unexpected sessions: %#v", result.Sessions)
	}
}

func TestListSpaceSessionsFromScannersErrorsWhenAllProvidersFail(t *testing.T) {
	_, err := listSpaceSessionsFromScanners("E:/repo", 10, []spaceSessionScanner{
		{
			provider: "claude",
			scan: func(projectPath string) ([]ProviderSessionSummary, error) {
				return nil, errors.New("claude unavailable")
			},
		},
		{
			provider: "codex",
			scan: func(projectPath string) ([]ProviderSessionSummary, error) {
				return nil, errors.New("codex unavailable")
			},
		},
	})

	if err == nil {
		t.Fatal("expected error when every provider scanner fails")
	}
}
