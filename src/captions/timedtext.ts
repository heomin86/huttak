import { isRecord } from '@/shared/object';

/**
 * A caption line with times in milliseconds. `endMs` is exclusive: the line at
 * exactly `endMs` belongs to the next cue, or to a gap when nothing follows.
 */
export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CaptionTrack {
  languageCode: string;
  name: string;
  automatic: boolean;
  url: string;
}

/** Cues the page already exposed through `<track>` / `video.textTracks`, so no fetch is needed. */
export interface InlineCues {
  languageCode: string;
  cues: Cue[];
}

export interface CaptionDiscovery {
  site: 'youtube' | 'x';
  tracks: CaptionTrack[];
  resourceUrls: string[];
  inline: InlineCues[];
}

const MAX_TRACKS = 40;
const MAX_URLS = 40;
const MAX_CUES = 4000;
const MAX_TEXT = 400;

const LETTER = /\p{L}/u;

export function primaryLanguage(code: string): string {
  return code.trim().toLowerCase().split('-')[0] ?? '';
}

export function captionSite(href: string): 'youtube' | 'x' | null {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be'
    ) {
      return 'youtube';
    }
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') return 'x';
    return null;
  } catch {
    return null;
  }
}

/** Stable id for the video the URL points at, or null on a feed where the URL has no video. */
export function videoKey(href: string): string | null {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `youtube:${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const fromQuery = url.searchParams.get('v');
      if (fromQuery) return `youtube:${fromQuery}`;
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts[0];
      const id = parts[1];
      if ((marker === 'shorts' || marker === 'live' || marker === 'embed') && id) {
        return `youtube:${id}`;
      }
      return null;
    }
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
      const match = /\/status\/(\d+)/.exec(url.pathname);
      return match?.[1] ? `x:${match[1]}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Prefer a manual track in the page language. Skip a track that is already the
 * target language: there is nothing to translate. Automatic captions lose to a
 * manual track in the same language.
 */
export function pickCaptionTrack(
  tracks: readonly CaptionTrack[],
  targetLanguage: string,
  sourceLanguage: string | null,
): CaptionTrack | null {
  const target = primaryLanguage(targetLanguage);
  const source = sourceLanguage ? primaryLanguage(sourceLanguage) : '';
  const usable = tracks.filter((track) => {
    const language = primaryLanguage(track.languageCode);
    if (target && language === target) return false;
    return track.url.length > 0 || language.length > 0;
  });
  if (usable.length === 0) return null;

  const ranked = [...usable].sort(
    (left, right) => trackScore(right, source) - trackScore(left, source),
  );
  return ranked[0] ?? null;
}

function trackScore(track: CaptionTrack, source: string): number {
  const language = primaryLanguage(track.languageCode);
  let score = 0;
  if (source && language === source) score += 100;
  if (!track.automatic) score += 10;
  if (language.length > 0) score += 1;
  if (track.url.length > 0) score += 1;
  return score;
}

/**
 * A timedtext URL scraped from the player response has no `pot` parameter and comes
 * back empty. The URL the player actually requests, visible in resource timing, has
 * the token. Replace the matching track URL with that one.
 */
export function mergePlayerTracks(
  tracks: readonly CaptionTrack[],
  resourceUrls: readonly string[],
): CaptionTrack[] {
  return tracks.map((track) => {
    const language = primaryLanguage(track.languageCode);
    const pot = resourceUrls.find((url) => potMatches(url, language));
    return pot ? { ...track, url: pot } : track;
  });
}

export function potMatches(url: string, language: string): boolean {
  if (!url.includes('/api/timedtext') || !url.includes('pot=')) return false;
  const found = timedtextLanguage(url);
  return found !== null && primaryLanguage(found) === language && language.length > 0;
}

export function timedtextLanguage(url: string): string | null {
  try {
    return new URL(url).searchParams.get('lang');
  } catch {
    return null;
  }
}

export function cuesForLanguage(inline: readonly InlineCues[], languageCode: string): Cue[] | null {
  const wanted = primaryLanguage(languageCode);
  const exact = inline.find(
    (item) =>
      item.cues.length > 0 && wanted.length > 0 && primaryLanguage(item.languageCode) === wanted,
  );
  if (exact) return exact.cues;
  if (wanted.length === 0) {
    return inline.find((item) => item.cues.length > 0)?.cues ?? null;
  }
  const unlabeled = inline.find((item) => item.cues.length > 0 && item.languageCode.trim() === '');
  return unlabeled?.cues ?? null;
}

export function parseCaptionBody(body: string): Cue[] {
  const trimmed = body.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return finalize(parseJson3(trimmed));
  if (trimmed.startsWith('WEBVTT') || trimmed.includes('-->')) return finalize(parseVtt(trimmed));
  if (trimmed.startsWith('<')) return finalize(parseSrv3(trimmed));
  return [];
}

export function cueAt(cues: readonly Cue[], timeMs: number): Cue | null {
  let found: Cue | null = null;
  for (const cue of cues) {
    if (cue.startMs <= timeMs && timeMs < cue.endMs) {
      if (!found || cue.startMs >= found.startMs) found = cue;
    }
  }
  return found;
}

export function isCaptionDiscovery(value: unknown): value is CaptionDiscovery {
  if (!isRecord(value)) return false;
  if (value.site !== 'youtube' && value.site !== 'x') return false;
  if (
    !Array.isArray(value.tracks) ||
    !Array.isArray(value.resourceUrls) ||
    !Array.isArray(value.inline)
  ) {
    return false;
  }
  if (value.tracks.length > MAX_TRACKS || value.resourceUrls.length > MAX_URLS) return false;
  if (value.inline.length > MAX_TRACKS) return false;
  if (!value.tracks.every(isCaptionTrack)) return false;
  if (!value.resourceUrls.every((url) => typeof url === 'string' && isHttpsUrl(url))) return false;
  return value.inline.every(isInlineCues);
}

function isCaptionTrack(value: unknown): value is CaptionTrack {
  if (!isRecord(value)) return false;
  return (
    typeof value.languageCode === 'string' &&
    value.languageCode.length <= 32 &&
    typeof value.name === 'string' &&
    value.name.length <= 120 &&
    typeof value.automatic === 'boolean' &&
    typeof value.url === 'string' &&
    (value.url.length === 0 || isHttpsUrl(value.url))
  );
}

function isInlineCues(value: unknown): value is InlineCues {
  if (!isRecord(value)) return false;
  if (typeof value.languageCode !== 'string' || value.languageCode.length > 32) return false;
  if (!Array.isArray(value.cues) || value.cues.length > MAX_CUES) return false;
  return value.cues.every(isCue);
}

function isCue(value: unknown): value is Cue {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 32 &&
    typeof value.startMs === 'number' &&
    Number.isFinite(value.startMs) &&
    typeof value.endMs === 'number' &&
    Number.isFinite(value.endMs) &&
    value.endMs > value.startMs &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    value.text.length <= MAX_TEXT
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function finalize(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
  return sorted.slice(0, MAX_CUES).map((cue, index) => ({
    id: `c${index}`,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text.slice(0, MAX_TEXT),
  }));
}

function parseJson3(body: string): Cue[] {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isRecord(value) || !Array.isArray(value.events)) return [];

  const cues: Cue[] = [];
  for (const event of value.events) {
    if (!isRecord(event) || typeof event.tStartMs !== 'number' || !Array.isArray(event.segs))
      continue;
    const text = cleanCaptionText(
      event.segs
        .map((segment) =>
          isRecord(segment) && typeof segment.utf8 === 'string' ? segment.utf8 : '',
        )
        .join(''),
    );
    if (!text || !LETTER.test(text)) continue;
    const duration =
      typeof event.dDurationMs === 'number' && event.dDurationMs > 0 ? event.dDurationMs : 2000;
    cues.push(cue(event.tStartMs, event.tStartMs + duration, text));
  }
  return cues;
}

function parseVtt(body: string): Cue[] {
  const lines = body.split(/\r?\n/);
  const cues: Cue[] = [];
  let index = 0;
  if (lines[0]?.startsWith('WEBVTT')) {
    index = 1;
    while (index < lines.length && (lines[index]?.trim() ?? '') !== '') index += 1;
    index += 1;
  }

  while (index < lines.length) {
    while (index < lines.length && (lines[index]?.trim() ?? '') === '') index += 1;
    if (index >= lines.length) break;

    let line = lines[index] ?? '';
    if (!line.includes('-->')) {
      index += 1;
      line = lines[index] ?? '';
    }
    const timing = parseArrow(line);
    if (!timing) {
      index += 1;
      continue;
    }
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && (lines[index]?.trim() ?? '') !== '') {
      textLines.push(lines[index] ?? '');
      index += 1;
    }
    const text = cleanCaptionText(textLines.join('\n'));
    if (!text || !LETTER.test(text)) continue;
    cues.push(cue(timing.start, timing.end, text));
  }
  return cues;
}

function parseSrv3(body: string): Cue[] {
  const cues: Cue[] = [];
  for (const match of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = match[1] ?? '';
    const start = Number(attr(attrs, 'start'));
    const duration = Number(attr(attrs, 'dur'));
    const text = cleanCaptionText(match[2] ?? '');
    if (!Number.isFinite(start) || !text || !LETTER.test(text)) continue;
    const durMs = Number.isFinite(duration) && duration > 0 ? duration * 1000 : 2000;
    cues.push(cue(start * 1000, start * 1000 + durMs, text));
  }
  if (cues.length > 0) return cues;

  for (const match of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = match[1] ?? '';
    const start = Number(attr(attrs, 't'));
    const duration = Number(attr(attrs, 'd'));
    const text = cleanCaptionText(match[2] ?? '');
    if (!Number.isFinite(start) || !text || !LETTER.test(text)) continue;
    const durMs = Number.isFinite(duration) && duration > 0 ? duration : 2000;
    cues.push(cue(start, start + durMs, text));
  }
  return cues;
}

function cue(startMs: number, endMs: number, text: string): Cue {
  const start = Math.max(0, Math.round(startMs));
  const end = Math.round(endMs);
  return {
    id: '',
    startMs: start,
    endMs: end > start ? end : start + 2000,
    text,
  };
}

function parseArrow(line: string): { start: number; end: number } | null {
  const parts = line.split('-->');
  if (parts.length < 2) return null;
  const start = parseClock(parts[0] ?? '');
  const end = parseClock(parts[1] ?? '');
  if (start === null || end === null) return null;
  return { start, end };
}

function parseClock(value: string): number | null {
  const token = value.trim().split(/\s+/)[0] ?? '';
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.](\d{1,3})$/.exec(token);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = (match[4] ?? '0').padEnd(3, '0').slice(0, 3);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction);
}

function attr(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(source);
  return match?.[1] ?? null;
}

function cleanCaptionText(value: string): string {
  const decoded = decodeXml(value).replace(/[\u200b\uFEFF]/g, '');
  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits: string) => fromCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCode(Number.parseInt(hex, 16)));
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
