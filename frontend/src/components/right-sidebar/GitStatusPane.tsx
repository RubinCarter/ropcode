import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useGitChanged } from '@/hooks';

export interface GitFileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitStatusPaneProps {
  workspacePath?: string;
  className?: string;
  onFileClick?: (file: GitFileChange) => void;
}

// 辅助函数：将 status 对象转换为 GitFileChange 数组
const parseGitStatus = (statusMap: Record<string, string>): GitFileChange[] => {
  const files: GitFileChange[] = [];

  for (const [filePath, statusCode] of Object.entries(statusMap)) {
    if (!filePath || !statusCode || statusCode.length < 2) continue;

    let status: GitFileChange['status'] = 'modified';
    let staged = false;

    // 解析状态码
    const stagedChar = statusCode[0];
    const unstagedChar = statusCode[1];

    // 判断是否暂存
    if (stagedChar !== ' ' && stagedChar !== '?') {
      staged = true;
    }

    // 确定文件状态
    if (statusCode === '??') {
      status = 'untracked';
    } else if (stagedChar === 'A' || unstagedChar === 'A') {
      status = 'added';
    } else if (stagedChar === 'D' || unstagedChar === 'D') {
      status = 'deleted';
    } else if (stagedChar === 'R' || unstagedChar === 'R') {
      status = 'renamed';
    } else {
      status = 'modified';
    }

    files.push({
      path: filePath,
      status,
      staged
    });
  }

  return files;
};

export const GitStatusPane: React.FC<GitStatusPaneProps> = ({
  workspacePath,
  className,
  onFileClick
}) => {
  const [files, setFiles] = useState<GitFileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // 获取 git 状态
  const fetchGitStatus = useCallback(async () => {
    if (!workspacePath) {
      setFiles([]);
      setCurrentBranch('');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 获取当前分支
      const branch = await api.getCurrentBranch(workspacePath);
      setCurrentBranch(branch);

      // 执行 git status --porcelain 获取文件状态
      const result = await api.executeCommand('git -c core.quotepath=false status --porcelain', workspacePath);

      if (!result.success) {
        setError(result.error || 'Failed to get Git status');
        setFiles([]);
        return;
      }

      // 解析 git status 输出
      const output = result.output || '';
      const parsedFiles: GitFileChange[] = [];

      output.split('\n').forEach(line => {
        if (!line.trim()) return;

        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3);

        let status: GitFileChange['status'] = 'modified';
        let staged = false;

        // 解析状态码
        const stagedChar = statusCode[0];
        const unstagedChar = statusCode[1];

        // 判断是否暂存
        if (stagedChar !== ' ' && stagedChar !== '?') {
          staged = true;
        }

        // 确定文件状态
        if (statusCode === '??') {
          status = 'untracked';
        } else if (stagedChar === 'A' || unstagedChar === 'A') {
          status = 'added';
        } else if (stagedChar === 'D' || unstagedChar === 'D') {
          status = 'deleted';
        } else if (stagedChar === 'R' || unstagedChar === 'R') {
          status = 'renamed';
        } else {
          status = 'modified';
        }

        parsedFiles.push({
          path: filePath,
          status,
          staged
        });
      });

      setFiles(parsedFiles);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  // 管理 Git 监听器的生命周期
  useEffect(() => {
    if (workspacePath) {
      api.WatchGitWorkspace(workspacePath);
      return () => {
        api.UnwatchGitWorkspace(workspacePath);
      };
    }
  }, [workspacePath]);

  // 订阅 Git 变化事件
  useGitChanged(workspacePath, (event) => {
    // 更新分支信息
    setCurrentBranch(event.branch);

    // 解析文件状态
    const parsedFiles = parseGitStatus(event.status);
    setFiles(parsedFiles);
  });

  // 获取状态图标和颜色
  const getStatusDisplay = (file: GitFileChange) => {
    switch (file.status) {
      case 'modified':
        return { icon: 'M', color: 'text-yellow-500', label: 'Modified' };
      case 'added':
        return { icon: 'A', color: 'text-green-500', label: 'Added' };
      case 'deleted':
        return { icon: 'D', color: 'text-red-500', label: 'Deleted' };
      case 'untracked':
        return { icon: 'U', color: 'text-gray-500', label: 'Untracked' };
      case 'renamed':
        return { icon: 'R', color: 'text-blue-500', label: 'Renamed' };
      default:
        return { icon: '?', color: 'text-gray-400', label: 'Unknown' };
    }
  };

  // 处理文件点击
  const handleFileClick = (file: GitFileChange) => {
    console.log('[GitStatusPane] File clicked:', file.path);
    setSelectedFile(file.path);
    onFileClick?.(file);
  };

  return (
    <div className={cn("flex flex-col h-full bg-background/95", className)}>
      {/* 分支信息 */}
      {currentBranch && (
        <div className="px-4 py-2 text-xs bg-muted/20 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            <span className="text-muted-foreground">Branch:</span>
            <span className="font-mono font-medium">{currentBranch}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* 刷新按钮 */}
            <button
              onClick={fetchGitStatus}
              className="p-1 hover:bg-muted rounded"
              title="Refresh"
              disabled={loading}
            >
              <svg
                className={cn("w-3 h-3", loading && "animate-spin")}
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
            </button>
          </div>
        </div>
      )}

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
        ) : files.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            <div className="mb-2">✓</div>
            <div>Working tree is clean</div>
          </div>
        ) : (
          <div className="p-2">
            {/* 显示所有文件，不分组 */}
            {files.map((file, idx) => {
              const display = getStatusDisplay(file);
              const isSelected = selectedFile === file.path;
              return (
                <div
                  key={idx}
                  onClick={() => handleFileClick(file)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded text-xs group cursor-pointer transition-colors",
                    "hover:bg-muted/50",
                    isSelected && "bg-muted/70 ring-1 ring-primary/50"
                  )}
                >
                  <span className={cn("font-mono font-bold w-4", display.color)}>
                    {display.icon}
                  </span>
                  <span className="flex-1 truncate font-mono" title={file.path}>
                    {file.path}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GitStatusPane;
