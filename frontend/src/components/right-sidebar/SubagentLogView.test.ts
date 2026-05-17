import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, "./SubagentLogView.tsx");

async function readSource() {
  return readFile(sourcePath, "utf8");
}

test("SubagentLogView only renders Load earlier button when truncatedBefore > 0", async () => {
  const source = await readSource();
  assert.match(source, /\{truncatedBefore > 0 && \(/);
  assert.match(source, /Load \$\{truncatedBefore\} earlier message/);
});

test("SubagentLogView disables Load earlier while loadingEarlier is true", async () => {
  const source = await readSource();
  assert.match(source, /disabled=\{loadingEarlier\}/);
  assert.match(source, /Loading earlier messages/);
});

test("SubagentLogView shows fileMissing notice", async () => {
  const source = await readSource();
  assert.match(source, /\{fileMissing && \(/);
  assert.match(source, /Transcript file no longer available/);
});

test("SubagentLogView renders one StreamMessage per parsed message", async () => {
  const source = await readSource();
  assert.match(source, /\{messages\.map\(\(message, index\) => \(/);
  assert.match(source, /<StreamMessage[\s\S]*?streamMessages=\{messages as any\}/);
});

test("SubagentLogView passes an empty agentOutputMap (right sidebar has no agent context)", async () => {
  const source = await readSource();
  assert.match(source, /EMPTY_AGENT_OUTPUT_MAP = new Map<string, any>\(\)/);
  assert.match(source, /agentOutputMap=\{EMPTY_AGENT_OUTPUT_MAP\}/);
});

test("SubagentLogView summarises tool counts and tokens via summarizeTranscript", async () => {
  const source = await readSource();
  assert.match(source, /summarizeTranscript\(messages\)/);
  assert.match(source, /Array\.from\(summary\.toolCounts\.entries\(\)\)/);
});
