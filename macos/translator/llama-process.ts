import { type ChildProcess, spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { EngineError } from '../../src/engine/errors';

const START_TIMEOUT_MS = 120_000;
const IDLE_MS = 5 * 60 * 1000;

export async function freePort(preferred: number): Promise<number> {
  let port = preferred;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const open = await canListen(port);
    if (open) return port;
    port += 1;
  }
  throw new EngineError('local-server-unavailable', 'No local port is free for the translator.');
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveLlamaServer(): Promise<string> {
  const fromEnv = process.env.HUTTAK_LLAMA_SERVER?.trim();
  if (fromEnv) {
    await access(fromEnv, constants.X_OK);
    return fromEnv;
  }
  const found = await which('llama-server');
  if (!found) {
    throw new EngineError(
      'local-server-unavailable',
      '번역 엔진을 찾지 못했습니다. 저장소에서 pnpm mac을 다시 실행해 주세요.',
    );
  }
  return found;
}

function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/which', [command], { encoding: 'utf8' }, (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout.trim() || null);
    });
  });
}

/**
 * One llama-server for the pinned GGUF. It leaves memory five minutes after the
 * last translation, the same idle window the extension uses for PLaMo.
 */
export class LlamaServerProcess {
  private child: ChildProcess | null = null;
  private origin: string | null = null;
  private idle: NodeJS.Timeout | null = null;
  private stderr = '';

  constructor(private readonly modelPath: string) {}

  async originReady(): Promise<string> {
    this.touch();
    if (this.origin && (await healthOk(this.origin))) return this.origin;
    await this.stop();
    const binary = await resolveLlamaServer();
    const preferred = Number(process.env.HUTTAK_LLAMA_PORT ?? '8766');
    const port = await freePort(Number.isInteger(preferred) && preferred > 0 ? preferred : 8766);
    const child = spawn(
      binary,
      [
        '-m',
        this.modelPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '-ngl',
        '99',
        '-c',
        '2048',
        '--no-webui',
        '--swa-full',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    this.child = child;
    this.stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });

    const origin = `http://127.0.0.1:${String(port)}`;
    const started = Date.now();
    let exitCode: number | null = null;
    child.once('exit', (code) => {
      exitCode = code;
      if (this.child === child) {
        this.child = null;
        this.origin = null;
      }
    });

    while (Date.now() - started < START_TIMEOUT_MS) {
      if (exitCode !== null) break;
      if (await healthOk(origin)) {
        this.origin = origin;
        this.touch();
        return origin;
      }
      await delay(300);
    }

    await this.stop();
    const detail = this.stderr.trim().split('\n').slice(-8).join(' ');
    throw new EngineError(
      'model-load-failed',
      detail.length > 0
        ? `번역 모델을 불러오지 못했습니다. ${detail}`
        : '번역 모델을 불러오지 못했습니다.',
    );
  }

  touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      void this.stop();
    }, IDLE_MS);
    this.idle.unref?.();
  }

  async stop(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const child = this.child;
    this.child = null;
    this.origin = null;
    if (!child || child.killed) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function healthOk(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
