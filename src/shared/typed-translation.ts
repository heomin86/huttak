import { MAX_SEGMENT_TEXT } from '@/engine/offscreen/protocol';
import {
  HOME_LANGUAGE,
  isChromeOnlyLanguage,
  isTargetLanguage,
  pairPartner,
  type TargetLanguage,
} from './languages';

export type TypedDirection = 'to-home' | 'to-other';

export interface TypedPlan {
  /** False when the direction cannot be decided from the chosen target. */
  ok: boolean;
  sourceLanguage: string | null;
  targetLanguage: TargetLanguage;
  /** The half of the main pair this direction reads, for the swap control. */
  other: TargetLanguage;
}

/** The pair the product is built around: Korean and everything else it translates. */
export const PRIMARY_PAIR_TARGET: TargetLanguage = HOME_LANGUAGE;

/**
 * Which way a typed input is translated. The app's target language is the direction: a
 * reader whose UI target is Korean is typing English (or any other language) and wants
 * Korean, and one whose target is English is typing Korean and wants English.
 *
 * The source is left unset on purpose. PLaMo translates a paragraph without being told
 * which language it is in, and guessing here would be a second place to be wrong when a
 * user pastes a language the picker never offered.
 */
export function planTypedTranslation(targetLanguage: TargetLanguage): TypedPlan {
  const target = isTargetLanguage(targetLanguage) ? targetLanguage : PRIMARY_PAIR_TARGET;
  return {
    ok: true,
    sourceLanguage: null,
    targetLanguage: target,
    other: pairPartner(target),
  };
}

/**
 * Why typed text cannot be sent right now. `ready` means the model is loaded; every other
 * value names the setup step the page has to offer first.
 */
export type TypedReadiness =
  'ready' | 'no-consent' | 'model-absent' | 'model-partial' | 'model-busy' | 'model-error';

export interface TypedReadinessInput {
  consent: boolean;
  modelState:
    'absent' | 'partial' | 'downloading' | 'verifying' | 'ready' | 'loading' | 'loaded' | 'error';
  plamoReady: boolean;
}

/**
 * The gate in front of the model. Typed text uses the same engine, the same consent record
 * and the same load flow as a page, so it waits for the same things in the same order: agree
 * to the license, have the file, then let it load.
 *
 * A Chrome-only target is refused here too. The built-in translator is a page's real engine
 * only for languages PLaMo cannot translate, and typed text is not a page, so there is no
 * half-supported direction to cover. Returning `ready` for one would make this box look like
 * a PLaMo translation while another engine wrote it.
 */
export function typedReadiness(input: TypedReadinessInput): TypedReadiness {
  if (!input.consent) return 'no-consent';
  if (input.modelState === 'error') return 'model-error';
  if (input.modelState === 'downloading' || input.modelState === 'verifying') return 'model-busy';
  if (input.modelState === 'loading') return 'model-busy';
  if (input.plamoReady) return 'ready';
  if (input.modelState === 'ready' || input.modelState === 'loaded') return 'ready';
  if (input.modelState === 'partial') return 'model-partial';
  return 'model-absent';
}

/** True when the picked target can only be served by Chrome's built-in translator. */
export function typedTargetNeedsChrome(targetLanguage: string): boolean {
  return isChromeOnlyLanguage(targetLanguage);
}

/**
 * Ctrl+Enter (⌘+Enter on a Mac) runs the translation. It is the one accelerator a
 * multi-line box needs, because plain Enter has to keep inserting line breaks.
 */
export function isTranslateShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== 'Enter') return false;
  if (event.isComposing === true) return false;
  if (event.altKey === true || event.shiftKey === true) return false;
  return event.ctrlKey === true || event.metaKey === true;
}

/**
 * Control+Enter runs the natural-English rewrite on every platform, including a Mac.
 * Command+Enter is not used there: on a Mac it collides with other commands.
 * Plain Enter still inserts a line break.
 */
export function isNaturalRewriteShortcut(event: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== 'Enter') return false;
  if (event.isComposing === true) return false;
  if (event.altKey === true || event.shiftKey === true || event.metaKey === true) return false;
  return event.ctrlKey === true;
}

export interface NaturalRewriteKey {
  type: 'keydown' | 'keyup' | 'compositionend';
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

function blocksNaturalRewrite(event: NaturalRewriteKey): boolean {
  return event.altKey === true || event.shiftKey === true || event.metaKey === true;
}

/** Enter, the numpad key, or a composing event whose physical key is still Enter. */
function isEnterIdentity(event: NaturalRewriteKey): boolean {
  return (
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter' ||
    event.keyCode === 13
  );
}

/**
 * Control+Enter while the IME still owns the keydown. `key` is often Enter with
 * `isComposing`, or Process / 229 while `code` stays Enter. Command stays rejected.
 */
function isComposingControlEnter(event: NaturalRewriteKey): boolean {
  if (event.ctrlKey !== true || blocksNaturalRewrite(event) || !isEnterIdentity(event))
    return false;
  return event.isComposing === true || event.key !== 'Enter' || event.keyCode === 229;
}

/**
 * Control+Enter starts one rewrite. A keydown the IME is still composing does not: the
 * syllable is confirmed, and the rewrite waits for compositionend or the following keyup.
 * Text that is already committed still starts on that keydown. Command+Enter never starts.
 */
export function reduceNaturalRewriteKey(
  armed: boolean,
  event: NaturalRewriteKey,
): { armed: boolean; run: boolean } {
  if (event.type === 'keydown') {
    if (isNaturalRewriteShortcut(event)) return { armed: false, run: true };
    if (isComposingControlEnter(event)) return { armed: true, run: false };
    return { armed: false, run: false };
  }
  if (event.type === 'compositionend') {
    return armed ? { armed: false, run: true } : { armed: false, run: false };
  }
  if (!armed || event.isComposing === true) return { armed, run: false };
  if (isControlHeldEnter(event)) return { armed: false, run: true };
  return { armed: false, run: false };
}

/**
 * A matching Control+Enter keydown must not insert a line, even when a rewrite is already
 * running. The IME re-dispatches Enter after compositionend, and that keydown arrives only
 * after `canRewrite` has turned false. Command+Enter is not swallowed.
 */
export function settleNaturalRewriteKey(
  armed: boolean,
  canRewrite: boolean,
  event: NaturalRewriteKey,
): { armed: boolean; run: boolean; preventDefault: boolean } {
  const next = reduceNaturalRewriteKey(armed, event);
  return {
    armed: next.armed,
    run: next.run && canRewrite,
    preventDefault: event.type === 'keydown' && next.run,
  };
}

function isControlHeldEnter(event: NaturalRewriteKey): boolean {
  return event.ctrlKey === true && !blocksNaturalRewrite(event) && isEnterIdentity(event);
}

/**
 * Per-request ceiling for the typed box. It matches `MAX_SEGMENT_TEXT` so a request the
 * UI accepts is not rejected by the offscreen protocol. The engine still splits the text
 * into prompt-sized pieces.
 */
export const MAX_TYPED_CHARS = MAX_SEGMENT_TEXT;

/**
 * Trims the pasted text the way the page collector trims a block: runs of whitespace collapse
 * to one space and the ends are trimmed, but a real line break inside the text is kept as a
 * line break because the user typed it as structure.
 */
export function normalizeTypedInput(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

export interface CopyTarget {
  writeText(text: string): Promise<void>;
}

/** Copies the result, reporting failure instead of throwing so the button can show it. */
export async function copyTranslation(
  text: string,
  clipboard: CopyTarget | null | undefined,
): Promise<boolean> {
  if (text.trim().length === 0) return false;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
