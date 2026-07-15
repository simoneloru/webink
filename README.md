# WebInk

**CrossInk in your browser.** The same C++ e-reader firmware that runs on Xteink e-ink devices, compiled to WebAssembly and running fully client-side.

No new reader UI. No cloud library. No upload of your books to a server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why this exists

[CrossInk](https://github.com/uxjulia/CrossInk) is open-source firmware for the Xteink X3/X4 e-readers. It already has a desktop path via the [CrossPoint simulator](https://github.com/uxjulia/crosspoint-simulator) (SDL2 window, host filesystem as SD card).

**WebInk** takes that simulator stack and targets the web:

| Layer | What runs |
|--------|-----------|
| App | CrossInk (EPUB engine, UI, fonts, menus, progress) |
| HAL | crosspoint-simulator → SDL2 → HTML5 canvas |
| Storage | Emscripten virtual FS + **IDBFS** (IndexedDB) |
| Shell | Minimal PWA: load Wasm, import EPUB, offline install |

The goal is simple: **use CrossInk without a device**, on a laptop or phone, with your files staying on the device.

---

## Privacy

**Books never leave the browser.**

1. You pick a local `.epub` with the file picker.
2. The file is written into the Wasm virtual filesystem.
3. Persistence uses IndexedDB on **your** machine (via IDBFS).

There is no backend, no book API, and no analytics in this project. GitHub Pages (or any static host) only serves HTML, JS, and Wasm.

---

## Try it

Once deployed (GitHub Pages after CI succeeds):

**https://simoneloru.github.io/webink/**

*(Enable **Settings → Pages → Source: GitHub Actions** on the repo if the site is not live yet.)*

### Quick use

1. Open the site (Chrome/Firefox recommended; isolation headers are required for the pthread build).
2. Click **Open EPUB** and choose a book from your disk.
3. Use the CrossInk UI as on device / desktop simulator.
4. Click **Save library** (or leave the page — we also flush on hide) so progress and files stay in IndexedDB.
5. Optional: **Install** as a PWA for a standalone window and offline shell.

### Controls

Same mapping as the CrossPoint desktop simulator:

| Input | Action |
|--------|--------|
| ↑ / ↓ | Side buttons (page back / forward) |
| ← / → | Front buttons |
| Enter | Confirm / select |
| Esc | Back |
| P | Power |
| S | Sleep (simulator) |

On touch devices, canvas zones map to the same keys (left/right thirds, top/bottom strips; long-press center ≈ Back).

---

## What works vs what’s stubbed

### Intended to work

- CrossInk UI and navigation
- Local EPUB import into virtual SD (`/fs_/books/`)
- Reading and on-device-style caches under `.crosspoint/`
- Progress and settings persisted in IndexedDB
- Offline PWA shell (after first load)

### Intentionally disabled or stubbed

Things that only make sense on hardware or a LAN device:

- Wi‑Fi AP/station and the device file-transfer web server
- OTA / SD firmware update
- USB serial transfer
- Nearby device sync / OPDS downloads over the host network (no `curl` in the browser)

You may still see some of those menu entries; they do not provide a real network path in this build.

> **Status:** early public port. The project **compiles and links** CrossInk to Wasm; runtime polish and edge cases are ongoing. Issues and PRs welcome.

---

## How it works (architecture)

```
Browser (static host / GitHub Pages)
├── index.html + app.js + service worker   # thin shell only
├── crossink.js + crossink.wasm            # CrossInk + simulator HAL
│
├── SDL2  ──►  <canvas>                    # e-ink framebuffer
├── keyboard / touch  ──►  HalGPIO         # same as desktop sim
└── IDBFS  ──►  /fs_                       # virtual SD card
        └── books/, .crosspoint/, settings
```

Build path mirrors CrossInk’s `[env:simulator]` PlatformIO target: same app sources, device HAL ignored, simulator HAL linked, then Emscripten instead of a native binary.

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

./scripts/serve.sh
# → http://localhost:8080/  (serves with COOP/COEP for SharedArrayBuffer)
```

`build.sh` will:

1. Init submodules  
2. Apply small simulator API shims (`scripts/patch_simulator.sh`)  
3. Generate CrossInk i18n (and web assets when available)  
4. Configure and build with Emscripten  

### Repository layout

```
vendor/CrossInk/                 # CrossInk firmware (submodule)
vendor/crosspoint-simulator/     # SDL/host HAL (submodule)
wasm/                            # CMake + Emscripten entry & stubs
www/                             # PWA shell (no book server)
scripts/                         # build, serve, patch helpers
.github/workflows/deploy.yml     # Emscripten build → GitHub Pages
```

### Deploy

Push to `main`. The workflow builds with Emscripten and deploys the static site.

Repo setting: **Pages → Source: GitHub Actions**.

---

## Tech stack

- **C++20** — CrossInk application code  
- **Emscripten** — Wasm, SDL2 port, filesystem, pthreads  
- **SDL2** (`-sUSE_SDL=2`) — display and input  
- **IDBFS** — persistent virtual SD card  
- **Service Worker + Web App Manifest** — offline shell / installability  

---

## Credits

- [CrossInk](https://github.com/uxjulia/CrossInk) by [uxjulia](https://github.com/uxjulia) — firmware this port runs  
- [CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader) — upstream e-reader project  
- [crosspoint-simulator](https://github.com/uxjulia/crosspoint-simulator) — SDL2 HAL this build reuses  

WebInk is an independent experiment to host that stack in the browser. It is not an official product of those projects unless they say so.

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
```
