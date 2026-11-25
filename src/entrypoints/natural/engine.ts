import { fakeTranslate } from '@/dom/fake-engine';
import type { PageEngine } from '@/dom/session';
import { translateViaBackground } from '@/shared/translation-client';

/**
 * Same engines as a page and as the typed box: the packaged build talks to the offscreen
 * host, which runs in-browser PLaMo or the local llama.cpp server the reader already chose.
 * The e2e build swaps in the deterministic stub. This box is not a page, so it is never
 * routed to Chrome's built-in translator.
 */
export const naturalEngine: PageEngine = {
  translate: __SAKUTTO_FAKE_ENGINE__ ? fakeTranslate : translateViaBackground,
};
