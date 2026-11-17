import { InBrowserEngine } from '../../src/engine/in-browser/engine';
import type { IdentifiedEngine } from '../../src/engine/types';
import { EngineError } from '../../src/engine/errors';
import { MAX_TYPED_CHARS, normalizeTypedInput } from '../../src/shared/typed-translation';
import { selectionDirection } from './direction';

export interface SelectionTranslation {
  text: string;
  source: string | null;
  target: string;
  engine: IdentifiedEngine['kind'];
}

/**
 * One selected string through the extension's in-browser engine. The Mac shell does
 * not build its own prompt: chunking, the PFML3 prompt, and output cleanup stay in
 * `InBrowserEngine`.
 */
export async function translateSelection(
  engine: IdentifiedEngine,
  text: string,
  signal: AbortSignal,
): Promise<SelectionTranslation> {
  const normalized = normalizeTypedInput(text);
  if (normalized.length === 0) {
    throw new EngineError('invalid-input', 'There is no text to translate.');
  }
  if (normalized.length > MAX_TYPED_CHARS) {
    throw new EngineError('invalid-input', 'The selection is too long.');
  }

  const direction = selectionDirection(normalized);
  const lines = splitLines(normalized);
  const segments = lines.flatMap((line, index) =>
    line.body.length > 0 ? [{ id: `line-${String(index)}`, text: line.body }] : [],
  );
  const finals = new Map<string, string>();
  for await (const chunk of engine.translate(segments, {
    tgt: direction.target,
    form: 'plain',
    priority: 0,
    signal,
    ...(direction.source ? { src: direction.source } : {}),
  })) {
    if (chunk.final !== undefined) finals.set(chunk.id, chunk.final.trim());
  }

  const translated = lines
    .map((line, index) =>
      line.body.length > 0 ? `${line.marker}${finals.get(`line-${String(index)}`) ?? ''}` : '',
    )
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  return {
    text: translated,
    source: direction.source,
    target: direction.target,
    engine: engine.kind,
  };
}

interface SelectionLine {
  /** A list number or bullet kept as written, with its trailing space. */
  marker: string;
  body: string;
}

const LIST_MARKER = /^((?:[-*•‣◦·]|\d{1,3}[.)]|[A-Za-z][.)])\s+)/u;

/**
 * Paragraphs and list items are translated one by one. Sent as one string, the model joins
 * them and the numbers end up glued to the previous sentence.
 */
export function splitLines(text: string): SelectionLine[] {
  return text.split('\n').map((raw) => {
    const line = raw.trim();
    const marker = LIST_MARKER.exec(line)?.[1] ?? '';
    return { marker, body: line.slice(marker.length).trim() };
  });
}

export { InBrowserEngine };
