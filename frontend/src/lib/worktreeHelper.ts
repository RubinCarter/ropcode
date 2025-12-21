/**
 * Worktree 辅助工具
 * 用于检测和处理 Git worktree 相关功能
 */

import { api, type WorktreeInfo } from "./api";

/**
 * 检测当前项目是否为 Git worktree 子分支
 * @param projectPath 项目路径
 * @returns Worktree 信息
 */
export async function detectWorktree(projectPath: string): Promise<WorktreeInfo> {
  try {
    // 调用 Rust 后端获取 worktree 信息
    const info = await api.detectWorktree(projectPath);
    return info;
  } catch (error) {
    console.error("Failed to detect worktree:", error);
    // 返回默认值表示不是 worktree
    return {
      currentPath: projectPath,
      rootPath: projectPath,
      mainBranch: "main",
      isWorktreeChild: false,
    };
  }
}

/**
 * 包装用户第一条消息，添加 Worktree 指令
 * @param worktreeInfo Worktree 信息
 * @param userMessage 用户的第一条消息
 * @returns 格式化的包装消息
 */
export function wrapFirstMessageWithWorktreeInstructions(
  worktreeInfo: WorktreeInfo,
  userMessage: string
): string {
  return `<system_instruction>
You are working inside Ropcode, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the ${worktreeInfo.currentPath}, which has been set up for you to work in.

Do NOT read or write files outside the workspace directory. DO NOT EVER read or write files at ${worktreeInfo.rootPath}. EVERY absolute path you use should start with ${worktreeInfo.currentPath}.

Exception: you may read pasted/dragged images stored under ~/.ropcode/temp-images/ (read-only).

The user has indicated their remote target for this repository is branch ${worktreeInfo.mainBranch}. Use this for actions like creating new PRs, bisecting, etc., unless explicitly told to use another branch by the user.

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
 * 检查是否需要包装第一条消息
 * @param projectPath 项目路径
 * @param userMessage 用户消息
 * @param isFirstPrompt 是否为第一条消息
 * @returns 如果需要包装则返回包装后的消息，否则返回原消息
 */
export async function maybeWrapFirstMessage(
  projectPath: string,
  userMessage: string,
  isFirstPrompt: boolean
): Promise<string> {
  // 只在第一条消息时检查
  if (!isFirstPrompt) {
    return userMessage;
  }

  const worktreeInfo = await detectWorktree(projectPath);

  if (worktreeInfo.isWorktreeChild) {
    console.log('[Worktree] Wrapping first message with worktree instructions');
    return wrapFirstMessageWithWorktreeInstructions(worktreeInfo, userMessage);
  }

  return userMessage;
}
