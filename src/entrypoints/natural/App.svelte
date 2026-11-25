<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { DEFAULT_MODEL_ID } from '@/engine/model/catalog';
  import { isEngineError } from '@/engine/errors';
  import { NATURAL_AMERICAN_TASK } from '@/engine/types';
  import type { EngineStatus } from '@/shared/engine-status';
  import { t } from '@/shared/i18n';
  import { hasLicenseConsent } from '@/shared/agreement';
  import {
    isModelProgressMessage,
    requestEngineStatus,
    requestModelDownload,
    requestModelInspect,
  } from '@/shared/messages';
  import type { Settings } from '@/shared/settings';
  import { loadSettings, subscribeSettings } from '@/shared/storage';
  import {
    MAX_TYPED_CHARS,
    copyTranslation,
    normalizeTypedInput,
    reduceNaturalRewriteKey,
    typedReadiness,
    type NaturalRewriteKey,
    type TypedReadiness,
  } from '@/shared/typed-translation';
  import { naturalEngine } from './engine';

  let settings = $state<Settings | null>(null);
  let engineStatus = $state<EngineStatus | null>(null);
  let sourceText = $state('');
  let result = $state('');
  let translating = $state(false);
  let resultError = $state(false);
  let copied = $state(false);
  let copyFailed = $state(false);
  let downloadBusy = $state(false);
  let downloadFailed = $state(false);
  let abortController = $state<AbortController | null>(null);
  /** Control+Enter arrived while Hangul was still composing. */
  let rewriteArmed = $state(false);

  let trimmed = $derived(normalizeTypedInput(sourceText));
  let tooLong = $derived(trimmed.length > MAX_TYPED_CHARS);
  // A llama.cpp server on this computer needs no PLaMo license or download.
  let readiness = $derived<TypedReadiness>(
    settings?.engine === 'local'
      ? 'ready'
      : typedReadiness({
          consent: hasLicenseConsent(settings),
          modelState: engineStatus?.model.state ?? 'absent',
          plamoReady: engineStatus?.plamoReady ?? false,
        }),
  );
  let canRewrite = $derived(
    !translating && trimmed.length > 0 && !tooLong && readiness === 'ready',
  );
  let hasAnything = $derived(sourceText.length > 0 || result.length > 0);

  async function refreshEngine() {
    engineStatus = await requestEngineStatus();
    if (!engineStatus) {
      const inspected = await requestModelInspect(DEFAULT_MODEL_ID);
      if (inspected) {
        engineStatus = {
          model: inspected,
          backend: null,
          tier: null,
          threads: null,
          parallel: null,
          plamoReady: inspected.state === 'loaded',
          chromeSupported: false,
          active: null,
        };
      }
    }
  }

  function resetResult() {
    result = '';
    resultError = false;
    copied = false;
    copyFailed = false;
  }

  function clearBoth() {
    abortController?.abort();
    abortController = null;
    translating = false;
    sourceText = '';
    resetResult();
  }

  async function rewriteKorean() {
    if (!canRewrite) return;
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    translating = true;
    resetResult();
    let text = '';
    try {
      const segments = [{ id: 'natural', text: trimmed }];
      for await (const chunk of naturalEngine.translate(segments, {
        src: 'ko',
        tgt: 'en',
        form: 'polite',
        task: NATURAL_AMERICAN_TASK,
        priority: 0,
        signal: controller.signal,
        ...(settings && settings.glossary.length > 0 ? { glossary: settings.glossary } : {}),
      })) {
        if (chunk.textDelta !== undefined) {
          text = chunk.restart === true ? chunk.textDelta : text + chunk.textDelta;
          result = text;
        } else if (chunk.final !== undefined) {
          text = chunk.final;
          result = text;
        }
      }
      if (text.trim().length === 0) resultError = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        resultError = true;
        if (isEngineError(error)) await refreshEngine();
      }
    } finally {
      if (abortController === controller) {
        translating = false;
        abortController = null;
      }
    }
  }

  function stop() {
    abortController?.abort();
    abortController = null;
    translating = false;
  }

  function applyRewriteKey(event: NaturalRewriteKey, native?: Event) {
    const next = reduceNaturalRewriteKey(rewriteArmed, event);
    rewriteArmed = next.armed;
    if (!next.run || !canRewrite) return;
    if (event.type === 'keydown') native?.preventDefault();
    void rewriteKorean();
  }

  function keyboardRewriteEvent(
    type: 'keydown' | 'keyup',
    event: KeyboardEvent,
  ): NaturalRewriteKey {
    return {
      type,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing,
    };
  }

  function onSourceKeydown(event: KeyboardEvent) {
    applyRewriteKey(keyboardRewriteEvent('keydown', event), event);
  }

  function onSourceKeyup(event: KeyboardEvent) {
    applyRewriteKey(keyboardRewriteEvent('keyup', event), event);
  }

  function onSourceCompositionEnd() {
    applyRewriteKey({ type: 'compositionend' });
  }

  async function copyResult() {
    copyFailed = false;
    copied = false;
    const ok = await copyTranslation(
      result,
      typeof navigator === 'undefined' ? null : navigator.clipboard,
    );
    if (ok) copied = true;
    else copyFailed = true;
  }

  async function startDownload() {
    if (downloadBusy) return;
    downloadBusy = true;
    downloadFailed = false;
    try {
      const started = await requestModelDownload(DEFAULT_MODEL_ID);
      if (!started) downloadFailed = true;
    } catch {
      downloadFailed = true;
    } finally {
      downloadBusy = false;
      await refreshEngine();
    }
  }

  function openOnboarding() {
    void browser.tabs
      .create({ url: browser.runtime.getURL('/onboarding.html') })
      .catch(() => undefined);
  }

  function openOptions() {
    void browser.runtime.openOptionsPage().catch(() => undefined);
  }

  onMount(() => {
    const unsubscribeSettings = subscribeSettings((next) => {
      settings = next;
    });
    const onMessage = (message: unknown) => {
      if (!isModelProgressMessage(message)) return;
      void refreshEngine();
    };
    browser.runtime.onMessage.addListener(onMessage);

    void loadSettings()
      .then((loaded) => {
        settings = loaded;
      })
      .catch(() => undefined)
      .then(() => refreshEngine())
      .catch(() => undefined);

    return () => {
      unsubscribeSettings();
      browser.runtime.onMessage.removeListener(onMessage);
      abortController?.abort();
    };
  });
</script>

<main class="page">
  <header class="page-header">
    <img src="/icon/48.png" alt="" width="40" height="40" />
    <div>
      <h1>{t('extensionName')}</h1>
      <p class="muted lead">{t('naturalLead')}</p>
    </div>
  </header>

  <section class="workspace" aria-labelledby="natural-heading">
    <h2 id="natural-heading" class="visually-hidden">{t('naturalHeading')}</h2>
    <p class="muted hint">{t('naturalDirectionHint')}</p>

    <div class="compare">
      <section class="pane" aria-labelledby="natural-source-title">
        <div class="pane-head">
          <h2 id="natural-source-title">{t('naturalSourceLabel')}</h2>
          <span class="pane-note">{t('naturalSourceNote')}</span>
          <button class="pane-action" type="button" onclick={clearBoth} disabled={!hasAnything}>
            {t('typedClear')}
          </button>
        </div>
        <textarea
          bind:value={sourceText}
          aria-labelledby="natural-source-title"
          aria-describedby="natural-counter"
          spellcheck="false"
          placeholder={t('naturalPlaceholder')}
          oncompositionend={onSourceCompositionEnd}
          onkeydown={onSourceKeydown}
          onkeyup={onSourceKeyup}></textarea>
        <div class="pane-foot">
          <p id="natural-counter" class="counter" class:over={tooLong}>
            {t('typedCounter', [String(trimmed.length), String(MAX_TYPED_CHARS)])}
          </p>
        </div>
        {#if tooLong}
          <p class="error" role="alert">{t('typedTooLong', [String(MAX_TYPED_CHARS)])}</p>
        {/if}
      </section>

      <section
        class="pane output"
        aria-labelledby="natural-result-title"
        aria-busy={translating ? 'true' : 'false'}
      >
        <div class="pane-head">
          <h2 id="natural-result-title">{t('naturalResultHeading')}</h2>
          <span class="pane-note">{t('naturalResultNote')}</span>
          <button
            class="pane-action"
            type="button"
            onclick={copyResult}
            disabled={result.trim().length === 0}
          >
            {copied ? t('typedCopied') : t('typedCopy')}
          </button>
        </div>

        {#if readiness === 'no-consent'}
          <div class="gate">
            <p>{t('typedNeedsConsent')}</p>
            <button class="button" type="button" onclick={openOnboarding}>
              {t('typedOpenOnboarding')}
            </button>
          </div>
        {:else if readiness === 'model-absent' || readiness === 'model-partial'}
          <div class="gate">
            <p>{readiness === 'model-partial' ? t('typedModelPartial') : t('typedModelMissing')}</p>
            <button class="button" type="button" onclick={startDownload} disabled={downloadBusy}>
              {readiness === 'model-partial' ? t('downloadResume') : t('typedDownloadModel')}
            </button>
            {#if downloadFailed}
              <p class="error" role="alert">{t('errorAction')}</p>
            {/if}
          </div>
        {:else if readiness === 'model-busy'}
          <p class="muted note" role="status">{t('typedModelBusy')}</p>
        {:else if readiness === 'model-error'}
          <p class="error note" role="alert">{t('typedModelError')}</p>
        {:else if resultError}
          <p class="error note" role="alert">{t('naturalFailed')}</p>
        {:else if result.trim().length > 0}
          <output class="result" lang="en" aria-labelledby="natural-result-title">{result}</output>
        {:else}
          <p class="muted empty">{t('naturalResultEmpty')}</p>
        {/if}

        <div class="pane-foot">
          <p class="status" role="status">{translating ? t('naturalRunning') : ''}</p>
        </div>
      </section>
    </div>

    <div class="run">
      <div class="run-status">
        {#if copyFailed}
          <p class="error" role="alert">{t('naturalCopyFailed')}</p>
        {/if}
      </div>
      <p class="muted shortcut">{t('naturalRunHint')}</p>
      {#if translating}
        <button class="button secondary" type="button" onclick={stop}>{t('typedStop')}</button>
      {:else}
        <button class="button" type="button" onclick={rewriteKorean} disabled={!canRewrite}>
          {t('naturalRun')}
        </button>
      {/if}
    </div>
  </section>

  <footer class="footer">
    <button class="link-button" type="button" onclick={openOptions}>{t('openOptions')}</button>
    <p class="notice">{t('machineTranslationNotice')}</p>
    <p class="notice">{t('unofficialNotice')}</p>
  </footer>
</main>

<style>
  .page {
    --rule: color-mix(in srgb, var(--border) 30%, transparent);
    display: grid;
    gap: var(--space-5);
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-5) var(--space-4);
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--rule);
  }

  .page-header img {
    border-radius: var(--radius-sm);
  }

  .lead {
    max-width: 640px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  h1 {
    font-size: 16px;
    font-weight: 700;
  }

  h2 {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .workspace {
    display: grid;
    gap: var(--space-4);
  }

  .hint {
    font-size: 12px;
  }

  .compare {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0;
  }

  .pane {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3) var(--space-4) var(--space-2) 0;
  }

  .pane.output {
    padding: var(--space-3) 0 var(--space-2) var(--space-4);
    border-left: 1px solid var(--rule);
  }

  .pane-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--rule);
    margin-bottom: var(--space-1);
  }

  .pane-note {
    flex: 1 1 auto;
    color: var(--muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-action {
    flex: none;
    min-height: 0;
    padding: 2px 2px;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .pane-action:hover:not(:disabled) {
    background: none;
    color: var(--accent);
  }

  .pane-action:disabled {
    color: var(--muted);
    text-decoration: none;
    opacity: 1;
  }

  textarea {
    width: 100%;
    min-height: 240px;
    padding: 4px 0 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    line-height: 1.75;
    resize: vertical;
  }

  .result {
    display: block;
    min-height: 240px;
    padding: 4px 0 0;
    color: var(--text);
    line-height: 1.75;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty {
    min-height: 240px;
    padding: 4px 0 0;
    font-size: 12px;
    line-height: 1.7;
  }

  .note {
    font-size: 12px;
    line-height: 1.6;
  }

  .pane-foot {
    display: flex;
    justify-content: flex-end;
    min-height: 18px;
  }

  .counter,
  .status,
  .shortcut {
    font-size: 12px;
  }

  .counter.over {
    color: var(--danger);
  }

  .status {
    color: var(--muted);
  }

  .gate {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    padding: var(--space-3) 0 0;
    border-top: 1px solid var(--rule);
    font-size: 12px;
    line-height: 1.6;
  }

  .run {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--rule);
  }

  .run-status {
    margin-right: auto;
  }

  .footer {
    display: grid;
    gap: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--rule);
  }

  @media (max-width: 720px) {
    .compare {
      grid-template-columns: minmax(0, 1fr);
    }

    .pane {
      padding: var(--space-3) 0 var(--space-2);
    }

    .pane.output {
      padding: var(--space-4) 0 var(--space-2);
      border-top: 1px solid var(--rule);
      border-left: 0;
    }
  }

  @media (max-width: 480px) {
    .page {
      padding: var(--space-5) var(--space-4);
    }

    .run {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .shortcut {
      flex-basis: 100%;
      order: 3;
    }
  }
</style>
