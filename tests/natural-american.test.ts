import { describe, expect, it } from 'vitest';
import { buildLocalMessages, buildTranslateGemmaPrompt } from '@/engine/local/server-engine';
import {
  NATURAL_AMERICAN_RULES,
  buildNaturalAmericanGemmaPrompt,
  buildNaturalAmericanMessages,
  buildNaturalAmericanPlamoPrompt,
  cleanNaturalAmericanOutput,
} from '@/engine/prompt/natural-american';
import { buildTranslationPrompt } from '@/engine/prompt/pfml3';

const KOREAN = '기다려 주셔서 감사합니다.';

describe('natural American English prompts', () => {
  it('asks every engine to keep the meaning and the register, and to answer in English only', () => {
    const plamo = buildNaturalAmericanPlamoPrompt({ text: KOREAN });
    const [system, user] = buildNaturalAmericanMessages({ text: KOREAN });
    const gemma = buildNaturalAmericanGemmaPrompt(KOREAN);

    for (const rule of NATURAL_AMERICAN_RULES) {
      expect(plamo).toContain(rule);
      expect(system?.content).toContain(rule);
      expect(gemma).toContain(rule);
    }
    expect(ruleText(NATURAL_AMERICAN_RULES)).toContain('word for word');
    expect(ruleText(NATURAL_AMERICAN_RULES)).toContain('translationese');
    expect(ruleText(NATURAL_AMERICAN_RULES)).toContain('AI-sounding');
    expect(ruleText(NATURAL_AMERICAN_RULES)).toContain('formal stays formal, casual stays casual');
    expect(ruleText(NATURAL_AMERICAN_RULES)).toContain('Output only the English');
    expect(user).toEqual({ role: 'user', content: KOREAN });
  });

  it('keeps the PLaMo translation format and fixes the direction at Korean to English', () => {
    const prompt = buildNaturalAmericanPlamoPrompt({
      text: KOREAN,
      glossary: [
        { source: '감사합니다', target: 'thank you' },
        { source: 'invoice', target: '청구서' },
      ],
    });

    expect(prompt).toContain('<|plamo:tag|>dataset<|plamo:msg|>translation');
    expect(prompt).toContain('<|plamo:key|>lang<|plamo:val|>ko');
    expect(prompt).toContain(`<|plamo:msg|>${KOREAN}`);
    expect(prompt).toContain('<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>');
    expect(prompt).toContain('감사합니다<|plamo:item|>thank you');
    expect(prompt).not.toContain('invoice');
    expect(prompt).not.toContain('form<|plamo:val|>');
    expect(prompt.startsWith('<|plamo:bos|>')).toBe(false);
  });

  it('leaves the page prompts untouched', () => {
    expect(buildTranslationPrompt({ text: KOREAN, tgt: 'en', src: 'ko' })).not.toContain(
      'translationese',
    );
    expect(buildLocalMessages({ text: KOREAN, tgt: 'en' })[0]?.content).not.toContain(
      'translationese',
    );
    expect(buildLocalMessages({ text: KOREAN, tgt: 'en' })[0]?.content).toContain(
      'professional translator',
    );
    const gemma = buildTranslateGemmaPrompt(KOREAN, 'ko', 'en');
    expect(gemma).toContain('accurately convey');
    expect(gemma).not.toContain('translationese');
  });

  it('drops a label, wrapped quotes, and an echoed instruction', () => {
    expect(cleanNaturalAmericanOutput('Translation: "Thanks for waiting."')).toBe(
      'Thanks for waiting.',
    );
    expect(cleanNaturalAmericanOutput(`${NATURAL_AMERICAN_RULES[0]}\n\nSounds good.`)).toBe(
      'Sounds good.',
    );
    expect(cleanNaturalAmericanOutput('Sounds good.')).toBe('Sounds good.');
    expect(cleanNaturalAmericanOutput('I said "hello" to them.')).toBe('I said "hello" to them.');
    expect(cleanNaturalAmericanOutput('\u201CThanks for waiting.\u201D')).toBe(
      'Thanks for waiting.',
    );
    expect(cleanNaturalAmericanOutput("'I can't make it.'")).toBe("I can't make it.");
    expect(cleanNaturalAmericanOutput('「Thanks for waiting.」')).toBe('Thanks for waiting.');
    expect(cleanNaturalAmericanOutput('§en§Thanks for waiting.')).toBe('Thanks for waiting.');
    expect(cleanNaturalAmericanOutput('§ko§Translation: "Thanks for waiting."')).toBe(
      'Thanks for waiting.',
    );
    expect(cleanNaturalAmericanOutput('§en§')).toBe('');
    expect(cleanNaturalAmericanOutput('See § 3 of the act.')).toBe('See § 3 of the act.');
  });

  it('keeps dialogue that opens with a quote and later closes another', () => {
    const straight = `"I can't tonight," she said. "Rain check?"`;
    const curly = '\u201CI can\u2019t tonight,\u201D she said. \u201CRain check?\u201D';
    const single = "'Don't go,' she said. 'Please.'";
    const wrapped = `「${straight}」`;

    expect(cleanNaturalAmericanOutput(straight)).toBe(straight);
    expect(cleanNaturalAmericanOutput(curly)).toBe(curly);
    expect(cleanNaturalAmericanOutput(single)).toBe(single);
    expect(cleanNaturalAmericanOutput(`Translation: ${straight}`)).toBe(straight);
    expect(cleanNaturalAmericanOutput(wrapped)).toBe(straight);
  });

  it('peels a single-quote wrapper around a word-final possessive', () => {
    expect(cleanNaturalAmericanOutput("'The dogs' toys are by the door.'")).toBe(
      "The dogs' toys are by the door.",
    );
    expect(cleanNaturalAmericanOutput('\u2018The dogs\u2019 toys are by the door.\u2019')).toBe(
      'The dogs\u2019 toys are by the door.',
    );
    expect(cleanNaturalAmericanOutput("'Those belong to the dogs''")).toBe(
      "Those belong to the dogs'",
    );
    const speech = "'The dogs,' she said. 'Stay.'";
    expect(cleanNaturalAmericanOutput(speech)).toBe(speech);
  });
});

function ruleText(rules: readonly string[]): string {
  return rules.join('\n');
}
