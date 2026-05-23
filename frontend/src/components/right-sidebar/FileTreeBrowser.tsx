import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { getFileIconConfig } from '@/lib/file-icons';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FlatNode {
  node: FileNode;
  level: number;
}

interface FileTreeBrowserProps {
  workspacePath?: string;
  onFileClick?: (filePath: string) => void;
  className?: string;
}

function flattenTree(nodes: FileNode[], expandedDirs: Set<string>, level: number = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    result.push({ node, level });
    if (node.type === 'directory' && expandedDirs.has(node.path) && node.children) {
      const children = flattenTree(node.children, expandedDirs, level + 1);
      for (let i = 0; i < children.length; i++) {
        result.push(children[i]);
      }
    }
  }
  return result;
}

export const FileTreeBrowser: React.FC<FileTreeBrowserProps> = ({
  workspacePath,
  onFileClick,
  className
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const flatNodes = useMemo(() => flattenTree(tree, expandedDirs), [tree, expandedDirs]);

  const loadDirectoryTree = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    try {
      const entries = await api.listDirectoryContents(dirPath);

      const nodes: FileNode[] = entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.is_directory ? 'directory' : 'file',
        children: entry.is_directory ? [] : undefined
      }));

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

  const loadChildrenForNode = useCallback(async (nodePath: string) => {
    try {
      const children = await loadDirectoryTree(nodePath);
      setTree(prevTree => updateNodeChildren(prevTree, nodePath, children));
    } catch (err) {
      console.error('Failed to load children for:', nodePath, err);
    }
  }, [loadDirectoryTree, updateNodeChildren]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (prev.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        loadChildrenForNode(path);
      }
      return next;
    });
  }, [loadChildrenForNode]);

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
    <div className={cn("flex flex-col h-full", className)}>
      <div className="px-3 py-2 text-xs border-b border-white/10 flex items-center justify-between bg-black/20">
        <span className="font-semibold text-foreground/80 tracking-wide uppercase">Files</span>
        {loading && (
          <div className="w-3 h-3 border border-foreground/30 border-t-foreground/80 rounded-full animate-spin" />
        )}
      </div>

      <div className="flex-1 min-h-0">
        {error ? (
          <div className="p-4 text-sm text-red-400">
            <div className="font-medium mb-1">Error</div>
            <div className="text-xs opacity-80">{error}</div>
          </div>
        ) : !workspacePath ? (
          <div className="p-4 text-sm text-foreground/50 text-center">
            Please select a project first
          </div>
        ) : loading && tree.length === 0 ? (
          <div className="p-4 text-sm text-foreground/50 text-center">
            Loading files...
          </div>
        ) : tree.length === 0 ? (
          <div className="p-4 text-sm text-foreground/50 text-center">
            No files found
          </div>
        ) : (
          <Virtuoso
            data={flatNodes}
            className="h-full"
            itemContent={(_index, { node, level }) => {
              const isExpanded = expandedDirs.has(node.path);
              const isDirectory = node.type === 'directory';
              const iconConfig = getFileIconConfig(node.name, isDirectory, isExpanded);
              const IconComponent = iconConfig.icon;

              return (
                <div
                  className={cn(
                    "flex items-center gap-1.5 py-1 px-2 cursor-pointer",
                    "hover:bg-white/10 transition-colors duration-150",
                    "rounded-sm mx-1",
                    "group"
                  )}
                  style={{ paddingLeft: `${level * 14 + 6}px` }}
                  onClick={() => {
                    if (isDirectory) {
                      handleToggleDir(node.path);
                    } else {
                      onFileClick?.(node.path);
                    }
                  }}
                >
                  {isDirectory && (
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-60 group-hover:opacity-100">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                  )}
                  {!isDirectory && <div className="w-4" />}

                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <IconComponent
                      className="w-4 h-4"
                      style={{ color: iconConfig.color }}
                    />
                  </div>

                  <span className={cn(
                    "flex-1 truncate text-[13px]",
                    isDirectory ? "font-medium text-foreground" : "text-foreground/90"
                  )}>
                    {node.name}
                  </span>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FileTreeBrowser;
