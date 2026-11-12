import type { Engine, Formality, GlossaryEntry } from '@/engine/types';
import {
  captionSite,
  cueAt,
  cuesForLanguage,
  mergePlayerTracks,
  parseCaptionBody,
  pickCaptionTrack,
  primaryLanguage,
  videoKey,
  type CaptionDiscovery,
  type Cue,
} from './timedtext';
import { CaptionOverlay, xCaptionNodes } from './overlay';
import { translateCues } from './translate';

export interface CaptionLabels {
  translating: string;
  missing: string;
  failed: string;
  sameLanguage: string;
}

export interface CaptionBridge {
  discover(): Promise<CaptionDiscovery | null>;
  readCaption(languageCode: string, url: string): Promise<string | null>;
}

export interface CaptionStart {
  targetLanguage: string;
  sourceLanguage: string | null;
  form: Formality;
  glossary?: readonly GlossaryEntry[] | undefined;
}

/**
 * Translates a video's caption file into an overlay synced to `currentTime`.
 *
 * The player's own caption nodes are replaced whenever the clock moves, so writing
 * a translation into them loses the line on the next tick. This session leaves
 * those nodes alone and draws one phrase at a time. A phrase stays up until its
 * successor has a translation, so a word the player reveals early cannot replace
 * the Korean line. It runs only while page translation is on, and only on
 * YouTube and X. X without a caption file is reported; burned-in subtitles and
 * speech recognition are out of scope.
 */
export class CaptionSession {
  private generation = 0;
  private signature = '';
  private key = '';
  private options: CaptionStart | null = null;
  private controller: AbortController | null = null;
  private overlay: CaptionOverlay | null = null;
  private video: HTMLVideoElement | null = null;
  private cues: Cue[] = [];
  private readonly translations = new Map<string, string>();
  private onTime: (() => void) | null = null;
  private onNavigate: (() => void) | null = null;
  private watchTimer: number | null = null;
  private labels: CaptionLabels;

  constructor(
    private readonly doc: Document,
    private readonly bridge: CaptionBridge,
    private readonly engine: Engine,
    labels: CaptionLabels,
  ) {
    this.labels = labels;
  }

  setLabels(labels: CaptionLabels): void {
    this.labels = labels;
    this.render();
  }

  start(options: CaptionStart): void {
    if (!captionSite(this.href())) {
      this.stop();
      return;
    }
    const key = this.mediaKey();
    const signature = this.sign(options, key);
    if (signature === this.signature && this.controller && !this.controller.signal.aborted) return;

    this.halt();
    this.signature = signature;
    this.key = key;
    this.options = options;
    this.listenNavigate();
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    void this.run(options, controller.signal, generation);
  }

  stop(): void {
    this.halt();
  }

  private halt(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.signature = '';
    this.key = '';
    this.options = null;
    this.detach();
    this.overlay?.destroy();
    this.overlay = null;
    this.cues = [];
    this.translations.clear();
    this.unlistenNavigate();
  }

  private async run(options: CaptionStart, signal: AbortSignal, generation: number): Promise<void> {
    const site = captionSite(this.href());
    if (!site) return;
    this.overlay = new CaptionOverlay(this.doc, site === 'youtube');
    this.showStatus(this.labels.translating);

    const video = await this.waitForVideo(signal);
    if (!this.alive(generation, signal)) return;
    if (!video) {
      this.showStatus(this.labels.missing);
      return;
    }
    this.attach(video);
    this.key = this.mediaKey();
    this.signature = this.sign(options, this.key);

    let discovered: CaptionDiscovery | null;
    try {
      discovered = await this.bridge.discover();
    } catch {
      discovered = null;
    }
    if (!this.alive(generation, signal)) return;
    if (!discovered || (discovered.tracks.length === 0 && discovered.inline.length === 0)) {
      this.showStatus(this.labels.missing);
      return;
    }

    const tracks = mergePlayerTracks(discovered.tracks, discovered.resourceUrls);
    const track = pickCaptionTrack(tracks, options.targetLanguage, options.sourceLanguage);
    const target = primaryLanguage(options.targetLanguage);
    const inlineFallback = discovered.inline.find(
      (item) => item.cues.length > 0 && primaryLanguage(item.languageCode) !== target,
    );
    if (!track && !inlineFallback) {
      const same =
        target.length > 0 &&
        (tracks.length > 0 || discovered.inline.length > 0) &&
        tracks.every((item) => primaryLanguage(item.languageCode) === target) &&
        discovered.inline.every((item) => primaryLanguage(item.languageCode) === target);
      this.showStatus(same ? this.labels.sameLanguage : this.labels.missing);
      return;
    }

    const languageCode = track?.languageCode || inlineFallback?.languageCode || '';
    let cues = cuesForLanguage(discovered.inline, languageCode) ?? inlineFallback?.cues ?? [];
    if (cues.length === 0 && track?.url) {
      let body: string | null;
      try {
        body = await this.bridge.readCaption(languageCode, track.url);
      } catch {
        body = null;
      }
      if (!this.alive(generation, signal)) return;
      cues = body ? parseCaptionBody(body) : [];
    }
    if (cues.length === 0) {
      this.showStatus(this.labels.failed);
      return;
    }

    this.cues = cues;
    if (site === 'x') this.overlay?.enableXHide();
    this.render();
    try {
      await translateCues(this.engine, cues, {
        targetLanguage: options.targetLanguage,
        sourceLanguage: languageCode || options.sourceLanguage,
        form: options.form,
        ...(options.glossary ? { glossary: options.glossary } : {}),
        signal,
        nowMs: video.currentTime * 1000,
        onCue: (id, text) => {
          if (!this.alive(generation, signal)) return;
          this.translations.set(id, text);
          this.render();
        },
      });
    } catch {
      if (!this.alive(generation, signal)) return;
      if (this.translations.size === 0) this.showStatus(this.labels.failed);
    }
  }

  private showStatus(text: string): void {
    this.overlay?.show(text, this.video?.getBoundingClientRect() ?? null, 'status');
  }

  private render(): void {
    const overlay = this.overlay;
    const video = this.video;
    if (!overlay || !video || this.cues.length === 0) return;
    this.quietPlayerCaptions(video);
    const timeMs = video.currentTime * 1000;
    if (captionSite(this.href()) === 'x') {
      overlay.conceal(xCaptionNodes(video, this.captionTexts(timeMs)));
    }
    const rect = video.getBoundingClientRect();
    const cue = cueAt(this.cues, timeMs);
    const translated = cue ? this.translations.get(cue.id) : undefined;
    if (cue && translated) {
      overlay.show(translated, rect, 'line');
      return;
    }

    const held = this.previousReady(cue, timeMs);
    if (held) {
      overlay.show(held, rect, 'line');
      return;
    }
    if (cue) {
      overlay.show(this.labels.translating, rect, 'status');
      return;
    }
    overlay.show('', rect, 'hidden');
  }

  /**
   * The latest line that already has a translation. While the line at the clock
   * is still translating, this is what stays on screen. A pause keeps it briefly
   * so the reader can finish it, then clears it.
   */
  private previousReady(current: Cue | null, timeMs: number): string | null {
    let text: string | null = null;
    let endMs = -1;
    for (const cue of this.cues) {
      if (current ? cue.startMs >= current.startMs : cue.startMs > timeMs) break;
      const translated = this.translations.get(cue.id);
      if (!translated) continue;
      text = translated;
      endMs = cue.endMs;
    }
    if (!text) return null;
    if (!current && timeMs - endMs > 1600) return null;
    return text;
  }

  private waitForVideo(signal: AbortSignal): Promise<HTMLVideoElement | null> {
    const existing = pickVideo(this.doc);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      let giveUp: ReturnType<typeof setTimeout> | null = null;
      const finish = (video: HTMLVideoElement | null): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearInterval(timer);
        if (giveUp !== null) clearTimeout(giveUp);
        resolve(video);
      };
      timer = setInterval(() => {
        if (signal.aborted) {
          finish(null);
          return;
        }
        const video = pickVideo(this.doc);
        if (video) finish(video);
      }, 200);
      giveUp = setTimeout(() => {
        finish(signal.aborted ? null : pickVideo(this.doc));
      }, 8000);
    });
  }

  /** Source lines the player may still be painting: the one at the clock, and the one before it. */
  private captionTexts(timeMs: number): string[] {
    const current = cueAt(this.cues, timeMs);
    const texts: string[] = [];
    if (current) texts.push(current.text);
    let previous: Cue | null = null;
    for (const cue of this.cues) {
      if (current ? cue.startMs >= current.startMs : cue.startMs > timeMs) break;
      if (cue !== current) previous = cue;
    }
    if (previous) texts.push(previous.text);
    return texts;
  }

  private quietPlayerCaptions(video: HTMLVideoElement): void {
    const list = video.textTracks;
    if (!list) return;
    for (let index = 0; index < list.length; index += 1) {
      const track = list[index];
      if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
      if (track.mode !== 'hidden') track.mode = 'hidden';
    }
  }

  private attach(video: HTMLVideoElement): void {
    this.detach();
    this.video = video;
    this.quietPlayerCaptions(video);
    this.onTime = () => this.render();
    video.addEventListener('timeupdate', this.onTime);
    video.addEventListener('seeked', this.onTime);
    const view = this.doc.defaultView;
    view?.addEventListener('scroll', this.onTime, true);
    view?.addEventListener('resize', this.onTime);
  }

  private detach(): void {
    const view = this.doc.defaultView;
    if (this.video && this.onTime) {
      this.video.removeEventListener('timeupdate', this.onTime);
      this.video.removeEventListener('seeked', this.onTime);
    }
    if (this.onTime) {
      view?.removeEventListener('scroll', this.onTime, true);
      view?.removeEventListener('resize', this.onTime);
    }
    this.video = null;
    this.onTime = null;
  }

  private listenNavigate(): void {
    this.unlistenNavigate();
    const view = this.doc.defaultView;
    if (!view) return;
    this.onNavigate = () => {
      const options = this.options;
      if (!options) return;
      if (this.mediaKey() === this.key) return;
      this.start(options);
    };
    view.addEventListener('popstate', this.onNavigate);
    this.doc.addEventListener('yt-navigate-finish', this.onNavigate);
    this.watchTimer = view.setInterval(this.onNavigate, 1000);
  }

  private unlistenNavigate(): void {
    const view = this.doc.defaultView;
    if (this.onNavigate) {
      view?.removeEventListener('popstate', this.onNavigate);
      this.doc.removeEventListener('yt-navigate-finish', this.onNavigate);
    }
    if (this.watchTimer !== null) {
      view?.clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.onNavigate = null;
  }

  private href(): string {
    return this.doc.defaultView?.location.href ?? '';
  }

  private mediaKey(): string {
    const href = this.href();
    const id = videoKey(href);
    if (id) return id;
    const video = pickVideo(this.doc);
    const src = video?.currentSrc || video?.src || '';
    return src ? `src:${src}` : href;
  }

  private sign(options: CaptionStart, key: string): string {
    return JSON.stringify({
      target: options.targetLanguage,
      source: options.sourceLanguage,
      form: options.form,
      glossary: options.glossary ?? [],
      key,
    });
  }

  private alive(generation: number, signal: AbortSignal): boolean {
    return generation === this.generation && !signal.aborted;
  }
}

function pickVideo(doc: Document): HTMLVideoElement | null {
  const videos = [...doc.querySelectorAll('video')].filter(
    (video): video is HTMLVideoElement => video instanceof HTMLVideoElement,
  );
  if (videos.length === 0) return null;
  const captioned = videos.filter((video) => captionTrackCount(video) > 0);
  const pool = captioned.length > 0 ? captioned : videos;
  let best = pool[0] ?? null;
  let bestArea = -1;
  for (const video of pool) {
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

function captionTrackCount(video: HTMLVideoElement): number {
  let count = video.querySelectorAll('track').length;
  const list = video.textTracks;
  if (!list) return count;
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (track && (track.kind === 'subtitles' || track.kind === 'captions')) count += 1;
  }
  return count;
}
