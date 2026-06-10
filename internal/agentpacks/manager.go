package agentpacks

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	DefaultRepo = "RubinCarter/ropcode"
	DefaultRef  = "main"
	IndexPath   = "agent-packs/index.json"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type skillFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type Manager struct {
	rootDir string
	client  *http.Client
}

func NewManager(ropcodeDir string) *Manager {
	return &Manager{
		rootDir: filepath.Join(ropcodeDir, "agent-packs"),
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (m *Manager) RootDir() string {
	return m.rootDir
}

func (m *Manager) ListInstalled() ([]InstalledPackSummary, error) {
	if err := os.MkdirAll(m.rootDir, 0755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(m.rootDir)
	if err != nil {
		return nil, err
	}

	var packs []InstalledPackSummary
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		packDir := filepath.Join(m.rootDir, entry.Name())
		manifest, err := readManifest(packDir)
		if err != nil {
			continue
		}
		install, err := readInstall(packDir)
		if err != nil {
			continue
		}
		packs = append(packs, buildSummary(packDir, manifest, install, ""))
	}

	sort.Slice(packs, func(i, j int) bool {
		return strings.ToLower(packs[i].Name) < strings.ToLower(packs[j].Name)
	})
	return packs, nil
}

func (m *Manager) ListInstalledDetails() ([]InstalledPackDetail, error) {
	if err := os.MkdirAll(m.rootDir, 0755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(m.rootDir)
	if err != nil {
		return nil, err
	}

	var packs []InstalledPackDetail
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		packDir := filepath.Join(m.rootDir, entry.Name())
		manifest, err := readManifest(packDir)
		if err != nil {
			continue
		}
		install, err := readInstall(packDir)
		if err != nil {
			continue
		}
		packs = append(packs, InstalledPackDetail{
			Path:     packDir,
			Manifest: manifest,
			Install:  install,
		})
	}

	sort.Slice(packs, func(i, j int) bool {
		return strings.ToLower(packs[i].Manifest.Name) < strings.ToLower(packs[j].Manifest.Name)
	})
	return packs, nil
}

func (m *Manager) GetInstalled(packID string) (*InstalledPackSummary, error) {
	packDir := filepath.Join(m.rootDir, safePackDirName(packID))
	manifest, err := readManifest(packDir)
	if err != nil {
		return nil, err
	}
	install, err := readInstall(packDir)
	if err != nil {
		return nil, err
	}
	summary := buildSummary(packDir, manifest, install, "")
	return &summary, nil
}

func (m *Manager) ListRemoteIndex(source InstallSource) (*PackIndex, error) {
	if source.Type == "" {
		source.Type = "github"
	}
	if source.Type != "github" {
		return nil, fmt.Errorf("remote index only supports github source")
	}
	repo := defaultString(source.Repo, DefaultRepo)
	ref := defaultString(source.Ref, DefaultRef)
	path := defaultString(source.Path, IndexPath)
	url := rawGitHubURL(repo, ref, path)
	data, err := m.fetchURL(url)
	if err != nil {
		return nil, err
	}
	var index PackIndex
	if err := json.Unmarshal(data, &index); err != nil {
		return nil, fmt.Errorf("parse pack index: %w", err)
	}
	if index.SchemaVersion == 0 {
		index.SchemaVersion = 1
	}
	return &index, nil
}

func (m *Manager) Install(options InstallOptions) (*InstalledPackSummary, error) {
	if options.Source.Type == "" {
		options.Source.Type = "github"
	}
	tempDir, err := os.MkdirTemp("", "ropcode-agent-pack-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)

	stagedDir := filepath.Join(tempDir, "pack")
	if err := m.stageSource(options.Source, stagedDir); err != nil {
		return nil, err
	}
	manifest, err := readManifest(stagedDir)
	if err != nil {
		return nil, err
	}
	if err := validateManifest(manifest, stagedDir); err != nil {
		return nil, err
	}

	packDir := filepath.Join(m.rootDir, safePackDirName(manifest.ID))
	if _, statErr := os.Stat(packDir); statErr == nil && !options.Replace {
		return nil, fmt.Errorf("agent pack %q is already installed", manifest.ID)
	}
	if err := os.MkdirAll(m.rootDir, 0755); err != nil {
		return nil, err
	}
	if err := os.RemoveAll(packDir); err != nil {
		return nil, err
	}
	if err := copyDir(stagedDir, packDir); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	install := InstalledPack{
		PackID:           manifest.ID,
		InstalledVersion: manifest.Version,
		Source:           normalizeSource(options.Source),
		InstalledAt:      now,
		UpdatedAt:        now,
		Agents:           buildInitialAgentConfigs(manifest, options.Agents),
	}
	if err := writeInstall(packDir, install); err != nil {
		return nil, err
	}
	summary := buildSummary(packDir, manifest, install, "")
	return &summary, nil
}

func (m *Manager) InstallLocal(path string, agents map[string]InstalledAgentConfig, replace bool) (*InstalledPackSummary, error) {
	return m.Install(InstallOptions{
		Source:  InstallSource{Type: "local", Path: path},
		Agents:  agents,
		Replace: replace,
	})
}

func (m *Manager) CreateLocal(request CreateLocalPackRequest) (*InstalledPackSummary, error) {
	agentName := strings.TrimSpace(request.Agent.Name)
	if agentName == "" {
		return nil, fmt.Errorf("agent name is required")
	}
	rolePrompt := strings.TrimSpace(request.Agent.RolePrompt)
	if rolePrompt == "" {
		return nil, fmt.Errorf("agent role prompt is required")
	}

	runtime := request.Runtime
	if strings.TrimSpace(runtime.Provider) == "" {
		return nil, fmt.Errorf("runtime provider is required")
	}
	if strings.TrimSpace(runtime.Model) == "" {
		return nil, fmt.Errorf("runtime model is required")
	}
	if runtime.Config == nil {
		runtime.Config = map[string]string{}
	}

	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = agentName
	}
	version := defaultString(request.Version, "0.1.0")
	packID := strings.TrimSpace(request.PackID)
	if packID == "" {
		packID = "local." + slugID(name, "agent-pack")
	}
	agentID := strings.TrimSpace(request.Agent.ID)
	if agentID == "" {
		agentID = slugID(agentName, "agent")
	}
	if err := validateID("pack id", packID); err != nil {
		return nil, err
	}
	if err := validateID("agent id", agentID); err != nil {
		return nil, err
	}

	tempDir, err := os.MkdirTemp("", "ropcode-agent-pack-create-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)
	stagedDir := filepath.Join(tempDir, "pack")

	roleRel := filepath.ToSlash(filepath.Join("roles", agentID+".md"))
	if err := writeTextFile(filepath.Join(stagedDir, filepath.FromSlash(roleRel)), rolePrompt+"\n"); err != nil {
		return nil, err
	}

	capabilities := make([]string, 0, len(request.Agent.Skills))
	usedSkillIDs := map[string]struct{}{}
	for i, skill := range request.Agent.Skills {
		if strings.TrimSpace(skill.SourcePath) != "" {
			skillRel, err := copyImportedSkill(stagedDir, skill, i, usedSkillIDs)
			if err != nil {
				return nil, err
			}
			capabilities = append(capabilities, skillRel)
			continue
		}
		instructions := strings.TrimSpace(skill.Instructions)
		if instructions == "" {
			continue
		}
		skillName := defaultString(skill.Name, fmt.Sprintf("Skill %d", i+1))
		skillID := strings.TrimSpace(skill.ID)
		if skillID == "" {
			skillID = slugID(skillName, fmt.Sprintf("skill-%d", i+1))
		}
		if err := validateID("skill id", skillID); err != nil {
			return nil, err
		}
		skillID = uniqueID(skillID, usedSkillIDs)
		skillRel := filepath.ToSlash(filepath.Join("skills", skillID, "SKILL.md"))
		content, err := renderSkillMarkdown(skillID, skillName, strings.TrimSpace(skill.Description), instructions)
		if err != nil {
			return nil, err
		}
		if err := writeTextFile(filepath.Join(stagedDir, filepath.FromSlash(skillRel)), content); err != nil {
			return nil, err
		}
		capabilities = append(capabilities, skillRel)
	}

	manifest := PackManifest{
		SchemaVersion: 1,
		ID:            packID,
		Version:       version,
		Name:          name,
		Description:   strings.TrimSpace(request.Description),
		Agents: []AgentDefinition{{
			ID:                agentID,
			Name:              agentName,
			Icon:              strings.TrimSpace(request.Agent.Icon),
			Description:       strings.TrimSpace(request.Agent.Description),
			Role:              roleRel,
			Capabilities:      capabilities,
			DefaultTask:       strings.TrimSpace(request.Agent.DefaultTask),
			SuggestedTriggers: triggerTemplatesFromConfigs(request.Triggers),
		}},
	}
	if err := writeManifest(stagedDir, manifest); err != nil {
		return nil, err
	}
	if err := validateManifest(manifest, stagedDir); err != nil {
		return nil, err
	}

	if err := os.MkdirAll(m.rootDir, 0755); err != nil {
		return nil, err
	}
	packDir := filepath.Join(m.rootDir, safePackDirName(packID))
	if _, statErr := os.Stat(packDir); statErr == nil {
		return nil, fmt.Errorf("agent pack %q is already installed", packID)
	}
	if err := copyDir(stagedDir, packDir); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	install := InstalledPack{
		PackID:           packID,
		InstalledVersion: manifest.Version,
		Source: InstallSource{
			Type: "created",
			Path: packDir,
		},
		InstalledAt: now,
		UpdatedAt:   now,
		Agents: map[string]InstalledAgentConfig{
			agentID: normalizeAgentConfig(InstalledAgentConfig{
				Enabled:  request.Enabled,
				Runtime:  runtime,
				Triggers: request.Triggers,
			}, InstalledAgentConfig{Runtime: runtime}),
		},
	}
	if err := writeInstall(packDir, install); err != nil {
		return nil, err
	}
	summary := buildSummary(packDir, manifest, install, "")
	return &summary, nil
}

func (m *Manager) SaveInstallConfig(packID string, agents map[string]InstalledAgentConfig) (*InstalledPackSummary, error) {
	packDir := filepath.Join(m.rootDir, safePackDirName(packID))
	manifest, err := readManifest(packDir)
	if err != nil {
		return nil, err
	}
	install, err := readInstall(packDir)
	if err != nil {
		return nil, err
	}
	install.Agents = buildInitialAgentConfigs(manifest, agents)
	install.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeInstall(packDir, install); err != nil {
		return nil, err
	}
	summary := buildSummary(packDir, manifest, install, "")
	return &summary, nil
}

func (m *Manager) CheckUpdate(packID string) (*InstalledPackSummary, error) {
	packDir := filepath.Join(m.rootDir, safePackDirName(packID))
	manifest, err := readManifest(packDir)
	if err != nil {
		return nil, err
	}
	install, err := readInstall(packDir)
	if err != nil {
		return nil, err
	}
	latest := ""
	if install.Source.Type == "github" {
		remoteManifest, err := m.fetchRemoteManifest(install.Source)
		if err == nil {
			latest = remoteManifest.Version
		}
	}
	summary := buildSummary(packDir, manifest, install, latest)
	return &summary, nil
}

func (m *Manager) Update(packID string) (*UpdateResult, error) {
	packDir := filepath.Join(m.rootDir, safePackDirName(packID))
	currentManifest, err := readManifest(packDir)
	if err != nil {
		return nil, err
	}
	install, err := readInstall(packDir)
	if err != nil {
		return nil, err
	}
	if install.Source.Type != "github" {
		return nil, fmt.Errorf("agent pack %q was not installed from github", packID)
	}

	tempDir, err := os.MkdirTemp("", "ropcode-agent-pack-update-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)
	stagedDir := filepath.Join(tempDir, "pack")
	if err := m.stageSource(install.Source, stagedDir); err != nil {
		return nil, err
	}
	nextManifest, err := readManifest(stagedDir)
	if err != nil {
		return nil, err
	}
	if err := validateManifest(nextManifest, stagedDir); err != nil {
		return nil, err
	}
	if nextManifest.ID != currentManifest.ID {
		return nil, fmt.Errorf("remote pack id changed from %q to %q", currentManifest.ID, nextManifest.ID)
	}
	if compareSemver(nextManifest.Version, currentManifest.Version) <= 0 {
		return &UpdateResult{
			PackID:          currentManifest.ID,
			PreviousVersion: currentManifest.Version,
			NewVersion:      nextManifest.Version,
			Updated:         false,
		}, nil
	}

	backupDir := filepath.Join(m.rootDir, ".versions", safePackDirName(currentManifest.ID), currentManifest.Version)
	if err := os.RemoveAll(backupDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(backupDir), 0755); err != nil {
		return nil, err
	}
	if err := copyDir(packDir, backupDir); err != nil {
		return nil, err
	}
	if err := os.RemoveAll(packDir); err != nil {
		return nil, err
	}
	if err := copyDir(stagedDir, packDir); err != nil {
		return nil, err
	}

	install.PackID = nextManifest.ID
	install.InstalledVersion = nextManifest.Version
	install.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	install.Agents = buildInitialAgentConfigs(nextManifest, install.Agents)
	if err := writeInstall(packDir, install); err != nil {
		return nil, err
	}
	return &UpdateResult{
		PackID:          nextManifest.ID,
		PreviousVersion: currentManifest.Version,
		NewVersion:      nextManifest.Version,
		Updated:         true,
		BackupPath:      backupDir,
	}, nil
}

func (m *Manager) Uninstall(packID string) error {
	return os.RemoveAll(filepath.Join(m.rootDir, safePackDirName(packID)))
}

func (m *Manager) fetchRemoteManifest(source InstallSource) (*PackManifest, error) {
	tempDir, err := os.MkdirTemp("", "ropcode-agent-pack-remote-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)
	stagedDir := filepath.Join(tempDir, "pack")
	if err := m.stageSource(source, stagedDir); err != nil {
		return nil, err
	}
	manifest, err := readManifest(stagedDir)
	if err != nil {
		return nil, err
	}
	return &manifest, nil
}

func (m *Manager) stageSource(source InstallSource, dest string) error {
	switch source.Type {
	case "github":
		return m.stageGitHub(source, dest)
	case "local":
		return m.stageLocal(source.Path, dest)
	default:
		return fmt.Errorf("unsupported agent pack source type: %s", source.Type)
	}
}

func (m *Manager) stageGitHub(source InstallSource, dest string) error {
	repo := defaultString(source.Repo, DefaultRepo)
	ref := defaultString(source.Ref, DefaultRef)
	path := strings.Trim(strings.TrimSpace(source.Path), "/")
	if path == "" {
		return fmt.Errorf("github source path is required")
	}
	url := source.URL
	if url == "" {
		url = archiveGitHubURL(repo, ref)
	}
	data, err := m.fetchURL(url)
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("read github archive: %w", err)
	}
	return extractArchiveSubdir(reader.File, path, dest)
}

func (m *Manager) stageLocal(path, dest string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("local path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDir(path, dest)
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open local agent pack archive: %w", err)
	}
	defer reader.Close()
	return extractArchiveRoot(reader.File, dest)
}

func (m *Manager) fetchURL(url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Ropcode-App")
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch %s: HTTP %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func readManifest(dir string) (PackManifest, error) {
	data, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return PackManifest{}, err
	}
	var manifest PackManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return PackManifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	return manifest, nil
}

func writeManifest(dir string, manifest PackManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return writeTextFile(filepath.Join(dir, "manifest.json"), string(data)+"\n")
}

func readInstall(dir string) (InstalledPack, error) {
	data, err := os.ReadFile(filepath.Join(dir, "install.json"))
	if err != nil {
		return InstalledPack{}, err
	}
	var install InstalledPack
	if err := json.Unmarshal(data, &install); err != nil {
		return InstalledPack{}, fmt.Errorf("parse install config: %w", err)
	}
	if install.Agents == nil {
		install.Agents = map[string]InstalledAgentConfig{}
	}
	return install, nil
}

func writeInstall(dir string, install InstalledPack) error {
	data, err := json.MarshalIndent(install, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "install.json"), append(data, '\n'), 0644)
}

func validateManifest(manifest PackManifest, dir string) error {
	if manifest.SchemaVersion == 0 {
		return fmt.Errorf("manifest schema_version is required")
	}
	if strings.TrimSpace(manifest.ID) == "" {
		return fmt.Errorf("manifest id is required")
	}
	if err := validateID("manifest id", manifest.ID); err != nil {
		return err
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return fmt.Errorf("manifest version is required")
	}
	if strings.TrimSpace(manifest.Name) == "" {
		return fmt.Errorf("manifest name is required")
	}
	if len(manifest.Agents) == 0 {
		return fmt.Errorf("manifest agents is required")
	}
	seenAgents := map[string]struct{}{}
	for _, agent := range manifest.Agents {
		if strings.TrimSpace(agent.ID) == "" {
			return fmt.Errorf("agent id is required")
		}
		if err := validateID("agent id", agent.ID); err != nil {
			return err
		}
		if _, ok := seenAgents[agent.ID]; ok {
			return fmt.Errorf("duplicate agent id: %s", agent.ID)
		}
		seenAgents[agent.ID] = struct{}{}
		if strings.TrimSpace(agent.Name) == "" {
			return fmt.Errorf("agent %q name is required", agent.ID)
		}
		if err := validateRelativeFile(dir, agent.Role); err != nil {
			return fmt.Errorf("agent %q role: %w", agent.ID, err)
		}
		for _, capability := range agent.Capabilities {
			if err := validateRelativeFile(dir, capability); err != nil {
				return fmt.Errorf("agent %q capability %q: %w", agent.ID, capability, err)
			}
		}
	}
	return nil
}

func validateRelativeFile(root, rel string) error {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return fmt.Errorf("path is required")
	}
	if filepath.IsAbs(rel) {
		return fmt.Errorf("path must be relative and stay inside the pack")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	full, err := filepath.Abs(filepath.Join(rootAbs, filepath.FromSlash(rel)))
	if err != nil {
		return err
	}
	within, err := filepath.Rel(rootAbs, full)
	if err != nil {
		return err
	}
	if within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path must be relative and stay inside the pack")
	}
	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("path points to a directory")
	}
	return nil
}

func buildInitialAgentConfigs(manifest PackManifest, overrides map[string]InstalledAgentConfig) map[string]InstalledAgentConfig {
	configs := make(map[string]InstalledAgentConfig, len(manifest.Agents))
	for _, agent := range manifest.Agents {
		config := InstalledAgentConfig{
			Enabled: false,
			Runtime: RuntimeConfig{
				Provider: "claude",
				Model:    "sonnet",
			},
		}
		for _, trigger := range agent.SuggestedTriggers {
			scope := trigger.Scope
			if scope == nil {
				scope = map[string]any{"type": "all", "targets": []any{}}
			}
			config.Triggers = append(config.Triggers, TriggerConfig{
				Mode:           trigger.Mode,
				Event:          trigger.Event,
				EventType:      trigger.EventType,
				SessionType:    trigger.SessionType,
				SessionAgentID: trigger.SessionAgentID,
				AgentID:        trigger.AgentID,
				Enabled:        false,
				Scope:          scope,
				Schedule:       trigger.Schedule,
				Timezone:       trigger.Timezone,
			})
		}
		if override, ok := overrides[agent.ID]; ok {
			config = normalizeAgentConfig(override, config)
		}
		configs[agent.ID] = config
	}
	return configs
}

func normalizeAgentConfig(config, fallback InstalledAgentConfig) InstalledAgentConfig {
	if strings.TrimSpace(config.Runtime.Provider) == "" {
		config.Runtime.Provider = fallback.Runtime.Provider
	}
	if strings.TrimSpace(config.Runtime.Model) == "" {
		config.Runtime.Model = fallback.Runtime.Model
	}
	if config.Runtime.Config == nil {
		config.Runtime.Config = map[string]string{}
	}
	if config.Triggers == nil {
		config.Triggers = fallback.Triggers
	}
	for i := range config.Triggers {
		if config.Triggers[i].Scope == nil {
			config.Triggers[i].Scope = map[string]any{"type": "all", "targets": []any{}}
		}
	}
	return config
}

func buildSummary(packDir string, manifest PackManifest, install InstalledPack, latest string) InstalledPackSummary {
	agents := make([]AgentSummary, 0, len(manifest.Agents))
	for _, agent := range manifest.Agents {
		config := install.Agents[agent.ID]
		agents = append(agents, AgentSummary{
			ID:       agent.ID,
			Name:     agent.Name,
			Icon:     agent.Icon,
			Enabled:  config.Enabled,
			Runtime:  config.Runtime,
			Triggers: config.Triggers,
		})
	}
	return InstalledPackSummary{
		PackID:           manifest.ID,
		Name:             manifest.Name,
		Description:      manifest.Description,
		InstalledVersion: install.InstalledVersion,
		LatestVersion:    latest,
		UpdateAvailable:  latest != "" && compareSemver(latest, install.InstalledVersion) > 0,
		Source:           install.Source,
		Path:             packDir,
		Agents:           agents,
	}
}

func normalizeSource(source InstallSource) InstallSource {
	switch source.Type {
	case "github", "":
		source.Type = "github"
		source.Repo = defaultString(source.Repo, DefaultRepo)
		source.Ref = defaultString(source.Ref, DefaultRef)
		source.Path = strings.Trim(strings.TrimSpace(source.Path), "/")
	case "local", "created":
		source.Path = strings.TrimSpace(source.Path)
	}
	return source
}

func safePackDirName(packID string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_")
	name := replacer.Replace(strings.TrimSpace(packID))
	if name == "" || name == "." || name == ".." {
		return "_"
	}
	return name
}

func validateID(label, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("%s is required", label)
	}
	if !idPattern.MatchString(value) || value == "." || value == ".." {
		return fmt.Errorf("%s must use letters, numbers, dots, dashes, or underscores and cannot be . or ..", label)
	}
	return nil
}

func slugID(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		valid := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if valid {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if slug == "" {
		return fallback
	}
	return slug
}

func uniqueID(id string, used map[string]struct{}) string {
	next := id
	for i := 2; ; i++ {
		if _, ok := used[next]; !ok {
			used[next] = struct{}{}
			return next
		}
		next = fmt.Sprintf("%s-%d", id, i)
	}
}

func triggerTemplatesFromConfigs(configs []TriggerConfig) []TriggerTemplate {
	if len(configs) == 0 {
		return nil
	}
	templates := make([]TriggerTemplate, 0, len(configs))
	for _, config := range configs {
		if strings.TrimSpace(config.Mode) == "" {
			continue
		}
		templates = append(templates, TriggerTemplate{
			Mode:           config.Mode,
			Event:          config.Event,
			EventType:      config.EventType,
			SessionType:    config.SessionType,
			SessionAgentID: config.SessionAgentID,
			AgentID:        config.AgentID,
			Schedule:       config.Schedule,
			Scope:          config.Scope,
			Timezone:       config.Timezone,
		})
	}
	return templates
}

func renderSkillMarkdown(skillID, skillName, description, instructions string) (string, error) {
	description = strings.TrimSpace(description)
	if description == "" {
		description = summarizeSkillInstructions(instructions)
	}
	if description == "" {
		description = "Use this skill when the task matches " + skillName + "."
	}
	frontmatter, err := yaml.Marshal(skillFrontmatter{
		Name:        skillID,
		Description: description,
	})
	if err != nil {
		return "", err
	}
	var builder strings.Builder
	builder.WriteString("---\n")
	builder.Write(frontmatter)
	builder.WriteString("---\n\n")
	builder.WriteString("# ")
	builder.WriteString(skillName)
	builder.WriteString("\n\n")
	builder.WriteString(strings.TrimSpace(instructions))
	builder.WriteString("\n")
	return builder.String(), nil
}

func copyImportedSkill(stagedDir string, skill ManualSkill, index int, usedSkillIDs map[string]struct{}) (string, error) {
	sourcePath := strings.TrimSpace(skill.SourcePath)
	info, err := os.Stat(sourcePath)
	if err != nil {
		return "", fmt.Errorf("skill source %q: %w", sourcePath, err)
	}
	sourceDir := sourcePath
	if !info.IsDir() {
		if strings.EqualFold(filepath.Base(sourcePath), "SKILL.md") {
			sourceDir = filepath.Dir(sourcePath)
		} else {
			return "", fmt.Errorf("skill source %q must be a skill directory or SKILL.md", sourcePath)
		}
	}
	if _, err := os.Stat(filepath.Join(sourceDir, "SKILL.md")); err != nil {
		return "", fmt.Errorf("skill source %q is missing SKILL.md", sourceDir)
	}
	skillName := defaultString(skill.Name, filepath.Base(sourceDir))
	skillID := strings.TrimSpace(skill.ID)
	if skillID == "" {
		skillID = slugID(skillName, fmt.Sprintf("skill-%d", index+1))
	}
	if err := validateID("skill id", skillID); err != nil {
		return "", err
	}
	skillID = uniqueID(skillID, usedSkillIDs)
	targetDir := filepath.Join(stagedDir, "skills", skillID)
	if err := copyDir(sourceDir, targetDir); err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join("skills", skillID, "SKILL.md")), nil
}

func summarizeSkillInstructions(instructions string) string {
	text := strings.TrimSpace(instructions)
	if text == "" {
		return ""
	}
	text = strings.Join(strings.Fields(text), " ")
	text = firstSentence(text)
	const maxLen = 180
	runes := []rune(text)
	if len(runes) <= maxLen {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(string(runes[:maxLen-1])) + "..."
}

func firstSentence(text string) string {
	for _, separator := range []string{". ", "。", "！", "？"} {
		if idx := strings.Index(text, separator); idx > 0 {
			end := idx + len(separator)
			if separator == ". " {
				end--
			}
			return strings.TrimSpace(text[:end])
		}
	}
	return text
}

func writeTextFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0644)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func rawGitHubURL(repo, ref, path string) string {
	return "https://raw.githubusercontent.com/" + strings.Trim(repo, "/") + "/" + strings.Trim(ref, "/") + "/" + strings.Trim(path, "/")
}

func archiveGitHubURL(repo, ref string) string {
	return "https://codeload.github.com/" + strings.Trim(repo, "/") + "/zip/" + strings.Trim(ref, "/")
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		return copyFile(path, target, info.Mode())
	})
}

func copyFile(src, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func extractArchiveSubdir(files []*zip.File, subdir, dest string) error {
	subdir = strings.Trim(strings.TrimSpace(subdir), "/")
	prefixPattern := regexp.MustCompile(`^[^/]+/`)
	found := false
	for _, file := range files {
		name := strings.TrimPrefix(prefixPattern.ReplaceAllString(file.Name, ""), "/")
		if name == "" || name == "." {
			continue
		}
		if name != subdir && !strings.HasPrefix(name, subdir+"/") {
			continue
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(name, subdir), "/")
		if rel == "" {
			continue
		}
		found = true
		if err := extractZipFile(file, filepath.Join(dest, rel)); err != nil {
			return err
		}
	}
	if !found {
		return fmt.Errorf("agent pack path %q not found in archive", subdir)
	}
	return nil
}

func extractArchiveRoot(files []*zip.File, dest string) error {
	prefix := commonArchiveRoot(files)
	for _, file := range files {
		name := strings.TrimPrefix(file.Name, prefix)
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		if err := extractZipFile(file, filepath.Join(dest, name)); err != nil {
			return err
		}
	}
	return nil
}

func extractZipFile(file *zip.File, target string) error {
	cleanTarget := filepath.Clean(target)
	if file.FileInfo().IsDir() {
		return os.MkdirAll(cleanTarget, file.Mode())
	}
	if err := os.MkdirAll(filepath.Dir(cleanTarget), 0755); err != nil {
		return err
	}
	in, err := file.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(cleanTarget, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, file.Mode())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func commonArchiveRoot(files []*zip.File) string {
	root := ""
	for _, file := range files {
		name := strings.Trim(file.Name, "/")
		if name == "" {
			continue
		}
		parts := strings.SplitN(name, "/", 2)
		if len(parts) < 2 {
			return ""
		}
		if root == "" {
			root = parts[0] + "/"
			continue
		}
		if root != parts[0]+"/" {
			return ""
		}
	}
	return root
}

func compareSemver(a, b string) int {
	ap := semverParts(a)
	bp := semverParts(b)
	for i := 0; i < 3; i++ {
		if ap[i] > bp[i] {
			return 1
		}
		if ap[i] < bp[i] {
			return -1
		}
	}
	return strings.Compare(a, b)
}

func semverParts(version string) [3]int {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	version = strings.SplitN(version, "-", 2)[0]
	parts := strings.Split(version, ".")
	var out [3]int
	for i := 0; i < len(parts) && i < 3; i++ {
		fmt.Sscanf(parts[i], "%d", &out[i])
	}
	return out
}
