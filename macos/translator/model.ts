import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_MODEL_ID, getModel, type ModelEntry } from '../../src/engine/model/catalog';
import { EngineError } from '../../src/engine/errors';

const CONSENT_NOTICE = 'plamo-community';

export function supportDirectory(): string {
  const override = process.env.HUTTAK_SUPPORT_DIR;
  if (override && override.trim().length > 0) return override.trim();
  return join(homedir(), 'Library', 'Application Support', 'Huttak');
}

export function pinnedModel(): ModelEntry {
  return getModel(DEFAULT_MODEL_ID);
}

export function modelFilePath(dir = supportDirectory()): string {
  return join(dir, 'models', pinnedModel().file);
}

async function readConsentFile(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, 'consent.json'), 'utf8');
    const parsed = JSON.parse(raw) as { notice?: unknown };
    return parsed.notice === CONSENT_NOTICE;
  } catch {
    return false;
  }
}

export async function hasModelConsent(dir = supportDirectory()): Promise<boolean> {
  return readConsentFile(dir);
}

export async function rememberModelConsent(dir = supportDirectory()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'consent.json'),
    `${JSON.stringify({ notice: CONSENT_NOTICE, at: new Date().toISOString() })}\n`,
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function hashMatches(path: string, expected: string): Promise<boolean> {
  const sidecar = `${path}.sha256`;
  try {
    const recorded = (await readFile(sidecar, 'utf8')).trim();
    if (recorded === expected) return true;
  } catch {
    // A missing sidecar means the file still has to be hashed.
  }
  const actual = await sha256File(path);
  if (actual !== expected) return false;
  await writeFile(sidecar, `${actual}\n`);
  return true;
}

export interface ModelProgress {
  received: number;
  total: number;
}

/**
 * The pinned PLaMo GGUF the extension downloads. A finished partial of the right
 * size is adopted after its hash matches, so an interrupted copy can be resumed
 * outside this process and still land in the same file.
 */
export async function ensureModelFile(
  dir: string,
  onProgress: (progress: ModelProgress) => void = () => undefined,
): Promise<string> {
  const model = pinnedModel();
  const destination = modelFilePath(dir);
  await mkdir(join(dir, 'models'), { recursive: true });

  const existing = await fileSize(destination);
  if (existing === model.size && (await hashMatches(destination, model.sha256))) {
    return destination;
  }
  if (existing !== null) await rm(destination, { force: true });

  const partial = `${destination}.partial`;
  const partialSize = await fileSize(partial);
  if (partialSize === model.size && (await hashMatches(partial, model.sha256))) {
    await rename(partial, destination);
    await rename(`${partial}.sha256`, `${destination}.sha256`).catch(() => undefined);
    return destination;
  }

  const response = await fetch(model.url, {
    headers: { 'User-Agent': 'Huttak-Mac' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new EngineError(
      'download-failed',
      `The translation model could not be downloaded (HTTP ${String(response.status)}).`,
    );
  }

  const total = model.size;
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      onProgress({ received, total });
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(partial));

  if (!(await hashMatches(partial, model.sha256))) {
    await rm(partial, { force: true });
    throw new EngineError('model-integrity', 'The downloaded translation model did not match.');
  }
  await rename(partial, destination);
  await rename(`${partial}.sha256`, `${destination}.sha256`).catch(() => undefined);
  return destination;
}
