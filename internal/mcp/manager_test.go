package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNewManager(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	if manager == nil {
		t.Fatal("NewManager returned nil")
	}

	expectedPath := filepath.Join(tmpDir, "settings.json")
	if manager.settingsPath != expectedPath {
		t.Errorf("Expected settings path %s, got %s", expectedPath, manager.settingsPath)
	}
}

func TestListMcpServers_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	servers, err := manager.ListMcpServers()
	if err != nil {
		t.Fatalf("ListMcpServers failed: %v", err)
	}

	if len(servers) != 0 {
		t.Errorf("Expected 0 servers, got %d", len(servers))
	}
}

func TestSaveAndGetMcpServer(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	// Save a server
	config := &MCPServerConfig{
		Command: "node",
		Args:    []string{"/path/to/server.js"},
		Env: map[string]string{
			"API_KEY": "test-key",
		},
	}

	err := manager.SaveMcpServer("test-server", config)
	if err != nil {
		t.Fatalf("SaveMcpServer failed: %v", err)
	}

	// Get the server
	server, err := manager.GetMcpServer("test-server")
	if err != nil {
		t.Fatalf("GetMcpServer failed: %v", err)
	}

	if server.Name != "test-server" {
		t.Errorf("Expected name 'test-server', got '%s'", server.Name)
	}

	if server.Command != "node" {
		t.Errorf("Expected command 'node', got '%s'", server.Command)
	}

	if len(server.Args) != 1 || server.Args[0] != "/path/to/server.js" {
		t.Errorf("Expected args ['/path/to/server.js'], got %v", server.Args)
	}

	if server.Env["API_KEY"] != "test-key" {
		t.Errorf("Expected env API_KEY='test-key', got '%s'", server.Env["API_KEY"])
	}

	if server.Transport != "stdio" {
		t.Errorf("Expected transport 'stdio', got '%s'", server.Transport)
	}
}

func TestListMcpServers(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	// Save multiple servers
	servers := map[string]*MCPServerConfig{
		"server1": {
			Command: "node",
			Args:    []string{"server1.js"},
			Env:     map[string]string{"KEY1": "value1"},
		},
		"server2": {
			Command: "python",
			Args:    []string{"server2.py"},
			Env:     map[string]string{"KEY2": "value2"},
		},
	}

	for name, config := range servers {
		if err := manager.SaveMcpServer(name, config); err != nil {
			t.Fatalf("SaveMcpServer(%s) failed: %v", name, err)
		}
	}

	// List servers
	list, err := manager.ListMcpServers()
	if err != nil {
		t.Fatalf("ListMcpServers failed: %v", err)
	}

	if len(list) != 2 {
		t.Errorf("Expected 2 servers, got %d", len(list))
	}

	// Verify server names
	names := make(map[string]bool)
	for _, srv := range list {
		names[srv.Name] = true
	}

	if !names["server1"] || !names["server2"] {
		t.Errorf("Expected servers 'server1' and 'server2', got %v", names)
	}
}

func TestDeleteMcpServer(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	// Save a server
	config := &MCPServerConfig{
		Command: "node",
		Args:    []string{"server.js"},
	}

	err := manager.SaveMcpServer("test-server", config)
	if err != nil {
		t.Fatalf("SaveMcpServer failed: %v", err)
	}

	// Verify it exists
	_, err = manager.GetMcpServer("test-server")
	if err != nil {
		t.Fatalf("GetMcpServer failed: %v", err)
	}

	// Delete it
	err = manager.DeleteMcpServer("test-server")
	if err != nil {
		t.Fatalf("DeleteMcpServer failed: %v", err)
	}

	// Verify it's gone
	_, err = manager.GetMcpServer("test-server")
	if err == nil {
		t.Error("Expected error when getting deleted server, got nil")
	}
}

func TestDeleteNonExistentServer(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	err := manager.DeleteMcpServer("non-existent")
	if err == nil {
		t.Error("Expected error when deleting non-existent server, got nil")
	}
}

func TestGetNonExistentServer(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	_, err := manager.GetMcpServer("non-existent")
	if err == nil {
		t.Error("Expected error when getting non-existent server, got nil")
	}
}

func TestSaveServerWithURL(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	// Save a server with URL (SSE transport)
	config := &MCPServerConfig{
		URL: "http://localhost:8080/sse",
		Env: map[string]string{
			"TOKEN": "test-token",
		},
	}

	err := manager.SaveMcpServer("sse-server", config)
	if err != nil {
		t.Fatalf("SaveMcpServer failed: %v", err)
	}

	// Get the server
	server, err := manager.GetMcpServer("sse-server")
	if err != nil {
		t.Fatalf("GetMcpServer failed: %v", err)
	}

	if server.URL != "http://localhost:8080/sse" {
		t.Errorf("Expected URL 'http://localhost:8080/sse', got '%s'", server.URL)
	}

	if server.Transport != "sse" {
		t.Errorf("Expected transport 'sse', got '%s'", server.Transport)
	}
}

func TestGetMcpServerStatus(t *testing.T) {
	tmpDir := t.TempDir()
	manager := NewManager(tmpDir)

	// Save a server
	config := &MCPServerConfig{
		Command: "node",
		Args:    []string{"server.js"},
	}

	err := manager.SaveMcpServer("test-server", config)
	if err != nil {
		t.Fatalf("SaveMcpServer failed: %v", err)
	}

	// Get status
	status, err := manager.GetMcpServerStatus("test-server")
	if err != nil {
		t.Fatalf("GetMcpServerStatus failed: %v", err)
	}

	if status == nil {
		t.Fatal("GetMcpServerStatus returned nil status")
	}

	// Status should default to not running
	if status.Running {
		t.Error("Expected status.Running to be false")
	}
}

func TestExistingSettingsFile(t *testing.T) {
	tmpDir := t.TempDir()
	settingsPath := filepath.Join(tmpDir, "settings.json")

	// Create existing settings file
	existingSettings := map[string]interface{}{
		"someOtherSetting": "value",
		"mcpServers": map[string]interface{}{
			"existing-server": map[string]interface{}{
				"command": "python",
				"args":    []interface{}{"existing.py"},
			},
		},
	}

	data, _ := json.MarshalIndent(existingSettings, "", "  ")
	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("Failed to write test settings file: %v", err)
	}

	// Create manager and list servers
	manager := NewManager(tmpDir)
	servers, err := manager.ListMcpServers()
	if err != nil {
		t.Fatalf("ListMcpServers failed: %v", err)
	}

	if len(servers) != 1 {
		t.Errorf("Expected 1 server, got %d", len(servers))
	}

	if servers[0].Name != "existing-server" {
		t.Errorf("Expected server name 'existing-server', got '%s'", servers[0].Name)
	}

	// Add a new server
	newConfig := &MCPServerConfig{
		Command: "node",
		Args:    []string{"new.js"},
	}

	if err := manager.SaveMcpServer("new-server", newConfig); err != nil {
		t.Fatalf("SaveMcpServer failed: %v", err)
	}

	// Verify other settings are preserved
	settings, err := manager.loadSettings()
	if err != nil {
		t.Fatalf("loadSettings failed: %v", err)
	}

	if settings["someOtherSetting"] != "value" {
		t.Error("Existing settings were not preserved")
	}
}
