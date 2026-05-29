import React, { useState } from 'react';
import { GitBranch, FolderOpen, AlertCircle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type GitCloneProgress } from '@/lib/api';
import { useTranslation } from 'react-i18next';

interface CloneFromURLDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when project is successfully cloned */
  onSuccess?: () => void;
}

/**
 * Dialog for cloning a project from a Git URL
 */
export const CloneFromURLDialog: React.FC<CloneFromURLDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [branch, setBranch] = useState('');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<GitCloneProgress | null>(null);

  const handleSelectLocalPath = async () => {
    try {
      const { open } = await import('@/lib/dialog');
      const result = await open({
        directory: true,
        multiple: false,
        title: 'Select Target Directory',
      });

      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        setLocalPath(result.filePaths[0]);
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err);
    }
  };

  const handleClone = async () => {
    // Validation
    if (!repoUrl || !localPath) {
      setError(t('clone.fillRequired'));
      return;
    }

    try {
      setCloning(true);
      setError(null);
      setProgress(null);

      const config = {
        url: repoUrl,
        localPath: localPath,
        branch: branch || undefined,
      };

      await api.cloneRepository(config, (progressData: GitCloneProgress) => {
        setProgress(progressData);
        if (progressData.error) {
          setError(progressData.error);
        }
      });

      if (onSuccess) {
        onSuccess();
      }

      // Close dialog on success
      onClose();

      // Reset form
      setRepoUrl('');
      setLocalPath('');
      setBranch('');
      setProgress(null);
    } catch (err) {
      console.error('Clone failed:', err);
      setError(err instanceof Error ? err.message : t('clone.cloneFailed'));
    } finally {
      setCloning(false);
    }
  };

  const handleCancel = () => {
    if (!cloning) {
      setRepoUrl('');
      setLocalPath('');
      setBranch('');
      setError(null);
      setProgress(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  // Format bytes to human-readable size
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // Get stage display text
  const getStageText = (stage: string): string => {
    switch (stage) {
      case 'initializing':
        return t('clone.stageInitializing');
      case 'cloning':
        return t('clone.stageCloning');
      case 'resolving':
        return t('clone.stageResolving');
      case 'completed':
        return t('clone.stageCompleted');
      case 'error':
        return t('clone.stageError');
      default:
        return t('clone.stageProcessing');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={handleCancel}
      />

      {/* Content */}
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-[500px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                {t('clone.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('clone.subtitle')}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={cloning}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Repository URL */}
          <div>
            <label className="text-xs text-muted-foreground">{t('clone.repoUrl')}</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder={t('clone.repoUrlPlaceholder')}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background mt-1"
              disabled={cloning}
            />
          </div>

          {/* Local Path */}
          <div>
            <label className="text-xs text-muted-foreground">{t('clone.targetDirectory')}</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder={t('clone.targetDirPlaceholder')}
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
                disabled={cloning}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSelectLocalPath}
                disabled={cloning}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Branch (Optional) */}
          <div>
            <label className="text-xs text-muted-foreground">
              {t('clone.branch')}
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={t('clone.branchPlaceholder')}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background mt-1"
              disabled={cloning}
            />
          </div>

          {/* Progress Display */}
          {progress && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {getStageText(progress.stage)}
                </span>
                <span className="text-xs text-blue-700 dark:text-blue-300">
                  {progress.percentage.toFixed(1)}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 dark:bg-blue-400 h-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>

              {/* Details */}
              {progress.currentOperation && (
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {progress.currentOperation}
                </p>
              )}

              {progress.totalObjects > 0 && (
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <div>
                    {t('clone.objects', { received: progress.objectsReceived, total: progress.totalObjects })}
                  </div>
                  {progress.bytesReceived > 0 && (
                    <div>{t('clone.downloaded', { size: formatBytes(progress.bytesReceived) })}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-6 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={cloning}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleClone} disabled={cloning || !repoUrl || !localPath}>
            {cloning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('clone.cloning')}
              </>
            ) : (
              t('clone.cloneRepository')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
