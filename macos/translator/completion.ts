import { TRANSLATION_STOP_TOKENS } from '../../src/engine/prompt/pfml3';
import type { CompletionRequest } from '../../src/engine/in-browser/runtime';

/**
 * The same completion options the extension asks wllama for: temperature 0, the
 * prompt cache, and the PFML stop tokens. llama.cpp's `/completion` route tokenizes
 * that prompt with special tokens enabled, which is what the PLaMo tags need.
 */
export function completionBody(request: CompletionRequest): {
  prompt: string;
  n_predict: number;
  temperature: number;
  cache_prompt: boolean;
  stop: string[];
  stream: boolean;
} {
  return {
    prompt: request.prompt,
    n_predict: request.maxTokens,
    temperature: 0,
    cache_prompt: true,
    stop: [...TRANSLATION_STOP_TOKENS],
    stream: true,
  };
}

export function completionError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null;
  const error = payload.error;
  if (typeof error === 'string' && error.length > 0) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return null;
}

/** A `/completion` event. `done` means `content` is the whole answer, not the next piece. */
export function completionPiece(payload: unknown): { text: string; done: boolean } {
  if (typeof payload !== 'object' || payload === null) return { text: '', done: false };
  const done = 'stop' in payload && payload.stop === true;
  if ('content' in payload && typeof payload.content === 'string') {
    return { text: payload.content, done };
  }
  if ('choices' in payload && Array.isArray(payload.choices)) {
    const first = payload.choices[0];
    if (
      typeof first === 'object' &&
      first !== null &&
      'text' in first &&
      typeof first.text === 'string'
    ) {
      return { text: first.text, done };
    }
  }
  return { text: '', done };
}

/**
 * Reads llama-server's event stream. Partial events carry the next piece in `content`.
 * The closing event repeats the whole answer, so it is used only when nothing was streamed.
 */
export async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = false;

  const handle = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice('data:'.length).trim();
    if (data.length === 0 || data === '[DONE]') return;
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    const error = completionError(payload);
    if (error) throw new Error(error);
    const piece = completionPiece(payload);
    if (piece.done) {
      if (!streamed && piece.text.length > 0) onDelta(piece.text);
      return;
    }
    if (piece.text.length === 0) return;
    streamed = true;
    onDelta(piece.text);
  };

  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  buffer += decoder.decode();
  if (buffer.length > 0) handle(buffer);
}
