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
  let final = '';
  for await (const chunk of engine.translate([{ id: 'selection', text: normalized }], {
    tgt: direction.target,
    form: 'plain',
    priority: 0,
    signal,
    ...(direction.source ? { src: direction.source } : {}),
  })) {
    if (chunk.final !== undefined) final = chunk.final;
  }

  return {
    text: final.trim(),
    source: direction.source,
    target: direction.target,
    engine: engine.kind,
  };
}

export { InBrowserEngine };
