package codex

import (
	"encoding/json"
	"fmt"
	"testing"

	"ropcode/internal/provider"
)

func TestReproduce_UpdatePlan_AllPaths(t *testing.T) {
	// The EXACT data the user sees in the frontend (from their screenshot)
	// Test ALL possible code paths that could produce this

	// Path 1: Interactive item/completed with arguments as string
	t.Run("interactive_completed_string_args", func(t *testing.T) {
		input := `{"method":"item/completed","params":{"item":{"type":"functionCall","id":"call_x","name":"update_plan","arguments":"{\"explanation\":\"按你的要求用多 subagent 并行调研\",\"plan\":[{\"status\":\"in_progress\",\"step\":\"并行检索仓库中 openclaw 线索\"},{\"status\":\"pending\",\"step\":\"汇总用途、接口与依赖信息\"},{\"status\":\"pending\",\"step\":\"给出下一步运行/验证建议\"}]}"},"threadId":"t1","turnId":"turn1"}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "interactive_completed_string", ev)
	})

	// Path 2: Interactive item/completed with arguments as map
	t.Run("interactive_completed_map_args", func(t *testing.T) {
		input := `{"method":"item/completed","params":{"item":{"type":"functionCall","id":"call_x","name":"update_plan","arguments":{"explanation":"按你的要求用多 subagent 并行调研","plan":[{"status":"in_progress","step":"并行检索仓库中 openclaw 线索"},{"status":"pending","step":"汇总用途、接口与依赖信息"},{"status":"pending","step":"给出下一步运行/验证建议"}]}},"threadId":"t1","turnId":"turn1"}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "interactive_completed_map", ev)
	})

	// Path 3: Interactive item/started with arguments as string
	t.Run("interactive_started_string_args", func(t *testing.T) {
		input := `{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_x","name":"update_plan","arguments":"{\"explanation\":\"按你的要求\",\"plan\":[{\"status\":\"in_progress\",\"step\":\"并行检索\"}]}"},"threadId":"t1","turnId":"turn1"}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "interactive_started_string", ev)
	})

	// Path 4: Interactive item/started with arguments as map
	t.Run("interactive_started_map_args", func(t *testing.T) {
		input := `{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_x","name":"update_plan","arguments":{"explanation":"按你的要求","plan":[{"status":"in_progress","step":"并行检索"}]}},"threadId":"t1","turnId":"turn1"}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "interactive_started_map", ev)
	})

	// Path 5: Batch item.completed
	t.Run("batch_completed", func(t *testing.T) {
		input := `{"type":"item.completed","item":{"id":"call_x","type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"按你的要求\",\"plan\":[{\"status\":\"in_progress\",\"step\":\"并行检索\"}]}"}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "batch_completed", ev)
	})

	// Path 6: Batch item.completed with inline plan (no arguments field)
	t.Run("batch_completed_inline", func(t *testing.T) {
		input := `{"type":"item.completed","item":{"id":"call_x","type":"function_call","name":"update_plan","explanation":"按你的要求","plan":[{"status":"in_progress","step":"并行检索"}]}}`
		d := &Driver{}
		ev := d.ParseOutput([]byte(input))
		dumpAndVerify(t, "batch_completed_inline", ev)
	})

	// Path 7: History response_item/function_call
	t.Run("history_response_item", func(t *testing.T) {
		input := `{"type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"按你的要求\",\"plan\":[{\"status\":\"in_progress\",\"step\":\"并行检索\"}]}","call_id":"call_x"}}`
		var raw map[string]any
		json.Unmarshal([]byte(input), &raw)
		ev := NormalizeHistoryEntry(raw)
		dumpAndVerifyHistory(t, "history_response_item", ev)
	})

	// Path 8: History item.completed/function_call
	t.Run("history_item_completed", func(t *testing.T) {
		input := `{"type":"item.completed","item":{"id":"call_x","type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"按你的要求\",\"plan\":[{\"status\":\"in_progress\",\"step\":\"并行检索\"}]}"}}`
		var raw map[string]any
		json.Unmarshal([]byte(input), &raw)
		ev := NormalizeHistoryEntry(raw)
		dumpAndVerifyHistory(t, "history_item_completed", ev)
	})
}

func TestReproduce_AdaptToolCall_UpdatePlan(t *testing.T) {
	// This is the ACTUAL function being called by the app
	// The exact args that Codex sends (from user's screenshot)
	args := map[string]interface{}{
		"explanation": "按你的要求用多 subagent 并行调研 openclaw；我这边同时做一次本地快速扫仓库，最后汇总成一份可执行的结论。",
		"plan": []interface{}{
			map[string]interface{}{"status": "in_progress", "step": "并行检索仓库中 openclaw 线索"},
			map[string]interface{}{"status": "pending", "step": "汇总用途、接口与依赖信息"},
			map[string]interface{}{"status": "pending", "step": "给出下一步运行/验证建议"},
		},
	}

	name, result := adaptToolCall("update_plan", args)

	if name != "TodoWrite" {
		t.Fatalf("expected name=TodoWrite, got %q", name)
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("result should be map, got %T", result)
	}

	// MUST NOT have raw Codex fields
	if _, has := resultMap["explanation"]; has {
		t.Fatal("LEAKED: result contains 'explanation'")
	}
	if _, has := resultMap["plan"]; has {
		t.Fatal("LEAKED: result contains 'plan'")
	}

	// MUST have todos
	todos, ok := resultMap["todos"].([]map[string]interface{})
	if !ok {
		// Try []interface{}
		todosAny, ok2 := resultMap["todos"].([]interface{})
		if !ok2 {
			t.Fatalf("result should have 'todos', got keys: %v", keys(resultMap))
		}
		if len(todosAny) != 3 {
			t.Fatalf("expected 3 todos, got %d", len(todosAny))
		}
		first, _ := todosAny[0].(map[string]interface{})
		if first["content"] != "并行检索仓库中 openclaw 线索" {
			t.Fatalf("first todo content = %v", first["content"])
		}
		if first["status"] != "in_progress" {
			t.Fatalf("first todo status = %v", first["status"])
		}
		if first["activeForm"] == nil || first["activeForm"] == "" {
			t.Fatal("first todo activeForm should be set")
		}
		return
	}

	if len(todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(todos))
	}
}

func keys(m map[string]interface{}) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}

func getTodosFromMap(input map[string]interface{}) []map[string]interface{} {
	if todos, ok := input["todos"].([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(todos))
		for _, item := range todos {
			if m, ok := item.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	if todos, ok := input["todos"].([]map[string]interface{}); ok {
		return todos
	}
	return nil
}

func dumpAndVerify(t *testing.T, path string, ev *provider.OutputEvent) {

	// Verify NO raw codex fields in the tool_use input
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatalf("[%s] no message.message", path)
	}
	content, _ := inner["content"].([]map[string]interface{})
	if len(content) == 0 {
		t.Fatalf("[%s] no content blocks", path)
	}
	block := content[0]
	if block["type"] != "tool_use" {
		t.Fatalf("[%s] expected tool_use, got %v", path, block["type"])
	}
	if block["name"] != "TodoWrite" {
		t.Fatalf("[%s] expected name=TodoWrite, got %v", path, block["name"])
	}
	input, _ := block["input"].(map[string]interface{})
	if input == nil {
		t.Fatalf("[%s] input is nil", path)
	}
	if _, has := input["explanation"]; has {
		t.Fatalf("[%s] LEAKED: input contains 'explanation'", path)
	}
	if _, has := input["plan"]; has {
		t.Fatalf("[%s] LEAKED: input contains 'plan'", path)
	}
	todos := getTodosFromMap(input)
	if len(todos) == 0 {
		t.Fatalf("[%s] todos is empty", path)
	}
	fmt.Printf("[%s] ✓ Correctly transformed to {todos: [%d items]}\n", path, len(todos))
}

func dumpAndVerifyHistory(t *testing.T, path string, ev provider.OutputEvent) {
	t.Helper()
	out, _ := json.MarshalIndent(ev.Message, "", "  ")
	fmt.Printf("\n[%s] Type=%s Subtype=%s\nMessage=%s\n", path, ev.Type, ev.Subtype, string(out))

	msg := ev.Message
	if msg == nil {
		t.Fatalf("[%s] message is nil", path)
	}
	inner, _ := msg["message"].(map[string]any)
	if inner == nil {
		t.Fatalf("[%s] no message.message", path)
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatalf("[%s] no content blocks", path)
	}
	block, _ := content[0].(map[string]interface{})
	if block["name"] != "TodoWrite" {
		t.Fatalf("[%s] expected name=TodoWrite, got %v", path, block["name"])
	}
	input, _ := block["input"].(map[string]interface{})
	if input == nil {
		t.Fatalf("[%s] input is nil", path)
	}
	if _, has := input["explanation"]; has {
		t.Fatalf("[%s] LEAKED: input contains 'explanation'", path)
	}
	if _, has := input["plan"]; has {
		t.Fatalf("[%s] LEAKED: input contains 'plan'", path)
	}
	todos := getTodosFromMap(input)
	if len(todos) == 0 {
		t.Fatalf("[%s] todos is empty", path)
	}
	fmt.Printf("[%s] ✓ Correctly transformed to {todos: [%d items]}\n", path, len(todos))
}

func TestReproduce_LoadSubagentTranscripts(t *testing.T) {
	dir, err := CodexDir()
	if err != nil {
		t.Skip("no codex dir")
	}
	// Use the real session with subagent_notification
	sessionID := "019e5857-e5ef-7b43-9054-8b984432e1fd"
	transcripts, err := LoadSubagentTranscripts(dir, sessionID)
	if err != nil {
		t.Fatalf("LoadSubagentTranscripts error: %v", err)
	}

	t.Logf("Returned %d transcript groups", len(transcripts))
	for id, msgs := range transcripts {
		t.Logf("  spawn_id=%s: %d messages", id, len(msgs))
		for i, msg := range msgs {
			content, _ := msg.Message["content"].([]interface{})
			if len(content) > 0 {
				block, _ := content[0].(map[string]interface{})
				text, _ := block["text"].(string)
				t.Logf("    msg[%d] type=%s text_len=%d text_preview=%s", i, msg.Type, len(text), text[:min(80, len(text))])
			}
		}
	}

	if len(transcripts) == 0 {
		t.Fatal("expected at least 1 transcript group, got 0")
	}

	// Verify spawn call_ids match known values
	expectedSpawns := []string{
		"call_q1jlSE8G1SOvQz36G35ujdOM",
		"call_dGgvBAadi7UorFko7f9Q28S7",
		"call_BMkjfF3k3tbPPc25ajZ1DXy6",
	}
	for _, spawnID := range expectedSpawns {
		if msgs, ok := transcripts[spawnID]; !ok || len(msgs) == 0 {
			t.Errorf("expected transcript for spawn %s, not found", spawnID)
		} else {
			// Verify content is not empty
			content, _ := msgs[0].Message["content"].([]interface{})
			if len(content) == 0 {
				t.Errorf("spawn %s: transcript has no content", spawnID)
			}
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
