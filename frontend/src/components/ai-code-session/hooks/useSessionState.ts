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
  // Prefer using initialProjectPath (if it exists and is non-empty)
  if (initialProjectPath && initialProjectPath.trim() !== "") {
    return initialProjectPath;
  }
  // Then use session.project_path
  if (session?.project_path && session.project_path.trim() !== "") {
    return session.project_path;
  }
  // Finally use session.project_id (may be useful in some cases)
  if (session?.project_id) {
    return session.project_id;
  }
  // If none available, return empty string (triggers error in AiCodeSession)
  return "";
}

/**
 * Hook to manage session state
 * Fix: respond to projectPath changes, support project switching
 */
export function useSessionState(options: UseSessionStateOptions): UseSessionStateReturn {
  const { session, initialProjectPath } = options;

  // Fix: use useState and respond to prop changes
  const [projectPath, setProjectPath] = useState(() => computeProjectPath(session, initialProjectPath));

  // When initialProjectPath or session changes, update projectPath
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
