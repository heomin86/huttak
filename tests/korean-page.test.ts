// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { listTranslatableBlocks } from '@/dom/blocks';
import { inferLanguage, languageOf } from '@/dom/detect';
import { buildSegment } from '@/dom/segment';
import { resolvePageTarget } from '@/shared/languages';

/**
 * A Korean news article is the page this fork is built for. These checks pin the collector's
 * decisions on a fixed document: every paragraph a reader sees becomes a segment, Korean
 * prose is read as Korean, a quoted English block keeps its own language, and a Korean page
 * opened by a Korean reader goes to English instead of being translated into itself.
 */

function parseFixture(name: string): void {
  const html = readFileSync(resolve(process.cwd(), 'e2e/fixtures', name), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
  document.documentElement.lang = parsed.documentElement.lang;
}

function blockFor(id: string): Element {
  const target = document.getElementById(id);
  if (!target) throw new Error(`missing #${id}`);
  for (const block of listTranslatableBlocks(document)) {
    if (block === target || block.contains(target) || target.contains(block)) return block;
  }
  throw new Error(`#${id} is not translated`);
}

describe('Korean news page', () => {
  beforeEach(() => {
    parseFixture('ko-news.html');
  });

  it('collects the headline and every paragraph as a segment', () => {
    for (const id of ['headline', 'lead', 'honorific', 'mixed', 'numbers', 'footer']) {
      const segment = buildSegment(blockFor(id));
      expect(segment?.source.trim().length, `#${id}`).toBeGreaterThan(0);
    }
  });

  it('reads Korean prose as Korean and keeps a quoted English block English', () => {
    for (const id of ['headline', 'lead', 'honorific', 'mixed', 'numbers']) {
      expect(languageOf(blockFor(id), 'ko'), `#${id}`).toBe('ko');
    }
    expect(languageOf(blockFor('quote'), 'ko')).toBe('en');
  });

  it('sends a Korean page to English for a Korean reader', () => {
    expect(resolvePageTarget('ko', 'ko', false)).toBe('en');
  });
});

describe('Korean script detection', () => {
  it('reads Hangul with a few Latin product names as Korean', () => {
    expect(inferLanguage('새 무인 대출기는 QR 코드와 NFC 카드를 모두 지원합니다.')).toBe('ko');
  });

  it('does not mistake Hangul with Hanja for Chinese', () => {
    expect(inferLanguage('大韓民國 헌법 제1조는 대한민국은 민주공화국이라고 정합니다.')).toBe('ko');
  });
});
