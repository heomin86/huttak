import { NATURAL_AMERICAN_TASK, type Engine, type GlossaryEntry } from '@/engine/types';
import { MAX_TYPED_CHARS, normalizeTypedInput } from '@/shared/typed-translation';

/**
 * Rewrites Korean the reader typed into American English on the same engine as the
 * natural-English screen. Page translation does not call this, so its prompt stays the
 * ordinary one.
 */
export async function collectNaturalRewrite(
  engine: Engine,
  text: string,
  signal: AbortSignal,
  glossary?: readonly GlossaryEntry[],
): Promise<string> {
  const trimmed = normalizeTypedInput(text);
  if (trimmed.length === 0 || trimmed.length > MAX_TYPED_CHARS || signal.aborted) return '';

  let result = '';
  const terms = glossary?.filter((entry) => entry.source.length > 0 && entry.target.length > 0);
  for await (const chunk of engine.translate([{ id: 'natural-field', text: trimmed }], {
    src: 'ko',
    tgt: 'en',
    form: 'polite',
    task: NATURAL_AMERICAN_TASK,
    priority: 0,
    signal,
    ...(terms && terms.length > 0 ? { glossary: terms } : {}),
  })) {
    if (signal.aborted) return '';
    if (chunk.textDelta !== undefined) {
      result = chunk.restart === true ? chunk.textDelta : result + chunk.textDelta;
    } else if (chunk.final !== undefined) {
      result = chunk.final;
    }
  }
  return result.trim();
}
