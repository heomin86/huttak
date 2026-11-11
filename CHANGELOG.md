# Changelog

Release sections are added by `pnpm release`. Each section lists commit subjects since the previous `vX.Y.Z` tag.

## [1.1.0] - 2026-11-11

### Features

- 유튜브와 X 영상 자막 번역 — 페이지 번역을 켜면 그 영상의 자막을 페이지와 같은 언어로 바꿔 영상 위에 보여 줍니다. 유튜브(일반 영상, Shorts, YouTube Music)와 X(x.com, 트위터)에서 됩니다. 번역은 페이지와 같이 이 기기 안에서 하고, 용어집도 같이 적용합니다. 유튜브 자동 자막은 말이 이어지는 동안에도 번역은 한 문장씩 유지되고, 다음 문장의 번역이 준비되면 그 문장으로 넘어갑니다. 읽는 대상은 영상의 자막 파일이며, 화면 안에 박혀 있는 글자는 포함되지 않습니다. 자막 파일이 없으면 영상에 그 사실을 표시합니다. (#6, #7)

## [1.0.2] - 2026-11-08

### Features

- Faster GPU page translation — the first translated paragraph appears sooner, and long pages finish faster. On the project's long-article WebGPU benchmark, the first paragraph appeared in about 0.5 seconds instead of 1.1, and the full page finished in about 14.6 seconds instead of 21.6. CPU translation is unchanged. (#25)

### Improvements

- The GitHub repository now has a Sponsor button and a Support section. Sakutto stays free and open source, with no ads or paid features. (#24)

## [1.0.1] - 2026-11-08

### Features

- Larger glossaries — each stored list (global or per site) now keeps up to 5,000 terms, up from 1,000. A translate run can carry the merged lists up to 10,000. Only terms that appear in the current text go into the model prompt. A user asked for a much larger glossary, and that seemed reasonable. (#23)
- Longer typed-text translation — paste up to 100,000 characters at once, up from 20,000. Long text is still split for the model. Surrounding page context stays at 20,000 characters. (#23)
- Faster GPU page translation — two paragraphs decode at once, each with its own cache, so long pages no longer slow down after paired paragraphs. The translated text is unchanged. CPU translation is untouched. (#22)

### Improvements

- Keyboard hints show Mac keys next to the Windows ones — Option+A, Option+B, and Option+S beside Alt+A/B/S, and ⌘+Enter beside Ctrl+Enter.
- Chrome Web Store listing matches the packaged locales — the name is "Sakutto - Local AI translation" (Japanese: "Sakutto - ローカルAI翻訳"). The short summary no longer repeats "Built with PLaMo"; that credit stays in the detailed description. (#17, #18)
- Clearer privacy policy for readers, in English and Japanese — translation runs on your device, there is no account, advertising, or analytics, and the only file the extension downloads is the model. (#21)

### Bug Fixes

- Text typed into a search box, message box, or form is no longer treated as page copy, including inputs wrapped in custom elements. Closed shadow roots stay out of reach. (#19, #20)
- A run of dots or asterisks in ordinary page text is no longer treated as a hidden password — only a real password field is masked that way. (#20)
- The on-page translation overlay is isolated from the host page, so a site script cannot read it, rewrite it, or turn on "always translate this site" for you.
- Model download remains the only network use — no page text, no credentials — and extension pages do not load remote scripts, styles, or fonts. The model file is kept only when its hash matches the pin. These surfaces are checked in tests. (#20)

## [1.0.0] - 2026-11-06

- No commits since the previous release.

## [0.1.1] - 2026-11-06

- Initial public source release
- Rename the public product to Sakutto.
- Format the store zip example after the package rename.
- Redraw the Sakutto mark as a folded strip.
- Ignore local video renders.
- Restore onboarding after the pinned GGUF commits moved.
- Add Chrome Web Store listing copy and review notes (#3)
- Show a selection icon that translates the highlight immediately (#5)
- Add a manual Chrome Web Store upload workflow. (#4)
- Keep long pages moving while PLaMo translates
- Keep translated text readable and translate whole pages
- Translate pages with PLaMo only, with no 簡易訳 badge or Chrome draft (#8)
- Add a durable page-translation speed bench with headline numbers (#9)
- Fix ranking-table layout collapse and pack short blocks into one request (#10)
- Make whole-page PLaMo translation continuous: one prompt per paragraph, headline first, held tok/s, WebGPU fallback detection (#11)
- Describe PLaMo license terms in onboarding and record consent honestly (#12)
- Serve bundled licences as UTF-8, cover special page prose, add typed translation, clarify licence onboarding (#13)
- Hide start controls until PLaMo can answer, and compare typed text side by side (#14)
- Drop the typed page's outer card and separate the panes with rules
- Keep the local launch-video renders out of git and the linter
