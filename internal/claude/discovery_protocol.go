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
		} `json:"response"`
	} `json:"response"`
}

type discoveryCommandSummary struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	ArgumentHint string `json:"argumentHint"`
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
		return nil, false, err
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
		return nil, false, err
	}
	if envelope.Type != "system" {
		return nil, false, nil
	}

	var payload systemInitEnvelope
	if err := json.Unmarshal(line, &payload); err != nil {
		return nil, false, err
	}
	if payload.Subtype != "init" {
		return nil, false, nil
	}

	return dedupeSkills(payload.Skills), true, nil
}

func CollectDiscoveryData(lines [][]byte) (commands []CommandSummary, skills []string, err error) {
	commandSeen := make(map[string]struct{})
	skillSeen := make(map[string]struct{})

	for _, line := range lines {
		parsedCommands, ok, parseErr := ParseCommandSummariesFromLine(line)
		if parseErr != nil {
			return nil, nil, parseErr
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
			return nil, nil, parseErr
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
	}

	return commands, skills, nil
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
