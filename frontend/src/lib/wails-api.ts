/**
 * Wails API Adapter
 *
 * 提供 Tauri 兼容的 API 层，将 Tauri 风格的 invoke() 调用映射到 Wails 后端方法。
 * 这使得从 Tauri 迁移到 Wails 更容易，通过保持相似的前端 API 接口。
 */

import * as App from '../../wailsjs/go/main/App';

// invoke 命令的类型定义
type InvokeCommand =
  // PTY 命令
  | 'create_pty_session'
  | 'write_to_pty'
  | 'resize_pty'
  | 'close_pty_session'
  | 'list_pty_sessions'
  // 进程命令
  | 'spawn_process'
  | 'kill_process'
  | 'is_process_alive'
  | 'list_processes'
  // 数据库命令
  | 'save_provider_api_config'
  | 'get_provider_api_config'
  | 'get_all_provider_api_configs'
  | 'delete_provider_api_config'
  | 'save_setting'
  | 'get_setting'
  // 检查点命令
  | 'create_checkpoint'
  | 'load_checkpoint'
  | 'list_checkpoints'
  | 'delete_checkpoint'
  | 'generate_checkpoint_id'
  // 实用命令
  | 'get_config'
  | 'greet';

/**
 * Tauri 兼容的 invoke 函数
 * 将 Tauri 命令字符串映射到 Wails 后端方法
 *
 * @param command - 要执行的命令名称
 * @param args - 命令参数对象
 * @returns Promise 返回命令执行结果
 */
export async function invoke<T = any>(command: InvokeCommand, args?: Record<string, any>): Promise<T> {
  const params = args || {};

  switch (command) {
    // PTY 命令
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

    // 进程命令
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

    // 数据库命令
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

    // 检查点命令
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

    // 实用命令
    case 'get_config':
      return App.GetConfig() as Promise<T>;

    case 'greet':
      return App.Greet(params.name) as Promise<T>;

    default:
      throw new Error(`未知命令: ${command}`);
  }
}

/**
 * Tauri 兼容的文件源转换函数
 *
 * 在 Wails 中，使用自定义路径前缀来标识本地文件，这样 AssetServer Handler 可以正确处理。
 * 开发模式：Vite 插件拦截 /wails-local-file/ 前缀
 * 生产模式：FileLoader 拦截 /wails-local-file/ 前缀
 *
 * @param filePath - 要转换的文件路径
 * @param protocol - 协议（在 Wails 中未使用，保留用于兼容性）
 * @returns 转换后的文件路径/URL
 */
export function convertFileSrc(filePath: string, protocol: string = 'asset'): string {
  // 如果已经是 URL，直接返回
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  // 如果已经有前缀，直接返回
  if (filePath.startsWith('/wails-local-file/')) {
    return filePath;
  }

  // 添加自定义前缀，这样 Wails Handler 和 Vite 插件都能识别
  // 对于绝对路径如 /Users/xxx，添加前缀 /wails-local-file
  return `/wails-local-file${filePath}`;
}

/**
 * 导出 Wails 运行时供直接访问（如果需要）
 */
export * as WailsRuntime from '../../wailsjs/runtime/runtime';

/**
 * 导出所有 App 方法供直接访问
 */
export * as WailsApp from '../../wailsjs/go/main/App';
