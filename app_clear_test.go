package main

import "testing"

func TestResolveInteractiveClaudeSessionStart_ReusesExistingSessionByDefault(t *testing.T) {
	resumeID, reuseExisting, terminateExisting, allowAutoResume := resolveInteractiveClaudeSessionStart("resume-123", true)

	if resumeID != "resume-123" {
		t.Fatalf("expected resume ID to be preserved, got %q", resumeID)
	}
	if !reuseExisting {
		t.Fatal("expected existing interactive session to be reused")
	}
	if terminateExisting {
		t.Fatal("did not expect existing interactive session to be terminated")
	}
	if !allowAutoResume {
		t.Fatal("expected normal session start to allow auto-resume")
	}
}

func TestResolveInteractiveClaudeSessionStart_ForcesFreshSession(t *testing.T) {
	resumeID, reuseExisting, terminateExisting, allowAutoResume := resolveInteractiveClaudeSessionStart("__ROP_FRESH_SESSION__", true)

	if resumeID != "" {
		t.Fatalf("expected fresh session to clear resume ID, got %q", resumeID)
	}
	if reuseExisting {
		t.Fatal("did not expect existing interactive session to be reused")
	}
	if !terminateExisting {
		t.Fatal("expected existing interactive session to be terminated for fresh session")
	}
	if allowAutoResume {
		t.Fatal("did not expect fresh session to allow auto-resume")
	}
}

func TestResolveInteractiveClaudeSessionStart_StartsFreshWithoutExistingSession(t *testing.T) {
	resumeID, reuseExisting, terminateExisting, allowAutoResume := resolveInteractiveClaudeSessionStart("__ROP_FRESH_SESSION__", false)

	if resumeID != "" {
		t.Fatalf("expected fresh session to clear resume ID, got %q", resumeID)
	}
	if reuseExisting {
		t.Fatal("did not expect existing interactive session to be reused")
	}
	if terminateExisting {
		t.Fatal("did not expect termination when no session is running")
	}
	if allowAutoResume {
		t.Fatal("did not expect fresh start without existing session to allow auto-resume")
	}
}

func TestResolveInteractiveClaudeSessionStart_DisablesAutoResumeForFreshSentinel(t *testing.T) {
	_, _, _, allowAutoResume := resolveInteractiveClaudeSessionStart("__ROP_FRESH_SESSION__", false)

	if allowAutoResume {
		t.Fatal("expected fresh clear flow to disable auto-resume of previous Claude conversation")
	}
}

func TestShouldIgnoreMissingRunningSessionOnClear(t *testing.T) {
	if shouldIgnoreMissingRunningSessionOnClear(nil) {
		t.Fatal("did not expect nil error to be ignored")
	}

	if !shouldIgnoreMissingRunningSessionOnClear(assertErr("no running sessions found for project: /tmp/foo")) {
		t.Fatal("expected clear stop race to be ignored")
	}

	if shouldIgnoreMissingRunningSessionOnClear(assertErr("session not found: abc")) {
		t.Fatal("did not expect unrelated errors to be ignored")
	}
}

type assertErr string

func (e assertErr) Error() string { return string(e) }
