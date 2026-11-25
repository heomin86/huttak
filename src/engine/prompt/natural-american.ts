import type { GlossaryEntry } from '../types';
import { buildTranslationPrompt } from './pfml3';

/**
 * What the model is told when the reader pastes Korean they wrote themselves.
 *
 * PLaMo 3 Translate only completes the PFML3 translation format, so these lines are that
 * prompt's context and the output language stays English. An instruct model on the local
 * llama.cpp server gets the same lines as its system prompt. Page translation does not
 * use this text.
 */
export const NATURAL_AMERICAN_RULES = [
  'Rewrite the Korean into American English a native speaker would actually use in the same situation.',
  'Keep the original meaning and the same register: formal stays formal, casual stays casual.',
  'Do not translate word for word. Avoid translationese and stiff, AI-sounding sentences.',
  'Output only the English. Do not add notes, quotes, or explanations.',
] as const;

export const NATURAL_AMERICAN_INSTRUCTION = NATURAL_AMERICAN_RULES.join('\n');

export interface NaturalAmericanInput {
  text: string;
  glossary?: readonly GlossaryEntry[] | undefined;
}

/** PFML3 prompt: Korean in, American English out, with the rewrite rules as context. */
export function buildNaturalAmericanPlamoPrompt(input: NaturalAmericanInput): string {
  const glossary = termsInText(input);
  return buildTranslationPrompt({
    text: input.text,
    src: 'ko',
    tgt: 'en',
    context: NATURAL_AMERICAN_INSTRUCTION,
    ...(glossary.length > 0 ? { glossary } : {}),
  });
}

export interface NaturalAmericanMessage {
  role: 'system' | 'user';
  content: string;
}

/** Chat prompt for a local instruct model. The page translator keeps its own system prompt. */
export function buildNaturalAmericanMessages(
  input: NaturalAmericanInput,
): NaturalAmericanMessage[] {
  const lines: string[] = [...NATURAL_AMERICAN_RULES];
  const glossary = termsInText(input);
  if (glossary.length > 0) {
    lines.push('When one of these terms appears, keep the listed wording:');
    for (const entry of glossary) lines.push(`- ${entry.source} → ${entry.target}`);
  }
  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: input.text },
  ];
}

/**
 * TranslateGemma still needs its turn markers, but the instruction is the rewrite rather
 * than the page translator's "accurately convey" line.
 */
export function buildNaturalAmericanGemmaPrompt(text: string): string {
  return (
    `<start_of_turn>user\n${NATURAL_AMERICAN_INSTRUCTION}\n` +
    `Please rewrite the following Korean (ko) text into American English (en):\n\n\n${text.trim()}` +
    `<end_of_turn>\n<start_of_turn>model\n`
  );
}

const LEAD_IN =
  /^(?:here(?:'s| is) (?:the |a )?(?:american )?english(?: (?:rewrite|translation|version))?|(?:american )?english|translation|rewrite)\s*:\s*/iu;

const WRAPPING_QUOTES: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['「', '」'],
  ['『', '』'],
];

/**
 * Drops a copied instruction, a "Translation:" label, or one pair of quotes the model
 * wrapped around the whole answer. Quotes that belong to the English stay: a line of
 * dialogue that opens with a quote and later closes another is not a wrapper.
 */
export function cleanNaturalAmericanOutput(value: string): string {
  let text = value.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    if (text.startsWith(NATURAL_AMERICAN_INSTRUCTION)) {
      text = text.slice(NATURAL_AMERICAN_INSTRUCTION.length).trim();
    }
    for (const rule of NATURAL_AMERICAN_RULES) {
      if (text.startsWith(rule)) text = text.slice(rule.length).trim();
    }
    const lead = LEAD_IN.exec(text);
    if (lead?.[0]) text = text.slice(lead[0].length).trim();
    text = stripWrappingQuotes(text);
    if (text === before) break;
  }
  return text.trim();
}

/** Straight apostrophe and the curly apostrophe models use inside contractions. */
const APOSTROPHE_MARKS = new Set(["'", '\u2019']);

function stripWrappingQuotes(text: string): string {
  for (const [open, close] of WRAPPING_QUOTES) {
    if (!text.startsWith(open) || !text.endsWith(close)) continue;
    if (text.length <= open.length + close.length) continue;
    const inner = text.slice(open.length, text.length - close.length);
    if (inner.trim().length === 0 || hasQuoteDelimiter(inner, open, close)) continue;
    return inner.trim();
  }
  return text;
}

/**
 * True when `inner` still uses this quote pair as punctuation. A second delimiter means
 * the outer pair is part of the sentence (quoted speech), not a wrapper around it.
 * An apostrophe inside a word (`can't`, `I'm`) or a word-final possessive (`dogs'`, `James'`)
 * is not a delimiter.
 */
function hasQuoteDelimiter(inner: string, open: string, close: string): boolean {
  const marks = open === close ? [open] : [open, close];
  for (const mark of marks) {
    let from = 0;
    while (from < inner.length) {
      const at = inner.indexOf(mark, from);
      if (at < 0) break;
      if (!isWordApostrophe(inner, mark, at)) return true;
      from = at + mark.length;
    }
  }
  return false;
}

function isWordApostrophe(text: string, mark: string, index: number): boolean {
  if (!APOSTROPHE_MARKS.has(mark)) return false;
  const prev = text[index - 1] ?? '';
  const next = text[index + 1] ?? '';
  if (!/[A-Za-z]/.test(prev)) return false;
  if (/[A-Za-z]/.test(next)) return true;
  // dogs', James' — the apostrophe ends the word. A closing quote after any other letter stays a quote.
  return prev.toLowerCase() === 's';
}

function termsInText(input: NaturalAmericanInput): GlossaryEntry[] {
  const seen = new Set<string>();
  const terms: GlossaryEntry[] = [];
  for (const entry of input.glossary ?? []) {
    const source = entry.source.trim();
    const target = entry.target.trim();
    if (source.length === 0 || target.length === 0) continue;
    if (!input.text.includes(source) || seen.has(source)) continue;
    seen.add(source);
    terms.push({ source, target });
  }
  return terms;
}
