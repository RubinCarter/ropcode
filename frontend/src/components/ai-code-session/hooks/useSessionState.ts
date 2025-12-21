/**
 * Session state management hook
 *
 * Manages session-related state including:
 * - Session ID and project info
 * - First prompt tracking
 * - Session restoration from localStorage
 */

import { useState, useMemo, useRef } from "react";
import type { Session, SessionInfo } from "../types";

export interface UseSessionStateOptions {
  session?: Session;
  initialProjectPath?: string;
}

export interface UseSessionStateReturn {
  // State
  projectPath: string;
  claudeSessionId: string | null;
  extractedSessionInfo: SessionInfo | null;
  isFirstPrompt: boolean;
  effectiveSession: Session | null;

  // Setters
  setClaudeSessionId: (id: string | null) => void;
  setExtractedSessionInfo: (info: SessionInfo | null) => void;
  setIsFirstPrompt: (value: boolean) => void;

  // Refs for stable access
  projectPathRef: React.MutableRefObject<string>;
  extractedSessionInfoRef: React.MutableRefObject<SessionInfo | null>;
}

/**
 * Hook to manage session state
 * 🔧 修复：正确处理 projectPath 的初始化，避免空字符串导致的问题
 */
export function useSessionState(options: UseSessionStateOptions): UseSessionStateReturn {
  const { session, initialProjectPath } = options;

  // 🔧 修复：更智能的 projectPath 初始化逻辑
  const [projectPath] = useState(() => {
    // 优先使用 initialProjectPath（如果它存在且不为空）
    if (initialProjectPath && initialProjectPath.trim() !== "") {
      return initialProjectPath;
    }
    // 其次使用 session.project_path
    if (session?.project_path && session.project_path.trim() !== "") {
      return session.project_path;
    }
    // 最后使用 session.project_id（某些情况下可能有用）
    if (session?.project_id) {
      return session.project_id;
    }
    // 如果都没有，返回空字符串（这会在 AiCodeSession 中触发错误提示）
    return "";
  });

  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [extractedSessionInfo, setExtractedSessionInfo] = useState<SessionInfo | null>(null);
  const [isFirstPrompt, setIsFirstPrompt] = useState(!session);

  // Refs for stable access in callbacks
  const projectPathRef = useRef(projectPath);
  const extractedSessionInfoRef = useRef(extractedSessionInfo);

  // Keep refs in sync
  projectPathRef.current = projectPath;
  extractedSessionInfoRef.current = extractedSessionInfo;

  // Compute effective session (prioritize extracted over prop)
  const effectiveSession = useMemo((): Session | null => {
    if (extractedSessionInfo) {
      return {
        id: extractedSessionInfo.sessionId,
        project_id: extractedSessionInfo.projectId,
        project_path: projectPath,
        created_at: Date.now(),
      } as Session;
    }
    if (session) return session;
    return null;
  }, [session, extractedSessionInfo, projectPath]);

  return {
    projectPath,
    claudeSessionId,
    extractedSessionInfo,
    isFirstPrompt,
    effectiveSession,
    setClaudeSessionId,
    setExtractedSessionInfo,
    setIsFirstPrompt,
    projectPathRef,
    extractedSessionInfoRef,
  };
}
