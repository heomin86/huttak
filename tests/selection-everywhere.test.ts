import { describe, expect, it } from 'vitest';
import {
  EVERYWHERE_ORIGINS,
  syncSelectionEverywhere,
  type EverywhereApi,
} from '@/background/selection-everywhere';

function fakeApi(access: boolean, registered: boolean) {
  const calls: string[] = [];
  const state = { registered };
  const api: EverywhereApi = {
    hasAccess: async () => access,
    registered: async () => state.registered,
    register: async () => {
      calls.push('register');
      state.registered = true;
    },
    unregister: async () => {
      calls.push('unregister');
      state.registered = false;
    },
  };
  return { api, calls, state };
}

describe('drag icon on every site', () => {
  it('asks only for the http and https patterns', () => {
    expect(EVERYWHERE_ORIGINS).toEqual(['https://*/*', 'http://*/*']);
  });

  it('registers the content script when the option is on and access was granted', async () => {
    const { api, calls } = fakeApi(true, false);
    await expect(syncSelectionEverywhere(true, api)).resolves.toBe(true);
    expect(calls).toEqual(['register']);
  });

  it('does not register twice', async () => {
    const { api, calls } = fakeApi(true, true);
    await syncSelectionEverywhere(true, api);
    expect(calls).toEqual([]);
  });

  it('stays off without access even when the option is on', async () => {
    const { api, calls } = fakeApi(false, false);
    await expect(syncSelectionEverywhere(true, api)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('unregisters when the option is turned off or the access is removed', async () => {
    const off = fakeApi(true, true);
    await syncSelectionEverywhere(false, off.api);
    expect(off.calls).toEqual(['unregister']);

    const revoked = fakeApi(false, true);
    await syncSelectionEverywhere(true, revoked.api);
    expect(revoked.calls).toEqual(['unregister']);
  });
});
