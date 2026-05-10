import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(currentDir, './useSubagentTranscriptSync.ts');
const aiCodeSessionPath = path.resolve(currentDir, '../components/ai-code-session/AiCodeSession.tsx');
const agentExecutionPath = path.resolve(currentDir, '../components/AgentExecution.tsx');
const sessionOutputViewerPath = path.resolve(currentDir, '../components/SessionOutputViewer.tsx');
const agentRunOutputViewerPath = path.resolve(currentDir, '../components/AgentRunOutputViewer.tsx');
const agentRunViewPath = path.resolve(currentDir, '../components/AgentRunView.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('useSubagentTranscriptSync only loads transcripts when live subagents exist', async () => {
  const source = await readSource(hookPath);

  assert.match(source, /const hasSubagents = subagentProgress\.subagents\.length > 0;/);
  assert.match(source, /const canLoad = Boolean\(enabled && sessionId && projectId && hasSubagents\);/);
  assert.match(source, /const shouldPoll = Boolean\(canLoad && active && subagentProgress\.runningCount > 0\);/);
  assert.match(source, /pollIntervalRef\.current = setInterval\(\(\) => \{[\s\S]*void loadTranscripts\(\);[\s\S]*\}, pollIntervalMs\);/);
});

 test('useSubagentTranscriptSync retries after completion so late sidechain files can appear', async () => {
  const source = await readSource(hookPath);

  assert.match(source, /const FINAL_REFRESH_DELAYS_MS = \[750, 2000, 5000\];/);
  assert.match(source, /const finalRefreshTimeoutRefs = useRef<ReturnType<typeof setTimeout>\[\]>\(\[\]\);/);
  assert.match(source, /finalRefreshTimeoutRefs\.current = FINAL_REFRESH_DELAYS_MS\.map\(\(delayMs\) => setTimeout\(\(\) => \{[\s\S]*void loadTranscripts\(\);[\s\S]*\}, delayMs\)\);/);
});

test('useSubagentTranscriptSync guards in-flight stale and unchanged transcript loads', async () => {
  const source = await readSource(hookPath);

  assert.match(source, /const inflightKeysRef = useRef<Set<string>>\(new Set\(\)\);/);
  assert.match(source, /if \(inflightKeysRef\.current\.has\(loadKey\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /if \(latestLoadKeyRef\.current !== loadKey\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /const nextSig = serializeTranscripts\(nextTranscripts\);/);
  assert.match(source, /if \(lastLoadedKeyRef\.current === loadKey && lastTranscriptSigRef\.current === nextSig\) \{[\s\S]*return;[\s\S]*\}/);
});

test('live subagent renderers use shared transcript sync and canonical merge point', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const sessionOutputViewerSource = await readSource(sessionOutputViewerPath);
  const agentRunOutputViewerSource = await readSource(agentRunOutputViewerPath);
  const agentRunViewSource = await readSource(agentRunViewPath);

  assert.match(aiCodeSessionSource, /useSubagentTranscriptSync\(\{[\s\S]*sessionId: liveSubagentSessionInfo\.sessionId,[\s\S]*projectId: liveSubagentSessionInfo\.projectId,[\s\S]*subagentProgress: messagesState\.subagentProgress,[\s\S]*setSubagentTranscripts: messagesState\.setSubagentTranscripts,[\s\S]*\}\);/);
  assert.doesNotMatch(aiCodeSessionSource, /Object\.keys\(messagesState\.subagentTranscripts\)\.length > 0/);

  assert.match(agentExecutionSource, /const \[subagentTranscripts, setSubagentTranscripts\] = useState<Record<string, ClaudeStreamMessage\[\]>>\(\{\}\);/);
  assert.match(agentExecutionSource, /\(\) => buildSubagentProgress\(messages, subagentTranscripts\),/);
  assert.match(agentExecutionSource, /useSubagentTranscriptSync\(\{[\s\S]*sessionId: subagentSessionInfo\.sessionId,[\s\S]*projectId: subagentSessionInfo\.projectId,[\s\S]*active: isRunning,[\s\S]*subagentProgress,[\s\S]*setSubagentTranscripts,[\s\S]*\}\);/);

  assert.match(sessionOutputViewerSource, /const liveSubagentSessionInfo = useMemo\(\(\) => \{[\s\S]*const initMessage = messages\.find\(\(message\) => message\.type === 'system' && message\.subtype === 'init'\);[\s\S]*initMessage\?\.claude_session_id \|\| initMessage\?\.session_id \|\| initMessage\?\.sessionId \|\| session\.session_id/);
  assert.match(sessionOutputViewerSource, /useSubagentTranscriptSync\(\{[\s\S]*sessionId: liveSubagentSessionInfo\.sessionId,[\s\S]*projectId: liveSubagentSessionInfo\.projectId,[\s\S]*active: session\.status === 'running',[\s\S]*subagentProgress,[\s\S]*setSubagentTranscripts,[\s\S]*\}\);/);
  assert.match(sessionOutputViewerSource, /\(\) => buildSubagentProgress\(messages, subagentTranscripts\),/);

  assert.match(agentRunOutputViewerSource, /const \[subagentTranscripts, setSubagentTranscripts\] = useState<Record<string, ClaudeStreamMessage\[\]>>\(\{\}\);/);
  assert.match(agentRunOutputViewerSource, /\(\) => buildSubagentProgress\(messages, subagentTranscripts\),/);
  assert.match(agentRunOutputViewerSource, /const liveSubagentSessionInfo = useMemo\(\(\) => \{[\s\S]*const initMessage = messages\.find\(\(message\) => message\.type === 'system' && message\.subtype === 'init'\);[\s\S]*initMessage\?\.claude_session_id \|\| initMessage\?\.session_id \|\| initMessage\?\.sessionId \|\| run\?\.session_id/);
  assert.match(agentRunOutputViewerSource, /useSubagentTranscriptSync\(\{[\s\S]*sessionId: liveSubagentSessionInfo\.sessionId,[\s\S]*projectId: liveSubagentSessionInfo\.projectId,[\s\S]*active: run\?\.status === 'running',[\s\S]*subagentProgress,[\s\S]*setSubagentTranscripts,[\s\S]*\}\);/);
  assert.match(agentRunOutputViewerSource, /if \(subagentProgress\.subagentMessageIndexes\.has\(index\)\) return false;/);
  assert.match(agentRunOutputViewerSource, /if \(isSubagentEnvelopeMessage\(message\)\) return false;/);
  assert.match(agentRunViewSource, /buildSubagentProgress\(messages, subagentTranscripts\)/);
  assert.match(agentRunViewSource, /if \(isSubagentEnvelopeMessage\(message\)\) return false;/);
  assert.match(sessionOutputViewerSource, /if \(isSubagentEnvelopeMessage\(message\)\) return false;/);
  assert.match(agentExecutionSource, /if \(isSubagentEnvelopeMessage\(message\)\) return false;/);
  assert.match(agentExecutionSource, /'agentoutputtool'/);
  assert.match(sessionOutputViewerSource, /'agentoutputtool'/);
  assert.match(agentRunOutputViewerSource, /'agentoutputtool'/);
  assert.match(agentRunOutputViewerSource, /<SubagentProgressPanel[\s\S]*summary=\{subagentProgress\}[\s\S]*streamMessages=\{messages\}/);
});
