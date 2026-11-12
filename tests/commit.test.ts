import { describe, expect, it } from 'vitest';
import { appendDelta, commitPiece, dropRetranslation } from '@/engine/text/commit';
import { joinPreservingBreaks, splitKeepingLineBreaks } from '@/engine/text/sentences';

describe('stream commit', () => {
  it('treats a cumulative chunk as a snapshot and a short suffix as new text', () => {
    expect(appendDelta('<H', '>')).toBe('<H>');
    expect(appendDelta('안녕', '안녕하세요')).toBe('안녕하세요');
    expect(appendDelta('안녕', '하세요')).toBe('안녕하세요');
  });

  it('drops a second copy of the translation and keeps a translation that quotes the source', () => {
    const once = '안녕하세요. 이 문장은 한 번만 보여야 합니다.';
    expect(dropRetranslation('Hello world from the article.', `${once}${once}`)).toBe(once);
    const source = 'Hello world from the article itself.';
    expect(dropRetranslation(source, `訳:${source}`)).toBe(`訳:${source}`);
    expect(dropRetranslation('Hi', '訳:Hello')).toBe('訳:Hello');
  });

  it('keeps a real tail the final text dropped, and prefers final otherwise', () => {
    expect(commitPiece('Hello', '안녕하세요 끝', '안녕하세요')).toBe('안녕하세요 끝');
    expect(commitPiece('Hello', '짧은', '더 긴 최종 번역입니다')).toBe('더 긴 최종 번역입니다');
  });
});

describe('line breaks between pieces', () => {
  it('splits on content newlines and rejoins with the same runs', () => {
    expect(splitKeepingLineBreaks('One\n\nTwo <i1>link</i1>')).toEqual({
      parts: ['One', 'Two <i1>link</i1>'],
      breaks: ['\n\n'],
    });
    expect(splitKeepingLineBreaks('See <i1>a\nb</i1> today')).toEqual({
      parts: ['See <i1>a\nb</i1> today'],
      breaks: [],
    });
    expect(joinPreservingBreaks(['하나', '둘'], ['\n\n'], 'ko')).toBe('하나\n\n둘');
    expect(joinPreservingBreaks(['하나', '둘'], [undefined], 'ko')).toBe('하나 둘');
  });
});
