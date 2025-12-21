/**
 * Wails API Adapter
 *
 * This module provides a Tauri-compatible API layer that maps Tauri-style
 * invoke() calls to Wails backend methods. This allows for easier migration
 * from Tauri to Wails by maintaining a similar frontend API surface.
 */

import * as App from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

// Type definitions for invoke commands
type InvokeCommand =
  // PTY commands
  | 'create_pty_session'
  | 'write_to_pty'
  | 'resize_pty'
  | 'close_pty_session'
  | 'list_pty_sessions'
  // Process commands
  | 'spawn_process'
  | 'kill_process'
  | 'is_process_alive'
  | 'list_processes'
  // Database commands
  | 'save_provider_api_config'
  | 'get_provider_api_config'
  | 'get_all_provider_api_configs'
  | 'delete_provider_api_config'
  | 'save_setting'
  | 'get_setting'
  // Checkpoint commands
  | 'create_checkpoint'
  | 'load_checkpoint'
  | 'list_checkpoints'
  | 'delete_checkpoint'
  | 'generate_checkpoint_id'
  // Utility commands
  | 'get_config';

/**
 * Tauri-compatible invoke function
 * Maps Tauri command strings to Wails backend methods
 */
export async function invoke<T = any>(command: InvokeCommand, args?: Record<string, any>): Promise<T> {
  const params = args || {};

  switch (command) {
    // PTY commands
    case 'create_pty_session':
      return App.CreatePtySession(
        params.session_id,
        params.cwd,
        params.rows,
        params.cols,
        params.shell || ''
      ) as Promise<T>;

    case 'write_to_pty':
      return App.WriteToPty(params.session_id, params.data) as Promise<T>;

    case 'resize_pty':
      return App.ResizePty(params.session_id, params.rows, params.cols) as Promise<T>;

    case 'close_pty_session':
      return App.ClosePtySession(params.session_id) as Promise<T>;

    case 'list_pty_sessions':
      return App.ListPtySessions() as Promise<T>;

    // Process commands
    case 'spawn_process':
      return App.SpawnProcess(
        params.key,
        params.command,
        params.args || [],
        params.cwd,
        params.env || []
      ) as Promise<T>;

    case 'kill_process':
      return App.KillProcess(params.key) as Promise<T>;

    case 'is_process_alive':
      return App.IsProcessAlive(params.key) as Promise<T>;

    case 'list_processes':
      return App.ListProcesses() as Promise<T>;

    // Database commands
    case 'save_provider_api_config':
      return App.SaveProviderApiConfig(params.config) as Promise<T>;

    case 'get_provider_api_config':
      return App.GetProviderApiConfig(params.id) as Promise<T>;

    case 'get_all_provider_api_configs':
      return App.GetAllProviderApiConfigs() as Promise<T>;

    case 'delete_provider_api_config':
      return App.DeleteProviderApiConfig(params.id) as Promise<T>;

    case 'save_setting':
      return App.SaveSetting(params.key, params.value) as Promise<T>;

    case 'get_setting':
      return App.GetSetting(params.key) as Promise<T>;

    // Checkpoint commands
    case 'create_checkpoint':
      return App.CreateCheckpoint(
        params.project_id,
        params.session_id,
        params.checkpoint,
        params.files,
        params.messages
      ) as Promise<T>;

    case 'load_checkpoint':
      return App.LoadCheckpoint(
        params.project_id,
        params.session_id,
        params.checkpoint_id
      ) as Promise<T>;

    case 'list_checkpoints':
      return App.ListCheckpoints(params.project_id, params.session_id) as Promise<T>;

    case 'delete_checkpoint':
      return App.DeleteCheckpoint(
        params.project_id,
        params.session_id,
        params.checkpoint_id
      ) as Promise<T>;

    case 'generate_checkpoint_id':
      return App.GenerateCheckpointID() as Promise<T>;

    // Utility commands
    case 'get_config':
      return App.GetConfig() as Promise<T>;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Tauri-compatible event listener
 * Maps to Wails event system
 */
export function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): () => void {
  EventsOn(event, handler);

  // Return unlisten function
  return () => {
    EventsOff(event);
  };
}

/**
 * Export Wails runtime for direct access if needed
 */
export { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

/**
 * Export all App methods for direct access
 */
export * as WailsApp from '../../wailsjs/go/main/App';
