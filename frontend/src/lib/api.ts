/**
 * Wails API Adapter - Complete API Layer
 *
 * This module provides a comprehensive Tauri-compatible API that adapts to Wails backend.
 * It maintains the same interface as the original Tauri api.ts to enable seamless frontend migration.
 *
 * Implementation Status:
 * - ✓ Implemented: Full working implementation in Go backend  
 * - ⚠ Stub: Logs warning and returns placeholder data
 */

import * as App from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff, EventsEmit } from '../../wailsjs/runtime/runtime';
import type { HooksConfiguration } from '@/types/hooks';

/** Process type for tracking in ProcessRegistry */
export type ProcessType =
  | { AgentRun: { agent_id: number; agent_name: string } }
  | { ClaudeSession: { session_id: string } };

/** Information about a running process */
export interface ProcessInfo {
  run_id: number;
  process_type: ProcessType;
  pid: number;
  started_at: string;
  project_path: string;
  task: string;
  model: string;
}

/** Lightweight message metadata for indexing */
export interface MessageIndex {
  line_number: number;
  byte_offset: number;
  byte_length: number;
  timestamp?: string;
  message_type?: string;
}

/**
 * Represents a project in the ~/.claude/projects directory
 */
export interface Project {
  /** The project ID (derived from the directory name) */
  id: string;
  /** The original project path (decoded from the directory name) */
  path: string;
  /** List of session IDs (JSONL file names without extension) */
  sessions: string[];
  /** Unix timestamp when the project directory was created */
  created_at: number;
  /** Unix timestamp of the most recent session (if any) */
  most_recent_session?: number;
  /** Optional list of workspaces for this project */
  workspaces?: ProjectIndex[];
  /** Last used provider ID */
  last_provider?: string;
  /** Provider-specific paths and IDs (for session_id access) */
  providers?: ProjectProvider[];
  /** Project type: default | ssh */
  project_type?: string;
  /** Whether the project has git support (detected via git2) */
  has_git_support?: boolean;
  /** SSH remote path */
  ssh_remote_path?: string;
  /** SSH connection name */
  ssh_connection_name?: string;
}

/**
 * Represents a provider-specific project path entry
 */
export interface ProjectProvider {
  /** Provider ID (e.g., "claude", "codex") */
  provider_id: string;
  /** The project path for this provider */
  path: string;
  /** Provider-specific project ID */
  id: string;
  /** Optional provider API configuration ID to use for this provider */
  provider_api_id?: string;
  /** Active session ID for this provider (optional) */
  session_id?: string;
}

/**
 * SSH authentication method
 */
export type SSHAuthMethod =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; keyPath: string; passphrase?: string };

/**
 * Configuration for SSH connection and project sync
 */
export interface SSHConfig {
  /** SSH server host */
  host: string;
  /** SSH server port (default: 22) */
  port: number;
  /** SSH username */
  username: string;
  /** Authentication method */
  authMethod: SSHAuthMethod;
  /** Remote project path */
  remotePath: string;
  /** Local target path */
  localPath: string;
  /** Patterns to skip during sync (e.g., [".git", "node_modules"]) */
  skipPatterns: string[];
  /** Optional connection name selected from presets */
  connectionName?: string;
  /** Sync direction for initial sync: 'pull' (remote→local) or 'push' (local→remote). Default: 'pull' */
  syncDirection?: 'pull' | 'push';
  /** Auto sync direction: 'local-priority' (push only) or 'bidirectional' (two-way sync). Default: 'local-priority' */
  autoSyncDirection?: 'local-priority' | 'bidirectional';
}

/**
 * Progress information for SSH sync operation
 */
export interface SSHSyncProgress {
  /** Current stage of the sync process */
  stage: 'connecting' | 'authenticating' | 'downloading' | 'completed' | 'error';
  /** Progress percentage (0-100) */
  percentage: number;
  /** Number of files processed */
  filesProcessed: number;
  /** Total number of files */
  totalFiles: number;
  /** Bytes downloaded */
  bytesDownloaded: number;
  /** Total bytes to download */
  totalBytes: number;
  /** Current file being processed */
  currentFile?: string;
  /** Error message if stage is 'error' */
  error?: string;
  /** Operation direction for current file */
  direction?: 'download' | 'upload';
  /** Sync session id for control */
  syncId?: string;
  /** Whether current state is paused */
  isPaused?: boolean;
  /** Local project path this sync operates on */
  projectPath?: string;
}

/**
 * Auto sync status for a project
 */
export interface AutoSyncStatus {
  /** Project ID */
  projectId: string;
  /** Whether auto sync is currently running */
  isRunning: boolean;
  /** Unix timestamp of last successful sync */
  lastSyncTime?: number;
  /** Error message if any */
  error?: string;
}

/**
 * Configuration for Git clone operation
 */
export interface GitCloneConfig {
  /** Repository URL (HTTPS or SSH) */
  url: string;
  /** Local path to clone into */
  localPath: string;
  /** Optional branch to checkout */
  branch?: string;
}

/**
 * Progress information for Git clone operation
 */
export interface GitCloneProgress {
  /** Current stage of the clone process */
  stage: 'initializing' | 'cloning' | 'resolving' | 'completed' | 'error';
  /** Progress percentage (0-100) */
  percentage: number;
  /** Number of objects received */
  objectsReceived: number;
  /** Total number of objects */
  totalObjects: number;
  /** Bytes received */
  bytesReceived: number;
  /** Current operation description */
  currentOperation?: string;
  /** Error message if stage is 'error' */
  error?: string;
}

/**
 * Represents a provider API configuration (e.g., different Anthropic API endpoints)
 */
export interface ProviderApiConfig {
  /** Unique identifier for this API configuration */
  id: string;
  /** Display name for this API configuration */
  name: string;
  /** Provider this API configuration belongs to (e.g., "claude") */
  provider_id: string;
  /** API endpoint base URL (non-environment variable) */
  base_url?: string;
  /** API authentication token (non-environment variable, will be passed as env var when needed) */
  auth_token?: string;
  /** Whether this is the default API for this provider */
  is_default: boolean;
  /** Whether this is a built-in configuration (cannot be deleted) */
  is_builtin: boolean;
  /** Created timestamp */
  created_at: any;
  /** Last updated timestamp */
  updated_at: any;
}

/**
 * Represents an action (script/command) that can be executed
 */
export interface Action {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Command to execute (for script actions) or URL to open (for web actions) */
  command: string;
  /** Optional description */
  description?: string;
  /** Optional icon (emoji or lucide icon name) */
  icon?: string;
  /** Action type: "global", "project" or "workspace" */
  type: 'global' | 'project' | 'workspace';
  /** Whether this action is shared (only for project-level actions) */
  shared?: boolean;
  /** Optional keyboard shortcut */
  shortcut?: string;
  /** Action execution type: "script" (run command) or "web" (open webview) */
  actionType?: 'script' | 'web';
}

/**
 * Represents a workspace with provider support
 */
export interface WorkspaceIndex {
  /** Workspace name */
  name: string;
  /** Unix timestamp when the workspace was added to index */
  added_at: number;
  /** Provider-specific paths and IDs for this workspace */
  providers: ProjectProvider[];
  /** The last used provider ID */
  last_provider: string;
  /** Git branch name for this workspace */
  branch?: string;
  /** Workspace-specific actions */
  actions?: Action[];
}

/**
 * Represents a project index entry stored in ~/.ropcode/projects.json
 */
export interface ProjectIndex {
  /** The project display name (extracted from path) */
  name: string;
  /** Unix timestamp when the project was added to index */
  added_at: number;
  /** Unix timestamp of the most recent access */
  last_accessed: number;
  /** Optional description or tags */
  description?: string;
  /** Whether this project is currently available */
  available: boolean;
  /** Provider-specific paths and IDs */
  providers: ProjectProvider[];
  /** List of workspaces for this project */
  workspaces: WorkspaceIndex[];
  /** The last used provider ID */
  last_provider: string;
  /** Optional branch name (if this is a workspace) */
  branch?: string;
  /** Project-level actions */
  actions?: Action[];
  /** Saved SSH connections for this project */
  ssh_configs?: any[];
  /** Project type: default | ssh */
  project_type?: string;
  /** Whether the project has git support (detected via git2) */
  has_git_support?: boolean;
  /** SSH remote path (if SSH project) */
  ssh_remote_path?: string;
  /** SSH connection name (if SSH project) */
  ssh_connection_name?: string;
}

/**
 * Represents a session with its metadata
 */
export interface Session {
  /** The session ID (UUID) */
  id: string;
  /** The project ID this session belongs to */
  project_id: string;
  /** The project path */
  project_path: string;
  /** Optional todo data associated with this session */
  todo_data?: any;
  /** Unix timestamp when the session file was created */
  created_at: number;
  /** First user message content (if available) */
  first_message?: string;
  /** Timestamp of the first user message (if available) */
  message_timestamp?: string;
}

/**
 * Represents the settings from ~/.claude/settings.json
 */
export interface ClaudeSettings {
  [key: string]: any;
}

/**
 * Represents the Claude Code version status
 */
export interface ClaudeVersionStatus {
  /** Whether Claude Code is installed and working */
  is_installed: boolean;
  /** The version string if available */
  version?: string;
  /** The full output from the command */
  output: string;
}

/**
 * Represents a CLAUDE.md file found in the project
 */
export interface ClaudeMdFile {
  /** Relative path from the project root */
  relative_path: string;
  /** Absolute path to the file */
  absolute_path: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: number;
}

/**
 * Represents a file, directory, or agent entry
 */
export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  extension?: string;
  entry_type?: string; // "file" or "agent"
  agent_id?: number; // Only present when entry_type is "agent"
  icon?: string; // Only present when entry_type is "agent"
  color?: string; // Only present when entry_type is "agent" - color from agent frontmatter
}

/**
 * Represents a Claude installation found on the system
 */
export interface ClaudeInstallation {
  /** Full path to the Claude binary */
  path: string;
  /** Version string if available */
  version?: string;
  /** Source of discovery (e.g., "nvm", "system", "homebrew", "which") */
  source: string;
  /** Type of installation */
  installation_type: string;
}

// Agent API types (CC Agents - stored in SQLite)
export interface Agent {
  id?: number;
  name: string;
  icon: string;
  system_prompt: string;
  default_task?: string;
  model: string;
  provider_api_id?: string; // Optional provider API configuration ID
  hooks?: string; // JSON string of HooksConfiguration
  created_at: string;
  updated_at: string;
}

// Claude Agent types (Claude Code agents - stored in ~/.claude/agents/*.md)
export interface ClaudeAgent {
  /** Agent name (unique identifier) */
  name: string;
  /** Agent description */
  description: string;
  /** Optional tools list (comma-separated) */
  tools?: string;
  /** Optional color */
  color?: string;
  /** Optional model */
  model?: string;
  /** System prompt (Markdown content) */
  system_prompt: string;
  /** Scope: "user" or "project" */
  scope: string;
  /** Full file path */
  file_path: string;
}

// Plugin types

/** Plugin author information */
export interface PluginAuthor {
  name: string;
  email?: string;
}

/** Plugin metadata from .claude-plugin/plugin.json */
export interface PluginMetadata {
  name: string;
  description?: string;
  version?: string;
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

/** Installed plugin information */
export interface InstalledPlugin {
  /** Plugin identifier (e.g., "superpowers@superpowers-marketplace") */
  id: string;
  /** Short name (e.g., "superpowers") */
  name?: string;
  /** Marketplace name (e.g., "superpowers-marketplace") */
  marketplace?: string;
  version?: string;
  installed_at?: string;
  last_updated?: string;
  install_path: string;
  git_commit_sha?: string;
  is_local?: boolean;
  enabled?: boolean;
  /** Plugin metadata from plugin.json */
  metadata?: PluginMetadata;
}

/** Plugin agent (from plugin's agents/*.md) */
export interface PluginAgent {
  name: string;
  description: string;
  tools?: string;
  color?: string;
  model?: string;
  /** Instructions/system prompt for the agent */
  instructions: string;
  plugin_id: string;
  plugin_name: string;
  file_path: string;
}

/** Plugin command (from plugin's commands/*.md) */
export interface PluginCommand {
  name: string;
  description?: string;
  allowed_tools?: string[];
  content: string;
  plugin_id: string;
  plugin_name: string;
  file_path: string;
  /** Full command with plugin prefix (e.g., "/superpowers:brainstorm") */
  full_command: string;
}

/** Plugin skill (from plugin's skills/[name]/SKILL.md) */
export interface PluginSkill {
  name: string;
  description?: string;
  content: string;
  plugin_id: string;
  plugin_name: string;
  folder_path: string;
}

/** Plugin hook configuration */
export interface PluginHook {
  event_type: string;
  matcher?: string;
  command: string;
  plugin_id: string;
  plugin_name: string;
}

/** Full plugin contents */
export interface PluginContents {
  plugin: InstalledPlugin;
  agents: PluginAgent[];
  commands: PluginCommand[];
  skills: PluginSkill[];
  hooks: PluginHook[];
}

export interface AgentExport {
  version: number;
  exported_at: string;
  agent: {
    name: string;
    icon: string;
    system_prompt: string;
    default_task?: string;
    model: string;
    hooks?: string;
  };
}

export interface GitHubAgentFile {
  name: string;
  path: string;
  download_url: string;
  size: number;
  sha: string;
}

export interface AgentRun {
  id?: number;
  agent_id: number;
  agent_name: string;
  agent_icon: string;
  task: string;
  model: string;
  project_path: string;
  session_id: string;
  status: string; // 'pending', 'running', 'completed', 'failed', 'cancelled'
  pid?: number;
  process_started_at?: string;
  created_at: string;
  completed_at?: string;
}

export interface AgentRunMetrics {
  duration_ms?: number;
  total_tokens?: number;
  cost_usd?: number;
  message_count?: number;
}

export interface AgentRunWithMetrics {
  id?: number;
  agent_id: number;
  agent_name: string;
  agent_icon: string;
  task: string;
  model: string;
  project_path: string;
  session_id: string;
  status: string; // 'pending', 'running', 'completed', 'failed', 'cancelled'
  pid?: number;
  duration_ms?: number;
  total_tokens?: number;
  process_started_at?: string;
  created_at: string;
  completed_at?: string;
  metrics?: AgentRunMetrics;
  output?: string; // Real-time JSONL content
}

// Usage Dashboard types
export interface UsageEntry {
  project: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost: number;
}

export interface ModelUsage {
  model: string;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  session_count: number;
  // Optional extended fields
  total_cost?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
}

export interface DailyUsage {
  date: string;
  total_tokens: number;
  models_used: string[];
  // Optional extended field
  total_cost?: number;
}

export interface ProjectUsage {
  project_path: string;
  project_name: string;
  total_cost: number;
  total_tokens: number;
  session_count: number;
  last_used: string;
  // Fields from SessionDetail (when used for session stats)
  last_activity?: string;
  session_id?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  start_time?: string;
  message_count?: number;
}

export interface UsageStats {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_sessions: number;
  by_model: ModelUsage[];
  by_day: DailyUsage[];
  // Optional extended fields
  total_cost?: number;
  total_cache_creation_tokens?: number;
  total_cache_read_tokens?: number;
  by_date?: DailyUsage[];
  by_project?: ProjectUsage[];
}

/**
 * Represents a checkpoint in the session timeline
 */
export interface Checkpoint {
  id: string;
  sessionId: string;
  projectId: string;
  messageIndex: number;
  timestamp: string;
  description?: string;
  parentCheckpointId?: string;
  metadata: CheckpointMetadata;
}

/**
 * Metadata associated with a checkpoint
 */
export interface CheckpointMetadata {
  totalTokens: number;
  modelUsed: string;
  userPrompt: string;
  fileChanges: number;
  snapshotSize: number;
}

/**
 * Represents a file snapshot at a checkpoint
 */
export interface FileSnapshot {
  checkpointId: string;
  filePath: string;
  content: string;
  hash: string;
  isDeleted: boolean;
  permissions?: number;
  size: number;
}

/**
 * Represents a node in the timeline tree
 */
export interface TimelineNode {
  checkpoint: Checkpoint;
  children: TimelineNode[];
  fileSnapshotIds: string[];
}

/**
 * The complete timeline for a session
 */
export interface SessionTimeline {
  session_id: string;
  root_node?: TimelineNode;
  current_checkpoint_id?: string;
  total_checkpoints: number;
  // Optional fields for UI compatibility
  sessionId?: string;
  rootNode?: TimelineNode;
  currentCheckpointId?: string;
  autoCheckpointEnabled?: boolean;
  checkpointStrategy?: CheckpointStrategy;
  totalCheckpoints?: number;
}

/**
 * Strategy for automatic checkpoint creation
 */
export type CheckpointStrategy = 'manual' | 'per_prompt' | 'per_tool_use' | 'smart';

/**
 * Configuration for checkpoint behavior
 */
export interface CheckpointConfig {
  auto_checkpoint_enabled: boolean;
  checkpoint_strategy: string;
  max_checkpoints: number;
  checkpoint_interval: number;
}

/**
 * Result of a checkpoint operation
 */
export interface CheckpointResult {
  checkpoint?: Checkpoint;
  files_processed: number;
  warnings?: string[];
  // Optional fields for UI compatibility
  filesProcessed?: number;
}

/**
 * Diff between two checkpoints
 */
export interface CheckpointDiff {
  from_checkpoint_id?: string;
  to_checkpoint_id?: string;
  modified_files?: FileDiff[];
  added_files?: string[];
  deleted_files?: string[];
  // Backwards compatibility
  fromCheckpointId?: string;
  toCheckpointId?: string;
  modifiedFiles?: FileDiff[];
  addedFiles?: string[];
  deletedFiles?: string[];
  tokenDelta?: number;
}

/**
 * Diff for a single file
 */
export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  diffContent?: string;
}

/**
 * Represents an MCP server configuration
 */
export interface MCPServer {
  /** Server name/identifier */
  name: string;
  /** Transport type: "stdio" or "sse" */
  transport: string;
  /** Command to execute (for stdio) */
  command?: string;
  /** Command arguments (for stdio) */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** URL endpoint (for SSE) */
  url?: string;
  /** Configuration scope: "local", "project", or "user" */
  scope: string;
  /** Whether the server is currently active */
  is_active: boolean;
  /** Server status */
  status: ServerStatus;
}

/**
 * Server status information
 */
export interface ServerStatus {
  /** Whether the server is running */
  running: boolean;
  /** Last error message if any */
  error?: string;
  /** Last checked timestamp */
  last_checked?: number;
}

/**
 * MCP configuration for project scope (.mcp.json)
 */
export interface MCPProjectConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Individual server configuration in .mcp.json
 */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/**
 * Command type: "claude" or "codex"
 */
export type CommandType = "claude" | "codex" | "gemini";

/**
 * Represents a custom slash command
 */
export interface SlashCommand {
  /** Unique identifier for the command */
  id: string;
  /** Command type: "claude" or "codex" */
  command_type: CommandType;
  /** Command name (without prefix) */
  name: string;
  /** Full command with prefix (e.g., "/project:optimize") */
  full_command: string;
  /** Command scope: "project", "user", or "plugin" */
  scope: string;
  /** Optional namespace (e.g., "frontend" in "/project:frontend:component") */
  namespace?: string;
  /** Path to the markdown file */
  file_path: string;
  /** Command content (markdown body) */
  content: string;
  /** Optional description from frontmatter */
  description?: string;
  /** Allowed tools from frontmatter (Claude only) */
  allowed_tools: string[];
  /** Argument hint from frontmatter (Codex only) */
  argument_hint?: string;
  /** Whether the command has bash commands (!) */
  has_bash_commands: boolean;
  /** Whether the command has file references (@) */
  has_file_references: boolean;
  /** Whether the command uses $ARGUMENTS placeholder */
  accepts_arguments: boolean;
  /** Plugin ID if command is from a plugin (e.g., "superpowers@superpowers-marketplace") */
  plugin_id?: string;
  /** Plugin name if command is from a plugin (e.g., "superpowers") */
  plugin_name?: string;
}

/**
 * Skill scope: plugin, user, or project
 */
export type SkillScope = "plugin" | "user" | "project";

/**
 * Represents a skill from any source (plugin, user, or project)
 */
export interface Skill {
  /** Unique identifier (e.g., "plugin:superpowers:brainstorming" or "user:my-skill") */
  id: string;
  /** Skill name (e.g., "brainstorming") */
  name: string;
  /** Full skill reference for display (e.g., ":superpowers:brainstorming") */
  full_name: string;
  /** Skill description */
  description?: string;
  /** Skill scope: plugin, user, or project */
  scope: SkillScope;
  /** Plugin ID if from a plugin (e.g., "superpowers@superpowers-marketplace") */
  plugin_id?: string;
  /** Plugin name if from a plugin (e.g., "superpowers") */
  plugin_name?: string;
  /** Path to the skill folder or file */
  path: string;
  /** Skill content (markdown body) */
  content: string;
  /** Allowed tools from frontmatter */
  allowed_tools: string[];
}

/**
 * Result of adding a server
 */
export interface AddServerResult {
  success: boolean;
  message: string;
  server_name?: string;
}

/**
 * Import result for multiple servers
 */
export interface ImportResult {
  imported_count: number;
  failed_count: number;
  servers: ImportServerResult[];
}

/**
 * Result for individual server import
 */
export interface ImportServerResult {
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Worktree information from Git
 */
export interface WorktreeInfo {
  /** 当前工作目录 (子路径) */
  currentPath: string;
  /** Git 仓库根路径 (主 worktree) */
  rootPath: string;
  /** 母分支名称 */
  mainBranch: string;
  /** 是否为 worktree 子分支 */
  isWorktreeChild: boolean;
  /** Alias for isWorktreeChild (from Go backend) */
  is_worktree?: boolean;
}

/**
 * API client for interacting with the Rust backend
 */
// ==================== Helper Functions ====================

/**
 * Helper to log stub warnings
 */
function logStub(functionName: string): void {
  console.warn(`[STUB] ${functionName} is not yet implemented in Wails backend`);
}

/**
 * Helper to create stub promise
 */
function stubPromise<T>(functionName: string, defaultValue: T): Promise<T> {
  logStub(functionName);
  return Promise.resolve(defaultValue);
}

// ==================== Event Helpers ====================

/**
 * Tauri-compatible event listener
 */
export function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): () => void {
  EventsOn(event, handler);
  return () => {
    EventsOff(event);
  };
}

/**
 * Emit an event
 */
export function emit(event: string, payload?: any): void {
  EventsEmit(event, payload);
}

// ==================== Main API Object ====================

export const api = {
  // Note: This is a comprehensive adapter. Functions marked with ✓ are fully implemented,
  // others are stubs that return safe default values and log warnings.

  // Window Management (✓ Implemented - uses CGO for native macOS fullscreen)
  async toggleFullscreen(): Promise<void> {
    return App.ToggleFullscreen();
  },

  async isFullscreen(): Promise<boolean> {
    return App.IsFullscreen();
  },

  // PTY Terminal (✓ Fully Implemented)
  async createPtySession(
    sessionId: string,
    cwd?: string,
    rows?: number,
    cols?: number,
    shell?: string
  ): Promise<any> {
    return App.CreatePtySession(sessionId, cwd || '', rows || 24, cols || 80, shell || '');
  },

  async writeToPty(sessionId: string, data: string): Promise<void> {
    return App.WriteToPty(sessionId, data);
  },

  async resizePty(sessionId: string, rows: number, cols: number): Promise<void> {
    return App.ResizePty(sessionId, rows, cols);
  },

  async closePtySession(sessionId: string): Promise<void> {
    return App.ClosePtySession(sessionId);
  },

  async listPtySessions(): Promise<string[]> {
    return App.ListPtySessions();
  },

  // Process Management (✓ Partially Implemented)
  async spawnProcess(key: string, command: string, args: string[], cwd: string, env: string[]): Promise<any> {
    return App.SpawnProcess(key, command, args, cwd, env);
  },

  async killProcess(key: string): Promise<void> {
    return App.KillProcess(key);
  },

  async isProcessAlive(key: string): Promise<boolean> {
    return App.IsProcessAlive(key);
  },

  async listProcesses(): Promise<string[]> {
    return App.ListProcesses();
  },

  // Database/Settings (✓ Implemented)
  async getSetting(key: string): Promise<string | null> {
    try {
      const value = await App.GetSetting(key);
      return value || null;
    } catch {
      return null;
    }
  },

  async saveSetting(key: string, value: string): Promise<void> {
    await App.SaveSetting(key, value);
  },

  async getProviderApiConfig(id: string): Promise<any> {
    return App.GetProviderApiConfig(id);
  },

  async getAllProviderApiConfigs(): Promise<any[]> {
    return App.GetAllProviderApiConfigs();
  },

  async deleteProviderApiConfig(id: string): Promise<void> {
    return App.DeleteProviderApiConfig(id);
  },

  async listProviderApiConfigs(): Promise<any[]> {
    return App.GetAllProviderApiConfigs();
  },

  // Checkpoints (✓ Implemented)
  async createCheckpoint(projectId: string, sessionId: string, checkpoint: any, files: any[], messages: string): Promise<any> {
    return App.CreateCheckpoint(projectId, sessionId, checkpoint, files, messages);
  },

  async loadCheckpoint(projectId: string, sessionId: string, checkpointId: string): Promise<any> {
    return App.LoadCheckpoint(projectId, sessionId, checkpointId);
  },

  async listCheckpoints(projectId: string, sessionId: string): Promise<any[]> {
    return App.ListCheckpoints(projectId, sessionId);
  },

  async deleteCheckpoint(projectId: string, sessionId: string, checkpointId: string): Promise<void> {
    return App.DeleteCheckpoint(projectId, sessionId, checkpointId);
  },

  async generateCheckpointId(): Promise<string> {
    return App.GenerateCheckpointID();
  },

  // Config
  async getConfig(): Promise<Record<string, string>> {
    return App.GetConfig();
  },

  // Stub implementations for all other functions
  // These maintain the API contract but don't yet have backend implementations

  // Home Directory (✓ Implemented)
  async getHomeDirectory(): Promise<string> {
    return App.GetHomeDirectory();
  },

  // Project Index (✓ Implemented)
  // Returns Project[] to maintain compatibility with ProjectList component
  async listProjects(): Promise<Project[]> {
    const projectIndexes = await App.ListProjects();
    if (!projectIndexes) return [];

    // Convert ProjectIndex to Project format
    return projectIndexes.map((pi: ProjectIndex) => {
      const primaryProvider = pi.providers?.[0];
      // Use provider.path as the actual filesystem path (absolute path)
      const path = primaryProvider?.path;
      const id = primaryProvider?.id || pi.name;

      // Convert workspaces to ProjectIndex format expected by Project.workspaces
      const workspaces: ProjectIndex[] = (pi.workspaces || []).map(ws => ({
        name: ws.name,
        added_at: ws.added_at,
        last_accessed: ws.added_at,
        available: true,
        providers: ws.providers,
        workspaces: [],
        last_provider: ws.last_provider,
        branch: ws.branch
      }));

      return {
        id,
        path,
        sessions: [],
        created_at: pi.added_at,
        most_recent_session: pi.last_accessed,
        workspaces,
        last_provider: pi.last_provider,
        providers: pi.providers?.map(p => ({
          provider_id: p.provider_id,
          path: p.path,
          id: p.id,
          provider_api_id: p.provider_api_id
        })),
        project_type: pi.project_type,
        has_git_support: pi.has_git_support ?? false
      } as Project;
    });
  },

  async addProjectToIndex(path: string): Promise<void> {
    return App.AddProjectToIndex(path);
  },

  async removeProjectFromIndex(id: string): Promise<void> {
    return App.RemoveProjectFromIndex(id);
  },

  async updateProjectAccessTime(id: string): Promise<void> {
    return App.UpdateProjectAccessTime(id);
  },

  async addProviderToProject(path: string, provider: string): Promise<void> {
    return App.AddProviderToProject(path, provider);
  },

  async updateProjectLastProvider(path: string, provider: string): Promise<void> {
    return App.UpdateProjectLastProvider(path, provider);
  },

  async updateWorkspaceLastProvider(path: string, provider: string): Promise<void> {
    return App.UpdateWorkspaceLastProvider(path, provider);
  },

  async updateProviderSession(path: string, provider: string, session: string): Promise<void> {
    return App.UpdateProviderSession(path, provider, session);
  },

  async updateProjectFields(path: string, updates: any): Promise<void> {
    return App.UpdateProjectFields(path, updates);
  },

  async updateWorkspaceFields(path: string, updates: any): Promise<void> {
    return App.UpdateWorkspaceFields(path, updates);
  },

  async createProject(path: string): Promise<Project> {
    await App.CreateProject(path);
    const name = path.split('/').pop() || 'project';
    return {
      id: name,
      path,
      sessions: [],
      created_at: Date.now()
    };
  },

  async getProjectSessions(id: string): Promise<string[]> {
    return App.GetProjectSessions(id);
  },

  async createWorkspace(parent: string, branch: string, name?: string): Promise<ProjectIndex> {
    await App.CreateWorkspace(parent, branch, name || '');
    return {
      name: name || branch,
      added_at: Date.now(),
      last_accessed: Date.now(),
      available: true,
      providers: [],
      workspaces: [],
      last_provider: 'claude'
    };
  },

  async removeWorkspace(id: string): Promise<void> {
    return App.RemoveWorkspace(id);
  },
  async fetchGitHubAgents(): Promise<GitHubAgentFile[]> {
    const agents = await App.FetchGitHubAgents();
    return agents || [];
  },
  async fetchGitHubAgentContent(url: string): Promise<AgentExport> {
    return App.FetchGitHubAgentContent(url);
  },
  async importAgentFromGitHub(url: string): Promise<Agent> {
    return App.ImportAgentFromGitHub(url);
  },

  // Claude Config Agents (✓ Implemented)
  async listClaudeConfigAgents(projectPath?: string): Promise<ClaudeAgent[]> {
    const agents = await App.ListClaudeConfigAgents(projectPath || '');
    return agents || [];
  },

  async getClaudeAgent(scope: string, name: string, projectPath?: string): Promise<ClaudeAgent | null> {
    try {
      const agent = await App.GetClaudeConfigAgent(scope, name, projectPath || '');
      return agent || null;
    } catch {
      return null;
    }
  },

  async saveClaudeAgent(agent: ClaudeAgent, projectPath?: string): Promise<void> {
    return App.SaveClaudeConfigAgent(agent, projectPath || '');
  },

  async deleteClaudeAgent(scope: string, name: string, projectPath?: string): Promise<void> {
    return App.DeleteClaudeConfigAgent(scope, name, projectPath || '');
  },

  // Plugin System (✓ Implemented)
  async listInstalledPlugins(): Promise<InstalledPlugin[]> {
    const plugins = await App.ListInstalledPlugins();
    return (plugins || []).map(p => ({
      id: p.id,
      name: p.metadata?.name || p.id.split('@')[0],
      marketplace: p.id.includes('@') ? p.id.split('@')[1] : undefined,
      version: p.metadata?.version || '0.0.0',
      installed_at: p.installed_at,
      last_updated: p.installed_at,
      install_path: p.install_path,
      is_local: false,
      metadata: p.metadata,
    }));
  },

  async getPluginDetails(id: string): Promise<InstalledPlugin | null> {
    try {
      const p = await App.GetPluginDetails(id);
      if (!p) return null;
      return {
        id: p.id,
        name: p.metadata?.name || p.id.split('@')[0],
        marketplace: p.id.includes('@') ? p.id.split('@')[1] : undefined,
        version: p.metadata?.version || '0.0.0',
        installed_at: p.installed_at,
        last_updated: p.installed_at,
        install_path: p.install_path,
        is_local: false,
        metadata: p.metadata,
      };
    } catch {
      return null;
    }
  },

  async listPluginAgents(pluginId?: string): Promise<PluginAgent[]> {
    if (!pluginId) {
      const plugins = await App.ListInstalledPlugins();
      const allAgents: PluginAgent[] = [];
      for (const plugin of plugins || []) {
        const agents = await App.ListPluginAgents(plugin.id);
        allAgents.push(...(agents || []));
      }
      return allAgents;
    }
    const agents = await App.ListPluginAgents(pluginId);
    return agents || [];
  },

  async listPluginCommands(pluginId?: string): Promise<PluginCommand[]> {
    if (!pluginId) {
      const plugins = await App.ListInstalledPlugins();
      const allCommands: PluginCommand[] = [];
      for (const plugin of plugins || []) {
        const commands = await App.ListPluginCommands(plugin.id);
        allCommands.push(...(commands || []));
      }
      return allCommands;
    }
    const commands = await App.ListPluginCommands(pluginId);
    return commands || [];
  },

  async listPluginSkills(pluginId?: string): Promise<PluginSkill[]> {
    if (!pluginId) {
      const plugins = await App.ListInstalledPlugins();
      const allSkills: PluginSkill[] = [];
      for (const plugin of plugins || []) {
        const skills = await App.ListPluginSkills(plugin.id);
        allSkills.push(...(skills || []));
      }
      return allSkills;
    }
    const skills = await App.ListPluginSkills(pluginId);
    return skills || [];
  },

  async listPluginHooks(pluginId?: string): Promise<PluginHook[]> {
    if (!pluginId) {
      const plugins = await App.ListInstalledPlugins();
      const allHooks: PluginHook[] = [];
      for (const plugin of plugins || []) {
        const hooks = await App.ListPluginHooks(plugin.id);
        allHooks.push(...(hooks || []));
      }
      return allHooks;
    }
    const hooks = await App.ListPluginHooks(pluginId);
    return hooks || [];
  },

  async getPluginAgent(pluginId: string, agentName: string): Promise<PluginAgent | null> {
    try {
      return await App.GetPluginAgent(pluginId, agentName);
    } catch {
      return null;
    }
  },

  async getPluginCommand(pluginId: string, commandName: string): Promise<PluginCommand | null> {
    try {
      return await App.GetPluginCommand(pluginId, commandName);
    } catch {
      return null;
    }
  },

  async getPluginSkill(pluginId: string, skillName: string): Promise<PluginSkill | null> {
    try {
      return await App.GetPluginSkill(pluginId, skillName);
    } catch {
      return null;
    }
  },

  async getPluginContents(id: string): Promise<PluginContents> {
    const contents = await App.GetPluginContents(id);
    if (!contents) {
      return {
        plugin: {
          id,
          name: id.split('@')[0],
          version: '0.0.0',
          installed_at: '',
          last_updated: '',
          install_path: '',
          is_local: false,
        },
        agents: [],
        commands: [],
        skills: [],
        hooks: [],
      };
    }
    return {
      plugin: {
        id: contents.plugin.id,
        name: contents.plugin.metadata?.name || contents.plugin.id.split('@')[0],
        marketplace: contents.plugin.id.includes('@') ? contents.plugin.id.split('@')[1] : undefined,
        version: contents.plugin.metadata?.version || '0.0.0',
        installed_at: contents.plugin.installed_at,
        last_updated: contents.plugin.installed_at,
        install_path: contents.plugin.install_path,
        is_local: false,
        metadata: contents.plugin.metadata,
      },
      agents: contents.agents || [],
      commands: contents.commands || [],
      skills: contents.skills || [],
      hooks: contents.hooks || [],
    };
  },

  // Claude Settings (✓ Implemented)
  async getClaudeSettings(): Promise<ClaudeSettings> {
    const settings = await App.GetClaudeSettings();
    return settings || {};
  },
  async openNewSession(path?: string): Promise<string> {
    return App.OpenNewSession(path || '');
  },
  async getSystemPrompt(): Promise<string> {
    return App.GetSystemPrompt();
  },
  async checkClaudeVersion(): Promise<ClaudeVersionStatus> {
    return App.CheckClaudeVersion();
  },
  async saveSystemPrompt(content: string): Promise<void> {
    return App.SaveSystemPrompt(content);
  },
  async getProviderSystemPrompt(provider: string): Promise<string> {
    return App.GetProviderSystemPrompt(provider);
  },

  async saveProviderSystemPrompt(provider: string, content: string): Promise<string> {
    return App.SaveProviderSystemPrompt(provider, content);
  },
  async saveClaudeSettings(settings: ClaudeSettings): Promise<void> {
    return App.SaveClaudeSettings(settings);
  },
  async findClaudeMdFiles(projectPath: string): Promise<ClaudeMdFile[]> {
    const files = await App.FindClaudeMdFiles(projectPath);
    return files || [];
  },
  async readClaudeMdFile(path: string): Promise<string> {
    return App.ReadClaudeMdFile(path);
  },
  async saveClaudeMdFile(path: string, content: string): Promise<void> {
    return App.SaveClaudeMdFile(path, content);
  },
  // Agent CRUD (✓ Implemented)
  async listAgents(): Promise<Agent[]> {
    const agents = await App.ListAgents();
    return (agents || []).map(a => ({
      ...a,
      created_at: a.created_at || new Date().toISOString(),
      updated_at: a.updated_at || new Date().toISOString(),
    }));
  },
  async createAgent(name: string, icon: string, systemPrompt: string, defaultTask: string, model: string, providerApiId?: string, hooks?: string): Promise<Agent> {
    const id = await App.CreateAgent(name, icon, systemPrompt, defaultTask || '', model, providerApiId || '', hooks || '');
    return { id, name, icon, system_prompt: systemPrompt, default_task: defaultTask, model, provider_api_id: providerApiId, hooks, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  },
  async updateAgent(id: number, name: string, icon: string, systemPrompt: string, defaultTask: string, model: string, providerApiId?: string, hooks?: string): Promise<Agent> {
    await App.UpdateAgent(id, name, icon, systemPrompt, defaultTask || '', model, providerApiId || '', hooks || '');
    return { id, name, icon, system_prompt: systemPrompt, default_task: defaultTask, model, provider_api_id: providerApiId, hooks, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  },
  async deleteAgent(id: number): Promise<void> {
    return App.DeleteAgent(id);
  },
  async getAgent(id: number): Promise<Agent | null> {
    const agent = await App.GetAgent(id);
    if (!agent) return null;
    return {
      ...agent,
      created_at: agent.created_at || new Date().toISOString(),
      updated_at: agent.updated_at || new Date().toISOString(),
    };
  },
  async exportAgent(id: number): Promise<string> {
    return App.ExportAgent(id);
  },
  async exportAgentToFile(id: number, path: string): Promise<void> {
    return App.ExportAgentToFile(id, path);
  },
  async importAgent(data: string): Promise<Agent> {
    const agent = await App.ImportAgent(data);
    return {
      ...agent,
      created_at: agent.created_at || new Date().toISOString(),
      updated_at: agent.updated_at || new Date().toISOString(),
    };
  },
  async importAgentFromFile(path: string): Promise<Agent> {
    const agent = await App.ImportAgentFromFile(path);
    return {
      ...agent,
      created_at: agent.created_at || new Date().toISOString(),
      updated_at: agent.updated_at || new Date().toISOString(),
    };
  },
  // Agent Execution (✓ Implemented)
  async executeAgent(agentId: number, projectPath: string, task: string, model: string): Promise<AgentRun> {
    const run = await App.ExecuteAgent(agentId, projectPath, task, model);
    return {
      id: run.id,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      agent_icon: run.agent_icon || '',
      project_path: run.project_path,
      task: run.task,
      model: run.model,
      session_id: run.session_id || '',
      status: run.status,
      pid: run.pid,
      process_started_at: run.process_started_at,
      created_at: run.created_at || new Date().toISOString(),
      completed_at: run.completed_at,
    };
  },

  async listAgentRuns(agentId?: number): Promise<AgentRun[]> {
    const runs = await App.ListAgentRuns(agentId || 0, 50);
    return (runs || []).map(run => ({
      id: run.id,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      agent_icon: run.agent_icon || '',
      project_path: run.project_path,
      task: run.task,
      model: run.model,
      session_id: run.session_id || '',
      status: run.status,
      pid: run.pid,
      process_started_at: run.process_started_at,
      created_at: run.created_at || new Date().toISOString(),
      completed_at: run.completed_at,
    }));
  },

  async listAgentRunsWithMetrics(agentId?: number): Promise<AgentRunWithMetrics[]> {
    const runs = await App.ListAgentRuns(agentId || 0, 50);
    return (runs || []).map(run => ({
      id: run.id,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      agent_icon: run.agent_icon || '',
      project_path: run.project_path,
      task: run.task,
      model: run.model,
      session_id: run.session_id || '',
      status: run.status,
      pid: run.pid,
      process_started_at: run.process_started_at,
      created_at: run.created_at || new Date().toISOString(),
      completed_at: run.completed_at,
      metrics: undefined,
      output: undefined,
    }));
  },

  async getAgentRun(runId: number): Promise<{ run: AgentRun }> {
    const run = await App.GetAgentRun(runId);
    return {
      run: {
        id: run.id,
        agent_id: run.agent_id,
        agent_name: run.agent_name,
        agent_icon: run.agent_icon || '',
        project_path: run.project_path,
        task: run.task,
        model: run.model,
        session_id: run.session_id || '',
        status: run.status,
        pid: run.pid,
        process_started_at: run.process_started_at,
        created_at: run.created_at || new Date().toISOString(),
        completed_at: run.completed_at,
      }
    };
  },

  async getAgentRunWithRealTimeMetrics(runId: number): Promise<{ run: AgentRunWithMetrics }> {
    const run = await App.GetAgentRun(runId);
    const output = await App.GetAgentRunOutput(runId);
    return {
      run: {
        id: run.id,
        agent_id: run.agent_id,
        agent_name: run.agent_name,
        agent_icon: run.agent_icon || '',
        project_path: run.project_path,
        task: run.task,
        model: run.model,
        session_id: run.session_id || '',
        status: run.status,
        pid: run.pid,
        process_started_at: run.process_started_at,
        created_at: run.created_at || new Date().toISOString(),
        completed_at: run.completed_at,
        metrics: undefined,
        output: output || undefined,
      }
    };
  },

  async listRunningAgentSessions(): Promise<AgentRun[]> {
    const runs = await App.ListRunningAgentRuns();
    return (runs || []).map(run => ({
      id: run.id,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      agent_icon: run.agent_icon || '',
      project_path: run.project_path,
      task: run.task,
      model: run.model,
      session_id: run.session_id || '',
      status: run.status,
      pid: run.pid,
      process_started_at: run.process_started_at,
      created_at: run.created_at || new Date().toISOString(),
      completed_at: run.completed_at,
    }));
  },

  async killAgentSession(runId: number): Promise<boolean> {
    await App.CancelAgentRun(runId);
    return true;
  },

  async getSessionStatus(runId: number): Promise<AgentRun | null> {
    try {
      const run = await App.GetAgentRun(runId);
      if (!run) return null;
      return {
        id: run.id,
        agent_id: run.agent_id,
        agent_name: run.agent_name,
        agent_icon: run.agent_icon || '',
        project_path: run.project_path,
        task: run.task,
        model: run.model,
        session_id: run.session_id || '',
        status: run.status,
        pid: run.pid,
        process_started_at: run.process_started_at,
        created_at: run.created_at || new Date().toISOString(),
        completed_at: run.completed_at,
      };
    } catch {
      return null;
    }
  },

  async cleanupFinishedProcesses(): Promise<string[]> {
    const ids = await App.CleanupFinishedProcesses();
    return ids || [];
  },

  async getSessionOutput(runId: number): Promise<string> {
    return App.GetAgentRunOutput(runId);
  },

  async getLiveSessionOutput(runId: number): Promise<string> {
    return App.GetAgentRunOutput(runId);
  },
  async getSessionMessageIndex(sessionId: string, projectId: string): Promise<number[]> {
    return App.GetSessionMessageIndex(sessionId, projectId);
  },
  async getSessionMessagesRange(sessionId: string, projectId: string, start: number, end: number): Promise<any[]> {
    return App.GetSessionMessagesRange(sessionId, projectId, start, end);
  },
  async streamSessionOutput(sessionId: string, projectId: string): Promise<void> {
    return App.StreamSessionOutput(sessionId, projectId);
  },
  async loadSessionHistory(sessionId: string, projectId: string): Promise<any[]> {
    return App.LoadSessionHistory(sessionId, projectId);
  },
  async loadAgentSessionHistory(sessionId: string): Promise<any[]> {
    return App.LoadAgentSessionHistory(sessionId);
  },
  // Claude Session Execution (✓ Implemented)
  async executeClaudeCode(projectPath: string, prompt: string, model: string, sessionId?: string, providerApiId?: string): Promise<string> {
    return App.ExecuteClaudeCode(projectPath, prompt, model, sessionId || '', providerApiId || '');
  },

  async startProviderSession(provider: string, projectPath: string, prompt: string, model: string, providerApiId?: string): Promise<string> {
    return App.StartProviderSession(provider, projectPath, prompt, model, providerApiId || '');
  },

  async resumeProviderSession(provider: string, projectPath: string, prompt: string, model: string, sessionId: string, providerApiId?: string): Promise<string> {
    return App.ResumeProviderSession(provider, projectPath, prompt, model, sessionId, providerApiId || '');
  },

  async continueClaudeCode(projectPath: string, prompt: string, model: string, sessionId: string, providerApiId?: string): Promise<string> {
    return App.ContinueClaudeCode(projectPath, prompt, model, sessionId, providerApiId || '');
  },

  async resumeClaudeCode(projectPath: string, sessionId: string, prompt: string, model: string, systemPrompt?: string, providerApiId?: string): Promise<string> {
    // Note: systemPrompt is ignored for now (not supported by current backend)
    return App.ResumeClaudeCode(projectPath, prompt, model, sessionId, providerApiId || '');
  },

  async cancelClaudeExecution(sessionId?: string): Promise<void> {
    if (sessionId) {
      return App.CancelClaudeExecution(sessionId);
    }
  },

  async cancelClaudeExecutionByProject(projectPath: string): Promise<void> {
    return App.CancelClaudeExecutionByProject(projectPath);
  },

  async isClaudeSessionRunning(sessionId: string): Promise<boolean> {
    return App.IsClaudeSessionRunning(sessionId);
  },

  async isClaudeSessionRunningForProject(projectPath: string, provider?: string): Promise<boolean> {
    return App.IsClaudeSessionRunningForProject(projectPath, provider || 'claude');
  },

  async listRunningClaudeSessions(): Promise<any[]> {
    const sessions = await App.ListRunningClaudeSessions();
    return sessions || [];
  },

  async getClaudeSessionOutput(sessionId: string): Promise<string> {
    return App.GetClaudeSessionOutput(sessionId);
  },
  // File System (✓ Implemented)
  async listDirectoryContents(path: string): Promise<FileEntry[]> {
    const entries = await App.ListDirectoryContents(path);
    return entries || [];
  },

  async searchFiles(base: string, query: string): Promise<FileEntry[]> {
    const results = await App.SearchFiles(base, query);
    return results || [];
  },
  async listClaudeAgents(): Promise<FileEntry[]> {
    const entries = await App.ListClaudeAgents();
    return entries || [];
  },
  async searchClaudeAgents(query: string): Promise<FileEntry[]> {
    const entries = await App.SearchClaudeAgents(query);
    return entries || [];
  },
  async getUsageStats(): Promise<UsageStats> {
    const stats = await App.GetUsageStats();
    return stats || { total_tokens: 0, total_input_tokens: 0, total_output_tokens: 0, total_sessions: 0, by_model: [], by_day: [] };
  },
  async getUsageByDateRange(start: string, end: string): Promise<UsageStats> {
    const stats = await App.GetUsageByDateRange(start, end);
    return stats || { total_tokens: 0, total_input_tokens: 0, total_output_tokens: 0, total_sessions: 0, by_model: [], by_day: [] };
  },
  async getSessionStats(since?: string, until?: string, order?: "asc" | "desc"): Promise<any[]> {
    // Backend GetSessionStats ignores parameters and returns all sessions
    // The since/until/order parameters are accepted for API compatibility but not used
    return App.GetSessionStats("", "");
  },
  async getUsageDetails(limit?: number): Promise<UsageEntry[]> {
    const entries = await App.GetUsageDetails(limit || 100);
    return entries || [];
  },
  async restoreCheckpoint(checkpointId: string, sessionId: string, projectId: string, projectPath: string): Promise<CheckpointResult> {
    return App.RestoreCheckpoint(checkpointId, sessionId, projectId, projectPath);
  },
  async forkFromCheckpoint(checkpointId: string, oldSessionId: string, newSessionId: string, projectId: string): Promise<CheckpointResult> {
    return App.ForkFromCheckpoint(checkpointId, oldSessionId, newSessionId, projectId);
  },
  async getSessionTimeline(sessionId: string, projectId: string): Promise<SessionTimeline> {
    return App.GetSessionTimeline(sessionId, projectId);
  },
  async updateCheckpointSettings(sessionId: string, projectId: string, settings: any): Promise<void> {
    return App.UpdateCheckpointSettings(sessionId, projectId, settings);
  },
  async getCheckpointDiff(fromId: string, toId: string, sessionId: string, projectId: string): Promise<CheckpointDiff> {
    return App.GetCheckpointDiff(fromId, toId, sessionId, projectId);
  },
  async trackCheckpointMessage(sessionId: string, projectId: string, messageIndex: number): Promise<void> {
    return App.TrackCheckpointMessage(sessionId, projectId, messageIndex);
  },
  async checkAutoCheckpoint(sessionId: string, projectId: string): Promise<boolean> {
    return App.CheckAutoCheckpoint(sessionId, projectId);
  },
  async cleanupOldCheckpoints(sessionId: string, projectId: string): Promise<number> {
    return App.CleanupOldCheckpoints(sessionId, projectId);
  },
  async getCheckpointSettings(sessionId: string, projectId: string): Promise<CheckpointConfig> {
    return App.GetCheckpointSettings(sessionId, projectId);
  },
  async clearCheckpointManager(sessionId: string, projectId: string): Promise<void> {
    return App.ClearCheckpointManager(sessionId, projectId);
  },
  async trackSessionMessages(sessionId: string, projectId: string, messages: any[]): Promise<void> {
    return App.TrackSessionMessages(sessionId, projectId, messages);
  },

  // MCP Server Management (✓ Implemented)
  async mcpList(): Promise<MCPServer[]> {
    const servers = await App.ListMcpServers();
    return servers || [];
  },

  async mcpGet(name: string): Promise<MCPServer | null> {
    try {
      return await App.GetMcpServer(name);
    } catch {
      return null;
    }
  },

  async mcpSave(name: string, config: MCPServerConfig): Promise<void> {
    await App.SaveMcpServer(name, config);
  },

  async mcpRemove(name: string): Promise<void> {
    await App.DeleteMcpServer(name);
  },

  async mcpGetServerStatus(name: string): Promise<ServerStatus> {
    const status = await App.GetMcpServerStatus(name);
    return status || { running: false };
  },

  // MCP Advanced Operations (✓ Implemented)
  async mcpAdd(name: string, command: string, args: string[], env: Record<string, string>, scope?: string): Promise<{ name: string; success: boolean; message: string }> {
    const result = await App.McpAdd(name, command, args || [], env || {}, scope || 'user');
    return result || { name, success: false, message: 'Failed to add MCP server' };
  },
  async mcpAddJson(name: string, configJson: string): Promise<{ name: string; success: boolean; message: string }> {
    const result = await App.McpAddJson(name, configJson);
    return result || { name, success: false, message: 'Failed to add MCP server from JSON' };
  },
  async mcpAddFromClaudeDesktop(scope?: string): Promise<{ success: boolean; imported_count: number; failed_count: number; messages: string[] }> {
    const result = await App.McpAddFromClaudeDesktop(scope || 'user');
    return result || { success: false, imported_count: 0, failed_count: 0, messages: [] };
  },
  async mcpServe(): Promise<string> {
    return App.McpServe();
  },
  async mcpTestConnection(name: string): Promise<string> {
    return App.McpTestConnection(name);
  },
  async mcpResetProjectChoices(): Promise<string> {
    return App.McpResetProjectChoices();
  },
  async mcpReadProjectConfig(path: string): Promise<{ servers: Record<string, any> }> {
    const result = await App.McpReadProjectConfig(path);
    return result || { servers: {} };
  },
  async mcpSaveProjectConfig(path: string, config: any): Promise<string> {
    return App.McpSaveProjectConfig(path, config);
  },
  // Claude Binary Path (✓ Implemented)
  async getClaudeBinaryPath(): Promise<string | null> {
    const path = await App.GetClaudeBinaryPath();
    return path || null;
  },

  async setClaudeBinaryPath(path: string): Promise<void> {
    return App.SetClaudeBinaryPath(path);
  },
  async listClaudeInstallations(): Promise<ClaudeInstallation[]> {
    const installations = await App.ListClaudeInstallations();
    return installations || [];
  },

  // Storage/Database Operations (✓ Implemented)
  async storageListTables(): Promise<string[]> {
    const tables = await App.StorageListTables();
    return tables || [];
  },

  async storageReadTable(table: string, page: number, pageSize: number): Promise<{ data: any[]; total: number; page: number; page_size: number }> {
    const result = await App.StorageReadTable(table, page, pageSize);
    return {
      data: result?.data || [],
      total: result?.total || 0,
      page: result?.page || page,
      page_size: result?.page_size || pageSize,
    };
  },

  async storageInsertRow(table: string, data: Record<string, any>): Promise<number> {
    return App.StorageInsertRow(table, data);
  },

  async storageUpdateRow(table: string, id: number, data: Record<string, any>): Promise<void> {
    return App.StorageUpdateRow(table, id, data);
  },

  async storageDeleteRow(table: string, id: number): Promise<void> {
    return App.StorageDeleteRow(table, id);
  },

  async storageExecuteSql(query: string): Promise<{ data: any[]; total: number; page: number; page_size: number }> {
    const result = await App.StorageExecuteSql(query);
    return {
      data: result?.data || [],
      total: result?.total || 0,
      page: result?.page || 1,
      page_size: result?.page_size || 0,
    };
  },

  async storageResetDatabase(): Promise<void> {
    return App.StorageResetDatabase();
  },

  async getWorkspaceProtectionEnabled(path?: string): Promise<boolean> {
    const result = await App.GetWorkspaceProtectionEnabled(path || 'global');
    return result ?? true;
  },
  async setWorkspaceProtectionEnabled(pathOrEnabled?: string | boolean, enabled?: boolean): Promise<void> {
    // Support both signatures:
    // setWorkspaceProtectionEnabled(enabled: boolean) - for global setting
    // setWorkspaceProtectionEnabled(path: string, enabled: boolean) - for path-specific setting
    if (typeof pathOrEnabled === 'boolean') {
      return App.SetWorkspaceProtectionEnabled('global', pathOrEnabled);
    }
    return App.SetWorkspaceProtectionEnabled(pathOrEnabled || 'global', enabled ?? true);
  },

  // Hooks Management (✓ Implemented)
  async getHooksConfig(): Promise<HooksConfiguration> {
    const hooks = await App.GetHooks();
    return (hooks as unknown as HooksConfiguration) || { PreToolUse: [], PostToolUse: [], Notification: [], Stop: [] };
  },

  async updateHooksConfig(
    scopeOrConfig: 'user' | 'project' | 'local' | HooksConfiguration,
    hooks?: HooksConfiguration,
    projectPath?: string
  ): Promise<void> {
    // Support both signatures:
    // updateHooksConfig(config: HooksConfiguration) - simple usage
    // updateHooksConfig(scope, hooks, projectPath?) - legacy usage
    if (typeof scopeOrConfig === 'object') {
      // New simple signature
      return App.SaveHooks(scopeOrConfig as any);
    }
    // Legacy signature with scope - for now, just save the hooks directly
    // TODO: implement scope-specific saving if needed
    if (hooks) {
      return App.SaveHooks(hooks as any);
    }
  },

  async getHooksByType(hookType: string): Promise<any[]> {
    const hooks = await App.GetHooksByType(hookType);
    return hooks || [];
  },

  async validateHookCommand(cmd: string): Promise<{ valid: boolean; message: string }> {
    const result = await App.ValidateHookCommand(cmd);
    return result || { valid: true, message: '' };
  },
  async savePastedImage(data: string, filename: string): Promise<string> {
    return App.SavePastedImage(data, filename);
  },
  async getMergedHooksConfig(path: string): Promise<HooksConfiguration> {
    const result = await App.GetMergedHooksConfig(path);
    return (result as unknown as HooksConfiguration) || { PreToolUse: [], PostToolUse: [], Notification: [], Stop: [] };
  },

  // Slash Commands (✓ Implemented)
  async slashCommandsList(projectPath?: string): Promise<SlashCommand[]> {
    const commands = await App.ListSlashCommands(projectPath || '');
    return (commands || []).map(cmd => ({
      id: cmd.id,
      command_type: (cmd.command_type || 'claude') as 'claude' | 'codex' | 'gemini',
      name: cmd.name,
      full_command: cmd.full_command,
      scope: cmd.scope,
      namespace: cmd.namespace,
      file_path: cmd.file_path,
      content: cmd.content,
      description: cmd.description,
      allowed_tools: cmd.allowed_tools || [],
      argument_hint: cmd.argument_hint,
      has_bash_commands: cmd.has_bash_commands || false,
      has_file_references: cmd.has_file_references || false,
      accepts_arguments: cmd.accepts_arguments || false,
      plugin_id: cmd.plugin_id,
      plugin_name: cmd.plugin_name,
    }));
  },

  async slashCommandGet(name: string, projectPath?: string): Promise<SlashCommand | null> {
    try {
      const cmd = await App.GetSlashCommand(name, projectPath || '');
      if (!cmd) return null;
      return {
        id: cmd.id,
        command_type: (cmd.command_type || 'claude') as 'claude' | 'codex' | 'gemini',
        name: cmd.name,
        full_command: cmd.full_command,
        scope: cmd.scope,
        namespace: cmd.namespace,
        file_path: cmd.file_path,
        content: cmd.content,
        description: cmd.description,
        allowed_tools: cmd.allowed_tools || [],
        argument_hint: cmd.argument_hint,
        has_bash_commands: cmd.has_bash_commands || false,
        has_file_references: cmd.has_file_references || false,
        accepts_arguments: cmd.accepts_arguments || false,
        plugin_id: cmd.plugin_id,
        plugin_name: cmd.plugin_name,
      };
    } catch {
      return null;
    }
  },

  async slashCommandSave(name: string, content: string, scope: string, projectPath?: string): Promise<void> {
    return App.SaveSlashCommand(name, content, scope, projectPath || '');
  },

  async slashCommandDelete(name: string, scope: string, projectPath?: string): Promise<void> {
    return App.DeleteSlashCommand(name, scope, projectPath || '');
  },

  async skillsList(path?: string): Promise<Skill[]> {
    const skills = await App.SkillsList(path || '');
    return (skills || []).map(s => ({
      id: s.id,
      name: s.name,
      full_name: s.full_name,
      scope: s.scope as SkillScope,
      content: s.content,
      description: s.description,
      path: s.path,
      plugin_id: s.plugin_id,
      plugin_name: s.plugin_name,
      allowed_tools: s.allowed_tools || [],
    }));
  },
  async skillGet(id: string, path?: string): Promise<Skill | null> {
    try {
      const skill = await App.SkillGet(id, path || '');
      if (!skill) return null;
      return {
        id: skill.id,
        name: skill.name,
        full_name: skill.full_name,
        scope: skill.scope as SkillScope,
        content: skill.content,
        description: skill.description,
        path: skill.path,
        plugin_id: skill.plugin_id,
        plugin_name: skill.plugin_name,
        allowed_tools: skill.allowed_tools || [],
      };
    } catch {
      return null;
    }
  },
  // Git Worktree (✓ Implemented)
  async detectWorktree(path: string): Promise<WorktreeInfo> {
    const info = await App.DetectWorktree(path);
    const isWorktree = info?.is_worktree || false;
    return {
      currentPath: info?.current_path || path,
      rootPath: info?.root_path || path,
      mainBranch: info?.main_branch || 'main',
      isWorktreeChild: isWorktree,
      is_worktree: isWorktree,
    };
  },
  async pushToMainWorktree(path: string): Promise<string> {
    return App.PushToMainWorktree(path);
  },

  async getUnpushedCommitsCount(path: string): Promise<number> {
    try {
      return await App.GetUnpushedCommitsCount(path);
    } catch {
      return 0;
    }
  },

  async pushToRemote(path: string): Promise<string> {
    return App.PushToRemote(path);
  },

  async getUnpushedToRemoteCount(path: string): Promise<number> {
    try {
      return await App.GetUnpushedToRemoteCount(path);
    } catch {
      return 0;
    }
  },

  async checkWorkspaceClean(path: string): Promise<void> {
    return App.CheckWorkspaceClean(path);
  },

  async cleanupWorkspace(path: string): Promise<string> {
    return App.CleanupWorkspace(path);
  },
  // Git Branch (✓ Implemented)
  async getCurrentBranch(path: string): Promise<string> {
    try {
      return await App.GetCurrentBranch(path);
    } catch {
      return 'main';
    }
  },
  async updateWorkspaceBranch(path: string, branch: string): Promise<void> {
    return App.UpdateWorkspaceBranch(path, branch);
  },
  async notifyBranchRenamed(path: string, branch: string): Promise<void> {
    return App.NotifyBranchRenamed(path, branch);
  },

  // Command Execution (✓ Implemented)
  async executeCommand(command: string, cwd?: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const result = await App.ExecuteCommand(command, cwd || '');
    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  },

  async executeCommandWithArgs(command: string, args: string[], cwd?: string): Promise<string> {
    return App.ExecuteCommandWithArgs(command, args || [], cwd || '');
  },

  async executeCommandAsync(command: string, args: string[], cwd?: string): Promise<string> {
    return App.ExecuteCommandAsync(command, args || [], cwd || '');
  },

  async killCommand(id: string): Promise<void> {
    return App.KillCommand(id);
  },
  async getActions(projectPath?: string, workspacePath?: string): Promise<{ global_actions: any[]; project_actions: any[]; workspace_actions: any[] }> {
    const result = await App.GetActions(projectPath || '', workspacePath || '');
    return result || { global_actions: [], project_actions: [], workspace_actions: [] };
  },
  async updateProjectActions(projectPath: string, actions: any[]): Promise<void> {
    return App.UpdateProjectActions(projectPath, actions);
  },
  async updateWorkspaceActions(workspacePath: string, actions: any[]): Promise<void> {
    return App.UpdateWorkspaceActions(workspacePath, actions);
  },
  async getGlobalActions(): Promise<any[]> {
    const actions = await App.GetGlobalActions();
    return actions || [];
  },
  async updateGlobalActions(actions: any[]): Promise<void> {
    return App.UpdateGlobalActions(actions);
  },

  // External App Opening (✓ Implemented)
  async openInTerminal(path: string): Promise<void> {
    return App.OpenInTerminal(path);
  },

  async openInEditor(path: string): Promise<void> {
    return App.OpenInEditor(path);
  },

  async openUrl(url: string): Promise<void> {
    return App.OpenUrl(url);
  },

  async openInExternalApp(path: string, app: string): Promise<void> {
    return App.OpenInExternalApp(path, app);
  },

  async createProviderApiConfig(config: ProviderApiConfig): Promise<void> {
    return App.CreateProviderApiConfig(config);
  },

  async updateProviderApiConfig(id: string, config: any): Promise<ProviderApiConfig> {
    const result = await App.UpdateProviderApiConfig(id, config);
    return result || { id, ...config };
  },

  async getProjectProviderApiConfig(path: string, provider: string): Promise<ProviderApiConfig | null> {
    try {
      return await App.GetProjectProviderApiConfig(path, provider);
    } catch {
      return null;
    }
  },

  async setProjectProviderApiConfig(path: string, provider: string, config: ProviderApiConfig): Promise<void> {
    return App.SetProjectProviderApiConfig(path, provider, config);
  },

  async isPtySessionAlive(sessionId: string): Promise<boolean> {
    const result = await App.IsPtySessionAlive(sessionId);
    return result || false;
  },

  // SSH Sync (✓ Implemented)
  async listGlobalSshConnections(): Promise<any[]> {
    const connections = await App.ListGlobalSshConnections();
    return connections || [];
  },

  async addGlobalSshConnection(conn: any): Promise<void> {
    return App.AddGlobalSshConnection(conn);
  },

  async deleteGlobalSshConnection(name: string): Promise<void> {
    return App.DeleteGlobalSshConnection(name);
  },

  async syncFromSSH(localPath: string, remotePath: string, connectionName: string): Promise<any> {
    await App.SyncFromSSH(localPath, remotePath, connectionName);
    // Return project info
    const name = localPath.split('/').pop() || 'project';
    return {
      id: name,
      path: localPath,
      sessions: [],
      created_at: Date.now()
    };
  },

  async pauseSshSync(localPath: string): Promise<void> {
    return App.PauseSshSync(localPath);
  },

  async resumeSshSync(localPath: string): Promise<void> {
    return App.ResumeSshSync(localPath);
  },

  async cancelSshSync(localPath: string): Promise<void> {
    return App.CancelSshSync(localPath);
  },

  async startAutoSync(localPath: string, remotePath: string, connectionName: string): Promise<void> {
    return App.StartAutoSync(localPath, remotePath, connectionName);
  },

  async stopAutoSync(localPath: string): Promise<void> {
    return App.StopAutoSync(localPath);
  },

  async getAutoSyncStatus(localPath: string): Promise<AutoSyncStatus> {
    const status = await App.GetAutoSyncStatus(localPath);
    return {
      projectId: status?.project_path || localPath,
      isRunning: status?.is_running || false,
      lastSyncTime: status?.last_sync_time,
      error: status?.error,
    };
  },

  async testSshConnection(conn: any): Promise<void> {
    return App.TestSshConnection(conn);
  },
  async cloneRepository(repoUrl: string, destPath?: string, branch?: string): Promise<{ id: string; path: string; sessions: string[]; created_at: number }> {
    const result = await App.CloneRepository(repoUrl, destPath || '', branch || '');
    return result || { id: '', path: '', sessions: [], created_at: 0 };
  },
  async initLocalGit(path: string, commitAll?: boolean): Promise<void> {
    return App.InitLocalGit(path, commitAll || false);
  },
  // Git Repository (✓ Implemented)
  async isGitRepository(path: string): Promise<boolean> {
    return App.IsGitRepository(path);
  },

  // File Read/Write (✓ Implemented)
  async writeFile(path: string, content: string): Promise<void> {
    return App.WriteFile(path, content);
  },

  async readFile(path: string): Promise<string> {
    return App.ReadFile(path);
  },

  // Git Watcher (✓ Implemented)
  async WatchGitWorkspace(path: string): Promise<void> {
    return App.WatchGitWorkspace(path);
  },

  async UnwatchGitWorkspace(path: string): Promise<void> {
    return App.UnwatchGitWorkspace(path);
  },
};

// Export runtime functions
export { EventsOn, EventsOff, EventsEmit } from '../../wailsjs/runtime/runtime';
export * as WailsApp from '../../wailsjs/go/main/App';
