import React, { useState, useEffect, useMemo, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { FileText } from 'lucide-react';
import { isTextFile } from '@/widgets/preview/mime-utils';

// 使用本地 monaco-editor 而非 CDN，避免 404 错误
loader.config({ monaco });

interface FileViewerProps {
  filePath: string;
  workspacePath: string;
  className?: string;
}

// 配置常量
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 语言映射 - 将文件扩展名映射到 Monaco 支持的语言标识符
 */
const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.json5': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
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
  '.diff': 'diff',
  '.patch': 'diff',
  '.dockerfile': 'dockerfile',
};

/**
 * 获取语言标识符
 */
const getLanguage = (filePath: string): string => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  if (LANGUAGE_MAP[extension]) {
    return LANGUAGE_MAP[extension];
  }

  // 检查无扩展名的特殊文件
  const filename = filePath.substring(filePath.lastIndexOf('/') + 1).toLowerCase();
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile') return 'makefile';

  return 'plaintext';
};

/**
 * FileViewer 组件 - 使用 Monaco Editor 只读预览
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
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

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

        // 2. 使用系统 file 命令获取 MIME 类型
        const mimeCheck = await api.executeCommand(
          `file --mime-type -b "${filePath}"`,
          workspacePath
        );

        if (mimeCheck.success && mimeCheck.output) {
          const detectedMimeType = mimeCheck.output.trim();

          // 使用 mime-utils 判断是否为文本文件
          if (!isTextFile(detectedMimeType)) {
            console.log(`[FileViewer] MIME type ${detectedMimeType} detected as non-text`);
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

        setContent(result.output || '');
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

  // Monaco Editor mount handler
  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
  };

  // 渲染二进制文件提示
  const renderBinaryNotice = () => {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground/40">
        <div className="text-center p-8">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
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
      <div className="flex-1 flex items-center justify-center text-foreground/40">
        <div className="text-center p-8 max-w-md">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-yellow-500/60"
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
    <div className={cn('flex flex-col h-full', className)}>
      {/* 头部 - waveterm 风格 */}
      <div className="px-3 py-1.5 border-b border-white/10 bg-black/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground/90">{fileName}</span>
            {language && language !== 'plaintext' && !isBinary && (
              <span className="px-1.5 py-0.5 text-[10px] bg-white/10 text-foreground/60 rounded font-mono">
                {language}
              </span>
            )}
            {isBinary && (
              <span className="px-1.5 py-0.5 text-[10px] bg-orange-500/20 text-orange-400 rounded">
                binary
              </span>
            )}
          </div>
          <div className="text-[11px] text-foreground/40">
            Read-only
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-foreground/40">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border border-foreground/30 border-t-foreground/70 rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-red-400">
            <div className="font-medium mb-1">Error</div>
            <div className="text-xs opacity-70">{error}</div>
          </div>
        </div>
      ) : isLargeFile ? (
        renderLargeFileWarning()
      ) : isBinary ? (
        renderBinaryNotice()
      ) : !content ? (
        <div className="flex-1 flex items-center justify-center text-foreground/40">
          <div className="text-sm">Empty file</div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              readOnly: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: '"Hack", "Fira Code", "JetBrains Mono", monospace',
              lineNumbers: 'on',
              renderLineHighlight: 'none',
              scrollbar: {
                useShadows: false,
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              contextmenu: false,
              smoothScrolling: true,
              cursorBlinking: 'solid',
              cursorStyle: 'line',
              wordWrap: 'off',
              folding: true,
              lineDecorationsWidth: 0,
              lineNumbersMinChars: 4,
              padding: { top: 8 },
            }}
          />
        </div>
      )}
    </div>
  );
};

export default FileViewer;
