import { describe, expect, it } from 'vitest';
import type { CompletionRequest, LlamaRuntime } from '@/engine/in-browser/runtime';
import { InBrowserEngine } from '@/engine/in-browser/engine';
import { TRANSLATION_STOP_TOKENS } from '@/engine/prompt/pfml3';
import { isEngineError } from '@/engine/errors';
import {
  completionBody,
  completionPiece,
  readCompletionStream,
} from '../macos/translator/completion';
import { selectionDirection } from '../macos/translator/direction';
import { translateSelection } from '../macos/translator/translate';

class RecordingRuntime implements LlamaRuntime {
  readonly backend = 'cpu-wasm' as const;
  readonly threads = 1;
  readonly parallel = 1;
  readonly prompts: string[] = [];

  constructor(private readonly answer: string) {}

  async complete(request: CompletionRequest): Promise<void> {
    this.prompts.push(request.prompt);
    request.onToken(this.answer);
  }

  async dispose(): Promise<void> {}
}

function sse(events: readonly string[]): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(events.join('\n'));
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

describe('selection direction', () => {
  it('translates English into Korean and Korean into English', () => {
    expect(selectionDirection('The meeting starts at nine.')).toEqual({
      source: 'en',
      target: 'ko',
    });
    expect(selectionDirection('회의는 아홉 시에 시작합니다.')).toEqual({
      source: 'ko',
      target: 'en',
    });
  });

  it('sends another detected script to Korean and leaves a number without a source', () => {
    expect(selectionDirection('会議は九時に始まります。')).toEqual({
      source: 'ja',
      target: 'ko',
    });
    expect(selectionDirection('42')).toEqual({ source: null, target: 'ko' });
  });
});

describe('llama.cpp completion', () => {
  it('asks for the same stop tokens and a deterministic decode', () => {
    const request: CompletionRequest = {
      prompt: 'prompt',
      maxTokens: 48,
      signal: new AbortController().signal,
      onToken: () => undefined,
    };
    expect(completionBody(request)).toEqual({
      prompt: 'prompt',
      n_predict: 48,
      temperature: 0,
      cache_prompt: true,
      stop: [...TRANSLATION_STOP_TOKENS],
      stream: true,
    });
  });

  it('keeps streamed pieces and ignores the final copy of the whole answer', async () => {
    let text = '';
    await readCompletionStream(
      sse([
        'data: {"content":"안","stop":false}',
        '',
        'data: {"content":"녕","stop":false}',
        '',
        'data: {"content":"안녕","stop":true}',
        '',
        'data: [DONE]',
        '',
      ]),
      (delta) => {
        text += delta;
      },
    );
    expect(text).toBe('안녕');
  });

  it('uses the closing content when the server sent no pieces', async () => {
    let text = '';
    await readCompletionStream(sse(['data: {"content":"안녕","stop":true}', '']), (delta) => {
      text += delta;
    });
    expect(text).toBe('안녕');
    expect(completionPiece({ choices: [{ text: 'Hi' }] })).toEqual({ text: 'Hi', done: false });
  });
});

describe('translateSelection', () => {
  it('calls the in-browser engine with the Korean pair and returns its final text', async () => {
    const runtime = new RecordingRuntime('회의는 아홉 시에 시작합니다.');
    const engine = new InBrowserEngine(runtime);
    const result = await translateSelection(
      engine,
      'The meeting starts at nine.',
      new AbortController().signal,
    );

    expect(result).toEqual({
      text: '회의는 아홉 시에 시작합니다.',
      source: 'en',
      target: 'ko',
      engine: 'plamo',
    });
    const prompt = runtime.prompts[0] ?? '';
    expect(prompt).toContain('The meeting starts at nine.');
    expect(prompt).toContain('<|plamo:key|>lang<|plamo:val|>en');
    expect(prompt).toContain('<|plamo:key|>lang<|plamo:val|>ko<|plamo:msg|>');
    expect(prompt).not.toContain('form<|plamo:val|>');
  });

  it('points a Korean selection at English', async () => {
    const runtime = new RecordingRuntime('The meeting starts at nine.');
    const engine = new InBrowserEngine(runtime);
    const result = await translateSelection(
      engine,
      '회의는 아홉 시에 시작합니다.',
      new AbortController().signal,
    );
    expect(result.target).toBe('en');
    expect(result.source).toBe('ko');
    expect(runtime.prompts[0]).toContain('<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>');
  });

  it('rejects an empty selection', async () => {
    const engine = new InBrowserEngine(new RecordingRuntime('x'));
    await expect(translateSelection(engine, '   ', new AbortController().signal)).rejects.toSatisfy(
      (error: unknown) => isEngineError(error) && error.code === 'invalid-input',
    );
  });
});
