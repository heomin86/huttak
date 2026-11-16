#!/bin/bash
# Builds the llama.cpp server at the commit the extension already pins, so the
# Mac app loads the same PLaMo 3 tokenizer as the in-browser engine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIN="$(sed -n "s/^export const LLAMA_CPP_COMMIT = '\\([0-9a-f]*\\)'.*/\\1/p" "$ROOT/scripts/wllama/pins.ts")"
if [[ -z "$PIN" ]]; then
  echo "Could not read LLAMA_CPP_COMMIT from scripts/wllama/pins.ts" >&2
  exit 1
fi

CACHE="$ROOT/macos/.cache"
SRC="$CACHE/llama.cpp"
BIN="$CACHE/bin/llama-server"
STAMP="$CACHE/bin/llama-server.commit"

if [[ -x "$BIN" && -f "$STAMP" && "$(cat "$STAMP")" == "$PIN" ]]; then
  printf '%s\n' "$BIN"
  exit 0
fi

mkdir -p "$CACHE/bin"
if [[ ! -d "$SRC/.git" ]]; then
  rm -rf "$SRC"
  git clone --filter=blob:none --no-checkout https://github.com/ggml-org/llama.cpp.git "$SRC"
fi

echo "Fetching llama.cpp $PIN" >&2
git -C "$SRC" fetch --depth 1 origin "$PIN"
git -C "$SRC" checkout --detach --force FETCH_HEAD

echo "Compiling llama-server" >&2
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TOOLS=ON \
  -DGGML_METAL=ON \
  >/tmp/huttak-cmake.out
cmake --build "$SRC/build" --target llama-server -j "$(sysctl -n hw.ncpu)" >/tmp/huttak-cmake-build.out

FOUND="$(find "$SRC/build" -type f -name 'llama-server' -perm +111 | head -1)"
if [[ -z "$FOUND" ]]; then
  echo "llama-server was not produced. See /tmp/huttak-cmake-build.out" >&2
  exit 1
fi
cp "$FOUND" "$BIN"
chmod +x "$BIN"
printf '%s\n' "$PIN" >"$STAMP"
printf '%s\n' "$BIN"
