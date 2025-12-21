package claude

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListClaudeConfigAgents(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()
	userAgentsDir := filepath.Join(tmpDir, ".claude", "agents")
	projectDir := filepath.Join(tmpDir, "project")
	projectAgentsDir := filepath.Join(projectDir, ".claude", "agents")

	// Create directories
	if err := os.MkdirAll(userAgentsDir, 0755); err != nil {
		t.Fatalf("Failed to create user agents dir: %v", err)
	}
	if err := os.MkdirAll(projectAgentsDir, 0755); err != nil {
		t.Fatalf("Failed to create project agents dir: %v", err)
	}

	// Create test agent files
	userAgent := `---
description: A user-level test agent
tools: bash,edit
color: blue
model: claude-3-5-sonnet-20241022
---

You are a helpful assistant for testing.`

	projectAgent := `---
description: A project-level test agent
tools: bash
color: green
---

You are a project-specific assistant.`

	// Write user agent
	userAgentPath := filepath.Join(userAgentsDir, "test-user.md")
	if err := os.WriteFile(userAgentPath, []byte(userAgent), 0644); err != nil {
		t.Fatalf("Failed to write user agent: %v", err)
	}

	// Write project agent
	projectAgentPath := filepath.Join(projectAgentsDir, "test-project.md")
	if err := os.WriteFile(projectAgentPath, []byte(projectAgent), 0644); err != nil {
		t.Fatalf("Failed to write project agent: %v", err)
	}

	// Temporarily replace home directory for testing
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	// Test listing agents
	agents, err := ListClaudeConfigAgents(projectDir)
	if err != nil {
		t.Fatalf("ListClaudeConfigAgents failed: %v", err)
	}

	if len(agents) != 2 {
		t.Fatalf("Expected 2 agents, got %d", len(agents))
	}

	// Verify user agent
	found := false
	for _, agent := range agents {
		if agent.Name == "test-user" && agent.Scope == "user" {
			found = true
			if agent.Description != "A user-level test agent" {
				t.Errorf("Expected description 'A user-level test agent', got '%s'", agent.Description)
			}
			if agent.Tools != "bash,edit" {
				t.Errorf("Expected tools 'bash,edit', got '%s'", agent.Tools)
			}
			if agent.Color != "blue" {
				t.Errorf("Expected color 'blue', got '%s'", agent.Color)
			}
			if agent.Model != "claude-3-5-sonnet-20241022" {
				t.Errorf("Expected model 'claude-3-5-sonnet-20241022', got '%s'", agent.Model)
			}
			if agent.SystemPrompt != "You are a helpful assistant for testing." {
				t.Errorf("Expected system prompt 'You are a helpful assistant for testing.', got '%s'", agent.SystemPrompt)
			}
		}
	}

	if !found {
		t.Error("User agent 'test-user' not found")
	}

	// Verify project agent
	found = false
	for _, agent := range agents {
		if agent.Name == "test-project" && agent.Scope == "project" {
			found = true
			if agent.Description != "A project-level test agent" {
				t.Errorf("Expected description 'A project-level test agent', got '%s'", agent.Description)
			}
		}
	}

	if !found {
		t.Error("Project agent 'test-project' not found")
	}
}

func TestGetClaudeAgent(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()
	userAgentsDir := filepath.Join(tmpDir, ".claude", "agents")

	// Create directory
	if err := os.MkdirAll(userAgentsDir, 0755); err != nil {
		t.Fatalf("Failed to create user agents dir: %v", err)
	}

	// Create test agent file
	agentContent := `---
description: Test agent
tools: bash
color: red
---

Test system prompt.`

	agentPath := filepath.Join(userAgentsDir, "test.md")
	if err := os.WriteFile(agentPath, []byte(agentContent), 0644); err != nil {
		t.Fatalf("Failed to write agent: %v", err)
	}

	// Temporarily replace home directory for testing
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	// Test getting agent
	agent, err := GetClaudeAgent("user", "test", "")
	if err != nil {
		t.Fatalf("GetClaudeAgent failed: %v", err)
	}

	if agent.Name != "test" {
		t.Errorf("Expected name 'test', got '%s'", agent.Name)
	}
	if agent.Scope != "user" {
		t.Errorf("Expected scope 'user', got '%s'", agent.Scope)
	}
	if agent.Description != "Test agent" {
		t.Errorf("Expected description 'Test agent', got '%s'", agent.Description)
	}
	if agent.SystemPrompt != "Test system prompt." {
		t.Errorf("Expected system prompt 'Test system prompt.', got '%s'", agent.SystemPrompt)
	}

	// Test non-existent agent
	_, err = GetClaudeAgent("user", "nonexistent", "")
	if err == nil {
		t.Error("Expected error for non-existent agent")
	}
}

func TestSaveClaudeAgent(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()

	// Temporarily replace home directory for testing
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	// Create test agent
	agent := &ClaudeAgent{
		Name:         "new-agent",
		Description:  "A new test agent",
		Tools:        "bash,edit",
		Color:        "purple",
		Model:        "claude-3-5-sonnet-20241022",
		SystemPrompt: "You are a new agent.",
		Scope:        "user",
	}

	// Save agent
	err := SaveClaudeAgent(agent, "")
	if err != nil {
		t.Fatalf("SaveClaudeAgent failed: %v", err)
	}

	// Verify file was created
	expectedPath := filepath.Join(tmpDir, ".claude", "agents", "new-agent.md")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Error("Agent file was not created")
	}

	// Read back and verify
	savedAgent, err := GetClaudeAgent("user", "new-agent", "")
	if err != nil {
		t.Fatalf("Failed to read saved agent: %v", err)
	}

	if savedAgent.Description != agent.Description {
		t.Errorf("Description mismatch: expected '%s', got '%s'", agent.Description, savedAgent.Description)
	}
	if savedAgent.Tools != agent.Tools {
		t.Errorf("Tools mismatch: expected '%s', got '%s'", agent.Tools, savedAgent.Tools)
	}
	if savedAgent.Color != agent.Color {
		t.Errorf("Color mismatch: expected '%s', got '%s'", agent.Color, savedAgent.Color)
	}
	if savedAgent.Model != agent.Model {
		t.Errorf("Model mismatch: expected '%s', got '%s'", agent.Model, savedAgent.Model)
	}
	if savedAgent.SystemPrompt != agent.SystemPrompt {
		t.Errorf("SystemPrompt mismatch: expected '%s', got '%s'", agent.SystemPrompt, savedAgent.SystemPrompt)
	}
}

func TestDeleteClaudeAgent(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()
	userAgentsDir := filepath.Join(tmpDir, ".claude", "agents")

	// Create directory
	if err := os.MkdirAll(userAgentsDir, 0755); err != nil {
		t.Fatalf("Failed to create user agents dir: %v", err)
	}

	// Create test agent file
	agentPath := filepath.Join(userAgentsDir, "delete-me.md")
	if err := os.WriteFile(agentPath, []byte("---\n---\n\nTest agent"), 0644); err != nil {
		t.Fatalf("Failed to write agent: %v", err)
	}

	// Temporarily replace home directory for testing
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	// Delete agent
	err := DeleteClaudeAgent("user", "delete-me", "")
	if err != nil {
		t.Fatalf("DeleteClaudeAgent failed: %v", err)
	}

	// Verify file was deleted
	if _, err := os.Stat(agentPath); !os.IsNotExist(err) {
		t.Error("Agent file was not deleted")
	}

	// Try deleting non-existent agent
	err = DeleteClaudeAgent("user", "nonexistent", "")
	if err == nil {
		t.Error("Expected error when deleting non-existent agent")
	}
}

func TestSaveClaudeAgentProjectScope(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "project")

	// Create test agent
	agent := &ClaudeAgent{
		Name:         "project-agent",
		Description:  "A project agent",
		SystemPrompt: "Project-specific assistant.",
		Scope:        "project",
	}

	// Save agent
	err := SaveClaudeAgent(agent, projectDir)
	if err != nil {
		t.Fatalf("SaveClaudeAgent failed: %v", err)
	}

	// Verify file was created
	expectedPath := filepath.Join(projectDir, ".claude", "agents", "project-agent.md")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Error("Project agent file was not created")
	}

	// Read back and verify
	savedAgent, err := GetClaudeAgent("project", "project-agent", projectDir)
	if err != nil {
		t.Fatalf("Failed to read saved project agent: %v", err)
	}

	if savedAgent.Scope != "project" {
		t.Errorf("Expected scope 'project', got '%s'", savedAgent.Scope)
	}
	if savedAgent.SystemPrompt != agent.SystemPrompt {
		t.Errorf("SystemPrompt mismatch: expected '%s', got '%s'", agent.SystemPrompt, savedAgent.SystemPrompt)
	}
}
