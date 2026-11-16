#!/bin/bash
# Packages the menu-bar app and opens it. The Chrome extension is not built or reloaded.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js 24 or newer is required. The translator runs the extension's engine with it." >&2
  exit 1
fi
LLAMA_BIN="$(bash "$ROOT/macos/translator/build-llama.sh")"

# Replacing the bundle while Huttak is running makes Launch Services
# report that the executable is missing.
killall Huttak >/dev/null 2>&1 || true
pkill -f "$ROOT/macos/dist/Huttak.app/Contents/Resources/translator.mjs" >/dev/null 2>&1 || true
sleep 0.3

swift build -c release --package-path "$ROOT/macos/Huttak"
node "$ROOT/macos/translator/bundle.mjs" "$ROOT/macos/.cache/translator.mjs"

APP="$ROOT/macos/dist/Huttak.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/macos/Huttak/.build/release/Huttak" "$APP/Contents/MacOS/Huttak"
cp "$ROOT/macos/Huttak/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/macos/.cache/translator.mjs" "$APP/Contents/Resources/translator.mjs"
NODE_BIN="$NODE_BIN" LLAMA_BIN="$LLAMA_BIN" ROOT="$ROOT" APP="$APP" node --input-type=module <<'EOF'
import { writeFileSync } from 'node:fs';
writeFileSync(
  `${process.env.APP}/Contents/Resources/launch.json`,
  `${JSON.stringify(
    {
      repo: process.env.ROOT,
      node: process.env.NODE_BIN,
      llamaServer: process.env.LLAMA_BIN ?? '',
      translator: `${process.env.APP}/Contents/Resources/translator.mjs`,
    },
    null,
    2,
  )}\n`,
);
EOF
codesign --force --sign - "$APP"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
"$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true
echo "Huttak.app: $APP"
echo "Grant Accessibility to Huttak in System Settings → Privacy & Security → Accessibility."
if [[ "${HUTTAK_NO_OPEN:-}" != "1" ]]; then
  open "$APP"
fi
