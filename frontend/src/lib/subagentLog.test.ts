import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  emptyTranscript,
  parseTranscriptLines,
  summarizeTranscript,
} from "./subagentLog";

describe("parseTranscriptLines", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseTranscriptLines([]), []);
  });

  it("parses valid JSONL lines and skips invalid ones", () => {
    const original = console.warn;
    let warned = 0;
    console.warn = () => {
      warned += 1;
    };
    try {
      const result = parseTranscriptLines([
        '{"type":"user"}',
        "not json at all",
        '{"type":"assistant"}',
        "",
      ]);
      assert.equal(result.length, 2);
      assert.equal(result[0].type, "user");
      assert.equal(result[1].type, "assistant");
      assert.equal(warned, 1);
    } finally {
      console.warn = original;
    }
  });
});

describe("summarizeTranscript", () => {
  it("counts tool uses and tokens", () => {
    const messages = [
      {
        type: "assistant",
        message: {
          usage: { input_tokens: 10, output_tokens: 20 },
          content: [
            { type: "tool_use", id: "tu_1", name: "Read", input: {} },
            { type: "tool_use", id: "tu_2", name: "Bash", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1" }],
        },
      },
    ];

    const summary = summarizeTranscript(messages as any);
    assert.equal(summary.totalTokens, 30);

    const read = summary.toolCounts.get("Read");
    const bash = summary.toolCounts.get("Bash");
    assert.equal(read?.count, 1);
    assert.equal(read?.running, 0);
    assert.equal(bash?.count, 1);
    assert.equal(bash?.running, 1);
  });

  it("derives running status when no terminal message is present", () => {
    const summary = summarizeTranscript([
      { type: "assistant", message: { content: [] } },
    ] as any);
    assert.equal(summary.status, "running");
  });

  it("derives completed from a result message", () => {
    const summary = summarizeTranscript([
      { type: "assistant", message: { content: [] } },
      { type: "result", subtype: "success" },
    ] as any);
    assert.equal(summary.status, "completed");
  });

  it("derives failed from a result error subtype", () => {
    const summary = summarizeTranscript([
      { type: "result", subtype: "error_max_turns" },
    ] as any);
    assert.equal(summary.status, "failed");
  });

  it("computes elapsedMs from message timestamps", () => {
    const summary = summarizeTranscript([
      { type: "user", timestamp: "2026-05-15T01:00:00.000Z" },
      { type: "assistant", timestamp: "2026-05-15T01:00:30.000Z" },
    ] as any);
    assert.equal(summary.elapsedMs, 30_000);
  });
});

describe("emptyTranscript", () => {
  it("returns a fresh empty transcript", () => {
    const t = emptyTranscript();
    assert.equal(t.messages.length, 0);
    assert.equal(t.lastLineIndex, 0);
    assert.equal(t.truncatedBefore, 0);
    assert.equal(t.fileMissing, false);
    assert.equal(t.loadingEarlier, false);
  });
});
