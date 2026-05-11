import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const subagentProgressPanelPath = path.resolve(currentDir, './SubagentProgressPanel.tsx');
const aiCodeSessionPath = path.resolve(currentDir, './ai-code-session/AiCodeSession.tsx');
const agentExecutionPath = path.resolve(currentDir, './AgentExecution.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('SubagentProgressPanel supports controlled expansion state', async () => {
  const source = await readSource(subagentProgressPanelPath);

  assert.match(source, /expanded\?: boolean;/);
  assert.match(source, /onExpandedChange\?: \(expanded: boolean\) => void;/);
  assert.match(source, /expandedAgents\?: Set<string>;/);
  assert.match(source, /onExpandedAgentsChange\?: \(expandedAgents: Set<string>\) => void;/);
  assert.match(source, /const expanded = controlledExpanded \?\? uncontrolledExpanded;/);
  assert.match(source, /const expandedAgents = controlledExpandedAgents \?\? uncontrolledExpandedAgents;/);
});

test('AiCodeSession keeps subagent expansion state outside the virtualized row', async () => {
  const source = await readSource(aiCodeSessionPath);

  assert.match(source, /const \[isSubagentPanelExpanded, setIsSubagentPanelExpanded\] = useState\(false\);/);
  assert.match(source, /const \[expandedSubagentIds, setExpandedSubagentIds\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(source, /<SubagentProgressPanel[\s\S]*expanded=\{isSubagentPanelExpanded\}[\s\S]*onExpandedChange=\{setIsSubagentPanelExpanded\}[\s\S]*expandedAgents=\{expandedSubagentIds\}[\s\S]*onExpandedAgentsChange=\{setExpandedSubagentIds\}/);
});

test('virtualized stream rows use message identity instead of row index for keys', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);

  assert.match(aiCodeSessionSource, /increaseViewportBy=\{\{ top: 800, bottom: 1200 \}\}/);
  assert.match(aiCodeSessionSource, /overscan=\{\{ main: 600, reverse: 600 \}\}/);
  assert.match(aiCodeSessionSource, /computeItemKey=\{\(_, item\) => item\.type === 'subagent-panel'[\s\S]*item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`/);
  assert.doesNotMatch(aiCodeSessionSource, /`msg-\$\{item\.originalIndex\}-\$\{index\}`/);
  assert.match(agentExecutionSource, /const messageIndexByObject = React\.useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(agentExecutionSource, /return `\$\{prefix\}\$\{item\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(item\) \?\? 0\}`\}`;/);
  assert.doesNotMatch(agentExecutionSource, /`msg-\$\{index\}-\$\{item\.type\}`/);
  assert.doesNotMatch(agentExecutionSource, /`fullscreen-msg-\$\{index\}-\$\{item\.type\}`/);
});
