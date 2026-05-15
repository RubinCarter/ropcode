import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface FileLogger {
  path: string;
  write: (level: LogLevel, scope: string, args: unknown[]) => void;
  close: () => void;
}

export function createTimestampedLogPath(prefix: string, now = new Date(), homeDir = os.homedir()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-');
  return path.join(homeDir, '.ropcode', 'logs', `${prefix}-${stamp}.log`);
}

export function createFileLogger(prefix: string): FileLogger {
  const logPath = createTimestampedLogPath(prefix);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const stream = fs.createWriteStream(logPath, { flags: 'wx' });
  let closed = false;

  return {
    path: logPath,
    write(level, scope, args) {
      if (closed) {
        return;
      }
      const rendered = args.map(arg => {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        }
        if (typeof arg === 'string') {
          return arg;
        }
        return util.inspect(arg, { depth: 8, breakLength: 160 });
      }).join(' ');
      stream.write(`${new Date().toISOString()} [${level}] [${scope}] ${rendered}\n`);
    },
    close() {
      closed = true;
      stream.end();
    },
  };
}

export function patchConsoleToFile(logger: FileLogger): void {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logger.write(level, 'electron-main', args);
      original(...args);
    };
  }
}
