/**
 * MIME type utility functions
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
 * Determine if a file is a text file
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
 * Determine if a MIME type is a streaming type
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
 * Preview type
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
 * Detect preview type based on MIME type
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
 * Get file icon name based on MIME type
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
 * MIME type to language identifier mapping
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
 * Based on MIME typeGet language identifier
 */
export function getLanguageFromMime(mimeType: string): string {
  if (!mimeType) return 'text';

  // Direct match
  if (mimeToLanguage[mimeType]) {
    return mimeToLanguage[mimeType];
  }

  // Infer from MIME type prefix
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
