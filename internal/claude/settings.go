package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func LoadSettings(path string) (map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]interface{}), nil
		}
		return nil, err
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}

	return settings, nil
}

func SaveSettings(path string, settings map[string]interface{}) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

func GetSystemPrompt(claudeDir string) (string, error) {
	path := filepath.Join(claudeDir, "CLAUDE.md")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

func SaveSystemPrompt(claudeDir, content string) error {
	path := filepath.Join(claudeDir, "CLAUDE.md")
	return os.WriteFile(path, []byte(content), 0644)
}

type ClaudeMdFile struct {
	RelativePath string `json:"relative_path"`
	AbsolutePath string `json:"absolute_path"`
	Size         int64  `json:"size"`
	Modified     int64  `json:"modified"`
}

func FindClaudeMdFiles(projectPath string) ([]ClaudeMdFile, error) {
	var files []ClaudeMdFile

	// Check project root
	rootMd := filepath.Join(projectPath, "CLAUDE.md")
	if info, err := os.Stat(rootMd); err == nil {
		files = append(files, ClaudeMdFile{
			RelativePath: "CLAUDE.md",
			AbsolutePath: rootMd,
			Size:         info.Size(),
			Modified:     info.ModTime().Unix(),
		})
	}

	// Check .claude directory
	claudeDir := filepath.Join(projectPath, ".claude")
	if _, err := os.Stat(claudeDir); err == nil {
		entries, _ := os.ReadDir(claudeDir)
		for _, entry := range entries {
			if !entry.IsDir() && filepath.Ext(entry.Name()) == ".md" {
				fullPath := filepath.Join(claudeDir, entry.Name())
				info, _ := entry.Info()
				files = append(files, ClaudeMdFile{
					RelativePath: filepath.Join(".claude", entry.Name()),
					AbsolutePath: fullPath,
					Size:         info.Size(),
					Modified:     info.ModTime().Unix(),
				})
			}
		}
	}

	return files, nil
}

// getProviderConfigDir returns the config directory for a provider
// - Claude: ~/.claude
// - Codex: ~/.codex
func getProviderConfigDir(provider string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	switch provider {
	case "claude":
		return filepath.Join(homeDir, ".claude"), nil
	case "codex":
		return filepath.Join(homeDir, ".codex"), nil
	default:
		return filepath.Join(homeDir, "."+provider), nil
	}
}

// getProviderSystemPromptFilename returns the filename for a provider's system prompt
// - Claude: CLAUDE.md
// - Codex: AGENTS.md
func getProviderSystemPromptFilename(provider string) string {
	switch provider {
	case "claude":
		return "CLAUDE.md"
	case "codex":
		return "AGENTS.md"
	default:
		return provider + ".md"
	}
}

// GetProviderSystemPrompt reads provider system prompt from the correct location
// - Claude: ~/.claude/CLAUDE.md
// - Codex: ~/.codex/AGENTS.md
func GetProviderSystemPrompt(claudeDir, provider string) (string, error) {
	configDir, err := getProviderConfigDir(provider)
	if err != nil {
		return "", err
	}

	filename := getProviderSystemPromptFilename(provider)
	path := filepath.Join(configDir, filename)

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// SaveProviderSystemPrompt saves provider system prompt to the correct location
// - Claude: ~/.claude/CLAUDE.md
// - Codex: ~/.codex/AGENTS.md
func SaveProviderSystemPrompt(claudeDir, provider, content string) (string, error) {
	configDir, err := getProviderConfigDir(provider)
	if err != nil {
		return "", err
	}

	// Ensure config directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", err
	}

	filename := getProviderSystemPromptFilename(provider)
	path := filepath.Join(configDir, filename)

	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", err
	}
	return path, nil
}
