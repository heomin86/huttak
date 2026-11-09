# Huttak (후딱)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Built with PLaMo](https://img.shields.io/badge/Built%20with-PLaMo-6b46c1)](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF)
[![Fork of Sakutto](https://img.shields.io/badge/fork%20of-jammaru%2Fsakutto-555)](https://github.com/jammaru/sakutto)

Huttak은 웹페이지를 내 기기 안에서 번역하는 한국어 사용자용 Chrome 확장입니다. [Sakutto](https://github.com/jammaru/sakutto)를 포크해서 한국어에 맞게 고쳤습니다. 번역은 [PLaMo 3 Translate](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF)가 브라우저 안에서 하고, 페이지 글은 서버로 보내지 않습니다.

비공식 확장입니다. Preferred Networks, Inc. 및 jammaru와 무관합니다. **Built with PLaMo.**

확장은 무료이고 오픈소스(MIT)입니다. 광고와 유료 기능이 없습니다. 모델 가중치는 이 저장소와 확장 패키지에 들어 있지 않습니다. 처음 쓸 때 Hugging Face에서 받습니다.

## 원본 Sakutto와 다른 점

- **한국어↔영어가 기본입니다.** 영어 페이지는 한국어로, 이미 한국어인 페이지는 영어로 번역합니다. 원본은 일본어↔영어였습니다.
- **확장 화면이 한국어입니다.** 팝업, 설정, 시작 안내, 입력 번역 화면이 Chrome 표시 언어가 한국어일 때 한국어로 나옵니다.
- **한국어 기준으로 맞췄습니다.** 모델 워밍업과 속도 측정(고정확도 모델 추천 기준)을 한국어 출력으로 하고, 자주 쓰는 한국어 UI 문구(로그인, 설정 등)를 미리 번역해 둡니다.
- **로컬 서버 엔진을 고를 수 있습니다.** 브라우저 안의 PLaMo 대신, 내 컴퓨터에서 돌아가는 llama.cpp 서버의 번역 모델(예: TranslateGemma 12B)로 번역할 수 있습니다. 아래 「번역 엔진」을 보세요.

## 설치

아직 Chrome 웹 스토어에 올리지 않았습니다. 직접 빌드해서 불러옵니다.

1. Node.js 24와 pnpm 12를 설치합니다.
2. 이 저장소를 내려받고 `pnpm install`을 실행합니다.
3. 번역 런타임과 확장을 빌드합니다(아래 「빌드」 참고).
4. Chrome에서 `chrome://extensions`를 엽니다.
5. **개발자 모드**를 켭니다.
6. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
7. 이 저장소의 `.output/chrome-mv3` 폴더를 고릅니다.

## 단축키

| 동작                                | Windows / Linux | Mac          |
| ----------------------------------- | --------------- | ------------ |
| 페이지 번역, 또는 원문으로 되돌리기 | Alt+A           | Option (⌥)+A |
| 원문 바꾸기 ↔ 원문과 함께 보기 전환 | Alt+B           | Option (⌥)+B |
| 선택한 글 번역                      | Alt+S           | Option (⌥)+S |
| 입력한 글 번역 (입력 번역 화면에서) | Ctrl+Enter      | ⌘+Enter      |

같은 동작이 도구 모음 팝업과 마우스 오른쪽 메뉴에도 있습니다. 키는 `chrome://extensions/shortcuts`에서 바꿀 수 있습니다.

## 입력 번역

팝업이나 설정 화면의 **입력한 글 번역** 버튼을 누르면, 글을 입력하거나 붙여 넣어 바로 번역하는 작은 화면이 열립니다. 페이지 번역과 같은 엔진과 같은 번역 언어 설정을 쓰고, 결과는 **복사** 버튼으로 가져갈 수 있습니다.

## 번역 엔진

설정 화면의 「번역 엔진」에서 고릅니다.

### 브라우저 안의 PLaMo (기본)

PLaMo 3 Translate 0.8B(573MB)를 브라우저 안에서 돌립니다. 별도 프로그램이 필요 없습니다. 처음 쓸 때 PLaMo Community License에 동의하면 모델을 받습니다.

### 이 컴퓨터의 로컬 서버 (llama.cpp)

내 컴퓨터에서 [llama.cpp](https://github.com/ggml-org/llama.cpp) 서버를 켜 두고, 확장이 그 서버로 번역을 요청합니다. 주소는 이 컴퓨터(127.0.0.1, localhost)만 받으므로 페이지 글은 기기 밖으로 나가지 않습니다. 이 엔진을 고를 때만 `http://127.0.0.1/*`, `http://localhost/*` 접근 권한을 요청합니다.

```bash
llama-server -m translategemma-12b-it.Q4_K_M.gguf --port 8080 -ngl 99
```

- 서버를 켠 뒤 설정에서 주소(기본 `http://127.0.0.1:8080`)를 확인하고 「연결 확인」을 누릅니다.
- 서버의 채팅 템플릿을 보고 TranslateGemma인지 알아서 판단해, 그 모델 전용 프롬프트로 보냅니다.
- 일반 대화형 모델(Kanana, Qwen3 등)을 연결하면 짧은 번역 지시문으로 보냅니다. 이때 소형 모델이 자주 틀리는 말(요일, 대시보드 같은 IT 용어)은 기본 한국어 용어집으로 고정하고, 결과에 영어 요일이 남으면 한국어로 고칩니다. 내 용어집이 우선합니다.
- 로컬 서버로 번역한 문장에는 「이 컴퓨터의 로컬 모델이 만든 기계 번역」이라고 표시합니다.

### 모델 비교 (2026-11-09)

맥북 M4 Max에서 문장 21개(영어→한국어 15, 한국어→영어 6)로 비교했습니다. 모두 4비트 GGUF이고, 「큰 오역」은 뜻이 바뀌거나 문장이 빠지거나 번역되지 않은 경우를 직접 읽고 센 것입니다.

| 모델                       | 크기   | 영→한 큰 오역 | 문장당 속도 | 라이선스                |
| -------------------------- | ------ | ------------- | ----------- | ----------------------- |
| **PLaMo 3 Translate 0.8B** | 0.57GB | **0 / 15**    | 0.19초      | PLaMo Community License |
| **TranslateGemma 12B**     | 7.3GB  | **0 / 15**    | 1.2초       | Gemma 이용 약관         |
| Tower-Plus 2B              | 1.7GB  | 1 / 15        | 0.76초      | CC BY-NC-SA (비상업)    |
| Kanana 1.5 2.1B            | 1.5GB  | 3~4 / 15      | 0.25초      | Apache 2.0              |
| TranslateGemma 4B          | 2.5GB  | 4 / 15        | 0.43초      | Gemma 이용 약관         |
| Qwen3 4B                   | 2.5GB  | 6 / 15        | 0.47초      | Apache 2.0              |
| MADLAD-400 3B              | 1.9GB  | 7 / 15        | 1.3초       | Apache 2.0              |

- 브라우저 안에서 돌릴 크기에서는 PLaMo 0.8B보다 나은 모델이 없었습니다.
- TranslateGemma 12B는 PLaMo와 같은 수준이고 구어체가 더 자연스럽지만, 13배 크고 6배 느려서 로컬 서버용으로 맞습니다.
- 한국어 특화 대화 모델(Kanana)은 한국어 문장은 자연스러워도 영어 원문을 잘못 읽는 경우가 있어, 번역 전용 모델보다 오역이 많았습니다.
- 문장 21개짜리 비교라서 큰 차이만 믿을 만합니다.

## 언어

PLaMo 3 Translate는 53개 언어를 양방향으로 번역합니다. 원문 언어는 페이지에서 감지합니다. 번역할 언어의 기본값은 Chrome 표시 언어이고, 그 언어가 53개에 없으면 한국어입니다. 사이트마다 번역 언어를 따로 정할 수 있습니다.

PLaMo가 지원하지 않는 11개 언어(cs, da, el, fi, kn, no, pt, ro, sv, tr, uk)는 Chrome 기본 번역기로만 번역합니다.

## 개인정보

번역은 내 기기 안에서 합니다. 확장은 페이지 글, 선택한 글, 용어집, 번역 결과를 개발자나 번역 서버로 보내지 않고, 계정·광고·사용 기록 수집이 없습니다. 확장이 직접 보내는 요청은 Hugging Face에서 모델을 받는 것뿐입니다. 로컬 서버 엔진을 고르면 이 컴퓨터의 서버로만 요청합니다. 원본 개인정보 처리방침은 [PRIVACY.md](PRIVACY.md)에 있습니다.

## 빌드

```bash
pnpm install
pnpm build:wllama   # 처음 한 번, Docker 필요. docs/BUILDING.md 참고
pnpm verify:wllama
pnpm build          # .output/chrome-mv3에 배포용 빌드
pnpm zip            # .output에 Chrome 웹 스토어용 zip
```

`pnpm build:wllama`는 고정된 wllama 커밋 `d275dac`를 `emscripten/emsdk:4.0.20` 컨테이너 안에서 컴파일합니다. wasm, worker, 모델 가중치는 커밋하지 않습니다. 이 빌드를 확인하기 전에는 `pnpm build`와 `pnpm zip`이 실행되지 않습니다.

로컬 서버 엔진만 쓸 거라면 번역 런타임 빌드 없이 가짜 엔진으로 빌드해도 됩니다.

```bash
SAKUTTO_FAKE_ENGINE=1 pnpm exec wxt build
```

개발과 검사:

```bash
pnpm dev            # 개발용 빌드
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e       # 로컬 테스트 페이지, 모델을 받지 않음
```

`pnpm bench:mock`과 `pnpm bench:live`는 [bench/pages](bench/pages)의 고정 페이지 8개로 페이지 전체 번역 속도를 잽니다. 자세한 내용은 [bench/README.md](bench/README.md)를 보세요.

## 권한

| 권한               | 요청하는 이유                                                 |
| ------------------ | ------------------------------------------------------------- |
| `storage`          | 번역 언어, 보기 방식 등 설정을 저장합니다.                    |
| `unlimitedStorage` | 받은 모델과 번역 캐시를 기기에 보관합니다.                    |
| `offscreen`        | 서비스 워커보다 오래 사는 문서에서 번역 런타임을 돌립니다.    |
| `activeTab`        | 팝업을 열거나 명령을 쓴 뒤 현재 페이지를 읽습니다.            |
| `scripting`        | 번역을 요청하면 현재 탭에 콘텐츠 스크립트를 넣습니다.         |
| `contextMenus`     | 마우스 오른쪽 메뉴에 페이지 번역과 선택한 글 번역을 넣습니다. |

선택 권한(`https://*/*`, `http://*/*`)은 사이트 자동 번역을 켤 때와 로컬 서버 엔진을 고를 때만 요청합니다. 설치할 때 모든 사이트 권한을 요청하지 않습니다.

## 라이선스

- 확장 코드: MIT. [LICENSE](LICENSE)를 보세요. 원본 저작권은 Copyright (c) 2026 jammaru이고, 원본 [NOTICE](NOTICE)를 그대로 둡니다.
- PLaMo 3 Translate: PLaMo Community License. 전문은 `licenses/PLaMo-Community-License-ja.txt`, `licenses/PLaMo-Community-License-en.txt`에 있고 확장에도 같은 사본이 들어갑니다.
  - 개인·학술 이용은 등록 없이 됩니다.
  - 회사 업무, 제품, API 같은 상업 이용은 PFN 사전 등록(https://forms.gle/mTL8tBLrMYXKNZD56)이 필요하고, 본인 또는 관계사의 최근 회계연도 소득이나 매출이 10억 엔 이하여야 합니다. 그렇지 않으면 PFN의 별도 상업 라이선스가 필요합니다.
  - 이 저장소의 MIT 라이선스는 확장 코드에만 적용되고, 모델 가중치에는 적용되지 않습니다.
- 로컬 서버 엔진으로 쓰는 모델은 각 모델의 라이선스를 따릅니다(위 「모델 비교」 표 참고).
- llama.cpp, wllama, Emscripten 런타임, Dawn WebGPU 라이브러리, Svelte: [NOTICE](NOTICE)와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 보세요.
- `scripts/bench/fixtures/kyoto.html`은 CC BY-SA 4.0 위키백과 파생물입니다. MIT 라이선스가 적용되지 않고 확장 패키지에도 들어가지 않습니다.

## 원본

Huttak은 jammaru가 만든 [Sakutto](https://github.com/jammaru/sakutto)를 바탕으로 합니다. 원본 문서는 [README.en.md](README.en.md)(영어)와 [README.ja.md](README.ja.md)(일본어)에 그대로 있습니다. 원본 개발을 응원하려면 [GitHub Sponsors](https://github.com/sponsors/jammaru)를 찾아 주세요.
