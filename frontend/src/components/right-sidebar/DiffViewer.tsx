import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useDiffWorker } from '@/hooks/useDiffWorker';

export interface DiffLine {
  type: 'add' | 'delete' | 'modify' | 'context';
  lineNumber: number;
  content: string;
  oldContent?: string; // For modify and delete types
}

interface DiffViewerProps {
  filePath: string;
  workspacePath: string;
  className?: string;
}

// 配置常量
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB - 超过此大小将显示警告
const CHUNK_SIZE = 1000; // 分块处理的行数
const USE_CHUNKING_THRESHOLD = 2000; // 超过此行数使用分块加载

/**
 * 文本文件扩展名白名单 - 这些文件始终视为文本文件
 * 分类组织便于维护和理解
 */
const TEXT_FILE_EXTENSIONS = {
  // 文档和标记语言
  documentation: ['.md', '.txt', '.rst', '.asciidoc', '.adoc', '.textile', '.rdoc', '.org'],

  // Web 前端
  web: ['.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.svg', '.vue', '.jsx', '.tsx'],

  // JavaScript/TypeScript 生态
  javascript: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json', '.json5', '.jsonc'],

  // 编程语言
  programming: [
    '.py', '.pyw', '.pyx', '.pyi',  // Python
    '.rb', '.rake', '.gemspec',      // Ruby
    '.java', '.kt', '.kts', '.groovy', '.scala',  // JVM
    '.go', '.rs',                    // Go, Rust
    '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh',  // C/C++
    '.cs', '.fs', '.vb',             // .NET
    '.php', '.php3', '.php4', '.php5', '.phtml',  // PHP
    '.swift', '.m', '.mm',           // Swift, Objective-C
    '.dart', '.r',                   // Dart, R
    '.pl', '.pm', '.t', '.pod',      // Perl
    '.lua', '.vim',                  // Lua, VimScript
    '.el', '.clj', '.cljs', '.cljc', // Elisp, Clojure
    '.erl', '.hrl', '.ex', '.exs',   // Erlang, Elixir
    '.hs', '.lhs',                   // Haskell
    '.ml', '.mli',                   // OCaml
    '.jl',                           // Julia
  ],

  // Shell 和脚本
  shell: ['.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.ps1', '.psm1', '.bat', '.cmd'],

  // 配置文件
  config: [
    '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.config', '.properties',
    '.env', '.env.example', '.env.local', '.env.development', '.env.production',
    '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.yarnrc',
    '.eslintrc', '.prettierrc', '.babelrc', '.dockerignore',
  ],

  // 数据文件
  data: ['.sql', '.csv', '.tsv', '.log', '.xml', '.graphql', '.gql'],

  // 其他文本文件
  others: ['.diff', '.patch', '.tex', '.bib', '.gradle', '.cmake', '.makefile'],
};

/**
 * 二进制文件扩展名黑名单 - 这些文件始终视为二进制文件
 */
const BINARY_FILE_EXTENSIONS = {
  // 图片
  images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif', '.psd', '.ai', '.raw', '.heic', '.heif'],

  // 视频
  videos: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'],

  // 音频
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus'],

  // 压缩包
  archives: ['.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.lz', '.zst'],

  // 可执行文件
  executables: ['.exe', '.dll', '.so', '.dylib', '.bin', '.app', '.deb', '.rpm', '.msi', '.dmg'],

  // 字体
  fonts: ['.ttf', '.otf', '.woff', '.woff2', '.eot'],

  // 办公文档（二进制格式）
  office: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'],

  // 数据库
  databases: ['.db', '.sqlite', '.sqlite3', '.mdb'],

  // 编译产物
  compiled: ['.o', '.obj', '.class', '.pyc', '.pyo', '.wasm'],

  // 其他二进制
  others: ['.iso', '.img', '.jar', '.war', '.ear'],
};

/**
 * 获取扁平化的文本文件扩展名数组
 */
const getTextFileExtensions = (): string[] => {
  return Object.values(TEXT_FILE_EXTENSIONS).flat();
};

/**
 * 获取扁平化的二进制文件扩展名数组
 */
const getBinaryFileExtensions = (): string[] => {
  return Object.values(BINARY_FILE_EXTENSIONS).flat();
};

/**
 * 文件类型检测结果
 */
enum FileType {
  TEXT = 'text',           // 确定是文本文件
  BINARY = 'binary',       // 确定是二进制文件
  UNKNOWN = 'unknown',     // 未知类型，需要内容检测
}

/**
 * 基于文件扩展名判断文件类型
 * 使用穷举法，优先级：文本白名单 > 二进制黑名单 > 未知
 */
const getFileTypeByExtension = (filePath: string): FileType => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  // 没有扩展名的文件可能是文本文件（如 Makefile, Dockerfile）
  if (!extension || extension === filePath.toLowerCase()) {
    const filename = filePath.substring(filePath.lastIndexOf('/') + 1).toLowerCase();
    const commonTextFiles = [
      'makefile', 'dockerfile', 'rakefile', 'gemfile', 'vagrantfile',
      'readme', 'license', 'changelog', 'authors', 'contributors',
      'codeowners', 'version', 'manifest',
    ];

    if (commonTextFiles.includes(filename)) {
      return FileType.TEXT;
    }

    return FileType.UNKNOWN;
  }

  // 检查文本文件白名单
  if (getTextFileExtensions().includes(extension)) {
    return FileType.TEXT;
  }

  // 检查二进制文件黑名单
  if (getBinaryFileExtensions().includes(extension)) {
    return FileType.BINARY;
  }

  // 未知类型
  return FileType.UNKNOWN;
};

/**
 * 检测内容是否为二进制（兜底方案）
 * 仅在无法通过扩展名判断时使用
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
    // 0x09 = Tab, 0x0A = LF, 0x0D = CR
    if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) || code === 0x7F) {
      suspiciousCharCount++;
    }
  }

  // 如果可疑字符超过 1%，判定为二进制
  return (suspiciousCharCount / totalChars) > 0.01;
};

// Diff 计算已移至 Web Worker (diffWorker.ts)

/**
 * DiffViewer 组件 - 单栏显示代码差异
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  filePath,
  workspacePath,
  className,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oldContent, setOldContent] = useState<string>('');
  const [newContent, setNewContent] = useState<string>('');
  const [isBinary, setIsBinary] = useState(false);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(true);

  const contentRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // 使用 ref 缓存上次计算的内容，避免重复计算
  const lastComputedContentRef = useRef<{ old: string; new: string } | null>(null);

  // 使用 Web Worker 计算 diff
  const diffWorker = useDiffWorker();

  // 获取文件的两个版本
  useEffect(() => {
    const fetchContent = async () => {
      setIsLoadingContent(true);
      setError(null);
      setIsBinary(false);
      setIsLargeFile(false);

      // 清空缓存，因为是新文件
      lastComputedContentRef.current = null;

      try {
        // 1. 先检查文件大小
        const sizeResult = await api.executeCommand(
          `wc -c < "${filePath}" 2>/dev/null || stat -f%z "${filePath}" 2>/dev/null || stat -c%s "${filePath}" 2>/dev/null || echo 0`,
          workspacePath
        );

        const size = parseInt(sizeResult.output?.trim() || '0', 10);
        setFileSize(size);

        // 如果文件超过限制,标记为大文件
        if (size > MAX_FILE_SIZE) {
          setIsLargeFile(true);
          setIsLoadingContent(false);
          return;
        }

        // 2. 基于文件扩展名的三层检测策略
        const fileType = getFileTypeByExtension(filePath);

        // 第一层：文本文件白名单 - 直接视为文本文件
        if (fileType === FileType.TEXT) {
          console.log(`[DiffViewer] File identified as TEXT by extension: ${filePath}`);
          // 直接跳到获取内容步骤
        }
        // 第二层：二进制文件黑名单 - 直接视为二进制文件
        else if (fileType === FileType.BINARY) {
          console.log(`[DiffViewer] File identified as BINARY by extension: ${filePath}`);
          setIsBinary(true);
          setIsLoadingContent(false);
          return;
        }
        // 第三层：未知类型 - 使用系统 file 命令作为辅助判断
        else {
          console.log(`[DiffViewer] File type UNKNOWN, using system detection: ${filePath}`);
          const binaryCheck = await api.executeCommand(
            `file --mime "${filePath}"`,
            workspacePath
          );

          const isBinaryFile = binaryCheck.success &&
            binaryCheck.output?.includes('charset=binary');

          if (isBinaryFile) {
            console.log(`[DiffViewer] System detected as binary`);
            setIsBinary(true);
            setIsLoadingContent(false);
            return;
          }
        }

        // 3. 获取文件内容
        const oldResult = await api.executeCommand(
          `git show HEAD:"${filePath}" 2>/dev/null || echo ""`,
          workspacePath
        );

        const newResult = await api.executeCommand(
          `cat "${filePath}"`,
          workspacePath
        );

        if (!oldResult.success && !newResult.success) {
          setError('Failed to fetch file content');
          setIsLoadingContent(false);
          return;
        }

        const oldContentData = oldResult.success ? (oldResult.output || '') : '';
        const newContentData = newResult.success ? (newResult.output || '') : '';

        // 4. 内容检测兜底（仅对未知类型文件）
        // 对于文本白名单中的文件（如 .md），完全信任扩展名，不进行内容检测
        if (fileType === FileType.UNKNOWN) {
          if (isBinaryContent(oldContentData) || isBinaryContent(newContentData)) {
            console.log(`[DiffViewer] Content detected as binary`);
            setIsBinary(true);
            setIsLoadingContent(false);
            return;
          }
        }

        setOldContent(oldContentData);
        setNewContent(newContentData);
        setIsLoadingContent(false);
      } catch (err) {
        console.error('Failed to fetch content:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsLoadingContent(false);
      }
    };

    fetchContent();
  }, [filePath, workspacePath]);

  // 当内容加载完成后，使用 Worker 计算 diff
  useEffect(() => {
    if (!isLoadingContent && oldContent && newContent && !isBinary && !isLargeFile) {
      // 检查是否与上次计算的内容相同，避免重复计算
      const lastComputed = lastComputedContentRef.current;
      if (lastComputed && lastComputed.old === oldContent && lastComputed.new === newContent) {
        console.log('[DiffViewer] Content unchanged, skipping diff computation');
        return;
      }

      // 更新缓存
      lastComputedContentRef.current = { old: oldContent, new: newContent };

      const lineCount = Math.max(
        oldContent.split('\n').length,
        newContent.split('\n').length
      );

      // 根据文件大小决定是否使用分块加载
      const useChunking = lineCount > USE_CHUNKING_THRESHOLD;

      console.log('[DiffViewer] Computing diff:', { lineCount, useChunking });
      diffWorker.computeDiff(oldContent, newContent, {
        chunkSize: CHUNK_SIZE,
        useChunking
      });
    }
    // 只依赖基本类型，不依赖 diffWorker 对象避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingContent, oldContent, newContent, isBinary, isLargeFile]);

  // 综合 loading 状态
  useEffect(() => {
    setLoading(isLoadingContent || diffWorker.loading);
  }, [isLoadingContent, diffWorker.loading]);

  // 处理 Worker 错误
  useEffect(() => {
    if (diffWorker.error) {
      setError(diffWorker.error);
    }
  }, [diffWorker.error]);

  // 使用 Worker 计算的 diff 结果
  const diffLines = useMemo(() => {
    return diffWorker.lines;
  }, [diffWorker.lines]);

  // 虚拟滚动器
  const virtualizer = useVirtualizer({
    count: diffLines.length,
    getScrollElement: () => contentRef.current,
    estimateSize: (index) => {
      // modify 类型的行需要更多空间来显示删除和新增的内容
      // 20px (删除行) + 20px (新增行) = 40px
      const line = diffLines[index];
      return line?.type === 'modify' ? 40 : 20;
    },
    overscan: 10, // 预渲染可见区域外的 10 行
  });

  // 获取所有变更块的起始索引 (连续的变更作为一个块)
  const changeIndices = useMemo(() => {
    const blocks: number[] = [];
    let inChangeBlock = false;

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      const isChange = line.type !== 'context';

      if (isChange && !inChangeBlock) {
        // 新变更块的开始
        blocks.push(i);
        inChangeBlock = true;
      } else if (!isChange && inChangeBlock) {
        // 变更块结束
        inChangeBlock = false;
      }
    }

    return blocks;
  }, [diffLines]);

  // 获取当前变更块的范围 (用于高亮整个块)
  const getCurrentChangeBlockRange = useMemo(() => {
    if (changeIndices.length === 0 || currentChangeIndex >= changeIndices.length) {
      return { start: -1, end: -1 };
    }

    const blockStart = changeIndices[currentChangeIndex];
    let blockEnd = blockStart;

    // 找到这个变更块的结束位置
    for (let i = blockStart + 1; i < diffLines.length; i++) {
      if (diffLines[i].type === 'context') {
        break;
      }
      blockEnd = i;
    }

    return { start: blockStart, end: blockEnd };
  }, [changeIndices, currentChangeIndex, diffLines]);

  // 跳转到指定的变更
  const jumpToChange = (index: number) => {
    if (index < 0 || index >= changeIndices.length) return;

    const lineIndex = changeIndices[index];

    // 使用虚拟滚动器的 scrollToIndex 方法
    virtualizer.scrollToIndex(lineIndex, {
      align: 'start',
      behavior: 'smooth',
    });

    setCurrentChangeIndex(index);
  };

  // 上一个变更
  const handlePrevChange = () => {
    if (changeIndices.length === 0) return;
    const newIndex = currentChangeIndex > 0 ? currentChangeIndex - 1 : changeIndices.length - 1;
    jumpToChange(newIndex);
  };

  // 下一个变更
  const handleNextChange = () => {
    if (changeIndices.length === 0) return;
    const newIndex = currentChangeIndex < changeIndices.length - 1 ? currentChangeIndex + 1 : 0;
    jumpToChange(newIndex);
  };

  // 渲染二进制文件提示
  const renderBinaryNotice = () => {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center p-8">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
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
          <div className="mt-4 p-3 bg-muted/50 rounded text-xs text-left">
            <div className="font-medium mb-1">Suggestions:</div>
            <ul className="list-disc list-inside space-y-1 opacity-80">
              <li>Use <code className="px-1 py-0.5 bg-background rounded">git diff</code> in terminal</li>
              <li>View changes in an external diff tool</li>
              <li>Split large files into smaller modules</li>
            </ul>
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium font-mono">{filePath}</span>
            {isBinary && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                Binary
              </span>
            )}
            {diffWorker.loading && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded">
                Computing... {Math.round(diffWorker.progress)}%
              </span>
            )}
          </div>

          {/* 导航按钮 */}
          {!loading && !error && !isBinary && changeIndices.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {currentChangeIndex + 1} / {changeIndices.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handlePrevChange}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  title="Previous change (Shift+F7)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={handleNextChange}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  title="Next change (F7)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
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
            <span className="text-sm">Loading diff...</span>
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
      ) : !oldContent && !newContent ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-sm">No content to display</div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标题栏 */}
          <div className="px-4 py-2 bg-muted/20 border-b text-xs font-medium">
            Changes
          </div>

          {/* 内容 - 使用虚拟滚动 */}
          <div ref={contentRef} className="flex-1 overflow-auto font-mono text-xs">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const idx = virtualRow.index;
                const line = diffLines[idx];
                if (!line) return null;

                return (
                  <div
                    key={virtualRow.key}
                    ref={(el) => {
                      if (el) {
                        lineRefs.current.set(idx, el);
                      } else {
                        lineRefs.current.delete(idx);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={cn(
                      line.type === 'modify' ? 'min-h-[40px]' : 'min-h-[20px]',
                      line.type === 'delete' && 'bg-red-500/10',
                      line.type === 'add' && 'bg-green-500/10',
                      line.type === 'modify' && 'bg-yellow-500/10',
                      // 高亮当前选中的整个变更块
                      line.type !== 'context' &&
                      idx >= getCurrentChangeBlockRange.start &&
                      idx <= getCurrentChangeBlockRange.end &&
                      'ring-2 ring-blue-500/50'
                    )}
                  >
                    {line.type === 'modify' && line.oldContent ? (
                      /* Modify 类型：显示两行，每行都有完整的行号+符号+内容结构 */
                      <div className="flex flex-col">
                        {/* 删除行 */}
                        <div className="flex min-h-[20px]">
                          <div className="w-12 flex-shrink-0 px-2 text-right border-r select-none h-5 leading-5 text-muted-foreground">
                            {line.lineNumber}
                          </div>
                          <div className="w-6 flex-shrink-0 flex items-center justify-center select-none font-bold h-5 text-red-600 dark:text-red-400">
                            -
                          </div>
                          <div className="flex-1 px-2 whitespace-pre h-5 leading-5">
                            <span className="text-red-600/70 dark:text-red-400/70 line-through">
                              {line.oldContent}
                            </span>
                          </div>
                        </div>
                        {/* 新增行 */}
                        <div className="flex min-h-[20px]">
                          <div className="w-12 flex-shrink-0 px-2 text-right border-r select-none h-5 leading-5 text-muted-foreground">
                            {line.lineNumber}
                          </div>
                          <div className="w-6 flex-shrink-0 flex items-center justify-center select-none font-bold h-5 text-green-600 dark:text-green-400">
                            +
                          </div>
                          <div className="flex-1 px-2 whitespace-pre h-5 leading-5">
                            <span className="text-green-600 dark:text-green-400">
                              {line.content}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 其他类型：保持原有的单行结构 */
                      <div className="flex">
                        {/* 行号 */}
                        <div className={cn(
                          "w-12 flex-shrink-0 px-2 text-right border-r select-none h-5 leading-5",
                          line.type === 'delete' ? 'text-red-500/70' : 'text-muted-foreground'
                        )}>
                          {line.type === 'delete' ? '-' : line.lineNumber}
                        </div>

                        {/* 变更类型指示器 */}
                        <div className={cn(
                          "w-6 flex-shrink-0 flex items-center justify-center select-none font-bold h-5",
                          line.type === 'add' && 'text-green-600 dark:text-green-400',
                          line.type === 'delete' && 'text-red-600 dark:text-red-400'
                        )}>
                          {line.type === 'add' && '+'}
                          {line.type === 'delete' && '-'}
                        </div>

                        {/* 内容 */}
                        <div className="flex-1 px-2 whitespace-pre">
                          {line.type === 'delete' && line.oldContent && (
                            <span className="line-through opacity-70">{line.oldContent}</span>
                          )}
                          {(line.type === 'add' || line.type === 'context') && (
                            <span>{line.content || '\u00A0'}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffViewer;
