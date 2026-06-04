import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const subagentProgressPanelPath = path.resolve(currentDir, './SubagentProgressPanel.tsx');
const sessionControllerPath = path.resolve(currentDir, './ai-code-session/SessionController.tsx');
const messageStreamViewPath = path.resolve(currentDir, './ai-code-session/MessageStreamView.tsx');
const agentExecutionPath = path.resolve(currentDir, './AgentExecution.tsx');
const claudeMessageListPath = path.resolve(currentDir, './claude-code-session/MessageList.tsx');
const streamMessagePath = path.resolve(currentDir, './StreamMessage.tsx');
const streamMessageRenderingPath = path.resolve(currentDir, './stream-message/rendering.tsx');
const streamMessageContextPath = path.resolve(currentDir, './stream-message/context.ts');
const useSessionMessagesPath = path.resolve(currentDir, './ai-code-session/hooks/useSessionMessages.ts');
const useSessionFrameEventsPath = path.resolve(currentDir, './ai-code-session/hooks/useSessionFrameEvents.ts');
const messageFilterPath = path.resolve(currentDir, './ai-code-session/utils/messageFilter.ts');
const toolWidgetsDir = path.resolve(currentDir, './tool-widgets');
const editWidgetPath = path.resolve(toolWidgetsDir, './EditWidget.tsx');
const readWidgetPath = path.resolve(toolWidgetsDir, './ReadWidget.tsx');
const mcpWidgetPath = path.resolve(toolWidgetsDir, './MCPWidget.tsx');
const webSearchWidgetPath = path.resolve(toolWidgetsDir, './WebSearchWidget.tsx');
const systemInitializedWidgetPath = path.resolve(toolWidgetsDir, './SystemInitializedWidget.tsx');
const attachmentMenuPath = path.resolve(currentDir, './attachment/AttachmentMenu.tsx');
const messageScrollSeekPlaceholderPath = path.resolve(currentDir, './MessageScrollSeekPlaceholder.tsx');
const sessionStatusBarPath = path.resolve(currentDir, './ai-code-session/SessionStatusBar.tsx');
const sessionMessagePanePath = path.resolve(currentDir, './ai-code-session/messages/SessionMessagePane.tsx');
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
  const editWidgetSource = await readSource(editWidgetPath);

  assert.match(pathUtilsSource, /filePath\.match\(\/\\\/\\\.ropcode\\\/\[\^\/\]\+\\\/\(\.\+\)\$\/\)/);
  assert.match(pathUtilsSource, /return worktreeMatch\[1\];/);
  assert.match(editWidgetSource, /const collapsedFilePath = shortenPath\(getEditResultFilePath\(content\)\);/);
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
  const source = await readSource(sessionControllerPath);
  const messageStreamViewSource = await readSource(messageStreamViewPath);

  assert.match(source, /const \[expandedSubagentIds, setExpandedSubagentIds\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(messageStreamViewSource, /<SubagentProgressPanel[\s\S]*expandedAgents=\{expandedSubagentIds\}[\s\S]*onExpandedAgentsChange=\{setExpandedSubagentIds\}/);
});

test('virtualized stream rows use message identity instead of row index for keys', async () => {
  const aiCodeSessionSource = await readSource(sessionControllerPath);
  const messageStreamViewSource = await readSource(messageStreamViewPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const claudeMessageListSource = await readSource(claudeMessageListPath);

  assert.match(aiCodeSessionSource, /const streamingViewportIncrease = \{ top: 100, bottom: 250 \};/);
  assert.match(aiCodeSessionSource, /const idleViewportIncrease = \{ top: 300, bottom: 600 \};/);
  assert.match(messageStreamViewSource, /increaseViewportBy=\{isLoading \? streamingViewportIncrease : idleViewportIncrease\}/);
  assert.doesNotMatch(messageStreamViewSource, /increaseViewportBy=\{\{ top: 900, bottom: 1400 \}\}/);
  assert.doesNotMatch(messageStreamViewSource, /overscan=\{\{ main: 600, reverse: 600 \}\}/);
  assert.match(messageStreamViewSource, /const computeItemKey = useCallback\([\s\S]*item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`/);
  assert.match(messageStreamViewSource, /computeItemKey=\{computeItemKey\}/);
  assert.doesNotMatch(messageStreamViewSource, /`msg-\$\{item\.originalIndex\}-\$\{index\}`/);
  assert.match(agentExecutionSource, /const messageIndexByObject = React\.useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(agentExecutionSource, /return `\$\{prefix\}\$\{item\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(item\) \?\? 0\}`\}`;/);
  assert.doesNotMatch(agentExecutionSource, /`msg-\$\{index\}-\$\{item\.type\}`/);
  assert.doesNotMatch(agentExecutionSource, /`fullscreen-msg-\$\{index\}-\$\{item\.type\}`/);
  assert.match(claudeMessageListSource, /const messageIndexByObject = useMemo\(\(\) => \{[\s\S]*new WeakMap<ClaudeStreamMessage, number>\(\)/);
  assert.match(claudeMessageListSource, /computeItemKey=\{\(_, message\) => message\.uuid \|\| `msg-\$\{messageIndexByObject\.get\(message\) \?\? 0\}`\}/);
  assert.doesNotMatch(claudeMessageListSource, /`msg-\$\{index\}-\$\{message\.type\}`/);
});

test('streaming scroll controls avoid composite-heavy animation effects', async () => {
  const sessionMessagePaneSource = await readSource(sessionMessagePanePath);
  const sessionStatusBarSource = await readSource(sessionStatusBarPath);
  const webSearchWidgetSource = await readSource(webSearchWidgetPath);
  const webFetchWidgetSource = await readSource(path.resolve(toolWidgetsDir, './WebFetchWidget.tsx'));

  assert.match(sessionMessagePaneSource, /<div className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4">/);
  assert.match(sessionMessagePaneSource, /bg-background\/95 border rounded-full shadow-sm overflow-hidden pointer-events-auto/);
  assert.match(sessionMessagePaneSource, /active:scale-\[0\.97\]/);
  assert.doesNotMatch(sessionMessagePaneSource, /backdrop-blur-md border rounded-full shadow-lg/);
  assert.doesNotMatch(sessionMessagePaneSource, /transition=\{\{ delay: 0\.5 \}\}/);
  assert.doesNotMatch(sessionMessagePaneSource, /whileTap=\{\{ scale: 0\.97 \}\}/);

  assert.match(sessionStatusBarSource, /transition-colors contain-paint/);
  assert.doesNotMatch(sessionStatusBarSource, /backdrop-blur-md/);
  assert.doesNotMatch(webSearchWidgetSource + webFetchWidgetSource, /animate-pulse|animate-bounce/);
});

test('virtualized stream rows use lightweight placeholders during fast scroll', async () => {
  const aiCodeSessionSource = await readSource(sessionControllerPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const claudeMessageListSource = await readSource(claudeMessageListPath);
  const messageScrollSeekPlaceholderSource = await readSource(messageScrollSeekPlaceholderPath);

  for (const source of [agentExecutionSource, claudeMessageListSource]) {
    assert.match(source, /useScrollSeekConfig/);
    assert.match(source, /function ScrollSeekPlaceholder\(props: \{ height: number \}\) \{/);
    assert.match(source, /<MessageScrollSeekPlaceholder \{\.\.\.props\}/);
    assert.match(source, /scrollSeekConfiguration=\{scrollSeekConfiguration\}/);
    assert.match(source, /ScrollSeekPlaceholder/);
  }

  // ai-code-session intentionally does NOT use scrollSeek: the AI message list
  // is the most complex Virtuoso instance in the app and the placeholder
  // mechanism repeatedly produced stuck-skeleton bugs (09ed0ff, 5533d6c,
  // d48436b, 60956a2, 75ca156, 603a7c1, 69581d6, 195e161). Row memoisation
  // plus increaseViewportBy already give us enough headroom; placeholders
  // bring more bugs than performance.
  assert.doesNotMatch(aiCodeSessionSource, /useScrollSeekConfig/);
  assert.doesNotMatch(aiCodeSessionSource, /scrollSeekConfiguration/);

  assert.match(messageScrollSeekPlaceholderSource, /export function MessageScrollSeekPlaceholder\(\{ height, className \}: MessageScrollSeekPlaceholderProps\) \{/);
  assert.match(messageScrollSeekPlaceholderSource, /const rowCount = height > 180 \? 3 : height > 96 \? 2 : 1;/);
  assert.doesNotMatch(messageScrollSeekPlaceholderSource, /getBoundingClientRect|ResizeObserver|requestAnimationFrame|animate-pulse|animate-/);
});

test('markdown code blocks keep readable plain text in dark themes', async () => {
  const streamMessageRenderingSource = await readSource(streamMessageRenderingPath);

  assert.match(streamMessageRenderingSource, /<SyntaxHighlighter[\s\S]*codeTagProps=\{\{ className: "!text-foreground" \}\}/);
});

test('live streaming assistant text avoids markdown and syntax highlighting', async () => {
  const messageStreamViewSource = await readSource(messageStreamViewPath);
  const streamMessageSource = await readSource(streamMessagePath);
  const streamMessageContextSource = await readSource(streamMessageContextPath);
  const assistantMessageSource = await readSource(path.resolve(currentDir, './stream-message/AssistantMessageCard.tsx'));

  assert.match(streamMessageContextSource, /isStreamingText\?: boolean;/);
  assert.match(assistantMessageSource, /if \(isStreamingText\) \{[\s\S]*className="text-sm whitespace-pre-wrap break-words leading-6"[\s\S]*\{textContent\}[\s\S]*\}/);
  assert.match(streamMessageContextSource, /if \(prev\.isStreamingText !== next\.isStreamingText\) return false;/);
  assert.match(messageStreamViewSource, /isStreamingTail:[\s\S]*isLoading[\s\S]*originalIndex === messages\.length - 1[\s\S]*message\?\.type === 'assistant'[\s\S]*!message\.message\?\.usage/);
  assert.match(messageStreamViewSource, /isStreamingText=\{true\}/);
  assert.match(messageStreamViewSource, /isStreamingText=\{false\}/);
});

test('AiCodeSession keeps message card expansion state outside virtualized rows', async () => {
  const aiCodeSessionSource = await readSource(sessionControllerPath);
  const messageStreamViewSource = await readSource(messageStreamViewPath);
  const streamMessageSource = await readSource(streamMessagePath);
  const streamMessageContextSource = await readSource(streamMessageContextPath);
  const userMessageSource = await readSource(path.resolve(currentDir, './stream-message/UserMessageCard.tsx'));

  assert.match(aiCodeSessionSource, /const \[expandedMessageCards, setExpandedMessageCards\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(messageStreamViewSource, /expandedCards=\{expandedMessageCards\}/);
  assert.match(messageStreamViewSource, /onExpandedCardsChange=\{setExpandedMessageCards\}/);
  assert.match(messageStreamViewSource, /messageKey=\{item\.message\.uuid \|\| `msg-\$\{item\.originalIndex\}`\}/);
  assert.match(streamMessageContextSource, /expandedCards\?: Set<string>;/);
  assert.match(streamMessageContextSource, /onExpandedCardsChange\?: React\.Dispatch<React\.SetStateAction<Set<string>>>;/);
  assert.match(streamMessageSource, /const currentExpandedCards = expandedCards \?\? uncontrolledExpandedCards;/);
  assert.match(userMessageSource, /expansionKey: isContextSync \? `projectchat-context-sync-\$\{\(message as any\)\.session_id \|\| 'unknown'\}` : `user-text-\$\{idx\}`/);
});

test('session event handling batches hot stream work', async () => {
  const source = await readSource(useSessionFrameEventsPath);

  assert.match(source, /enqueueRuntimeMessage\(projectPath, message\);/);
  assert.match(source, /flushRuntimeMessages\(projectPath\);/);
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
  const useSessionMessagesSource = await readSource(useSessionMessagesPath);
  const messageFilterSource = await readSource(messageFilterPath);

  assert.match(useSessionMessagesSource, /import \{ createDisplayableMessagesAccumulator, type DisplayableMessagesAccumulator \} from "\.\.\/utils\/messageFilter";/);
  assert.match(useSessionMessagesSource, /const displayableAccumulatorRef = useRef<DisplayableMessagesAccumulator \| null>\(null\);/);
  assert.match(useSessionMessagesSource, /const displayable = useMemo\([\s\S]*displayableAccumulatorRef\.current!\.apply\(messages, stableSubagentIndexes\)/);
  assert.doesNotMatch(useSessionMessagesSource, /filterDisplayableMessages/);
  assert.match(messageFilterSource, /function buildToolUseNamesById\(messages: ClaudeStreamMessage\[\]\): Map<string, string>/);
  assert.match(messageFilterSource, /const toolUseNamesById = buildToolUseNamesById\(messages\);/);
  assert.match(messageFilterSource, /function wouldStreamMessageRender\([\s\S]*toolUseNamesById: Map<string, string>[\s\S]*\): boolean/);
  assert.match(messageFilterSource, /if \(!wouldStreamMessageRender\(message, toolUseNamesById\)\) \{[\s\S]*return false;/);
  assert.match(messageFilterSource, /if \(!nestedContent\) \{[\s\S]*return false;[\s\S]*\}/);
  assert.doesNotMatch(messageFilterSource, /for \(let i = messageIndex - 1; i >= 0; i--\)/);
});

test('virtualized message rows use consistent compact spacing', async () => {
  const messageStreamViewSource = await readSource(messageStreamViewPath);

  assert.match(messageStreamViewSource, /<div className="w-full max-w-6xl mx-auto px-4 py-2">/);
  assert.match(messageStreamViewSource, /const message = messages\[originalIndex\];[\s\S]*if \(!message\) return;[\s\S]*built\.push\(\{/);
  assert.doesNotMatch(messageStreamViewSource, /px-4 pb-4 pt-2/);
});

test('render hotspots avoid repeated pure work', async () => {
  const systemInitializedWidgetSource = await readSource(systemInitializedWidgetPath);
  const mcpWidgetSource = await readSource(mcpWidgetPath);
  const attachmentMenuSource = await readSource(attachmentMenuPath);
  const aiCodeSessionSource = await readSource(sessionControllerPath);
  const copyConversationMenuSource = await readSource(path.resolve(currentDir, './ai-code-session/composer/CopyConversationMenu.tsx'));
  const floatingPromptInputSource = await readSource(floatingPromptInputPath);
  const projectListSource = await readSource(projectListPath);

  assert.match(systemInitializedWidgetSource, /const systemToolIcons: Record<string, LucideIcon> = \{/);
  assert.match(systemInitializedWidgetSource, /function formatMcpToolName\(toolName: string\)/);
  assert.match(systemInitializedWidgetSource, /const \{ regularTools, mcpTools \} = useMemo\(\(\) => \{/);
  assert.match(systemInitializedWidgetSource, /if \(!expanded \|\| !mcpExpanded\) return \{\} as Record<string, string\[\]>;/);
  assert.match(systemInitializedWidgetSource, /const Icon = getSystemToolIcon\(tool\);/);
  assert.doesNotMatch(mcpWidgetSource, /const toolIcons: Record<string, LucideIcon> = \{[\s\S]*export const SystemInitializedWidget/);

  assert.match(attachmentMenuSource, /const detectMobile = \(\): boolean => \{/);
  assert.match(attachmentMenuSource, /useEffect\(\(\) => \{[\s\S]*if \(!isOpen\) return;[\s\S]*setMobile\(detectMobile\(\)\);/);
  assert.match(attachmentMenuSource, /if \(!isOpen\) return null;/);
  assert.doesNotMatch(attachmentMenuSource, /const mobile = isMobile\(\);/);

  assert.match(aiCodeSessionSource, /const followOutput = useCallback\(\(isAtBottom: boolean\) => \{[\s\S]*\}, \[isScrollPaused, processState\.isLoading\]\);/);
  assert.doesNotMatch(aiCodeSessionSource, /const itemContent = useCallback\(\(_: number, item:/);
  assert.doesNotMatch(aiCodeSessionSource, /const virtuosoComponents = React\.useMemo\(\(\) => \(\{/);
  assert.match(copyConversationMenuSource, /export function CopyConversationMenu/);
  assert.match(copyConversationMenuSource, /return useMemo\(\(\) => \{/);
  assert.match(aiCodeSessionSource, /const handlePromptConfigChange = useCallback\(\(config: SessionStatusPromptConfig\) => \{/);
  assert.match(aiCodeSessionSource, /composerProps=\{\{[\s\S]*onConfigChange: handlePromptConfigChange,[\s\S]*extraMenuItems: \([\s\S]*<CopyConversationMenu[\s\S]*\),[\s\S]*\}\}/);
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

test('SessionController delegates lifecycle, runtime status, and element selection to hooks', async () => {
  const aiCodeSessionSource = await readSource(sessionControllerPath);
  const hooksIndexSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/index.ts'));
  const lifecycleHookSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionControllerLifecycle.ts'));
  const runtimeHookSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionRuntimeStatusModel.ts'));
  const elementSelectionHookSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useElementSelectionPrompt.ts'));
  const promptActionsHookSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionPromptActions.ts'));

  assert.match(aiCodeSessionSource, /useSessionControllerLifecycle\(/);
  assert.match(aiCodeSessionSource, /useSessionRuntimeStatusModel\(/);
  assert.match(aiCodeSessionSource, /useElementSelectionPrompt\(/);
  assert.match(aiCodeSessionSource, /useSessionPromptActions\(/);
  assert.doesNotMatch(aiCodeSessionSource, /window\.addEventListener\('webview-element-selected'/);
  assert.doesNotMatch(aiCodeSessionSource, /const sessions = SessionPersistenceService\.getSessionIndex\(\);/);
  assert.doesNotMatch(aiCodeSessionSource, /const interval = setInterval\(\(\) => \{/);
  assert.doesNotMatch(aiCodeSessionSource, /const handleSendPrompt = async/);
  assert.doesNotMatch(aiCodeSessionSource, /const handleLocalClearFallback = async/);
  assert.doesNotMatch(aiCodeSessionSource, /const handleCancelExecution = async/);

  assert.match(hooksIndexSource, /export \{ useSessionControllerLifecycle, useGeneratedSessionTitlePersistence \} from '\.\/useSessionControllerLifecycle';/);
  assert.match(hooksIndexSource, /export \{ useSessionRuntimeStatusModel \} from '\.\/useSessionRuntimeStatusModel';/);
  assert.match(hooksIndexSource, /export \{ useElementSelectionPrompt \} from '\.\/useElementSelectionPrompt';/);
  assert.match(hooksIndexSource, /export \{ useSessionPromptActions \} from '\.\/useSessionPromptActions';/);
  assert.match(lifecycleHookSource, /SessionPersistenceService\.getSessionIndex\(\)/);
  assert.match(runtimeHookSource, /setInterval\(\(\) => \{/);
  assert.match(elementSelectionHookSource, /window\.addEventListener\('webview-element-selected'/);
  assert.doesNotMatch(promptActionsHookSource, /CreateProjectChat/);
  assert.match(promptActionsHookSource, /SendProjectChatMessage/);
  assert.match(promptActionsHookSource, /InterruptProjectChat/);
  assert.doesNotMatch(promptActionsHookSource, /api\.startProviderSession/);
  assert.match(promptActionsHookSource, /api\.stopProviderSessionsByProject/);
  assert.match(promptActionsHookSource, /api\.interruptProviderSession/);
  assert.match(promptActionsHookSource, /classifyPromptSubmit/);
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
  const editWidgetSource = await readSource(editWidgetPath);

  assert.match(editWidgetSource, /import React, \{ useMemo, useState \} from "react";/);
  assert.doesNotMatch(editWidgetSource, /import \{ motion, AnimatePresence \} from "framer-motion";/);
  assert.match(editWidgetSource, /const diffResult = useMemo\(\(\) => \{[\s\S]*if \(!expanded\) return \[\];[\s\S]*Diff\.diffLines\(old_string \|\| '', new_string \|\| '',/);
});

test('collapsed read and edit results do not parse or highlight file content', async () => {
  const readWidgetSource = await readSource(readWidgetPath);
  const editWidgetSource = await readSource(editWidgetPath);

  assert.match(readWidgetSource, /const \[isExpanded, setIsExpanded\] = useControlledExpansion\(expansionProps\);/);
  assert.match(readWidgetSource, /\{isExpanded && \(\(\) => \{[\s\S]*const \{ codeContent, startLineNumber \} = parseContent\(content\);[\s\S]*<SyntaxHighlighter/);
  assert.doesNotMatch(readWidgetSource, /Click "Expand" to view the file/);
  assert.match(editWidgetSource, /function getEditResultFilePath\(content: string\): string \{[\s\S]*content\.match\(\/The file \(\.\+\) has been updated\/\)/);
  assert.match(editWidgetSource, /function parseEditResultContent\(content: string\) \{[\s\S]*const lines = content\.split\('\\n'\);/);
  assert.match(editWidgetSource, /\{isExpanded \? \(\(\) => \{[\s\S]*const \{ filePath, codeContent, startLineNumber \} = parseEditResultContent\(content\);[\s\S]*<SyntaxHighlighter/);
  assert.match(editWidgetSource, /Click "Expand" to view the edit result/);
  assert.doesNotMatch(readWidgetSource + editWidgetSource, /shouldUsePlainCode|PLAIN_CODE|shouldRenderPlainCodeBlock/);
});

test('grep results stay readable inside narrow message cards', async () => {
  const grepWidgetSource = await readSource(path.resolve(toolWidgetsDir, './GrepWidget.tsx'));

  assert.match(grepWidgetSource, /<div className="space-y-2 min-w-0">/);
  assert.match(grepWidgetSource, /rounded-lg border bg-muted\/20 p-3 space-y-2 min-w-0/);
  assert.match(grepWidgetSource, /flex-1 min-w-0 font-mono text-sm[\s\S]*whitespace-pre-wrap break-words/);
  assert.match(grepWidgetSource, /rounded-lg border bg-background overflow-hidden min-w-0/);
  assert.match(grepWidgetSource, /max-h-\[400px\] overflow-auto/);
  assert.match(grepWidgetSource, /flex min-w-max items-start gap-3/);
  assert.match(grepWidgetSource, /block whitespace-pre text-\[11px\] leading-4 font-mono/);
  assert.match(grepWidgetSource, /const noLineMatch = line\.match/);
  assert.match(grepWidgetSource, /lineNumber: 0/);
  assert.match(grepWidgetSource, /<pre className="max-h-\[400px\] overflow-auto whitespace-pre p-3 text-\[11px\] leading-4 font-mono text-muted-foreground">/);
  assert.doesNotMatch(grepWidgetSource, /max-h-\[400px\] overflow-y-auto whitespace-pre-wrap break-words p-3 text-xs font-mono text-muted-foreground/);
});

test('copy conversation menu uses a single popover button trigger', async () => {
  const copyConversationMenuSource = await readSource(path.resolve(currentDir, './ai-code-session/composer/CopyConversationMenu.tsx'));

  assert.match(copyConversationMenuSource, /title="Copy conversation"/);
  assert.match(copyConversationMenuSource, /aria-label="Copy conversation"/);
  assert.doesNotMatch(copyConversationMenuSource, /TooltipSimple/);
});

test('collapsed MCP parameters do not stringify or highlight large JSON', async () => {
  const mcpWidgetSource = await readSource(mcpWidgetPath);

  assert.match(mcpWidgetSource, /const inputTokenSource = hasInput \? JSON\.stringify\(input\) : '';/);
  assert.match(mcpWidgetSource, /const shouldRenderFullInput = !isLargeInput \|\| isParametersExpanded;/);
  assert.match(mcpWidgetSource, /const inputString = shouldRenderFullInput \? JSON\.stringify\(input, null, 2\) : '';/);
  assert.match(mcpWidgetSource, /\{shouldRenderFullInput \? \([\s\S]*<SyntaxHighlighter[\s\S]*\) : \([\s\S]*Click "Show full parameters" to view JSON parameters/);
});

test('tool card expansion state is controlled by StreamMessage stable card keys', async () => {
  const widgetSources = await Promise.all([
    webSearchWidgetPath,
    path.resolve(toolWidgetsDir, './WebFetchWidget.tsx'),
    readWidgetPath,
    editWidgetPath,
    path.resolve(toolWidgetsDir, './GrepWidget.tsx'),
    mcpWidgetPath,
    path.resolve(toolWidgetsDir, './TaskWidget.tsx'),
    path.resolve(toolWidgetsDir, './ThinkingWidget.tsx'),
    path.resolve(toolWidgetsDir, './SystemInstructionWidget.tsx'),
  ].map(readSource));
  const toolWidgetsSource = widgetSources.join('\n');
  const streamMessageSource = await readSource(streamMessagePath);
  const streamMessageRenderingSource = await readSource(streamMessageRenderingPath);
  const toolUseRendererSource = await readSource(path.resolve(currentDir, './stream-message/ToolUseRenderer.tsx'));
  const assistantMessageSource = await readSource(path.resolve(currentDir, './stream-message/AssistantMessageCard.tsx'));
  const toolResultRendererSource = await readSource(path.resolve(currentDir, './stream-message/ToolResultRenderer.tsx'));

  assert.match(toolWidgetsSource, /export interface ControlledExpansionProps \{[\s\S]*expanded\?: boolean;[\s\S]*onExpandedChange\?: \(expanded: boolean\) => void;/);
  assert.match(toolWidgetsSource, /function useControlledExpansion\(\{ defaultExpanded = false, expanded: controlledExpanded, onExpandedChange \}: ControlledExpansionProps = \{\}\)/);
  for (const widget of ['WebSearchWidget', 'WebFetchWidget', 'ReadResultWidget', 'EditResultWidget', 'GrepWidget', 'MCPWidget', 'TaskWidget', 'ThinkingWidget', 'SystemInstructionWidget']) {
    assert.match(toolWidgetsSource, new RegExp(`export const ${widget}: React\\.FC<[\\s\\S]*ControlledExpansionProps`));
  }

  assert.match(streamMessageSource, /const \[uncontrolledExpandedCards, setUncontrolledExpandedCards\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(streamMessageSource, /const currentExpandedCards = expandedCards \?\? uncontrolledExpandedCards;/);
  assert.match(streamMessageSource, /const updateExpandedCards = onExpandedCardsChange \?\? setUncontrolledExpandedCards;/);
  assert.match(toolUseRendererSource, /const toolCardKey = `tool-\$\{toolName \|\| 'unknown'\}-\$\{toolId \|\| index\}`;/);
  assert.match(toolUseRendererSource, /<WebSearchWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(toolUseRendererSource, /<WebFetchWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(toolUseRendererSource, /<MCPWidget[\s\S]*\{\.\.\.getCardExpansionProps\(toolCardKey, false\)\}/);
  assert.match(toolUseRendererSource, /<TaskWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`\$\{toolCardKey\}-task-instructions`, false\)\}/);
  assert.match(assistantMessageSource, /<ThinkingWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`thinking-\$\{idx\}`, false\)\}/);
  assert.match(toolResultRendererSource, /<EditResultWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| index\}-edit`, false\)\}/);
  assert.match(toolResultRendererSource, /<ReadResultWidget[\s\S]*\{\.\.\.getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| index\}-read`, false\)\}/);
  assert.match(streamMessageSource, /const summaryExpansion = getCardExpansionProps\('conversation-summary', false\);/);
  assert.match(toolResultRendererSource, /const toolResultExpansion = getCardExpansionProps\(`tool-result-\$\{content\.tool_use_id \|\| index\}`, false\);/);
  assert.match(streamMessageSource, /const resultExpansion = getCardExpansionProps\('result-details', false\);/);
  assert.match(streamMessageRenderingSource, /<SystemInstructionWidget[\s\S]*\{\.\.\.getExpansionProps\?\.\(`\$\{keyPrefix\}system-instruction-\$\{instructionIndex\}`, false\)\}/);
  assert.doesNotMatch(streamMessageSource, /expandedToolResults|setExpandedToolResults|setIsSummaryExpanded|const \[expanded, setExpanded\] = useState\(false\)/);
});

test('SubagentProgressPanel memoizes transcript filtering while rendering all messages', async () => {
  const source = await readSource(subagentProgressPanelPath);

  assert.match(source, /const SubagentTranscript = React\.memo\(function SubagentTranscript/);
  assert.match(source, /const transcriptMessages = React\.useMemo\([\s\S]*subagent\.messages\.filter\(\(message\) => !isDuplicatePromptMessage\(message, subagent\.prompt\)\)/);
  assert.match(source, /return \[\.\.\.fallbackMessages, \.\.\.transcriptMessages\];/);
  assert.match(source, /const streamContext = React\.useMemo\(\(\) => buildStreamMessageContext\(visibleMessages as any\), \[visibleMessages\]\);/);
  assert.doesNotMatch(source, /MAX_RENDERED_SUBAGENT_MESSAGES|slice\(-MAX_RENDERED_SUBAGENT_MESSAGES\)|Showing latest/);
});
