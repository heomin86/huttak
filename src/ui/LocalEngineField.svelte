<script lang="ts">
  import { browser } from 'wxt/browser';
  import { isLoopbackUrl } from '@/engine/local/server-engine';
  import { t } from '@/shared/i18n';
  import type { Settings, SettingsPatch } from '@/shared/settings';

  interface Props {
    settings: Settings;
    onChange: (patch: SettingsPatch) => void;
  }

  let { settings, onChange }: Props = $props();

  let draftUrl = $state<string | null>(null);
  let check = $state<'idle' | 'busy' | 'ok' | 'failed'>('idle');
  let url = $derived(draftUrl ?? settings.localServerUrl);
  let urlValid = $derived(isLoopbackUrl(url));

  /** The offscreen engine needs host access to reach the server on this computer. */
  const LOCAL_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];

  async function requestAccess(): Promise<boolean> {
    try {
      return await browser.permissions.request({ origins: LOCAL_ORIGINS });
    } catch {
      return false;
    }
  }

  async function updateEngine(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const engine = select.value === 'local' ? 'local' : 'plamo';
    // Ask while the change event still counts as a user gesture.
    if (engine === 'local') await requestAccess();
    check = 'idle';
    onChange({ engine });
  }

  function updateUrl(event: Event) {
    draftUrl = (event.currentTarget as HTMLInputElement).value.trim();
    check = 'idle';
    if (isLoopbackUrl(draftUrl)) onChange({ localServerUrl: draftUrl.replace(/\/+$/, '') });
  }

  async function testConnection() {
    if (!urlValid) return;
    check = 'busy';
    const allowed = await requestAccess();
    if (!allowed) {
      check = 'failed';
      return;
    }
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/health`);
      check = response.ok ? 'ok' : 'failed';
    } catch {
      check = 'failed';
    }
  }
</script>

<div class="fields">
  <label class="field">
    <span>{t('engineChoiceLabel')}</span>
    <select value={settings.engine} onchange={updateEngine}>
      <option value="plamo">{t('engineChoicePlamo')}</option>
      <option value="local">{t('engineChoiceLocal')}</option>
    </select>
  </label>

  {#if settings.engine === 'local'}
    <label class="field">
      <span>{t('localServerUrlLabel')}</span>
      <input
        type="url"
        value={url}
        spellcheck="false"
        aria-invalid={urlValid ? 'false' : 'true'}
        oninput={updateUrl}
      />
    </label>
    {#if !urlValid}
      <p class="error" role="alert">{t('localServerUrlInvalid')}</p>
    {/if}
    <p class="muted help">{t('localServerHelp')}</p>
    <div class="row">
      <button
        class="link-button"
        type="button"
        disabled={!urlValid || check === 'busy'}
        onclick={testConnection}
      >
        {t('localServerCheck')}
      </button>
      {#if check === 'ok'}
        <span class="ok" role="status">{t('localServerOk')}</span>
      {:else if check === 'failed'}
        <span class="error" role="alert">{t('localServerFailed')}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .fields {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .field {
    display: grid;
    gap: var(--space-1);
  }

  .field > span,
  .help {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .help {
    font-weight: 400;
    line-height: 1.5;
  }

  select,
  input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .ok {
    color: var(--muted);
    font-size: 12px;
  }

  .error {
    color: var(--danger);
    font-size: 12px;
  }
</style>
