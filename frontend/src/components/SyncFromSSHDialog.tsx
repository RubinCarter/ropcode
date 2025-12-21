import React, { useState } from 'react';
import { Server, FolderOpen, AlertCircle, CheckCircle2, Loader2, X, Plus, Trash2, Upload, Download, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type SSHConfig, type SSHSyncProgress, type SSHAuthMethod } from '@/lib/api';
import { SSHConnectionsManager } from './SSHConnectionsManager';

interface SyncFromSSHDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when project is successfully synced */
  onSuccess?: () => void;
}

/**
 * Dialog for syncing a project from SSH server
 */
export const SyncFromSSHDialog: React.FC<SyncFromSSHDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  // Form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('privateKey');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_rsa');
  const [passphrase, setPassphrase] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [skipGit, setSkipGit] = useState(true);
  const [skipRopcode, setSkipRopcode] = useState(true);
  const [customSkipPatterns, setCustomSkipPatterns] = useState<string[]>([]);
  // Git Init state
  const [initGit, setInitGit] = useState(true);
  const [commitAllFiles, setCommitAllFiles] = useState(false);

  // Auto sync state
  const [enableAutoSync, setEnableAutoSync] = useState(false);
  const [autoSyncDirection, setAutoSyncDirection] = useState<'local-priority' | 'bidirectional'>('local-priority');

  // Initial sync direction (only for first sync)
  const [syncDirection, setSyncDirection] = useState<'pull' | 'push'>('pull');

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SSHSyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncId, setSyncId] = useState<string | null>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const list = await api.listGlobalSshConnections();
        setPresets(list || []);
      } catch {}
    })();
  }, [isOpen]);

  const handleSelectLocalPath = async () => {
    try {
      const { open } = await import('@/lib/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Local Target Directory',
        defaultPath: await api.getHomeDirectory(),
      });

      if (selected && typeof selected === 'string') {
        setLocalPath(selected);
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err);
    }
  };

  const handleSync = async () => {
    // Validation
    if (!host || !username || !remotePath || !localPath) {
      setError('Please fill in all required fields');
      return;
    }

    if (authType === 'password' && !password) {
      setError('Please enter password');
      return;
    }

    if (authType === 'privateKey' && !privateKeyPath) {
      setError('Please select private key file');
      return;
    }

    setSyncing(true);
    setError(null);
    setProgress(null);

    try {
      // Build auth method
      const authMethod: SSHAuthMethod = authType === 'password'
        ? { type: 'password', password }
        : { type: 'privateKey', keyPath: privateKeyPath, passphrase: passphrase || undefined };

      // Build skip patterns
      const skipPatterns: string[] = [];
      if (skipGit) skipPatterns.push('.git');
      if (skipRopcode) skipPatterns.push('.ropcode');
      // Add custom patterns
      skipPatterns.push(...customSkipPatterns.filter(p => p.trim()));

      const config: SSHConfig = {
        host,
        port,
        username,
        authMethod,
        remotePath,
        localPath,
        skipPatterns,
        connectionName: selectedPreset || undefined,
        syncDirection,
        autoSyncDirection,
      };

      // Call API to sync from SSH
      const project = await api.syncFromSSH(config, (prog) => {
        setProgress(prog);
        if (prog.syncId) setSyncId(prog.syncId);
      });

      // Optionally init local git if requested and not a repo
      if (initGit) {
        try {
          await api.initLocalGit(localPath, commitAllFiles);
        } catch (e) {
          console.warn('init local git failed', e);
        }
      }

      // Start auto sync if enabled
      if (enableAutoSync && project) {
        try {
          await api.startAutoSync(project.id, config);
          console.log('Auto sync started for project:', project.id);
        } catch (e) {
          console.error('Failed to start auto sync:', e);
          setError('Sync completed, but failed to start auto sync: ' + (e instanceof Error ? e.message : String(e)));
        }
      }

      // Success
      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err) {
      console.error('SSH sync failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync from SSH');
    } finally {
      setSyncing(false);
    }
  };

  const handleCancel = () => {
    if (!syncing) {
      onClose();
    } else if (syncId) {
      api.cancelSshSync(syncId).catch(() => {});
    }
  };

  const handlePause = () => {
    if (syncId) api.pauseSshSync(syncId).catch(() => {});
  };
  const handleResume = () => {
    if (syncId) api.resumeSshSync(syncId).catch(() => {});
  };

  const renderProgressStage = () => {
    if (!progress) return null;

    const stageText = {
      connecting: 'Connecting to server...',
      authenticating: 'Authenticating...',
      downloading: 'Downloading files...',
      completed: 'Sync completed!',
      error: 'Error occurred',
    };

    const stageIcon = {
      connecting: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
      authenticating: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
      downloading: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
      completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
      error: <AlertCircle className="h-4 w-4 text-red-500" />,
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {stageIcon[progress.stage]}
          <span className="text-sm font-medium">{stageText[progress.stage]}</span>
        </div>

        {progress.stage === 'downloading' && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{progress.filesProcessed} / {progress.totalFiles} files</span>
                <span>{Math.round(progress.percentage)}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>

            {progress.currentFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                {progress.direction === 'upload' ? (
                  <Upload className="h-3 w-3 text-amber-500" />
                ) : (
                  <Download className="h-3 w-3 text-blue-500" />
                )}
                <span className="truncate">{progress.currentFile}</span>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              {(progress.bytesDownloaded / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB
            </div>
          </>
        )}

        {progress.error && (
          <div className="text-sm text-red-500">
            {progress.error}
          </div>
        )}

        {/* Controls */}
        {progress?.stage === 'downloading' && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePause} disabled={progress.isPaused}>
              <Pause className="h-3 w-3 mr-1" /> Pause
            </Button>
            <Button size="sm" variant="outline" onClick={handleResume} disabled={!progress.isPaused}>
              <Play className="h-3 w-3 mr-1" /> Resume
            </Button>
            <Button size="sm" variant="destructive" onClick={handleCancel}>
              <Square className="h-3 w-3 mr-1" /> Cancel
            </Button>
          </div>
        )}
      </div>
    );
  };

  const loadPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setSelectedPreset(name);
    setHost(p.host || '');
    setPort(p.port || 22);
    setUsername(p.username || '');
    if (p.auth_method?.type === 'password') {
      setAuthType('password');
      setPassword(p.auth_method.password || '');
    } else if (p.auth_method?.type === 'privateKey') {
      setAuthType('privateKey');
      setPrivateKeyPath(p.auth_method.keyPath || '');
      setPassphrase(p.auth_method.passphrase || '');
    }
    // remote_path, local_path, and skip_patterns are not part of connection config
    // They should be entered fresh each time for each sync operation
  };

  const handleAddCustomPattern = () => {
    setCustomSkipPatterns([...customSkipPatterns, '']);
  };

  const handleRemoveCustomPattern = (index: number) => {
    setCustomSkipPatterns(customSkipPatterns.filter((_, i) => i !== index));
  };

  const handleCustomPatternChange = (index: number, value: string) => {
    const newPatterns = [...customSkipPatterns];
    newPatterns[index] = value;
    setCustomSkipPatterns(newPatterns);
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
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-[550px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Sync Project from SSH
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Connect to a remote server via SSH and sync a project to your local machine
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={syncing}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {syncing ? (
          <div className="p-6">
            {renderProgressStage()}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* SSH Connection Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">SSH Connection</div>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>setShowManager(true)}>
                  Manage Connections
                </Button>
              </div>

              {presets.length > 0 ? (
                <>
                  <div className="text-xs text-muted-foreground">Select a saved connection</div>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    value={selectedPreset || ''}
                    onChange={(e) => loadPreset(e.target.value)}
                  >
                    <option value="">-- Select a connection --</option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No saved connections. Please <button onClick={()=>setShowManager(true)} className="text-primary underline">create a connection</button> first.
                </div>
              )}
            </div>

            {/* Paths */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Paths</h4>
              <div>
                <label className="text-xs text-muted-foreground">Remote Path</label>
                <input
                  type="text"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  placeholder="/home/user/project"
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Local Target</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="Select local directory"
                    className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSelectLocalPath}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Sync Direction */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Initial Sync Direction</h4>
              <p className="text-xs text-muted-foreground">
                Choose the direction for the initial sync. After the first sync, auto-sync will always push local changes to remote.
              </p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={syncDirection === 'pull'}
                    onChange={() => setSyncDirection('pull')}
                    className="cursor-pointer"
                  />
                  <span className="text-sm font-medium">Pull (Remote → Local)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={syncDirection === 'push'}
                    onChange={() => setSyncDirection('push')}
                    className="cursor-pointer"
                  />
                  <span className="text-sm font-medium">Push (Local → Remote)</span>
                </label>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 space-y-1">
                <div>• <strong>Pull</strong>: Download files from remote server to local directory (default for new projects)</div>
                <div>• <strong>Push</strong>: Upload files from local directory to remote server</div>
                <div>• After initial sync, auto-sync will only push local changes to remote</div>
              </div>
            </div>

            {/* Git Init */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Git</h4>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={initGit} onChange={(e)=>setInitGit(e.target.checked)} />
                <span className="text-sm">Init local git after sync</span>
              </label>
              {initGit && (
                <label className="flex items-center gap-2 cursor-pointer pl-5">
                  <input type="checkbox" checked={commitAllFiles} onChange={(e)=>setCommitAllFiles(e.target.checked)} />
                  <span className="text-sm">Commit all files on first commit</span>
                </label>
              )}
            </div>

            {/* Auto Sync */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Auto Sync</h4>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableAutoSync}
                  onChange={(e)=>setEnableAutoSync(e.target.checked)}
                />
                <span className="text-sm">Enable auto sync after initial sync</span>
              </label>

              {enableAutoSync && (
                <div className="space-y-2 pl-5">
                  <div className="text-xs font-medium text-foreground">Sync Direction</div>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="autoSyncDirection"
                        checked={autoSyncDirection === 'local-priority'}
                        onChange={() => setAutoSyncDirection('local-priority')}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">Local Priority (Push Only)</div>
                        <div className="text-xs text-muted-foreground">
                          Only push local changes to remote. Remote changes are ignored.
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="autoSyncDirection"
                        checked={autoSyncDirection === 'bidirectional'}
                        onChange={() => setAutoSyncDirection('bidirectional')}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">Bidirectional (Two-Way Sync)</div>
                        <div className="text-xs text-muted-foreground">
                          Sync both local and remote changes. Latest modification wins on conflict.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 mt-2">
                    Auto sync monitors file changes with a 2-second debounce to prevent excessive syncing.
                  </div>
                </div>
              )}
            </div>

            {/* Options */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Skip Folders</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipGit}
                    onChange={(e) => setSkipGit(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <span className="text-sm">Skip .git folder</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipRopcode}
                    onChange={(e) => setSkipRopcode(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <span className="text-sm">Skip .ropcode folder</span>
                </label>
              </div>

              {/* Custom Skip Patterns */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Custom Patterns</label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleAddCustomPattern}
                    className="h-6 px-2"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                {/* Examples */}
                <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                  Examples: <code className="text-[10px]">*.log</code>, <code className="text-[10px]">dist</code>, <code className="text-[10px]">target</code>, <code className="text-[10px]">*.tmp</code>
                </div>

                {/* Custom pattern inputs */}
                {customSkipPatterns.length > 0 && (
                  <div className="space-y-1.5">
                    {customSkipPatterns.map((pattern, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="text"
                          value={pattern}
                          onChange={(e) => handleCustomPatternChange(index, e.target.value)}
                          placeholder="e.g., *.log or build/"
                          className="flex-1 px-2 py-1.5 text-sm border rounded-md bg-background"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveCustomPattern(index)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-md">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 p-6 pt-4 border-t">
          {!syncing && (
            <>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSync}>
                Connect & Sync
              </Button>
            </>
          )}
          {syncing && progress?.stage === 'completed' && (
            <Button onClick={onClose}>
              Done
            </Button>
          )}
        </div>
        <SSHConnectionsManager
          isOpen={showManager}
          onClose={()=> setShowManager(false)}
          onChanged={async()=>{ try { const list = await api.listGlobalSshConnections(); setPresets(list||[]);} catch {} }}
        />
      </div>
    </div>
  );
};
