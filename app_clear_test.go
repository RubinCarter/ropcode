package main

import (
	"context"
	"testing"

	appRuntime "ropcode/internal/runtime"
)

func TestBootstrapRuntimeInitializesCoreManagers(t *testing.T) {
	ctx := context.Background()
	app, cleanup, err := appRuntime.StartForTest(ctx, NewApp)
	if err != nil {
		t.Fatalf("StartForTest failed: %v", err)
	}
	defer cleanup(context.Background())

	if app == nil {
		t.Fatal("expected app instance")
	}
	if app.EventHub() == nil {
		t.Fatal("expected event hub to be initialized")
	}
	if app.Database() == nil {
		t.Fatal("expected database to be initialized")
	}
	if app.providerManager == nil {
		t.Fatal("expected provider manager to be initialized")
	}
}

func TestClear_IgnoresMissingRunningSessionOnClear(t *testing.T) {
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

func TestShouldIgnoreMissingRunningSessionOnClear(t *testing.T) {
	TestClear_IgnoresMissingRunningSessionOnClear(t)
}

type assertErr string

func (e assertErr) Error() string { return string(e) }
