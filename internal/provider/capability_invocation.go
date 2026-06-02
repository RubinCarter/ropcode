package provider

import (
	"fmt"
	"strings"
	"unicode"
)

type capabilityInvocation struct {
	SlashName string
	Arguments string
}

var capabilityWrapperTags = []struct {
	open  string
	close string
}{
	{"<previous_conversation>", "</previous_conversation>"},
	{"<system_instruction>", "</system_instruction>"},
	{"<system-instruction>", "</system-instruction>"},
	{"<environment_context>", "</environment_context>"},
}

// ExpandProviderCapability translates a provider capability invocation such as
// "/commit-as-prompt message" into the prompt content owned by that provider.
// Native provider commands remain the driver's responsibility.
func (m *Manager) ExpandProviderCapability(providerID, projectPath, message string) (string, error) {
	driver, err := m.driver(providerID)
	if err != nil {
		return message, err
	}
	if handler, ok := driver.(ProviderCommandHandler); ok && handler.IsProviderCommand(message) {
		return message, nil
	}
	return m.expandProviderCapabilityForDriver(driver, projectPath, message)
}

func (m *Manager) expandProviderCapabilityForDriver(driver ProviderDriver, projectPath, message string) (string, error) {
	invocation, ok := parseCapabilityInvocation(message)
	if !ok {
		return message, nil
	}

	layers, err := m.GetProviderCapabilities(driver.ID(), projectPath)
	if err != nil {
		return "", err
	}

	for _, capability := range layers.AllVisible {
		if !matchesCapabilityInvocation(capability, invocation.SlashName) {
			continue
		}
		expanded := expandCapabilityPrompt(capability, invocation.Arguments)
		if strings.TrimSpace(expanded) == "" {
			if passthrough, ok := driver.(ProviderCapabilityPassthrough); ok && passthrough.AllowRawCapabilityInvocation(capability) {
				return message, nil
			}
			if capability.Kind == string(CapabilityKindCommand) {
				return "", fmt.Errorf("provider command %q has no app-server handler", invocation.SlashName)
			}
			return message, nil
		}
		return rebuildCapabilityInvocationMessage(message, expanded), nil
	}

	return message, nil
}

func parseCapabilityInvocation(message string) (capabilityInvocation, bool) {
	if invocation, ok := parseCapabilityInvocationText(strings.TrimSpace(message)); ok {
		return invocation, true
	}
	return parseCapabilityInvocationText(stripCapabilityInvocationWrappers(message))
}

func parseCapabilityInvocationText(text string) (capabilityInvocation, bool) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "/") {
		return capabilityInvocation{}, false
	}
	body := strings.TrimPrefix(text, "/")
	if strings.TrimSpace(body) == "" {
		return capabilityInvocation{}, false
	}

	splitAt := -1
	for i, r := range body {
		if unicode.IsSpace(r) {
			splitAt = i
			break
		}
	}

	name := body
	args := ""
	if splitAt >= 0 {
		name = body[:splitAt]
		args = strings.TrimSpace(body[splitAt:])
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return capabilityInvocation{}, false
	}
	return capabilityInvocation{
		SlashName: "/" + strings.TrimPrefix(name, "/"),
		Arguments: args,
	}, true
}

func matchesCapabilityInvocation(capability Capability, slashName string) bool {
	slashName = normalizeSlashName(slashName)
	if slashName == "" {
		return false
	}
	if normalizeSlashName(capability.SlashName) == slashName {
		return true
	}
	if normalizeSlashName(capability.Name) == slashName {
		return true
	}
	return false
}

func normalizeSlashName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return "/" + strings.TrimPrefix(value, "/")
}

func expandCapabilityPrompt(capability Capability, arguments string) string {
	body := strings.TrimSpace(capability.Content)
	if body == "" {
		return ""
	}
	arguments = strings.TrimSpace(arguments)
	if strings.Contains(body, "$ARGUMENTS") {
		return strings.TrimSpace(strings.ReplaceAll(body, "$ARGUMENTS", arguments))
	}
	if arguments == "" {
		return body
	}
	return body + "\n\n" + arguments
}

func stripCapabilityInvocationWrappers(message string) string {
	text := strings.TrimSpace(message)
	for {
		next := text
		for _, tag := range capabilityWrapperTags {
			next = stripCapabilityDelimitedBlocks(next, tag.open, tag.close)
		}
		next = strings.TrimSpace(next)
		if next == text {
			return next
		}
		text = next
	}
}

func stripCapabilityDelimitedBlocks(text, openTag, closeTag string) string {
	out := text
	for {
		start := strings.Index(out, openTag)
		if start < 0 {
			return out
		}
		afterOpen := start + len(openTag)
		relativeEnd := strings.Index(out[afterOpen:], closeTag)
		if relativeEnd < 0 {
			return out
		}
		end := afterOpen + relativeEnd + len(closeTag)
		out = out[:start] + out[end:]
	}
}

func rebuildCapabilityInvocationMessage(original, expanded string) string {
	stripped := strings.TrimSpace(stripCapabilityInvocationWrappers(original))
	if stripped != "" {
		if start := strings.Index(original, stripped); start >= 0 {
			end := start + len(stripped)
			return strings.TrimSpace(original[:start] + expanded + original[end:])
		}
	}

	blocks := collectCapabilityWrapperBlocks(original)
	if len(blocks) == 0 {
		return expanded
	}
	parts := make([]string, 0, len(blocks)+1)
	parts = append(parts, blocks...)
	parts = append(parts, expanded)
	return strings.Join(parts, "\n\n")
}

func collectCapabilityWrapperBlocks(text string) []string {
	var blocks []string
	for i := 0; i < len(text); {
		matched := false
		for _, tag := range capabilityWrapperTags {
			if !strings.HasPrefix(text[i:], tag.open) {
				continue
			}
			afterOpen := i + len(tag.open)
			relativeEnd := strings.Index(text[afterOpen:], tag.close)
			if relativeEnd < 0 {
				continue
			}
			end := afterOpen + relativeEnd + len(tag.close)
			if block := strings.TrimSpace(text[i:end]); block != "" {
				blocks = append(blocks, block)
			}
			i = end
			matched = true
			break
		}
		if !matched {
			i++
		}
	}
	return blocks
}
