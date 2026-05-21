import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const automationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(automationRoot, '..');
const artifactsDir = path.join(automationRoot, 'artifacts');
const headed = process.argv.includes('--headed');
const skipBuild = process.argv.includes('--skip-build');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const serverExe = process.platform === 'win32'
  ? path.join(repoRoot, 'bin', 'ropcode-server.exe')
  : path.join(repoRoot, 'bin', 'ropcode-server');
const cliExe = process.platform === 'win32'
  ? path.join(repoRoot, 'bin', 'win32', 'x64', 'ropcode.exe')
  : path.join(repoRoot, 'bin', 'ropcode');

const children = new Set();
const ansiPattern = /\x1b\[[0-9;]*m/g;

async function main() {
  await mkdir(artifactsDir, { recursive: true });

  if (!skipBuild) {
    await run('go', ['build', '-tags', 'server', '-o', serverExe, '.'], { cwd: repoRoot, label: 'build-server' });
    await run('go', ['build', '-o', cliExe, './cmd/ropcode'], { cwd: repoRoot, label: 'build-cli' });
  }

  const vite = await startVite();
  const authKey = crypto.randomUUID();
  const server = await startServer(vite.url, authKey);

  try {
    await run(npxCmd, ['playwright', 'test', '--project=edge'], {
      cwd: automationRoot,
      label: 'playwright-edge',
      env: {
        ...process.env,
        ROPCODE_E2E_URL: `http://127.0.0.1:${server.port}/`,
        ROPCODE_E2E_SERVER_PORT: String(server.port),
        ROPCODE_E2E_AUTH_KEY: authKey,
        ROPCODE_E2E_HEADED: headed ? '1' : '0',
      },
    });
  } finally {
    await stopChild(server.child);
    await stopChild(vite.child);
  }
}

function spawnLogged(command, args, options) {
  const useShell = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    shell: useShell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function run(command, args, options) {
  const logPath = path.join(artifactsDir, `${options.label}.log`);
  const child = spawnLogged(command, args, options);
  let output = '';

  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode));
  });
  await writeFile(logPath, output, 'utf8');

  if (code !== 0) {
    throw new Error(`${options.label} failed with exit code ${code}. See ${logPath}`);
  }
}

async function startVite() {
  const logPath = path.join(artifactsDir, 'vite.log');
  const output = [];
  const child = spawnLogged(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: path.join(repoRoot, 'frontend'),
    env: {
      ...process.env,
      ROPCODE_NO_HMR: '1',
      BROWSER: 'none',
    },
  });

  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.once('exit', async () => {
    await writeFile(logPath, output.join(''), 'utf8').catch(() => {});
  });

  let url;
  try {
    url = await waitForOutput(child, (text) => {
      const combined = (output.join('') + text).replace(ansiPattern, '');
      const match = combined.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//);
      if (!match) return null;
      return `http://127.0.0.1:${match[1]}`;
    }, 'Vite dev server did not report a local URL');
  } catch (error) {
    await writeFile(logPath, output.join(''), 'utf8').catch(() => {});
    throw error;
  }

  return { child, url };
}

async function startServer(viteUrl, authKey) {
  const logPath = path.join(artifactsDir, 'ropcode-server.log');
  const child = spawnLogged(serverExe, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROPCODE_AUTH_KEY: authKey,
      ROPCODE_MODE: 'websocket',
      ROPCODE_VITE_URL: viteUrl,
      ROPCODE_INSTANCE_ID: `browser-e2e-${Date.now()}`,
    },
  });

  const output = [];
  const port = await waitForOutput(child, (text) => {
    output.push(text);
    const match = output.join('').match(/WS_PORT:(\d+)/);
    return match ? Number(match[1]) : null;
  }, 'Ropcode server did not report WS_PORT');

  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.once('exit', async () => {
    await writeFile(logPath, output.join(''), 'utf8').catch(() => {});
  });

  return { child, port };
}

function waitForOutput(child, inspect, failureMessage) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(failureMessage));
    }, 60_000);

    const onData = (chunk) => {
      const result = inspect(chunk.toString());
      if (result) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolve(result);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`${failureMessage}; process exited with code ${code}`));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

process.on('SIGINT', async () => {
  for (const child of [...children]) {
    await stopChild(child);
  }
  process.exit(130);
});

main().catch(async (error) => {
  for (const child of [...children]) {
    await stopChild(child);
  }
  console.error(error.message || error);
  process.exit(1);
});
