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
 * anything earlier. The line on screen goes out by itself, and each finished line
 * is reported as soon as the engine returns it, so a later line cannot hold the
 * one the viewer is watching.
 *
 * The engine takes one context string per call, so each chunk is told the cue
 * that precedes its first line.
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
  const visible = order[0];
  if (visible) {
    await translateBatch(engine, cues, [visible], options, glossary, 4);
  }

  for (let offset = 1; offset < order.length; offset += CHUNK) {
    if (options.signal.aborted) return;
    const batch = order.slice(offset, offset + CHUNK);
    const priority = offset < CHUNK * 3 ? 16 : 36;
    await translateBatch(engine, cues, batch, options, glossary, priority);
  }
}

async function translateBatch(
  engine: Engine,
  cues: readonly Cue[],
  batch: readonly Cue[],
  options: CaptionTranslateOptions,
  glossary: readonly GlossaryEntry[],
  priority: number,
): Promise<void> {
  const first = batch[0];
  if (!first || options.signal.aborted) return;
  const firstIndex = cues.findIndex((cue) => cue.id === first.id);
  const previous = firstIndex > 0 ? (cues[firstIndex - 1]?.text.trim() ?? '') : '';
  const context = previous ? previous.slice(0, CONTEXT_CHARS) : '';
  const request: TranslateOptions = {
    tgt: options.targetLanguage,
    form: options.form,
    priority,
    signal: options.signal,
    ...(options.sourceLanguage ? { src: options.sourceLanguage } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(context ? { context } : {}),
  };

  const pending = new Map<string, string>();
  const reported = new Set<string>();
  const publish = (id: string, text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || reported.has(id)) return;
    reported.add(id);
    options.onCue(id, trimmed);
  };

  for await (const chunk of engine.translate(
    batch.map((cue) => ({ id: cue.id, text: cue.text })),
    request,
  )) {
    if (options.signal.aborted) return;
    if (chunk.final !== undefined) {
      pending.delete(chunk.id);
      publish(chunk.id, chunk.final);
      continue;
    }
    const delta = chunk.textDelta ?? '';
    pending.set(chunk.id, chunk.restart ? delta : (pending.get(chunk.id) ?? '') + delta);
  }
  for (const [id, text] of pending) publish(id, text);
}

function translationOrder(cues: readonly Cue[], timeMs: number): Cue[] {
  const active = cues.findIndex((cue) => cue.startMs <= timeMs && timeMs < cue.endMs);
  const upcoming = active >= 0 ? active : cues.findIndex((cue) => cue.startMs > timeMs);
  const from = upcoming >= 0 ? upcoming : 0;
  return [...cues.slice(from), ...cues.slice(0, from)];
}
