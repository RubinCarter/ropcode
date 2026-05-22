package deepseek

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSessionConfigBuildArgsUsesStreamJSONExec(t *testing.T) {
	config := SessionConfig{
		ProjectPath: `E:\bit_master\ropcode`,
		Prompt:      "hello",
		Model:       "deepseek-v4-pro",
	}

	got := config.buildArgs()

	assertContainsSequence(t, got, "exec")
	assertContainsSequence(t, got, "--auto")
	assertContainsSequence(t, got, "--output-format", "stream-json")
	assertContainsSequence(t, got, "--model", "deepseek-v4-pro")
	assertContainsSequence(t, got, "--", "hello")
	assertNotContains(t, got, "--workspace")
}

func TestSessionConfigBuildArgsSupportsResume(t *testing.T) {
	config := SessionConfig{
		Prompt:    "continue",
		SessionID: "a04454f2-490e-4f5f-b197-22661ab5ca98",
		Resume:    true,
	}

	got := config.buildArgs()

	assertContainsSequence(t, got, "--resume", "a04454f2-490e-4f5f-b197-22661ab5ca98")
}

func TestSessionConfigApplyProviderApiEnv(t *testing.T) {
	env := []string{
		"DEEPSEEK_API_KEY=old-token",
		"DEEPSEEK_BASE_URL=https://old.example",
	}
	config := SessionConfig{
		AuthToken: "new-token",
		BaseURL:   "https://api.example/beta",
	}

	got := config.applyProviderApiEnv(env)

	assertEnvValue(t, got, "DEEPSEEK_API_KEY", "new-token")
	assertEnvValue(t, got, "DEEPSEEK_BASE_URL", "https://api.example/beta")
}

func TestEnhanceEnvForProductionAddsWindowsNodePaths(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only PATH enhancement")
	}

	root := t.TempDir()
	nodeDir := filepath.Join(root, "nodejs")
	npmDir := filepath.Join(root, "npm", "npm")
	if err := os.MkdirAll(nodeDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(npmDir, 0755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("ROPCODE_TEST_NODE_DIR", nodeDir)
	t.Setenv("ROPCODE_TEST_NPM_DIR", npmDir)

	got := enhanceEnvForProduction()
	pathValue := envValue(got, "PATH")
	parts := strings.Split(pathValue, string(os.PathListSeparator))

	nodeIndex := indexOf(parts, nodeDir)
	npmIndex := indexOf(parts, npmDir)
	originalParts := filepath.SplitList(os.Getenv("PATH"))
	originalIndex := -1
	if len(originalParts) > 0 {
		originalIndex = indexOf(parts, originalParts[0])
	}
	if nodeIndex < 0 || npmIndex < 0 {
		t.Fatalf("expected node/npm dirs in PATH, got %q", pathValue)
	}
	if originalIndex >= 0 && (nodeIndex > originalIndex || npmIndex > originalIndex) {
		t.Fatalf("expected node/npm dirs before original PATH, got %q", pathValue)
	}
}

func TestWindowsNodePathsIncludesNvm4wCandidateDirs(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only PATH enhancement")
	}

	paths := windowsNodePaths()

	for _, want := range []string{`E:\nvm4w\nodejs`, `C:\nvm4w\nodejs`, `D:\nvm4w\nodejs`} {
		if indexOf(paths, want) < 0 {
			t.Fatalf("expected windows node candidates to include %q, got %#v", want, paths)
		}
	}
}

func TestEnhancePathEnvUpdatesWindowsPathKeyCaseInsensitively(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only PATH casing")
	}

	root := t.TempDir()
	nodeDir := filepath.Join(root, "nodejs")
	if err := os.MkdirAll(nodeDir, 0755); err != nil {
		t.Fatal(err)
	}

	got := enhancePathEnv([]string{`Path=C:\Windows\System32`}, []string{nodeDir})

	if envValue(got, "Path") == "" {
		t.Fatalf("expected original Path key to be updated, got %#v", got)
	}
	if envValue(got, "PATH") != "" {
		t.Fatalf("did not expect duplicate PATH key, got %#v", got)
	}
	pathValue := envValue(got, "Path")
	parts := strings.Split(pathValue, string(os.PathListSeparator))
	if indexOf(parts, nodeDir) != 0 {
		t.Fatalf("expected node dir to be prepended to Path, got %q", pathValue)
	}
}

func TestTransformContentEventToUnifiedAssistantMessage(t *testing.T) {
	session := NewSession(SessionConfig{ProjectPath: `E:\bit_master\ropcode`})

	line := `{"type":"content","content":"ROP"}`
	unified := session.transformToUnified(line)

	message := decodeJSON(t, unified)
	if message["provider"] != "deepseek" {
		t.Fatalf("provider = %v, want deepseek", message["provider"])
	}
	if message["type"] != "assistant" {
		t.Fatalf("type = %v, want assistant", message["type"])
	}
	content := message["message"].(map[string]interface{})["content"].([]interface{})[0].(map[string]interface{})
	if content["type"] != "text" || content["text"] != "ROP" {
		t.Fatalf("content = %#v, want text ROP", content)
	}
	if message["is_delta"] != true {
		t.Fatalf("is_delta = %v, want true so streamed content merges into one assistant message", message["is_delta"])
	}
}

func TestTransformToolUseEventToUnifiedToolUse(t *testing.T) {
	session := NewSession(SessionConfig{ProjectPath: `E:\bit_master\ropcode`})

	line := `{"type":"tool_use","name":"exec_shell","id":"tool-1","input":{"command":"go test ./..."}}`
	unified := session.transformToUnified(line)

	message := decodeJSON(t, unified)
	content := message["message"].(map[string]interface{})["content"].([]interface{})[0].(map[string]interface{})
	if content["type"] != "tool_use" || content["id"] != "tool-1" || content["name"] != "Bash" {
		t.Fatalf("tool use content = %#v", content)
	}
	input := content["input"].(map[string]interface{})
	if input["command"] != "go test ./..." {
		t.Fatalf("tool input = %#v", input)
	}
}

func TestTransformSessionCaptureUpdatesSessionID(t *testing.T) {
	session := NewSession(SessionConfig{})

	line := `{"type":"session_capture","content":"a04454f2-490e-4f5f-b197-22661ab5ca98"}`
	unified := session.transformToUnified(line)

	message := decodeJSON(t, unified)
	if session.ID != "a04454f2-490e-4f5f-b197-22661ab5ca98" {
		t.Fatalf("session ID = %q", session.ID)
	}
	if message["type"] != "system" || message["subtype"] != "init" {
		t.Fatalf("session capture message = %#v", message)
	}
	if message["session_id"] != "a04454f2-490e-4f5f-b197-22661ab5ca98" {
		t.Fatalf("session_id = %v, want provider session id", message["session_id"])
	}
	if message["runtime_session_id"] == nil || message["runtime_session_id"] == message["session_id"] {
		t.Fatalf("runtime_session_id should preserve the local runtime id separately: %#v", message)
	}
}

func TestTransformDoneEventReturnsResult(t *testing.T) {
	session := NewSession(SessionConfig{})
	localRuntimeID := session.ID
	session.transformToUnified(`{"type":"session_capture","content":"a04454f2-490e-4f5f-b197-22661ab5ca98"}`)

	unified := session.transformToUnified(`{"type":"done"}`)

	message := decodeJSON(t, unified)
	if message["type"] != "result" || message["subtype"] != "session_complete" || message["success"] != true {
		t.Fatalf("done message = %#v", message)
	}
	if message["session_id"] != "a04454f2-490e-4f5f-b197-22661ab5ca98" {
		t.Fatalf("session_id = %v, want provider session id", message["session_id"])
	}
	if message["runtime_session_id"] != localRuntimeID {
		t.Fatalf("runtime_session_id = %v, want original runtime id %q", message["runtime_session_id"], localRuntimeID)
	}
}

func decodeJSON(t *testing.T, raw string) map[string]interface{} {
	t.Helper()
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("invalid JSON %q: %v", raw, err)
	}
	return decoded
}

func assertContainsSequence(t *testing.T, values []string, want ...string) {
	t.Helper()

	for i := 0; i <= len(values)-len(want); i++ {
		matched := true
		for offset, value := range want {
			if values[i+offset] != value {
				matched = false
				break
			}
		}
		if matched {
			return
		}
	}

	t.Fatalf("expected args to contain sequence %q, got %q", want, values)
}

func assertEnvValue(t *testing.T, env []string, key, want string) {
	t.Helper()

	prefix := key + "="
	for _, entry := range env {
		if len(entry) >= len(prefix) && entry[:len(prefix)] == prefix {
			if got := entry[len(prefix):]; got != want {
				t.Fatalf("%s = %q, want %q", key, got, want)
			}
			return
		}
	}

	t.Fatalf("%s was not set in environment", key)
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

func indexOf(values []string, want string) int {
	for i, value := range values {
		if value == want {
			return i
		}
	}
	return -1
}

func assertNotContains(t *testing.T, values []string, forbidden string) {
	t.Helper()

	for _, value := range values {
		if value == forbidden {
			t.Fatalf("expected args not to contain %q, got %q", forbidden, values)
		}
	}
}
