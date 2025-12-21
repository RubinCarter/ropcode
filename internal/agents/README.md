# Agents Package

This package provides functionality for managing Claude agents, including predefined agent templates and importing agents from GitHub.

## Features

### 1. Predefined Agent Templates

The package includes 6 predefined agent templates:

- **Code Reviewer** 🔍 - Expert code reviewer for quality and best practices
- **Bug Fixer** 🐛 - Debugging expert for finding and fixing bugs
- **Documentation Writer** 📝 - Technical writer for creating documentation
- **Test Generator** 🧪 - Testing expert for generating test cases
- **Performance Optimizer** ⚡ - Performance expert for optimization tasks
- **Security Auditor** 🔒 - Security expert for vulnerability audits

### 2. GitHub Agent Import

Import agent configurations from GitHub repositories or Gist URLs. Supports both JSON and YAML formats.

#### Agent Configuration Format

**JSON Example:**
```json
{
  "name": "Custom Agent",
  "icon": "🤖",
  "system_prompt": "You are a custom agent...",
  "default_task": "Perform custom task",
  "model": "sonnet",
  "description": "Custom agent description",
  "author": "Author Name"
}
```

**YAML Example:**
```yaml
name: Custom Agent
icon: 🤖
system_prompt: You are a custom agent...
default_task: Perform custom task
model: sonnet
description: Custom agent description
author: Author Name
```

### 3. URL Format Support

The package automatically converts GitHub blob URLs to raw content URLs:

- Input: `https://github.com/user/repo/blob/main/agent.json`
- Converted: `https://raw.githubusercontent.com/user/repo/main/agent.json`

## Usage Examples

### List Predefined Agents

```go
agents := agents.PredefinedAgents()
for _, agent := range agents {
    fmt.Printf("%s %s\n", agent.Icon, agent.Name)
}
```

### Fetch Agent from GitHub

```go
agent, err := agents.FetchGitHubAgentContent("https://github.com/user/repo/blob/main/agent.json")
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Loaded agent: %s\n", agent.Name)
```

### Import Agent to Database

```go
db, _ := database.Open("path/to/db.sqlite")
agent, err := agents.ImportGitHubAgent("https://github.com/user/repo/blob/main/agent.json", db)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Imported agent ID: %d\n", agent.ID)
```

## Bindings

The following functions are available in `bindings.go`:

### ListClaudeAgents()
Returns all predefined agent templates.

### SearchClaudeAgents(query string)
Searches predefined agents by name, description, or default task.

### FetchGitHubAgents(url string)
Fetches a list of agents from a GitHub URL. If no URL is provided, returns predefined agents.

### FetchGitHubAgentContent(url string)
Fetches a single agent configuration from a GitHub URL.

### ImportAgentFromGitHub(url string)
Imports an agent from GitHub and saves it to the database.

## Testing

Run tests:
```bash
go test ./internal/agents/... -v
```
