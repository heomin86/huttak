const HOST_TAG = 'sakutto-caption';

export type CaptionOverlayKind = 'line' | 'status' | 'hidden';

/**
 * Draws one caption line over the video. The node's shadow is closed and the
 * host is marked `translate="no"` so the page translator never rewrites it.
 * Player captions stay in the DOM (hiding them with `display` makes YouTube
 * stop fetching the track) and are only made invisible.
 */
export class CaptionOverlay {
  private readonly host: HTMLElement;
  private readonly line: HTMLElement;
  private readonly style: HTMLStyleElement | null;

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
    if (hidePlayerCaptions) {
      style = doc.createElement('style');
      style.dataset.sakuttoCaptionHide = '';
      style.textContent =
        '.ytp-caption-window-container,.ytp-caption-window{visibility:hidden !important}';
      doc.documentElement.append(style);
    }

    this.host = host;
    this.line = line;
    this.style = style;
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
    this.host.remove();
    this.style?.remove();
  }
}
