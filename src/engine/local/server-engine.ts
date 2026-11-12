import { EngineError, isAbortError } from '../errors';
import type {
  GlossaryEntry,
  IdentifiedEngine,
  TranslateOptions,
  TranslateSegment,
  TranslationChunk,
} from '../types';

/**
 * Translates through an OpenAI-compatible chat server running on this computer, such as
 * `llama-server` from llama.cpp. It lets a Korean-first model (Kanana, Qwen3 and the like)
 * do the work instead of the in-browser PLaMo runtime.
 *
 * Only loopback addresses are accepted. Page text goes to a process on this machine and
 * nowhere else, which keeps the extension's "text does not leave the device" promise.
 */

export const DEFAULT_LOCAL_SERVER_URL = 'http://127.0.0.1:8080';

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  'zh-hans': 'Simplified Chinese',
  'zh-hant': 'Traditional Chinese',
};

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True for an http(s) URL on this computer. Anything else is refused before a request. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.trim().toLowerCase()] ?? code;
}

/**
 * Words the small Korean models were seen to leave in English or mistranslate on the bench
 * ("Monday" kept as is, "dashboard" as 감독판). They are offered only when the word is in
 * the text, and a reader's own glossary entry for the same word wins.
 */
export const BUILT_IN_KOREAN_TERMS: readonly GlossaryEntry[] = [
  { source: 'Monday', target: '월요일' },
  { source: 'Tuesday', target: '화요일' },
  { source: 'Wednesday', target: '수요일' },
  { source: 'Thursday', target: '목요일' },
  { source: 'Friday', target: '금요일' },
  { source: 'Saturday', target: '토요일' },
  { source: 'Sunday', target: '일요일' },
  { source: 'dashboard', target: '대시보드' },
  { source: 'workspace', target: '워크스페이스' },
  { source: 'repository', target: '저장소' },
  { source: 'pull request', target: '풀 리퀘스트' },
  { source: 'deploy', target: '배포' },
  { source: 'sign in', target: '로그인' },
  { source: 'log in', target: '로그인' },
  { source: 'sign up', target: '회원가입' },
  { source: 'checkout', target: '결제' },
  { source: 'subscription', target: '구독' },
  { source: 'sequel', target: '속편' },
];

const WEEKDAYS: Readonly<Record<string, string>> = {
  monday: '월요일',
  tuesday: '화요일',
  wednesday: '수요일',
  thursday: '목요일',
  friday: '금요일',
  saturday: '토요일',
  sunday: '일요일',
};

/**
 * A weekday has one Korean rendering, so an English weekday left in Korean output is a miss,
 * not a name. Kanana 1.5 kept "Monday" even with the glossary line, so the final text is
 * repaired here.
 */
export function fixKoreanOutput(text: string): string {
  return text.replace(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/giu,
    (word) => WEEKDAYS[word.toLowerCase()] ?? word,
  );
}

function termsFor(input: LocalPromptInput): GlossaryEntry[] {
  const lower = input.text.toLowerCase();
  const own = (input.glossary ?? []).filter((entry) => input.text.includes(entry.source));
  if (input.tgt !== 'ko') return own;
  const taken = new Set(own.map((entry) => entry.source.toLowerCase()));
  const builtIn = BUILT_IN_KOREAN_TERMS.filter(
    (entry) => !taken.has(entry.source.toLowerCase()) && lower.includes(entry.source.toLowerCase()),
  );
  return [...own, ...builtIn];
}

export interface LocalPromptInput {
  text: string;
  tgt: string;
  src?: string | undefined;
  glossary?: readonly GlossaryEntry[] | undefined;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * The instruction is kept short and in English: small instruct models follow an English
 * system prompt more reliably, and the output language is named explicitly.
 */
export function buildLocalMessages(input: LocalPromptInput): ChatMessage[] {
  const target = languageName(input.tgt);
  // Kept to the wording that scored best on the bench. Longer instructions (a register rule,
  // "translate every other word") made Kanana 1.5 drop clauses and invent numbers.
  const lines = [
    `You are a professional translator. Translate the user's text into ${target}.`,
    'Output only the translation, with no notes, quotes or explanations.',
    `Keep product and company names as written. Use natural, fluent ${target}.`,
  ];
  const terms = termsFor(input);
  if (terms.length > 0) {
    lines.push('Always use these translations for the listed terms:');
    for (const entry of terms) lines.push(`- ${entry.source} → ${entry.target}`);
  }
  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: input.text },
  ];
}

const END_MARKERS = ['<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|endoftext|>'];

/**
 * Drops a reasoning block that some models print before the answer, and any end-of-turn
 * marker a server leaks when the GGUF's stop token is set wrong (seen with a Kanana 1.5
 * conversion).
 */
export function stripReasoning(text: string): string {
  const end = text.indexOf('</think>');
  let answer = end === -1 ? text : text.slice(end + '</think>'.length);
  for (const marker of END_MARKERS) {
    const index = answer.indexOf(marker);
    if (index !== -1) answer = answer.slice(0, index);
  }
  return answer.trim();
}

export interface LocalServerOptions {
  baseUrl: string | (() => string);
  model?: string | (() => string) | undefined;
  fetch?: typeof fetch | undefined;
}

function read<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

function readDataLine(line: string): string | 'done' | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return 'done';
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown } }[];
      content?: unknown;
    };
    // `/v1/chat/completions` streams choices[0].delta; `/completion` streams content.
    const content = parsed.choices?.[0]?.delta?.content ?? parsed.content;
    return typeof content === 'string' && content.length > 0 ? content : null;
  } catch {
    // A keep-alive or a partial line; the next read completes it.
    return null;
  }
}

/**
 * Reads `data:` lines from an SSE body and yields the content deltas.
 * The last event often has no trailing newline, and the decoder holds a
 * trailing multibyte sequence until it is flushed. Dropping either one
 * cuts the last characters off the translation.
 */
async function* streamDeltas(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      if (done) buffer += decoder.decode();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        const parsed = readDataLine(line);
        if (parsed === 'done') return;
        if (parsed) yield parsed;
      }
      if (done) {
        const parsed = readDataLine(buffer);
        if (parsed && parsed !== 'done') yield parsed;
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** How the server's model wants its input. */
export type LocalPromptFormat = 'chat' | 'translategemma';

const TRANSLATE_GEMMA_LANGUAGES: Readonly<Record<string, string>> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  'zh-hans': 'Chinese',
  'zh-hant': 'Chinese',
};

/**
 * TranslateGemma reads `source_lang_code` / `target_lang_code` fields that llama-server's
 * OpenAI parser drops, so its chat template is rendered here, word for word from the GGUF.
 */
export function buildTranslateGemmaPrompt(text: string, src: string, tgt: string): string {
  const source = TRANSLATE_GEMMA_LANGUAGES[src] ?? languageName(src);
  const target = TRANSLATE_GEMMA_LANGUAGES[tgt] ?? languageName(tgt);
  return (
    `<start_of_turn>user\nYou are a professional ${source} (${src}) to ${target} (${tgt}) ` +
    `translator. Your goal is to accurately convey the meaning and nuances of the original ` +
    `${source} text while adhering to ${target} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${target} translation, without any additional explanations or commentary. ` +
    `Please translate the following ${source} text into ${target}:\n\n\n${text.trim()}` +
    `<end_of_turn>\n<start_of_turn>model\n`
  );
}

/** A TranslateGemma GGUF carries a chat template that reads the language-code fields. */
export function promptFormatFromTemplate(template: unknown): LocalPromptFormat {
  return typeof template === 'string' && template.includes('target_lang_code')
    ? 'translategemma'
    : 'chat';
}

export class LocalServerEngine implements IdentifiedEngine {
  readonly kind = 'local' as const;

  private formats = new Map<string, Promise<LocalPromptFormat>>();

  constructor(private readonly options: LocalServerOptions) {}

  /** Asks the server once which model it runs; a failure falls back to the chat API. */
  private format(baseUrl: string, fetchImpl: typeof fetch): Promise<LocalPromptFormat> {
    let known = this.formats.get(baseUrl);
    if (!known) {
      known = fetchImpl(`${baseUrl}/props`)
        .then(async (response) =>
          response.ok
            ? promptFormatFromTemplate(
                ((await response.json()) as { chat_template?: unknown }).chat_template,
              )
            : 'chat',
        )
        .catch(() => 'chat' as const);
      this.formats.set(baseUrl, known);
    }
    return known;
  }

  async *translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncIterable<TranslationChunk> {
    const baseUrl = read(this.options.baseUrl).replace(/\/+$/, '');
    if (!isLoopbackUrl(baseUrl)) {
      throw new EngineError('invalid-input', 'The local server must run on this computer.');
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const model = this.options.model === undefined ? undefined : read(this.options.model);
    const format = await this.format(baseUrl, fetchImpl);
    // TranslateGemma needs a source code. A page that did not say gets the other half of
    // the Korean/English pair.
    const source =
      options.src && options.src.trim().length > 0
        ? options.src
        : options.tgt === 'ko'
          ? 'en'
          : 'ko';

    for (const segment of segments) {
      if (options.signal.aborted) return;
      const chatBody = {
        ...(model ? { model } : {}),
        messages: buildLocalMessages({
          text: segment.text,
          tgt: options.tgt,
          src: options.src,
          glossary: options.glossary,
        }),
        temperature: 0,
        stream: true,
        // Some GGUF conversions miss the end-of-turn token, so the server would print it.
        stop: END_MARKERS,
        // Qwen3-style templates otherwise print a reasoning block first.
        chat_template_kwargs: { enable_thinking: false },
      };
      const completionBody = {
        prompt: buildTranslateGemmaPrompt(segment.text, source, options.tgt),
        temperature: 0,
        n_predict: 1024,
        stream: true,
        stop: ['<end_of_turn>'],
      };
      const translateGemma = format === 'translategemma';

      let response: Response;
      try {
        response = await fetchImpl(
          `${baseUrl}${translateGemma ? '/completion' : '/v1/chat/completions'}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(translateGemma ? completionBody : chatBody),
            signal: options.signal,
          },
        );
      } catch (error) {
        if (isAbortError(error) || options.signal.aborted) return;
        throw new EngineError(
          'local-server-unavailable',
          'The local translation server is not running.',
        );
      }
      if (!response.ok || !response.body) {
        throw new EngineError(
          'local-server-unavailable',
          `The local translation server answered HTTP ${String(response.status)}.`,
        );
      }

      let text = '';
      let shown = 0;
      try {
        for await (const delta of streamDeltas(response.body)) {
          text += delta;
          // Hold streamed text back while a reasoning block may still be open.
          if (text.trimStart().startsWith('<think>') && !text.includes('</think>')) continue;
          const visible = stripReasoning(text);
          if (visible.length > shown) {
            yield { id: segment.id, textDelta: visible.slice(shown), engine: this.kind };
            shown = visible.length;
          }
        }
      } catch (error) {
        if (isAbortError(error) || options.signal.aborted) return;
        throw error;
      }
      const answer = stripReasoning(text);
      yield {
        id: segment.id,
        final: options.tgt === 'ko' ? fixKoreanOutput(answer) : answer,
        engine: this.kind,
      };
    }
  }
}
