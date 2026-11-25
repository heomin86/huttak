import { describe, expect, it } from 'vitest';
import { MAX_SEGMENT_TEXT } from '@/engine/offscreen/protocol';
import {
  MAX_TYPED_CHARS,
  copyTranslation,
  isNaturalRewriteShortcut,
  isTranslateShortcut,
  reduceNaturalRewriteKey,
  type NaturalRewriteKey,
  normalizeTypedInput,
  planTypedTranslation,
  typedReadiness,
  typedTargetNeedsChrome,
  type TypedReadinessInput,
} from '@/shared/typed-translation';

describe('typed translation direction', () => {
  it('translates into the chosen target and offers the other half of the main pair', () => {
    expect(planTypedTranslation('ko')).toEqual({
      ok: true,
      sourceLanguage: null,
      targetLanguage: 'ko',
      other: 'en',
    });
    expect(planTypedTranslation('en').other).toBe('ko');
  });

  /**
   * The source is deliberately unset. PLaMo translates a paragraph without being told which
   * language it is in, and a guess here would be a second place to be wrong when a user
   * pastes a language the picker never offered.
   */
  it('never guesses the source language', () => {
    for (const target of ['ja', 'en', 'zh-hans', 'de'] as const) {
      expect(planTypedTranslation(target).sourceLanguage).toBeNull();
    }
  });

  it('falls back to Korean for a value that is not a target language', () => {
    // The settings normalizer refuses these, so this only guards a hand-edited record.
    const plan = planTypedTranslation('xx' as never);
    expect(plan.targetLanguage).toBe('ko');
    expect(plan.other).toBe('en');
  });

  it('keeps other targets as themselves instead of forcing the pair', () => {
    const plan = planTypedTranslation('de');
    expect(plan.targetLanguage).toBe('de');
    expect(plan.other).toBe('ko');
  });
});

describe('typed readiness gate', () => {
  const base: TypedReadinessInput = { consent: true, modelState: 'loaded', plamoReady: true };

  it('translates once the model is loaded and consent is recorded', () => {
    expect(typedReadiness(base)).toBe('ready');
  });

  it('asks for consent before doing anything else', () => {
    expect(typedReadiness({ ...base, consent: false })).toBe('no-consent');
    // Consent comes first even when the model is missing, so the onboarding gate is the one
    // the user sees rather than a download button they are not allowed to press.
    expect(typedReadiness({ consent: false, modelState: 'absent', plamoReady: false })).toBe(
      'no-consent',
    );
  });

  it('names the setup step before the model can run', () => {
    expect(typedReadiness({ ...base, modelState: 'absent', plamoReady: false })).toBe(
      'model-absent',
    );
    expect(typedReadiness({ ...base, modelState: 'partial', plamoReady: false })).toBe(
      'model-partial',
    );
    for (const state of ['downloading', 'verifying', 'loading'] as const) {
      expect(typedReadiness({ ...base, modelState: state, plamoReady: false })).toBe('model-busy');
    }
    expect(typedReadiness({ ...base, modelState: 'error', plamoReady: false })).toBe('model-error');
  });

  it('treats a stored file as ready even before the runtime reports it loaded', () => {
    for (const state of ['ready', 'loaded'] as const) {
      expect(typedReadiness({ ...base, modelState: state, plamoReady: false })).toBe('ready');
    }
  });

  it('never offers the built-in translator for typed text', () => {
    // A Chrome-only target has no PLaMo path. The page is refused in the UI instead of
    // quietly switching engines, which would show a non-PLaMo translation in a PLaMo box.
    expect(typedTargetNeedsChrome('pt')).toBe(true);
    expect(typedTargetNeedsChrome('ja')).toBe(false);
    expect(typedTargetNeedsChrome('de')).toBe(false);
  });
});

describe('typed input', () => {
  it('normalizes line endings and horizontal runs but keeps blank-line structure', () => {
    expect(normalizeTypedInput('a\r\nb\r\n\r\nc')).toBe('a\nb\n\nc');
    expect(normalizeTypedInput('  two   spaces\tand a tab  ')).toBe('two spaces and a tab');
    expect(normalizeTypedInput('line\nnext')).toBe('line\nnext');
    expect(normalizeTypedInput('')).toBe('');
    expect(normalizeTypedInput('   \n  ')).toBe('');
  });

  it('keeps the per-request ceiling in step with the engine protocol', () => {
    // A longer typed segment would be rejected before it reached the model.
    expect(MAX_TYPED_CHARS).toBe(MAX_SEGMENT_TEXT);
    expect(MAX_TYPED_CHARS).toBe(100_000);
  });

  it('still accepts a 20,000-character paste that used to be the ceiling', () => {
    const previousCeiling = 'x'.repeat(20_000);
    expect(normalizeTypedInput(previousCeiling)).toHaveLength(20_000);
    expect(previousCeiling.length).toBeLessThanOrEqual(MAX_TYPED_CHARS);
  });
});

describe('the run shortcut', () => {
  it('runs on Ctrl+Enter and Cmd+Enter', () => {
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isTranslateShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  });

  it('leaves a plain Enter to insert a line break', () => {
    // The box is for paragraphs, so Enter has to keep its normal meaning.
    expect(isTranslateShortcut({ key: 'Enter' })).toBe(false);
    expect(isTranslateShortcut({ key: 'Enter', shiftKey: true } as never)).toBe(false);
  });

  it('never fires from an IME composition or with Alt held', () => {
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: true, isComposing: true })).toBe(false);
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: true, altKey: true })).toBe(false);
  });

  it('ignores every other key', () => {
    expect(isTranslateShortcut({ key: 'a', ctrlKey: true })).toBe(false);
    expect(isTranslateShortcut({ key: 'Tab', ctrlKey: true })).toBe(false);
  });
});

describe('the natural-English rewrite shortcut', () => {
  it('runs on Control+Enter on every platform, including a Mac', () => {
    expect(isNaturalRewriteShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isNaturalRewriteShortcut({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true);
  });

  it('does not run on Command+Enter or Meta+Enter', () => {
    expect(isNaturalRewriteShortcut({ key: 'Enter', metaKey: true })).toBe(false);
    expect(isNaturalRewriteShortcut({ key: 'Enter', ctrlKey: true, metaKey: true })).toBe(false);
  });

  it('leaves a plain Enter, and ignores composition, Alt, Shift, and other keys', () => {
    expect(isNaturalRewriteShortcut({ key: 'Enter' })).toBe(false);
    expect(isNaturalRewriteShortcut({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isNaturalRewriteShortcut({ key: 'Enter', ctrlKey: true, isComposing: true })).toBe(
      false,
    );
    expect(isNaturalRewriteShortcut({ key: 'Enter', ctrlKey: true, altKey: true })).toBe(false);
    expect(isNaturalRewriteShortcut({ key: 'a', ctrlKey: true })).toBe(false);
  });

  it('starts once after a composing Control+Enter, on compositionend or the next keyup', () => {
    const composingEnter: NaturalRewriteKey = {
      type: 'keydown',
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      isComposing: true,
    };
    const processEnter: NaturalRewriteKey = {
      type: 'keydown',
      key: 'Process',
      code: 'Enter',
      keyCode: 229,
      ctrlKey: true,
      isComposing: true,
    };
    const end: NaturalRewriteKey = { type: 'compositionend' };
    const keyup: NaturalRewriteKey = {
      type: 'keyup',
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      isComposing: false,
    };

    expect(runsOf([composingEnter, end, keyup])).toEqual([1]);
    expect(runsOf([processEnter, { ...keyup, isComposing: true }, end])).toEqual([2]);
    expect(runsOf([processEnter, keyup, end])).toEqual([1]);
  });

  it('still starts a committed Control+Enter on keydown and never starts Command+Enter', () => {
    const committed: NaturalRewriteKey = { type: 'keydown', key: 'Enter', ctrlKey: true };
    const keyup: NaturalRewriteKey = { type: 'keyup', key: 'Enter', ctrlKey: true };
    expect(runsOf([committed, keyup, { type: 'compositionend' }])).toEqual([0]);

    const command: NaturalRewriteKey = {
      type: 'keydown',
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    };
    expect(
      runsOf([command, { type: 'compositionend' }, { type: 'keyup', key: 'Enter', metaKey: true }]),
    ).toEqual([]);
    expect(
      runsOf([{ type: 'keydown', key: 'Enter', isComposing: true }, { type: 'compositionend' }]),
    ).toEqual([]);
  });
});

function runsOf(events: NaturalRewriteKey[]): number[] {
  let armed = false;
  const runs: number[] = [];
  events.forEach((event, index) => {
    const next = reduceNaturalRewriteKey(armed, event);
    if (next.run) runs.push(index);
    armed = next.armed;
  });
  return runs;
}

describe('copying a translation', () => {
  it('copies the text when the clipboard accepts it', async () => {
    const written: string[] = [];
    const ok = await copyTranslation('訳文', {
      writeText: async (text) => {
        written.push(text);
      },
    });
    expect(ok).toBe(true);
    expect(written).toEqual(['訳文']);
  });

  it('reports a refused clipboard instead of throwing', async () => {
    expect(
      await copyTranslation('訳文', {
        writeText: async () => {
          throw new Error('NotAllowedError');
        },
      }),
    ).toBe(false);
    expect(await copyTranslation('訳文', null)).toBe(false);
    expect(await copyTranslation('   ', { writeText: async () => undefined })).toBe(false);
  });
});
