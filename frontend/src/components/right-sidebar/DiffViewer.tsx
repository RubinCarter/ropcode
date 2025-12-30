import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type { DiffEditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { getLanguageByFilename } from '@/lib/file-icons';

// 使用本地 monaco-editor 而非 CDN
loader.config({ monaco });

export interface DiffLine {
  type: 'add' | 'delete' | 'modify' | 'context';
  lineNumber: number;
  content: string;
  oldContent?: string;
}

interface DiffViewerProps {
  filePath: string;
  workspacePath: string;
  className?: string;
}

// 配置常量
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * DiffViewer 组件 - 使用 Monaco DiffEditor 显示代码差异
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
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLargeFile, setIsLargeFile] = useState(false);

  // Change navigation state
  const [changes, setChanges] = useState<monaco.editor.ILineChange[]>([]);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  // 获取文件语言
  const language = getLanguageByFilename(filePath);

  // Handle editor mount and get changes
  const handleEditorDidMount: DiffEditorProps['onMount'] = useCallback((editor) => {
    diffEditorRef.current = editor;

    // Get line changes after diff is computed
    const updateChanges = () => {
      const lineChanges = editor.getLineChanges();
      if (lineChanges && lineChanges.length > 0) {
        setChanges(lineChanges);
        setCurrentChangeIndex(0);
        // Auto-scroll to first change
        const firstChange = lineChanges[0];
        const targetLine = firstChange.modifiedStartLineNumber || firstChange.originalStartLineNumber;
        editor.revealLineInCenter(targetLine);
      } else {
        setChanges([]);
        setCurrentChangeIndex(0);
      }
    };

    // Wait for diff computation to complete
    setTimeout(updateChanges, 100);

    // Listen for content changes
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.onDidChangeModelContent(() => {
      setTimeout(updateChanges, 100);
    });
  }, []);

  // Navigate to previous change
  const goToPreviousChange = useCallback(() => {
    if (changes.length === 0 || currentChangeIndex <= 0) return;

    const newIndex = currentChangeIndex - 1;
    setCurrentChangeIndex(newIndex);

    const change = changes[newIndex];
    const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
    diffEditorRef.current?.revealLineInCenter(targetLine);
  }, [changes, currentChangeIndex]);

  // Navigate to next change
  const goToNextChange = useCallback(() => {
    if (changes.length === 0 || currentChangeIndex >= changes.length - 1) return;

    const newIndex = currentChangeIndex + 1;
    setCurrentChangeIndex(newIndex);

    const change = changes[newIndex];
    const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
    diffEditorRef.current?.revealLineInCenter(targetLine);
  }, [changes, currentChangeIndex]);

  // 获取文件的两个版本
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

        // 2. 检查是否为二进制文件
        const binaryCheck = await api.executeCommand(
          `file --mime "${filePath}"`,
          workspacePath
        );

        if (binaryCheck.success && binaryCheck.output?.includes('charset=binary')) {
          setIsBinary(true);
          setLoading(false);
          return;
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
          setLoading(false);
          return;
        }

        setOldContent(oldResult.success ? (oldResult.output || '') : '');
        setNewContent(newResult.success ? (newResult.output || '') : '');
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch content:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchContent();
  }, [filePath, workspacePath]);

  // 渲染二进制文件提示
  const renderBinaryNotice = () => (
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
            <span className="text-sm font-medium font-mono truncate max-w-[200px]" title={filePath}>
              {filePath.split('/').pop()}
            </span>
            {isBinary && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                Binary
              </span>
            )}
          </div>

          {/* Change navigation controls */}
          {!loading && !error && !isBinary && !isLargeFile && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground tabular-nums mr-1">
                {changes.length > 0 ? `${currentChangeIndex + 1}/${changes.length}` : '0/0'}
              </span>
              <button
                onClick={goToPreviousChange}
                disabled={changes.length === 0 || currentChangeIndex <= 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous change"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                onClick={goToNextChange}
                disabled={changes.length === 0 || currentChangeIndex >= changes.length - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next change"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
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
      ) : (
        <div className="flex-1 overflow-hidden [&_.editor.original_.margin-view-overlays_.line-numbers]:!hidden">
          <DiffEditor
            key={filePath}
            original={oldContent}
            modified={newContent}
            language={language}
            theme="vs-dark"
            keepCurrentOriginalModel={false}
            keepCurrentModifiedModel={false}
            onMount={handleEditorDidMount}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              lineNumbers: 'on',
              glyphMargin: false,
              folding: true,
              lineDecorationsWidth: 0,
              lineNumbersMinChars: 3,
              renderOverviewRuler: false,
              scrollbar: {
                vertical: 'auto',
                horizontal: 'auto',
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              // 禁用编辑相关功能
              domReadOnly: true,
              cursorStyle: 'line',
              cursorBlinking: 'solid',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default DiffViewer;
