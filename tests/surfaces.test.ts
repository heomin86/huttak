import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

const onboarding = source('entrypoints/onboarding/App.svelte');
const typed = source('entrypoints/typed/App.svelte');
const natural = source('entrypoints/natural/App.svelte');
const popup = source('entrypoints/popup/App.svelte');
const session = source('dom/session.ts');
const content = source('entrypoints/content.ts');
const modelManager = source('ui/ModelManager.svelte');

/**
 * Every surface that can start a translation while the model is still downloading. A
 * control there either starts a request that cannot answer or opens a page that keeps its
 * source text, which reads as a broken feature rather than as a download in progress.
 */
describe('start controls while the model downloads', () => {
  it('renders no try control on the onboarding card before the model is ready', () => {
    // One conditional governs the sample button, and it is the phase rule rather than the
    // download state directly — `downloading`, `paused` and `error` all fail it.
    expect(onboarding).toContain('onboardingCanTry(phase)');
    expect(onboarding).toContain('{#if showTryButton}');
    expect(onboarding).not.toContain('onboardingTryNow');
    expect(onboarding).not.toMatch(
      /phase === 'downloading' \|\| phase === 'paused'[\s\S]{0,200}trySample/,
    );
  });

  it('keeps pause and close available during the download', () => {
    expect(onboarding).toContain("phase === 'downloading'}");
    expect(onboarding).toContain('onclick={pause}');
    expect(onboarding).toContain('onclick={close}');
  });

  it('does not offer a download button for a model that is already loading', () => {
    // `loading` means the file is on disk and the runtime is reading it: a Download control
    // there is a start action for work that is already running.
    expect(modelManager).toContain("state === 'loading'");
    expect(modelManager).toMatch(/state === 'loading'[\s\S]{0,400}runtimeLoading/);
  });

  it('gates the popup translate button on the model the same way', () => {
    expect(popup).toContain('modelStartBlocked');
    expect(popup).toMatch(/canStart[\s\S]{0,200}isChromeOnlyLanguage\(targetLanguage\)/);
    expect(popup).toMatch(/disabled=\{[^}]*!canStart[^}]*\}/);
  });
});

/**
 * The typed box is a comparison, not a form with an output field. These assertions protect
 * the two things that make it one: two panes side by side, and a single column when the
 * window is too narrow to read both.
 */
describe('typed translation layout', () => {
  it('puts the source and the result in two named panes', () => {
    expect(typed).toContain('id="typed-source-title"');
    expect(typed).toContain('id="typed-result-title"');
    expect(typed).toMatch(/class="compare"[\s\S]*class="pane"[\s\S]*class="pane output"/);
  });

  it('lays the panes out side by side and stacks them on a narrow window', () => {
    expect(typed).toMatch(
      /\.compare\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/u,
    );
    expect(typed).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.compare\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u,
    );
  });

  it('keeps the language controls above the panes, with the swap beside them', () => {
    const direction = typed.indexOf('class="direction"');
    const compare = typed.indexOf('class="compare"');
    expect(direction).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(direction);
    expect(typed).toContain('LanguageField');
    expect(typed).toContain('typedSwap');
  });

  it('never borrows the reference product’s furniture', () => {
    // No document drop target for PDFs, Word files, or slides; no dictionary panel; no
    // Google copy for the empty state.
    expect(typed).not.toMatch(/type="file"/u);
    expect(typed).not.toMatch(/drop|dragover|DataTransfer/u);
    expect(typed).not.toMatch(/\.pdf|\.docx|\.pptx/iu);
    expect(typed).not.toContain('dictionary');
    expect(typed).not.toContain('辞書');
  });

  it('keeps the PLaMo engine, consent gate and ready rule in place', () => {
    expect(typed).toContain("from './engine'");
    expect(typed).toContain('typedReadiness');
    expect(typed).toContain('hasLicenseConsent');
    expect(typed).toContain('requestModelDownload');
    // The result is copied, never written by a second engine.
    expect(typed).toContain('copyTranslation');
  });
});

/**
 * The natural-English box is its own input. Page translation and the general typed
 * translator keep their controls; this one does not change the page's target language.
 */
describe('natural American English input', () => {
  it('puts the Korean the reader wrote beside the English result', () => {
    expect(natural).toContain('id="natural-source-title"');
    expect(natural).toContain('id="natural-result-title"');
    expect(natural).toMatch(/class="compare"[\s\S]*class="pane"[\s\S]*class="pane output"/);
    expect(natural).toMatch(
      /\.compare\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/u,
    );
  });

  it('sends Korean to American English on the existing engine and does not retarget the page', () => {
    expect(natural).toContain('NATURAL_AMERICAN_TASK');
    expect(natural).toContain("src: 'ko'");
    expect(natural).toContain("tgt: 'en'");
    expect(natural).toContain("from './engine'");
    expect(natural).toContain('typedReadiness');
    expect(natural).not.toContain('saveSettings');
    expect(natural).not.toContain('LanguageField');
    expect(natural).not.toContain('translatePage');
    expect(natural).not.toContain('translatePost');
  });

  it('keeps the page translator and the new box on different controls', () => {
    const actions = popup.slice(
      popup.indexOf('class="page-actions"'),
      popup.indexOf('class="composers"'),
    );
    expect(actions).toContain('translatePage');
    expect(actions).toContain('translatePost');
    expect(actions).not.toContain('openNatural');
    expect(popup).toContain("getURL('/natural.html')");
    expect(popup).toContain('openTyped');
    expect(session).not.toContain('NATURAL_AMERICAN_TASK');
    expect(session).not.toContain('natural-american');
    expect(typed).not.toContain('natural-american');
    expect(typed).not.toContain('NATURAL_AMERICAN_TASK');
    expect(content).toContain('installNaturalFieldShortcut');
    expect(content).toContain('collectNaturalRewrite');
  });

  it('rewrites with Control+Enter and does not take Command+Enter', () => {
    expect(natural).toContain('settleNaturalRewriteKey');
    expect(natural).toContain('oncompositionend');
    expect(natural).toContain('onkeyup');
    expect(natural).not.toContain('isTranslateShortcut');
    expect(typed).toContain('isTranslateShortcut');
    expect(typed).not.toContain('reduceNaturalRewriteKey');
  });
});
