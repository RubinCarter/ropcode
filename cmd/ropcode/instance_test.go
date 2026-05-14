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

	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

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

func TestRootHelpCommand(t *testing.T) {
	stdout, stderr, err := runCLI(t, "--help")
	if err != nil {
		t.Fatalf("root help failed: %v\n%s", err, stderr)
	}
	for _, want := range []string{"ropcode catalog [--instance <id>] [--project <name-or-path>] [--workspace <name>] [--cwd <path>]", "ropcode workspace send", "ropcode workspace status"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("expected %q in root help, got %q", want, stdout)
		}
	}
}

func TestCatalogHelpCommand(t *testing.T) {
	stdout, stderr, err := runCLI(t, "catalog", "--help")
	if err != nil {
		t.Fatalf("catalog help failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "ropcode catalog [--instance <id>] [--project <name-or-path>] [--workspace <name>] [--cwd <path>]") {
		t.Fatalf("expected layered catalog help, got %q", stdout)
	}
}

func TestCatalogShowsInstancesAtTopLevel(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")

	stdout, stderr, err := runCLI(t, "catalog")
	if err != nil {
		t.Fatalf("catalog failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "inst-a") {
		t.Fatalf("expected instance in output, got %q", stdout)
	}
}

func TestContextShowCommand_AttachesToExplicitInstance(t *testing.T) {
	_, db := setupCLITestDB(t)
	server := websocket.NewServer(&cliTestApp{db: db})
	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	stdout, stderr, err := runCLI(t, "runtime", "context", "show", "--instance", server.GetInstanceID())
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
	t.Run("explicit instance resolves directly", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "inst-b")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-b" || source != "explicit" {
			t.Fatalf("expected explicit inst-b, got id=%q source=%q", record.ID, source)
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
		if err == nil || !strings.Contains(err.Error(), "ropcode catalog") {
			t.Fatalf("expected actionable error, got %v", err)
		}
	})

	t.Run("multiple alive instances returns explicit flag error", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")

		_, _, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err == nil || !strings.Contains(err.Error(), "--instance <id>") {
			t.Fatalf("expected explicit instance error, got %v", err)
		}
	})
}
