/**
 * MIME 类型工具函数
 */

const textApplicationMimetypes = [
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/yaml',
  'application/sql',
  'application/x-sh',
  'application/x-python',
];

/**
 * 判断是否为文本文件
 */
export function isTextFile(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    textApplicationMimetypes.includes(mimeType) ||
    mimeType.includes('json') ||
    mimeType.includes('yaml') ||
    mimeType.includes('xml')
  );
}

/**
 * 判断是否为流媒体类型
 */
export function isStreamingType(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('application/pdf') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('image/')
  );
}

/**
 * 预览类型
 */
export type PreviewType =
  | 'code'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'csv'
  | 'directory'
  | 'unknown';

/**
 * 根据 MIME 类型检测预览类型
 */
export function detectPreviewType(mimeType: string): PreviewType {
  if (!mimeType) return 'unknown';
  if (mimeType === 'directory') return 'directory';
  if (mimeType.startsWith('text/markdown')) return 'markdown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/csv') return 'csv';
  if (isTextFile(mimeType)) return 'code';
  return 'unknown';
}

/**
 * 根据 MIME 类型获取文件图标名称
 */
export function iconForFile(mimeType: string): string {
  const type = detectPreviewType(mimeType);
  const iconMap: Record<PreviewType, string> = {
    directory: 'folder',
    markdown: 'file-lines',
    image: 'image',
    video: 'film',
    audio: 'headphones',
    pdf: 'file-pdf',
    csv: 'file-csv',
    code: 'file-code',
    unknown: 'file',
  };
  return iconMap[type];
}

/**
 * MIME 类型到语言标识符映射
 */
const mimeToLanguage: Record<string, string> = {
  'application/javascript': 'javascript',
  'application/typescript': 'typescript',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'application/sql': 'sql',
  'application/x-sh': 'bash',
  'application/x-python': 'python',
  'text/javascript': 'javascript',
  'text/typescript': 'typescript',
  'text/html': 'html',
  'text/css': 'css',
  'text/xml': 'xml',
  'text/x-python': 'python',
  'text/x-java': 'java',
  'text/x-c': 'c',
  'text/x-c++': 'cpp',
  'text/x-go': 'go',
  'text/x-rust': 'rust',
  'text/x-ruby': 'ruby',
  'text/x-php': 'php',
  'text/x-swift': 'swift',
  'text/x-kotlin': 'kotlin',
  'text/x-scala': 'scala',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
};

/**
 * 根据 MIME 类型获取语言标识符
 */
export function getLanguageFromMime(mimeType: string): string {
  if (!mimeType) return 'text';

  // 直接匹配
  if (mimeToLanguage[mimeType]) {
    return mimeToLanguage[mimeType];
  }

  // 基于 MIME 类型前缀推断
  if (mimeType.includes('javascript')) return 'javascript';
  if (mimeType.includes('typescript')) return 'typescript';
  if (mimeType.includes('json')) return 'json';
  if (mimeType.includes('yaml')) return 'yaml';
  if (mimeType.includes('xml')) return 'xml';
  if (mimeType.includes('html')) return 'html';
  if (mimeType.includes('css')) return 'css';
  if (mimeType.includes('python')) return 'python';
  if (mimeType.includes('markdown')) return 'markdown';

  return 'text';
}
