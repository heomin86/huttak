import type {
  IdentifiedEngine,
  TranslateOptions,
  TranslateSegment,
  TranslationChunk,
} from '../types';

/**
 * Sends each request to the engine the reader chose in settings: the in-browser PLaMo
 * runtime or a llama.cpp server on this computer. The choice is read per request so a
 * change in the options page applies to the next paragraph without reloading anything.
 */
export class SwitchingEngine implements IdentifiedEngine {
  private current: IdentifiedEngine;

  constructor(
    private readonly engines: { plamo: IdentifiedEngine; local: IdentifiedEngine },
    private readonly choose: () => Promise<'plamo' | 'local'>,
  ) {
    this.current = engines.plamo;
  }

  get kind() {
    return this.current.kind;
  }

  async *translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncIterable<TranslationChunk> {
    const choice = await this.choose().catch(() => 'plamo' as const);
    this.current = this.engines[choice];
    yield* this.current.translate(segments, options);
  }
}
