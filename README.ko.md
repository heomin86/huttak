# Huttak (작업 이름)

[Sakutto](https://github.com/jammaru/sakutto)를 포크해 한국어 사용자에게 맞춘 Chrome 확장입니다.
웹페이지를 내 기기 안에서 PLaMo 3 Translate로 번역하고, 페이지 글은 서버로 보내지 않습니다.

비공식 확장입니다. Preferred Networks, Inc. 및 jammaru와 무관합니다. **Built with PLaMo.**

## 원본과 다른 점

- 기본 언어쌍이 한국어↔영어입니다. 영어 페이지는 한국어로, 이미 한국어인 페이지는 영어로 번역합니다.
- 확장 화면(팝업, 설정, 시작 안내, 입력 번역)이 한국어로 나옵니다(`public/_locales/ko`).
- 모델 워밍업과 속도 측정(고정확도 모델 추천 기준)을 한국어 출력으로 합니다.
- 자주 쓰는 한국어 UI 문구(로그인, 설정 등)를 미리 번역해 캐시합니다.
- 한국어 뉴스 테스트 페이지(`e2e/fixtures/ko-news.html`)와 단위 테스트를 더했습니다.

## 라이선스

- 확장 코드: MIT. 원본 저작권(Copyright (c) 2026 jammaru)과 NOTICE를 그대로 둡니다.
- 모델: PLaMo Community License. 개인·학술 사용은 등록 없이 됩니다. 회사 업무·제품·API·호스팅 등 상업 목적에는 PFN 사전 등록이 필요하고, 최근 회계연도 매출 10억 엔 이하 조건이 있습니다. 유료 상품으로 가기 전에는 법률 확인이 필요합니다.

## 빌드

원본과 같습니다. Node.js 24, pnpm 12, 번역 런타임을 컴파일할 Docker가 필요합니다. [docs/BUILDING.md](docs/BUILDING.md)를 보세요.

## 로컬 서버 엔진 (내 맥의 번역 모델)

설정에서 「번역 엔진」을 「이 컴퓨터의 로컬 서버 (llama.cpp)」로 바꾸면, 브라우저 안의 PLaMo 대신 내 컴퓨터에서 돌아가는 모델로 번역합니다. 주소는 이 컴퓨터(127.0.0.1, localhost)만 받습니다.

```bash
llama-server -m translategemma-12b-it.Q4_K_M.gguf --port 8080 -ngl 99
```

- 품질은 기본 엔진인 PLaMo 0.8B와 로컬용 TranslateGemma 12B가 가장 좋습니다. 21문장 비교에서 두 모델 모두 영어→한국어 큰 오역이 0개였습니다. PLaMo는 573MB로 작고 빠르며, TranslateGemma 12B는 7.3GB에 문장당 약 1.2초(M4 Max)입니다.
- TranslateGemma는 Gemma 이용 약관으로 상업 이용이 가능해서, PLaMo 등록·매출 조건 없이 쓰고 싶을 때 맞습니다. 엔진이 서버의 채팅 템플릿을 보고 TranslateGemma인지 알아서 판단해, 그 모델 전용 프롬프트로 보냅니다.
- 일반 대화형 모델(예: Kanana 1.5 2.1B, Apache 2.0)도 연결할 수 있습니다. 이때는 짧은 번역 지시문과 기본 한국어 용어집, 요일 보정을 씁니다. TranslateGemma에는 용어집이 들어가지 않습니다.
- 모델 비교 결과는 `~/Projects/huttak-bench/REPORT.md`에 있습니다.
