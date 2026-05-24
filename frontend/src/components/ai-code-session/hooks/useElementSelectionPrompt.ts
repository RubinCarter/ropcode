import { useEffect } from "react";
import type { RefObject } from "react";
import type { FloatingPromptInputRef } from "../../FloatingPromptInput";

interface UseElementSelectionPromptOptions {
  projectPath: string;
  inputRef: RefObject<FloatingPromptInputRef>;
  onSendPrompt: (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string
  ) => Promise<boolean>;
}

export function useElementSelectionPrompt({
  projectPath,
  inputRef,
  onSendPrompt,
}: UseElementSelectionPromptOptions): void {
  useEffect(() => {
    const handleElementSelected = (event: CustomEvent) => {
      const { element, message, workspaceId } = event.detail;

      if (workspaceId !== projectPath) {
        console.log('[AiCodeSession] Ignoring element selection for different workspace');
        return;
      }

      const formattedMessage = `## Web Element Selection

**Page URL**: ${element.url}
**Element Type**: ${element.tagName}
${element.selector ? `**CSS Selector**: \`${element.selector}\`` : ''}

${element.innerText ? `**Element Text**:\n${element.innerText.substring(0, 300)}${element.innerText.length > 300 ? '...' : ''}\n` : ''}
**HTML Structure**:
\`\`\`html
${element.outerHTML}
\`\`\`

${message ? `**Description**:\n${message}` : ''}`;

      if (!inputRef.current) {
        return;
      }

      inputRef.current.setText(formattedMessage);
      console.log('[AiCodeSession] Element selection set as prompt');

      setTimeout(() => {
        void (async () => {
          if (!inputRef.current) {
            return;
          }

          const config = inputRef.current.getCurrentConfig();
          const consumed = await onSendPrompt(
            formattedMessage,
            config.model,
            config.providerApiId,
            config.thinkingMode
          );
          console.log('[AiCodeSession] Auto-submitting element selection with config:', config);

          if (consumed) {
            inputRef.current.setText('');
          }
        })();
      }, 100);
    };

    window.addEventListener('webview-element-selected', handleElementSelected as EventListener);
    return () => {
      window.removeEventListener('webview-element-selected', handleElementSelected as EventListener);
    };
  }, [inputRef, onSendPrompt, projectPath]);
}
