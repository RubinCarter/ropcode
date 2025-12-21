// internal/agents/github_test.go
package agents

import (
	"testing"
)

func TestPredefinedAgents(t *testing.T) {
	agents := PredefinedAgents()

	if len(agents) == 0 {
		t.Fatal("Expected predefined agents, got none")
	}

	// Check that all agents have required fields
	for _, agent := range agents {
		if agent.Name == "" {
			t.Error("Agent missing name")
		}
		if agent.Icon == "" {
			t.Error("Agent missing icon")
		}
		if agent.SystemPrompt == "" {
			t.Error("Agent missing system prompt")
		}
		if agent.Model == "" {
			t.Error("Agent missing model")
		}
	}

	// Check for specific agents
	foundCodeReviewer := false
	for _, agent := range agents {
		if agent.Name == "Code Reviewer" {
			foundCodeReviewer = true
			if agent.Icon != "🔍" {
				t.Errorf("Expected Code Reviewer icon to be 🔍, got %s", agent.Icon)
			}
			break
		}
	}

	if !foundCodeReviewer {
		t.Error("Expected to find Code Reviewer agent")
	}
}

func TestConvertToRawURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "https://github.com/user/repo/blob/main/agent.json",
			expected: "https://raw.githubusercontent.com/user/repo/main/agent.json",
		},
		{
			input:    "https://raw.githubusercontent.com/user/repo/main/agent.json",
			expected: "https://raw.githubusercontent.com/user/repo/main/agent.json",
		},
		{
			input:    "https://example.com/agent.json",
			expected: "https://example.com/agent.json",
		},
	}

	for _, test := range tests {
		result := ConvertToRawURL(test.input)
		if result != test.expected {
			t.Errorf("ConvertToRawURL(%s) = %s, expected %s", test.input, result, test.expected)
		}
	}
}

func TestParseAgentConfig(t *testing.T) {
	jsonData := []byte(`{
		"name": "Test Agent",
		"icon": "🤖",
		"system_prompt": "You are a test agent",
		"default_task": "Test task",
		"model": "sonnet"
	}`)

	agent, err := ParseAgentConfig(jsonData, "json")
	if err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	if agent.Name != "Test Agent" {
		t.Errorf("Expected name 'Test Agent', got '%s'", agent.Name)
	}
	if agent.Icon != "🤖" {
		t.Errorf("Expected icon '🤖', got '%s'", agent.Icon)
	}
	if agent.Model != "sonnet" {
		t.Errorf("Expected model 'sonnet', got '%s'", agent.Model)
	}

	// Test YAML
	yamlData := []byte(`
name: Test Agent YAML
icon: 📝
system_prompt: You are a YAML test agent
default_task: YAML test task
model: opus
`)

	agent, err = ParseAgentConfig(yamlData, "yaml")
	if err != nil {
		t.Fatalf("Failed to parse YAML: %v", err)
	}

	if agent.Name != "Test Agent YAML" {
		t.Errorf("Expected name 'Test Agent YAML', got '%s'", agent.Name)
	}
}
