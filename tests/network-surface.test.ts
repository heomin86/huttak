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

/** Resolved from this file, so the check reads the repository even from another directory. */
const ROOT = join(import.meta.dirname, '..');

function sources(directory: string, extensions: RegExp): Array<{ path: string; code: string }> {
  const found: Array<{ path: string; code: string }> = [];
  for (const entry of readdirSync(join(ROOT, directory))) {
    const path = join(directory, entry);
    if (statSync(join(ROOT, path)).isDirectory()) {
      found.push(...sources(path, extensions));
      continue;
    }
    if (!extensions.test(entry)) continue;
    found.push({
      path: path.replaceAll('\\', '/'),
      code: readFileSync(join(ROOT, path), 'utf8'),
    });
  }
  return found;
}

/** Removes `//` and `/* *\/` comments so a mention in prose is not read as a call. */
function withoutComments(code: string): string {
  return code.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/.*$/gmu, '');
}

/**
 * Every file that can execute. `public` is read too: `gpu-probe.js` runs as a same-origin
 * script in the offscreen page, so a `fetch` added there would sit outside the `src` tree
 * the first version of this check scanned and never be seen.
 */
const files = [...sources('src', /\.(?:ts|svelte)$/u), ...sources('public', /\.(?:js|ts)$/u)].map(
  (file) => ({ ...file, code: withoutComments(file.code) }),
);

/**
 * Markup and stylesheets, where a remote script, stylesheet or font is actually declared.
 *
 * `.svelte` and `.ts` both belong here: a component carries a `<style>` block, and a page
 * can be built from a template literal. The first version of this check read only the
 * TypeScript tree, so the place a remote resource is usually declared — the entry point's
 * HTML — was never opened. Every shape is read, and the test counts each one, so no
 * extension can quietly fall out of the scan again.
 */
const markup = [
  ...sources('src', /\.(?:ts|html|css|svelte)$/u),
  ...sources('public', /\.(?:html|css|js)$/u),
].map((file) => ({ ...file, code: withoutComments(file.code) }));

/** A URL that leaves the extension's own origin, including a protocol-relative one. */
const REMOTE_URL = /^(?:https?:)?\/\//iu;

/** An attribute that names a resource the browser fetches. `data-src` is not one. */
const RESOURCE_ATTRIBUTE =
  /(?<![\w-])(?:src|href|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
const URL_FUNCTION = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/giu;
const AT_IMPORT = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/giu;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/gu;

/**
 * Remote references in one file: an attribute, a CSS `url()`, an `@import`, or a dynamic
 * `import()`. `srcset` holds a comma-separated list, so each entry is checked on its own,
 * and a quoted value may contain a `>` without ending the attribute early.
 */
function remoteReferences(code: string): string[] {
  const found: string[] = [];
  const collect = (value: string | undefined): void => {
    if (!value) return;
    for (const entry of value.split(',')) {
      const url = entry.trim().split(/\s+/u)[0] ?? '';
      if (REMOTE_URL.test(url)) found.push(url);
    }
  };

  for (const match of code.matchAll(RESOURCE_ATTRIBUTE)) collect(match[1] ?? match[2] ?? match[3]);
  for (const match of code.matchAll(URL_FUNCTION)) collect(match[1]);
  for (const match of code.matchAll(AT_IMPORT)) collect(match[1]);
  for (const match of code.matchAll(DYNAMIC_IMPORT)) collect(match[1]);
  return found;
}

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
    // Counting per extension keeps the check from passing because a directory was scanned
    // and came back empty, and keeps `public` from dropping out of the set unnoticed.
    const count = (extension: RegExp): number =>
      markup.filter((file) => extension.test(file.path)).length;
    expect(count(/^src\/.*\.html$/u)).toBeGreaterThan(0);
    expect(count(/\.css$/u)).toBeGreaterThan(0);
    expect(count(/\.svelte$/u)).toBeGreaterThan(0);
    expect(count(/\.ts$/u)).toBeGreaterThan(0);
    expect(count(/^public\/.*\.js$/u)).toBeGreaterThan(0);

    const remote = markup
      .map((file) => ({ path: file.path, urls: remoteReferences(file.code) }))
      .filter((entry) => entry.urls.length > 0);

    expect(remote).toEqual([]);
  });
});
