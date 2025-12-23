/**
 * Provider 配置
 *
 * 导出 provider 相关的常量和类型
 */

export interface ProviderInfo {
  id: string;
  name: string;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  enabledModels?: string[];
}

// 通用 providers 列表
export const providers: ProviderInfo[] = [
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
