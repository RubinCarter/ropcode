package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	appRuntime "ropcode/internal/runtime"
)

type capturedProjectEvent struct {
	eventType string
	payload   any
}

func TestCreateWorkspaceInNonGitProjectCreatesDirectoryAndEvent(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	ctx := context.Background()
	app, cleanup, err := appRuntime.StartForTest(ctx, NewApp)
	if err != nil {
		t.Fatalf("StartForTest failed: %v", err)
	}
	defer cleanup(ctx)

	projectPath := filepath.Join(t.TempDir(), "non-git-project")
	if err := os.MkdirAll(projectPath, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := app.AddProjectToIndex(projectPath); err != nil {
		t.Fatalf("AddProjectToIndex failed: %v", err)
	}

	broadcaster := &captureBroadcaster{}
	app.SetBroadcaster(broadcaster)

	if err := app.CreateWorkspace(projectPath, "demo", "demo"); err != nil {
		t.Fatalf("CreateWorkspace failed: %v", err)
	}

	workspacePath := filepath.Join(projectPath, ".ropcode", "demo")
	if info, err := os.Stat(workspacePath); err != nil || !info.IsDir() {
		t.Fatalf("expected workspace directory %s, info=%+v err=%v", workspacePath, info, err)
	}
	project, err := app.dbManager.GetProjectIndex(filepath.Base(projectPath))
	if err != nil {
		t.Fatalf("GetProjectIndex failed: %v", err)
	}
	foundPath := ""
	for i := range project.Workspaces {
		if project.Workspaces[i].Name == "demo" && len(project.Workspaces[i].Providers) > 0 {
			foundPath = project.Workspaces[i].Providers[0].Path
			break
		}
	}
	if foundPath == "" {
		t.Fatalf("workspace demo not indexed: %+v", project.Workspaces)
	}
	if foundPath != workspacePath {
		t.Fatalf("expected workspace path %q, got %q", workspacePath, foundPath)
	}

	for _, event := range broadcaster.events {
		if event.eventType != "project:changed" {
			continue
		}
		payload, ok := event.payload.(ProjectChangedEvent)
		if !ok {
			t.Fatalf("expected ProjectChangedEvent payload, got %T", event.payload)
		}
		if payload.Reason == "workspace-created" && payload.WorkspaceName == "demo" {
			return
		}
	}
	t.Fatalf("workspace-created project:changed event not emitted: %+v", broadcaster.events)
}

type captureBroadcaster struct {
	events []capturedProjectEvent
}

func (b *captureBroadcaster) BroadcastEvent(eventType string, payload interface{}) {
	b.events = append(b.events, capturedProjectEvent{eventType: eventType, payload: payload})
}

func TestCreateWorkspaceEmitsProjectChangedEvent(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	ctx := context.Background()
	app, cleanup, err := appRuntime.StartForTest(ctx, NewApp)
	if err != nil {
		t.Fatalf("StartForTest failed: %v", err)
	}
	defer cleanup(ctx)

	projectPath := filepath.Join(t.TempDir(), "project-events")
	if output, err := exec.Command("git", "init", projectPath).CombinedOutput(); err != nil {
		t.Fatalf("git init failed: %s: %v", string(output), err)
	}
	if err := app.CreateProject(projectPath); err != nil {
		t.Fatalf("CreateProject failed: %v", err)
	}

	broadcaster := &captureBroadcaster{}
	app.SetBroadcaster(broadcaster)

	if err := app.CreateWorkspace(projectPath, "event-sync", "event-sync"); err != nil {
		t.Fatalf("CreateWorkspace failed: %v", err)
	}

	for _, event := range broadcaster.events {
		if event.eventType != "project:changed" {
			continue
		}
		payload, ok := event.payload.(ProjectChangedEvent)
		if !ok {
			t.Fatalf("expected ProjectChangedEvent payload, got %T", event.payload)
		}
		if payload.ProjectPath != projectPath {
			t.Fatalf("expected project path %q, got %q", projectPath, payload.ProjectPath)
		}
		if payload.Reason != "workspace-created" {
			t.Fatalf("expected workspace-created reason, got %q", payload.Reason)
		}
		if payload.WorkspaceName != "event-sync" {
			t.Fatalf("expected workspace name event-sync, got %q", payload.WorkspaceName)
		}
		if payload.Timestamp.IsZero() {
			t.Fatal("expected non-zero timestamp")
		}
		if time.Since(payload.Timestamp) > time.Minute {
			t.Fatalf("expected recent timestamp, got %s", payload.Timestamp)
		}
		return
	}
	t.Fatalf("project:changed event not emitted: %+v", broadcaster.events)
}
