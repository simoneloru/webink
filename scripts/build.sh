#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v emcmake >/dev/null 2>&1; then
  if [[ -f "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" ]]; then
    # shellcheck disable=SC1090
    source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh"
  fi
fi

if ! command -v emcmake >/dev/null 2>&1; then
  echo "error: emcmake not found. Install emsdk and: source ~/emsdk/emsdk_env.sh" >&2
  exit 1
fi

git submodule update --init --recursive
./scripts/patch_simulator.sh
./scripts/patch_crossink_emscripten.sh

mkdir -p www/icons
# Placeholder icons if missing
if [[ ! -f www/icons/icon-192.png ]]; then
  python3 scripts/gen_icons.py || true
fi

# Generated firmware assets (same as PlatformIO pre scripts)
(
  cd vendor/CrossInk
  python3 scripts/gen_i18n.py
  python3 scripts/build_web.py || true
)

BUILD_DIR=wasm/build
emcmake cmake -S wasm -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR" --parallel

echo ""
echo "Build OK → www/crossink.js + www/crossink.wasm"
echo "Serve with: ./scripts/serve.sh"
