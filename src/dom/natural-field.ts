import {
  MAX_TYPED_CHARS,
  isNaturalRewriteShortcut,
  normalizeTypedInput,
} from '@/shared/typed-translation';
import { focusedEditableField } from './blocks';

/**
 * Hangul syllables, compatibility jamo, and conjoining jamo. A field without one of these
 * is left alone so Control+Enter can still mean "send" on that page.
 */
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/u;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url']);

const STATUS_NAME = 'sakutto-natural-status';

export function containsHangul(text: string): boolean {
  return HANGUL.test(text);
}

/**
 * A field whose text the reader typed and that we can replace.
 * Password, number, date, and select controls are not a sentence.
 */
export function isRewritableField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    if (element.disabled || element.readOnly) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    return TEXT_INPUT_TYPES.has(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

export interface NaturalFieldDraft {
  field: HTMLElement;
  /** Normalized Korean sent to the model. */
  text: string;
  mode: 'value' | 'selection';
  /** Exact field text, or the exact selected slice, at the moment of the key. */
  raw: string;
  selectionStart: number;
  selectionEnd: number;
  range: Range | null;
}

function plainText(field: HTMLElement): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value;
  return field.innerText || field.textContent || '';
}

function selectedSlice(
  field: HTMLElement,
  doc: Document,
): {
  text: string;
  start: number;
  end: number;
  range: Range | null;
} | null {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    if (start === end) return null;
    return { text: field.value.slice(start, end), start, end, range: null };
  }

  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!field.contains(range.commonAncestorContainer)) return null;
  return { text: selection.toString(), start: 0, end: 0, range: range.cloneRange() };
}

/**
 * Korean the reader is typing in the focused field, or null when Control+Enter should
 * fall through to the page. A Hangul selection is rewritten on its own. Otherwise the
 * whole field is rewritten, and only when the caret is not holding a non-Korean selection.
 */
export function readNaturalFieldDraft(
  doc: Document,
  target: EventTarget | null,
): NaturalFieldDraft | null {
  const fromTarget = target instanceof Element ? focusedEditableField(target) : null;
  const field = fromTarget ?? focusedEditableField(doc.activeElement);
  if (!field || !isRewritableField(field) || !(field instanceof HTMLElement)) return null;
  if (field.closest(STATUS_NAME)) return null;

  const selected = selectedSlice(field, doc);
  if (selected && selected.text.length > 0) {
    const text = normalizeTypedInput(selected.text);
    if (!containsHangul(text) || text.length > MAX_TYPED_CHARS) return null;
    return {
      field,
      text,
      mode: 'selection',
      raw: selected.text,
      selectionStart: selected.start,
      selectionEnd: selected.end,
      range: selected.range,
    };
  }

  const raw = plainText(field);
  const text = normalizeTypedInput(raw);
  if (!containsHangul(text) || text.length === 0 || text.length > MAX_TYPED_CHARS) return null;
  return {
    field,
    text,
    mode: 'value',
    raw,
    selectionStart: 0,
    selectionEnd: 0,
    range: null,
  };
}

function setNativeValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
}

function notifyInput(field: HTMLElement, english: string): void {
  field.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: english,
    }),
  );
}

/**
 * Writes the English back only when the field still holds the same Korean. Returns false
 * when the reader kept typing, so a late result does not wipe the newer text.
 */
export function applyNaturalFieldResult(draft: NaturalFieldDraft, english: string): boolean {
  const field = draft.field;
  if (!field.isConnected) return false;
  const next = english.trim();
  if (next.length === 0) return false;

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (draft.mode === 'selection') {
      const slice = field.value.slice(draft.selectionStart, draft.selectionEnd);
      if (slice !== draft.raw) return false;
      const value =
        field.value.slice(0, draft.selectionStart) + next + field.value.slice(draft.selectionEnd);
      setNativeValue(field, value);
      const caret = draft.selectionStart + next.length;
      field.setSelectionRange(caret, caret);
    } else {
      if (field.value !== draft.raw) return false;
      setNativeValue(field, next);
      field.setSelectionRange(next.length, next.length);
    }
    notifyInput(field, next);
    return true;
  }

  if (draft.mode === 'selection' && draft.range) {
    const range = draft.range;
    if (!range.startContainer.isConnected || range.toString() !== draft.raw) return false;
    range.deleteContents();
    range.insertNode(field.ownerDocument.createTextNode(next));
    notifyInput(field, next);
    return true;
  }

  if (plainText(field) !== draft.raw) return false;
  field.replaceChildren(field.ownerDocument.createTextNode(next));
  notifyInput(field, next);
  return true;
}

export interface NaturalFieldShortcut {
  rewrite(text: string, signal: AbortSignal): Promise<string>;
  labels: { running: string; failed: string };
}

function statusNode(doc: Document): HTMLElement {
  const existing = doc.querySelector(STATUS_NAME);
  if (existing instanceof HTMLElement) return existing;
  const node = doc.createElement(STATUS_NAME);
  node.setAttribute('role', 'status');
  const dark = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches === true;
  node.style.cssText = [
    'position:fixed',
    'z-index:2147483646',
    'left:16px',
    'bottom:16px',
    'max-width:min(360px, calc(100vw - 32px))',
    'padding:8px 12px',
    'border-radius:10px',
    dark ? 'border:1px solid #2d3947' : 'border:1px solid #d5dde6',
    dark ? 'background:#151b23' : 'background:#ffffff',
    dark ? 'color:#e7edf4' : 'color:#18202d',
    'font:12px/1.45 "Segoe UI", "Hiragino Sans", "Noto Sans KR", sans-serif',
    'box-shadow:0 8px 24px rgb(15 23 32 / 16%)',
  ].join(';');
  doc.documentElement.append(node);
  return node;
}

/**
 * Control+Enter in a web page field rewrites Korean the reader typed. The natural-English
 * screen has its own listener. This one stays out of page translation: a field with no
 * Hangul does not take the key.
 */
export function installNaturalFieldShortcut(
  doc: Document,
  shortcut: NaturalFieldShortcut,
): () => void {
  let generation = 0;
  let controller: AbortController | null = null;
  let hideTimer = 0;

  const hide = (): void => {
    if (hideTimer !== 0) doc.defaultView?.clearTimeout(hideTimer);
    hideTimer = 0;
    doc.querySelector(STATUS_NAME)?.remove();
  };

  const show = (text: string, persist: boolean): void => {
    if (hideTimer !== 0) doc.defaultView?.clearTimeout(hideTimer);
    hideTimer = 0;
    statusNode(doc).textContent = text;
    if (!persist) {
      hideTimer = doc.defaultView?.setTimeout(hide, 4000) ?? 0;
    }
  };

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.repeat) return;
    if (!isNaturalRewriteShortcut(event)) return;
    const draft = readNaturalFieldDraft(doc, event.target);
    if (!draft) return;
    event.preventDefault();
    event.stopPropagation();

    controller?.abort();
    const current = new AbortController();
    controller = current;
    const token = ++generation;
    show(shortcut.labels.running, true);

    void shortcut
      .rewrite(draft.text, current.signal)
      .then((english) => {
        if (token !== generation || current.signal.aborted) return;
        if (english.trim().length === 0 || !applyNaturalFieldResult(draft, english)) {
          // An empty result is a failed rewrite. A field that changed under us is the
          // reader still typing, so the status just goes away.
          if (english.trim().length === 0) show(shortcut.labels.failed, false);
          else hide();
          return;
        }
        hide();
      })
      .catch(() => {
        if (token !== generation || current.signal.aborted) return;
        show(shortcut.labels.failed, false);
      });
  };

  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    generation += 1;
    controller?.abort();
    doc.removeEventListener('keydown', onKeyDown, true);
    hide();
  };
}
