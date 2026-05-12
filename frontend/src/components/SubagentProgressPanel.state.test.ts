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
const useSessionEventsPath = path.resolve(currentDir, './ai-code-session/hooks/useSessionEvents.ts');
const messageFilterPath = path.resolve(currentDir, './ai-code-session/utils/messageFilter.ts');
const toolWidgetsPath = path.resolve(currentDir, './ToolWidgets.tsx');
const attachmentMenuPath = path.resolve(currentDir, './attachment/AttachmentMenu.tsx');
const messageScrollSeekPlaceholderPath = path.resolve(currentDir, './MessageScrollSeekPlaceholder.tsx');
const sessionStatusBarPath = path.resolve(currentDir, './ai-code-session/SessionStatusBar.tsx');
const floatingPromptInputPath = path.resolve(currentDir, './FloatingPromptInput.tsx');
const projectListPath = path.resolve(currentDir, './ProjectList.tsx');
const popoverPath = path.resolve(currentDir, './ui/popover.tsx');
const pathUtilsPath = path.resolve(currentDir, '../lib/pathUtils.ts');
const messagePresentationPath = path.resolve(currentDir, './ai-code-session/utils/messagePresentation.ts');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('popover content renders outside clipped input containers', async () => {
  const popoverSource = await readSource(popoverPath);

  assert.match(popoverSource, /import \{ createPortal \} from "react-dom";/);
  assert.match(popoverSource, /position: 'fixed',[\s\S]*zIndex: 1000/);
  assert.match(popoverSource, /createPortal\([\s\S]*document\.body/);
  assert.doesNotMatch(popoverSource, /"absolute z-50/);
});

test('continued conversation summaries default to collapsed cards', async () => {
  const messagePresentationSource = await readSource(messagePresentationPath);

  assert.match(messagePresentationSource, /startsWithContinuationSummary = normalized\.startsWith\('This session is being continued from a previous conversation that ran out of context\.'\)/);
  assert.match(messagePresentationSource, /if \(startsWithContinuationSummary\) \{[\s\S]*collapsible: true,[\s\S]*defaultExpanded: false,[\s\S]*title: 'Previous conversation summary'/);
});

test('worktree paths are shortened for message cards', async () => {
  const pathUtilsSource = await readSource(pathUtilsPath);
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(pathUtilsSource, /filePath\.match\(\/\\\/\\\.ropcode\\\/\[\^\/\]\+\\\/\(\.\+\)\$\/\)/);
  assert.match(pathUtilsSource, /return worktreeMatch\[1\];/);
  assert.match(toolWidgetsSource, /const collapsedFilePath = shortenPath\(getEditResultFilePath\(content\)\);/);
});

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

  assert.match(aiCodeSessionSource, /const streamingViewportIncrease = \{ top: 100, bottom: 250 \};/);
  assert.match(aiCodeSessionSource, /const idleViewportIncrease = \{ top: 300, bottom: 600 \};/);
  assert.match(aiCodeSessionSource, /increaseViewportBy=\{processState\.isLoading \? streamingViewportIncrease : idleViewportIncrease\}/);
  assert.doesNotMatch(aiCodeSessionSource, /increaseViewportBy=\{\{ top: 900, bottom: 1400 \}\}/);
  assert.doesNotMatch(aiCodeSessionSource, /overscan=\{\{ main: 600, reverse: 600 \}\}/);
  assert.match(aiCodeSessionSource, /const computeItemKey = useCallback\(\(_: number, item:[\s\S]*item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`, \[\]\);/);
  assert.match(aiCodeSessionSource, /computeItemKey=\{computeItemKey\}/);
  assert.doesNotMatch(aiCodeSessionSource, /`msg-\$\{item\.originalIndex\}-\$\{index\}`/);
  assert.match(agentExecutionSource, /const messageIndexByObject = React\.useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(agentExecutionSource, /return `\$\{prefix\}\$\{item\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(item\) \?\? 0\}`\}`;/);
  assert.doesNotMatch(agentExecutionSource, /`msg-\$\{index\}-\$\{item\.type\}`/);
  assert.doesNotMatch(agentExecutionSource, /`fullscreen-msg-\$\{index\}-\$\{item\.type\}`/);
  assert.match(claudeMessageListSource, /const messageIndexByObject = useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(claudeMessageListSource, /computeItemKey=\{\(_, message\) => message\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(message\) \?\? 0\}`\}/);
  assert.doesNotMatch(claudeMessageListSource, /`msg-\$\{index\}-\$\{message\.type\}`/);
});

test('streaming scroll controls avoid composite-heavy animation effects', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const sessionStatusBarSource = await readSource(sessionStatusBarPath);
  const toolWidgetsSource = await readSource(toolWidgetsPath);
  const scrollControls = aiCodeSessionSource.slice(
    aiCodeSessionSource.indexOf('{/* Scroll buttons */}'),
    aiCodeSessionSource.indexOf('// ==================================================================', aiCodeSessionSource.indexOf('{/* Scroll buttons */}'))
  );

  assert.match(scrollControls, /<div className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4">/);
  assert.match(scrollControls, /bg-background\/95 border rounded-full shadow-sm overflow-hidden pointer-events-auto/);
  assert.match(scrollControls, /active:scale-\[0\.97\]/);
  assert.doesNotMatch(scrollControls, /backdrop-blur-md border rounded-full shadow-lg/);
  assert.doesNotMatch(scrollControls, /transition=\{\{ delay: 0\.5 \}\}/);
  assert.doesNotMatch(scrollControls, /whileTap=\{\{ scale: 0\.97 \}\}/);

  assert.match(sessionStatusBarSource, /transition-colors contain-paint/);
  assert.doesNotMatch(sessionStatusBarSource, /backdrop-blur-md/);
  assert.doesNotMatch(toolWidgetsSource, /animate-pulse|animate-bounce/);
});

test('virtualized stream rows use lightweight placeholders during fast scroll', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const claudeMessageListSource = await readSource(claudeMessageListPath);
  const messageScrollSeekPlaceholderSource = await readSource(messageScrollSeekPlaceholderPath);

  for (const source of [aiCodeSessionSource, agentExecutionSource, claudeMessageListSource]) {
    assert.match(source, /const scrollSeekConfiguration: ScrollSeekConfiguration = \{[\s\S]*enter: \(velocity\) => Math\.abs\(velocity\) > 900,[\s\S]*exit: \(velocity\) => Math\.abs\(velocity\) < 300,[\s\S]*\};/);
    assert.match(source, /function ScrollSeekPlaceholder\(props: \{ height: number \}\) \{/);
    assert.match(source, /<MessageScrollSeekPlaceholder \{\.\.\.props\}/);
    assert.match(source, /scrollSeekConfiguration=\{scrollSeekConfiguration\}/);
    assert.match(source, /ScrollSeekPlaceholder/);
  }

  assert.match(messageScrollSeekPlaceholderSource, /export function MessageScrollSeekPlaceholder\(\{ height, className \}: MessageScrollSeekPlaceholderProps\) \{/);
  assert.match(messageScrollSeekPlaceholderSource, /const rowCount = height > 180 \? 3 : height > 96 \? 2 : 1;/);
  assert.doesNotMatch(messageScrollSeekPlaceholderSource, /getBoundingClientRect|ResizeObserver|requestAnimationFrame|animate-pulse|animate-/);
});

test('markdown code blocks keep readable plain text in dark themes', async () => {
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(streamMessageSource, /<SyntaxHighlighter[\s\S]*codeTagProps=\{\{ className: "!text-foreground" \}\}/);
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
  assert.match(streamMessageSource, /onExpandedCardsChange\?: React\.Dispatch<React\.SetStateAction<Set<string>>>;/);
  assert.match(streamMessageSource, /const expanded = controlledExpanded \?\? uncontrolledExpanded;/);
  assert.match(streamMessageSource, /getCardExpansionProps\(`user-text-\$\{idx\}`, textPresentation\.defaultExpanded\)/);
});

test('session event handling batches hot stream work', async () => {
  const source = await readSource(useSessionEventsPath);

  assert.match(source, /const pendingRuntimeMessagesRef = useRef<ClaudeStreamMessage\[\]>\(\[\]\);/);
  assert.match(source, /runtimeFlushRafRef\.current = requestAnimationFrame\(flushRuntimeTracker\);/);
  assert.match(source, /if \(isTextDeltaMessage\(message\)\) \{[\s\S]*addMessage\(message\);[\s\S]*return;/);
  assert.match(source, /function countCodeFencePairs\(text: string\): number/);
  assert.match(source, /const blockCount = countCodeFencePairs\(block\.text\);/);
  assert.match(source, /const pendingSessionSaveRef = useRef/);
  assert.match(source, /sessionSaveTimeoutRef\.current = setTimeout\(flushPendingSessionSave, 750\);/);
  assert.match(source, /flushPendingSessionSave\(\);[\s\S]*const completePayload = coerceCompletionPayload\(completion\);/);
  assert.doesNotMatch(source, /setRuntimeTracker\(\(current\) => reduceRuntimeTracker\(current, message as any, Date\.now\(\)\)\);/);
  assert.doesNotMatch(source, /block\.text\.match\(\/```\/g\)/);
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

test('render hotspots avoid repeated pure work', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);
  const attachmentMenuSource = await readSource(attachmentMenuPath);
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const floatingPromptInputSource = await readSource(floatingPromptInputPath);
  const projectListSource = await readSource(projectListPath);

  assert.match(toolWidgetsSource, /const systemToolIcons: Record<string, LucideIcon> = \{/);
  assert.match(toolWidgetsSource, /function formatMcpToolName\(toolName: string\)/);
  assert.match(toolWidgetsSource, /const \{ regularTools, mcpTools \} = useMemo\(\(\) => \{/);
  assert.match(toolWidgetsSource, /if \(!expanded \|\| !mcpExpanded\) return \{\} as Record<string, string\[\]>;/);
  assert.match(toolWidgetsSource, /const Icon = getSystemToolIcon\(tool\);/);
  assert.doesNotMatch(toolWidgetsSource, /const toolIcons: Record<string, LucideIcon> = \{[\s\S]*export const SystemInitializedWidget/);

  assert.match(attachmentMenuSource, /const detectMobile = \(\): boolean => \{/);
  assert.match(attachmentMenuSource, /useEffect\(\(\) => \{[\s\S]*if \(!isOpen\) return;[\s\S]*setMobile\(detectMobile\(\)\);/);
  assert.match(attachmentMenuSource, /if \(!isOpen\) return null;/);
  assert.doesNotMatch(attachmentMenuSource, /const mobile = isMobile\(\);/);

  assert.match(aiCodeSessionSource, /const followOutput = useCallback\(\(isAtBottom: boolean\) => \{[\s\S]*\}, \[isScrollPaused, processState\.isLoading\]\);/);
  assert.match(aiCodeSessionSource, /const itemContent = useCallback\(\(_: number, item:[\s\S]*\), \[[\s\S]*messagesState\.subagentProgress,[\s\S]*\]\);/);
  assert.match(aiCodeSessionSource, /const virtuosoComponents = React\.useMemo\(\(\) => \(\{/);
  assert.match(aiCodeSessionSource, /const copyConversationMenu = React\.useMemo\(\(\) => \(/);
  assert.match(aiCodeSessionSource, /const handlePromptConfigChange = useCallback\(\(config: SessionStatusPromptConfig\) => \{/);
  assert.match(aiCodeSessionSource, /onConfigChange=\{handlePromptConfigChange\}/);
  assert.match(aiCodeSessionSource, /extraMenuItems=\{copyConversationMenu\}/);
  assert.match(floatingPromptInputSource, /export const FloatingPromptInput = React\.memo\(React\.forwardRef</);
  assert.match(floatingPromptInputSource, /bg-background\/95 border-t border-border shadow-sm contain-paint/);
  assert.doesNotMatch(floatingPromptInputSource, /w-full bg-background\/95 backdrop-blur-sm border-t border-border shadow-lg/);
  assert.match(projectListSource, /const allWorkspacePathsKey = allWorkspacePaths\.join\('\|'\);/);
  assert.match(projectListSource, /\}, \[allWorkspacePathsKey\]\);/g);
  assert.match(projectListSource, /const sortedProjects = useMemo\([\s\S]*\[\.\.\.projects\]\.sort/);
  assert.match(projectListSource, /const workspacesByProjectId = useMemo\(\(\) => \{/);
  assert.match(projectListSource, /\{sortedProjects\.map\(\(project\) => \{/);
  assert.match(projectListSource, /\{hasWorkspaces && projectWorkspaces\.map\(\(workspace\) => \{/);
  assert.doesNotMatch(projectListSource, /const displayedProjects = sortedProjects\.slice/);
  assert.doesNotMatch(projectListSource, /\{displayedProjects\.map/);
  assert.doesNotMatch(projectListSource, /\{\[\.\.projects\]\.sort/);
  assert.doesNotMatch(projectListSource, /\{hasWorkspaces && \[\.\.project\.workspaces!/);
});

test('RPC request timeouts are cleared when calls settle early', async () => {
  const source = await readSource(path.resolve(currentDir, '../lib/ws-rpc-client.ts'));

  assert.match(source, /type PendingRequest = \{[\s\S]*timeoutId\?: ReturnType<typeof setTimeout>;/);
  assert.match(source, /private pending: Map<string, PendingRequest> = new Map\(\);/);
  assert.match(source, /if \(pending\.timeoutId\) clearTimeout\(pending\.timeoutId\);[\s\S]*pending\.resolve\(result\);/);
  assert.match(source, /pending\.timeoutId = setTimeout\(\(\) => \{/);
  assert.match(source, /this\.pending\.forEach\(\(pending\) => \{[\s\S]*clearTimeout\(pending\.timeoutId\);[\s\S]*pending\.reject\(new Error\('WebSocket disconnected'\)\);/);
});

test('heavy edit diffs are computed only when expanded', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(toolWidgetsSource, /import React, \{ useMemo, useState \} from "react";/);
  assert.doesNotMatch(toolWidgetsSource, /import \{ motion, AnimatePresence \} from "framer-motion";/);
  assert.match(toolWidgetsSource, /const diffResult = useMemo\(\(\) => \{[\s\S]*if \(!expanded\) return \[\];[\s\S]*Diff\.diffLines\(old_string \|\| '', new_string \|\| '',/);
});

test('collapsed read and edit results do not parse or highlight file content', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(toolWidgetsSource, /const \[isExpanded, setIsExpanded\] = useControlledExpansion\(expansionProps\);/);
  assert.match(toolWidgetsSource, /\{isExpanded && \(\(\) => \{[\s\S]*const \{ codeContent, startLineNumber \} = parseContent\(content\);[\s\S]*<SyntaxHighlighter/);
  assert.doesNotMatch(toolWidgetsSource, /Click "Expand" to view the file/);
  assert.match(toolWidgetsSource, /function getEditResultFilePath\(content: string\): string \{[\s\S]*content\.match\(\/The file \(\.\+\) has been updated\/\)/);
  assert.match(toolWidgetsSource, /function parseEditResultContent\(content: string\) \{[\s\S]*const lines = content\.split\('\\n'\);/);
  assert.match(toolWidgetsSource, /\{isExpanded \? \(\(\) => \{[\s\S]*const \{ filePath, codeContent, startLineNumber \} = parseEditResultContent\(content\);[\s\S]*<SyntaxHighlighter/);
  assert.match(toolWidgetsSource, /Click "Expand" to view the edit result/);
  assert.doesNotMatch(toolWidgetsSource, /shouldUsePlainCode|PLAIN_CODE|shouldRenderPlainCodeBlock/);
});

test('collapsed MCP parameters do not stringify or highlight large JSON', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);

  assert.match(toolWidgetsSource, /const inputTokenSource = hasInput \? JSON\.stringify\(input\) : '';/);
  assert.match(toolWidgetsSource, /const shouldRenderFullInput = !isLargeInput \|\| isParametersExpanded;/);
  assert.match(toolWidgetsSource, /const inputString = shouldRenderFullInput \? JSON\.stringify\(input, null, 2\) : '';/);
  assert.match(toolWidgetsSource, /\{shouldRenderFullInput \? \([\s\S]*<SyntaxHighlighter[\s\S]*\) : \([\s\S]*Click "Show full parameters" to view JSON parameters/);
});

test('tool card expansion state is controlled by StreamMessage stable card keys', async () => {
  const toolWidgetsSource = await readSource(toolWidgetsPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(toolWidgetsSource, /export interface ControlledExpansionProps \{[\s\S]*expanded\?: boolean;[\s\S]*onExpandedChange\?: \(expanded: boolean\) => void;/);
  assert.match(toolWidgetsSource, /function useControlledExpansion\(\{ defaultExpanded = false, expanded: controlledExpanded, onExpandedChange \}: ControlledExpansionProps = \{\}\)/);
  for (const widget of ['WebSearchWidget', 'WebFetchWidget', 'ReadResultWidget', 'EditResultWidget', 'GrepWidget', 'MCPWidget', 'TaskWidget', 'ThinkingWidget', 'SystemInstructionWidget']) {
    assert.match(toolWidgetsSource, new RegExp(`export const ${widget}: React\\.FC<[\\s\\S]*ControlledExpansionProps`));
  }

  assert.match(streamMessageSource, /const \[uncontrolledExpandedCards, setUncontrolledExpandedCards\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(streamMessageSource, /const currentExpandedCards = expandedCards \?\? uncontrolledExpandedCards;/);
  assert.match(streamMessageSource, /const updateExpandedCards = onExpandedCardsChange \?\? setUncontrolledExpandedCards;/);
  assert.match(streamMessageSource, /const toolCardKey = `tool-\$\{toolName \|\| 'unknown'\}-\$\{toolId \|\| idx\}`;/);
  assert.match(streamMessageSource, /<WebSearchWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(streamMessageSource, /<WebFetchWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(streamMessageSource, /<MCPWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(streamMessageSource, /<TaskWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`\$\{toolCardKey\}-task-instructions`, false\)\}/);
  assert.match(streamMessageSource, /<ThinkingWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`thinking-\$\{idx\}`, false\)\}/);
  assert.match(streamMessageSource, /<EditResultWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| idx\}-edit`, false\)\}/);
  assert.match(streamMessageSource, /<ReadResultWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| idx\}-read`, false\)\}/);
  assert.match(streamMessageSource, /const summaryExpansion = getCardExpansionProps\('conversation-summary', false\);/);
  assert.match(streamMessageSource, /const toolResultExpansion = getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| idx\}`, false\);/);
  assert.match(streamMessageSource, /const resultExpansion = getCardExpansionProps\('result-details', false\);/);
  assert.match(streamMessageSource, /<SystemInstructionWidget[\s\S]*\{\.\.\.getExpansionProps\?\.\(`\$\{keyPrefix\}system-instruction-\$\{instructionIndex\}`, false\)\}/);
  assert.doesNotMatch(streamMessageSource, /expandedToolResults|setExpandedToolResults|setIsSummaryExpanded|const \[expanded, setExpanded\] = useState\(false\)/);
});

test('SubagentProgressPanel memoizes transcript filtering while rendering all messages', async () => {
  const source = await readSource(subagentProgressPanelPath);

  assert.match(source, /const SubagentTranscript = React\.memo\(function SubagentTranscript/);
  assert.match(source, /const transcriptMessages = React\.useMemo\([\s\S]*subagent\.messages\.filter\(\(message\) => !isDuplicatePromptMessage\(message, subagent\.prompt\)\)/);
  assert.match(source, /return \[\.\.\.fallbackMessages, \.\.\.transcriptMessages\];/);
  assert.match(source, /const streamContext = React\.useMemo\(\(\) => buildStreamMessageContext\(renderMessages as any\), \[renderMessages\]\);/);
  assert.doesNotMatch(source, /MAX_RENDERED_SUBAGENT_MESSAGES|slice\(-MAX_RENDERED_SUBAGENT_MESSAGES\)|Showing latest/);
});
