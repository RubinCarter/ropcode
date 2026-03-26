package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/websocket"
)

type cliTestApp struct {
	db *database.Database
}

func (a *cliTestApp) Database() *database.Database {
	return a.db
}

func (a *cliTestApp) Greet(name string) string {
	return "Hello " + name + ", Welcome to ropcode!"
}

func setupCLITestDB(t *testing.T) (*config.Config, *database.Database) {
	t.Helper()

	t.Setenv("HOME", t.TempDir())

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	return cfg, db
}

func seedInstance(t *testing.T, db *database.Database, id string, status string) {
	t.Helper()

	now := time.Now().UnixMilli()
	record := &database.InstanceRecord{
		ID:           id,
		Host:         "127.0.0.1",
		Port:         5173,
		AuthKey:      "",
		PID:          os.Getpid(),
		StartedAt:    now,
		HeartbeatAt:  now,
		Status:       status,
		Capabilities: []string{"rpc", "events"},
	}
	if err := db.SaveInstanceRecord(record); err != nil {
		t.Fatalf("SaveInstanceRecord failed: %v", err)
	}
}

func runCLI(t *testing.T, args ...string) (string, string, error) {
	t.Helper()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := runCLIArgs(args, &stdout, &stderr, defaultCLIDeps())
	return stdout.String(), stderr.String(), err
}

func TestInstanceListCommand(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")

	stdout, stderr, err := runCLI(t, "instance", "list")
	if err != nil {
		t.Fatalf("instance list failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "inst-a") {
		t.Fatalf("expected registered instance in output, got %q", stdout)
	}
}

func TestInstanceCurrentCommand_UsesSavedSelection(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")

	if err := saveCLIContext(cfg, cliContext{CurrentInstanceID: "inst-a"}); err != nil {
		t.Fatalf("saveCLIContext failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "instance", "current")
	if err != nil {
		t.Fatalf("instance current failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "inst-a") {
		t.Fatalf("expected saved instance in output, got %q", stdout)
	}
}

func TestInstanceUseCommand(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")

	stdout, stderr, err := runCLI(t, "instance", "use", "inst-a")
	if err != nil {
		t.Fatalf("instance use failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "inst-a") {
		t.Fatalf("expected selected instance in output, got %q", stdout)
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		t.Fatalf("loadCLIContext failed: %v", err)
	}
	if ctx.CurrentInstanceID != "inst-a" {
		t.Fatalf("expected current instance inst-a, got %q", ctx.CurrentInstanceID)
	}
}

func TestContextShowCommand_AttachesToResolvedInstance(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	server := websocket.NewServer(&cliTestApp{db: db})
	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	if err := saveCLIContext(cfg, cliContext{CurrentInstanceID: server.GetInstanceID()}); err != nil {
		t.Fatalf("saveCLIContext failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "context", "show")
	if err != nil {
		t.Fatalf("context show failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, server.GetInstanceID()) {
		t.Fatalf("expected instance id in output, got %q", stdout)
	}
	if !strings.Contains(stdout, fmt.Sprintf("ws://127.0.0.1:%d/ws", port)) {
		t.Fatalf("expected websocket url in output, got %q", stdout)
	}
}

func TestResolveInstance(t *testing.T) {
	t.Run("explicit wins over saved", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")
		if err := saveCLIContext(cfg, cliContext{CurrentInstanceID: "inst-a"}); err != nil {
			t.Fatalf("saveCLIContext failed: %v", err)
		}

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "inst-b")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-b" || source != "explicit" {
			t.Fatalf("expected explicit inst-b, got id=%q source=%q", record.ID, source)
		}
	})

	t.Run("saved instance used when available", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")
		if err := saveCLIContext(cfg, cliContext{CurrentInstanceID: "inst-a"}); err != nil {
			t.Fatalf("saveCLIContext failed: %v", err)
		}

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-a" || source != "saved" {
			t.Fatalf("expected saved inst-a, got id=%q source=%q", record.ID, source)
		}
	})

	t.Run("single alive instance auto selected", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-a" || source != "auto" {
			t.Fatalf("expected auto inst-a, got id=%q source=%q", record.ID, source)
		}
	})

	t.Run("no alive instances returns actionable error", func(t *testing.T) {
		cfg, _ := setupCLITestDB(t)

		_, _, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err == nil || !strings.Contains(err.Error(), "ropcode instance list") {
			t.Fatalf("expected actionable error, got %v", err)
		}
	})

	t.Run("multiple alive instances returns actionable error", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")

		_, _, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err == nil || !strings.Contains(err.Error(), "ropcode instance use <id>") {
			t.Fatalf("expected actionable error, got %v", err)
		}
	})
}
