package claude

import (
	"bytes"
	"encoding/json"
	"strings"
)

type discoveryTypeEnvelope struct {
	Type string `json:"type"`
}

type controlResponseEnvelope struct {
	Type     string `json:"type"`
	Response struct {
		Subtype  string `json:"subtype"`
		Response struct {
			Commands []discoveryCommandSummary `json:"commands"`
			Agents   []discoveryAgentSummary   `json:"agents"`
		} `json:"response"`
	} `json:"response"`
}

type discoveryCommandSummary struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	ArgumentHint string `json:"argumentHint"`
}

type discoveryAgentSummary struct {
	Name string `json:"name"`
}

type systemInitEnvelope struct {
	Type    string   `json:"type"`
	Subtype string   `json:"subtype"`
	Skills  []string `json:"skills"`
}

func ParseCommandSummariesFromLine(line []byte) ([]CommandSummary, bool, error) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil, false, nil
	}

	var envelope discoveryTypeEnvelope
	if err := json.Unmarshal(line, &envelope); err != nil {
		return nil, false, nil
	}
	if envelope.Type != "control_response" {
		return nil, false, nil
	}

	var payload controlResponseEnvelope
	if err := json.Unmarshal(line, &payload); err != nil {
		return nil, false, err
	}

	commands := make([]CommandSummary, 0, len(payload.Response.Response.Commands))
	for _, command := range payload.Response.Response.Commands {
		commands = append(commands, CommandSummary{
			Name:         command.Name,
			Description:  command.Description,
			ArgumentHint: command.ArgumentHint,
		})
	}

	return dedupeCommandSummaries(commands), true, nil
}

func ParseSkillsFromLine(line []byte) ([]string, bool, error) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil, false, nil
	}

	var envelope discoveryTypeEnvelope
	if err := json.Unmarshal(line, &envelope); err != nil {
		return nil, false, nil
	}
	switch envelope.Type {
	case "system":
		var payload systemInitEnvelope
		if err := json.Unmarshal(line, &payload); err != nil {
			return nil, false, err
		}
		if payload.Subtype != "init" {
			return nil, false, nil
		}

		return dedupeSkills(payload.Skills), true, nil
	default:
		return nil, false, nil
	}
}

func ParseAgentsFromLine(line []byte) ([]string, bool, error) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil, false, nil
	}

	var envelope discoveryTypeEnvelope
	if err := json.Unmarshal(line, &envelope); err != nil {
		return nil, false, nil
	}
	if envelope.Type != "control_response" {
		return nil, false, nil
	}

	var payload controlResponseEnvelope
	if err := json.Unmarshal(line, &payload); err != nil {
		return nil, false, err
	}

	agents := make([]string, 0, len(payload.Response.Response.Agents))
	for _, agent := range payload.Response.Response.Agents {
		agents = append(agents, agent.Name)
	}
	return dedupeSkills(agents), len(agents) > 0, nil
}

func CollectDiscoveryData(lines [][]byte) (commands []CommandSummary, skills []string, agents []string, err error) {
	commandSeen := make(map[string]struct{})
	skillSeen := make(map[string]struct{})
	agentSeen := make(map[string]struct{})

	for _, line := range lines {
		parsedCommands, ok, parseErr := ParseCommandSummariesFromLine(line)
		if parseErr != nil {
			return nil, nil, nil, parseErr
		}
		if ok {
			for _, command := range parsedCommands {
				name := strings.TrimPrefix(strings.TrimSpace(command.Name), "/")
				if name == "" {
					continue
				}
				if _, exists := commandSeen[name]; exists {
					continue
				}
				commandSeen[name] = struct{}{}
				command.Name = name
				commands = append(commands, command)
			}
		}

		parsedSkills, ok, parseErr := ParseSkillsFromLine(line)
		if parseErr != nil {
			return nil, nil, nil, parseErr
		}
		if ok {
			for _, skill := range parsedSkills {
				name := strings.TrimPrefix(strings.TrimSpace(skill), "/")
				if name == "" {
					continue
				}
				if _, exists := skillSeen[name]; exists {
					continue
				}
				skillSeen[name] = struct{}{}
				skills = append(skills, name)
			}
		}

		parsedAgents, ok, parseErr := ParseAgentsFromLine(line)
		if parseErr != nil {
			return nil, nil, nil, parseErr
		}
		if ok {
			for _, agent := range parsedAgents {
				name := strings.TrimPrefix(strings.TrimSpace(agent), "/")
				if name == "" {
					continue
				}
				if _, exists := agentSeen[name]; exists {
					continue
				}
				agentSeen[name] = struct{}{}
				agents = append(agents, name)
			}
		}
	}

	return commands, skills, agents, nil
}

func dedupeCommandSummaries(commands []CommandSummary) []CommandSummary {
	seen := make(map[string]struct{}, len(commands))
	result := make([]CommandSummary, 0, len(commands))

	for _, command := range commands {
		name := strings.TrimPrefix(strings.TrimSpace(command.Name), "/")
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		command.Name = name
		result = append(result, command)
	}

	return result
}

func dedupeSkills(skills []string) []string {
	seen := make(map[string]struct{}, len(skills))
	result := make([]string, 0, len(skills))

	for _, skill := range skills {
		name := strings.TrimPrefix(strings.TrimSpace(skill), "/")
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}

	return result
}
