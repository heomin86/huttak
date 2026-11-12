// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverCaptionsInPage, fetchCaptionBodyInPage } from '@/captions/discover';
import { CaptionSession, type CaptionLabels, type CaptionStart } from '@/captions/session';
import {
  cueAt,
  mergePlayerTracks,
  parseCaptionBody,
  pickCaptionTrack,
  videoKey,
  type CaptionTrack,
} from '@/captions/timedtext';
import { translateCues } from '@/captions/translate';
import { fakeTranslate } from '@/dom/fake-engine';
import type { Engine, TranslateOptions, TranslateSegment } from '@/engine/types';

const labels: CaptionLabels = {
  translating: 'translating',
  missing: 'missing',
  failed: 'failed',
  sameLanguage: 'same',
};

const start: CaptionStart = {
  targetLanguage: 'ko',
  sourceLanguage: 'en',
  form: 'polite',
};

function setPage(url: string): void {
  const happy = (window as unknown as { happyDOM?: { setURL: (next: string) => void } }).happyDOM;
  if (!happy) throw new Error('happy-dom is not available');
  happy.setURL(url);
}

function track(languageCode: string, automatic = false): CaptionTrack {
  return {
    languageCode,
    name: languageCode,
    automatic,
    url: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
  };
}

function captionHost(): HTMLElement | null {
  return document.querySelector('sakutto-caption');
}

async function waitForCaption(predicate: (host: HTMLElement) => boolean): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const host = captionHost();
    if (host && predicate(host)) return host;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`caption overlay was ${captionHost()?.dataset.caption ?? 'absent'}`);
}

afterEach(() => {
  document.querySelector('sakutto-caption')?.remove();
  document.querySelector('[data-sakutto-caption-hide]')?.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('caption files', () => {
  it('reads json3 events and skips pauses', () => {
    const cues = parseCaptionBody(
      JSON.stringify({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 1200,
            segs: [{ utf8: 'Hello' }, { utf8: '\n' }, { utf8: 'there' }],
          },
          { tStartMs: 1200 },
          { tStartMs: 1500, dDurationMs: 800, segs: [{ utf8: 'Next line' }] },
        ],
      }),
    );

    expect(cues).toEqual([
      { id: 'c0', startMs: 0, endMs: 1200, text: 'Hello\nthere' },
      { id: 'c1', startMs: 1500, endMs: 2300, text: 'Next line' },
    ]);
    expect(cueAt(cues, 1200)).toBeNull();
    expect(cueAt(cues, 1199)?.id).toBe('c0');
    expect(cueAt(cues, 1500)?.id).toBe('c1');
    expect(cueAt(cues, 2300)).toBeNull();
  });

  it('keeps a spoken phrase together instead of one cue per word', () => {
    const appended = parseCaptionBody(
      JSON.stringify({
        events: [
          { tStartMs: 0, dDurationMs: 400, segs: [{ utf8: 'Hello' }] },
          { tStartMs: 400, dDurationMs: 400, aAppend: 1, segs: [{ utf8: ' there' }] },
          { tStartMs: 800, dDurationMs: 500, aAppend: 1, segs: [{ utf8: ' friend.' }] },
          { tStartMs: 1400, dDurationMs: 400, segs: [{ utf8: 'Next' }] },
          { tStartMs: 1800, dDurationMs: 400, segs: [{ utf8: ' line.' }] },
        ],
      }),
    );
    expect(appended.map((item) => item.text)).toEqual(['Hello there friend.', 'Next line.']);
    expect(appended[0]).toMatchObject({ startMs: 0, endMs: 1300 });
    expect(appended[1]).toMatchObject({ startMs: 1400, endMs: 2200 });

    const rolling = parseCaptionBody(
      JSON.stringify({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 4000,
            segs: [{ utf8: 'Hello everyone and welcome' }],
          },
          {
            tStartMs: 1400,
            dDurationMs: 3600,
            segs: [{ utf8: 'everyone and welcome to' }],
          },
          {
            tStartMs: 1800,
            dDurationMs: 3400,
            segs: [{ utf8: "and welcome to today's video." }],
          },
        ],
      }),
    );
    expect(rolling).toEqual([
      {
        id: 'c0',
        startMs: 1000,
        endMs: 5200,
        text: "Hello everyone and welcome to today's video.",
      },
    ]);

    const spoken = parseCaptionBody(
      JSON.stringify({
        events: [
          { tStartMs: 0, dDurationMs: 300, segs: [{ utf8: 'The' }] },
          { tStartMs: 300, dDurationMs: 300, segs: [{ utf8: 'quick' }] },
          { tStartMs: 600, dDurationMs: 300, segs: [{ utf8: 'brown' }] },
          { tStartMs: 900, dDurationMs: 400, segs: [{ utf8: 'fox.' }] },
        ],
      }),
    );
    expect(spoken).toEqual([{ id: 'c0', startMs: 0, endMs: 1300, text: 'The quick brown fox.' }]);
  });

  it('reads WebVTT and srv3', () => {
    const vtt = parseCaptionBody(`WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello &amp; welcome

00:01.500 --> 00:04.000
Second line
`);
    expect(vtt.map((cue) => cue.text)).toEqual(['Hello & welcome', 'Second line']);
    expect(vtt[0]).toMatchObject({ startMs: 1000, endMs: 4000 });
    expect(vtt[1]).toMatchObject({ startMs: 1500, endMs: 4000 });

    const srv3 = parseCaptionBody(
      '<transcript><text start="1.5" dur="2">Hello <c>world</c></text></transcript>',
    );
    expect(srv3).toEqual([{ id: 'c0', startMs: 1500, endMs: 3500, text: 'Hello world' }]);

    const paragraphs = parseCaptionBody('<timedtext><p t="500" d="1000">안녕</p></timedtext>');
    expect(paragraphs).toEqual([{ id: 'c0', startMs: 500, endMs: 1500, text: '안녕' }]);

    const xVtt = parseCaptionBody(`WEBVTT

00:00:00.000 --> 00:00:01.240
<X-word-ms ms=160,80,120 index=1 character_ranges=0-4,5-6,7-11>Yeah, I mean America 250.</X-word-ms>
`);
    expect(xVtt).toEqual([
      { id: 'c0', startMs: 0, endMs: 1240, text: 'Yeah, I mean America 250.' },
    ]);
  });

  it('picks a manual source track and skips the target language', () => {
    const tracks = [track('ko'), track('en', true), track('en'), track('ja')];

    expect(pickCaptionTrack(tracks, 'ko', 'en')?.automatic).toBe(false);
    expect(pickCaptionTrack(tracks, 'ko', 'en')?.languageCode).toBe('en');
    expect(pickCaptionTrack(tracks, 'ko', null)?.languageCode).toBe('en');
    expect(pickCaptionTrack([track('ko')], 'ko', 'en')).toBeNull();
  });

  it('replaces a base URL with the player URL that carries a pot token', () => {
    const merged = mergePlayerTracks(
      [track('en')],
      [
        'https://www.youtube.com/api/timedtext?v=abc&lang=ja&pot=other',
        'https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=json3&pot=TOKEN',
      ],
    );
    expect(merged[0]?.url).toContain('pot=TOKEN');
  });

  it('names the video in a watch, shorts, or status URL', () => {
    expect(videoKey('https://www.youtube.com/watch?v=abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(videoKey('https://www.youtube.com/shorts/abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(videoKey('https://youtu.be/abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(videoKey('https://x.com/someone/status/1234567890')).toBe('x:1234567890');
    expect(videoKey('https://x.com/home')).toBeNull();
  });
});

describe('caption translation', () => {
  it('translates the line on screen before the lines that follow', async () => {
    const seen: string[] = [];
    const engine: Engine = {
      async *translate(segments: readonly TranslateSegment[], options: TranslateOptions) {
        seen.push(segments.map((segment) => segment.text).join('|'));
        yield* fakeTranslate(segments, options);
      },
    };
    const cues = [
      { id: 'c0', startMs: 0, endMs: 1000, text: 'one' },
      { id: 'c1', startMs: 1000, endMs: 2000, text: 'two' },
      { id: 'c2', startMs: 2000, endMs: 3000, text: 'three' },
    ];
    const done = new Map<string, string>();
    await translateCues(engine, cues, {
      targetLanguage: 'ko',
      sourceLanguage: 'en',
      form: 'polite',
      signal: new AbortController().signal,
      nowMs: 1200,
      onCue: (id, text) => done.set(id, text),
    });

    expect(seen).toEqual(['two', 'three|one']);
    expect(done.get('c1')).toBe('§ko§two');
    expect(done.get('c0')).toBe('§ko§one');
  });

  it('reports the line on screen before the following lines finish', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: Engine = {
      async *translate(segments: readonly TranslateSegment[], options: TranslateOptions) {
        if (segments.some((segment) => segment.text !== 'two')) await gate;
        yield* fakeTranslate(segments, options);
      },
    };
    const cues = [
      { id: 'c0', startMs: 0, endMs: 1000, text: 'one' },
      { id: 'c1', startMs: 1000, endMs: 2000, text: 'two' },
      { id: 'c2', startMs: 2000, endMs: 3000, text: 'three' },
    ];
    const done: string[] = [];
    const pending = translateCues(engine, cues, {
      targetLanguage: 'ko',
      sourceLanguage: 'en',
      form: 'polite',
      signal: new AbortController().signal,
      nowMs: 1200,
      onCue: (_id, text) => done.push(text),
    });

    for (let attempt = 0; attempt < 40 && done.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(done).toEqual(['§ko§two']);
    release();
    await pending;
    expect(done).toEqual(['§ko§two', '§ko§three', '§ko§one']);
  });
});

describe('caption session', () => {
  it('draws the translated line for the video clock and follows a seek', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    const video = document.createElement('video');
    document.body.append(video);
    video.currentTime = 0.4;
    let discoveries = 0;
    const session = new CaptionSession(
      document,
      {
        discover: async () => {
          discoveries += 1;
          return {
            site: 'youtube',
            tracks: [track('en'), track('ko')],
            resourceUrls: [],
            inline: [],
          };
        },
        readCaption: async () =>
          JSON.stringify({
            events: [
              { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
              { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Again' }] },
            ],
          }),
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    const first = await waitForCaption((host) => host.dataset.caption === '§ko§Hello');
    expect(first.dataset.state).toBe('line');
    expect(document.querySelector('[data-sakutto-caption-hide]')).not.toBeNull();

    session.start(start);
    expect(discoveries).toBe(1);

    video.currentTime = 1.2;
    video.dispatchEvent(new Event('timeupdate'));
    await waitForCaption((host) => host.dataset.caption === '§ko§Again');
    expect(document.querySelector('[data-sakutto-caption-hide]')?.textContent).toContain(
      'opacity:0',
    );

    session.stop();
    expect(captionHost()).toBeNull();
  });

  it('keeps the current Korean line until the next line is translated', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    const video = document.createElement('video');
    video.currentTime = 0.4;
    document.body.append(video);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new CaptionSession(
      document,
      {
        discover: async () => ({
          site: 'youtube',
          tracks: [track('en')],
          resourceUrls: [],
          inline: [],
        }),
        readCaption: async () =>
          JSON.stringify({
            events: [
              { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
              { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Later' }] },
            ],
          }),
      },
      {
        async *translate(segments, options) {
          if (segments.some((segment) => segment.text === 'Later')) await gate;
          yield* fakeTranslate(segments, options);
        },
      },
      labels,
    );

    session.start(start);
    await waitForCaption((host) => host.dataset.caption === '§ko§Hello');
    video.currentTime = 1.2;
    video.dispatchEvent(new Event('timeupdate'));
    const held = await waitForCaption(
      (host) => host.dataset.caption === '§ko§Hello' && host.dataset.state === 'line',
    );
    expect(held.dataset.caption).toBe('§ko§Hello');

    release();
    await waitForCaption((host) => host.dataset.caption === '§ko§Later');
    session.stop();
  });

  it('says when the video has no caption file', async () => {
    setPage('https://x.com/someone/status/1234567890');
    document.body.append(document.createElement('video'));
    const session = new CaptionSession(
      document,
      {
        discover: async () => ({ site: 'x', tracks: [], resourceUrls: [], inline: [] }),
        readCaption: async () => null,
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    const host = await waitForCaption((item) => item.dataset.caption === 'missing');
    expect(host.dataset.state).toBe('status');
    expect(document.querySelector('[data-sakutto-caption-hide]')).toBeNull();
    session.stop();
  });

  it('says when the caption file comes back empty', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    document.body.append(document.createElement('video'));
    const session = new CaptionSession(
      document,
      {
        discover: async () => ({
          site: 'youtube',
          tracks: [track('en')],
          resourceUrls: [],
          inline: [],
        }),
        readCaption: async () => '   ',
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    const host = await waitForCaption((item) => item.dataset.caption === 'failed');
    expect(host.dataset.state).toBe('status');
    session.stop();
  });

  it('says when the only track is already in the target language', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    document.body.append(document.createElement('video'));
    const session = new CaptionSession(
      document,
      {
        discover: async () => ({
          site: 'youtube',
          tracks: [track('ko')],
          resourceUrls: [],
          inline: [],
        }),
        readCaption: async () => {
          throw new Error('should not fetch a track that is already translated');
        },
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    const host = await waitForCaption((item) => item.dataset.caption === 'same');
    expect(host.dataset.state).toBe('status');
    session.stop();
  });

  it('uses cues the page already exposed when the file cannot be fetched', async () => {
    setPage('https://x.com/someone/status/1234567890');
    const video = document.createElement('video');
    video.currentTime = 0.2;
    document.body.append(video);
    const session = new CaptionSession(
      document,
      {
        discover: async () => ({
          site: 'x',
          tracks: [],
          resourceUrls: [],
          inline: [
            {
              languageCode: 'en',
              cues: [{ id: 'c0', startMs: 0, endMs: 2000, text: 'From the track' }],
            },
          ],
        }),
        readCaption: async () => null,
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    await waitForCaption((host) => host.dataset.caption === '§ko§From the track');
    session.stop();
  });

  it('hides the English line X paints inside the player and leaves the controls', async () => {
    setPage('https://x.com/someone/status/1234567890');
    const player = document.createElement('div');
    player.dataset.testid = 'videoPlayer';
    const video = document.createElement('video');
    video.currentTime = 0.2;
    const caption = document.createElement('span');
    caption.textContent = 'From the track';
    const controls = document.createElement('button');
    controls.textContent = 'CC';
    const tweet = document.createElement('div');
    tweet.dataset.testid = 'tweetText';
    tweet.textContent = 'From the track';
    player.append(video, caption, controls);
    document.body.append(player, tweet);

    const session = new CaptionSession(
      document,
      {
        discover: async () => ({
          site: 'x',
          tracks: [],
          resourceUrls: [],
          inline: [
            {
              languageCode: 'en',
              cues: [{ id: 'c0', startMs: 0, endMs: 2000, text: 'From the track' }],
            },
          ],
        }),
        readCaption: async () => null,
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    await waitForCaption((host) => host.dataset.caption === '§ko§From the track');

    expect(caption.getAttribute('data-sakutto-x-caption')).toBe('');
    expect(controls.hasAttribute('data-sakutto-x-caption')).toBe(false);
    expect(tweet.hasAttribute('data-sakutto-x-caption')).toBe(false);
    const css = document.querySelector('[data-sakutto-caption-hide]')?.textContent ?? '';
    expect(css).toContain('data-sakutto-x-caption');
    expect(css).toContain('visibility:hidden');
    expect(css).toContain('opacity:0');
    expect(css).not.toContain('display:none');

    session.stop();
    expect(caption.hasAttribute('data-sakutto-x-caption')).toBe(false);
    expect(document.querySelector('[data-sakutto-caption-hide]')).toBeNull();
  });

  it('does nothing on a page that is not YouTube or X', () => {
    setPage('https://example.com/article');
    document.body.append(document.createElement('video'));
    const session = new CaptionSession(
      document,
      {
        discover: async () => {
          throw new Error('should not look for captions here');
        },
        readCaption: async () => null,
      },
      { translate: fakeTranslate },
      labels,
    );

    session.start(start);
    expect(captionHost()).toBeNull();
    session.stop();
  });
});

describe('caption probe', () => {
  it('reads YouTube tracks from the live player without calling out of its own body', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    const player = document.createElement('div');
    player.id = 'movie_player';
    Object.assign(player, {
      getPlayerResponse: () => ({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',
                languageCode: 'en',
                name: { simpleText: 'English' },
              },
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr',
                languageCode: 'en',
                kind: 'asr',
                name: { simpleText: 'English (auto)' },
              },
            ],
          },
        },
      }),
    });
    document.body.append(player);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      {
        name: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&fmt=json3&pot=TOKEN',
      } as PerformanceResourceTiming,
    ]);

    const source = discoverCaptionsInPage.toString();
    expect(source).toContain('movie_player');
    expect(source).toContain('timedtext');
    expect(source).not.toContain('pickCaptionTrack');

    const discovered = await discoverCaptionsInPage();
    expect(discovered?.site).toBe('youtube');
    expect(discovered?.tracks).toEqual([
      {
        languageCode: 'en',
        name: 'English',
        automatic: false,
        url: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',
      },
      {
        languageCode: 'en',
        name: 'English (auto)',
        automatic: true,
        url: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr',
      },
    ]);
    expect(discovered?.resourceUrls[0]).toContain('pot=TOKEN');
  });

  it('does not request a caption from an unrelated host', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unrelated host');
    });

    const body = await fetchCaptionBodyInPage('en', 'https://evil.example/caption.vtt');
    expect(body).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches a tokenised timedtext URL without rewriting its query', async () => {
    setPage('https://www.youtube.com/watch?v=abcdefghijk');
    const pot = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&fmt=json3&pot=TOKEN';
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      return new Response('{"events":[]}', { status: 200 });
    });

    const body = await fetchCaptionBodyInPage('en', pot);
    expect(body).toContain('events');
    expect(requests).toEqual([pot]);
    expect(fetchCaptionBodyInPage.toString()).not.toContain('parseCaptionBody');
  });

  it('reads an X track element', async () => {
    setPage('https://x.com/someone/status/99');
    const video = document.createElement('video');
    const trackElement = document.createElement('track');
    trackElement.kind = 'subtitles';
    trackElement.srclang = 'en';
    trackElement.label = 'English';
    trackElement.src = 'https://video.twimg.com/captions/en.vtt';
    video.append(trackElement);
    document.body.append(video);

    const discovered = await discoverCaptionsInPage();
    expect(discovered?.site).toBe('x');
    expect(discovered?.tracks[0]).toMatchObject({
      languageCode: 'en',
      url: 'https://video.twimg.com/captions/en.vtt',
      automatic: false,
    });
  });

  it('reads X cues once the empty data track leaves disabled', async () => {
    setPage('https://x.com/someone/status/99');
    const video = document.createElement('video');
    const trackElement = document.createElement('track');
    trackElement.kind = 'subtitles';
    trackElement.srclang = 'en';
    trackElement.label = 'en (auto-generated)';
    trackElement.src = 'data:,WEBVTT';
    video.append(trackElement);
    let mode = 'disabled';
    const textTrack = {
      kind: 'subtitles',
      language: 'en',
      label: 'en (auto-generated)',
      get mode(): string {
        return mode;
      },
      set mode(value: string) {
        mode = value;
      },
      get cues(): { startTime: number; endTime: number; text: string }[] | null {
        if (mode === 'disabled') return null;
        return [
          {
            startTime: 0,
            endTime: 1.24,
            text: '<X-word-ms ms=160,80>Yeah, I mean America 250.</X-word-ms>',
          },
        ];
      },
    };
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      get: () => [textTrack],
    });
    document.body.append(video);

    const discovered = await discoverCaptionsInPage();
    expect(discovered?.tracks).toEqual([]);
    expect(discovered?.inline[0]?.cues).toEqual([
      { id: 'c0', startMs: 0, endMs: 1240, text: 'Yeah, I mean America 250.' },
    ]);
  });

  it('does not keep looking when an X video has no subtitle track', async () => {
    setPage('https://x.com/someone/status/99');
    document.body.append(document.createElement('video'));
    const started = Date.now();
    const discovered = await discoverCaptionsInPage();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(discovered).toMatchObject({ site: 'x', tracks: [], inline: [] });
  });
});
