package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"ropcode/internal/provider"
)

const codexCapabilityQueryTimeout = 6 * time.Second

var queryCodexAppServerCapabilities = queryCodexAppServerCapabilitiesViaProcess
var discoverCodexBinary = provider.DiscoverBinary

type codexSkillsListResponse struct {
	Data []codexSkillsListEntry `json:"data"`
}

type codexModelListResponse struct {
	Data []codexModelListEntry `json:"data"`
}

type codexModelListEntry struct {
	ServiceTiers         []codexModelServiceTier `json:"serviceTiers"`
	AdditionalSpeedTiers []string                `json:"additionalSpeedTiers"`
}

type codexModelServiceTier struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type codexSkillsListEntry struct {
	CWD    string                 `json:"cwd"`
	Errors []codexSkillErrorInfo  `json:"errors"`
	Skills []codexSkillCapability `json:"skills"`
}

type codexSkillErrorInfo struct {
	Message string `json:"message"`
	Path    string `json:"path"`
}

type codexSkillCapability struct {
	Name             string                `json:"name"`
	Description      string                `json:"description"`
	Path             string                `json:"path"`
	Scope            string                `json:"scope"`
	Enabled          bool                  `json:"enabled"`
	ShortDescription *string               `json:"shortDescription"`
	Interface        *codexSkillInterface  `json:"interface"`
	Dependencies     *codexSkillDependency `json:"dependencies"`
}

type codexSkillInterface struct {
	DisplayName      *string `json:"displayName"`
	ShortDescription *string `json:"shortDescription"`
	DefaultPrompt    *string `json:"defaultPrompt"`
}

type codexSkillDependency struct {
	Tools []codexSkillToolDependency `json:"tools"`
}

type codexSkillToolDependency struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (d *Driver) discoverAppServerCapabilities(ctx context.Context, projectPath string, force bool) ([]provider.Capability, error) {
	binaryPath, err := discoverCodexBinary(d.BinaryName(), d.BinaryCandidates())
	if err != nil {
		return nil, err
	}
	return queryCodexAppServerCapabilities(ctx, binaryPath, d.ID(), projectPath, force)
}

func queryCodexAppServerCapabilitiesViaProcess(ctx context.Context, binaryPath, providerID, projectPath string, force bool) ([]provider.Capability, error) {
	ctx, cancel := context.WithTimeout(ctx, codexCapabilityQueryTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, binaryPath, "app-server", "--listen", "stdio://")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	responses := make(chan map[string]any, 8)
	readErrs := make(chan error, 2)
	var stderrText lockedStringBuilder

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()

	go readJSONRPCResponses(stdout, responses, readErrs)
	go func() {
		_, _ = io.Copy(&stderrText, stderr)
	}()

	initializeID := "ropcode_capabilities_initialize"
	if err := writeJSONRPC(stdin, map[string]any{
		"jsonrpc": "2.0",
		"id":      initializeID,
		"method":  "initialize",
		"params": map[string]any{
			"clientInfo": map[string]any{
				"name":    "ropcode",
				"version": "0.1.0",
			},
			"capabilities": map[string]any{
				"experimentalApi": true,
			},
		},
	}); err != nil {
		return nil, err
	}

	if _, err := waitForJSONRPCResponse(ctx, responses, readErrs, initializeID); err != nil {
		return nil, codexAppServerError("initialize", err, stderrText.String())
	}

	if err := writeJSONRPC(stdin, map[string]any{
		"jsonrpc": "2.0",
		"method":  "initialized",
		"params":  map[string]any{},
	}); err != nil {
		return nil, err
	}

	skillsID := "ropcode_capabilities_skills"
	params := map[string]any{
		"forceReload": force,
	}
	if strings.TrimSpace(projectPath) != "" {
		params["cwds"] = []string{projectPath}
	}
	if err := writeJSONRPC(stdin, map[string]any{
		"jsonrpc": "2.0",
		"id":      skillsID,
		"method":  "skills/list",
		"params":  params,
	}); err != nil {
		return nil, err
	}

	skillsResponse, err := waitForJSONRPCResponse(ctx, responses, readErrs, skillsID)
	if err != nil {
		return nil, codexAppServerError("skills/list", err, stderrText.String())
	}
	if rawErr, ok := skillsResponse["error"]; ok {
		return nil, codexAppServerError("skills/list", fmt.Errorf("%v", rawErr), stderrText.String())
	}

	rawResult, err := json.Marshal(skillsResponse["result"])
	if err != nil {
		return nil, err
	}
	var skillsResult codexSkillsListResponse
	if err := json.Unmarshal(rawResult, &skillsResult); err != nil {
		return nil, err
	}

	modelsID := "ropcode_capabilities_models"
	if err := writeJSONRPC(stdin, map[string]any{
		"jsonrpc": "2.0",
		"id":      modelsID,
		"method":  "model/list",
		"params": map[string]any{
			"includeHidden": false,
		},
	}); err != nil {
		return nil, err
	}

	modelsResponse, err := waitForJSONRPCResponse(ctx, responses, readErrs, modelsID)
	if err != nil {
		return nil, codexAppServerError("model/list", err, stderrText.String())
	}
	if rawErr, ok := modelsResponse["error"]; ok {
		return nil, codexAppServerError("model/list", fmt.Errorf("%v", rawErr), stderrText.String())
	}

	rawModelsResult, err := json.Marshal(modelsResponse["result"])
	if err != nil {
		return nil, err
	}
	var modelsResult codexModelListResponse
	if err := json.Unmarshal(rawModelsResult, &modelsResult); err != nil {
		return nil, err
	}

	capabilities := codexSkillsToCapabilities(providerID, skillsResult)
	capabilities = append(capabilities, codexModelServiceTierCommandsToCapabilities(providerID, modelsResult)...)
	return capabilities, nil
}

type lockedStringBuilder struct {
	mu sync.Mutex
	b  strings.Builder
}

func (b *lockedStringBuilder) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *lockedStringBuilder) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

func readJSONRPCResponses(stdout io.Reader, responses chan<- map[string]any, readErrs chan<- error) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			continue
		}
		responses <- payload
	}
	if err := scanner.Err(); err != nil {
		readErrs <- err
	}
}

func writeJSONRPC(stdin io.Writer, payload map[string]any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

func waitForJSONRPCResponse(ctx context.Context, responses <-chan map[string]any, readErrs <-chan error, requestID string) (map[string]any, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case err := <-readErrs:
			if err != nil {
				return nil, err
			}
		case response := <-responses:
			if responseIDString(response["id"]) == requestID {
				return response, nil
			}
		}
	}
}

func responseIDString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	default:
		return ""
	}
}

func codexSkillsToCapabilities(providerID string, response codexSkillsListResponse) []provider.Capability {
	var capabilities []provider.Capability
	for _, entry := range response.Data {
		for _, skill := range entry.Skills {
			if !skill.Enabled {
				continue
			}
			name := strings.TrimPrefix(strings.TrimSpace(skill.Name), "/")
			if name == "" {
				continue
			}
			description := strings.TrimSpace(skill.Description)
			if skill.ShortDescription != nil && strings.TrimSpace(*skill.ShortDescription) != "" {
				description = strings.TrimSpace(*skill.ShortDescription)
			}
			if skill.Interface != nil && skill.Interface.ShortDescription != nil && strings.TrimSpace(*skill.Interface.ShortDescription) != "" {
				description = strings.TrimSpace(*skill.Interface.ShortDescription)
			}
			content := ""
			if skill.Interface != nil && skill.Interface.DefaultPrompt != nil {
				content = strings.TrimSpace(*skill.Interface.DefaultPrompt)
			}

			allowedTools := make([]string, 0)
			if skill.Dependencies != nil {
				for _, tool := range skill.Dependencies.Tools {
					if strings.TrimSpace(tool.Value) != "" {
						allowedTools = append(allowedTools, tool.Value)
					}
				}
			}

			capability := provider.Capability{
				Provider:         providerID,
				Name:             name,
				SlashName:        "/" + name,
				Kind:             string(provider.CapabilityKindSkill),
				Description:      description,
				Scope:            string(mapCodexSkillScope(skill.Scope)),
				SourcePath:       skill.Path,
				Content:          content,
				AllowedTools:     allowedTools,
				AcceptsArguments: strings.Contains(content, "$ARGUMENTS"),
			}
			capability.Key = provider.CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
			capabilities = append(capabilities, capability)
		}
	}
	return capabilities
}

func codexModelServiceTierCommandsToCapabilities(providerID string, response codexModelListResponse) []provider.Capability {
	seen := make(map[string]struct{})
	var capabilities []provider.Capability
	for _, model := range response.Data {
		for _, tier := range model.ServiceTiers {
			name := strings.TrimPrefix(strings.TrimSpace(tier.Name), "/")
			if name == "" {
				name = strings.TrimPrefix(strings.TrimSpace(tier.ID), "/")
			}
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			description := strings.TrimSpace(tier.Description)
			capability := provider.Capability{
				Provider:    providerID,
				Name:        name,
				SlashName:   "/" + name,
				Kind:        string(provider.CapabilityKindCommand),
				Description: description,
				Scope:       string(provider.CapabilityScopeSystem),
			}
			capability.Key = provider.CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
			capabilities = append(capabilities, capability)
		}

		for _, legacyTier := range model.AdditionalSpeedTiers {
			name := strings.TrimPrefix(strings.TrimSpace(legacyTier), "/")
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			capability := provider.Capability{
				Provider:  providerID,
				Name:      name,
				SlashName: "/" + name,
				Kind:      string(provider.CapabilityKindCommand),
				Scope:     string(provider.CapabilityScopeSystem),
			}
			capability.Key = provider.CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
			capabilities = append(capabilities, capability)
		}
	}
	return capabilities
}

func mapCodexSkillScope(scope string) provider.CapabilityScope {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "repo", "project":
		return provider.CapabilityScopeProject
	case "user":
		return provider.CapabilityScopeUser
	default:
		return provider.CapabilityScopeSystem
	}
}

func codexAppServerError(operation string, err error, stderr string) error {
	stderr = strings.TrimSpace(stderr)
	if stderr == "" {
		return fmt.Errorf("codex app-server %s failed: %w", operation, err)
	}
	return fmt.Errorf("codex app-server %s failed: %w: %s", operation, err, stderr)
}
