import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeBrowserProps {
  workspacePath?: string;
  onFileClick?: (filePath: string) => void;
  className?: string;
}

/**
 * 递归组件：渲染文件树节点
 */
interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  onFileClick?: (filePath: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  level,
  onFileClick,
  expandedDirs,
  onToggleDir
}) => {
  const isExpanded = expandedDirs.has(node.path);
  const isDirectory = node.type === 'directory';

  const handleClick = () => {
    if (isDirectory) {
      onToggleDir(node.path);
    } else {
      onFileClick?.(node.path);
    }
  };

  return (
    <div>
      {/* 节点项 */}
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 px-2 cursor-pointer hover:bg-muted/50 transition-colors text-sm",
          "group"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {/* 展开/折叠图标 */}
        {isDirectory && (
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </div>
        )}
        {!isDirectory && <div className="w-4" />}

        {/* 文件/文件夹图标 */}
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-blue-500" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-blue-500" />
            )
          ) : (
            <File className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>

        {/* 名称 */}
        <span className="flex-1 truncate text-foreground font-mono">
          {node.name}
        </span>
      </div>

      {/* 子节点 */}
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * FileTreeBrowser 组件 - 文件树浏览器
 */
export const FileTreeBrowser: React.FC<FileTreeBrowserProps> = ({
  workspacePath,
  onFileClick,
  className
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // 递归加载目录树
  const loadDirectoryTree = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    try {
      const entries = await api.listDirectoryContents(dirPath);

      // 转换为 FileNode 格式
      const nodes: FileNode[] = entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.is_directory ? 'directory' : 'file',
        children: entry.is_directory ? [] : undefined
      }));

      // 排序：目录在前，文件在后
      nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      return nodes;
    } catch (err) {
      console.error('Failed to load directory:', dirPath, err);
      return [];
    }
  }, []);

  // 递归更新节点的子节点
  const updateNodeChildren = useCallback((nodes: FileNode[], targetPath: string, children: FileNode[]): FileNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, children };
      }
      if (node.children && node.type === 'directory') {
        return { ...node, children: updateNodeChildren(node.children, targetPath, children) };
      }
      return node;
    });
  }, []);

  // 懒加载节点的子内容
  const loadChildrenForNode = useCallback(async (nodePath: string) => {
    try {
      const children = await loadDirectoryTree(nodePath);
      // 更新树结构，将子节点添加到对应的节点
      setTree(prevTree => updateNodeChildren(prevTree, nodePath, children));
    } catch (err) {
      console.error('Failed to load children for:', nodePath, err);
    }
  }, [loadDirectoryTree, updateNodeChildren]);

  // 切换目录展开/折叠，并懒加载子目录
  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      const wasExpanded = prev.has(path);

      if (wasExpanded) {
        next.delete(path);
      } else {
        next.add(path);
        // 懒加载子目录内容（仅在首次展开时）
        loadChildrenForNode(path);
      }
      return next;
    });
  }, [loadChildrenForNode]);

  // 加载文件树
  useEffect(() => {
    const loadFileTree = async () => {
      if (!workspacePath) {
        setTree([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const rootNodes = await loadDirectoryTree(workspacePath);
        setTree(rootNodes);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load file tree:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    loadFileTree();
  }, [workspacePath]);

  return (
    <div className={cn("flex flex-col h-full bg-background/95", className)}>
      {/* 标题 */}
      <div className="px-4 py-2 text-xs bg-muted/20 border-b flex items-center justify-between">
        <span className="font-medium">Files</span>
        {loading && (
          <svg
            className="w-3 h-3 animate-spin"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-4 text-sm text-red-500">
            <div className="font-medium mb-1">Error</div>
            <div className="text-xs">{error}</div>
          </div>
        ) : !workspacePath ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            Please select a project first
          </div>
        ) : loading ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            Loading files...
          </div>
        ) : tree.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No files found
          </div>
        ) : (
          <div className="py-2">
            {tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                level={0}
                onFileClick={onFileClick}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTreeBrowser;
