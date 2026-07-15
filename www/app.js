/**
 * WebInk shell — mounts CrossInk Wasm, virtual SD (IDBFS), local EPUB import,
 * and X4-like on-screen controls that inject the same keys as the desktop sim.
 */

const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const canvas = document.getElementById('canvas');
const epubInput = document.getElementById('epub');
const syncBtn = document.getElementById('sync');
const installBtn = document.getElementById('install');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setOverlay(msg) {
  if (msg == null) {
    overlay.classList.add('hidden');
    return;
  }
  overlayMsg.textContent = msg;
  overlay.classList.remove('hidden');
}

function syncfs(Module, populate) {
  return new Promise((resolve, reject) => {
    Module.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
  });
}

function ensureDir(FS, path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += `/${p}`;
    try {
      FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

async function mountVirtualSd(Module) {
  const { FS } = Module;
  ensureDir(FS, '/fs_');
  ensureDir(FS, '/fs_/books');
  ensureDir(FS, '/fs_/.crosspoint');
  FS.mount(FS.filesystems.IDBFS, {}, '/fs_');
  await syncfs(Module, true);
}

function sanitizeName(name) {
  return name.replace(/[^\w.\- ()[\]]+/g, '_');
}

async function importEpub(Module, file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = sanitizeName(file.name.endsWith('.epub') ? file.name : `${file.name}.epub`);
  const path = `/fs_/books/${name}`;
  ensureDir(Module.FS, '/fs_/books');
  Module.FS.writeFile(path, buf);
  await syncfs(Module, false);
  return { path, name, bytes: buf.byteLength };
}

/**
 * Fire a key event Emscripten/SDL is likely to accept.
 * Synthetic events are not "trusted", but SDL's browser backend still maps them
 * when key/code/keyCode are set and the event hits window.
 */
function fireKey(type, { key, code, keyCode }) {
  const init = {
    key,
    code,
    keyCode,
    which: keyCode,
    charCode: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  };
  const ev = new KeyboardEvent(type, init);
  // Some engines ignore non-trusted events on canvas only; hit window + document.
  window.dispatchEvent(ev);
  document.dispatchEvent(new KeyboardEvent(type, init));
  if (document.activeElement !== canvas) {
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      canvas.focus();
    }
  }
}

/** Hardware chrome: press/hold like physical buttons. */
function installHardwareButtons() {
  const buttons = document.querySelectorAll('.hw-btn[data-key]');

  const press = (btn) => {
    const key = btn.dataset.key;
    const code = btn.dataset.code || key;
    const keyCode = Number(btn.dataset.keyCode || 0);
    btn.classList.add('is-down');
    btn._key = { key, code, keyCode };
    fireKey('keydown', btn._key);
  };

  const release = (btn) => {
    if (!btn._key) return;
    fireKey('keyup', btn._key);
    btn._key = null;
    btn.classList.remove('is-down');
  };

  for (const btn of buttons) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      press(btn);
    });
    btn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      release(btn);
    });
    btn.addEventListener('pointercancel', () => release(btn));
    btn.addEventListener('pointerleave', (e) => {
      // Only release if we lost capture / left while held
      if (btn.classList.contains('is-down') && e.buttons === 0) release(btn);
    });
    // Avoid double-firing from synthetic click after pointer
    btn.addEventListener('click', (e) => e.preventDefault());
  }

  // Release all if window blurs
  window.addEventListener('blur', () => {
    for (const btn of buttons) release(btn);
  });
}

/** Optional canvas edge zones (secondary to chrome buttons). */
function installTouchZones() {
  const mapKey = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (y < 0.15) return { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 };
    if (y > 0.85) return { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 };
    if (x < 0.28) return { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 };
    if (x > 0.72) return { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 };
    return { key: 'Enter', code: 'Enter', keyCode: 13 };
  };

  let longTimer = null;
  let lastKey = null;

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const k = mapKey(e.clientX, e.clientY);
    lastKey = k;
    fireKey('keydown', k);
    longTimer = setTimeout(() => {
      fireKey('keyup', k);
      fireKey('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 });
      fireKey('keyup', { key: 'Escape', code: 'Escape', keyCode: 27 });
      lastKey = null;
    }, 700);
  });

  const end = (e) => {
    e.preventDefault();
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
    if (lastKey) {
      fireKey('keyup', lastKey);
      lastKey = null;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

async function boot() {
  setOverlay('Downloading CrossInk…');
  setStatus('Downloading…');

  installHardwareButtons();

  let createCrossInkModule;
  try {
    const mod = await import('./crossink.js');
    createCrossInkModule = mod.default ?? mod.createCrossInkModule;
  } catch (e) {
    console.error(e);
    setOverlay(
      'crossink.js not found. Build first: ./scripts/build.sh (or wait for CI).'
    );
    setStatus('Build missing');
    return;
  }

  const Module = await createCrossInkModule({
    canvas,
    locateFile: (path) => new URL(path, import.meta.url).href,
    print: (...a) => console.log('[crossink]', ...a),
    printErr: (...a) => console.error('[crossink]', ...a),
    preRun: [
      (mod) => {
        mod.ENV.CROSSPOINT_SIM_SD = '/fs_';
      },
    ],
  });

  window.Module = Module;

  setOverlay('Restoring library (IndexedDB)…');
  setStatus('Restoring library…');
  try {
    await mountVirtualSd(Module);
  } catch (e) {
    console.error(e);
    setStatus(`FS mount failed: ${e.message || e}`);
  }

  setOverlay(null);
  setStatus('Starting CrossInk…');
  canvas.focus({ preventScroll: true });

  try {
    if (typeof Module.callMain === 'function') {
      Module.callMain([]);
    } else if (typeof Module._main === 'function') {
      Module._main();
    }
    setStatus('Running');
  } catch (e) {
    console.error(e);
    setStatus(`Start failed: ${e.message || e}`);
    setOverlay(`CrossInk failed to start: ${e.message || e}`);
  }

  epubInput.addEventListener('change', async () => {
    const file = epubInput.files?.[0];
    if (!file) return;
    try {
      setStatus('Importing…');
      const { name, bytes } = await importEpub(Module, file);
      setStatus(`Saved ${name} (${(bytes / 1e6).toFixed(2)} MB) — open via file browser`);
    } catch (e) {
      console.error(e);
      setStatus(`Import failed: ${e.message || e}`);
    } finally {
      epubInput.value = '';
    }
  });

  syncBtn.addEventListener('click', async () => {
    try {
      await syncfs(Module, false);
      setStatus('Library saved');
    } catch (e) {
      setStatus(`Save failed: ${e.message || e}`);
    }
  });

  window.addEventListener('pagehide', () => {
    try {
      Module.FS.syncfs(false, () => {});
    } catch {
      /* ignore */
    }
  });

  installTouchZones();
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(console.error);
}

boot();
