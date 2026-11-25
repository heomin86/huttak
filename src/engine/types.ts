export type Formality = 'polite' | 'plain';

export type EngineKind = 'plamo' | 'chrome' | 'local';

/**
 * The separate box where the reader pastes Korean they wrote. Page translation never
 * sets this, so its prompt stays the ordinary one.
 */
export const NATURAL_AMERICAN_TASK = 'natural-american' as const;

export type TranslationTask = typeof NATURAL_AMERICAN_TASK;

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslateSegment {
  id: string;
  text: string;
}

export interface TranslateOptions {
  src?: string | undefined;
  tgt: string;
  form: Formality;
  glossary?: readonly GlossaryEntry[] | undefined;
  context?: string | undefined;
  priority: number;
  signal: AbortSignal;
  /** Stream the first short piece before the rest of this call is batched. */
  eager?: boolean | undefined;
  /**
   * Set only by the box that rewrites the reader's own Korean into American English.
   * Absent on a page, a post, a caption and the general typed translator.
   */
  task?: TranslationTask | undefined;
}

interface TranslationChunkBase {
  id: string;
  engine?: EngineKind | undefined;
}

export type TranslationChunk =
  | (TranslationChunkBase & {
      textDelta: string;
      final?: undefined;
      /**
       * The text streamed for this id so far was wrong (a packed request lost its line
       * alignment) and this delta starts it over.
       */
      restart?: boolean | undefined;
    })
  | (TranslationChunkBase & { textDelta?: undefined; final: string; restart?: undefined });

export interface Engine {
  translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncIterable<TranslationChunk>;
}

export interface IdentifiedEngine extends Engine {
  readonly kind: EngineKind;
}

export function isTranslationChunk(value: unknown): value is TranslationChunk {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  const delta = 'textDelta' in value ? value.textDelta : undefined;
  const final = 'final' in value ? value.final : undefined;
  if (delta === undefined && final === undefined) return false;
  if (delta !== undefined && typeof delta !== 'string') return false;
  if (final !== undefined && typeof final !== 'string') return false;
  const restart = 'restart' in value ? value.restart : undefined;
  if (restart !== undefined && (typeof restart !== 'boolean' || delta === undefined)) return false;
  const engine = 'engine' in value ? value.engine : undefined;
  return engine === undefined || engine === 'plamo' || engine === 'chrome' || engine === 'local';
}
