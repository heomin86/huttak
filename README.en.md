<p align="center"><img src="scripts/icon.svg" width="96" height="96" alt="Huttak logo"></p>

# Huttak (후딱)

[한국어](README.md) · **English** · [日本語](README.ja.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Built with PLaMo](https://img.shields.io/badge/Built%20with-PLaMo-6b46c1)](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF)
[![Fork of Sakutto](https://img.shields.io/badge/fork%20of-jammaru%2Fsakutto-555)](https://github.com/jammaru/sakutto)

Huttak is a Chrome extension that translates web pages **on your device**, aimed at Korean readers. There is no account, no ads, and no paid feature. By default, [PLaMo 3 Translate](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF) runs inside the browser.

It is an unofficial fork of [Sakutto](https://github.com/jammaru/sakutto), retargeted for Korean. It is not affiliated with Preferred Networks, Inc. or jammaru. **Built with PLaMo.**

This guide matches **v1.2.0** on `main`.

[Install](#install) · [First launch](#first-launch) · [Daily use](#daily-use) · [Engines](#translation-engines) · [Mac](#selected-text-on-a-mac) · [Privacy](#privacy)

> [!NOTE]
> There is no account. Page text, selections, your glossary, and translations are not sent to the developer or to a translation server.

> [!IMPORTANT]
> Huttak is not in the Chrome Web Store. Build it and load the unpacked folder, as below.

|                        |                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| For                    | People who want to read the web in Korean                                                               |
| Where translation runs | On this device. In the browser by default, or on a llama.cpp server on this computer if you choose that |
| First download         | The PLaMo model from Hugging Face (573MB by default). It is not packed in the extension                 |
| Page scope             | The whole page, or the post / article only                                                              |
| Captions               | YouTube and X, while page translation is on, when a caption file exists                                 |
| Mac                    | An optional menu-bar app in this repo translates a selection outside Chrome                             |

## Install

You need Chrome 116 or newer, Node.js 24, and pnpm 12. The translation runtime is compiled once, with Docker. Disk and time are described in [docs/BUILDING.md](docs/BUILDING.md).

```bash
pnpm install
pnpm build:wllama   # once, with Docker
pnpm verify:wllama
pnpm build          # output: .output/chrome-mv3
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `.output/chrome-mv3` folder in this repository.

Install does not ask for access to every site. Only `http` and `https` pages can be translated. `chrome://` pages are out of scope.

## First launch

1. Click the Huttak icon in the toolbar.
2. On the welcome screen, choose **Agree to the license and start**. That accepts the PLaMo Community License.
3. The default model (PLaMo 3 Translate 0.8B, 573MB) downloads from Hugging Face. Until it finishes, the page stays in the original language.
4. Open an English page and choose **Translate this page** or **Translate post only**.
5. Choose the same action again to restore the original.

Page translation waits until the model is ready. Progress is on the welcome screen. After the download, PLaMo translation does not need a network connection.

On some computers the popup offers a larger model (2B, about 1.81GB). If it does not, the 0.8B model is what translates the page.

## Daily use

The popup sets the target language and the reading style for the current site. The engine, the glossary, and how soon the model leaves memory are under **Open settings**.

Text you are typing, search boxes, password fields, and code blocks are not treated as page copy.

### Whole page and post only

|                      | Whole page              | Post only               |
| -------------------- | ----------------------- | ----------------------- |
| Popup                | **Translate this page** | **Translate post only** |
| Windows / Linux      | Alt+A                   | Alt+P                   |
| Mac                  | Option (⌥)+A            | Option (⌥)+P            |
| Right-click the page | Translate this page     | Translate post only     |

The same action again restores the original. If one scope is on, the other action switches to that scope.

**Post only** translates the article or post and leaves menus, sidebars, footers, and comment boxes alone. On X it translates the tweet text and the article body, and leaves the name, time, counts, and the trends column alone. Ordinary posts and blog bodies are included.

When the chrome around a post is Korean and the post itself is English, the post's language is what decides the direction, toward the target you set. After a translation, that original language is remembered, so the direction does not flip.

If no post or article is found, you only see a notice. The rest of the page is not changed. Use whole-page translation then.

Right-click the page without a selection to see the page menu. The selection menu is described under [Selected text](#selected-text).

### Shortcuts

| Action                                  | Windows / Linux | Mac           |
| --------------------------------------- | --------------- | ------------- |
| Translate the page, or restore          | Alt+A           | Option (⌥)+A  |
| Translate the post only, or restore     | Alt+P           | Option (⌥)+P  |
| Switch replaced text and bilingual text | Alt+B           | Option (⌥)+B  |
| Translate the selection                 | Alt+S           | Option (⌥)+S  |
| Translate typed text (on that page)     | Ctrl+Enter      | ⌘+Enter       |
| My Korean, in natural English           | Ctrl+Enter      | Control+Enter |

Change the keys at `chrome://extensions/shortcuts`. Chrome reads Alt in an extension shortcut as Option on a Mac. Alt+D is not used, because Chrome on Windows and Linux uses it for the address bar.

The default reading style is **Replace original**. **Bilingual** is remembered for that site. While a translation is running, progress shows in the popup and on the page.

### YouTube and X captions

While page translation or post translation is **on**, YouTube and X caption files are read and drawn over the video. Restoring the original stops caption translation too.

- A video with no caption file is not translated. Text burned into the picture is not read.
- YouTube automatic captions are translated once a phrase has gathered, and that line stays until the next one is ready. The player's caption window is hidden.
- X is read even if the caption file shows up a little late. Once the file is in hand, the player's own line is hidden and the translation is shown.
- A track that is already in the target language is left as it is.

### Selected text

Select text, then press Alt+S (Option+S on a Mac) or **Translate the selected text** in the right-click menu.

Drag a selection and a ㅎ icon appears beside it. Click the icon to translate. With the default setting the icon appears only after the extension has been used once in that tab (popup, shortcut, right-click menu, or "always translate this site").

**Show the drag-to-translate icon on every site** in settings asks for access to every site, so a drag alone raises the icon. Reload pages that were already open. Turning it off gives the access back.

### Typed text

**Translate typed text** in the popup or in settings opens a page where you paste text and translate it. It uses the same engine and the same target language as page translation. **Copy** takes the result. The limit is 100,000 characters at once. That page uses PLaMo only, and refuses a language PLaMo does not support.

### Korean I wrote

**My Korean, in natural English** in the popup or in settings opens a box for Korean you wrote yourself. It rewrites that Korean as American English a native speaker would actually use, not a stiff word-for-word translation. It is a separate input from whole-page translation, post-only translation, and the typed-text translator above. No account is required, and the text stays on this device. The default engine is in-browser PLaMo. If you have already chosen the local server in settings, that server does this rewrite too. **Copy** takes the English.

### Always translate this site

**Always translate this site** in the popup translates the whole page whenever you open that site. Chrome asks for access to that site then. It does not grant every site at once.

## Translation engines

Choose **Translation engine** in settings.

### PLaMo in the browser (default)

No extra program. PLaMo 3 Translate 0.8B runs in the browser. By default it leaves memory after 5 minutes of idle time. That delay can be changed in settings.

This is the default. Until you choose the local server, that server's memory is not used.

### Local server on this computer (llama.cpp)

Run `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp) on this computer. The extension sends translation requests only to this machine (`127.0.0.1`, `localhost`, `[::1]`). Page text does not leave the device. Host permission for `http://127.0.0.1/*` and `http://localhost/*` is requested only when you choose this engine. While it is selected, the extension does not load PLaMo. The server you started uses memory for the model.

The example shown in settings is below. The model file is not in the extension.

```bash
llama-server -m translategemma-12b-it.Q4_K_M.gguf --port 8080
```

Start the server, check the address (default `http://127.0.0.1:8080`), and press **Test the connection**.

- The server's chat template is used to tell TranslateGemma apart, and that model gets its own prompt shape.
- A general chat model (Kanana, Qwen3, and the like) gets a short translation instruction. Words small models often miss (weekdays and a few IT terms) are pinned with a built-in Korean glossary, and an English weekday left in the result is rewritten in Korean. Your own glossary wins.
- A sentence from the local server is marked "Machine translation by a model on this computer."

With the local server you can start translating without downloading PLaMo. That model's license is its own, separate from the PLaMo license.

<details>
<summary>Model comparison (2026-11-09, MacBook M4 Max, 21 sentences)</summary>

Fifteen sentences are English to Korean and six are Korean to English. All files are 4-bit GGUF. A "large miss" was counted by reading: the meaning changed, a sentence was dropped, or the text was not translated.

| Model                      | Size   | Large EN→KO misses | Time per sentence | License                      |
| -------------------------- | ------ | ------------------ | ----------------- | ---------------------------- |
| **PLaMo 3 Translate 0.8B** | 0.57GB | **0 / 15**         | 0.19s             | PLaMo Community License      |
| **TranslateGemma 12B**     | 7.3GB  | **0 / 15**         | 1.2s              | Gemma terms                  |
| Tower-Plus 2B              | 1.7GB  | 1 / 15             | 0.76s             | CC BY-NC-SA (non-commercial) |
| Kanana 1.5 2.1B            | 1.5GB  | 3–4 / 15           | 0.25s             | Apache 2.0                   |
| TranslateGemma 4B          | 2.5GB  | 4 / 15             | 0.43s             | Gemma terms                  |
| Qwen3 4B                   | 2.5GB  | 6 / 15             | 0.47s             | Apache 2.0                   |
| MADLAD-400 3B              | 1.9GB  | 7 / 15             | 1.3s              | Apache 2.0                   |

- At a size that fits in the browser, nothing beat PLaMo 0.8B.
- TranslateGemma 12B matches PLaMo and sounds more colloquial, but it is 13× larger and 6× slower, so it fits the local server.
- Twenty-one sentences only support the large gaps.

</details>

## Selected text on a Mac

This repository includes a Mac menu-bar app. It does not modify the Chrome extension, and it is not submitted to the Mac App Store.

It reads the selection in the front app through Accessibility and translates it on this Mac with the same PLaMo model. English goes to Korean and Korean goes to English. The translation covers the original glyphs. It does not edit the other app's text. A side panel is used only when the app cannot report where the selection is.

```bash
pnpm mac
```

Run that from the repository root after `pnpm install`. You need Node.js 24 or newer and CMake. It does not build or reload the Chrome extension. The first run compiles llama.cpp on this Mac. The first translation downloads PLaMo into `~/Library/Application Support/Huttak/models/`.

1. Drag text in another app.
2. Click the **ㅎ** beside it. The shortcut is **⌃⌥S**, which is not the extension's Option+S. The app's menus and buttons are in Korean.
3. The first time, choose **동의하고 번역** (agree and translate).
4. Click outside the cover, or press Esc, to see the original again.

**Accessibility** is required. **Screen and system audio recording** is optional. When it is on, the cover uses the background and text color around the original. The capture is used only to read those colors and is not saved.

Permissions, signing, and how to rebuild are in [macos/README.md](macos/README.md).

## Languages

PLaMo 3 Translate covers 53 languages in either direction. The source language is detected from the page. The default target is the Chrome UI language, or Korean when that language is not one of the 53. A page that is already in the target language flips: a Korean page goes to English, and any other page goes to Korean. The popup can set a different target for the current site.

When the target is Japanese, the **Japanese tone** setting offers **Polite (です・ます)** or **Plain (だ・である)**. Settings also hold a glossary. Only terms that appear in the current text are sent to the model.

Eleven languages PLaMo does not support (cs, da, el, fi, kn, no, pt, ro, sv, tr, uk) are translated on the page only, by Chrome's built-in translator. Chrome downloads those language packs.

The extension UI is English, Japanese, or Korean, following Chrome's display language.

## Privacy

Translation runs on your device. There is no account, no advertising, and no analytics. The developer does not receive page text, selections, your glossary, or translations.

The file the extension itself downloads is the PLaMo model from Hugging Face. If you choose the local-server engine, requests go only to the server on this computer. You can delete the model and clear the translation cache in settings.

The Huttak policy is [PRIVACY.ko.md](PRIVACY.ko.md) (Korean). The upstream Sakutto policy, in English and Japanese, is [PRIVACY.md](PRIVACY.md).

## How this differs from Sakutto

The same sentence through the default engine (PLaMo 0.8B in the browser) is the same translation. The difference is who the translator is for.

|                               | Sakutto                                      | Huttak                                                                                        |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Default pair                  | Japanese↔English                             | **Korean↔English**                                                                            |
| Page already in that language | Japanese page → English                      | Korean page → English                                                                         |
| UI languages                  | English, Japanese                            | English, Japanese, **Korean**                                                                 |
| Tuning                        | Speed and warmup measured on Japanese output | Speed and warmup measured on Korean output, and English UI strings pre-translated into Korean |
| Engine                        | PLaMo in the browser                         | PLaMo in the browser (default) + **optional local llama.cpp**                                 |
| Distribution                  | Chrome Web Store                             | Not listed yet. Load it yourself                                                              |

## Build and development

The commands you need to use Huttak are under [Install](#install). `pnpm build:wllama` compiles the pinned wllama commit `d275dac` inside the `emscripten/emsdk:4.0.20` container. The wasm, workers, and model weights are not committed. `pnpm build` and `pnpm zip` refuse to run until that build has been verified.

```bash
pnpm dev            # development build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e       # local pages; does not download the model
pnpm zip            # Chrome Web Store zip in .output. This does not publish it
```

`pnpm bench:mock` and `pnpm bench:live` time whole-page translation on eight fixtures in [bench/pages](bench/pages). See [bench/README.md](bench/README.md).

## Permissions

| Permission         | Why it is requested                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `storage`          | Saves the target language, reading style, and other settings.                              |
| `unlimitedStorage` | Keeps the downloaded model and the translation cache on the device.                        |
| `offscreen`        | Runs the translation runtime in a document whose workers outlive the service worker.       |
| `activeTab`        | Reads the current page after you open the popup or use a command.                          |
| `scripting`        | Injects the content script into the active tab after you ask for a translation.            |
| `contextMenus`     | Adds translate page, translate post only, and translate selection to the right-click menu. |

Optional host permissions are requested only in three cases: always translate this site, the local-server engine, and the drag icon on every site. Nothing is requested for every site at install time.

## License

- Extension code is MIT. See [LICENSE](LICENSE). The original copyright is Copyright (c) 2026 jammaru, and the original [NOTICE](NOTICE) is kept.
- PLaMo 3 Translate is under the PLaMo Community License. The texts are `licenses/PLaMo-Community-License-ja.txt` and `licenses/PLaMo-Community-License-en.txt`, and the same copies are packed into the extension.
  - Personal and academic use needs no registration.
  - Commercial use (company work, a product, an API) needs [prior registration with PFN](https://forms.gle/mTL8tBLrMYXKNZD56) and income or sales, for you or your affiliates, of no more than 1 billion yen in the most recent fiscal year. Otherwise commercial use needs a separate commercial license from PFN.
  - This repository's MIT license covers the extension code, not the model weights.
- A model you run through the local server follows that model's license.
- llama.cpp, wllama, the Emscripten runtime, the Dawn WebGPU library, and Svelte: see [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- `scripts/bench/fixtures/kyoto.html` is a CC BY-SA 4.0 Wikipedia derivative. It is not covered by the MIT license and is not part of the extension package.

Huttak is based on [Sakutto](https://github.com/jammaru/sakutto) by jammaru. To support the original development, see [GitHub Sponsors](https://github.com/sponsors/jammaru). The upstream README is at [jammaru/sakutto](https://github.com/jammaru/sakutto).
