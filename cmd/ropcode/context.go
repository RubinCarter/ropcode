package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	appRuntime "ropcode/internal/runtime"
)

var staleGracePeriod = 90 * time.Second

type cliContext struct {
	CurrentInstanceID string `json:"current_instance_id,omitempty"`
}

func runContextCommand(state cliState, args []string) error {
	if len(args) != 1 || args[0] != "show" {
		return errors.New("usage: ropcode context show [--instance <id>]")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return err
	}

	client, err := state.deps.dialRPC(instanceWSURL(record), record.AuthKey)
	if err != nil {
		return fmt.Errorf("attach to instance %s: %w", record.ID, err)
	}
	defer client.Close()

	fmt.Fprintf(state.stdout, "instance\t%s\n", record.ID)
	fmt.Fprintf(state.stdout, "source\t%s\n", source)
	fmt.Fprintf(state.stdout, "url\t%s\n", instanceWSURL(record))
	fmt.Fprintf(state.stdout, "status\tattached\n")
	return nil
}

func loadCLIContext(cfg *config.Config) (cliContext, error) {
	data, err := os.ReadFile(cfg.CLIContextPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cliContext{}, nil
		}
		return cliContext{}, err
	}
	if len(data) == 0 {
		return cliContext{}, nil
	}

	var ctx cliContext
	if err := json.Unmarshal(data, &ctx); err != nil {
		return cliContext{}, err
	}
	return ctx, nil
}

func saveCLIContext(cfg *config.Config, ctx cliContext) error {
	data, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfg.CLIContextPath(), data, 0644)
}

func resolveInstance(deps cliDeps, cfg *config.Config, explicitID string) (*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(deps, cfg)
	if err != nil {
		return nil, "", err
	}

	if explicitID != "" {
		record := findInstanceByID(alive, explicitID)
		if record == nil {
			return nil, "", fmt.Errorf("instance %q is not alive; run `ropcode instance list`", explicitID)
		}
		return record, "explicit", nil
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	if ctx.CurrentInstanceID != "" {
		record := findInstanceByID(alive, ctx.CurrentInstanceID)
		if record != nil {
			return record, "saved", nil
		}
	}

	if len(alive) == 1 {
		return alive[0], "auto", nil
	}
	if len(alive) == 0 {
		return nil, "", errors.New("no alive instances found; start ropcode and run `ropcode instance list`")
	}

	var msg strings.Builder
	msg.WriteString("multiple alive instances found; use `ropcode instance use <id>` or pass `--instance <id>`")
	if ctx.CurrentInstanceID != "" {
		fmt.Fprintf(&msg, " (saved instance %q is unavailable)", ctx.CurrentInstanceID)
	}
	return nil, "", errors.New(msg.String())
}

func listAliveInstancesForOutput(state cliState, cfg *config.Config) ([]*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(state.deps, cfg)
	if err != nil {
		return nil, "", err
	}
	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	return alive, ctx.CurrentInstanceID, nil
}

func listAliveInstances(deps cliDeps, cfg *config.Config) ([]*database.InstanceRecord, error) {
	db, err := deps.openDB(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	registry := appRuntime.NewRegistry(db)
	cutoff := deps.now().Add(-staleGracePeriod).UnixMilli()
	instances, err := registry.ListAliveInstances(cutoff)
	if err != nil {
		return nil, fmt.Errorf("list alive instances: %w", err)
	}
	return instances, nil
}

func findInstanceByID(instances []*database.InstanceRecord, id string) *database.InstanceRecord {
	for _, inst := range instances {
		if inst.ID == id {
			return inst
		}
	}
	return nil
}

func instanceWSURL(record *database.InstanceRecord) string {
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("ws://%s:%d/ws", host, record.Port)
}
