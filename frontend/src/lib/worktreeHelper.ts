/**
 * Worktree helper utilities
 * Detects and handles Git worktree related features.
 */

import { api, type main } from "./api";

// Re-export WorktreeInfo type for consumers
export type WorktreeInfo = main.WorktreeInfo;

/**
 * Detect if current project is a Git worktree child branch
 * @param projectPath Project path
 * @returns Worktree info
 */
export async function detectWorktree(projectPath: string): Promise<WorktreeInfo> {
  try {
    // Call Go backend to get worktree info
    const info = await api.detectWorktree(projectPath);
    return info;
  } catch (error) {
    console.error("Failed to detect worktree:", error);
    // Return default value indicating not a worktree
    return {
      current_path: projectPath,
      root_path: projectPath,
      main_branch: "main",
      is_worktree: false,
    };
  }
}

/**
 * Wrap user first message, add Worktree instructions
 * @param worktreeInfo Worktree info
 * @param userMessage User first message
 * @returns Formatted wrapped message
 */
export function wrapFirstMessageWithWorktreeInstructions(
  worktreeInfo: WorktreeInfo,
  userMessage: string
): string {
  return `<system_instruction>
You are working inside Ropcode, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the ${worktreeInfo.current_path}, which has been set up for you to work in.

Project file changes must stay inside the workspace directory unless the user explicitly asks you to modify files elsewhere and the tool policy allows it. You may read files outside ${worktreeInfo.current_path} when needed for context. Do NOT write files outside ${worktreeInfo.current_path} or at ${worktreeInfo.root_path} unless the user explicitly allows that specific write.

Exception: you may read pasted/dragged images stored under ~/.ropcode/temp-images/ (read-only).

The user has indicated their remote target for this repository is branch ${worktreeInfo.main_branch}. Use this for actions like creating new PRs, bisecting, etc., unless explicitly told to use another branch by the user.

If the user asks you to work on several unrelated tasks in parallel, you can suggest they start new workspaces.
</system_instruction>

${userMessage}

<system-instruction>
When the user gives you a task, before you edit any files, rename this branch to give it a descriptive name.
Make sure your name is uses concrete, specific language, avoids abstract nouns, and is concise (<30 characters).
Do not repeat the prefix (ropcode/ or username/) in the branch name.
**Any instructions the user has given you about how to rename branches should supersede these instructions.**
</system-instruction>`;
}

/**
 * Check if first message needs wrapping
 * @param projectPath Project path
 * @param userMessage User message
 * @param isFirstPrompt Whether this is the first message
 * @returns Returns wrapped message if wrapping is needed, otherwise returns original message
 */
export async function maybeWrapFirstMessage(
  projectPath: string,
  userMessage: string,
  isFirstPrompt: boolean
): Promise<string> {
  // Only check on first message
  if (!isFirstPrompt) {
    return userMessage;
  }

  const worktreeInfo = await detectWorktree(projectPath);

  if (worktreeInfo.is_worktree) {
    return wrapFirstMessageWithWorktreeInstructions(worktreeInfo, userMessage);
  }

  return userMessage;
}
