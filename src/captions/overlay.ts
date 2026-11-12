const HOST_TAG = 'sakutto-caption';

export type CaptionOverlayKind = 'line' | 'status' | 'hidden';

const YOUTUBE_HIDE = [
  '.ytp-caption-window-container,',
  '.ytp-caption-window-container *,',
  '.ytp-caption-window,',
  '.ytp-caption-window *,',
  '.caption-window,',
  '.caption-window *,',
  '.captions-text,',
  '.ytp-caption-segment{',
  'visibility:hidden !important;opacity:0 !important',
  '}',
].join('');

/**
 * X paints its own caption line in the player, separate from the browser's
 * text-track renderer. `track.mode = "hidden"` stops the browser cues and still
 * leaves that line on screen. Marking the line and hiding it the same way as
 * YouTube (visibility and opacity, not `display`) removes the glyphs. A cover
 * drawn over the line would leave the English readable around the edges, so
 * this rule does not paint one.
 *
 * `::cue` only accepts a small set of properties. Color and background are the
 * ones that actually blank a native cue; the webkit display box takes the same
 * visibility and opacity YouTube's window uses.
 */
const X_HIDE = [
  'video::cue{',
  'color:transparent !important;background-color:transparent !important;text-shadow:none !important',
  '}',
  'video::-webkit-media-text-track-display,',
  'video::-webkit-media-text-track-display-backdrop{',
  'visibility:hidden !important;opacity:0 !important',
  '}',
  '[data-sakutto-x-caption],[data-sakutto-x-caption] *{',
  'visibility:hidden !important;opacity:0 !important',
  '}',
].join('');

/**
 * Draws one caption line over the video. The node's shadow is closed and the
 * host is marked `translate="no"` so the page translator never rewrites it.
 * Player captions stay in the DOM (hiding them with `display` makes YouTube
 * stop fetching the track). Opacity covers the whole window, including a word
 * the player reveals with `visibility:visible` as it is spoken.
 */
export class CaptionOverlay {
  private readonly host: HTMLElement;
  private readonly line: HTMLElement;
  private style: HTMLStyleElement | null;
  private readonly concealed = new Set<HTMLElement>();

  constructor(doc: Document, hidePlayerCaptions: boolean) {
    doc.querySelector(HOST_TAG)?.remove();
    doc.querySelector('[data-sakutto-caption-hide]')?.remove();

    const host = doc.createElement(HOST_TAG);
    host.setAttribute('translate', 'no');
    host.setAttribute('aria-live', 'polite');
    host.style.position = 'fixed';
    host.style.zIndex = '2147483000';
    host.style.pointerEvents = 'none';
    host.style.display = 'none';
    host.style.margin = '0';
    host.style.padding = '0';
    host.style.border = '0';
    host.style.background = 'transparent';
    host.style.textAlign = 'center';

    const line = doc.createElement('div');
    line.style.display = 'inline-block';
    line.style.maxWidth = '100%';
    line.style.boxSizing = 'border-box';
    line.style.padding = '0.3em 0.7em';
    line.style.borderRadius = '4px';
    line.style.background = 'rgba(0, 0, 0, 0.75)';
    line.style.color = '#fff';
    line.style.font = '600 18px/1.35 system-ui, sans-serif';
    line.style.textAlign = 'center';
    line.style.whiteSpace = 'pre-wrap';
    line.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.65)';

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(line);
    doc.documentElement.append(host);

    let style: HTMLStyleElement | null = null;
    if (hidePlayerCaptions) style = installHide(doc, YOUTUBE_HIDE);

    this.host = host;
    this.line = line;
    this.style = style;
  }

  /**
   * Hides X's own caption line once a caption file is actually in hand.
   * A video with no captions must keep whatever the player is showing.
   */
  enableXHide(): void {
    if (this.style) return;
    const doc = this.host.ownerDocument;
    this.style = installHide(doc, X_HIDE);
  }

  conceal(elements: readonly HTMLElement[]): void {
    const next = new Set(elements);
    for (const node of this.concealed) {
      if (!next.has(node)) node.removeAttribute('data-sakutto-x-caption');
    }
    for (const node of next) node.setAttribute('data-sakutto-x-caption', '');
    this.concealed.clear();
    for (const node of next) this.concealed.add(node);
  }

  show(text: string, rect: DOMRect | null, kind: CaptionOverlayKind): void {
    this.host.dataset.caption = text;
    this.host.dataset.state = kind;
    this.line.textContent = text;
    this.line.style.fontWeight = kind === 'status' ? '500' : '600';
    if (!text || kind === 'hidden') {
      this.host.style.display = 'none';
      return;
    }

    const view = this.host.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth ?? 800;
    const viewHeight = view?.innerHeight ?? 600;
    const usable = rect !== null && rect.width >= 32 && rect.height >= 32;
    const width = usable && rect ? rect.width : viewWidth;
    const left = usable && rect ? rect.left : 0;
    const videoBottom = usable && rect ? rect.bottom : viewHeight * 0.88;
    const lift = usable && rect ? Math.max(12, rect.height * 0.08) : viewHeight * 0.12;
    const boxWidth = Math.max(160, Math.round(width * 0.84));
    const font = Math.max(14, Math.min(28, Math.round(width / 36)));

    this.host.style.display = 'block';
    this.host.style.left = `${Math.round(left + (width - boxWidth) / 2)}px`;
    this.host.style.width = `${boxWidth}px`;
    this.host.style.bottom = `${Math.max(8, Math.round(viewHeight - videoBottom + lift))}px`;
    this.host.style.top = 'auto';
    this.line.style.fontSize = `${font}px`;
  }

  destroy(): void {
    for (const node of this.concealed) node.removeAttribute('data-sakutto-x-caption');
    this.concealed.clear();
    this.host.remove();
    this.style?.remove();
    this.style = null;
  }
}

function installHide(doc: Document, css: string): HTMLStyleElement {
  const style = doc.createElement('style');
  style.dataset.sakuttoCaptionHide = '';
  style.textContent = css;
  doc.documentElement.append(style);
  return style;
}

const MIN_PREFIX = 8;

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * The player node that is drawing one of the source lines. The match is the
 * caption text itself, not a rectangle painted on top of it. Buttons, the
 * tweet, and any box that also contains the video are left alone.
 */
export function xCaptionNodes(video: HTMLVideoElement, cues: readonly string[]): HTMLElement[] {
  const exact = cues.map(normalized).filter((text) => text.length > 0);
  if (exact.length === 0) return [];
  const root =
    video.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]') ??
    video.parentElement;
  if (!root || root === video.ownerDocument.body || root === video.ownerDocument.documentElement) {
    return [];
  }

  const found: HTMLElement[] = [];
  for (const element of root.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) continue;
    if (element === video || element.contains(video)) continue;
    if (element.closest('button, a, input, textarea, [role="button"], sakutto-caption')) continue;
    if (element.closest('[data-testid="tweetText"]')) continue;
    if (element.querySelector('button, a, video, [role="button"]')) continue;
    const text = normalized(element.textContent ?? '');
    if (!isCaptionText(text, exact)) continue;
    found.push(element);
  }

  return found.filter(
    (element) => !found.some((other) => other !== element && element.contains(other)),
  );
}

function isCaptionText(text: string, cues: readonly string[]): boolean {
  if (text.length < 2) return false;
  for (const cue of cues) {
    if (text === cue) return true;
    if (text.length >= MIN_PREFIX && cue.startsWith(text)) return true;
  }
  return false;
}
