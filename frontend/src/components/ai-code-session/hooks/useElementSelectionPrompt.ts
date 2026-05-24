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

      const formattedMessage = `## 网页元素选择

**页面 URL**: ${element.url}
**元素类型**: ${element.tagName}
${element.selector ? `**CSS 选择器**: \`${element.selector}\`` : ''}

${element.innerText ? `**元素文本**:\n${element.innerText.substring(0, 300)}${element.innerText.length > 300 ? '...' : ''}\n` : ''}
**HTML 结构**:
\`\`\`html
${element.outerHTML}
\`\`\`

${message ? `**说明**:\n${message}` : ''}`;

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
