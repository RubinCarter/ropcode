/**
 * Provider config and API
 *
 * Exports provider-related constants, types, and API methods.
 */

import { ListProviderSessions, LoadProviderSessionHistory, LoadProviderSessionHistoryFrames } from './rpc-client';
import type { SessionFrame } from './session-frame/types';

export type ProviderHistoryMessageType = 'system' | 'assistant' | 'user' | 'result' | 'info' | 'error';

export interface ProviderHistoryMessage {
  role?: string;
  content?: string;
  timestamp?: string;
  type?: ProviderHistoryMessageType;
  subtype?: string;
  session_id?: string;
  user_message?: unknown;
  message?: any;
  [key: string]: any;
}

export interface ProviderInfo {
  id: string;
  name: string;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  enabledModels?: string[];
}

// Common providers list
export const providerConfigs: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    providerId: 'anthropic',
    displayName: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    providerId: 'openai',
    displayName: 'OpenAI (GPT)',
    baseUrl: 'https://api.openai.com/v1',
  },
];

// Provider API object (backward compat)
export const providers = {
  /**
   * List provider sessions for a project
   */
  listSessions: async (projectPath: string, providerName: string) => {
    return ListProviderSessions(projectPath, providerName);
  },

  /**
   * Load provider session history
   */
  loadHistory: async (sessionId: string, projectId: string, providerName: string): Promise<ProviderHistoryMessage[]> => {
    return LoadProviderSessionHistory(projectId, sessionId, providerName) as Promise<ProviderHistoryMessage[]>;
  },

  loadHistoryFrames: async (sessionId: string, projectId: string, providerName: string): Promise<SessionFrame[]> => {
    return LoadProviderSessionHistoryFrames(projectId, sessionId, providerName);
  },
};

// Backward-compatible export
export { providerConfigs as providersList };
