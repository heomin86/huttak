import {
  collectDocuments,
  collectShadowRoots,
  eachTranslatableBlock,
  hasTranslatableText,
  isAriaHiddenLeaf,
  isCollapsedDetail,
  isScreenReaderOnly,
  isTranslationExcluded,
  isVisuallyRendered,
} from './blocks';
import { canonicalPageLanguage, inferLanguage } from './detect';

export type TranslationScope = 'page' | 'post';

export type PostScopeSource = 'social' | 'article' | 'selector' | 'main' | 'heuristic' | 'none';

export interface PostScopeResult {
  roots: Element[];
  source: PostScopeSource;
}

/**
 * Page chrome, navigation, sidebars, related-link boxes, and separate comment widgets
 * that should stay untouched during post/article-only translation.
 */
const CHROME_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'search',
  'form[role="search"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="toolbar"]',
  '[role="search"]',
  '[role="tablist"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-testid="sidebarColumn"]',
  '[data-testid="User-Name"]',
  '[data-testid="socialContext"]',
  '[data-testid="ScrollSnap-List"]',
  '[data-testid="placementTracking"]',
  '[data-testid="trend"]',
  '[aria-label*="breadcrumb" i]',
  '.breadcrumb',
  '.breadcrumbs',
  '#breadcrumb',
  '#breadcrumbs',
  '[aria-label*="pagination" i]',
  '.pagination',
  '.pager',
  '.page-numbers',
  '.nav-links',
  '.post-navigation',
  '.posts-navigation',
  '#sidebar',
  '.sidebar',
  '.side-bar',
  '#side-bar',
  '.widget-area',
  '.left-sidebar',
  '.right-sidebar',
  '.aside-bar',
  '.navbar',
  '.nav-bar',
  '.site-nav',
  '.site-navigation',
  '.global-nav',
  '.top-nav',
  '.main-nav',
  '.sub-nav',
  '.footer-nav',
  '.site-header',
  '.site-footer',
  '#site-header',
  '#site-footer',
  '.global-header',
  '.global-footer',
  '.toc',
  '#toc',
  '.table-of-contents',
  '.mw-jump-link',
  '.vector-header-container',
  '.vector-column-start',
  '.vector-column-end',
  '.vector-page-toolbar',
  '.vector-body-before-content',
  '.related-posts',
  '.related-articles',
  '.related-links',
  '.related-content',
  '.recommended-posts',
  '.recommended-articles',
  '.more-stories',
  '.read-more-list',
  '.share-buttons',
  '.social-share',
  '.share-bar',
  '.author-bio',
  '.newsletter-signup',
  '.subscribe-box',
  '.cookie-banner',
  '.ad-container',
  '.advertisement',
  '[aria-label*="related" i]',
  '#comments',
  '.comments',
  '.comment-list',
  '.comment-section',
  '.comments-area',
  '.comments-wrapper',
  '#comment-section',
  '#disqus_thread',
  '.utterances',
  '.giscus',
  '[data-testid="comments"]',
  '.reply-list',
  '.hatnote',
  '.shortdescription',
  '.coordinates',
  '#coordinates',
  '.infobox',
  '.navbox',
  '.vertical-navbox',
  '.sistersitebox',
  '.metadata',
  '.reflist',
  '.mw-references-wrap',
  'ol.references',
  '#catlinks',
  '.mw-authority-control',
  '.side-box',
  '.mw-editsection',
  '.printfooter',
  '.mw-indicators',
  '.search-form',
  '.search-box',
].join(', ');

/** Interactive button controls inside a post scope (Share, Bookmark, Follow, etc.). */
const CONTROL_CHROME_SELECTOR = 'button, [role="button"]';

/**
 * High-precision social/feed post bodies. Matched ahead of `<article>` so X/Twitter
 * tweets translate only the post body (`[data-testid="tweetText"]`) and article view
 * without translating author handles, timestamps, engagement counts, or sidebar trends.
 */
const X_PRIMARY_SELECTORS = [
  '[data-testid="tweetText"]',
  '[data-testid="twitterArticleTitle"]',
  '[data-testid="twitterArticleRichTextView"]',
  '[data-testid="longformRichTextComponent"]',
].join(', ');

const X_FALLBACK_SELECTOR = '[data-testid="twitterArticleReadView"]';

const OTHER_SOCIAL_SELECTORS = [
  '[data-testid="postText"]',
  'shreddit-post [slot="title"]',
  'shreddit-post [slot="text-body"]',
  '[data-test-id="post-content"] h1',
  '[data-test-id="post-content"] [data-click-id="text"]',
  '.status__content__text',
  '.status__content',
].join(', ');

/** Common semantic/CMS/news/wiki post body selectors used when `<article>` is absent. */
const ARTICLE_BODY_SELECTORS = [
  '[itemprop="articleBody"]',
  '[itemtype*="schema.org/Article" i]',
  '[itemtype*="schema.org/NewsArticle" i]',
  '[itemtype*="schema.org/BlogPosting" i]',
  '#mw-content-text .mw-parser-output',
  '#mw-content-text',
  '#newsct_article',
  '#dic_area',
  '.se-main-container',
  '.tt_article_useless_p_margin',
  '.contents_style',
  '.markdown-body',
  '.entry-content',
  '.post-content',
  '.article-content',
  '.article-body',
  '.article_body',
  '.article__body',
  '.post-body',
  '.post_body',
  '.post_content',
  '.story-body',
  '.content-body',
  '.view_content',
  '.board_view',
  '.rd_body',
  '.prose',
].join(', ');

const TITLE_SELECTORS = ['#firstHeading', '#title_area', 'h1'].join(', ');

const PROSE_BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'blockquote',
  'li',
  'dd',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const PARAGRAPH_TAGS: ReadonlySet<string> = new Set(['p', 'blockquote', 'dd', 'figcaption']);

const CJK_OR_HANGUL = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const LETTER_RE = /\p{L}/u;
const NON_LATIN_SCRIPTS: ReadonlySet<string> = new Set([
  'ja',
  'zh-hans',
  'zh-hant',
  'ko',
  'ru',
  'ar',
  'th',
  'he',
]);

interface ProseMetrics {
  totalWeighted: number;
  linkWeighted: number;
  nonLinkWeighted: number;
  linkDensity: number;
  paragraphWeighted: number;
  proseBlocks: number;
  hasHeading: boolean;
}

/**
 * Counts text length with Hangul and CJK characters weighted ~2.5x so concise Korean,
 * Japanese, and Chinese posts pass the same prose thresholds as English paragraphs.
 */
function weightedLength(text: string): number {
  const compact = text.replace(/\s+/gu, ' ').trim();
  if (compact.length === 0) return 0;
  const cjk = compact.match(CJK_OR_HANGUL)?.length ?? 0;
  return compact.length + Math.round(cjk * 1.5);
}

function isArticleHeader(header: Element, scopeRoot?: Element): boolean {
  if (header.getAttribute('role') === 'banner') return false;
  const inArticle =
    scopeRoot !== undefined
      ? scopeRoot.contains(header) && header !== scopeRoot
      : header.closest('article, [role="article"], main, [role="main"]') !== null;
  if (!inArticle) return false;
  if (header.querySelector('h1, h2, h3') !== null) return true;
  const metrics = measureProse(header, true);
  return metrics.nonLinkWeighted >= 60 && metrics.linkDensity <= 0.4;
}

/**
 * True when an element is page chrome (nav, sidebar, footer, header banner, breadcrumbs,
 * pagination, related links, comment widgets, or action buttons) that should be excluded
 * from post-only translation.
 */
export function isPostChrome(element: Element, scopeRoot?: Element): boolean {
  if (scopeRoot !== undefined && element === scopeRoot) return false;
  if (element.matches(CHROME_SELECTOR)) return true;
  if (scopeRoot !== undefined && element.matches(CONTROL_CHROME_SELECTOR)) return true;
  if (element.localName === 'header') {
    return !isArticleHeader(element, scopeRoot);
  }
  return false;
}

function hasChromeAncestor(element: Element, stopAt?: Element): boolean {
  for (let node: Element | null = element; node && node !== stopAt; node = node.parentElement) {
    if (isPostChrome(node, stopAt)) return true;
  }
  return false;
}

function isUsableElement(element: Element, checkChrome = true): boolean {
  if (isTranslationExcluded(element) || isAriaHiddenLeaf(element)) return false;
  if (isScreenReaderOnly(element) || isCollapsedDetail(element)) return false;
  if (!isVisuallyRendered(element)) return false;
  if (checkChrome && hasChromeAncestor(element)) return false;
  return true;
}

function measureProse(container: Element, skipHeaderCheck = false): ProseMetrics {
  let totalWeighted = 0;
  let linkWeighted = 0;
  let paragraphWeighted = 0;
  const blockWeights = new Map<Element, { total: number; link: number }>();

  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    const raw = node.nodeValue ?? '';
    if (!LETTER_RE.test(raw)) continue;

    if (isNodeExcludedInside(parent, container, skipHeaderCheck)) continue;

    const weight = weightedLength(raw);
    if (weight === 0) continue;
    totalWeighted += weight;

    const inLink = hasTagUpTo(parent, 'a', container);
    if (inLink) linkWeighted += weight;

    const inParagraph = hasTagInSetUpTo(parent, PARAGRAPH_TAGS, container);
    if (inParagraph && !inLink) paragraphWeighted += weight;

    const block = nearestProseBlock(parent, container);
    if (block) {
      const entry = blockWeights.get(block) ?? { total: 0, link: 0 };
      entry.total += weight;
      if (inLink) entry.link += weight;
      blockWeights.set(block, entry);
    }
  }

  let proseBlocks = 0;
  for (const [block, stats] of blockWeights) {
    const nonLink = stats.total - stats.link;
    if (nonLink >= 25 && stats.link / Math.max(1, stats.total) <= 0.6) {
      proseBlocks += 1;
      continue;
    }
    if (/^h[1-3]$/u.test(block.localName) && nonLink >= 10) {
      proseBlocks += 1;
    }
  }

  let hasHeading = false;
  for (const heading of container.querySelectorAll('h1, h2, h3')) {
    if (isNodeExcludedInside(heading, container, skipHeaderCheck)) continue;
    if (weightedLength(heading.textContent ?? '') >= 2) {
      hasHeading = true;
      break;
    }
  }

  const nonLinkWeighted = Math.max(0, totalWeighted - linkWeighted);
  const linkDensity = totalWeighted > 0 ? linkWeighted / totalWeighted : 1;

  return {
    totalWeighted,
    linkWeighted,
    nonLinkWeighted,
    linkDensity,
    paragraphWeighted,
    proseBlocks,
    hasHeading,
  };
}

function isNodeExcludedInside(
  element: Element,
  container: Element,
  skipHeaderCheck: boolean,
): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (
      isTranslationExcluded(node) ||
      isAriaHiddenLeaf(node) ||
      isScreenReaderOnly(node) ||
      isCollapsedDetail(node)
    ) {
      return true;
    }
    if (node !== container) {
      if (node.matches(CHROME_SELECTOR) || node.matches(CONTROL_CHROME_SELECTOR)) return true;
      if (!skipHeaderCheck && node.localName === 'header' && !isArticleHeader(node, container)) {
        return true;
      }
    }
    if (node === container) break;
  }
  return !isVisuallyRendered(element);
}

function hasTagUpTo(element: Element, tag: string, stop: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.localName === tag) return true;
    if (node === stop) break;
  }
  return false;
}

function hasTagInSetUpTo(element: Element, tags: ReadonlySet<string>, stop: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (tags.has(node.localName)) return true;
    if (node === stop) break;
  }
  return false;
}

function nearestProseBlock(element: Element, container: Element): Element | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (PROSE_BLOCK_TAGS.has(node.localName)) return node;
    if (node === container) return container;
  }
  return container;
}

function queryAcrossRoots(doc: Document, selector: string): Element[] {
  const roots: ParentNode[] = [doc, ...collectShadowRoots(doc)];
  const matches: Element[] = [];
  const seen = new Set<Element>();
  for (const root of roots) {
    for (const element of root.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      matches.push(element);
    }
  }
  return matches;
}

function deduplicateRoots(elements: readonly Element[]): Element[] {
  const unique: Element[] = [];
  for (const element of elements) {
    if (unique.some((existing) => existing === element || existing.contains(element))) continue;
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      const existing = unique[index];
      if (existing && element.contains(existing)) unique.splice(index, 1);
    }
    unique.push(element);
  }
  return unique;
}

function detectSocialScopes(doc: Document): Element[] {
  const xPrimary = queryAcrossRoots(doc, X_PRIMARY_SELECTORS).filter(
    (element) => isUsableElement(element) && hasTranslatableText(element),
  );
  const xFallback = queryAcrossRoots(doc, X_FALLBACK_SELECTOR).filter(
    (element) =>
      isUsableElement(element) &&
      hasTranslatableText(element) &&
      !xPrimary.some((child) => element.contains(child)),
  );
  const xMatches = deduplicateRoots([...xPrimary, ...xFallback]);
  if (xMatches.length > 0) return xMatches;

  const other = queryAcrossRoots(doc, OTHER_SOCIAL_SELECTORS).filter(
    (element) => isUsableElement(element) && hasTranslatableText(element),
  );
  return deduplicateRoots(other);
}

function detectArticleScopes(doc: Document): Element[] {
  const raw = queryAcrossRoots(doc, 'article, [role="article"]').filter((element) =>
    isUsableElement(element),
  );
  if (raw.length === 0) return [];

  const topLevel = deduplicateRoots(raw);
  const scored: { element: Element; metrics: ProseMetrics; score: number }[] = [];
  for (const element of topLevel) {
    const metrics = measureProse(element);
    if (metrics.totalWeighted < 40 || metrics.nonLinkWeighted < 25 || metrics.linkDensity > 0.65) {
      continue;
    }
    const score =
      metrics.nonLinkWeighted + metrics.paragraphWeighted * 0.5 + (metrics.hasHeading ? 40 : 0);
    scored.push({ element, metrics, score });
  }
  if (scored.length === 0) return [];

  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const filtered =
    maxScore >= 500
      ? scored.filter(
          (entry) =>
            entry.score >= maxScore * 0.15 ||
            (entry.metrics.nonLinkWeighted >= 180 && entry.metrics.linkDensity <= 0.45),
        )
      : scored;

  return filtered.map((entry) => entry.element);
}

function findAssociatedTitle(doc: Document, bodies: readonly Element[]): Element | null {
  const firstBody = bodies[0];
  if (!firstBody) return null;

  for (const candidate of queryAcrossRoots(doc, TITLE_SELECTORS)) {
    if (!isUsableElement(candidate, false)) continue;
    if (candidate.matches(CHROME_SELECTOR) || hasChromeAncestor(candidate)) continue;
    if (bodies.some((body) => body === candidate || body.contains(candidate))) return null;
    if (weightedLength(candidate.textContent ?? '') < 2) continue;
    if (!hasTranslatableText(candidate)) continue;

    // Require the title to live inside the same `<main>` (if any) or share a non-body ancestor,
    // or be the document's sole visible `<h1>` / known article title ID.
    const bodyMain = firstBody.closest('main, [role="main"]');
    const titleMain = candidate.closest('main, [role="main"]');
    if (bodyMain && titleMain === bodyMain) return candidate;
    if (candidate.id === 'firstHeading' || candidate.id === 'title_area') return candidate;
    const parent = firstBody.parentElement;
    if (parent && parent !== doc.body && parent.contains(candidate)) return candidate;
    if (candidate.localName === 'h1' && doc.querySelectorAll('h1').length === 1) return candidate;
  }
  return null;
}

function detectSelectorScopes(doc: Document): Element[] {
  const raw = queryAcrossRoots(doc, ARTICLE_BODY_SELECTORS).filter((element) =>
    isUsableElement(element),
  );
  if (raw.length === 0) return [];

  const valid: Element[] = [];
  for (const element of deduplicateRoots(raw)) {
    const metrics = measureProse(element);
    if (metrics.totalWeighted < 40 || metrics.nonLinkWeighted < 25 || metrics.linkDensity > 0.65) {
      continue;
    }
    valid.push(element);
  }
  if (valid.length === 0) return [];

  const title = findAssociatedTitle(doc, valid);
  return title ? deduplicateRoots([title, ...valid]) : valid;
}

function detectMainScopes(doc: Document): Element[] {
  const raw = queryAcrossRoots(doc, 'main, [role="main"]').filter((element) =>
    isUsableElement(element),
  );
  if (raw.length === 0) return [];

  const valid: Element[] = [];
  for (const element of deduplicateRoots(raw)) {
    const metrics = measureProse(element);
    const enoughProse =
      metrics.nonLinkWeighted >= 80 ||
      (metrics.hasHeading && metrics.nonLinkWeighted >= 50 && metrics.proseBlocks >= 1);
    if (!enoughProse || metrics.linkDensity > 0.55 || metrics.proseBlocks < 1) continue;
    valid.push(element);
  }
  return valid;
}

function heuristicScore(metrics: ProseMetrics): number {
  const density = Math.max(0, 1 - metrics.linkDensity);
  return (
    (metrics.nonLinkWeighted + metrics.paragraphWeighted * 0.75 + (metrics.hasHeading ? 60 : 0)) *
    density
  );
}

function passesHeuristicThreshold(metrics: ProseMetrics): boolean {
  if (metrics.nonLinkWeighted < 120) return false;
  if (metrics.linkDensity > 0.5) return false;
  if (metrics.proseBlocks < 1) return false;
  return metrics.proseBlocks >= 2 || metrics.paragraphWeighted >= 100 || metrics.hasHeading;
}

function detectHeuristicScopes(doc: Document): Element[] {
  const body = doc.body;
  if (!body) return [];

  const scored: { element: Element; metrics: ProseMetrics; score: number }[] = [];
  for (const candidate of body.querySelectorAll('div, section')) {
    if (!isUsableElement(candidate)) continue;
    const metrics = measureProse(candidate);
    if (!passesHeuristicThreshold(metrics)) continue;
    scored.push({ element: candidate, metrics, score: heuristicScore(metrics) });
  }

  if (scored.length > 0) {
    scored.sort((left, right) => right.score - left.score);
    let winner = scored[0]!;

    // Narrow to the tightest qualifying descendant that preserves >= 85% of the non-link prose,
    // so an outer layout wrapper with sidebars/menus trims down to the actual post column.
    for (;;) {
      const tighter = scored
        .filter(
          (entry) =>
            entry.element !== winner.element &&
            winner.element.contains(entry.element) &&
            entry.metrics.nonLinkWeighted >= winner.metrics.nonLinkWeighted * 0.85 &&
            entry.metrics.linkDensity <= winner.metrics.linkDensity + 0.05,
        )
        .sort((left, right) => {
          if (left.element.contains(right.element)) return 1;
          if (right.element.contains(left.element)) return -1;
          return right.score - left.score;
        })[0];
      if (!tighter) break;
      winner = tighter;
    }

    const title = findAssociatedTitle(doc, [winner.element]);
    return title ? deduplicateRoots([title, winner.element]) : [winner.element];
  }

  // Flat document without wrapper divs (e.g. direct `<header>`, `<h1>`, `<p>` children of `<body>`).
  const directProse: Element[] = [];
  let nonLinkTotal = 0;
  let totalAll = 0;
  let linkAll = 0;
  let proseCount = 0;
  let hasHeading = false;

  for (const child of body.children) {
    if (!isUsableElement(child)) continue;
    if (!PROSE_BLOCK_TAGS.has(child.localName) && child.localName !== 'figure') continue;
    const metrics = measureProse(child);
    if (metrics.totalWeighted === 0) continue;
    directProse.push(child);
    nonLinkTotal += metrics.nonLinkWeighted;
    totalAll += metrics.totalWeighted;
    linkAll += metrics.linkWeighted;
    proseCount += metrics.proseBlocks;
    if (/^h[1-3]$/u.test(child.localName)) hasHeading = true;
  }

  const linkDensity = totalAll > 0 ? linkAll / totalAll : 1;
  if (
    directProse.length > 0 &&
    nonLinkTotal >= 120 &&
    linkDensity <= 0.5 &&
    (proseCount >= 2 || (hasHeading && proseCount >= 1))
  ) {
    return directProse;
  }

  return [];
}

export function detectPostScopes(doc: Document): PostScopeResult {
  const social = detectSocialScopes(doc);
  if (social.length > 0) return { roots: social, source: 'social' };

  const articles = detectArticleScopes(doc);
  if (articles.length > 0) return { roots: articles, source: 'article' };

  const selectors = detectSelectorScopes(doc);
  if (selectors.length > 0) return { roots: selectors, source: 'selector' };

  const mains = detectMainScopes(doc);
  if (mains.length > 0) return { roots: mains, source: 'main' };

  const heuristic = detectHeuristicScopes(doc);
  if (heuristic.length > 0) return { roots: heuristic, source: 'heuristic' };

  return { roots: [], source: 'none' };
}

/** Collects post/article scope roots across the document and readable same-origin frames. */
export function collectDocumentPostScopes(doc: Document): Element[] {
  const collected: Element[] = [];
  for (const document of collectDocuments(doc)) {
    const result = detectPostScopes(document);
    collected.push(...result.roots);
  }
  return collected;
}

/** Yields translatable blocks inside one detected post/article scope, skipping embedded chrome. */
export function* eachPostBlock(scopeRoot: Element): Generator<Element> {
  yield* eachTranslatableBlock(scopeRoot, {
    shouldSkip: (element) => isPostChrome(element, scopeRoot),
  });
}

/** Lists all translatable blocks across detected post/article scopes in a document. */
export function listPostBlocks(doc: Document): Element[] {
  const blocks: Element[] = [];
  const seen = new Set<Element>();
  for (const scope of collectDocumentPostScopes(doc)) {
    for (const block of eachPostBlock(scope)) {
      if (seen.has(block)) continue;
      seen.add(block);
      blocks.push(block);
    }
  }
  return blocks;
}

/**
 * Infers the dominant language of the isolated post scopes so a foreign-language post
 * on a localized UI shell (such as an English tweet on Korean X) keeps the user's target
 * language instead of adopting `<html lang="ko">`.
 */
export function resolvePostSourceLanguage(
  scopes: readonly Element[],
  documentSource: string | null,
): string | null {
  if (scopes.length === 0) return documentSource;

  const explicit = new Set<string>();
  const samples: string[] = [];
  let sampleLength = 0;

  for (const scope of scopes) {
    const root = scope.ownerDocument.documentElement;
    const tagged = scope.closest('[lang]');
    if (tagged && tagged !== root) {
      const lang = canonicalPageLanguage(tagged.getAttribute('lang'));
      if (lang) explicit.add(lang);
    }
    if (sampleLength < 1200) {
      const text = (scope.textContent ?? '').trim();
      if (text.length > 0) {
        samples.push(text);
        sampleLength += text.length;
      }
    }
  }

  if (explicit.size === 1) {
    const [only] = explicit;
    if (only) return only;
  }

  const combined = samples.join('\n').slice(0, 1200);
  const inferred = inferLanguage(combined);
  if (inferred) return inferred;

  if (documentSource !== null && NON_LATIN_SCRIPTS.has(documentSource)) {
    let latin = 0;
    let nonLatin = 0;
    for (const char of combined) {
      const code = char.codePointAt(0) ?? 0;
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
      else if (code > 0x7f && LETTER_RE.test(char)) nonLatin += 1;
    }
    if (nonLatin === 0 && latin >= 24) return null;
  }

  return documentSource;
}
