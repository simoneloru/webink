/**
 * WebInk shell — single-threaded Wasm (no SharedArrayBuffer).
 * Pages: #reader | #library | #help
 */

const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const canvas = document.getElementById('canvas');
const canvasWrap = document.getElementById('canvas-wrap');
const epubInput = document.getElementById('epub');
const epubLibInput = document.getElementById('epub-lib');
const addBookBtn = document.getElementById('add-book-btn');
const libAddBtn = document.getElementById('lib-add-btn');
const installBtn = document.getElementById('install');
const navLibrary = document.getElementById('nav-library');
const navHelp = document.getElementById('nav-help');
const navReader = document.getElementById('nav-reader');
const viewReader = document.getElementById('view-reader');
const viewLibrary = document.getElementById('view-library');
const viewHelp = document.getElementById('view-help');
const libList = document.getElementById('lib-list');
const libEmpty = document.getElementById('lib-empty');
const libCount = document.getElementById('lib-count');
const libSize = document.getElementById('lib-size');
const libQuota = document.getElementById('lib-quota');
const libQuotaBar = document.getElementById('lib-quota-bar');
const libRefresh = document.getElementById('lib-refresh');
const libSave = document.getElementById('lib-save');
const libBack = document.getElementById('lib-back');
const helpToLibrary = document.getElementById('help-to-library');
const helpToReader = document.getElementById('help-to-reader');

/** @type {any} */
let Module = null;
let libraryBusy = false;
/** @type {'reader'|'library'|'help'} */
let currentPage = 'reader';

const PAGES = ['reader', 'library', 'help'];
const PAGE_TITLES = {
  reader: 'CrossInk (Web)',
  library: 'Library · CrossInk (Web)',
  help: 'Help · CrossInk (Web)',
};

const PANEL_W = 800;
const PANEL_H = 480;
const BOOKS_DIR = '/fs_/books';

// ---------------------------------------------------------------------------
// Layout: fit e-ink panel
// ---------------------------------------------------------------------------

function fitDeviceScreen() {
  if (!canvas || !canvasWrap) return;
  if (currentPage !== 'reader') return;
  const availW = canvasWrap.clientWidth;
  const availH = canvasWrap.clientHeight;
  if (availW < 2 || availH < 2) return;

  const scale = Math.min(availW / PANEL_W, availH / PANEL_H);
  const w = Math.max(1, Math.floor(PANEL_W * scale));
  const h = Math.max(1, Math.floor(PANEL_H * scale));

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.setProperty('--fit-w', `${w}px`);
  canvas.style.setProperty('--fit-h', `${h}px`);
}

function installFitObserver() {
  fitDeviceScreen();
  if (typeof ResizeObserver !== 'undefined' && canvasWrap) {
    const ro = new ResizeObserver(() => fitDeviceScreen());
    ro.observe(canvasWrap);
  }
  window.addEventListener('resize', fitDeviceScreen);
  window.addEventListener('orientationchange', () => {
    setTimeout(fitDeviceScreen, 50);
    setTimeout(fitDeviceScreen, 250);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fitDeviceScreen();
  });
}

// ---------------------------------------------------------------------------
// Status / busy
// ---------------------------------------------------------------------------

/**
 * @param {string} msg
 * @param {'idle'|'ok'|'err'|'busy'} [kind]
 */
function setStatus(msg, kind = 'idle') {
  statusEl.textContent = msg;
  statusEl.classList.remove('is-ok', 'is-err', 'is-busy');
  if (kind === 'ok') statusEl.classList.add('is-ok');
  else if (kind === 'err') statusEl.classList.add('is-err');
  else if (kind === 'busy') statusEl.classList.add('is-busy');
}

function setLibraryBusy(busy) {
  libraryBusy = busy;
  for (const el of [epubInput, epubLibInput, libSave, libRefresh]) {
    if (el) el.disabled = busy;
  }
  if (addBookBtn) addBookBtn.classList.toggle('is-disabled', busy);
  if (libAddBtn) libAddBtn.classList.toggle('is-disabled', busy);
}

function setOverlay(msg) {
  if (msg == null) {
    overlay.classList.add('hidden');
    return;
  }
  overlayMsg.textContent = msg;
  overlay.classList.remove('hidden');
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isEpubFile(file) {
  if (!file || !file.name) return false;
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return true;
  const t = (file.type || '').toLowerCase();
  return t === 'application/epub+zip' || t === 'application/epub';
}

// ---------------------------------------------------------------------------
// Routing: reader | library | help
// ---------------------------------------------------------------------------

function pageFromHash() {
  const h = (location.hash || '').replace(/^#/, '').toLowerCase();
  if (h === 'library' || h === 'help') return h;
  return 'reader';
}

function applyPage(page) {
  currentPage = PAGES.includes(page) ? page : 'reader';

  const views = {
    reader: viewReader,
    library: viewLibrary,
    help: viewHelp,
  };
  for (const [name, el] of Object.entries(views)) {
    if (!el) continue;
    const on = name === currentPage;
    el.classList.toggle('is-active', on);
    el.hidden = !on;
  }

  document.body.classList.toggle('page-reader', currentPage === 'reader');
  document.body.classList.toggle('page-library', currentPage === 'library');
  document.body.classList.toggle('page-help', currentPage === 'help');

  // Bar: show "Reader" when away from the device; keep Library/Help always reachable.
  if (navReader) navReader.hidden = currentPage === 'reader';
  if (navLibrary) navLibrary.classList.toggle('is-active', currentPage === 'library');
  if (navHelp) navHelp.classList.toggle('is-active', currentPage === 'help');

  document.title = PAGE_TITLES[currentPage] || PAGE_TITLES.reader;

  if (currentPage === 'library' && Module) {
    refreshLibraryPage().catch((e) => console.error(e));
  }
  if (currentPage === 'reader') {
    requestAnimationFrame(fitDeviceScreen);
    setTimeout(fitDeviceScreen, 50);
  }
}

/** Navigate; hash is source of truth (#library | #help | empty reader). */
function goToPage(page) {
  const target = PAGES.includes(page) ? page : 'reader';
  if (target === 'reader') {
    if (location.hash) {
      history.pushState(null, '', location.pathname + location.search);
    }
    applyPage('reader');
    return;
  }
  const want = `#${target}`;
  if (location.hash !== want) location.hash = target;
  else applyPage(target);
}

function installRouting() {
  window.addEventListener('hashchange', () => applyPage(pageFromHash()));
  window.addEventListener('popstate', () => applyPage(pageFromHash()));
  navLibrary?.addEventListener('click', () => goToPage('library'));
  navHelp?.addEventListener('click', () => goToPage('help'));
  navReader?.addEventListener('click', () => goToPage('reader'));
  libBack?.addEventListener('click', () => goToPage('reader'));
  helpToLibrary?.addEventListener('click', () => goToPage('library'));
  helpToReader?.addEventListener('click', () => goToPage('reader'));
  applyPage(pageFromHash());
}

// ---------------------------------------------------------------------------
// Virtual FS
// ---------------------------------------------------------------------------

function syncfs(mod, populate) {
  return new Promise((resolve, reject) => {
    mod.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
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

async function mountVirtualSd(mod) {
  const { FS } = mod;
  ensureDir(FS, '/fs_');

  const idbfs = FS.filesystems && FS.filesystems.IDBFS;
  if (idbfs) {
    try {
      FS.mount(idbfs, {}, '/fs_');
      await syncfs(mod, true);
    } catch (e) {
      console.warn('[webink] IDBFS mount failed, using session MEMFS:', e);
    }
  } else {
    console.warn('[webink] IDBFS not in Wasm build — library is session-only (MEMFS)');
  }

  ensureDir(FS, BOOKS_DIR);
  ensureDir(FS, '/fs_/.crosspoint');
  ensureDir(FS, '/fs_/.fonts');
  ensureDir(FS, '/fs_/fonts');
}

function sanitizeName(name) {
  return name.replace(/[^\w.\- ()[\]]+/g, '_');
}

function uniqueBookName(FS, baseName) {
  let name = sanitizeName(baseName.endsWith('.epub') ? baseName : `${baseName}.epub`);
  const exists = (n) => {
    try {
      FS.stat(`${BOOKS_DIR}/${n}`);
      return true;
    } catch {
      return false;
    }
  };
  if (!exists(name)) return name;
  const m = name.match(/^(.*?)(\.epub)$/i);
  const stem = m ? m[1] : name;
  const ext = m ? m[2] : '.epub';
  for (let i = 2; i < 200; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

async function importEpub(mod, file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = uniqueBookName(mod.FS, file.name);
  const path = `${BOOKS_DIR}/${name}`;
  ensureDir(mod.FS, BOOKS_DIR);
  mod.FS.writeFile(path, buf);
  return { path, name, bytes: buf.byteLength };
}

async function importEpubFiles(mod, files) {
  const list = Array.from(files || []).filter(isEpubFile);
  if (!list.length) throw new Error('No EPUB files selected');

  setLibraryBusy(true);
  let ok = 0;
  let failed = 0;
  let lastName;
  let totalBytes = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setStatus(
        list.length === 1
          ? `Adding ${file.name}…`
          : `Adding ${i + 1}/${list.length}: ${file.name}…`,
        'busy',
      );
      try {
        const r = await importEpub(mod, file);
        ok++;
        lastName = r.name;
        totalBytes += r.bytes;
      } catch (e) {
        console.error(e);
        failed++;
      }
    }
    setStatus('Saving library to this browser…', 'busy');
    await syncfs(mod, false);
  } finally {
    setLibraryBusy(false);
  }
  return { ok, failed, lastName, totalBytes };
}

function describeImportResult({ ok, failed, lastName, totalBytes }) {
  if (ok === 0) {
    return { msg: failed ? 'Could not add books' : 'No books added', kind: 'err' };
  }
  const size = formatBytes(totalBytes);
  if (ok === 1 && !failed) {
    return {
      msg: `Added “${lastName}” (${size}) · Library to manage`,
      kind: 'ok',
    };
  }
  if (failed) {
    return {
      msg: `Added ${ok}, ${failed} failed (${size})`,
      kind: 'err',
    };
  }
  return { msg: `Added ${ok} books (${size})`, kind: 'ok' };
}

/** List EPUB (and other book files) under /fs_/books */
function listBooks(mod) {
  const FS = mod.FS;
  const books = [];
  let names = [];
  try {
    names = FS.readdir(BOOKS_DIR);
  } catch {
    return books;
  }
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const path = `${BOOKS_DIR}/${name}`;
    try {
      const st = FS.stat(path);
      if (FS.isDir(st.mode)) continue;
      books.push({
        name,
        path,
        bytes: st.size || 0,
        mtime: st.mtime ? new Date(st.mtime).getTime() : 0,
      });
    } catch {
      /* skip */
    }
  }
  books.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return books;
}

async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) {
      return await navigator.storage.estimate();
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function refreshLibraryPage() {
  if (!Module || !libList) return;
  const books = listBooks(Module);
  const totalBytes = books.reduce((s, b) => s + b.bytes, 0);

  if (libCount) libCount.textContent = String(books.length);
  if (libSize) libSize.textContent = formatBytes(totalBytes);

  const est = await storageEstimate();
  if (libQuota && libQuotaBar) {
    if (est && est.quota) {
      const used = est.usage || 0;
      const pct = Math.min(100, Math.round((used / est.quota) * 1000) / 10);
      libQuota.textContent = `${formatBytes(used)} / ${formatBytes(est.quota)}`;
      libQuotaBar.style.width = `${pct}%`;
    } else {
      libQuota.textContent = 'Unavailable';
      libQuotaBar.style.width = '0%';
    }
  }

  libList.replaceChildren();
  if (books.length === 0) {
    if (libEmpty) libEmpty.hidden = false;
    return;
  }
  if (libEmpty) libEmpty.hidden = true;

  for (const book of books) {
    const li = document.createElement('li');
    li.className = 'lib-item';
    li.dataset.path = book.path;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = book.name;
    nameEl.title = book.name;
    const sizeHint = document.createElement('span');
    sizeHint.className = 'size';
    sizeHint.textContent = 'in /books';
    meta.append(nameEl, sizeHint);

    const sizeNum = document.createElement('span');
    sizeNum.className = 'size-num';
    sizeNum.textContent = formatBytes(book.bytes);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = 'Delete';
    del.title = `Delete ${book.name}`;
    del.addEventListener('click', () => deleteBook(book));

    li.append(meta, sizeNum, del);
    libList.append(li);
  }
}

async function deleteBook(book) {
  if (!Module || libraryBusy) return;
  const ok = window.confirm(`Delete “${book.name}” from this browser’s library?`);
  if (!ok) return;

  setLibraryBusy(true);
  setStatus(`Deleting ${book.name}…`, 'busy');
  try {
    Module.FS.unlink(book.path);
    await syncfs(Module, false);
    setStatus(`Deleted “${book.name}”`, 'ok');
    await refreshLibraryPage();
  } catch (e) {
    console.error(e);
    setStatus(`Delete failed: ${e.message || e}`, 'err');
  } finally {
    setLibraryBusy(false);
  }
}

async function handleImportFiles(files) {
  if (!Module || libraryBusy) return;
  try {
    const result = await importEpubFiles(Module, files);
    const { msg, kind } = describeImportResult(result);
    setStatus(msg, kind);
    if (currentPage === 'library') await refreshLibraryPage();
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Import failed', 'err');
  }
}

function installLibraryUi(mod) {
  Module = mod;

  const onPick = async (input) => {
    if (libraryBusy) return;
    const files = input.files;
    if (!files?.length) return;
    try {
      await handleImportFiles(files);
    } finally {
      input.value = '';
    }
  };

  epubInput?.addEventListener('change', () => onPick(epubInput));
  epubLibInput?.addEventListener('change', () => onPick(epubLibInput));

  libRefresh?.addEventListener('click', async () => {
    if (libraryBusy) return;
    setStatus('Refreshing…', 'busy');
    try {
      await refreshLibraryPage();
      setStatus('Library updated', 'ok');
    } catch (e) {
      setStatus(`Refresh failed: ${e.message || e}`, 'err');
    }
  });

  // Optional manual flush (auto-runs after add/delete and on tab hide).
  libSave?.addEventListener('click', async () => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    setStatus('Flushing browser storage…', 'busy');
    try {
      await syncfs(Module, false);
      setStatus('Browser storage up to date', 'ok');
      await refreshLibraryPage();
    } catch (e) {
      console.error(e);
      setStatus(`Flush failed: ${e.message || e}`, 'err');
    } finally {
      setLibraryBusy(false);
    }
  });

  // Drag-and-drop on either page
  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('is-dragover');
  };
  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('is-dragover');
  };
  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragover');
    if (libraryBusy) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    await handleImportFiles(files);
  };
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  window.addEventListener('pagehide', () => {
    try {
      Module.FS.syncfs(false, () => {});
    } catch {
      /* ignore */
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    try {
      Module.FS.syncfs(false, () => {});
    } catch {
      /* ignore */
    }
  });
}

// ---------------------------------------------------------------------------
// Device input
// ---------------------------------------------------------------------------

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
  window.dispatchEvent(new KeyboardEvent(type, init));
  document.dispatchEvent(new KeyboardEvent(type, init));
  if (document.activeElement !== canvas) {
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      canvas.focus();
    }
  }
}

function installHardwareButtons() {
  const buttons = document.querySelectorAll('.hw-btn[data-key]');
  const press = (btn) => {
    btn.classList.add('is-down');
    btn._key = {
      key: btn.dataset.key,
      code: btn.dataset.code || btn.dataset.key,
      keyCode: Number(btn.dataset.keyCode || 0),
    };
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
      if (btn.classList.contains('is-down') && e.buttons === 0) release(btn);
    });
    btn.addEventListener('click', (e) => e.preventDefault());
  }
  window.addEventListener('blur', () => {
    for (const btn of buttons) release(btn);
  });
}

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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  installRouting();
  installHardwareButtons();
  installFitObserver();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {});
  }

  setOverlay('Downloading CrossInk…');
  setStatus('Downloading…', 'busy');

  let createCrossInkModule;
  try {
    const mod = await import('./crossink.js');
    createCrossInkModule = mod.default ?? mod.createCrossInkModule;
  } catch (e) {
    console.error(e);
    setOverlay('crossink.js missing. Wait for deploy or build locally.');
    setStatus('Build missing', 'err');
    return;
  }

  try {
    Module = await createCrossInkModule({
      canvas,
      locateFile: (path) => new URL(path, import.meta.url).href,
      print: (...a) => console.log('[crossink]', ...a),
      printErr: (...a) => {
        const msg = a.join(' ');
        if (msg.includes('still waiting on run dependencies')) return;
        console.error('[crossink]', ...a);
      },
      preRun: [
        (m) => {
          m.ENV.CROSSPOINT_SIM_SD = '/fs_';
        },
      ],
    });
  } catch (e) {
    console.error(e);
    setOverlay(`Wasm init failed: ${e.message || e}`);
    setStatus('Wasm failed', 'err');
    return;
  }

  window.Module = Module;
  fitDeviceScreen();
  requestAnimationFrame(fitDeviceScreen);

  setOverlay('Restoring library…');
  setStatus('Restoring library…', 'busy');
  try {
    await mountVirtualSd(Module);
  } catch (e) {
    console.error(e);
    setStatus(`FS: ${e.message || e}`, 'err');
  }

  setOverlay(null);
  setStatus('Starting…', 'busy');
  canvas.focus({ preventScroll: true });
  fitDeviceScreen();

  try {
    if (typeof Module.callMain === 'function') Module.callMain([]);
    else if (typeof Module._main === 'function') Module._main();
    setStatus('Running');
    requestAnimationFrame(fitDeviceScreen);
    setTimeout(fitDeviceScreen, 100);
    setTimeout(fitDeviceScreen, 500);
  } catch (e) {
    console.error(e);
    setStatus(`Start failed: ${e.message || e}`, 'err');
    setOverlay(`CrossInk failed: ${e.message || e}`);
  }

  installLibraryUi(Module);
  installTouchZones();

  // Re-apply route after Module is ready (library needs FS).
  applyPage(pageFromHash());
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

boot();
