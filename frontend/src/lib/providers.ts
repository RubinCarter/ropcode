/**
 * TypeScript API client for AI Provider abstraction layer
 *
 * This module provides a type-safe interface to interact with multiple AI providers
 * (Claude, Codex, Gemini, etc.) through a unified API.
 */

import type { Project, Session } from "./api";
import { useState, useEffect, useCallback } from "react";
import * as App from "../../wailsjs/go/main/App";

/**
 * Stub implementation for provider API calls
 * TODO: Implement these methods in the Go backend
 */
async function invoke<T>(method: string, params?: any): Promise<T> {
  console.warn(`[STUB] Provider method '${method}' not yet implemented in Wails backend`, params);

  // Return safe defaults based on method name
  if (method === "provider_list") {
    return [] as any;
  }
  if (method === "provider_get_default") {
    return "claude" as any;
  }
  if (method === "provider_get_info") {
    return {
      id: params?.providerId || "unknown",
      name: "Unknown Provider",
      models: [],
      installations: [],
      available: false,
    } as any;
  }
  if (method === "provider_list_projects") {
    return [] as any;
  }
  if (method === "provider_list_sessions") {
    return [] as any;
  }
  if (method === "provider_get_settings") {
    return {} as any;
  }
  if (method === "provider_validate_config") {
    return false as any;
  }
  if (method === "provider_get_version") {
    return null as any;
  }

  // For session-related methods, return empty responses
  if (method.includes("session") || method.includes("history")) {
    return null as any;
  }

  return null as any;
}

/**
 * Information about a model
 */
export interface ModelInfo {
  /** Model ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether this model is available */
  available: boolean;
}

/**
 * Information about a provider installation
 */
export interface Installation {
  /** Installation path */
  path: string;
  /** Version string if available */
  version?: string;
  /** Installation type */
  installation_type: string;
}

/**
 * Information about an available AI provider
 */
export interface ProviderInfo {
  /** Provider ID (e.g., "claude", "codex", "gemini") */
  id: string;
  /** Human-readable name */
  name: string;
  /** List of supported models */
  models: ModelInfo[];
  /** Available installations */
  installations: Installation[];
  /** Whether this provider is currently available */
  available: boolean;
}

/**
 * Provider API client
 */
export const providers = {
  /**
   * Lists all registered AI providers
   */
  async list(): Promise<ProviderInfo[]> {
    return invoke<ProviderInfo[]>("provider_list");
  },

  /**
   * Gets information about a specific provider
   */
  async getInfo(providerId: string): Promise<ProviderInfo> {
    return invoke<ProviderInfo>("provider_get_info", { providerId });
  },

  /**
   * Lists projects using the specified provider
   * @param providerId - Provider ID (defaults to "claude")
   */
  async listProjects(providerId?: string): Promise<Project[]> {
    return invoke<Project[]>("provider_list_projects", { providerId });
  },

  /**
   * Lists sessions for a project using the specified provider
   * @param projectPath - Project path
   * @param providerId - Provider ID (defaults to "claude")
   */
  async listSessions(
    projectPath: string,
    providerId?: string
  ): Promise<Session[]> {
    // Use actual Wails backend method instead of stub
    const provider = providerId || "claude";
    try {
      const sessions = await App.ListProviderSessions(projectPath, provider);
      // Convert backend ProviderSession to frontend Session format
      return sessions.map((s: any) => ({
        id: s.id,
        project_id: s.project_id,
        project_path: s.project_path,
        created_at: s.created_at,
        message_timestamp: s.message_timestamp,
      }));
    } catch (err) {
      console.warn(`[providers.listSessions] Failed to list sessions for ${provider}:`, err);
      return [];
    }
  },

  /**
   * Gets the default provider ID
   */
  async getDefault(): Promise<string> {
    return invoke<string>("provider_get_default");
  },

  /**
   * Gets settings for a specific provider
   */
  async getSettings(providerId: string): Promise<Record<string, unknown>> {
    return invoke<Record<string, unknown>>("provider_get_settings", {
      providerId,
    });
  },

  /**
   * Updates settings for a specific provider
   */
  async updateSettings(
    providerId: string,
    settings: Record<string, unknown>
  ): Promise<void> {
    return invoke<void>("provider_update_settings", { providerId, settings });
  },

  /**
   * Validates a provider's configuration
   */
  async validateConfig(providerId: string): Promise<boolean> {
    return invoke<boolean>("provider_validate_config", { providerId });
  },

  /**
   * Gets the version of a provider's binary/API
   */
  async getVersion(providerId: string): Promise<string | null> {
    return invoke<string | null>("provider_get_version", { providerId });
  },

  /**
   * Starts a new session with the specified provider
   * @param request - Session configuration including project path, prompt, and model
   * @param providerId - Provider ID (defaults to "claude")
   */
  async startSession(
    request: {
      project_path: string;
      prompt: string;
      model: string;
    },
    providerId?: string
  ): Promise<{ session_id: string; project_path: string; model: string }> {
    return invoke("provider_start_session", { providerId, request });
  },

  /**
   * Resumes an existing session
   * @param sessionId - Session ID to resume
   * @param projectPath - Project path
   * @param providerId - Provider ID (defaults to "claude")
   */
  async resumeSession(
    sessionId: string,
    projectPath: string,
    providerId?: string
  ): Promise<{ session_id: string; project_path: string; model: string }> {
    return invoke("provider_resume_session", {
      providerId,
      sessionId,
      projectPath,
    });
  },

  /**
   * Loads session history using the provider
   * @param sessionId - Session ID
   * @param projectId - Project ID
   * @param providerId - Provider ID (defaults to "claude")
   */
  async loadHistory(
    sessionId: string,
    projectId: string,
    providerId?: string
  ): Promise<any[]> {
    // Use provider-specific history loading
    const provider = providerId || "claude";
    try {
      console.log(`[providers] Loading history for provider=${provider}, session=${sessionId}`);
      const messages = await App.LoadProviderSessionHistory(sessionId, projectId, provider);
      return messages as any[];
    } catch (error) {
      console.error("[providers] Failed to load history:", error);
      return [];
    }
  },

  /**
   * Terminates an active session
   * @param sessionId - Session ID to terminate
   * @param providerId - Provider ID (defaults to "claude")
   */
  async terminateSession(
    sessionId: string,
    providerId?: string
  ): Promise<void> {
    return invoke<void>("provider_terminate_session", {
      providerId,
      sessionId,
    });
  },
};

/**
 * Hook for using provider info in React components
 */
export function useProviders() {
  const [providersList, setProvidersList] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    providers
      .list()
      .then(setProvidersList)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { providers: providersList, loading, error };
}

/**
 * Hook for using provider projects
 */
export function useProviderProjects(providerId?: string) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    providers
      .listProjects(providerId)
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId]);

  const refresh = useCallback(() => {
    setLoading(true);
    providers
      .listProjects(providerId)
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId]);

  return { projects, loading, error, refresh };
}

/**
 * Hook for using provider sessions
 */
export function useProviderSessions(projectId: string, providerId?: string) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    providers
      .listSessions(projectId, providerId)
      .then(setSessions)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, providerId]);

  const refresh = useCallback(() => {
    if (!projectId) return;

    setLoading(true);
    providers
      .listSessions(projectId, providerId)
      .then(setSessions)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, providerId]);

  return { sessions, loading, error, refresh };
}

// Export for use in other modules
export default providers;
