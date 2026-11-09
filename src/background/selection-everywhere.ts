import { browser } from 'wxt/browser';
import { loadSettings, subscribeSettings } from '@/shared/storage';

/**
 * Opt-in: show the drag-to-translate icon on every site without first calling the
 * extension on that tab.
 *
 * Off by default, as in Sakutto: the extension asks for no site access at install time, so
 * its content script only enters a tab after the reader asks for a translation there. When
 * the reader turns this on in the options page, the page asks for access to all sites, and
 * the background registers the content script for every http(s) page. Turning it off, or
 * removing the access in Chrome, unregisters it again.
 */
export const EVERYWHERE_ORIGINS = ['https://*/*', 'http://*/*'];
export const EVERYWHERE_SCRIPT_ID = 'huttak-selection-everywhere';
const CONTENT_SCRIPT = 'content-scripts/content.js';

export interface EverywhereApi {
  hasAccess: () => Promise<boolean>;
  registered: () => Promise<boolean>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
}

const chromeApi: EverywhereApi = {
  hasAccess: () => browser.permissions.contains({ origins: EVERYWHERE_ORIGINS }).catch(() => false),
  registered: async () => {
    const scripts = await browser.scripting
      .getRegisteredContentScripts({ ids: [EVERYWHERE_SCRIPT_ID] })
      .catch(() => []);
    return scripts.length > 0;
  },
  register: () =>
    browser.scripting.registerContentScripts([
      {
        id: EVERYWHERE_SCRIPT_ID,
        matches: EVERYWHERE_ORIGINS,
        js: [CONTENT_SCRIPT],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]),
  unregister: () => browser.scripting.unregisterContentScripts({ ids: [EVERYWHERE_SCRIPT_ID] }),
};

/**
 * Makes the registration match the setting and the granted access. Returns whether the
 * content script now runs on every site.
 */
export async function syncSelectionEverywhere(
  enabled: boolean,
  api: EverywhereApi = chromeApi,
): Promise<boolean> {
  const active = enabled && (await api.hasAccess());
  const registered = await api.registered();
  if (active && !registered) await api.register();
  if (!active && registered) await api.unregister();
  return active;
}

export function installSelectionEverywhere(): void {
  let queue: Promise<unknown> = Promise.resolve();
  const sync = (): void => {
    queue = queue
      .then(async () => {
        const settings = await loadSettings().catch(() => null);
        await syncSelectionEverywhere(settings?.selectionEverywhere === true);
      })
      .catch(() => undefined);
  };

  sync();
  subscribeSettings(sync);
  browser.permissions.onAdded.addListener(sync);
  browser.permissions.onRemoved.addListener(sync);
}
