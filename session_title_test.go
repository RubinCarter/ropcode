package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"ropcode/internal/claude"
	"ropcode/internal/database"
)

func TestCleanGeneratedSessionTitle(t *testing.T) {
	got := cleanGeneratedSessionTitle("  \"Fix Wails session tabs.\"  \nextra text")
	if got != "Fix Wails session tabs" {
		t.Fatalf("cleanGeneratedSessionTitle() = %q", got)
	}
}

func TestFallbackSessionTitleFromPrompt(t *testing.T) {
	got := fallbackSessionTitleFromPrompt("  请帮我检查自动取标题为什么不可用，并且修复左侧会话列表刷新  ")
	if got != "请帮我检查自动取标题为什么不可用，并且修复左侧会话列表刷新" {
		t.Fatalf("fallbackSessionTitleFromPrompt() = %q", got)
	}
}

func TestSessionTitleStoreOverridesSummaryTitle(t *testing.T) {
	store := newSessionTitleStore()
	store.Set("claude", "session-1", "生成后的标题")

	summary := ProviderSessionSummary{
		ID:           "session-1",
		Provider:     "claude",
		Title:        "原始首条消息",
		FirstMessage: "原始首条消息",
	}

	got := applyStoredSessionTitle(summary, store)
	if got.Title != "生成后的标题" {
		t.Fatalf("title = %q, want stored generated title", got.Title)
	}
	if got.FirstMessage != "原始首条消息" {
		t.Fatalf("first message should stay as transcript preview, got %q", got.FirstMessage)
	}
}

func TestSaveGeneratedSessionTitlePersistsInSettings(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "ropcode.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()

	app := &App{dbManager: db, sessionTitles: newSessionTitleStore()}
	if err := app.SaveGeneratedSessionTitle("claude", "session-1", "生成后的标题"); err != nil {
		t.Fatalf("SaveGeneratedSessionTitle() error = %v", err)
	}

	raw, err := db.GetSetting(generatedSessionTitlesSettingKey)
	if err != nil {
		t.Fatalf("GetSetting() error = %v", err)
	}
	var persisted map[string]string
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		t.Fatalf("unmarshal persisted titles: %v", err)
	}
	if persisted["claude:session-1"] != "生成后的标题" {
		t.Fatalf("persisted title = %q, want generated title", persisted["claude:session-1"])
	}

	reloaded := &App{dbManager: db, sessionTitles: newSessionTitleStore()}
	reloaded.loadGeneratedSessionTitles()
	if got := reloaded.sessionTitles.Get("claude", "session-1"); got != "生成后的标题" {
		t.Fatalf("reloaded title = %q, want generated title", got)
	}
}

func TestSanitizeBranchName(t *testing.T) {
	cases := map[string]string{
		"  Fix Auto Title Bug  ":            "fix-auto-title-bug",
		"feat/Refactor Session Title Logic": "refactor-session-title-logic",
		"\"add-rename-button\"":             "add-rename-button",
		"a / very :: silly !! input":        "a-very-silly-input",
		"this-is-a-very-long-branch-name-that-should-get-trimmed-eventually": "this-is-a-very-long-branch-nam",
	}
	for in, want := range cases {
		if got := sanitizeBranchName(in); got != want {
			t.Errorf("sanitizeBranchName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildRecentTranscriptFocusesOnTail(t *testing.T) {
	mk := func(role, text string, sidechain bool) claude.Message {
		return claude.Message{
			Type:        role,
			IsSidechain: sidechain,
			Message: map[string]interface{}{
				"content": []interface{}{
					map[string]interface{}{"type": "text", "text": text},
				},
			},
		}
	}
	msgs := []claude.Message{
		mk("user", "set up the project", false),
		mk("assistant", "done", false),
		mk("user", "ignore me — I am sidechain", true),
		mk("user", "now please rename the branch button", false),
		mk("assistant", "sure, I will add a sparkle icon", false),
	}

	transcript := buildRecentTranscript(msgs)
	if transcript == "" {
		t.Fatalf("transcript should not be empty")
	}
	if !strings.Contains(transcript, "rename the branch button") {
		t.Fatalf("transcript missing latest user message: %q", transcript)
	}
	if strings.Contains(transcript, "sidechain") {
		t.Fatalf("sidechain messages should not be included: %q", transcript)
	}
}

func TestExtractCodexAssistantTextPicksLastMessage(t *testing.T) {
	stdout := strings.Join([]string{
		`{"type":"item.completed","item":{"type":"agent_message","text":"first"}}`,
		`{"type":"task.started"}`,
		`not json`,
		`{"type":"item.completed","item":{"type":"agent_message","text":"second"}}`,
		``,
	}, "\n")

	got := extractCodexAssistantText(stdout)
	if got != "second" {
		t.Fatalf("extractCodexAssistantText() = %q, want \"second\"", got)
	}
}

func TestEnforceTitleInputBudgetTrimsHead(t *testing.T) {
	// User prompt many times the budget — should keep the tail intact.
	huge := strings.Repeat("x", titleInputBudgetRunes*3)
	tail := "...LATEST_FOCUS_MARKER"
	user := huge + tail

	gotSys, gotUser := enforceTitleInputBudget("system", user)
	if gotSys != "system" {
		t.Fatalf("system prompt mutated: %q", gotSys)
	}
	if !strings.HasSuffix(gotUser, tail) {
		t.Fatalf("trimmed user prompt should keep the tail; got suffix %q", gotUser[len(gotUser)-30:])
	}
	total := len(gotSys) + len(gotUser)
	// Allow a small ASCII-vs-rune slack: the cap is on runes, not bytes.
	if total > (titleInputBudgetRunes + 200) {
		t.Fatalf("combined prompt %d exceeds budget", total)
	}
}

func TestIsGenericTitle(t *testing.T) {
	generics := []string{
		"New conversation session setup",
		"new session",
		"Chat session started",
		"Conversation Setup",
		"New Chat Session",
		"Getting started with coding",
		"Hello",
		"No transcript was provided. Please include the <transcript>",
		"I cannot generate a title without context",
		"I'm unable to determine the topic",
		"Please provide more information",
		"As an AI, I need more context",
	}
	for _, title := range generics {
		if !isGenericTitle(title) {
			t.Errorf("isGenericTitle(%q) = false, want true", title)
		}
	}

	valid := []string{
		"Fix auto title generation",
		"重构会话标题逻辑",
		"Add yellow blink animation",
		"Debug WebSocket reconnection",
	}
	for _, title := range valid {
		if isGenericTitle(title) {
			t.Errorf("isGenericTitle(%q) = true, want false", title)
		}
	}
}

func TestExtractMessageTextHandlesCodexTypedContent(t *testing.T) {
	// Codex history loader builds messages with []map[string]interface{} content.
	msg := map[string]interface{}{
		"role": "user",
		"content": []map[string]interface{}{
			{"type": "text", "text": "重命名按钮没有生效"},
		},
	}
	if got := extractMessageText(msg); got != "重命名按钮没有生效" {
		t.Fatalf("extractMessageText() = %q, want plaintext from typed content", got)
	}

	// Multiple text parts joined with newlines.
	multi := map[string]interface{}{
		"content": []map[string]interface{}{
			{"type": "text", "text": "first"},
			{"type": "tool_use", "name": "Bash"}, // ignored
			{"type": "text", "text": "second"},
		},
	}
	if got := extractMessageText(multi); got != "first\nsecond" {
		t.Fatalf("multi-part text = %q", got)
	}
}
