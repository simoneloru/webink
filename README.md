# WebInk

**CrossInk in your browser.** The same C++ e-reader firmware that runs on Xteink e-ink devices, compiled to WebAssembly and running fully client-side.

No new reader UI. No cloud library. No upload of your books to a server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live:** [https://simoneloru.github.io/webink/](https://simoneloru.github.io/webink/)

---

## Why this exists

[CrossInk](https://github.com/uxjulia/CrossInk) is open-source firmware for the Xteink X3/X4 e-readers. It already has a desktop path via the [CrossPoint simulator](https://github.com/uxjulia/crosspoint-simulator) (SDL2 window, host filesystem as SD card).

**WebInk** takes that simulator stack and targets the web:

| Layer | What runs |
|--------|-----------|
| App | CrossInk (EPUB engine, UI, fonts, menus, progress) |
| HAL | crosspoint-simulator → SDL2 → HTML5 canvas |
| Storage | Emscripten virtual FS + **IDBFS** (IndexedDB) |
| Shell | Minimal PWA: Reader + Library + Help pages |

The goal is simple: **use CrossInk without a device**, on a laptop or phone, with your files staying on the device.

---

## Privacy

**Books never leave the browser.**

1. You pick a local `.epub` (or drop files onto the page).
2. Files are written into the Wasm virtual SD card (`/fs_/books/`).
3. Persistence uses **IndexedDB** on your machine (via IDBFS).

There is no backend, no book API, and no analytics. GitHub Pages only serves HTML, JS, and Wasm.

Clearing site data, switching browsers, or private mode can erase the library.

---

## Try it

**https://simoneloru.github.io/webink/**

Works on desktop browsers and mobile (including iOS Safari). The build is **single-threaded Wasm** — no SharedArrayBuffer / cross-origin isolation required.

### Quick use

1. Open the site.
2. **Add book** in the top bar (multi-select) or drag-and-drop `.epub` files.
3. On the CrossInk home screen, open **Browse files** and open the book under `/books`.
4. Use **Library** to see storage, list books, and delete them.
5. Optional: **Install** as a PWA when the browser offers it.

Books are written to browser storage **automatically** after add/delete (and when you leave the tab). You do not need a separate “save” for normal use.

### Shell pages

| Page | URL | Purpose |
|------|-----|---------|
| **Reader** | `/` | Device panel + on-screen X4 chrome |
| **Library** | `/#library` | Virtual SD: counts, sizes, quota, delete |
| **Help** | `/#help` | Short guide (always available from the bar) |

### Controls

On-screen **X4-style chrome** surrounds the canvas (side page keys + front Left / OK / Right / Back / Power). They inject the same key events as the CrossPoint desktop simulator.

| Input | Action |
|--------|--------|
| On-screen ▲ / ▼ (sides) | Page back / forward |
| On-screen ◀ ● ▶ | Front left / Confirm / Front right |
| On-screen Back / Power | Esc / P |
| Keyboard ↑ ↓ ← → Enter Esc P | Same as simulator |
| Canvas edge taps | Optional page / OK zones; long-press ≈ Back |

**Settings tabs:** same as on device — focus the tab bar, then press **OK** (Confirm) to advance to the next category. The e-ink button hint shows the next tab name (not the fixed HTML label “OK”).

---

## What works vs what’s stubbed

### Intended to work

- CrossInk UI and navigation
- Local EPUB import (batch + drag-and-drop) into `/fs_/books/`
- Reading and on-device-style caches under `.crosspoint/`
- Progress and settings persisted in IndexedDB
- Library page (list / delete / storage estimate)
- Offline PWA shell (after first load)
- Full panel letterboxed so the 800×480 screen stays fully visible

### Intentionally disabled or stubbed

Things that only make sense on hardware or a LAN device:

- Wi‑Fi AP/station and the device file-transfer web server
- OTA / SD firmware update
- USB serial transfer
- Nearby device sync / OPDS downloads over the host network (no `curl` in the browser)

You may still see some of those menu entries; they do not provide a real network path in this build.

> **Status:** public browser port of CrossInk. Runtime is usable for local reading; polish continues. Issues and PRs welcome.

---

## How it works (architecture)

```
Browser (static host / GitHub Pages)
├── index.html + app.js + service worker   # shell: reader / library / help
├── crossink.js + crossink.wasm            # CrossInk + simulator HAL
│
├── SDL2  ──►  <canvas>                    # e-ink framebuffer (letterboxed)
├── keyboard / touch  ──►  HalGPIO         # same as desktop sim
└── IDBFS  ──►  /fs_                       # virtual SD card
        └── books/, .crosspoint/, settings
```

Build path mirrors CrossInk’s `[env:simulator]` PlatformIO target: same app sources, device HAL ignored, simulator HAL linked, then Emscripten instead of a native binary.

**Web-specific notes**

- Single-threaded FreeRTOS shim + **ASYNCIFY** (no pthreads / SharedArrayBuffer).
- Activity render runs on the browser main loop (cooperative “sync render”) so the UI can leave the boot splash.
- IDBFS is linked explicitly (`-lidbfs.js`).
- Small source patches are re-applied at build time (`scripts/patch_*.sh`), not committed into the submodules.

---

## Build from source

### Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`emcc` / `emcmake` on `PATH`)
- CMake ≥ 3.20, Ninja
- Python 3

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk/emsdk_env.sh
```

### Clone and build

```bash
git clone --recursive https://github.com/simoneloru/webink.git
cd webink

./scripts/build.sh
# → www/crossink.js + www/crossink.wasm

PORT=8765 ./scripts/serve.sh
# → http://localhost:8765/
```

`build.sh` will:

1. Init submodules  
2. Apply web shims (`scripts/patch_simulator.sh`, `scripts/patch_crossink_emscripten.sh`)  
3. Generate CrossInk i18n (and web assets when available)  
4. Configure and build with Emscripten  

Wasm outputs under `www/` are gitignored; CI builds them on each release tag.

### Repository layout

```
vendor/CrossInk/                 # CrossInk firmware (submodule)
vendor/crosspoint-simulator/     # SDL/host HAL (submodule)
wasm/                            # CMake + Emscripten entry & stubs
www/                             # PWA shell (no book server)
scripts/                         # build, serve, patch helpers
.github/workflows/deploy.yml     # Emscripten build → GitHub Pages
```

### Deploy (release tags only)

GitHub Actions deploys to Pages **only on version tags** (and optional manual `workflow_dispatch`).

```bash
# After changes on main:
git tag -a v0.2.0 -m "Release notes"
git push origin v0.2.0
```

| Trigger | What happens |
|---------|----------------|
| Tag `v*` | Full Wasm build → package → GitHub Pages |
| **workflow_dispatch** | Same (manual) |
| Push to `main` | **No deploy** |

Repo setting: **Pages → Source: GitHub Actions**.

Live site: **https://simoneloru.github.io/webink/**

---

## Tech stack

- **C++20** — CrossInk application code  
- **Emscripten** — Wasm, SDL2 port, filesystem, ASYNCIFY  
- **SDL2** (`-sUSE_SDL=2`) — display and input  
- **IDBFS** — persistent virtual SD card  
- **Service Worker + Web App Manifest** — offline shell / installability  

---

## Credits

- [CrossInk](https://github.com/uxjulia/CrossInk) by [uxjulia](https://github.com/uxjulia) — firmware this port runs  
- [CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader) — upstream e-reader project  
- [crosspoint-simulator](https://github.com/uxjulia/crosspoint-simulator) — SDL2 HAL this build reuses  

WebInk is an independent experiment to host that stack in the browser. It is not an official product of those projects unless they say so.

**WebInk packaging & browser shell:** Simone Loru \<simoneloru@gmail.com\>

---

## Contributing

Useful contributions:

- Runtime fixes (boot, FS mount, input, mobile browsers)
- Shrinking the Wasm binary / load time
- Clearer UX for “import book → open in file browser”
- Docs and demos

Please keep the privacy model: **no book upload servers** in the default architecture.

---

## License

**MIT** — see [LICENSE](LICENSE).

Upstream CrossInk and crosspoint-simulator remain under their own MIT licenses; keep their notices when redistributing those components.

---

## Sharing

Short description for posts:

> WebInk runs CrossInk (open-source Xteink e-reader firmware) entirely in the browser via WebAssembly. Same C++ app, SDL → canvas, books only on your device (IndexedDB). No cloud library.

```
https://github.com/simoneloru/webink
https://simoneloru.github.io/webink/
```
