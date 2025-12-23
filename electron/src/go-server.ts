// electron/src/go-server.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

let goProcess: ChildProcess | null = null;
let authKey: string = '';

export interface GoServerInfo {
  port: number;
  authKey: string;
}

export function getAuthKey(): string {
  return authKey;
}

export function startGoServer(): Promise<GoServerInfo> {
  return new Promise((resolve, reject) => {
    // 生成认证密钥
    authKey = randomUUID();

    // 确定 Go 二进制路径
    const isDev = !app.isPackaged;
    let goBinaryPath: string;

    if (isDev) {
      // 开发模式：从项目根目录查找
      goBinaryPath = path.join(__dirname, '..', '..', 'bin', 'ropcode-server');
    } else {
      // 生产模式：从 resources 目录查找
      const ext = process.platform === 'win32' ? '.exe' : '';
      goBinaryPath = path.join(process.resourcesPath, 'bin', `ropcode-server${ext}`);
    }

    console.log('[GoServer] Starting:', goBinaryPath);

    goProcess = spawn(goBinaryPath, [], {
      env: {
        ...process.env,
        ROPCODE_AUTH_KEY: authKey,
        ROPCODE_MODE: 'websocket',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    // 监听 stdout 获取端口号
    goProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[GoServer stdout]', output);

      // 解析端口号
      const portMatch = output.match(/WS_PORT:(\d+)/);
      if (portMatch && !resolved) {
        resolved = true;
        const port = parseInt(portMatch[1], 10);
        console.log('[GoServer] Started on port:', port);
        resolve({ port, authKey });
      }
    });

    goProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[GoServer stderr]', data.toString());
    });

    goProcess.on('error', (err) => {
      console.error('[GoServer] Process error:', err);
      if (!resolved) {
        reject(err);
      }
    });

    goProcess.on('exit', (code, signal) => {
      console.log('[GoServer] Process exited:', { code, signal });
      goProcess = null;
      if (!resolved) {
        reject(new Error(`Go server exited with code ${code}`));
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!resolved) {
        reject(new Error('Go server startup timeout'));
        stopGoServer();
      }
    }, 30000);
  });
}

export function stopGoServer(): void {
  if (goProcess) {
    console.log('[GoServer] Stopping...');
    goProcess.kill('SIGTERM');

    // 给进程时间优雅退出
    setTimeout(() => {
      if (goProcess) {
        goProcess.kill('SIGKILL');
        goProcess = null;
      }
    }, 5000);
  }
}

export function isGoServerRunning(): boolean {
  return goProcess !== null;
}
