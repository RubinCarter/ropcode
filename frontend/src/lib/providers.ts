/**
 * Provider 配置和 API
 *
 * 导出 provider 相关的常量、类型和 API 方法
 */

import { ListProviderSessions, LoadProviderSessionHistory } from './rpc-client';

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

// 通用 providers 列表
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

// Provider API 对象（用于向后兼容）
export const providers = {
  /**
   * 列出项目的 provider 会话
   */
  listSessions: async (projectPath: string, providerName: string) => {
    return ListProviderSessions(projectPath, providerName);
  },

  /**
   * 加载 provider 会话历史
   */
  loadHistory: async (projectPath: string, sessionId: string, providerName: string): Promise<ProviderHistoryMessage[]> => {
    return LoadProviderSessionHistory(projectPath, sessionId, providerName) as Promise<ProviderHistoryMessage[]>;
  },
};

// 兼容旧代码的导出
export { providerConfigs as providersList };
