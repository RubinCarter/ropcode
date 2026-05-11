import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const subagentProgressPanelPath = path.resolve(currentDir, './SubagentProgressPanel.tsx');
const aiCodeSessionPath = path.resolve(currentDir, './ai-code-session/AiCodeSession.tsx');
const agentExecutionPath = path.resolve(currentDir, './AgentExecution.tsx');
const claudeMessageListPath = path.resolve(currentDir, './claude-code-session/MessageList.tsx');
const streamMessagePath = path.resolve(currentDir, './StreamMessage.tsx');
const useMessagesPath = path.resolve(currentDir, './ai-code-session/hooks/useMessages.ts');
const messageFilterPath = path.resolve(currentDir, './ai-code-session/utils/messageFilter.ts');
const toolWidgetsPath = path.resolve(currentDir, './ToolWidgets.tsx');

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
  const claudeMessageListSource = await readSource(claudeMessageListPath);

  assert.match(aiCodeSessionSource, /increaseViewportBy=\{\{ top: 900, bottom: 1400 \}\}/);
  assert.doesNotMatch(aiCodeSessionSource, /overscan=\{\{ main: 600, reverse: 600 \}\}/);
  assert.match(aiCodeSessionSource, /computeItemKey=\{\(_, item\) => item\.type === 'subagent-panel'[\s\S]*item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`/);
  assert.doesNotMatch(aiCodeSessionSource, /`msg-\$\{item\.originalIndex\}-\$\{index\}`/);
  assert.match(agentExecutionSource, /const messageIndexByObject = React\.useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(agentExecutionSource, /return `\$\{prefix\}\$\{item\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(item\) \?\? 0\}`\}`;/);
  assert.doesNotMatch(agentExecutionSource, /`msg-\$\{index\}-\$\{item\.type\}`/);
  assert.doesNotMatch(agentExecutionSource, /`fullscreen-msg-\$\{index\}-\$\{item\.type\}`/);
  assert.match(claudeMessageListSource, /const messageIndexByObject = useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(claudeMessageListSource, /computeItemKey=\{\(_, message\) => message\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(message\) \?\? 0\}`\}/);
  assert.doesNotMatch(claudeMessageListSource, /`msg-\$\{index\}-\$\{message\.type\}`/);
});

test('virtualized stream rows use lightweight placeholders during fast scroll', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const claudeMessageListSource = await readSource(claudeMessageListPath);

  for (const source of [aiCodeSessionSource, agentExecutionSource, claudeMessageListSource]) {
    assert.match(source, /const scrollSeekConfiguration: ScrollSeekConfiguration = \{[\s\S]*enter: \(velocity\) => Math\.abs\(velocity\) > 900,[\s\S]*exit: \(velocity\) => Math\.abs\(velocity\) < 300,[\s\S]*\};/);
    assert.match(source, /function ScrollSeekPlaceholder\(\{ height \}: ScrollSeekPlaceholderProps\) \{/);
    assert.match(source, /scrollSeekConfiguration=\{scrollSeekConfiguration\}/);
    assert.match(source, /ScrollSeekPlaceholder/);
  }
});

test('live streaming assistant text avoids markdown and syntax highlighting', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(streamMessageSource, /isStreamingText\?: boolean;/);
  assert.match(streamMessageSource, /if \(isStreamingText\) \{[\s\S]*className="text-sm whitespace-pre-wrap break-words leading-6"[\s\S]*\{textContent\}[\s\S]*\}/);
  assert.match(streamMessageSource, /if \(prev\.isStreamingText !== next\.isStreamingText\) return false;/);
  assert.match(aiCodeSessionSource, /isStreamingTail: processState\.isLoading && originalIndex === messagesState\.messages\.length - 1 && message\?\.type === 'assistant' && !message\.message\?\.usage/);
  assert.match(aiCodeSessionSource, /isStreamingText=\{item\.isStreamingTail\}/);
});

test('AiCodeSession keeps message card expansion state outside virtualized rows', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(aiCodeSessionSource, /const \[expandedMessageCards, setExpandedMessageCards\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(aiCodeSessionSource, /expandedCards=\{expandedMessageCards\}/);
  assert.match(aiCodeSessionSource, /onExpandedCardsChange=\{setExpandedMessageCards\}/);
  assert.match(aiCodeSessionSource, /messageKey=\{item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`\}/);
  assert.match(streamMessageSource, /expandedCards\?: Set<string>;/);
  assert.match(streamMessageSource, /onExpandedCardsChange\?: \(expandedCards: Set<string>\) => void;/);
  assert.match(streamMessageSource, /const expanded = controlledExpanded \?\? uncontrolledExpanded;/);
  assert.match(streamMessageSource, /getCardExpansionProps\(`user-text-\$\{idx\}`, textPresentation\.defaultExpanded\)/);
});

test('stream message filtering avoids duplicate scans and backward tool result lookup', async () => {
  const useMessagesSource = await readSource(useMessagesPath);
  const messageFilterSource = await readSource(messageFilterPath);

  assert.match(useMessagesSource, /import \{ getDisplayableMessages \} from "\.\.\/utils\/messageFilter";/);
  assert.match(useMessagesSource, /const displayable = useMemo\([\s\S]*getDisplayableMessages\(messages, subagentProgress\.subagentMessageIndexes\)/);
  assert.doesNotMatch(useMessagesSource, /filterDisplayableMessages/);
  assert.match(messageFilterSource, /function buildToolUseNamesById\(messages: ClaudeStreamMessage\[\]\): Map<string, string>/);
  assert.match(messageFilterSource, /const toolUseNamesById = buildToolUseNamesById\(messages\);/);
  assert.doesNotMatch(messageFilterSource, /for \(let i = messageIndex - 1; i >= 0; i--\)/);
});

test('heavy edit diffs are computed only when expanded', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(toolWidgetsSource, /import React, \{ useMemo, useState \} from "react";/);
  assert.match(toolWidgetsSource, /const diffResult = useMemo\(\(\) => \{[\s\S]*if \(!expanded\) return \[\];[\s\S]*Diff\.diffLines\(old_string \|\| '', new_string \|\| '',/);
});

test('collapsed read results do not parse or highlight file content', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(toolWidgetsSource, /const \[isExpanded, setIsExpanded\] = useState\(false\);/);
  assert.match(toolWidgetsSource, /\{isExpanded \? \(\(\) => \{[\s\S]*const \{ codeContent, startLineNumber \} = parseContent\(content\);[\s\S]*<SyntaxHighlighter/);
  assert.match(toolWidgetsSource, /Click "Expand" to view the file/);
  assert.doesNotMatch(toolWidgetsSource, /shouldUsePlainCode|PLAIN_CODE|shouldRenderPlainCodeBlock/);
});
