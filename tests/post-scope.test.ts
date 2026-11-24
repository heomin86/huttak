// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { uiShadow } from '@/dom/overlay';
import { collectDocumentPostScopes, detectPostScopes, listPostBlocks } from '@/dom/post-scope';
import { PageSession, type PageEngine, type SessionPreferences } from '@/dom/session';
import { resolvePageTarget } from '@/shared/languages';

const labels = {
  original: '원문',
  chromeNote: 'Chrome 기본 번역',
  machine: 'PLaMo 기계 번역입니다.',
  selectionPending: '번역하는 중…',
  selectionFailed: '선택한 글을 번역하지 못했습니다.',
  selectionTitle: '선택한 글',
  selectionIcon: '선택한 글 번역',
  close: '닫기',
  bilingualOn: '이 사이트는 원문과 함께 보기로 바뀌었습니다.',
  replaceOn: '이 사이트는 원문 바꾸기로 바뀌었습니다.',
  barLabel: '번역 진행',
  barProgress: (done: number, total: number) => `번역 중 ${String(done)} / ${String(total)}`,
  barRate: (tokens: string, segments: string) => `${tokens} 토큰/초 · ${segments} 구간/초`,
  barDone: '이 페이지를 번역했습니다.',
  barPartial: (blocks: number) => `이 페이지에서 ${String(blocks)}곳을 번역하지 못했습니다.`,
  barPostProgress: (done: number, total: number) =>
    `게시글 번역 중 ${String(done)} / ${String(total)}`,
  barPostDone: '게시글만 번역했습니다.',
  barPostPartial: (blocks: number) => `게시글에서 ${String(blocks)}곳을 번역하지 못했습니다.`,
  postNotFound: '이 페이지에서 게시글이나 본문 영역을 찾지 못했습니다.',
  barOriginal: '원문으로 되돌리기',
  barAlways: '이 사이트 항상 번역',
  barAlwaysOn: '이 사이트는 항상 번역합니다.',
};

function preferences(overrides: Partial<SessionPreferences> = {}): SessionPreferences {
  return {
    targetLanguage: 'ko',
    targetExplicit: true,
    form: 'polite',
    display: 'replace',
    auto: 'ask',
    host: 'example.com',
    context: false,
    tier: 'c8',
    pace: 'quality',
    ...overrides,
  };
}

function mockEngine(
  seen: string[],
  render: (text: string) => string = (text) => `번역:${text}`,
): PageEngine {
  return {
    async *translate(segments, options) {
      for (const segment of segments) {
        if (options.signal.aborted) return;
        seen.push(segment.text);
        yield { id: segment.id, final: render(segment.text), engine: 'plamo' as const };
      }
    },
  };
}

const sessions: PageSession[] = [];

function createSession(
  doc: Document,
  engine: PageEngine,
  overrides: Partial<SessionPreferences> = {},
): PageSession {
  const session = new PageSession(doc, {
    engine,
    labels,
    preferences: preferences(overrides),
    scheduleFrame: (callback) => callback(),
    debounceMs: 15,
  });
  sessions.push(session);
  return session;
}

function textSnapshot(root: ParentNode): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const values: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    values.push(node.nodeValue ?? '');
  }
  return values;
}

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions.length = 0;
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  document.documentElement.removeAttribute('data-sakutto-source-lang');
  document.title = '';
});

describe('post/article container detection', () => {
  it('isolates an <article> and excludes site chrome, sidebars, related links, and comments', () => {
    document.body.innerHTML = `
      <header>
        <nav><a href="/">News Home</a><a href="/world">World</a><a href="/tech">Tech</a></nav>
      </header>
      <main>
        <article>
          <header>
            <nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/tech">Tech</a></nav>
            <h1 id="headline">Local AI translation reaches the browser</h1>
            <p id="dek">Modern on-device models can translate articles without uploading text to a server.</p>
            <div class="share-buttons"><button>Share</button><button>Bookmark</button></div>
          </header>
          <p id="p1">First paragraph of the main story explaining the browser runtime in detail.</p>
          <p id="p2">Second paragraph describing privacy benefits and offline availability.</p>
          <aside class="related-posts">
            <h2>Related articles</h2>
            <ul><li><a href="/other">Another story</a></li></ul>
          </aside>
          <footer>Filed under technology and privacy</footer>
        </article>
        <aside class="sidebar">
          <h2>Trending now</h2>
          <p>Sidebar newsletter promotional copy.</p>
        </aside>
        <section id="comments">
          <h2>Comments</h2>
          <p>Reader comment that should stay outside the article scope.</p>
        </section>
      </main>
      <footer>Copyright 2026 Example News</footer>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('article');
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.localName).toBe('article');

    const texts = listPostBlocks(document).map((el) => (el.textContent ?? '').trim());
    expect(texts).toContain('Local AI translation reaches the browser');
    expect(texts).toContain(
      'Modern on-device models can translate articles without uploading text to a server.',
    );
    expect(texts).toContain(
      'First paragraph of the main story explaining the browser runtime in detail.',
    );
    expect(texts).toContain(
      'Second paragraph describing privacy benefits and offline availability.',
    );

    const joined = texts.join('\n');
    expect(joined).not.toContain('News Home');
    expect(joined).not.toContain('Share');
    expect(joined).not.toContain('Related articles');
    expect(joined).not.toContain('Filed under');
    expect(joined).not.toContain('Trending now');
    expect(joined).not.toContain('Reader comment');
    expect(joined).not.toContain('Copyright 2026');
  });

  it('detects X/Twitter tweet bodies and X articles while skipping nav, sidebar trends, and tweet chrome', () => {
    document.body.innerHTML = `
      <header role="banner">
        <nav aria-label="Primary">
          <a href="/home">Home</a>
          <a href="/explore">Explore</a>
          <a href="/notifications">Notifications</a>
        </nav>
      </header>
      <main role="main">
        <div data-testid="primaryColumn">
          <div data-testid="ScrollSnap-List"><span>For you</span><span>Following</span></div>
          <article data-testid="tweet">
            <div data-testid="socialContext">Jane reposted</div>
            <div data-testid="User-Name"><span>Alice Smith</span><span>@alice</span></div>
            <div data-testid="tweetText" lang="en"><span>We just shipped local browser translation with WebGPU support.

Read the <a href="https://example.com/post">release notes</a> for details.</span></div>
            <div role="group">
              <button>Reply 14</button>
              <button>Repost 42</button>
              <button>Like 180</button>
            </div>
          </article>
          <article data-testid="tweet">
            <div data-testid="User-Name"><span>Bob Lee</span><span>@bob</span></div>
            <div data-testid="tweetText" lang="en"><span>Here is a follow-up benchmark comparing CPU and WebGPU throughput.</span></div>
          </article>
        </div>
        <div data-testid="sidebarColumn">
          <section>
            <h2>What's happening</h2>
            <div data-testid="trend">Trending in Technology</div>
          </section>
        </div>
      </main>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('social');
    expect(result.roots).toHaveLength(2);
    expect(result.roots.every((el) => el.getAttribute('data-testid') === 'tweetText')).toBe(true);

    const blocks = listPostBlocks(document);
    const joined = blocks.map((el) => el.textContent ?? '').join('\n');
    expect(joined).toContain('We just shipped local browser translation');
    expect(joined).toContain('Here is a follow-up benchmark');
    expect(joined).not.toContain('Explore');
    expect(joined).not.toContain('Alice Smith');
    expect(joined).not.toContain('Reply 14');
    expect(joined).not.toContain("What's happening");
    expect(joined).not.toContain('Trending in Technology');
  });

  it('detects X long-form article title and rich text view without outer chrome', () => {
    document.body.innerHTML = `
      <header role="banner"><nav><a href="/home">Home</a></nav></header>
      <main role="main">
        <div data-testid="twitterArticleReadView">
          <div data-testid="User-Name"><span>Author Name</span></div>
          <div data-testid="twitterArticleTitle"><h1>Building an offline AI translator</h1></div>
          <div data-testid="twitterArticleRichTextView">
            <p>Running quantized models in the browser removes server round trips.</p>
            <p>It also keeps every draft and article on the reader's own computer.</p>
          </div>
          <button>Subscribe</button>
        </div>
        <div data-testid="sidebarColumn"><p>Who to follow</p></div>
      </main>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('social');
    const texts = listPostBlocks(document).map((el) => (el.textContent ?? '').trim());
    expect(texts).toContain('Building an offline AI translator');
    expect(texts).toContain('Running quantized models in the browser removes server round trips.');
    expect(texts).not.toContain('Author Name');
    expect(texts).not.toContain('Subscribe');
    expect(texts).not.toContain('Who to follow');
  });

  it('detects Bluesky and Reddit post bodies cleanly', () => {
    document.body.innerHTML = `
      <nav><a href="/">Home</a><a href="/search">Search</a></nav>
      <div class="feed">
        <div data-testid="postText">Bluesky post body explaining how decentralized feeds work.</div>
      </div>
      <aside>Trending hashtags</aside>
    `;
    const bsky = detectPostScopes(document);
    expect(bsky.source).toBe('social');
    expect(listPostBlocks(document).map((el) => el.textContent?.trim())).toEqual([
      'Bluesky post body explaining how decentralized feeds work.',
    ]);

    document.body.innerHTML = `
      <header><nav><a href="/">Reddit</a></nav></header>
      <shreddit-post>
        <h1 slot="title">How do you optimize WebGPU inference in Chrome?</h1>
        <div slot="text-body"><p>I am testing quantized models on integrated GPUs and seeing strong results.</p></div>
      </shreddit-post>
      <aside class="sidebar"><p>Community rules and bookmarks</p></aside>
    `;
    const reddit = detectPostScopes(document);
    expect(reddit.source).toBe('social');
    const redditTexts = listPostBlocks(document).map((el) => el.textContent?.trim());
    expect(redditTexts).toContain('How do you optimize WebGPU inference in Chrome?');
    expect(redditTexts).toContain(
      'I am testing quantized models on integrated GPUs and seeing strong results.',
    );
    expect(redditTexts.join('\n')).not.toContain('Community rules');
  });

  it('detects common article/post selectors and includes the associated headline', () => {
    document.body.innerHTML = `
      <div class="site-header"><h1>Example Wiki</h1></div>
      <nav class="vector-column-start"><ul><li><a href="#s1">Contents</a></li></ul></nav>
      <main id="content">
        <h1 id="firstHeading">Kyoto</h1>
        <div id="mw-content-text">
          <div class="mw-parser-output">
            <div class="hatnote">For other uses, see Kyoto (disambiguation).</div>
            <table class="infobox"><tbody><tr><td>Population: 1.46 million</td></tr></tbody></table>
            <p>Kyoto is the capital city of Kyoto Prefecture in the Kansai region of Japan.</p>
            <p>It served as the imperial capital of Japan for more than one thousand years.</p>
          </div>
        </div>
      </main>
      <footer id="catlinks">Categories: Cities in Japan</footer>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('selector');
    const texts = listPostBlocks(document).map((el) => el.textContent?.trim());
    expect(texts).toContain('Kyoto');
    expect(texts).toContain(
      'Kyoto is the capital city of Kyoto Prefecture in the Kansai region of Japan.',
    );
    expect(texts.join('\n')).not.toContain('Example Wiki');
    expect(texts.join('\n')).not.toContain('disambiguation');
    expect(texts.join('\n')).not.toContain('Population');
    expect(texts.join('\n')).not.toContain('Categories');
  });

  it('falls back to <main> when no <article> or post selector is present', () => {
    document.body.innerHTML = `
      <header><nav><a href="/">Docs</a><a href="/api">API</a></nav></header>
      <main>
        <h1>Getting started with local inference</h1>
        <p>Install the extension and download the compact model weights directly onto your machine.</p>
        <p>Once loaded, every translation stays completely offline inside the browser process.</p>
        <div class="pagination"><a href="/prev">Previous</a><a href="/next">Next</a></div>
      </main>
      <aside><p>On this page sidebar links</p></aside>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('main');
    const texts = listPostBlocks(document).map((el) => el.textContent?.trim());
    expect(texts).toContain('Getting started with local inference');
    expect(texts).toContain(
      'Install the extension and download the compact model weights directly onto your machine.',
    );
    expect(texts.join('\n')).not.toContain('Previous');
    expect(texts.join('\n')).not.toContain('On this page');
  });

  it('uses text-density heuristic fallback when semantic tags are missing, including Korean prose', () => {
    document.body.innerHTML = `
      <div class="top-bar"><a href="/">홈</a><a href="/free">자유게시판</a><a href="/best">인기글</a></div>
      <div class="page-wrapper">
        <div class="left-rail"><a href="/n1">공지사항</a><a href="/n2">이용안내</a><a href="/n3">문의하기</a></div>
        <div class="post-column">
          <h1>오늘 다녀온 동네 카페 후기</h1>
          <p>주말 오후에 새로 문을 연 카페에 들러 핸드드립 커피를 마셨는데 향이 무척 깔끔했습니다.</p>
          <p>좌석 간격도 넓고 조용해서 책을 읽거나 노트북으로 작업하기에 아주 좋은 분위기였습니다.</p>
        </div>
      </div>
      <div class="bottom-bar"><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></div>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('heuristic');
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.className).toBe('post-column');

    const texts = listPostBlocks(document).map((el) => el.textContent?.trim());
    expect(texts).toContain('오늘 다녀온 동네 카페 후기');
    expect(texts).toContain(
      '주말 오후에 새로 문을 연 카페에 들러 핸드드립 커피를 마셨는데 향이 무척 깔끔했습니다.',
    );
    expect(texts.join('\n')).not.toContain('자유게시판');
    expect(texts.join('\n')).not.toContain('공지사항');
    expect(texts.join('\n')).not.toContain('이용약관');
  });

  it('returns empty when a page has no isolatable post or article area', () => {
    document.body.innerHTML = `
      <header><nav><a href="/mail">Mail</a><a href="/images">Images</a></nav></header>
      <main>
        <form role="search">
          <input type="search" value="" />
          <button type="submit">Search</button>
        </form>
        <div class="shortcuts">
          <a href="/a">Sign in</a>
          <a href="/b">Settings</a>
          <a href="/c">Help</a>
        </div>
      </main>
      <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    `;

    const result = detectPostScopes(document);
    expect(result.source).toBe('none');
    expect(result.roots).toEqual([]);
    expect(collectDocumentPostScopes(document)).toEqual([]);
  });
});

describe('PageSession post-only translation flow', () => {
  it('translates only the post/article, preserves line breaks and links, and restores cleanly on toggle off', async () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <header><nav><a id="nav-home" href="/">Home Navigation</a></nav></header>
      <main>
        <article>
          <h1 id="title">Release announcement</h1>
          <p id="body">First line of the post<br />Second line with <a id="link" href="https://example.com">documentation</a> here.</p>
        </article>
        <aside class="sidebar"><p id="side">Sidebar recommendations</p></aside>
        <section id="comments"><p id="comment">Nice post!</p></section>
      </main>
      <footer><p id="foot">Footer legal text</p></footer>
    `;

    const before = textSnapshot(document.body);
    const seen: string[] = [];
    const session = createSession(document, mockEngine(seen));

    await session.handle('post');
    await session.whenIdle();

    expect(session.state().active).toBe(true);
    expect(session.state().scope).toBe('post');
    expect(session.state().postNotFound).toBe(false);
    expect(document.documentElement.dataset.sakuttoScope).toBe('post');
    expect(document.documentElement.dataset.sakuttoState).toBe('translated');

    // Only post title and body were sent to the engine.
    expect(document.getElementById('title')?.textContent).toContain('번역:Release announcement');
    expect(document.getElementById('body')?.textContent).toContain('번역:First line of the post');
    expect(document.getElementById('body')?.textContent).toContain('documentation');
    expect(document.getElementById('body')?.innerHTML).toMatch(/<br/i);
    expect(document.getElementById('link')?.getAttribute('href')).toBe('https://example.com');

    // Chrome, sidebar, comments, and footer stayed completely untouched.
    expect(document.getElementById('nav-home')?.textContent).toBe('Home Navigation');
    expect(document.getElementById('side')?.textContent).toBe('Sidebar recommendations');
    expect(document.getElementById('comment')?.textContent).toBe('Nice post!');
    expect(document.getElementById('foot')?.textContent).toBe('Footer legal text');
    expect(seen.join('\n')).not.toContain('Home Navigation');
    expect(seen.join('\n')).not.toContain('Sidebar recommendations');
    expect(seen.join('\n')).not.toContain('Nice post!');
    expect(seen.join('\n')).not.toContain('Footer legal text');

    const bar = document.querySelector('sakutto-bar');
    expect(uiShadow(bar)?.textContent).toContain('게시글만 번역했습니다.');

    // Toggling post command again restores every node verbatim.
    await session.handle('post');
    expect(session.state().active).toBe(false);
    expect(document.documentElement.dataset.sakuttoScope).toBeUndefined();
    expect(document.documentElement.dataset.sakuttoState).toBeUndefined();
    expect(textSnapshot(document.body)).toEqual(before);
  });

  it('translates new X tweets on scroll without touching sidebar or double-translating existing tweets', async () => {
    // Simulates a Korean user browsing English tweets on Korean-localized X.
    document.documentElement.lang = 'ko';
    document.body.innerHTML = `
      <header role="banner"><nav><a id="x-nav" href="/home">홈</a></nav></header>
      <main role="main">
        <div id="feed" data-testid="primaryColumn">
          <article data-testid="tweet">
            <div data-testid="User-Name"><span>Alice</span></div>
            <div id="t1" data-testid="tweetText" lang="en"><span>First tweet paragraph.

Second tweet paragraph.</span></div>
          </article>
        </div>
        <div data-testid="sidebarColumn"><p id="trend">Trending topic right now</p></div>
      </main>
    `;

    const seen: string[] = [];
    const session = createSession(
      document,
      mockEngine(seen, (text) => `한글번역:${text}`),
      { targetLanguage: 'ko', targetExplicit: false },
    );

    await session.handle('post');
    await session.whenIdle();

    // Target language stayed Korean (did not flip to English because of <html lang="ko">).
    expect(session.state().targetLanguage).toBe('ko');
    expect(session.state().targetAdjusted).toBe(false);
    expect(document.getElementById('t1')?.textContent).toContain('한글번역:');
    expect(document.getElementById('t1')?.textContent).toContain('First tweet paragraph.');
    expect(document.getElementById('t1')?.textContent).toContain('Second tweet paragraph.');
    expect(document.getElementById('t1')?.innerHTML).toMatch(/<br/i);
    expect(document.getElementById('trend')?.textContent).toBe('Trending topic right now');

    const countBeforeMutation = seen.length;

    // Dynamically append a second tweet to the feed.
    const nextTweet = document.createElement('article');
    nextTweet.setAttribute('data-testid', 'tweet');
    nextTweet.innerHTML =
      '<div data-testid="User-Name"><span>Bob</span></div><div id="t2" data-testid="tweetText" lang="en"><span>Newly loaded tweet body.</span></div>';
    document.getElementById('feed')?.append(nextTweet);

    await new Promise((resolve) => setTimeout(resolve, 40));
    await session.whenIdle();

    expect(document.getElementById('t2')?.textContent).toContain('한글번역:');
    expect(document.getElementById('t2')?.textContent).toContain('Newly loaded tweet body.');
    // First tweet was not translated a second time.
    expect(seen.slice(countBeforeMutation)).toEqual(['<i1>Newly loaded tweet body.</i1>']);
    expect(document.getElementById('trend')?.textContent).toBe('Trending topic right now');
  });

  it('switches cleanly between post-only and full-page translation', async () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <header><nav id="nav"><a href="/">Navigation Link</a></nav></header>
      <main>
        <article>
          <p id="post">Main article paragraph with enough content to isolate cleanly.</p>
        </article>
      </main>
      <footer><p id="footer">Site footer text</p></footer>
    `;

    const seen: string[] = [];
    const session = createSession(document, mockEngine(seen));

    // Start in full-page mode: everything translates.
    await session.handle('toggle');
    await session.whenIdle();
    expect(session.state().scope).toBe('page');
    expect(document.getElementById('nav')?.textContent).toContain('번역:');
    expect(document.getElementById('post')?.textContent).toContain('번역:Main article paragraph');
    expect(document.getElementById('footer')?.textContent).toContain('번역:Site footer text');

    // Switch to post-only mode: chrome restores to original while post stays translated.
    await session.handle('post');
    await session.whenIdle();
    expect(session.state().active).toBe(true);
    expect(session.state().scope).toBe('post');
    expect(document.getElementById('nav')?.textContent).toBe('Navigation Link');
    expect(document.getElementById('footer')?.textContent).toBe('Site footer text');
    expect(document.getElementById('post')?.textContent).toContain('번역:Main article paragraph');

    // Switch back to full-page mode: chrome translates again.
    await session.handle('toggle');
    await session.whenIdle();
    expect(session.state().active).toBe(true);
    expect(session.state().scope).toBe('page');
    expect(document.getElementById('nav')?.textContent).toContain('번역:');
    expect(document.getElementById('footer')?.textContent).toContain('번역:Site footer text');
  });

  it('handles pages without an isolatable post gracefully without translating chrome', async () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <header><nav><a id="nav" href="/">Home</a><a href="/login">Sign in</a></nav></header>
      <main>
        <form role="search"><input type="search" /><button>Search</button></form>
      </main>
      <footer><p id="foot">All rights reserved</p></footer>
    `;

    const seen: string[] = [];
    const session = createSession(document, mockEngine(seen));

    await session.handle('post');
    await session.whenIdle();

    expect(session.state().active).toBe(false);
    expect(session.state().postNotFound).toBe(true);
    expect(seen).toEqual([]);
    expect(document.getElementById('nav')?.textContent).toBe('Home');
    expect(document.getElementById('foot')?.textContent).toBe('All rights reserved');

    const status = document.querySelector('sakutto-status');
    expect(status?.hasAttribute('hidden')).toBe(false);
    expect(status?.textContent).toBe(labels.postNotFound);

    // Full-page translation still works afterwards and clears postNotFound.
    await session.handle('toggle');
    await session.whenIdle();
    expect(session.state().active).toBe(true);
    expect(session.state().scope).toBe('page');
    expect(session.state().postNotFound).toBe(false);
    expect(document.getElementById('foot')?.textContent).toContain('번역:All rights reserved');
  });

  it('preserves the pre-translation post source language after replace-mode translation', async () => {
    // 1) English article translated into pure Korean text in replace mode.
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <main>
        <article>
          <h1>Browser performance notes</h1>
          <p id="p1">Local translation keeps page content private and avoids unnecessary network round trips.</p>
        </article>
      </main>
    `;

    const seen: string[] = [];
    const session = createSession(
      document,
      mockEngine(
        seen,
        () => '로컬 번역은 페이지 내용을 안전하게 유지하고 불필요한 네트워크 왕복을 줄입니다.',
      ),
      { display: 'replace', targetLanguage: 'ko', targetExplicit: false },
    );

    await session.handle('post');
    await session.whenIdle();

    expect(document.getElementById('p1')?.textContent).toContain('로컬 번역은 페이지 내용을');
    expect(session.state().pageLanguage).toBe('en');
    expect(resolvePageTarget(session.state().pageLanguage, 'ko', false)).toBe('ko');

    session.restore();
    expect(session.state().pageLanguage).toBe('en');

    // 2) Unlabeled English tweet inside a Korean UI shell (<html lang="ko">).
    document.documentElement.lang = 'ko';
    document.body.innerHTML = `
      <main>
        <article data-testid="tweet">
          <div id="tweet-en" data-testid="tweetText"><span>This English tweet has no explicit lang attribute on a Korean UI shell.</span></div>
        </article>
      </main>
    `;

    const tweetSession = createSession(
      document,
      mockEngine(
        [],
        () => '한국어 인터페이스 안의 영어 트윗도 번역 후 원본 언어 상태를 유지해야 합니다.',
      ),
      { display: 'replace', targetLanguage: 'ko', targetExplicit: false },
    );

    await tweetSession.handle('post');
    await tweetSession.whenIdle();

    expect(document.getElementById('tweet-en')?.textContent).toContain(
      '한국어 인터페이스 안의 영어 트윗',
    );
    expect(tweetSession.state().pageLanguage).toBeNull();
    expect(resolvePageTarget(tweetSession.state().pageLanguage, 'ko', false)).toBe('ko');

    tweetSession.restore();
    expect(tweetSession.state().pageLanguage).toBe('ko');

    // 3) Japanese article translated to Korean keeps 'ja', and refreshes on SPA navigation to a new untranslated article.
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <main id="app-main">
        <article id="ja-post">
          <h1>ローカル翻訳の設計メモ</h1>
          <p id="ja-body">この記事はブラウザ内で完結する高速な翻訳パイプラインの設計について解説します。</p>
        </article>
      </main>
    `;

    const spaSession = createSession(
      document,
      mockEngine(
        [],
        () => '이 글은 브라우저 내부에서 완결되는 고속 번역 파이프라인 설계를 설명합니다.',
      ),
      { display: 'replace', targetLanguage: 'ko', targetExplicit: false },
    );

    await spaSession.handle('post');
    await spaSession.whenIdle();

    expect(spaSession.state().pageLanguage).toBe('ja');
    expect(resolvePageTarget(spaSession.state().pageLanguage, 'ko', false)).toBe('ko');

    // Replace the entire article with a fresh untranslated English article (SPA navigation).
    const main = document.getElementById('app-main');
    if (main) {
      main.innerHTML = `
        <article id="en-post">
          <h1>Follow-up release notes</h1>
          <p id="en-body">This newly navigated article is written in English and has not been translated yet.</p>
        </article>
      `;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    await spaSession.whenIdle();

    expect(spaSession.state().pageLanguage).toBe('en');
    expect(resolvePageTarget(spaSession.state().pageLanguage, 'ko', false)).toBe('ko');
  });
});
