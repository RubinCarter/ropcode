package main

import "testing"

func TestResolveInteractiveClaudeSessionStart_ReusesExistingSessionByDefault(t *testing.T) {
	resumeID, reuseExisting, terminateExisting := resolveInteractiveClaudeSessionStart("resume-123", true)

	if resumeID != "resume-123" {
		t.Fatalf("expected resume ID to be preserved, got %q", resumeID)
	}
	if !reuseExisting {
		t.Fatal("expected existing interactive session to be reused")
	}
	if terminateExisting {
		t.Fatal("did not expect existing interactive session to be terminated")
	}
}

func TestResolveInteractiveClaudeSessionStart_ForcesFreshSession(t *testing.T) {
	resumeID, reuseExisting, terminateExisting := resolveInteractiveClaudeSessionStart("__ROP_FRESH_SESSION__", true)

	if resumeID != "" {
		t.Fatalf("expected fresh session to clear resume ID, got %q", resumeID)
	}
	if reuseExisting {
		t.Fatal("did not expect existing interactive session to be reused")
	}
	if !terminateExisting {
		t.Fatal("expected existing interactive session to be terminated for fresh session")
	}
}

func TestResolveInteractiveClaudeSessionStart_StartsFreshWithoutExistingSession(t *testing.T) {
	resumeID, reuseExisting, terminateExisting := resolveInteractiveClaudeSessionStart("__ROP_FRESH_SESSION__", false)

	if resumeID != "" {
		t.Fatalf("expected fresh session to clear resume ID, got %q", resumeID)
	}
	if reuseExisting {
		t.Fatal("did not expect existing interactive session to be reused")
	}
	if terminateExisting {
		t.Fatal("did not expect termination when no session is running")
	}
}
