// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { NATURAL_AMERICAN_TASK, type Engine, type TranslateOptions } from '@/engine/types';
import {
  applyNaturalFieldResult,
  containsHangul,
  installNaturalFieldShortcut,
  readNaturalFieldDraft,
} from '@/dom/natural-field';
import { collectNaturalRewrite } from '@/dom/natural-rewrite';

const labels = { running: 'Rewriting…', failed: 'Failed' };

function press(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  target.focus();
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('Hangul in a page field', () => {
  it('recognizes syllables and jamo and ignores Latin text', () => {
    expect(containsHangul('오늘 늦을 것 같아요')).toBe(true);
    expect(containsHangul('ㄱ')).toBe(true);
    expect(containsHangul('Sounds good')).toBe(false);
  });

  it('reads the whole field when the caret is in Korean', () => {
    document.body.innerHTML = '<textarea id="box"></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '  오늘 회의가 길어요.  ';
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);

    const draft = readNaturalFieldDraft(document, box);
    expect(draft?.mode).toBe('value');
    expect(draft?.text).toBe('오늘 회의가 길어요.');
    expect(draft?.raw).toBe('  오늘 회의가 길어요.  ');
  });

  it('reads only a Hangul selection', () => {
    document.body.innerHTML = '<textarea id="box"></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = 'Hello 오늘 늦어요';
    box.focus();
    box.setSelectionRange(6, box.value.length);

    const draft = readNaturalFieldDraft(document, box);
    expect(draft?.mode).toBe('selection');
    expect(draft?.text).toBe('오늘 늦어요');
    expect(draft?.selectionStart).toBe(6);
  });

  it('leaves an English field and a password alone', () => {
    document.body.innerHTML = '<textarea id="note"></textarea><input id="secret" type="password">';
    const note = document.querySelector('textarea')!;
    note.value = 'See you tomorrow';
    note.focus();
    expect(readNaturalFieldDraft(document, note)).toBeNull();

    const secret = document.querySelector('input')!;
    secret.value = '비밀번호';
    secret.focus();
    expect(readNaturalFieldDraft(document, secret)).toBeNull();
  });

  it('does not take a non-Korean selection inside a Korean field', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘 Hello';
    box.focus();
    box.setSelectionRange(3, box.value.length);
    expect(readNaturalFieldDraft(document, box)).toBeNull();
  });
});

describe('writing the English back', () => {
  it('replaces a textarea and notifies the page', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘 늦어요';
    box.focus();
    const draft = readNaturalFieldDraft(document, box);
    const inputs: Event[] = [];
    box.addEventListener('input', (event) => inputs.push(event));

    expect(draft && applyNaturalFieldResult(draft, ' Running late. ')).toBe(true);
    expect(box.value).toBe('Running late.');
    expect(inputs).toHaveLength(1);
  });

  it('replaces only the selected Korean', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = 'Hello 오늘 늦어요';
    box.focus();
    box.setSelectionRange(6, box.value.length);
    const draft = readNaturalFieldDraft(document, box);

    expect(draft && applyNaturalFieldResult(draft, 'running late')).toBe(true);
    expect(box.value).toBe('Hello running late');
  });

  it('replaces Korean when the IME appended one newline after the snapshot', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘 늦어요';
    box.focus();
    const draft = readNaturalFieldDraft(document, box)!;
    box.value = `${draft.raw}\n`;

    expect(applyNaturalFieldResult(draft, 'Running late.')).toBe(true);
    expect(box.value).toBe('Running late.');
  });

  it('does not overwrite Korean the reader changed while the rewrite was in flight', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘 늦어요';
    box.focus();
    const draft = readNaturalFieldDraft(document, box)!;
    box.value = '오늘 늦어요. 다시 쓸게요';

    expect(applyNaturalFieldResult(draft, 'Running late.')).toBe(false);
    expect(box.value).toBe('오늘 늦어요. 다시 쓸게요');
  });

  it('replaces a contenteditable field', () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">오늘 늦어요</div>';
    const editor = document.querySelector('div')!;
    editor.focus();
    const draft = readNaturalFieldDraft(document, editor);

    expect(draft?.mode).toBe('value');
    expect(draft && applyNaturalFieldResult(draft, 'Running late.')).toBe(true);
    expect(editor.textContent).toBe('Running late.');
  });
});

describe('Control+Enter on a web page', () => {
  it('rewrites Korean and ignores Command+Enter and English', async () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    const seen: string[] = [];
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: (text) => {
        seen.push(text);
        return Promise.resolve('Running late.');
      },
    });

    box.value = '오늘 늦어요';
    const command = press(box, { key: 'Enter', metaKey: true });
    expect(command.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);

    const control = press(box, { key: 'Enter', ctrlKey: true });
    expect(control.defaultPrevented).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['오늘 늦어요']);
    expect(box.value).toBe('Running late.');
    expect(document.querySelector('sakutto-natural-status')).toBeNull();

    box.value = 'See you';
    const english = press(box, { key: 'Enter', ctrlKey: true });
    expect(english.defaultPrevented).toBe(false);
    stop();
  });

  it('shows a failure and keeps the Korean when the rewrite throws', async () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘 늦어요';
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: () => Promise.reject(new Error('offline')),
    });

    press(box, { key: 'Enter', ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(box.value).toBe('오늘 늦어요');
    expect(document.querySelector('sakutto-natural-status')?.textContent).toBe('Failed');
    stop();
  });

  it('ignores a key that is still composing', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '오늘';
    let called = false;
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: () => {
        called = true;
        return Promise.resolve('Hi');
      },
    });
    const event = press(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(called).toBe(false);
    stop();
  });

  it('does not pull focus back when the reader moved to another field', async () => {
    document.body.innerHTML = '<textarea id="a"></textarea><input id="b" />';
    const box = document.querySelector('textarea')!;
    const other = document.querySelector('input')!;
    box.value = '오늘 늦어요';
    let finish: (value: string) => void = () => {};
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: () => new Promise<string>((resolve) => (finish = resolve)),
    });
    press(box, { key: 'Enter', ctrlKey: true });
    other.focus();
    finish('Running late today');
    await Promise.resolve();
    await Promise.resolve();
    expect(box.value).toBe('Running late today');
    expect(document.activeElement).toBe(other);
    stop();
  });

  function composingField(): { box: HTMLTextAreaElement; calls: string[]; stop: () => void } {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '안녕하세요';
    const calls: string[] = [];
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: (text) => {
        calls.push(text);
        return Promise.resolve('Hello');
      },
    });
    return { box, calls, stop };
  }

  it('rewrites once after the last syllable is committed', async () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Process', code: 'Enter', keyCode: 229, ctrlKey: true, isComposing: true });
    expect(calls).toEqual([]);
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    expect(calls).toEqual(['안녕하세요']);
    await Promise.resolve();
    await Promise.resolve();
    expect(box.value).toBe('Hello');
    stop();
  });

  it('swallows the Control+Enter the IME repeats after committing', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    const repeated = press(box, { key: 'Enter', ctrlKey: true });
    expect(repeated.defaultPrevented).toBe(true);
    expect(calls).toEqual(['안녕하세요']);
    stop();
  });

  it('starts on keyup when the IME sends no compositionend', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    box.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', ctrlKey: true }));
    expect(calls).toEqual(['안녕하세요']);
    stop();
  });

  it('does not start when Control is released before the syllable is committed', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    box.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    expect(calls).toEqual([]);
    stop();
  });

  it('leaves Command+Enter alone while composing', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Enter', metaKey: true, isComposing: true });
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    expect(calls).toEqual([]);
    stop();
  });

  it('rewrites when Control+Enter ends composition and the echo Enter has no ctrlKey', async () => {
    document.body.innerHTML = '<textarea></textarea>';
    const box = document.querySelector('textarea')!;
    box.value = '안녕하세요';
    const calls: string[] = [];
    let finish: (value: string) => void = () => {};
    const stop = installNaturalFieldShortcut(document, {
      labels,
      rewrite: (text) => {
        calls.push(text);
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      },
    });
    box.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Enter' || event.keyCode === 13) box.value += '\n';
    });

    press(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    const composing = press(box, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    });
    expect(composing.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);

    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    expect(calls).toEqual(['안녕하세요']);

    const echo = press(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(echo.defaultPrevented).toBe(true);
    expect(calls).toEqual(['안녕하세요']);
    expect(box.value).toBe('안녕하세요');

    finish('Hello');
    await Promise.resolve();
    await Promise.resolve();
    expect(box.value).toBe('Hello');
    stop();
  });

  it('rewrites again after the IME echo of the first composing Control+Enter', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    press(box, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    const echo = press(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(echo.defaultPrevented).toBe(true);
    expect(calls).toEqual(['안녕하세요']);

    box.value = '감사합니다';
    press(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    press(box, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '다' }));
    expect(calls).toEqual(['안녕하세요', '감사합니다']);
    const again = press(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(again.defaultPrevented).toBe(true);
    expect(calls).toEqual(['안녕하세요', '감사합니다']);
    stop();
  });

  it('drops a missed Control keyup so a later Enter stays with the page', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    const typed = press(box, { key: 'a', code: 'KeyA' });
    expect(typed.defaultPrevented).toBe(false);
    const enter = press(box, { key: 'Enter', code: 'Enter' });
    expect(enter.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    stop();
  });

  it('does not rewrite the plain Enter that reveals a missed Control keyup', () => {
    const { box, calls, stop } = composingField();
    press(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    const enter = press(box, { key: 'Enter', code: 'Enter' });
    expect(enter.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    stop();
  });

  it('starts from keyup when the composing keydown never reported Control', () => {
    const { box, calls, stop } = composingField();
    const composing = press(box, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    });
    expect(composing.defaultPrevented).toBe(false);
    box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '요' }));
    expect(calls).toEqual([]);
    box.dispatchEvent(
      new KeyboardEvent('keyup', {
        bubbles: true,
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
      }),
    );
    expect(calls).toEqual(['안녕하세요']);
    stop();
  });
});

describe('the webpage rewrite request', () => {
  it('asks for natural American English and keeps the final text', async () => {
    let options: TranslateOptions | null = null;
    const engine: Engine = {
      async *translate(segments, next) {
        options = next;
        yield { id: segments[0]!.id, textDelta: 'Run' };
        yield { id: segments[0]!.id, textDelta: 'ning', restart: true };
        yield { id: segments[0]!.id, final: 'Running late.' };
      },
    };

    const result = await collectNaturalRewrite(
      engine,
      '  오늘 늦어요  ',
      new AbortController().signal,
      [{ source: '회의', target: 'the meeting' }],
    );

    expect(result).toBe('Running late.');
    expect(options).not.toBeNull();
    expect(options!.task).toBe(NATURAL_AMERICAN_TASK);
    expect(options!.src).toBe('ko');
    expect(options!.tgt).toBe('en');
    expect(options!.glossary).toEqual([{ source: '회의', target: 'the meeting' }]);
  });
});
