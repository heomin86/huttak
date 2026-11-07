import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The extension's privacy claim is structural: one request, for the pinned model file, and
 * nothing that could carry page text. That claim is easy to keep by hand and easy to lose
 * by accident — one analytics import, one `sendBeacon` in an error path — so it is checked
 * here instead of being trusted to review.
 *
 * `download.ts` is the only file allowed to reach the network, and the request it builds
 * may not grow a body or credentials.
 */
function sources(directory: string): Array<{ path: string; code: string }> {
  const found: Array<{ path: string; code: string }> = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
      continue;
    }
    if (!/\.(?:ts|svelte)$/u.test(entry)) continue;
    found.push({ path: path.replaceAll('\\', '/'), code: readFileSync(path, 'utf8') });
  }
  return found;
}

/** Removes `//` and `/* *\/` comments so a mention in prose is not read as a call. */
function withoutComments(code: string): string {
  return code.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/.*$/gmu, '');
}

const files = sources('src').map((file) => ({ ...file, code: withoutComments(file.code) }));

const NETWORK_SINKS = [
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\b/u,
  /\bEventSource\b/u,
  /\bsendBeacon\b/u,
  /\bnavigator\.connection\b/u,
  /\bRTCPeerConnection\b/u,
];

describe('network surface', () => {
  it('keeps every network sink in the model download', () => {
    const reaching = files.filter(
      (file) =>
        /\bfetch\w*\s*\(/u.test(file.code) ||
        NETWORK_SINKS.some((pattern) => pattern.test(file.code)),
    );

    expect(reaching.map((file) => file.path)).toEqual(['src/engine/model/download.ts']);
  });

  it('sends no body and no credentials with the model request', () => {
    const download = files.find((file) => file.path === 'src/engine/model/download.ts');
    if (!download) throw new Error('download.ts was not found');

    const call = /\bfetchImpl\(([^;]*?)\);/u.exec(download.code)?.[1] ?? '';
    expect(call).toContain('source.url');
    expect(call).not.toMatch(/\bbody\s*:/u);
    expect(call).not.toMatch(/\bcredentials\s*:/u);
    expect(call).not.toMatch(/\bmethod\s*:/u);
  });

  it('loads the model into the runtime from memory, not from a url', () => {
    const runtime = files.find((file) => file.path === 'src/engine/in-browser/runtime.ts');
    if (!runtime) throw new Error('runtime.ts was not found');

    // `loadModel` takes blobs. A url form would let wllama fetch on its own.
    expect(runtime.code).toMatch(/loadModel\(\s*\[file\]/u);
    expect(runtime.code).not.toMatch(/loadModel\(\s*\[?['"`]http/u);
  });

  it('does not add a remote script, stylesheet, or font to an extension page', () => {
    const remote = files.filter(
      (file) =>
        /<(?:script|link|img|iframe)[^>]+(?:src|href)\s*=\s*['"]https?:/u.test(file.code) ||
        /@import\s+url\(\s*['"]?https?:/u.test(file.code),
    );

    expect(remote.map((file) => file.path)).toEqual([]);
  });
});
