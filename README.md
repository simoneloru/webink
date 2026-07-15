# WebInk

**CrossInk in the browser** — the same C++ app (via the CrossPoint simulator HAL), compiled to WebAssembly with Emscripten.

This is not a new e-reader. It is CrossInk running client-side:

- UI, EPUB engine, fonts, menus → CrossInk
- Display / buttons / storage stubs → [crosspoint-simulator](https://github.com/uxjulia/crosspoint-simulator) (SDL2 → canvas)
- Persistence → Emscripten IDBFS (IndexedDB on the device)
- Hosting → static files on GitHub Pages

**Books never leave the device.** There is no upload server; EPUB files are chosen locally and stored only in the browser’s IndexedDB.

## What’s stripped for the web

Hardware / network pieces that don’t apply in a browser are excluded or stubbed:

- Wi‑Fi AP / station, device web server, WebDAV
- OTA / SD firmware flash
- USB serial file transfer
- Nearby BLE-style sync (no browser equivalent)

Core reading (file browser, EPUB, progress cache under `.crosspoint/`) is the target.

## Layout

```
vendor/CrossInk/              # submodule — firmware
vendor/crosspoint-simulator/  # submodule — native/sim HAL
wasm/                         # Emscripten CMake + web-only patches
www/                          # PWA shell (HTML/JS/manifest/SW)
.github/workflows/deploy.yml  # build + GitHub Pages
```

## Prerequisites (local)

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`emcc` on `PATH`)
- CMake ≥ 3.20, Ninja
- Python 3 (i18n is already generated in CrossInk; scripts optional)

```bash
# emsdk (example)
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk/emsdk_env.sh
```

## Build

```bash
git submodule update --init --recursive
./scripts/build.sh
# outputs: www/crossink.js  www/crossink.wasm  (+ worker if pthreads)
```

Serve locally (required for Wasm + SharedArrayBuffer isolation when using pthreads):

```bash
./scripts/serve.sh
# open http://localhost:8080/
```

## Controls (same as desktop simulator)

| Key | Action |
|-----|--------|
| ↑ / ↓ | Side buttons (page) |
| ← / → | Front buttons |
| Enter | Confirm |
| Esc | Back |
| P | Power |
| S | Sleep (sim) |

Touch: left/right thirds and top/bottom strips map to the same buttons.

## Deploy

Push to `main`. GitHub Actions builds with Emscripten and deploys `www/` to GitHub Pages.

Enable: **Settings → Pages → Source: GitHub Actions**.

## License

CrossInk / simulator retain their upstream licenses (MIT). WebInk shell code in this repo is MIT.
