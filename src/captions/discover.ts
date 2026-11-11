import type { CaptionDiscovery } from './timedtext';

/**
 * Reads the caption tracks of the open video from the page itself.
 *
 * Chrome injects this function into the page's main world and keeps only the
 * function's own source, so it must not call anything defined outside its body.
 * The player response's `baseUrl` has no PO token; since 2025 those URLs answer
 * HTTP 200 with an empty body. The URL the player requests after a track is
 * selected carries `pot` and is what a later fetch has to use.
 */
export async function discoverCaptionsInPage(): Promise<CaptionDiscovery | null> {
  function siteOf(href: string): 'youtube' | 'x' | null {
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

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function httpsUrl(value: string): string {
    try {
      const url = new URL(value, location.href);
      const host = url.hostname.replace(/^www\./, '');
      const allowed =
        url.protocol === 'https:' &&
        /(^|\.)((youtube|youtu)\.com|youtu\.be|ytimg\.com|googlevideo\.com|twimg\.com|x\.com|twitter\.com)$/.test(
          host,
        );
      return allowed ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function trackName(value: unknown, fallback: string): string {
    if (!isRecord(value)) return fallback;
    if (typeof value.simpleText === 'string' && value.simpleText.trim()) return value.simpleText;
    const runs = value.runs;
    const first = Array.isArray(runs) ? runs[0] : undefined;
    if (isRecord(first) && typeof first.text === 'string' && first.text.trim()) return first.text;
    return fallback;
  }

  function tracksFromResponse(response: unknown): CaptionDiscovery['tracks'] {
    if (!isRecord(response)) return [];
    const captions = response.captions;
    if (!isRecord(captions)) return [];
    const renderer = captions.playerCaptionsTracklistRenderer;
    if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) return [];

    const tracks: CaptionDiscovery['tracks'] = [];
    for (const item of renderer.captionTracks) {
      if (!isRecord(item) || typeof item.baseUrl !== 'string') continue;
      const languageCode = typeof item.languageCode === 'string' ? item.languageCode : '';
      const url = httpsUrl(item.baseUrl);
      if (!url || !languageCode) continue;
      tracks.push({
        languageCode,
        name: trackName(item.name, languageCode).slice(0, 120),
        automatic: item.kind === 'asr',
        url,
      });
      if (tracks.length >= 40) break;
    }
    return tracks;
  }

  function resourceUrls(): string[] {
    const performanceRef = globalThis.performance;
    if (!performanceRef || typeof performanceRef.getEntriesByType !== 'function') return [];
    const urls: string[] = [];
    for (const entry of performanceRef.getEntriesByType('resource')) {
      const name = typeof entry.name === 'string' ? entry.name : '';
      if (!name.includes('/api/timedtext') && !name.includes('.vtt')) continue;
      const url = httpsUrl(name);
      if (!url || urls.includes(url)) continue;
      urls.push(url);
      if (urls.length >= 40) break;
    }
    return urls;
  }

  function clean(value: string): string {
    return value
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .slice(0, 400);
  }

  function cuesFromTrack(track: TextTrack): CaptionDiscovery['inline'][number]['cues'] {
    const list = track.cues;
    if (!list) return [];
    const cues: CaptionDiscovery['inline'][number]['cues'] = [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (!item) continue;
      const text = clean('text' in item && typeof item.text === 'string' ? item.text : '');
      if (!text || !/\p{L}/u.test(text)) continue;
      const start = Math.max(0, Math.round(item.startTime * 1000));
      const end = Math.round(item.endTime * 1000);
      cues.push({
        id: `c${cues.length}`,
        startMs: start,
        endMs: end > start ? end : start + 2000,
        text,
      });
      if (cues.length >= 4000) break;
    }
    return cues;
  }

  function enableTextTracks(): boolean {
    let found = false;
    for (const video of document.querySelectorAll('video')) {
      const list = video.textTracks;
      if (!list) continue;
      for (let index = 0; index < list.length; index += 1) {
        const track = list[index];
        if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
        found = true;
        if (track.mode === 'disabled') track.mode = 'hidden';
      }
    }
    return found;
  }

  function inlineCues(): CaptionDiscovery['inline'] {
    const inline: CaptionDiscovery['inline'] = [];
    for (const video of document.querySelectorAll('video')) {
      const list = video.textTracks;
      if (!list) continue;
      for (let index = 0; index < list.length; index += 1) {
        const track = list[index];
        if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
        const cues = cuesFromTrack(track);
        if (cues.length === 0) continue;
        inline.push({ languageCode: track.language || '', cues });
        if (inline.length >= 40) return inline;
      }
    }
    return inline;
  }

  function elementTracks(): CaptionDiscovery['tracks'] {
    const tracks: CaptionDiscovery['tracks'] = [];
    for (const element of document.querySelectorAll('video track')) {
      if (!(element instanceof HTMLTrackElement)) continue;
      const kind = element.kind || element.getAttribute('kind') || '';
      if (kind && kind !== 'subtitles' && kind !== 'captions') continue;
      const url = httpsUrl(element.src || element.getAttribute('src') || '');
      if (!url) continue;
      const languageCode = element.srclang || '';
      tracks.push({
        languageCode,
        name: (element.label || languageCode || 'captions').slice(0, 120),
        automatic: false,
        url,
      });
      if (tracks.length >= 40) break;
    }
    return tracks;
  }

  function hasSubtitleTrack(): boolean {
    if (document.querySelector('video track')) return true;
    for (const video of document.querySelectorAll('video')) {
      const list = video.textTracks;
      if (!list) continue;
      for (let index = 0; index < list.length; index += 1) {
        const track = list[index];
        if (track && (track.kind === 'subtitles' || track.kind === 'captions')) return true;
      }
    }
    return false;
  }

  function vttTracks(): CaptionDiscovery['tracks'] {
    const found: CaptionDiscovery['tracks'] = [];
    for (const url of resourceUrls()) {
      if (!url.includes('.vtt') && !url.includes('/subtitles/')) continue;
      found.push({
        languageCode: '',
        name: 'captions',
        automatic: true,
        url,
      });
      if (found.length >= 40) break;
    }
    return found;
  }

  const site = siteOf(location.href);
  if (!site) return null;

  let tracks: CaptionDiscovery['tracks'] = [];
  if (site === 'youtube') {
    const player = document.querySelector('#movie_player') as {
      getPlayerResponse?: () => unknown;
    } | null;
    const fromPlayer =
      player && typeof player.getPlayerResponse === 'function'
        ? tracksFromResponse(player.getPlayerResponse())
        : [];
    const initial = (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
    tracks = fromPlayer.length > 0 ? fromPlayer : tracksFromResponse(initial);
  }
  if (tracks.length === 0) tracks = elementTracks();

  enableTextTracks();
  if (site === 'x') {
    // X inserts `<track src="data:,WEBVTT">` and leaves it disabled. The cues
    // stay empty until the mode changes, which is what makes the player fetch
    // the real WebVTT. One short wait loses that file.
    const started = Date.now();
    while (Date.now() - started < 4000) {
      enableTextTracks();
      if (inlineCues().length > 0 || elementTracks().length > 0 || vttTracks().length > 0) break;
      if (!hasSubtitleTrack() && Date.now() - started >= 800) break;
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
    }
  }

  if (tracks.length === 0) tracks = elementTracks();
  if (tracks.length === 0) tracks = vttTracks();

  return {
    site,
    tracks,
    resourceUrls: resourceUrls(),
    inline: inlineCues(),
  };
}

/**
 * Fetches one caption file from the page's main world.
 *
 * Same constraint as {@link discoverCaptionsInPage}: the body is what Chrome
 * serializes, so helpers stay inside the function. A URL that already has `pot`
 * is fetched as-is. Otherwise the player is asked to select the language, which
 * is what makes it request a tokenised timedtext URL, and that URL is preferred.
 * Adding `fmt` onto a tokenised URL can invalidate the token, so those URLs are
 * left unchanged.
 */
export async function fetchCaptionBodyInPage(
  languageCode: string,
  fallbackUrl: string,
): Promise<string> {
  function primary(code: string): string {
    return code.trim().toLowerCase().split('-')[0] ?? '';
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function prepare(url: string): string {
    try {
      const parsed = new URL(url, location.href);
      const host = parsed.hostname.replace(/^www\./, '');
      const allowed =
        parsed.protocol === 'https:' &&
        /(^|\.)((youtube|youtu)\.com|youtu\.be|ytimg\.com|googlevideo\.com|twimg\.com|x\.com|twitter\.com)$/.test(
          host,
        );
      if (!allowed) return '';
      const vtt = parsed.pathname.endsWith('.vtt') || parsed.searchParams.get('fmt') === 'vtt';
      const locked = parsed.searchParams.has('pot') || parsed.searchParams.has('fmt') || vtt;
      if (!locked) parsed.searchParams.set('fmt', 'json3');
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function languageOf(url: string): string {
    try {
      return new URL(url, location.href).searchParams.get('lang') ?? '';
    } catch {
      return '';
    }
  }

  function findPot(language: string): string | null {
    const performanceRef = globalThis.performance;
    if (!performanceRef || typeof performanceRef.getEntriesByType !== 'function') return null;
    let match: string | null = null;
    for (const entry of performanceRef.getEntriesByType('resource')) {
      const name = typeof entry.name === 'string' ? entry.name : '';
      if (!name.includes('/api/timedtext') || !name.includes('pot=')) continue;
      if (primary(languageOf(name)) !== language) continue;
      match = name;
    }
    return match;
  }

  function activate(language: string): void {
    const player = document.querySelector('#movie_player');
    if (!isRecord(player)) return;
    const loadModule = player.loadModule;
    const getOption = player.getOption;
    const setOption = player.setOption;
    if (typeof loadModule === 'function') {
      try {
        loadModule.call(player, 'captions');
      } catch {
        // Already loaded, or this player build has no caption module.
      }
    }
    if (typeof getOption !== 'function' || typeof setOption !== 'function') return;
    let list: unknown;
    try {
      list = getOption.call(player, 'captions', 'tracklist');
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    const wanted = list.find((item) => {
      if (!isRecord(item) || typeof item.languageCode !== 'string') return false;
      return primary(item.languageCode) === language;
    });
    if (!wanted) return;
    try {
      setOption.call(player, 'captions', 'track', wanted);
    } catch {
      // Without a selected track the player never requests a tokenised URL.
    }
  }

  async function waitForPot(language: string): Promise<string | null> {
    const ready = findPot(language);
    if (ready) return ready;
    if (!document.querySelector('#movie_player')) return null;
    activate(language);
    const started = Date.now();
    while (Date.now() - started < 1800) {
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      const found = findPot(language);
      if (found) return found;
    }
    return null;
  }

  async function read(url: string): Promise<string> {
    if (!url) return '';
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return '';
      const text = await response.text();
      return text.trim() ? text : '';
    } catch {
      return '';
    }
  }

  const language = primary(languageCode);
  if (fallbackUrl.includes('pot=')) {
    const direct = await read(prepare(fallbackUrl));
    if (direct) return direct;
  }
  const pot = language ? await waitForPot(language) : null;
  if (pot) {
    const body = await read(prepare(pot));
    if (body) return body;
  }
  return read(prepare(fallbackUrl));
}
