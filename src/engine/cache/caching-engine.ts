import { appendDelta, finalForCache } from '../text/commit';
import {
  NATURAL_AMERICAN_TASK,
  type Engine,
  type IdentifiedEngine,
  type TranslateOptions,
  type TranslateSegment,
  type TranslationChunk,
} from '../types';
import { TranslationCache } from './cache';
import { buildTranslationCacheKey } from './key';

export class CachingEngine implements IdentifiedEngine {
  constructor(
    private readonly inner: IdentifiedEngine,
    private readonly cache: TranslationCache,
    private readonly modelId: string | (() => string),
  ) {}

  get kind() {
    return this.inner.kind;
  }

  async *translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncIterable<TranslationChunk> {
    const misses: TranslateSegment[] = [];
    const keys = new Map<string, string>();
    const aliases = new Map<string, string[]>();
    const model = typeof this.modelId === 'function' ? this.modelId() : this.modelId;

    for (const segment of segments) {
      if (options.signal.aborted) return;

      const key = buildTranslationCacheKey({
        model,
        tgt: options.tgt,
        form: options.form,
        text: segment.text,
        src: options.src,
        glossary: options.glossary,
        ...(options.task !== undefined ? { task: options.task } : {}),
      });
      keys.set(segment.id, key);

      const hit = await this.cache.get(key);
      if (hit) {
        yield { id: segment.id, final: hit.text, engine: hit.engine };
        continue;
      }

      const copies = aliases.get(key);
      if (copies) {
        copies.push(segment.id);
        continue;
      }
      aliases.set(key, []);
      misses.push(segment);
    }

    if (misses.length === 0) return;

    const sources = new Map(misses.map((segment) => [segment.id, segment.text]));
    const streamed = new Map<string, string>();
    const inner: Engine = this.inner;
    for await (const chunk of inner.translate(misses, options)) {
      if (options.signal.aborted) return;
      if (chunk.textDelta !== undefined) {
        const before = chunk.restart === true ? '' : (streamed.get(chunk.id) ?? '');
        streamed.set(chunk.id, appendDelta(before, chunk.textDelta));
      }
      const key = keys.get(chunk.id);
      const copies = key ? (aliases.get(key) ?? []) : [];
      // A natural rewrite keeps an empty final: that leaves the Korean the reader typed.
      // Page, post, and selection text must not cache a bare language tag as a failure.
      const outgoing: TranslationChunk =
        chunk.final !== undefined && options.task !== NATURAL_AMERICAN_TASK
          ? {
              ...chunk,
              final: finalForCache(
                sources.get(chunk.id) ?? '',
                streamed.get(chunk.id) ?? '',
                chunk.final,
              ),
            }
          : chunk;
      if (outgoing.final !== undefined && key) {
        await this.cache.put(key, outgoing.final, outgoing.engine ?? this.inner.kind);
      }
      yield outgoing;
      for (const id of copies) {
        yield { ...outgoing, id };
      }
    }
  }
}
