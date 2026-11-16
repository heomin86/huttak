# Mac에서 선택한 글 번역

메뉴 막대 앱입니다. 앞쪽 앱에서 선택한 글을 손쉬운 사용으로 읽고, Chrome 확장과 같은 PLaMo 번역 엔진(`InBrowserEngine`)으로 이 Mac 안에서 번역한 뒤, 그 앱을 떠나지 않고 선택 영역 옆에 결과를 띄웁니다. 영어는 한국어로, 한국어는 영어로 갑니다.

확장을 빌드하거나 다시 불러오지 않습니다. Mac App Store에도 올리지 않습니다.

## 이 Mac에서 실행

저장소를 받은 뒤 `pnpm install`을 해 둡니다. `pnpm mac`은 Chrome 확장을 빌드하거나 다시 불러오지 않습니다.

저장소 루트에서:

```bash
pnpm mac
```

`pnpm mac`은 `macos/run.sh`입니다. Swift 앱을 `macos/dist/Huttak.app`으로 묶고 엽니다. Node.js 24 이상과 CMake가 필요합니다. 번역 프로세스는 확장의 `InBrowserEngine`을 그대로 부릅니다. 문장을 나누고 프롬프트를 만드는 코드는 확장과 같고, 계산은 확장이 wasm으로 고정해 둔 것과 같은 llama.cpp 커밋(`scripts/wllama/pins.ts`의 `LLAMA_CPP_COMMIT`)을 이 Mac에서 컴파일해 합니다. 그 빌드가 PLaMo 3 토크나이저를 알고 있습니다. 처음 한 번만 컴파일하고, 결과는 `macos/.cache/bin/llama-server`에 둡니다.

모델 가중치는 처음 번역할 때 확장과 같은 PLaMo 3 Translate 0.8B 파일을 받아 `~/Library/Application Support/Huttak/models/`에 둡니다.

## 권한

**손쉬운 사용**을 켜야 합니다. 앱을 열면 안내 창이 뜨고, 시스템 설정의 손쉬운 사용(최신 macOS에서는 개인정보 보호 및 보안 안의 기기 제어 및 데이터 접근)으로 갑니다. 목록에 Huttak이 없으면 Finder에 열린 `Huttak.app`을 그 목록으로 끌어다 놓습니다. 이 권한으로 앞쪽 앱의 선택 글과 위치만 읽습니다. 암호 필드는 읽지 않습니다.

앱을 다시 빌드하면 macOS가 이 권한을 잊는 경우가 있습니다. 그때는 목록에서 Huttak을 뺐다가 다시 켜면 됩니다. 켜기 전에는 메뉴의 「선택한 글 번역」이 그 안내를 다시 보여 주고, ㅎ 버튼은 뜨지 않습니다.

## 쓰는 법

1. 다른 앱에서 글을 드래그합니다.
2. 선택 옆에 뜨는 **ㅎ**을 누릅니다.
3. 처음이면 PLaMo Community License 안내에서 **동의하고 번역**을 누릅니다.
4. 결과가 그 자리에 뜨면 **복사**로 가져갑니다.

단축키는 **⌃⌥S**입니다. 확장의 Option+S는 Chrome 안에 그대로 둡니다.

모델을 불러온 llama.cpp 프로세스는 마지막 번역 뒤 5분이 지나면 메모리에서 내립니다. 확장이 모델을 내리는 간격과 같습니다.
