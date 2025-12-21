import React, { useState, useEffect, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { getClaudeSyntaxTheme } from '@/lib/claudeSyntaxTheme';
import { useTheme } from '@/hooks';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { FileText } from 'lucide-react';

interface FileViewerProps {
  filePath: string;
  workspacePath: string;
  className?: string;
}

// 配置常量
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB - 超过此大小将显示警告

/**
 * 文本文件扩展名白名单
 */
const TEXT_FILE_EXTENSIONS = new Set([
  // 文档和标记语言
  '.md', '.txt', '.rst', '.asciidoc', '.adoc', '.textile', '.rdoc', '.org',
  // Web 前端
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.svg', '.vue', '.jsx', '.tsx',
  // JavaScript/TypeScript 生态
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json', '.json5', '.jsonc',
  // 编程语言
  '.py', '.pyw', '.pyx', '.pyi', '.rb', '.rake', '.gemspec',
  '.java', '.kt', '.kts', '.groovy', '.scala',
  '.go', '.rs',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh',
  '.cs', '.fs', '.vb',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.swift', '.m', '.mm',
  '.dart', '.r',
  '.pl', '.pm', '.t', '.pod',
  '.lua', '.vim',
  '.el', '.clj', '.cljs', '.cljc',
  '.erl', '.hrl', '.ex', '.exs',
  '.hs', '.lhs',
  '.ml', '.mli',
  '.jl',
  // Shell 和脚本
  '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.ps1', '.psm1', '.bat', '.cmd',
  // 配置文件
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.config', '.properties',
  '.env', '.env.example', '.env.local', '.env.development', '.env.production',
  '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.yarnrc',
  '.eslintrc', '.prettierrc', '.babelrc', '.dockerignore',
  // 数据文件
  '.sql', '.csv', '.tsv', '.log', '.graphql', '.gql',
  // 其他文本文件
  '.diff', '.patch', '.tex', '.bib', '.gradle', '.cmake', '.makefile',
]);

/**
 * 二进制文件扩展名黑名单
 */
const BINARY_FILE_EXTENSIONS = new Set([
  // 图片
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif', '.psd', '.ai', '.raw', '.heic', '.heif',
  // 视频
  '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp',
  // 音频
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus',
  // 压缩包
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.lz', '.zst',
  // 可执行文件
  '.exe', '.dll', '.so', '.dylib', '.bin', '.app', '.deb', '.rpm', '.msi', '.dmg',
  // 字体
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // 办公文档（二进制格式）
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf',
  // 数据库
  '.db', '.sqlite', '.sqlite3', '.mdb',
  // 编译产物
  '.o', '.obj', '.class', '.pyc', '.pyo', '.wasm',
  // 其他二进制
  '.iso', '.img', '.jar', '.war', '.ear',
]);

/**
 * 无扩展名的常见文本文件
 */
const COMMON_TEXT_FILES = new Set([
  'makefile', 'dockerfile', 'rakefile', 'gemfile', 'vagrantfile',
  'readme', 'license', 'changelog', 'authors', 'contributors',
  'codeowners', 'version', 'manifest',
]);

/**
 * 语言映射 - 将文件扩展名映射到 Prism 支持的语言标识符
 */
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  // Web
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'svg',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  // Config/Data
  '.json': 'json',
  '.json5': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  // Markup
  '.md': 'markdown',
  '.markdown': 'markdown',
  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  // Programming languages
  '.py': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'kotlin',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.r': 'r',
  '.lua': 'lua',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  // Others
  '.diff': 'diff',
  '.patch': 'diff',
  '.dockerfile': 'docker',
};

/**
 * 文件类型检测结果
 */
enum FileType {
  TEXT = 'text',
  BINARY = 'binary',
  UNKNOWN = 'unknown',
}

/**
 * 基于文件扩展名判断文件类型
 */
const getFileTypeByExtension = (filePath: string): FileType => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  // 没有扩展名的文件
  if (!extension || extension === filePath.toLowerCase()) {
    const filename = filePath.substring(filePath.lastIndexOf('/') + 1).toLowerCase();
    if (COMMON_TEXT_FILES.has(filename)) {
      return FileType.TEXT;
    }
    return FileType.UNKNOWN;
  }

  // 检查文本文件白名单
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return FileType.TEXT;
  }

  // 检查二进制文件黑名单
  if (BINARY_FILE_EXTENSIONS.has(extension)) {
    return FileType.BINARY;
  }

  return FileType.UNKNOWN;
};

/**
 * 检测内容是否为二进制
 */
const isBinaryContent = (content: string): boolean => {
  if (!content) return false;

  // 包含空字符是二进制文件的强特征
  if (content.includes('\0')) return true;

  // 检查前 8KB 内容
  const sample = content.substring(0, 8192);
  let suspiciousCharCount = 0;
  const totalChars = sample.length;

  for (let i = 0; i < totalChars; i++) {
    const code = sample.charCodeAt(i);
    // 统计可疑的控制字符（排除常见的文本控制字符）
    if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) || code === 0x7F) {
      suspiciousCharCount++;
    }
  }

  // 如果可疑字符超过 1%，判定为二进制
  return (suspiciousCharCount / totalChars) > 0.01;
};

/**
 * 获取语言标识符
 */
const getLanguage = (filePath: string): string => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  // 检查映射表
  if (LANGUAGE_MAP[extension]) {
    return LANGUAGE_MAP[extension];
  }

  // 检查无扩展名的特殊文件
  const filename = filePath.substring(filePath.lastIndexOf('/') + 1).toLowerCase();
  if (filename === 'dockerfile') return 'docker';
  if (filename === 'makefile') return 'makefile';

  // 默认返回文本
  return 'text';
};

/**
 * FileViewer 组件 - 只读文件预览 + 语法高亮
 */
export const FileViewer: React.FC<FileViewerProps> = ({
  filePath,
  workspacePath,
  className,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [isBinary, setIsBinary] = useState(false);
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLargeFile, setIsLargeFile] = useState(false);

  const { theme: themeMode } = useTheme();

  // 获取文件内容
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      setIsBinary(false);
      setIsLargeFile(false);

      try {
        // 1. 检查文件大小
        const sizeResult = await api.executeCommand(
          `wc -c < "${filePath}" 2>/dev/null || stat -f%z "${filePath}" 2>/dev/null || stat -c%s "${filePath}" 2>/dev/null || echo 0`,
          workspacePath
        );

        const size = parseInt(sizeResult.output?.trim() || '0', 10);
        setFileSize(size);

        if (size > MAX_FILE_SIZE) {
          setIsLargeFile(true);
          setLoading(false);
          return;
        }

        // 2. 基于文件扩展名检测
        const fileType = getFileTypeByExtension(filePath);

        if (fileType === FileType.BINARY) {
          console.log(`[FileViewer] File identified as BINARY by extension: ${filePath}`);
          setIsBinary(true);
          setLoading(false);
          return;
        }

        // 对于未知类型，使用系统 file 命令
        if (fileType === FileType.UNKNOWN) {
          const binaryCheck = await api.executeCommand(
            `file --mime "${filePath}"`,
            workspacePath
          );

          const isBinaryFile = binaryCheck.success &&
            binaryCheck.output?.includes('charset=binary');

          if (isBinaryFile) {
            console.log(`[FileViewer] System detected as binary`);
            setIsBinary(true);
            setLoading(false);
            return;
          }
        }

        // 3. 获取文件内容
        const result = await api.executeCommand(
          `cat "${filePath}"`,
          workspacePath
        );

        if (!result.success) {
          setError('Failed to read file');
          setLoading(false);
          return;
        }

        const fileContent = result.output || '';

        // 4. 内容检测兜底（仅对未知类型文件）
        if (fileType === FileType.UNKNOWN && isBinaryContent(fileContent)) {
          console.log(`[FileViewer] Content detected as binary`);
          setIsBinary(true);
          setLoading(false);
          return;
        }

        setContent(fileContent);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch file content:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchContent();
  }, [filePath, workspacePath]);

  // 获取文件名和语言
  const fileName = useMemo(() => {
    return filePath.split('/').pop() || filePath;
  }, [filePath]);

  const language = useMemo(() => {
    return getLanguage(filePath);
  }, [filePath]);

  const syntaxTheme = useMemo(() => {
    return getClaudeSyntaxTheme(themeMode);
  }, [themeMode]);

  // 渲染二进制文件提示
  const renderBinaryNotice = () => {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center p-8">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <div className="text-sm font-medium mb-2">Binary File</div>
          <div className="text-xs opacity-70">
            This is a binary file and cannot be displayed as text
          </div>
        </div>
      </div>
    );
  };

  // 渲染大文件警告
  const renderLargeFileWarning = () => {
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center p-8 max-w-md">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-yellow-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div className="text-sm font-medium mb-2">File Too Large</div>
          <div className="text-xs opacity-70 mb-4">
            This file is {fileSizeMB} MB, which exceeds the {(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB limit.
            <br />
            Large files are not displayed to prevent performance issues.
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* 头部 */}
      <div className="px-4 py-2 bg-muted/30 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span className="text-sm font-medium font-mono">{fileName}</span>
            {isBinary && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                Binary
              </span>
            )}
            {language && !isBinary && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded">
                {language}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Read-only
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm">Loading file...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-red-500">
            <div className="font-medium mb-1">Error</div>
            <div className="text-xs">{error}</div>
          </div>
        </div>
      ) : isLargeFile ? (
        renderLargeFileWarning()
      ) : isBinary ? (
        renderBinaryNotice()
      ) : !content ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-sm">Empty file</div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <SyntaxHighlighter
            language={language}
            style={syntaxTheme}
            showLineNumbers={true}
            wrapLines={true}
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            }}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              color: 'var(--muted-foreground)',
              userSelect: 'none',
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
};

export default FileViewer;
