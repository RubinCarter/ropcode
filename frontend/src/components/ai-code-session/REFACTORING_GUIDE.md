# AiCodeSession Refactoring Guide

## Current State

`AiCodeSession.tsx` is intentionally a thin public shell:

```tsx
export const AiCodeSession: React.FC<AiCodeSessionProps> = (props) => (
  <SessionController {...props} />
);
```

Do not add session side effects back to that file. Put new orchestration in `SessionController.tsx` only when it cannot fit an existing module, and prefer extracting stable responsibilities into focused hooks/components.

## Active Modules

- `SessionController.tsx`: top-level orchestration for restore, recovery, prompt send, cancel, history loading, copy actions, preview state, and wiring child modules together.
- `layout/SessionLayoutChrome.tsx`: provider API notice, preview split pane, bottom composer dock, Slash Commands dialog.
- `composer/SessionComposer.tsx`: composer surface and action props.
- `messages/SessionMessagePane.tsx`: message list presentation.
- `runtime/SessionStatusBar.tsx`: runtime/process status presentation.
- `hooks/useSessionMessages.ts`: message storage, filtering, raw output, token accounting.
- `hooks/useSessionFrameEvents.ts`: normalized session frame/event ingress.
- `hooks/useProcessState.ts`: provider process state and polling.
- `hooks/usePromptQueue.ts`: queued prompt processing.
- `hooks/useSessionMetrics.ts`: metrics tracking.
- `hooks/useSessionState.ts`: project/session identity state.

## Naming Rules

Use the current hook names:

```tsx
import {
  useSessionFrameEvents,
  useSessionMessages,
  useProcessState,
  usePromptQueue,
  useSessionMetrics,
  useSessionState,
} from "./hooks";
```

The older names `useMessages` and `useSessionEvents` are retired. Do not recreate those files unless there is a deliberate compatibility layer with tests.

## Next Safe Extraction Targets

When reducing `SessionController.tsx`, use small slices with tests after each slice:

- Copy/export menu logic: move JSONL/Markdown builders and clipboard handling into a focused hook or component.
- Session restore/history logic: move history loading, provider session lookup, and recovery helpers into a controller hook with explicit inputs.
- Preview/webview state: move preview sizing and selected-element handling into a preview hook if that behavior changes.
- Prompt submission actions: keep transport and history side effects out of `SessionComposer.tsx`; the composer should remain a presentation/action surface.

## Verification

For source-only refactors:

```powershell
cd frontend
npm test
npm run build:typecheck
```

For visible workflow changes:

```powershell
npm --prefix ui-automation run test
```
