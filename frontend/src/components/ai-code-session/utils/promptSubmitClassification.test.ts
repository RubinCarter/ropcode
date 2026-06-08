import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const classifierPath = path.resolve(currentDir, './promptSubmitClassification.ts');
const sessionControllerPath = path.resolve(currentDir, '../SessionController.tsx');
const sessionPromptActionsPath = path.resolve(currentDir, '../hooks/useSessionPromptActions.ts');
const workspaceContainerPath = path.resolve(currentDir, '../../containers/WorkspaceContainer.tsx');
const tabContextPath = path.resolve(currentDir, '../../../contexts/TabContext.tsx');
const workspaceTabContextPath = path.resolve(currentDir, '../../../contexts/WorkspaceTabContext.tsx');
const projectChatSegmentStorePath = path.resolve(currentDir, '../../../stores/projectChatSegmentStore.ts');
const tooltipModernPath = path.resolve(currentDir, '../../ui/tooltip-modern.tsx');
const messageStreamViewPath = path.resolve(currentDir, '../MessageStreamView.tsx');
const wsRpcClientPath = path.resolve(currentDir, '../../../lib/ws-rpc-client.ts');

async function readClassifierSource() {
  return readFile(classifierPath, 'utf8');
}

async function readAiCodeSessionSource() {
  return readFile(sessionControllerPath, 'utf8');
}

async function readSessionPromptActionsSource() {
  return readFile(sessionPromptActionsPath, 'utf8');
}

async function readWorkspaceContainerSource() {
  return readFile(workspaceContainerPath, 'utf8');
}

async function readTabContextSource() {
  return readFile(tabContextPath, 'utf8');
}

async function readWorkspaceTabContextSource() {
  return readFile(workspaceTabContextPath, 'utf8');
}

async function readProjectChatSegmentStoreSource() {
  return readFile(projectChatSegmentStorePath, 'utf8');
}

async function readTooltipModernSource() {
  return readFile(tooltipModernPath, 'utf8');
}

async function readMessageStreamViewSource() {
  return readFile(messageStreamViewPath, 'utf8');
}

async function readWsRpcClientSource() {
  return readFile(wsRpcClientPath, 'utf8');
}

test('classifyPromptSubmit returns explicit submit actions', async () => {
  const source = await readClassifierSource();

  assert.match(source, /export type PromptSubmitClassification =/);
  assert.match(source, /\| \{ action: 'ignore'; reason: 'empty' \}/);
  assert.match(source, /\| \{ action: 'backend-clear' \}/);
  assert.match(source, /\| \{ action: 'reject'; reason: 'missing-project' \}/);
  assert.match(source, /\| \{ action: 'send' \}/);
  assert.doesNotMatch(source, /\| \{ action: 'enqueue' \}/);
});

test('classifyPromptSubmit prioritizes empty missing project clear and send branches', async () => {
  const source = await readClassifierSource();

  assert.match(source, /if \(!trimmedPrompt\) \{[\s\S]*return \{ action: 'ignore', reason: 'empty' \};[\s\S]*\}/);
  assert.match(source, /if \(!input\.hasProjectPath\) \{[\s\S]*return \{ action: 'reject', reason: 'missing-project' \};[\s\S]*\}/);
  assert.match(source, /if \(isExactClearCommand\(trimmedPrompt\)\) \{[\s\S]*return \{ action: 'backend-clear' \};[\s\S]*\}/);
  assert.doesNotMatch(source, /input\.isLoading/);
  assert.doesNotMatch(source, /hasInteractiveSession/);
  assert.doesNotMatch(source, /action: 'enqueue'/);
  assert.match(source, /return \{ action: 'send' \};/);
});

test('session prompt actions route prompt submission through the classifier', async () => {
  const source = await readSessionPromptActionsSource();

  assert.match(source, /import \{ classifyPromptSubmit \} from "\.\.\/utils\/promptSubmitClassification";/);
  assert.match(source, /const activeProvider = provider \|\| defaultProvider;/);
  assert.match(source, /const classification = classifyPromptSubmit\(\{[\s\S]*prompt,[\s\S]*hasProjectPath: Boolean\(sessionState\.projectPath\),[\s\S]*\}\);/);
  assert.match(source, /if \(classification\.action === 'backend-clear'\) \{[\s\S]*await handleBackendClear\(\);[\s\S]*return true;[\s\S]*\}/);
  assert.doesNotMatch(source, /classification\.action === 'enqueue'/);
  assert.doesNotMatch(source, /queueState\.addToQueue/);
  assert.doesNotMatch(source, /isLoading: processState\.isLoading/);
  assert.doesNotMatch(source, /hasInteractiveSession:/);
});

test('session prompt actions require pre-created project chats', async () => {
  const source = await readSessionPromptActionsSource();

  assert.match(source, /provider\?: string,/);
  assert.doesNotMatch(source, /CreateProjectChat/);
  assert.match(source, /if \(!projectChatId\) \{[\s\S]*ProjectChat is not available for this session/);
  assert.doesNotMatch(source, /api\.startProviderSession/);
  assert.doesNotMatch(source, /api\.resumeProviderSession/);
});

test('session prompt actions send follow-ups through project chat', async () => {
  const source = await readSessionPromptActionsSource();

  assert.match(source, /SendProjectChatMessage\(projectChatId, wrappedPrompt, model, providerApiId \|\| undefined, thinkingMode\)/);
  assert.doesNotMatch(source, /api\.sendProviderSessionMessage/);
});

test('clear command is executed by backend and applied from project chat events', async () => {
  const source = await readSessionPromptActionsSource();
  const sessionSource = await readAiCodeSessionSource();

  assert.match(source, /await ClearProjectChat\(projectChatId\);/);
  assert.doesNotMatch(source, /onProjectChatCleared/);
  assert.doesNotMatch(source, /clearSessionFrames\(projectChatId\);/);
  assert.doesNotMatch(source, /clearSessionRuntime\(projectChatId\);/);
  assert.match(sessionSource, /EventsOn\('projectchat:cleared'/);
  assert.match(sessionSource, /clearSessionFrames\(projectChatId\);[\s\S]*clearSessionRuntime\(projectChatId\);/);
});

test('ProjectChat clear event applies frontend reset without hiding the message pane', async () => {
  const sessionSource = await readAiCodeSessionSource();

  assert.doesNotMatch(sessionSource, /projectchat-cleared-event-listener-disabled/);
  assert.match(sessionSource, /writeRendererDiagnostic\('projectchat-clear-reset-applied'/);
  assert.match(sessionSource, /queueMicrotask\(\(\) => \{[\s\S]*clearSessionFrames\(projectChatId\);[\s\S]*clearSessionRuntime\(projectChatId\);[\s\S]*messagesState\.clearMessages\(\);[\s\S]*setClearResetEpoch\(\(epoch\) => epoch \+ 1\);/);
  assert.match(sessionSource, /const messagesList = \([\s\S]*<SessionMessagePane[\s\S]*key=\{clearResetEpoch\}/);
  assert.doesNotMatch(sessionSource, /sessionState\.setClaudeSessionId\(null\);/);
  assert.doesNotMatch(sessionSource, /sessionState\.setExtractedSessionInfo\(null\);/);
  assert.doesNotMatch(sessionSource, /sessionState\.setIsFirstPrompt\(true\);/);
  assert.doesNotMatch(sessionSource, /metricsState\.resetMetrics\(\);/);
  assert.doesNotMatch(sessionSource, /isClearResetting/);
  assert.doesNotMatch(sessionSource, /setSuppressTransientTooltips/);
  assert.doesNotMatch(sessionSource, /requestAnimationFrame\(\(\) => applyReset/);
  assert.doesNotMatch(sessionSource, /clearResetTimeoutRef/);
});

test('ProjectChat segments are kept outside tab and workspace state', async () => {
  const sessionSource = await readAiCodeSessionSource();
  const workspaceSource = await readWorkspaceContainerSource();
  const tabContextSource = await readTabContextSource();
  const workspaceTabContextSource = await readWorkspaceTabContextSource();
  const storeSource = await readProjectChatSegmentStoreSource();

  assert.match(sessionSource, /projectChatSegments,/);
  assert.match(sessionSource, /onProjectChatSegmentRuntimeSession/);
  assert.match(sessionSource, /activeProjectChatSegment/);
  assert.match(storeSource, /projectChatSegmentsByChatId/);
  assert.match(storeSource, /export function setProjectChatSegments/);
  assert.match(storeSource, /export function updateProjectChatSegmentRuntimeSession/);
  assert.doesNotMatch(tabContextSource, /projectChatSegments\?:/);
  assert.doesNotMatch(workspaceTabContextSource, /projectChatSegments\?:/);
  assert.doesNotMatch(workspaceSource, /projectChatSegments: \[/);
  assert.doesNotMatch(workspaceSource, /projectChatSegments: \[\.\.\./);
  assert.doesNotMatch(workspaceSource, /projectChatSegments=\{tab\.projectChatSegments\}/);
  assert.doesNotMatch(workspaceSource, /onProjectChatCleared=/);
});

test('ProjectChat message stream is keyed only by projectChatId', async () => {
  const source = await readAiCodeSessionSource();

  assert.match(source, /const activeStreamId = projectChatId[\s\S]*\? projectChatId[\s\S]*: streamIdForRuntimeSession/);
  assert.match(source, /if \(!projectChatId\) return;/);
  assert.match(source, /mergeSessionFrames\(chatId, allFrames\);/);
  assert.match(source, /projectChatHistoryBackfillIntervalMs/);
  assert.match(source, /window\.setInterval\(backfill, projectChatHistoryBackfillIntervalMs\)/);
  assert.match(source, /\}, \[mergeProjectChatHistory, processState\.isLoading, projectChatId\]\);/);
  assert.doesNotMatch(source, /activeRuntimeSessionId: projectChatId/);
});

test('FloatingPromptInput only clears drafts when the session consumes the prompt', async () => {
  const source = await readFile(path.resolve(currentDir, '../../FloatingPromptInput.tsx'), 'utf8');

  assert.match(source, /onSend: \(prompt: string, model: string, providerApiId\?: string \| null, thinkingMode\?: ThinkingMode, provider\?: string\) => void \| boolean \| Promise<void \| boolean>;/);
  assert.match(source, /setPrompt\(""\);[\s\S]*const consumed = await onSend\(finalPrompt, selectedModel, selectedProviderApiId, selectedThinkingMode, selectedProvider\);[\s\S]*if \(consumed === false\) \{[\s\S]*setPrompt\(\(currentPrompt: string\) => currentPrompt \? currentPrompt : promptToSend\);[\s\S]*\}/);
  assert.match(source, /isClearCommand: isExactClearCommand\(promptToSend\),[\s\S]*shouldForwardClear: shouldForwardClearToProvider\(promptToSend, selectedProvider\)/);
  assert.doesNotMatch(source, /shouldUseLocalClearFallback/);
});

test('Radix tooltip primitives are disabled inside Wails WebView', async () => {
  const source = await readTooltipModernSource();

  assert.match(source, /function isWailsRuntime\(\): boolean/);
  assert.match(source, /window\.location\.protocol === "wails:"/);
  assert.match(source, /const TooltipProvider[\s\S]*if \(isWailsRuntime\(\)\) \{[\s\S]*return <>\{children\}<\/>/);
  assert.match(source, /const Tooltip[\s\S]*if \(isWailsRuntime\(\)\) \{[\s\S]*return <>\{children\}<\/>/);
  assert.match(source, /const TooltipTrigger[\s\S]*if \(isWailsRuntime\(\)\) \{[\s\S]*React\.cloneElement/);
  assert.match(source, /const TooltipContent[\s\S]*if \(isWailsRuntime\(\)\) \{[\s\S]*return null/);
});

test('MessageStreamView reports item count changes from an effect, not during render', async () => {
  const source = await readMessageStreamViewSource();
  const sessionSource = await readAiCodeSessionSource();

  assert.match(source, /useEffect\(\(\) => \{[\s\S]*onStreamItemsCountChange\(items\.length\);[\s\S]*\}, \[items\.length, onStreamItemsCountChange\]\);/);
  assert.doesNotMatch(source, /queueMicrotask\(\(\) => onStreamItemsCountChange\(items\.length\)\)/);
  assert.match(sessionSource, /const atBottomRef = useRef\(true\);[\s\S]*const handleAtBottomChange = useCallback\(\(isAtBottom: boolean\) => \{[\s\S]*if \(atBottomRef\.current === isAtBottom\) return;[\s\S]*setAtBottom\(isAtBottom\);/);
  assert.match(sessionSource, /setAtBottom=\{handleAtBottomChange\}/);
});

test('RPC response errors include method context in renderer diagnostics', async () => {
  const source = await readWsRpcClientSource();

  assert.match(source, /method: string;[\s\S]*params: any\[\];/);
  assert.match(source, /writeRendererLog\?\.\('error', 'rpc-response-error'/);
  assert.match(source, /pending\.reject\(new Error\(`\$\{pending\.method\}: \$\{error\}`\)\);/);
});
