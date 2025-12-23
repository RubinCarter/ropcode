import React, { useState } from 'react';
import { FolderOpen, X, AlertCircle, CheckCircle2, Loader2, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type Project } from '@/lib/api';

interface OpenProjectDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when project is successfully created */
  onSuccess?: (project: Project) => void;
}

/**
 * Dialog for opening a local project folder
 */
export const OpenProjectDialog: React.FC<OpenProjectDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  // Form state
  const [selectedPath, setSelectedPath] = useState('');
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [isWorktree, setIsWorktree] = useState<boolean>(false);
  const [worktreeInfo, setWorktreeInfo] = useState<any | null>(null);
  const [initGit, setInitGit] = useState(false);
  const [commitAllFiles, setCommitAllFiles] = useState(false);

  // Process state
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'selecting' | 'init-git' | 'creating' | 'completed' | 'error'>('selecting');
  const [progress, setProgress] = useState(0);
  const [currentOperation, setCurrentOperation] = useState<string>('');

  const handleSelectFolder = async () => {
    try {
      const { open } = await import('@/lib/dialog');
      const result = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Folder',
        defaultPath: await api.getHomeDirectory(),
      });

      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        const selected = result.filePaths[0];
        setSelectedPath(selected);
        setError(null);

        // Check if it's a worktree by detecting .ropcode directory
        try {
          const worktreeResult = await api.detectWorktree(selected);
          if (worktreeResult.is_worktree) {
            setIsWorktree(true);
            setWorktreeInfo(worktreeResult);
            setIsGitRepo(true);
            setInitGit(false);
          } else {
            setIsWorktree(false);
            setWorktreeInfo(null);
            // Check if it's a git repository
            try {
              const isGit = await api.isGitRepository(selected);
              setIsGitRepo(isGit);
              setInitGit(!isGit); // Default to init if not a git repo
            } catch (err) {
              console.error('Failed to check git repository:', err);
              setIsGitRepo(false);
            }
          }
        } catch (err) {
          console.error('Failed to detect worktree:', err);
          setIsWorktree(false);
          setWorktreeInfo(null);
          // Fallback to git check
          try {
            const isGit = await api.isGitRepository(selected);
            setIsGitRepo(isGit);
            setInitGit(!isGit);
          } catch (err2) {
            console.error('Failed to check git repository:', err2);
            setIsGitRepo(false);
          }
        }
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err);
      setError('Failed to open folder picker');
    }
  };

  const handleCreateProject = async () => {
    if (!selectedPath) {
      setError('Please select a project folder');
      return;
    }

    setProcessing(true);
    setError(null);
    setProgress(0);

    try {
      // Initialize git if requested and not already a git repo
      if (!isGitRepo && initGit) {
        setStage('init-git');
        setCurrentOperation(commitAllFiles
          ? 'Initializing Git and committing all files...'
          : 'Initializing Git repository...');
        setProgress(10);

        try {
          await api.initLocalGit(selectedPath, commitAllFiles);
          setProgress(50);
        } catch (gitError) {
          console.error('Failed to initialize local git:', gitError);
          // Don't fail the whole process, just log the error
        }
      }

      // Create the project
      setStage('creating');
      setCurrentOperation('Creating project...');
      setProgress(initGit ? 60 : 30);

      const project = await api.createProject(selectedPath);
      setProgress(initGit ? 80 : 70);

      // Add to index
      setCurrentOperation('Adding to project index...');
      try {
        await api.addProjectToIndex(selectedPath);
      } catch (indexError) {
        console.warn('Failed to add project to index:', indexError);
      }

      setProgress(100);
      setStage('completed');
      setCurrentOperation('Project created successfully!');

      // Call success callback
      if (onSuccess) {
        onSuccess(project);
      }

      // Close dialog after a short delay
      setTimeout(() => {
        onClose();
        resetState();
      }, 1000);
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setStage('error');
    } finally {
      setProcessing(false);
    }
  };

  const resetState = () => {
    setSelectedPath('');
    setIsGitRepo(null);
    setIsWorktree(false);
    setWorktreeInfo(null);
    setInitGit(false);
    setCommitAllFiles(false);
    setProcessing(false);
    setError(null);
    setStage('selecting');
    setProgress(0);
    setCurrentOperation('');
  };

  const handleCancel = () => {
    if (!processing) {
      onClose();
      resetState();
    }
  };

  const renderProgressBar = () => {
    if (!processing && stage !== 'completed') return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {stage === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          )}
          <span className="text-sm font-medium">{currentOperation}</span>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={handleCancel}
      />

      {/* Content */}
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-[500px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Open Project
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Select a local folder to open as a project
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={processing}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Progress bar */}
          {renderProgressBar()}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-md">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-destructive/80">{error}</p>
              </div>
            </div>
          )}

          {/* Folder selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project Folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={selectedPath}
                readOnly
                placeholder="No folder selected"
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted/50"
              />
              <Button
                onClick={handleSelectFolder}
                disabled={processing}
                variant="outline"
                size="sm"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Browse
              </Button>
            </div>
          </div>

          {/* Git initialization option */}
          {selectedPath && isGitRepo === false && (
            <div className="space-y-3 p-4 border rounded-md bg-muted/30">
              <div className="flex items-start gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Git Repository</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This directory is not a Git repository
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="init-git"
                    checked={initGit}
                    onChange={(e) => {
                      setInitGit(e.target.checked);
                      if (!e.target.checked) {
                        setCommitAllFiles(false);
                      }
                    }}
                    disabled={processing}
                    className="mt-1"
                  />
                  <label htmlFor="init-git" className="flex-1 text-sm cursor-pointer">
                    Initialize as local Git repository
                    <span className="block text-xs text-muted-foreground mt-1">
                      Create a bare repository in ~/.ropcode/local-git and set up remote tracking
                    </span>
                  </label>
                </div>

                {initGit && (
                  <div className="flex items-start gap-2 ml-6">
                    <input
                      type="checkbox"
                      id="commit-all-files"
                      checked={commitAllFiles}
                      onChange={(e) => setCommitAllFiles(e.target.checked)}
                      disabled={processing}
                      className="mt-1"
                    />
                    <label htmlFor="commit-all-files" className="flex-1 text-sm cursor-pointer">
                      Commit all files immediately
                      <span className="block text-xs text-muted-foreground mt-1">
                        Create an initial commit with all project files (may take longer for large projects)
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Worktree status */}
          {selectedPath && isWorktree && worktreeInfo && (
            <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-md">
              <GitBranch className="h-4 w-4 text-blue-500 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Worktree detected
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Main branch: {worktreeInfo.mainBranch}
                </p>
                <p className="text-xs text-muted-foreground">
                  Root: {worktreeInfo.rootPath}
                </p>
              </div>
            </div>
          )}

          {/* Git status */}
          {selectedPath && !isWorktree && isGitRepo === true && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-md">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-green-600 dark:text-green-400">
                Git repository detected
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={processing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateProject}
            disabled={!selectedPath || processing}
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open Project
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
