// internal/github/agents_test.go
package github

import (
	"strings"
	"testing"
)

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

func TestNormalizeModelName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"sonnet", "sonnet"},
		{"Sonnet", "sonnet"},
		{"claude-sonnet", "sonnet"},
		{"claude-3-sonnet", "sonnet"},
		{"claude-3.5-sonnet", "sonnet"},
		{"claude-sonnet-3.5", "sonnet"},
		{"opus", "opus"},
		{"claude-opus", "opus"},
		{"claude-3-opus", "opus"},
		{"haiku", "haiku"},
		{"claude-haiku", "haiku"},
		{"claude-3-haiku", "haiku"},
		{"", "sonnet"},
		{"custom-model", "custom-model"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeModelName(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeModelName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestNormalizeGitHubURL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "raw URL unchanged",
			input:    "https://raw.githubusercontent.com/user/repo/main/agent.yaml",
			expected: "https://raw.githubusercontent.com/user/repo/main/agent.yaml",
		},
		{
			name:     "github blob URL converted",
			input:    "https://github.com/user/repo/blob/main/agent.yaml",
			expected: "https://raw.githubusercontent.com/user/repo/main/agent.yaml",
		},
		{
			name:     "github blob URL with branch converted",
			input:    "https://github.com/user/repo/blob/develop/agents/test.yaml",
			expected: "https://raw.githubusercontent.com/user/repo/develop/agents/test.yaml",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeGitHubURL(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeGitHubURL(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseAgentFromYAML(t *testing.T) {
	tests := []struct {
		name      string
		yaml      string
		wantError bool
		checkFunc func(*testing.T, *AgentContent)
	}{
		{
			name: "valid agent",
			yaml: `name: Test Agent
icon: 🤖
model: sonnet
system_prompt: You are a test agent`,
			wantError: false,
			checkFunc: func(t *testing.T, agent *AgentContent) {
				if agent.Name != "Test Agent" {
					t.Errorf("Name = %q, want %q", agent.Name, "Test Agent")
				}
				if agent.Icon != "🤖" {
					t.Errorf("Icon = %q, want %q", agent.Icon, "🤖")
				}
				if agent.Model != "sonnet" {
					t.Errorf("Model = %q, want %q", agent.Model, "sonnet")
				}
				if agent.SystemPrompt != "You are a test agent" {
					t.Errorf("SystemPrompt = %q, want %q", agent.SystemPrompt, "You are a test agent")
				}
			},
		},
		{
			name: "agent with defaults",
			yaml: `name: Minimal Agent
system_prompt: Minimal prompt`,
			wantError: false,
			checkFunc: func(t *testing.T, agent *AgentContent) {
				if agent.Icon != "🤖" {
					t.Errorf("Icon = %q, want default %q", agent.Icon, "🤖")
				}
				if agent.Model != "sonnet" {
					t.Errorf("Model = %q, want default %q", agent.Model, "sonnet")
				}
			},
		},
		{
			name:      "missing name",
			yaml:      `system_prompt: Test prompt`,
			wantError: true,
		},
		{
			name:      "missing system_prompt",
			yaml:      `name: Test Agent`,
			wantError: true,
		},
		{
			name: "multiline system_prompt",
			yaml: `name: Multiline Agent
system_prompt: |
  Line 1
  Line 2
  Line 3`,
			wantError: false,
			checkFunc: func(t *testing.T, agent *AgentContent) {
				// YAML literal block style removes trailing newline unless chomping indicator is used
				if !contains(agent.SystemPrompt, "Line 1") || !contains(agent.SystemPrompt, "Line 2") || !contains(agent.SystemPrompt, "Line 3") {
					t.Errorf("SystemPrompt = %q, want to contain all lines", agent.SystemPrompt)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent, err := ParseAgentFromYAML(tt.yaml)
			if tt.wantError {
				if err == nil {
					t.Errorf("ParseAgentFromYAML() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Errorf("ParseAgentFromYAML() error = %v, want nil", err)
				return
			}
			if tt.checkFunc != nil {
				tt.checkFunc(t, agent)
			}
		})
	}
}

func TestValidateAgentContent(t *testing.T) {
	tests := []struct {
		name      string
		agent     *AgentContent
		wantError bool
	}{
		{
			name: "valid agent",
			agent: &AgentContent{
				Name:         "Test",
				SystemPrompt: "Test prompt",
				Icon:         "🤖",
				Model:        "sonnet",
			},
			wantError: false,
		},
		{
			name: "missing name",
			agent: &AgentContent{
				SystemPrompt: "Test prompt",
			},
			wantError: true,
		},
		{
			name: "missing system_prompt",
			agent: &AgentContent{
				Name: "Test",
			},
			wantError: true,
		},
		{
			name: "sets defaults",
			agent: &AgentContent{
				Name:         "Test",
				SystemPrompt: "Test prompt",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAgentContent(tt.agent)
			if tt.wantError && err == nil {
				t.Errorf("validateAgentContent() error = nil, want error")
			}
			if !tt.wantError && err != nil {
				t.Errorf("validateAgentContent() error = %v, want nil", err)
			}
			// Check defaults are set when no error
			if !tt.wantError && err == nil {
				if tt.agent.Icon == "" {
					t.Errorf("Icon not set to default")
				}
				if tt.agent.Model == "" {
					t.Errorf("Model not set to default")
				}
			}
		})
	}
}
