import { describe, expect, it } from 'vitest';
import {
  buildLocalMessages,
  buildTranslateGemmaPrompt,
  fixKoreanOutput,
  isLoopbackUrl,
  LocalServerEngine,
  promptFormatFromTemplate,
  stripReasoning,
} from '@/engine/local/server-engine';
import { SwitchingEngine } from '@/engine/local/switching-engine';
import type { IdentifiedEngine, TranslateOptions, TranslationChunk } from '@/engine/types';

function sse(parts: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        const line = `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`;
        controller.enqueue(encoder.encode(line));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function options(overrides: Partial<TranslateOptions> = {}): TranslateOptions {
  return {
    tgt: 'ko',
    form: 'polite',
    priority: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<TranslationChunk>): Promise<TranslationChunk[]> {
  const chunks: TranslationChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('local server address', () => {
  it('accepts only this computer', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8080')).toBe(true);
    expect(isLoopbackUrl('https://example.com')).toBe(false);
    expect(isLoopbackUrl('http://192.168.0.10:8080')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('local prompt', () => {
  it('names the target language and adds only glossary terms present in the text', () => {
    const [system, user] = buildLocalMessages({
      text: 'Open the dashboard.',
      tgt: 'ko',
      glossary: [
        { source: 'dashboard', target: '대시보드' },
        { source: 'invoice', target: '청구서' },
      ],
    });
    expect(system?.role).toBe('system');
    expect(system?.content).toContain('into Korean');
    expect(system?.content).toContain('dashboard → 대시보드');
    expect(system?.content).not.toContain('invoice');
    expect(user).toEqual({ role: 'user', content: 'Open the dashboard.' });
  });

  it('strips reasoning blocks and leaked end-of-turn markers', () => {
    expect(stripReasoning('<think>hmm</think>\n변경 사항을 저장했습니다.')).toBe(
      '변경 사항을 저장했습니다.',
    );
    expect(stripReasoning('거래가 확정됐습니다.<|eot_id|>')).toBe('거래가 확정됐습니다.');
  });
});

describe('Korean output repair', () => {
  it('turns a leftover English weekday into Korean and leaves names alone', () => {
    expect(fixKoreanOutput('Anthropic은 Monday에 Claude Opus 5.5를 출시했습니다.')).toBe(
      'Anthropic은 월요일에 Claude Opus 5.5를 출시했습니다.',
    );
    expect(fixKoreanOutput('Mondays 클럽')).toBe('Mondays 클럽');
  });

  it('offers built-in Korean terms only when they appear, and lets the reader override them', () => {
    const [system] = buildLocalMessages({
      text: 'Open the dashboard.',
      tgt: 'ko',
      glossary: [{ source: 'dashboard', target: '현황판' }],
    });
    expect(system?.content).toContain('dashboard → 현황판');
    expect(system?.content).not.toContain('대시보드');
    expect(system?.content).not.toContain('월요일');
  });
});

describe('local server engine', () => {
  it('streams deltas and finishes each segment with the clean text', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const engine = new LocalServerEngine({
      baseUrl: 'http://127.0.0.1:8080/',
      fetch: (async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return sse(['변경 사항을 ', '저장했습니다.', '<|eot_id|>']);
      }) as unknown as typeof fetch,
    });

    const chunks = await collect(
      engine.translate([{ id: 'a', text: 'Your changes have been saved.' }], options()),
    );

    expect(requests[0]?.url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(requests[0]?.body.stream).toBe(true);
    expect(requests[0]?.body.temperature).toBe(0);
    expect(chunks.at(-1)).toEqual({ id: 'a', final: '변경 사항을 저장했습니다.', engine: 'local' });
    const streamed = chunks.map((chunk) => chunk.textDelta ?? '').join('');
    expect(streamed).toBe('변경 사항을 저장했습니다.');
  });

  it('refuses a server that is not on this computer before sending anything', async () => {
    let called = false;
    const engine = new LocalServerEngine({
      baseUrl: 'https://translate.example.com',
      fetch: (async () => {
        called = true;
        return sse([]);
      }) as unknown as typeof fetch,
    });
    await expect(collect(engine.translate([{ id: 'a', text: 'Hi' }], options()))).rejects.toThrow(
      /this computer/,
    );
    expect(called).toBe(false);
  });

  it('reports a server that is not running', async () => {
    const engine = new LocalServerEngine({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    await expect(
      collect(engine.translate([{ id: 'a', text: 'Hi' }], options())),
    ).rejects.toMatchObject({ code: 'local-server-unavailable' });
  });
});

describe('TranslateGemma server', () => {
  it('is recognised from its chat template', () => {
    expect(promptFormatFromTemplate('{{ content["target_lang_code"] }}')).toBe('translategemma');
    expect(promptFormatFromTemplate('{{ messages }}')).toBe('chat');
    expect(promptFormatFromTemplate(undefined)).toBe('chat');
  });

  it('renders the template with language names and codes', () => {
    const prompt = buildTranslateGemmaPrompt('  Hello.  ', 'en', 'ko');
    expect(prompt).toContain('professional English (en) to Korean (ko) translator');
    expect(prompt).toContain('into Korean:\n\n\nHello.<end_of_turn>');
    expect(prompt.endsWith('<start_of_turn>model\n')).toBe(true);
  });

  it('sends a raw completion and reads its stream', async () => {
    const encoder = new TextEncoder();
    const calls: string[] = [];
    const engine = new LocalServerEngine({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.endsWith('/props')) {
          return Response.json({ chat_template: 'x target_lang_code y' });
        }
        expect(JSON.parse(String(init?.body)).prompt).toContain('to Korean (ko)');
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const content of ['안녕하세요', '.']) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch,
    });

    const first = await collect(engine.translate([{ id: 'a', text: 'Hello.' }], options()));
    await collect(engine.translate([{ id: 'b', text: 'Hi.' }], options()));
    expect(first.at(-1)).toEqual({ id: 'a', final: '안녕하세요.', engine: 'local' });
    expect(calls.filter((url) => url.endsWith('/props'))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/completion'))).toHaveLength(2);
  });
});

describe('engine switch', () => {
  function named(kind: 'plamo' | 'local'): IdentifiedEngine {
    return {
      kind,
      async *translate(segments) {
        for (const segment of segments) yield { id: segment.id, final: kind, engine: kind };
      },
    };
  }

  it('reads the choice for every request', async () => {
    let choice: 'plamo' | 'local' = 'plamo';
    const engine = new SwitchingEngine(
      { plamo: named('plamo'), local: named('local') },
      async () => choice,
    );
    const first = await collect(engine.translate([{ id: 'a', text: 'x' }], options()));
    choice = 'local';
    const second = await collect(engine.translate([{ id: 'a', text: 'x' }], options()));
    expect(first[0]?.final).toBe('plamo');
    expect(second[0]?.final).toBe('local');
    expect(engine.kind).toBe('local');
  });

  it('falls back to PLaMo when the settings cannot be read', async () => {
    const engine = new SwitchingEngine({ plamo: named('plamo'), local: named('local') }, () =>
      Promise.reject(new Error('storage')),
    );
    const chunks = await collect(engine.translate([{ id: 'a', text: 'x' }], options()));
    expect(chunks[0]?.final).toBe('plamo');
  });
});
