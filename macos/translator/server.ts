import { writeSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTEXT_TOKENS } from '../../src/engine/in-browser/backend';
import { EngineError, isEngineError } from '../../src/engine/errors';
import { InBrowserEngine } from '../../src/engine/in-browser/engine';
import { freePort, LlamaServerProcess } from './llama-process';
import { ensureModelFile, hasModelConsent, rememberModelConsent, supportDirectory } from './model';
import { LlamaCppRuntime } from './runtime';
import { translateSelection } from './translate';

const MAX_BODY = 200_000;

type HealthState =
  'idle' | 'needs-consent' | 'downloading' | 'loading' | 'ready' | 'translating' | 'error';

const health: {
  state: HealthState;
  message: string;
  received: number;
  total: number;
  consent: boolean;
} = {
  state: 'idle',
  message: '번역할 글을 기다리는 중',
  received: 0,
  total: 0,
  consent: false,
};

let llama: LlamaServerProcess | null = null;
let engine: InBrowserEngine | null = null;
let engineOrigin: string | null = null;
let current: AbortController | null = null;

function setHealth(state: HealthState, message: string): void {
  health.state = state;
  health.message = message;
}

async function refreshConsent(): Promise<void> {
  health.consent = await hasModelConsent();
  if (!health.consent && health.state === 'idle') {
    setHealth('needs-consent', '번역 모델을 받기 전에 라이선스 동의가 필요합니다.');
  }
}

async function engineReady(signal: AbortSignal): Promise<InBrowserEngine> {
  if (!health.consent) {
    throw new EngineError('invalid-input', 'The PLaMo license has not been accepted.');
  }
  const dir = supportDirectory();
  setHealth('downloading', '번역 모델을 확인하는 중');
  const file = await ensureModelFile(dir, (progress) => {
    health.received = progress.received;
    health.total = progress.total;
    setHealth('downloading', '번역 모델을 받는 중');
  });
  if (signal.aborted) throw new EngineError('aborted', 'The request was aborted.');

  if (!llama) llama = new LlamaServerProcess(file);
  setHealth('loading', '번역 모델을 불러오는 중');
  const origin = await llama.originReady();
  if (engine && engineOrigin === origin) {
    setHealth('ready', '번역할 수 있습니다');
    return engine;
  }
  engine = new InBrowserEngine(new LlamaCppRuntime({ origin }), { contextTokens: CONTEXT_TOKENS });
  engineOrigin = origin;
  setHealth('ready', '번역할 수 있습니다');
  return engine;
}

async function handleTranslate(
  text: string,
  consent: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  if (consent) await rememberModelConsent();
  await refreshConsent();
  if (!health.consent) {
    setHealth('needs-consent', '번역 모델을 받기 전에 라이선스 동의가 필요합니다.');
    throw new EngineError('invalid-input', 'The PLaMo license has not been accepted.');
  }
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const ready = await engineReady(controller.signal);
    setHealth('translating', '번역하는 중');
    const result = await translateSelection(ready, text, controller.signal);
    setHealth('ready', '번역할 수 있습니다');
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (current === controller) current = null;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new EngineError('invalid-input', 'The selection is too long.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') {
    await refreshConsent();
    send(res, 200, health);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/translate') {
    const raw = await readBody(req);
    let parsed: { text?: unknown; consent?: unknown };
    try {
      parsed = JSON.parse(raw) as { text?: unknown; consent?: unknown };
    } catch {
      throw new EngineError('invalid-input', 'The request was not JSON.');
    }
    if (typeof parsed.text !== 'string') {
      throw new EngineError('invalid-input', 'text must be a string.');
    }
    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const result = await handleTranslate(parsed.text, parsed.consent === true, controller.signal);
    send(res, 200, result);
    return;
  }
  send(res, 404, { error: 'not-found' });
}

export async function listen(): Promise<number> {
  await refreshConsent();
  const preferred = Number(process.env.HUTTAK_PORT ?? '8765');
  const port = await freePort(Number.isInteger(preferred) && preferred > 0 ? preferred : 8765);
  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const engineError = isEngineError(error) ? error : null;
      if (engineError?.code !== 'aborted' && health.state !== 'needs-consent') {
        setHealth('error', engineError?.message ?? '번역하지 못했습니다.');
      }
      if (res.headersSent || res.writableEnded) return;
      const status = engineError?.code === 'invalid-input' ? 400 : 503;
      send(res, status, {
        error: engineError?.code ?? 'unknown',
        message: engineError?.message ?? '번역하지 못했습니다.',
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const shutdown = (): void => {
    void llama?.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return port;
}

const entry = process.argv[1];
const isEntry = entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;

if (isEntry && process.argv.includes('--check')) {
  if (typeof InBrowserEngine !== 'function') process.exit(1);
  writeSync(1, 'huttak-translator ok\n');
  process.exit(0);
}

if (isEntry) {
  listen()
    .then((port) => {
      writeSync(1, `huttak-translator listening 127.0.0.1:${String(port)}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'translator failed';
      writeSync(2, `${message}\n`);
      process.exit(1);
    });
}
