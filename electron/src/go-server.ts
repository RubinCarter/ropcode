// electron/src/go-server.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { randomUUID } from 'crypto';

let goProcess: ChildProcess | null = null;
let authKey: string = '';

// Vite 启动后会把它真正绑到的端口写到这个文件（见 frontend/vite.config.ts 里的
// ropcodeVitePortPlugin 插件）。dev 模式下 Go 反代要拼正确的 ROPCODE_VITE_URL，
// 必须先读出真实端口，不能写死 5174——Vite 在端口冲突时会让步到 5175/5176…。
const VITE_PORT_FILE = path.join(
  __dirname,
  '..',
  '..',
  'frontend',
  'node_modules',
  '.cache',
  'ropcode-vite-port',
);

async function discoverVitePort(timeoutMs = 30000): Promise<number> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const content = await fs.promises.readFile(VITE_PORT_FILE, 'utf8');
      const port = parseInt(content.trim(), 10);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        return port;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Vite did not report its port within ${timeoutMs}ms (expected at ${VITE_PORT_FILE}). Last error: ${String(lastErr)}`,
  );
}

export interface GoServerInfo {
  port: number;
  authKey: string;
}

export function getAuthKey(): string {
  return authKey;
}

export async function startGoServer(): Promise<GoServerInfo> {
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

  // dev 模式下，先等 Vite 报出真实端口，再启动 Go，否则反代目标会错位
  let viteEnv: NodeJS.ProcessEnv = {};
  if (isDev) {
    const vitePort = await discoverVitePort();
    console.log(`[GoServer] Discovered Vite port: ${vitePort}`);
    viteEnv = { ROPCODE_VITE_URL: `http://localhost:${vitePort}` };
  }

  return new Promise((resolve, reject) => {
    console.log('[GoServer] Starting:', goBinaryPath);

    goProcess = spawn(goBinaryPath, [], {
      env: {
        ...process.env,
        ROPCODE_AUTH_KEY: authKey,
        ROPCODE_MODE: 'websocket',
        // Dev mode: Go reverse proxies to Vite dev server for browser access
        ...viteEnv,
        // Production: Go serves static frontend files from resources
        ...(!isDev ? { ROPCODE_FRONTEND_DIR: path.join(process.resourcesPath, 'frontend') } : {}),
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
    }, 2000);
  }
}

export function isGoServerRunning(): boolean {
  return goProcess !== null;
}
