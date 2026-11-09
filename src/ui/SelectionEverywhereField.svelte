<script lang="ts">
  import { browser } from 'wxt/browser';
  import { EVERYWHERE_ORIGINS } from '@/background/selection-everywhere';
  import { t } from '@/shared/i18n';
  import type { Settings, SettingsPatch } from '@/shared/settings';

  interface Props {
    settings: Settings;
    onChange: (patch: SettingsPatch) => void;
  }

  let { settings, onChange }: Props = $props();
  let denied = $state(false);

  async function toggle(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    denied = false;
    if (!input.checked) {
      onChange({ selectionEverywhere: false });
      // Hand the all-sites access back. Grants for single sites stay as they were.
      await browser.permissions.remove({ origins: EVERYWHERE_ORIGINS }).catch(() => false);
      return;
    }
    // Asked inside the change event, which still counts as a user gesture.
    const granted = await browser.permissions
      .request({ origins: EVERYWHERE_ORIGINS })
      .catch(() => false);
    if (!granted) {
      input.checked = false;
      denied = true;
      return;
    }
    onChange({ selectionEverywhere: true });
  }
</script>

<div class="field">
  <label class="check">
    <input type="checkbox" checked={settings.selectionEverywhere} onchange={toggle} />
    <span>{t('selectionEverywhereLabel')}</span>
  </label>
  <p class="muted help">{t('selectionEverywhereHelp')}</p>
  {#if denied}
    <p class="error" role="alert">{t('selectionEverywhereDenied')}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }

  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-size: 13px;
  }

  .help {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
  }

  .error {
    color: var(--danger);
    font-size: 12px;
  }
</style>
