import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { FileText, Save, Eye, Pencil } from 'lucide-react';
import { basename } from '@/lib/pathUtils';

// Use local monaco-editor instead of CDN to avoid 404 errors
loader.config({ monaco });

interface FileViewerProps {
  filePath: string;
  workspacePath: string;
  className?: string;
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
}

// Config constants
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Language mapping - maps file extensions to Monaco language identifiers
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
 * Get language identifier
 */
const getLanguage = (filePath: string): string => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  if (LANGUAGE_MAP[extension]) {
    return LANGUAGE_MAP[extension];
  }

  // Check special files without extension
  const filename = basename(filePath, filePath).toLowerCase();
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile') return 'makefile';

  return 'plaintext';
};

/**
 * FileViewer component - supports preview and edit mode
 */
export const FileViewer: React.FC<FileViewerProps> = ({
  filePath,
  workspacePath,
  className,
  onUnsavedChangesChange,
}) => {
  // Base state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [isBinary, setIsBinary] = useState(false);
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [isWritable, setIsWritable] = useState(false);

  // edit modestate
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveHandlerRef = useRef<(() => void) | null>(null);

  // Compute whether there are unsaved changes
  const hasUnsavedChanges = editedContent !== null && editedContent !== content;

  // Notify parent component of unsaved changes state
  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  // Get file content and check writability
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      setIsBinary(false);
      setIsLargeFile(false);
      setIsWritable(false);
      setIsEditMode(false);
      setEditedContent(null);
      setSaveError(null);

      try {
        const metadata = await api.getFileMetadata(filePath);
        setFileSize(metadata.size);
        setIsWritable(metadata.is_writable);

        if (metadata.size > MAX_FILE_SIZE) {
          setIsLargeFile(true);
          setLoading(false);
          return;
        }

        if (metadata.is_binary) {
          setIsBinary(true);
          setLoading(false);
          return;
        }

        const result = await api.readFile(filePath);
        setContent(result || '');
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch file content:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchContent();
  }, [filePath, workspacePath]);

  // Get filename and language
  const fileName = useMemo(() => {
    return basename(filePath, filePath);
  }, [filePath]);

  const language = useMemo(() => {
    return getLanguage(filePath);
  }, [filePath]);

  // Monaco Editor mount handler
  const handleEditorDidMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    // Add Cmd+S / Ctrl+S shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Use ref to get latest save handler, avoiding closure issues
      saveHandlerRef.current?.();
    });
  }, []);

  // Process editor content changes
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (isEditMode) {
      setEditedContent(value ?? '');
      setSaveError(null);
    }
  }, [isEditMode]);

  // Save file
  const handleSave = useCallback(async () => {
    if (!hasUnsavedChanges || editedContent === null) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await api.writeFile(filePath, editedContent);
      setContent(editedContent);
      setEditedContent(null);
      console.log('[FileViewer] File saved:', filePath);
    } catch (err) {
      console.error('[FileViewer] Save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [filePath, editedContent, hasUnsavedChanges]);

  // Update saveHandlerRef so shortcut gets latest handleSave
  useEffect(() => {
    saveHandlerRef.current = handleSave;
  }, [handleSave]);

  // Enter edit mode
  const enterEditMode = useCallback(() => {
    if (isWritable && !isBinary && !isLargeFile) {
      setIsEditMode(true);
      setEditedContent(content);
    }
  }, [isWritable, isBinary, isLargeFile, content]);

  // Exit edit mode (preview mode)
  const exitEditMode = useCallback(() => {
    if (hasUnsavedChanges) {
      // If unsaved changes, ask user
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
    }
    setIsEditMode(false);
    setEditedContent(null);
    setSaveError(null);
  }, [hasUnsavedChanges]);

  // Restore file content
  const handleRevert = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Revert all changes?');
      if (!confirmed) return;
    }
    setEditedContent(content);
    editorRef.current?.setValue(content);
  }, [content, hasUnsavedChanges]);

  // Render binary file notice
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

  // Render large file warning
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

  // RenderHeaderbutton
  const renderHeaderButtons = () => {
    if (loading || error || isBinary || isLargeFile) {
      return null;
    }

    if (isEditMode) {
      return (
        <div className="flex items-center gap-1.5">
          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!hasUnsavedChanges || isSaving}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium rounded flex items-center gap-1.5 transition-colors border',
              hasUnsavedChanges
                ? 'bg-green-600 text-white border-green-500 hover:bg-green-700'
                : 'bg-neutral-700 text-neutral-400 border-neutral-600 cursor-not-allowed'
            )}
          >
            <Save className="w-3 h-3" />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          {/* Preview button */}
          <button
            onClick={exitEditMode}
            className="px-2.5 py-1 text-[11px] font-medium bg-neutral-700 text-neutral-200 border border-neutral-600 rounded flex items-center gap-1.5 hover:bg-neutral-600 transition-colors"
          >
            <Eye className="w-3 h-3" />
            Preview
          </button>
        </div>
      );
    }

    // preview mode
    if (isWritable) {
      return (
        <button
          onClick={enterEditMode}
          className="px-2.5 py-1 text-[11px] font-medium bg-neutral-700 text-neutral-200 border border-neutral-600 rounded flex items-center gap-1.5 hover:bg-neutral-600 transition-colors"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      );
    }

    // Read-only file
    return (
      <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded">
        Read-only
      </span>
    );
  };

  // Currently shown content (editedContent in edit mode, otherwise content)
  const displayContent = isEditMode && editedContent !== null ? editedContent : content;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header - waveterm style */}
      <div className="px-3 py-1.5 border-b border-white/10 bg-black/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground/90">
              {fileName}
              {hasUnsavedChanges && <span className="text-yellow-400 ml-1">*</span>}
            </span>
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
            {isEditMode && (
              <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">
                editing
              </span>
            )}
          </div>
          {renderHeaderButtons()}
        </div>
        {/* Save error message */}
        {saveError && (
          <div className="mt-1 text-[11px] text-red-400">
            Save failed: {saveError}
          </div>
        )}
      </div>

      {/* Content area */}
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
      ) : !displayContent && !isEditMode ? (
        <div className="flex-1 flex items-center justify-center text-foreground/40">
          <div className="text-sm">Empty file</div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={language}
            value={displayContent}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            onChange={handleEditorChange}
            options={{
              readOnly: !isEditMode,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: '"Hack", "Fira Code", "JetBrains Mono", monospace',
              lineNumbers: 'on',
              renderLineHighlight: isEditMode ? 'line' : 'none',
              scrollbar: {
                useShadows: false,
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: !isEditMode,
              contextmenu: isEditMode,
              smoothScrolling: true,
              cursorBlinking: isEditMode ? 'blink' : 'solid',
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
