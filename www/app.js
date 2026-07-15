/**
 * WebInk shell - single-threaded Wasm (no SharedArrayBuffer).
 * Pages: #reader | #library | #help
 */

/** Bump when shell logic changes. */
const WEBINK_SHELL = 25;
console.info(
  `%c[webink] shell v${WEBINK_SHELL}`,
  'color:#9dcea0;font-weight:700;font-size:12px',
);

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

/**
 * Physical e-ink panel buffer is 800x480, but CrossInk's *logical* window
 * depends on Settings -> Orientation:
 *   Portrait (default)  -> SDL window 480x800  (3:5, tall)
 *   Landscape           -> SDL window 800x480  (5:3, wide)
 *
 * The shell MUST match that window aspect. Forcing 800x480 while firmware is
 * in Portrait was stretching the canvas into a "fake 16:9" strip.
 */
const PANEL_NATIVE_W = 800;
const PANEL_NATIVE_H = 480;
/** CrossInk default orientation is Portrait -> logical 480x800 */
const DEFAULT_LOGIC_W = PANEL_NATIVE_H; // 480
const DEFAULT_LOGIC_H = PANEL_NATIVE_W; // 800
const BOOKS_DIR = '/fs_/books';

const stageEl = document.getElementById('stage');
const frontBarEl = document.getElementById('front-bar');

// ---------------------------------------------------------------------------
// Layout - match SDL logical window aspect, scale uniformly to fill stage
// ---------------------------------------------------------------------------

function cssPx(varName, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Logical window size from the live canvas (SDL), falling back to Portrait default.
 * Uses the ratio of canvas.width/height (HiDPI-safe).
 */
function getLogicalDisplaySize() {
  const bw = canvas?.width || 0;
  const bh = canvas?.height || 0;
  if (bw >= 16 && bh >= 16) {
    // Normalize to the nearer native pair (480x800 or 800x480) for clean integers.
    const aspect = bw / bh;
    if (aspect < 1) {
      // Portrait-ish
      return { logicW: DEFAULT_LOGIC_W, logicH: DEFAULT_LOGIC_H, aspect };
    }
    return { logicW: PANEL_NATIVE_W, logicH: PANEL_NATIVE_H, aspect };
  }
  return {
    logicW: DEFAULT_LOGIC_W,
    logicH: DEFAULT_LOGIC_H,
    aspect: DEFAULT_LOGIC_W / DEFAULT_LOGIC_H,
  };
}

/** Largest box with given aspect (w/h) inside maxWxmaxH. */
function fitAspect(maxW, maxH, aspect) {
  maxW = Math.max(1, Math.floor(maxW));
  maxH = Math.max(1, Math.floor(maxH));
  let w;
  let h;
  if (maxW / maxH > aspect) {
    h = maxH;
    w = Math.max(1, Math.floor(h * aspect));
  } else {
    w = maxW;
    h = Math.max(1, Math.floor(w / aspect));
  }
  if (w > maxW) {
    w = maxW;
    h = Math.max(1, Math.floor(w / aspect));
  }
  if (h > maxH) {
    h = maxH;
    w = Math.max(1, Math.floor(h * aspect));
  }
  return { w, h };
}

function getViewportBudget() {
  const header = document.querySelector('header');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const vv = window.visualViewport;
  const vw = Math.max(
    1,
    Math.floor(vv?.width || document.documentElement.clientWidth || window.innerWidth),
  );
  const vh = Math.max(
    1,
    Math.floor(vv?.height || document.documentElement.clientHeight || window.innerHeight),
  );

  const bodyStyle = getComputedStyle(document.body);
  const padX =
    (parseFloat(bodyStyle.paddingLeft) || 0) + (parseFloat(bodyStyle.paddingRight) || 0);
  const padY =
    (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);

  return {
    freeW: Math.max(1, Math.floor(vw - padX)),
    freeH: Math.max(1, Math.floor(vh - padY - headerH)),
  };
}

function fitDeviceScreen() {
  if (!canvas || !canvasWrap || !stageEl) return;
  if (currentPage !== 'reader') return;

  const { freeW, freeH } = getViewportBudget();
  if (freeW < 32 || freeH < 32) return;

  stageEl.style.width = '100%';
  stageEl.style.height = `${freeH}px`;
  stageEl.style.minHeight = `${freeH}px`;
  if (viewReader) viewReader.style.minHeight = `${freeH}px`;

  const sideW = cssPx('--side-w', 30);
  const frontH = cssPx('--front-h', 40);
  const gap = cssPx('--gap', 3);
  const pad = gap;

  const stageStyle = getComputedStyle(stageEl);
  const stageGap = parseFloat(stageStyle.rowGap || stageStyle.gap) || gap;
  const stagePadX =
    (parseFloat(stageStyle.paddingLeft) || 0) + (parseFloat(stageStyle.paddingRight) || 0);
  const stagePadY =
    (parseFloat(stageStyle.paddingTop) || 0) + (parseFloat(stageStyle.paddingBottom) || 0);

  const hintEl = stageEl.querySelector('.hint');
  let hintReserve = 0;
  if (hintEl && getComputedStyle(hintEl).display !== 'none') {
    hintReserve = Math.max(hintEl.offsetHeight, 14) + stageGap;
  }

  const innerW = Math.max(1, freeW - stagePadX);
  const innerH = Math.max(1, freeH - stagePadY - hintReserve);

  const chromeW = pad * 2 + sideW * 2 + gap * 2;
  const chromeH = pad * 2;
  const maxScreenW = Math.max(1, innerW - chromeW);
  const maxScreenH = Math.max(1, innerH - chromeH - gap - frontH);

  const { logicW, logicH, aspect } = getLogicalDisplaySize();
  const { w: screenW, h: screenH } = fitAspect(maxScreenW, maxScreenH, aspect);
  const deviceOuterW = chromeW + screenW;

  const root = document.documentElement;
  root.style.setProperty('--screen-w', `${screenW}px`);
  root.style.setProperty('--screen-h', `${screenH}px`);
  root.style.setProperty('--front-bar-w', `${deviceOuterW}px`);

  // Aperture matches firmware logical window (portrait or landscape).
  canvasWrap.style.setProperty('width', `${screenW}px`, 'important');
  canvasWrap.style.setProperty('height', `${screenH}px`, 'important');
  canvasWrap.style.removeProperty('min-width');
  canvasWrap.style.removeProperty('min-height');
  canvasWrap.style.removeProperty('max-width');
  canvasWrap.style.removeProperty('max-height');
  canvasWrap.style.removeProperty('aspect-ratio');

  if (frontBarEl) frontBarEl.style.width = `${deviceOuterW}px`;

  stageEl.classList.remove('is-screen-portrait', 'is-portrait-rotate');
  document.body.classList.remove('screen-portrait', 'shell-portrait-rotate');
  stageEl.classList.toggle('is-logic-portrait', logicH > logicW);
  document.body.classList.toggle('logic-portrait', logicH > logicW);

  // Fill aperture exactly - no CSS rotate; SDL already draws the right orientation.
  canvas.style.setProperty('width', `${screenW}px`, 'important');
  canvas.style.setProperty('height', `${screenH}px`, 'important');
  canvas.style.setProperty('max-width', 'none', 'important');
  canvas.style.setProperty('max-height', 'none', 'important');
  canvas.style.setProperty('transform', 'none', 'important');

  canvas.dataset.screenW = String(screenW);
  canvas.dataset.screenH = String(screenH);
  canvas.dataset.logicW = String(logicW);
  canvas.dataset.logicH = String(logicH);
  canvas.dataset.aspect = aspect.toFixed(3);
  canvas.dataset.buffer = `${canvas.width}x${canvas.height}`;
}

function installFitObserver() {
  let fitScheduled = false;
  const run = () => {
    if (fitScheduled) return;
    fitScheduled = true;
    requestAnimationFrame(() => {
      fitScheduled = false;
      fitDeviceScreen();
    });
  };
  const runAfterRotate = () => {
    run();
    setTimeout(run, 50);
    setTimeout(run, 250);
    setTimeout(run, 600);
  };

  run();
  if (typeof ResizeObserver !== 'undefined') {
    if (stageEl) new ResizeObserver(run).observe(stageEl);
    // SDL may change canvas buffer size when orientation changes in firmware.
    if (canvas) {
      new ResizeObserver(run).observe(canvas);
    }
  }
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', runAfterRotate);
  if (screen.orientation?.addEventListener) {
    screen.orientation.addEventListener('change', runAfterRotate);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', run);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runAfterRotate();
  });

  if (canvas && typeof MutationObserver !== 'undefined') {
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled || currentPage !== 'reader') return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fitDeviceScreen();
      });
    }).observe(canvas, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height'],
    });
  }
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
  if (!Number.isFinite(n) || n < 0) return '-';
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

/**
 * Ensure a JSON state file is present and parseable.
 * Rewrites missing, empty, whitespace-only, or clearly invalid files.
 * (IDBFS often restores a 0-byte recent.json from a previous failed save.)
 */
function ensureValidJsonFile(FS, path, contents) {
  let ok = false;
  try {
    const raw = FS.readFile(path, { encoding: 'utf8' });
    const t = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (t.length > 0 && t.startsWith('{')) {
      // Prefer files that look like our store shape; rewrite bare {} if needed.
      ok = t.includes('"books"') || path.indexOf('recent.json') < 0;
    }
  } catch {
    ok = false;
  }
  if (ok) return false;
  try {
    ensureDir(FS, path.replace(/\/[^/]+$/, '') || '/');
    FS.writeFile(path, contents);
    console.log('[webink] seeded', path);
    return true;
  } catch (e) {
    console.warn('[webink] could not seed', path, e);
    return false;
  }
}

/**
 * Seed minimal CrossInk state so first launch doesn't log JSON EmptyInput.
 */
function seedDefaultState(FS) {
  ensureDir(FS, '/fs_/.crosspoint');
  ensureDir(FS, '/fs_/.crosspoint/synced_stats');
  // RecentBooksStore::fromJson expects { "books": [ ... ] }
  ensureValidJsonFile(FS, '/fs_/.crosspoint/recent.json', '{"books":[]}\n');
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
    console.warn('[webink] IDBFS not in Wasm build - library is session-only (MEMFS)');
  }

  ensureDir(FS, BOOKS_DIR);
  ensureDir(FS, '/fs_/.crosspoint');
  ensureDir(FS, '/fs_/.fonts');
  ensureDir(FS, '/fs_/fonts');
  seedDefaultState(FS);
  // Persist seeds so next load doesn't re-hit EmptyInput on empty files.
  try {
    await syncfs(mod, false);
  } catch {
    /* optional */
  }
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
          ? `Adding ${file.name}...`
          : `Adding ${i + 1}/${list.length}: ${file.name}...`,
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
    setStatus('Saving library to this browser...', 'busy');
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
      msg: `Added "${lastName}" (${size}) · Library to manage`,
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
  const ok = window.confirm(`Delete "${book.name}" from this browser's library?`);
  if (!ok) return;

  setLibraryBusy(true);
  setStatus(`Deleting ${book.name}...`, 'busy');
  try {
    Module.FS.unlink(book.path);
    await syncfs(Module, false);
    setStatus(`Deleted "${book.name}"`, 'ok');
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
    setStatus('Refreshing...', 'busy');
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
    setStatus('Flushing browser storage...', 'busy');
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
  /**
   * Map a pointer to panel UV in canvas local space (0..1).
   * Prefer offsetX/Y so CSS rotate(90deg) on the shell still maps correctly.
   */
  const pointerToUv = (e) => {
    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;
    if (typeof e.offsetX === 'number' && e.target === canvas) {
      return {
        x: Math.min(1, Math.max(0, e.offsetX / cw)),
        y: Math.min(1, Math.max(0, e.offsetY / ch)),
      };
    }
    // Fallback (unrotated only is accurate)
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };

  const mapKeyFromUv = (x, y) => {
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
    const { x, y } = pointerToUv(e);
    const k = mapKeyFromUv(x, y);
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
// Phone / browser orientation -> CrossInk SETTINGS.orientation
// 0=Portrait, 1=Landscape CW, 2=Inverted, 3=Landscape CCW
// ---------------------------------------------------------------------------

/**
 * Map Screen Orientation API (or viewport) to CrossInk orientation enum.
 * Prefer `type` over `angle`: on desktop, angle is often 0 even in landscape.
 * @returns {number} 0=Portrait 1=LandscapeCW 2=Inverted 3=LandscapeCCW
 */
function mapBrowserOrientationToCrossInk() {
  const so = screen.orientation;
  if (so && typeof so.type === 'string' && so.type.length) {
    switch (so.type) {
      case 'portrait-primary':
        return 0;
      case 'portrait-secondary':
        return 2;
      case 'landscape-primary':
        return 3;
      case 'landscape-secondary':
        return 1;
      default:
        break;
    }
  }
  if (so && typeof so.angle === 'number') {
    const a = ((so.angle % 360) + 360) % 360;
    if (a === 0) return 0;
    if (a === 180) return 2;
    if (a === 90) return 3;
    if (a === 270) return 1;
  }
  // CSS fallback (no inverted distinction)
  if (window.matchMedia('(orientation: portrait)').matches) return 0;
  return 3;
}

/**
 * Queue orientation into Wasm (applied on next firmware frame).
 * @param {any} mod
 * @param {number} o
 */
function pushOrientationToFirmware(mod, o) {
  if (!mod) return;
  try {
    if (typeof mod._webink_set_device_orientation === 'function') {
      mod._webink_set_device_orientation(o);
    } else if (typeof mod.ccall === 'function') {
      mod.ccall('webink_set_device_orientation', null, ['number'], [o]);
    }
  } catch (e) {
    console.warn('[webink] orientation push failed', e);
  }
  requestAnimationFrame(() => fitDeviceScreen());
  setTimeout(() => fitDeviceScreen(), 150);
}

function installDeviceOrientationBridge(mod) {
  let last = -1;
  let ready = false;
  const sync = (reason) => {
    if (!ready) return;
    const o = mapBrowserOrientationToCrossInk();
    if (o === last) return;
    last = o;
    console.info('[webink] orientation', reason, '->', o);
    pushOrientationToFirmware(mod, o);
  };

  if (screen.orientation?.addEventListener) {
    screen.orientation.addEventListener('change', () => sync('screen'));
  }
  window.addEventListener('orientationchange', () => {
    setTimeout(() => sync('orientationchange'), 80);
    setTimeout(() => sync('orientationchange-late'), 350);
  });
  // Only sync on large viewport flips (not every tiny resize).
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => sync('resize'), 250);
  });

  // Wait until boot UI is up before first push (avoids black screen on start).
  setTimeout(() => {
    ready = true;
    // Seed last from firmware if available, so we don't immediately rewrite settings.
    try {
      if (typeof mod._webink_get_device_orientation === 'function') {
        last = mod._webink_get_device_orientation();
      }
    } catch {
      /* ignore */
    }
    sync('initial');
  }, 2500);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  installRouting();
  installHardwareButtons();
  installFitObserver();

  // Register SW after a tick so a just-unregistered worker is not immediately reattached mid-bust.
  if ('serviceWorker' in navigator) {
    setTimeout(() => {
      navigator.serviceWorker
        .register(new URL('./sw.js', import.meta.url), { updateViaCache: 'none' })
        .catch(() => {});
    }, 1500);
  }

  setOverlay('Downloading CrossInk...');
  setStatus('Downloading...', 'busy');

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

  // Emscripten often calls print/printErr per chunk or even per character
  // (put_char). Buffer until newline so log-level filters can match full lines.
  let crossinkOutBuf = '';
  let crossinkErrBuf = '';

  const handleCrossinkLine = (line, asErr) => {
    const msg = line.replace(/\r$/, '').trimEnd();
    if (!msg) return;

    // Noise / expected first-boot
    if (msg.includes('still waiting on run dependencies')) return;
    if (msg.includes('emscripten_set_main_loop_timing')) return;
    if (msg.includes('[SIM] open failed:') && (msg.includes('errno=44') || msg.includes('No such file')))
      return;
    if (msg.includes('recent.json') && (msg.includes('EmptyInput') || msg.includes('(empty)'))) {
      console.warn('[crossink]', msg);
      return;
    }

    // Firmware level tags (even when delivered via printErr)
    if (msg.includes('[DBG]')) {
      console.debug('[crossink]', msg);
      return;
    }
    if (msg.includes('[INF]')) {
      console.log('[crossink]', msg);
      return;
    }
    if (msg.includes('[WRN]') || msg.includes('[WARN]')) {
      console.warn('[crossink]', msg);
      return;
    }
    if (msg.includes('[ERR]') || msg.includes('[ERROR]')) {
      console.error('[crossink]', msg);
      return;
    }

    // Untagged: stdout -> log, stderr -> warn (not error spam)
    if (asErr) console.warn('[crossink]', msg);
    else console.log('[crossink]', msg);
  };

  const feedCrossink = (chunk, isErr) => {
    const text = Array.isArray(chunk) ? chunk.map(String).join('') : String(chunk ?? '');
    if (isErr) {
      crossinkErrBuf += text;
      let i;
      while ((i = crossinkErrBuf.indexOf('\n')) >= 0) {
        handleCrossinkLine(crossinkErrBuf.slice(0, i), true);
        crossinkErrBuf = crossinkErrBuf.slice(i + 1);
      }
    } else {
      crossinkOutBuf += text;
      let i;
      while ((i = crossinkOutBuf.indexOf('\n')) >= 0) {
        handleCrossinkLine(crossinkOutBuf.slice(0, i), false);
        crossinkOutBuf = crossinkOutBuf.slice(i + 1);
      }
    }
  };

  try {
    Module = await createCrossInkModule({
      canvas,
      locateFile: (path) => new URL(path, import.meta.url).href,
      print: (...a) => feedCrossink(a.length === 1 ? a[0] : a.join(''), false),
      printErr: (...a) => feedCrossink(a.length === 1 ? a[0] : a.join(''), true),
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

  setOverlay('Restoring library...');
  setStatus('Restoring library...', 'busy');
  try {
    await mountVirtualSd(Module);
  } catch (e) {
    console.error(e);
    setStatus(`FS: ${e.message || e}`, 'err');
  }

  setOverlay(null);
  setStatus('Starting...', 'busy');
  canvas.focus({ preventScroll: true });
  fitDeviceScreen();

  try {
    if (typeof Module.callMain === 'function') Module.callMain([]);
    else if (typeof Module._main === 'function') Module._main();
    setStatus('Running');
    // SDL sets canvas buffer size during/after first frames - re-fit aspect then.
    requestAnimationFrame(fitDeviceScreen);
    setTimeout(fitDeviceScreen, 100);
    setTimeout(fitDeviceScreen, 400);
    setTimeout(fitDeviceScreen, 1000);
    setTimeout(fitDeviceScreen, 2000);
  } catch (e) {
    console.error(e);
    setStatus(`Start failed: ${e.message || e}`, 'err');
    setOverlay(`CrossInk failed: ${e.message || e}`);
  }

  installLibraryUi(Module);
  installTouchZones();
  installDeviceOrientationBridge(Module);

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
