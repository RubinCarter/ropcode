// internal/database/db_test.go
package database

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func openTestDB(t *testing.T) *Database {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}

	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	})

	return db
}

func TestDatabase_Open(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Verify file exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("Database file was not created")
	}
}

func TestDatabase_InstanceRegistryCRUD(t *testing.T) {
	db := openTestDB(t)

	inst := &InstanceRecord{
		ID:           "inst-a",
		Label:        "Primary",
		Host:         "127.0.0.1",
		Port:         5173,
		AuthKey:      "secret",
		PID:          4242,
		StartedAt:    100,
		HeartbeatAt:  200,
		Status:       "alive",
		Capabilities: []string{"rpc", "events"},
	}
	if err := db.SaveInstanceRecord(inst); err != nil {
		t.Fatalf("SaveInstanceRecord failed: %v", err)
	}

	gotOne, err := db.GetInstanceRecord("inst-a")
	if err != nil {
		t.Fatalf("GetInstanceRecord failed: %v", err)
	}
	if gotOne.Port != 5173 || gotOne.Status != "alive" {
		t.Fatalf("unexpected record: %+v", gotOne)
	}
	if !reflect.DeepEqual(gotOne.Capabilities, []string{"rpc", "events"}) {
		t.Fatalf("unexpected capabilities: %#v", gotOne.Capabilities)
	}

	got, err := db.ListInstanceRecords()
	if err != nil {
		t.Fatalf("ListInstanceRecords failed: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(got))
	}

	inst.HeartbeatAt = 300
	inst.Status = "alive"
	inst.Capabilities = []string{"rpc", "events", "cli"}
	if err := db.SaveInstanceRecord(inst); err != nil {
		t.Fatalf("SaveInstanceRecord update failed: %v", err)
	}

	staleCount, err := db.MarkInstanceStaleBefore(301)
	if err != nil {
		t.Fatalf("MarkInstanceStaleBefore failed: %v", err)
	}
	if staleCount != 1 {
		t.Fatalf("expected 1 stale record, got %d", staleCount)
	}

	stale, err := db.GetInstanceRecord("inst-a")
	if err != nil {
		t.Fatalf("GetInstanceRecord after stale failed: %v", err)
	}
	if stale.Status != "stale" {
		t.Fatalf("expected status stale, got %q", stale.Status)
	}
	if !reflect.DeepEqual(stale.Capabilities, []string{"rpc", "events", "cli"}) {
		t.Fatalf("unexpected updated capabilities: %#v", stale.Capabilities)
	}

	if err := db.DeleteInstanceRecord("inst-a"); err != nil {
		t.Fatalf("DeleteInstanceRecord failed: %v", err)
	}

	got, err = db.ListInstanceRecords()
	if err != nil {
		t.Fatalf("ListInstanceRecords after delete failed: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 instances after delete, got %d", len(got))
	}
}

func TestDatabase_ProviderApiConfig(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Save config
	config := &ProviderApiConfig{
		ID:         "test-id",
		Name:       "Test Config",
		ProviderID: "claude",
		BaseURL:    "https://api.anthropic.com",
		IsDefault:  true,
	}

	err = db.SaveProviderApiConfig(config)
	if err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}

	// Retrieve config
	retrieved, err := db.GetProviderApiConfig("test-id")
	if err != nil {
		t.Fatalf("GetProviderApiConfig failed: %v", err)
	}

	if retrieved.Name != "Test Config" {
		t.Errorf("Expected name 'Test Config', got '%s'", retrieved.Name)
	}

	if retrieved.ProviderID != "claude" {
		t.Errorf("Expected provider_id 'claude', got '%s'", retrieved.ProviderID)
	}
}

func TestDatabase_Settings(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Save setting
	err = db.SaveSetting("theme", "dark")
	if err != nil {
		t.Fatalf("SaveSetting failed: %v", err)
	}

	// Retrieve setting
	value, err := db.GetSetting("theme")
	if err != nil {
		t.Fatalf("GetSetting failed: %v", err)
	}

	if value != "dark" {
		t.Errorf("Expected 'dark', got '%s'", value)
	}
}

func TestDatabase_ProjectIndex(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Save project
	project := &ProjectIndex{
		Name:        "/home/user/myproject",
		AddedAt:     1234567890,
		Available:   true,
		ProjectType: "git",
	}

	err = db.SaveProjectIndex(project)
	if err != nil {
		t.Fatalf("SaveProjectIndex failed: %v", err)
	}

	// Retrieve project
	retrieved, err := db.GetProjectIndex("/home/user/myproject")
	if err != nil {
		t.Fatalf("GetProjectIndex failed: %v", err)
	}

	if retrieved.ProjectType != "git" {
		t.Errorf("Expected project_type 'git', got '%s'", retrieved.ProjectType)
	}
}

func TestDatabase_AgentCRUD(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Test CreateAgent
	agent := &Agent{
		Name:          "Test Agent",
		Icon:          "🤖",
		SystemPrompt:  "You are a helpful assistant",
		DefaultTask:   "Help with coding",
		Model:         "sonnet",
		ProviderApiID: "api-123",
		Hooks:         `{"pre": "echo test"}`,
	}

	id, err := db.CreateAgent(agent)
	if err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}
	if id == 0 {
		t.Error("Expected non-zero ID")
	}

	// Test GetAgent
	retrieved, err := db.GetAgent(id)
	if err != nil {
		t.Fatalf("GetAgent failed: %v", err)
	}
	if retrieved.Name != "Test Agent" {
		t.Errorf("Expected name 'Test Agent', got '%s'", retrieved.Name)
	}
	if retrieved.Icon != "🤖" {
		t.Errorf("Expected icon '🤖', got '%s'", retrieved.Icon)
	}
	if retrieved.SystemPrompt != "You are a helpful assistant" {
		t.Errorf("Expected system_prompt 'You are a helpful assistant', got '%s'", retrieved.SystemPrompt)
	}

	// Test ListAgents
	agents, err := db.ListAgents()
	if err != nil {
		t.Fatalf("ListAgents failed: %v", err)
	}
	if len(agents) != 1 {
		t.Errorf("Expected 1 agent, got %d", len(agents))
	}

	// Test UpdateAgent
	agent.Name = "Updated Agent"
	agent.Model = "opus"
	err = db.UpdateAgent(agent)
	if err != nil {
		t.Fatalf("UpdateAgent failed: %v", err)
	}

	updated, err := db.GetAgent(id)
	if err != nil {
		t.Fatalf("GetAgent after update failed: %v", err)
	}
	if updated.Name != "Updated Agent" {
		t.Errorf("Expected name 'Updated Agent', got '%s'", updated.Name)
	}
	if updated.Model != "opus" {
		t.Errorf("Expected model 'opus', got '%s'", updated.Model)
	}

	// Test DeleteAgent
	err = db.DeleteAgent(id)
	if err != nil {
		t.Fatalf("DeleteAgent failed: %v", err)
	}

	// Verify deletion
	agents, err = db.ListAgents()
	if err != nil {
		t.Fatalf("ListAgents after delete failed: %v", err)
	}
	if len(agents) != 0 {
		t.Errorf("Expected 0 agents after delete, got %d", len(agents))
	}
}

func TestDatabase_AgentExportImport(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	// Create an agent
	agent := &Agent{
		Name:          "Export Test Agent",
		Icon:          "🚀",
		SystemPrompt:  "You are an export test assistant",
		DefaultTask:   "Test export functionality",
		Model:         "sonnet-4",
		ProviderApiID: "export-api",
		Hooks:         `{"pre": "echo export"}`,
	}

	id, err := db.CreateAgent(agent)
	if err != nil {
		t.Fatalf("CreateAgent failed: %v", err)
	}

	// Test ExportAgent to JSON string
	jsonData, err := db.ExportAgent(id)
	if err != nil {
		t.Fatalf("ExportAgent failed: %v", err)
	}

	if jsonData == "" {
		t.Error("Expected non-empty JSON data")
	}

	// Test ExportAgentToFile
	exportPath := filepath.Join(tmpDir, "exported-agent.json")
	err = db.ExportAgentToFile(id, exportPath)
	if err != nil {
		t.Fatalf("ExportAgentToFile failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(exportPath); os.IsNotExist(err) {
		t.Error("Exported file was not created")
	}

	// Delete the original agent
	err = db.DeleteAgent(id)
	if err != nil {
		t.Fatalf("DeleteAgent failed: %v", err)
	}

	// Test ImportAgent from JSON string
	imported, err := db.ImportAgent(jsonData)
	if err != nil {
		t.Fatalf("ImportAgent failed: %v", err)
	}

	if imported.Name != "Export Test Agent" {
		t.Errorf("Expected name 'Export Test Agent', got '%s'", imported.Name)
	}
	if imported.Icon != "🚀" {
		t.Errorf("Expected icon '🚀', got '%s'", imported.Icon)
	}
	if imported.SystemPrompt != "You are an export test assistant" {
		t.Errorf("Expected system_prompt 'You are an export test assistant', got '%s'", imported.SystemPrompt)
	}
	if imported.Model != "sonnet-4" {
		t.Errorf("Expected model 'sonnet-4', got '%s'", imported.Model)
	}

	// Delete imported agent
	err = db.DeleteAgent(imported.ID)
	if err != nil {
		t.Fatalf("DeleteAgent after import failed: %v", err)
	}

	// Test ImportAgentFromFile
	imported2, err := db.ImportAgentFromFile(exportPath)
	if err != nil {
		t.Fatalf("ImportAgentFromFile failed: %v", err)
	}

	if imported2.Name != "Export Test Agent" {
		t.Errorf("Expected name 'Export Test Agent', got '%s'", imported2.Name)
	}
	if imported2.DefaultTask != "Test export functionality" {
		t.Errorf("Expected default_task 'Test export functionality', got '%s'", imported2.DefaultTask)
	}
}
