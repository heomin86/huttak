import { abortError, EngineError, isAbortError } from '../../src/engine/errors';
import type { CompletionRequest, LlamaRuntime } from '../../src/engine/in-browser/runtime';
import { availableParallelism } from 'node:os';
import {
  completionBody,
  completionError,
  completionPiece,
  readCompletionStream,
} from './completion';

export interface LlamaCppRuntimeOptions {
  /** Loopback origin of the llama-server this runtime calls, without a trailing slash. */
  origin: string;
  fetch?: typeof fetch;
}

/**
 * A `LlamaRuntime` for the extension's `InBrowserEngine`. Generation runs in llama.cpp
 * on this Mac. `backend` stays `cpu-wasm` because that is the interface's CPU slot;
 * the process itself is llama.cpp, with Metal when the server was started that way.
 */
export class LlamaCppRuntime implements LlamaRuntime {
  readonly backend = 'cpu-wasm' as const;
  readonly threads = Math.max(1, availableParallelism());
  readonly parallel = 1;

  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LlamaCppRuntimeOptions) {
    this.origin = options.origin.replace(/\/+$/u, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<void> {
    if (request.signal.aborted) throw abortError();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}/completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completionBody(request)),
        signal: request.signal,
      });
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) throw abortError();
      throw new EngineError('local-server-unavailable', 'The on-device model is not running.', {
        cause: error,
      });
    }

    if (!response.ok || !response.body) {
      throw new EngineError(
        'local-server-unavailable',
        `The on-device model answered HTTP ${String(response.status)}.`,
      );
    }

    const type = response.headers.get('content-type') ?? '';
    try {
      if (type.includes('application/json')) {
        const payload = (await response.json()) as unknown;
        const error = completionError(payload);
        if (error) {
          throw new EngineError('model-load-failed', error);
        }
        const piece = completionPiece(payload);
        if (piece.text.length > 0) request.onToken(piece.text);
      } else {
        await readCompletionStream(response.body, (delta) => {
          if (!request.signal.aborted) request.onToken(delta);
        });
      }
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) throw abortError();
      if (error instanceof EngineError) throw error;
      throw new EngineError('model-load-failed', 'The translation request failed.', {
        cause: error,
      });
    }

    if (request.signal.aborted) throw abortError();
  }

  async dispose(): Promise<void> {
    // The server process owns the model. The runtime is only the HTTP client.
  }
}
