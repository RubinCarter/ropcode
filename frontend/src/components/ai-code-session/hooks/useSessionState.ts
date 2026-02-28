/**
 * Session state management hook
 *
 * Manages session-related state including:
 * - Session ID and project info
 * - First prompt tracking
 * - Session restoration from localStorage
 */

import { useState, useMemo, useRef, useEffect } from "react";
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
  claudeSessionIdRef: React.MutableRefObject<string | null>;
  extractedSessionInfoRef: React.MutableRefObject<SessionInfo | null>;
}

/**
 * Compute the best project path from available sources
 */
function computeProjectPath(session?: Session, initialProjectPath?: string): string {
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
}

/**
 * Hook to manage session state
 * 🔧 修复：响应 projectPath 变化，支持项目切换
 */
export function useSessionState(options: UseSessionStateOptions): UseSessionStateReturn {
  const { session, initialProjectPath } = options;

  // 🔧 修复：使用 useState 并响应 prop 变化
  const [projectPath, setProjectPath] = useState(() => computeProjectPath(session, initialProjectPath));

  // 当 initialProjectPath 或 session 变化时，更新 projectPath
  useEffect(() => {
    const newPath = computeProjectPath(session, initialProjectPath);
    if (newPath && newPath !== projectPath) {
      setProjectPath(newPath);
    }
  }, [initialProjectPath, session?.project_path, session?.project_id]);

  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [extractedSessionInfo, setExtractedSessionInfo] = useState<SessionInfo | null>(null);
  const [isFirstPrompt, setIsFirstPrompt] = useState(!session);

  // Refs for stable access in callbacks
  const projectPathRef = useRef(projectPath);
  const claudeSessionIdRef = useRef(claudeSessionId);
  const extractedSessionInfoRef = useRef(extractedSessionInfo);

  // Keep refs in sync
  projectPathRef.current = projectPath;
  claudeSessionIdRef.current = claudeSessionId;
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
    claudeSessionIdRef,
    extractedSessionInfoRef,
  };
}
