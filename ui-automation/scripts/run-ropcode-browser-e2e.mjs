import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const automationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(automationRoot, '..');
const artifactsDir = path.join(automationRoot, 'artifacts');
const headed = process.argv.includes('--headed');
const skipBuild = process.argv.includes('--skip-build');
const scriptArgs = process.argv.slice(2);
const grep = parseGrepArg(scriptArgs);

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
  const fakePi = process.env.ROPCODE_E2E_PI_FAKE === '1' ? await createFakePiShim() : null;
  const server = await startServer(vite.url, authKey, fakePi);

  try {
    const playwrightArgs = ['playwright', 'test', '--project=edge'];
    if (grep) {
      playwrightArgs.push('--grep', grep);
    }

    await run(npxCmd, playwrightArgs, {
      cwd: automationRoot,
      label: 'playwright-edge',
      env: {
        ...process.env,
        ROPCODE_E2E_URL: `http://127.0.0.1:${server.port}/`,
        ROPCODE_E2E_SERVER_PORT: String(server.port),
        ROPCODE_E2E_AUTH_KEY: authKey,
        ROPCODE_E2E_HEADED: headed ? '1' : '0',
        ...(fakePi ? { ROPCODE_E2E_PI_LOG: fakePi.logPath } : {}),
      },
    });
  } finally {
    await stopChild(server.child);
    await stopChild(vite.child);
  }
}

function parseGrepArg(args) {
  const grepIndex = args.indexOf('--grep');
  if (grepIndex >= 0) {
    return args[grepIndex + 1] || '';
  }

  return args
    .filter((arg) => arg !== '--headed' && arg !== '--skip-build')
    .join(' ');
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

async function startServer(viteUrl, authKey, fakePi) {
  const logPath = path.join(artifactsDir, 'ropcode-server.log');
  const child = spawnLogged(serverExe, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROPCODE_AUTH_KEY: authKey,
      ROPCODE_MODE: 'websocket',
      ROPCODE_VITE_URL: viteUrl,
      ROPCODE_INSTANCE_ID: `browser-e2e-${Date.now()}`,
      ...(fakePi ? { PATH: `${fakePi.binDir}${path.delimiter}${process.env.PATH || ''}` } : {}),
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

async function createFakePiShim() {
  const binDir = path.join(artifactsDir, 'fake-pi-bin');
  await mkdir(binDir, { recursive: true });
  const logPath = path.join(artifactsDir, 'fake-pi-commands.jsonl');
  await writeFile(logPath, '', 'utf8');

  if (process.platform === 'win32') {
    const shimPath = path.join(binDir, 'pi.cmd');
    const nodeScriptPath = path.join(binDir, 'fake-pi.mjs');
    const nodeScript = `import { appendFileSync } from 'node:fs';\n` +
      `import { createInterface } from 'node:readline';\n` +
      `const logPath = ${JSON.stringify(logPath)};\n` +
      `const write = (line) => process.stdout.write(line + '\\n');\n` +
      `appendFileSync(logPath, JSON.stringify({ type: 'fake_start', pid: process.pid }) + '\\n');\n` +
      `write(JSON.stringify({ id: 'startup', type: 'response', command: 'get_state', success: true, data: { sessionId: 'fake-pi-session', sessionFile: 'fake-pi.jsonl' } }));\n` +
      `const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });\n` +
      `rl.on('line', (line) => {\n` +
      `  appendFileSync(logPath, line + '\\n');\n` +
      `  let command;\n` +
      `  try { command = JSON.parse(line); } catch { return; }\n` +
      `  if (command.type === 'abort') {\n` +
      `    write(JSON.stringify({ id: 'abort', type: 'response', command: 'abort', success: true, data: { sessionId: 'fake-pi-session', sessionFile: 'fake-pi.jsonl' } }));\n` +
      `    return;\n` +
      `  }\n` +
      `  if (command.type === 'prompt') {\n` +
      `    write(JSON.stringify({ id: 'prompt', type: 'response', command: 'prompt', success: true, data: { sessionId: 'fake-pi-session', sessionFile: 'fake-pi.jsonl' } }));\n` +
      `    write(JSON.stringify({ type: 'message_update', delta: 'Pi fake response' }));\n` +
      `    write(JSON.stringify({ type: 'agent_end', success: true }));\n` +
      `  }\n` +
      `});\n`;
    const script = `@echo off\r\n` +
      `node "${nodeScriptPath}" %*\r\n`;
    await writeFile(nodeScriptPath, nodeScript, 'utf8');
    await writeFile(shimPath, script, 'utf8');
    return { binDir, logPath };
  }

  const shimPath = path.join(binDir, 'pi');
  const script = `#!/bin/sh\n` +
    `printf '%s\\n' '{"type":"fake_start","pid":"'"$$"'"}' >> '${logPath}'\n` +
    `printf '%s\\n' '{"id":"startup","type":"response","command":"get_state","success":true,"data":{"sessionId":"fake-pi-session","sessionFile":"fake-pi.jsonl"}}'\n` +
    `while IFS= read -r line; do\n` +
    `  printf '%s\\n' "$line" >> '${logPath}'\n` +
    `  case "$line" in\n` +
    `    *'"type":"abort"'*) printf '%s\\n' '{"id":"abort","type":"response","command":"abort","success":true,"data":{"sessionId":"fake-pi-session","sessionFile":"fake-pi.jsonl"}}' ;;\n` +
    `    *'"type":"prompt"'*) printf '%s\\n' '{"id":"prompt","type":"response","command":"prompt","success":true,"data":{"sessionId":"fake-pi-session","sessionFile":"fake-pi.jsonl"}}'; printf '%s\\n' '{"type":"message_update","delta":"Pi fake response"}'; printf '%s\\n' '{"type":"agent_end","success":true}' ;;\n` +
    `  esac\n` +
    `done\n`;
  await writeFile(shimPath, script, 'utf8');
  await chmod(shimPath, 0o755);
  return { binDir, logPath };
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
