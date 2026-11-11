import type { Engine, Formality, GlossaryEntry, TranslateOptions } from '@/engine/types';
import type { Cue } from './timedtext';

const CHUNK = 6;
const CONTEXT_CHARS = 500;

export interface CaptionTranslateOptions {
  targetLanguage: string;
  sourceLanguage: string | null;
  form: Formality;
  glossary?: readonly GlossaryEntry[] | undefined;
  signal: AbortSignal;
  nowMs: number;
  onCue: (id: string, text: string) => void;
}

/**
 * Translates cues starting at the line on screen, then the following lines, then
 * anything earlier. The engine takes one context string per call, so each chunk
 * is told the cue that precedes its first line.
 */
export async function translateCues(
  engine: Engine,
  cues: readonly Cue[],
  options: CaptionTranslateOptions,
): Promise<void> {
  const order = translationOrder(cues, options.nowMs);
  const glossary = (options.glossary ?? []).filter(
    (entry) => entry.source.trim().length > 0 && entry.target.trim().length > 0,
  );

  for (let offset = 0; offset < order.length; offset += CHUNK) {
    if (options.signal.aborted) return;
    const batch = order.slice(offset, offset + CHUNK);
    const first = batch[0];
    if (!first) continue;
    const firstIndex = cues.findIndex((cue) => cue.id === first.id);
    const previous = firstIndex > 0 ? (cues[firstIndex - 1]?.text.trim() ?? '') : '';
    const context = previous ? previous.slice(0, CONTEXT_CHARS) : '';
    const priority = offset === 0 ? 4 : offset < CHUNK * 3 ? 16 : 36;
    const request: TranslateOptions = {
      tgt: options.targetLanguage,
      form: options.form,
      priority,
      signal: options.signal,
      ...(options.sourceLanguage ? { src: options.sourceLanguage } : {}),
      ...(glossary.length > 0 ? { glossary } : {}),
      ...(context ? { context } : {}),
    };

    const translated = await collect(
      engine,
      batch.map((cue) => ({ id: cue.id, text: cue.text })),
      request,
    );
    for (const cue of batch) {
      const text = translated.get(cue.id)?.trim() ?? '';
      if (text) options.onCue(cue.id, text);
    }
  }
}

function translationOrder(cues: readonly Cue[], timeMs: number): Cue[] {
  const active = cues.findIndex((cue) => cue.startMs <= timeMs && timeMs < cue.endMs);
  const upcoming = active >= 0 ? active : cues.findIndex((cue) => cue.startMs > timeMs);
  const from = upcoming >= 0 ? upcoming : 0;
  return [...cues.slice(from), ...cues.slice(0, from)];
}

async function collect(
  engine: Engine,
  segments: readonly { id: string; text: string }[],
  options: TranslateOptions,
): Promise<Map<string, string>> {
  const finals = new Map<string, string>();
  const deltas = new Map<string, string>();
  for await (const chunk of engine.translate(segments, options)) {
    if (options.signal.aborted) break;
    if (chunk.final !== undefined) {
      finals.set(chunk.id, chunk.final);
      deltas.delete(chunk.id);
      continue;
    }
    const delta = chunk.textDelta ?? '';
    deltas.set(chunk.id, chunk.restart ? delta : (deltas.get(chunk.id) ?? '') + delta);
  }
  for (const [id, text] of deltas) {
    if (!finals.has(id)) finals.set(id, text);
  }
  return finals;
}
