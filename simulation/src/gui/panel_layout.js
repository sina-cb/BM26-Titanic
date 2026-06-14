/**
 * panel_layout.js — Layout policy for the sim's floating panels.
 *
 * One module owns what used to be scattered magic numbers (see the
 * 2026-06-12 layout audit in
 * .agent/02_reports/202606/20260612_4_layout_pass.md):
 *
 *  - Exclusion strip: no panel may default to or be dragged/restored above
 *    TOP_MIN (the HUD top bar's interactive strip stays reachable).
 *  - Z-banding + click-to-front: registered panels live in z 100–150; the
 *    last-touched panel is raised, so no panel can be permanently buried.
 *    Warnings (z 9000+) and the loading overlay stay above everything.
 *  - Free-slot cascade: a panel shown into an occupied slot offsets by
 *    +24,+24 until it finds visible room.
 *  - Geometry persistence: per-machine, in localStorage (same scope as the
 *    theme choice) — NOT in scene YAML. Restores are viewport-clamped so a
 *    layout saved on a large monitor can't restore off-screen.
 *
 * Engine/framework-agnostic on purpose: it observes panels through DOM
 * rects, classes, and pointer events, so legacy panels, Preact panels,
 * and MarsinGui roots all register the same way.
 */

// Top exclusion strip: HUD bar spans y 8–36; panels start below it.
export const TOP_MIN = 44;
// Keep at least this much of a panel reachable when clamping.
const MIN_VISIBLE = 100;

const STORAGE_KEY = 'bm26.sim.panelLayout';
const Z_BAND_MIN = 100;
const Z_BAND_MAX = 150;

const _registered = new Map(); // id → { el, opts }
let _zCounter = Z_BAND_MIN;

// ── Pure helpers (unit-tested in tests/panel_layout.test.js) ───────────

export function clampPosition({ left, top, width, height }, vw, vh) {
  return {
    left: Math.max(0, Math.min(left, vw - MIN_VISIBLE)),
    top: Math.max(TOP_MIN, Math.min(top, vh - 50)),
    width: width !== undefined ? Math.min(width, vw - 20) : undefined,
    height: height !== undefined ? Math.min(height, vh - TOP_MIN - 10) : undefined,
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Cascade a desired slot by +24,+24 until it covers < 40% of any
 *  occupied rect (or tries run out — then return the last candidate).
 *  The desired slot itself is clamped first, so the no-collision path
 *  honors the exclusion strip / viewport bounds too. */
export function findFreeSlot(desired, occupied, vw, vh, step = 24, maxTries = 8) {
  let candidate = { ...desired, ...clampPosition(desired, vw, vh) };
  for (let i = 0; i < maxTries; i++) {
    const area = candidate.width * candidate.height;
    const collides = occupied.some((r) => overlapArea(candidate, r) / area > 0.4);
    if (!collides) break;
    candidate = clampPosition(
      { ...candidate, left: candidate.left + step, top: candidate.top + step }, vw, vh,
    );
  }
  return candidate;
}

// ── Persistence ─────────────────────────────────────────────────────────

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[Layout] Failed to read panel layout store:', err);
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.error('[Layout] Failed to persist panel layout:', err);
  }
}

export function getStoredGeometry(id) {
  return readStore()[id] || null;
}

function saveGeometry(id, el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return; // hidden — nothing real to save
  const store = readStore();
  const prev = store[id] || {};
  const collapsed = el.classList.contains('collapsed');
  store[id] = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    // Collapsed panels are forced to 34px — keep the expanded size we saw.
    w: collapsed ? prev.w : Math.round(rect.width),
    h: collapsed ? prev.h : Math.round(rect.height),
    collapsed,
  };
  writeStore(store);
}

const _saveTimers = new Map();
function scheduleSave(id, el) {
  clearTimeout(_saveTimers.get(id));
  _saveTimers.set(id, setTimeout(() => saveGeometry(id, el), 300));
}

// ── Z band / click-to-front ────────────────────────────────────────────

function renormalizeZ() {
  const byZ = [..._registered.values()]
    .sort((a, b) => Number(a.el.style.zIndex || 0) - Number(b.el.style.zIndex || 0));
  _zCounter = Z_BAND_MIN;
  for (const { el } of byZ) el.style.zIndex = String(_zCounter++);
}

function raisePanel(el) {
  if (Number(el.style.zIndex) === _zCounter) return;
  if (_zCounter >= Z_BAND_MAX) renormalizeZ();
  el.style.zIndex = String(++_zCounter);
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register a floating panel with the layout system.
 *
 * @param {HTMLElement} el  Panel root (position:fixed).
 * @param {object} [opts]
 * @param {boolean} [opts.persist=true]  Save/restore geometry (localStorage).
 * @param {boolean} [opts.restore=true]  Apply stored geometry on register.
 * @param {Function} [opts.applyCollapsed]  Called with the restored
 *        collapsed boolean; panels whose collapse state is owned by a
 *        framework store pass a setter here. Default toggles the
 *        'collapsed' class directly.
 */
export function registerPanel(el, opts = {}) {
  const id = el.id;
  if (!id) throw new Error('registerPanel: panel element must have an id');
  const prev = _registered.get(id);
  if (prev) {
    // Same or still-live element: nothing to do. A DISCONNECTED previous
    // element means the panel was destroyed and recreated (the engine
    // params panel does this on every lighting-mode switch) — clean up
    // the stale registration and adopt the new element.
    if (prev.el === el || prev.el.isConnected) return;
    prev.cleanup();
    _registered.delete(id);
  }
  const { persist = true, restore = true, applyCollapsed } = opts;
  const cleanups = [];
  _registered.set(id, { el, opts, cleanup: () => cleanups.forEach((fn) => fn()) });

  // Z band + click-to-front. Capture phase: MarsinGui roots stop
  // pointerdown propagation in the bubble phase, capture still descends.
  el.style.zIndex = String(++_zCounter);
  const onRaise = () => raisePanel(el);
  el.addEventListener('pointerdown', onRaise, true);
  cleanups.push(() => el.removeEventListener('pointerdown', onRaise, true));

  if (persist && restore) {
    const stored = getStoredGeometry(id);
    if (stored) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pos = clampPosition(
        { left: stored.x, top: stored.y, width: stored.w, height: stored.h }, vw, vh,
      );
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      if (pos.width) el.style.width = `${pos.width}px`;
      // Height applies even when restoring collapsed: the .collapsed
      // rules force 34px with !important, and the inline height becomes
      // the expanded size again when the operator un-collapses.
      if (pos.height) el.style.height = `${pos.height}px`;
      if (stored.collapsed !== undefined) {
        if (applyCollapsed) applyCollapsed(stored.collapsed);
        else el.classList.toggle('collapsed', stored.collapsed);
      }
    }
  }

  if (persist) {
    const snapshot = () => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},`
        + `${Math.round(r.height)},${el.classList.contains('collapsed')}`;
    };
    // Persist only when the operator touched the panel AND its geometry
    // actually changed — a click on a button inside an untouched-position
    // panel must not pin the (improvable) default layout, and
    // programmatic default placement must not self-persist.
    let touched = false;
    let lastGeom = snapshot();
    const onTouch = () => { touched = true; };
    el.addEventListener('pointerdown', onTouch, true);
    cleanups.push(() => el.removeEventListener('pointerdown', onTouch, true));
    const maybeSave = () => {
      if (!touched) {
        lastGeom = snapshot();
        return;
      }
      if (snapshot() === lastGeom) return;
      lastGeom = snapshot();
      scheduleSave(id, el);
    };
    // Drag ends with a pointerup somewhere; legacy drag handlers move
    // panels via document-level mousemove and end anywhere on the page.
    el.addEventListener('pointerup', maybeSave);
    cleanups.push(() => el.removeEventListener('pointerup', maybeSave));
    document.addEventListener('pointerup', maybeSave);
    cleanups.push(() => document.removeEventListener('pointerup', maybeSave));
    const ro = new ResizeObserver(maybeSave);
    ro.observe(el);
    cleanups.push(() => ro.disconnect());
    const mo = new MutationObserver(maybeSave);
    mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    cleanups.push(() => mo.disconnect());
  }

  // Drag/restore floor: never let the panel sit in the HUD strip.
  const enforceStrip = new MutationObserver(() => {
    const top = parseFloat(el.style.top);
    if (!Number.isNaN(top) && top < TOP_MIN) {
      el.style.top = `${TOP_MIN}px`;
      el.style.bottom = 'auto';
    }
  });
  enforceStrip.observe(el, { attributes: true, attributeFilter: ['style'] });
  cleanups.push(() => enforceStrip.disconnect());
}

/** Register a panel that is created asynchronously (e.g. the Lighting
 *  Controls panel appears after the 3D model loads). Bounded poll. */
export function registerPanelWhenPresent(id, opts = {}, timeoutMs = 30000) {
  const startedAt = performance.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (el) {
      registerPanel(el, opts);
      return;
    }
    if (performance.now() - startedAt > timeoutMs) {
      console.error(`[Layout] Panel #${id} never appeared — not registered.`);
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Visible rects of all registered panels except `skipId` — collision
 *  input for findFreeSlot. */
export function visiblePanelRects(skipId) {
  const rects = [];
  for (const [id, { el }] of _registered) {
    if (id === skipId) continue;
    if (el.classList.contains('hidden') || el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
  }
  return rects;
}

/** CSS `resize: both` on a right-anchored panel grows it leftward — the
 *  grip corner stays pinned and escapes the pointer. Call once per
 *  resizable panel: a pointerdown landing in the bottom-right grip
 *  corner of a panel that still has no inline `left` (never dragged,
 *  never restored) pins it to left/top anchoring at its current spot,
 *  so the native resizer moves the right/bottom edges exactly like it
 *  does on every dragged panel. Capture phase: content handlers must
 *  not be able to swallow the pin. */
export function pinForCornerResize(el, gripPx = 18) {
  el.addEventListener('pointerdown', (e) => {
    if (el.style.left) return;
    const rect = el.getBoundingClientRect();
    if (rect.right - e.clientX > gripPx || rect.bottom - e.clientY > gripPx) return;
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.right = 'auto';
  }, true);
}

/** Keep an expanding bottom-anchored panel on-screen: if its bottom would
 *  pass the viewport, pull the top up (never above the HUD strip). */
export function clampIntoViewport(el) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.bottom > vh - 10) {
    el.style.top = `${Math.max(TOP_MIN, vh - 10 - r.height)}px`;
    el.style.bottom = 'auto';
  }
  if (r.top < TOP_MIN) {
    el.style.top = `${TOP_MIN}px`;
    el.style.bottom = 'auto';
  }
}

// ── Off-screen repair (viewport clamp + layout sanitization) ─────────────

/**
 * Repair one stored geometry entry so it sits fully reachable in a
 * vw×vh viewport. Pure — no DOM, no localStorage — so it unit-tests
 * directly. Delegates the actual bounds math to clampPosition; only the
 * stored `{x,y,w,h,collapsed}` shape mapping lives here.
 *
 * @param {{x:number,y:number,w?:number,h?:number,collapsed?:boolean}} entry
 * @param {number} vw  viewport width
 * @param {number} vh  viewport height
 * @returns {{x:number,y:number,w?:number,h?:number,collapsed?:boolean}}
 *          a repaired entry (same fields; w/h/collapsed preserved when absent)
 */
export function sanitizeGeometry(entry, vw, vh) {
  const pos = clampPosition(
    { left: entry.x, top: entry.y, width: entry.w, height: entry.h }, vw, vh,
  );
  const repaired = { x: pos.left, y: pos.top };
  if (entry.w !== undefined) repaired.w = pos.width;
  if (entry.h !== undefined) repaired.h = pos.height;
  if (entry.collapsed !== undefined) repaired.collapsed = entry.collapsed;
  return repaired;
}

/**
 * Walk the persisted store and repair every entry whose clamped position
 * differs from what was stored (i.e. it currently falls outside the
 * viewport), writing the store back only if something actually moved.
 * Call this on boot BEFORE panels restore so registerPanel reads
 * already-repaired geometry — this defends against stale large-monitor
 * layouts restoring off-screen.
 */
export function sanitizeStore(vw = window.innerWidth, vh = window.innerHeight) {
  const store = readStore();
  let dirty = false;
  for (const id of Object.keys(store)) {
    const entry = store[id];
    if (!entry || typeof entry !== 'object') continue;
    const repaired = sanitizeGeometry(entry, vw, vh);
    if (repaired.x !== entry.x || repaired.y !== entry.y
        || repaired.w !== entry.w || repaired.h !== entry.h) {
      store[id] = repaired;
      dirty = true;
    }
  }
  if (dirty) writeStore(store);
}

/**
 * Clamp one live panel element fully into the current viewport: read its
 * on-screen rect, run clampPosition, and write back inline left/top
 * (plus width/height when they changed). Switches the panel to
 * top/left anchoring so the clamp sticks.
 */
function clampPanelEl(el) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pos = clampPosition(
    { left: r.left, top: r.top, width: r.width, height: r.height }, vw, vh,
  );
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  if (pos.width !== undefined && Math.round(pos.width) !== Math.round(r.width)) {
    el.style.width = `${pos.width}px`;
  }
  if (pos.height !== undefined && Math.round(pos.height) !== Math.round(r.height)) {
    el.style.height = `${pos.height}px`;
  }
}

/**
 * Resize handler: clamp every registered panel back into the (possibly
 * shrunk) viewport. Visible panels are repositioned live; hidden panels
 * (display:none or `.hidden`) keep their inline geometry but have their
 * PERSISTED geometry repaired, so they reappear on-screen when shown.
 */
export function clampAllPanels() {
  for (const [id, { el }] of _registered) {
    const hidden = el.classList.contains('hidden') || el.style.display === 'none';
    if (hidden) {
      const stored = getStoredGeometry(id);
      if (stored) {
        const repaired = sanitizeGeometry(stored, window.innerWidth, window.innerHeight);
        const store = readStore();
        store[id] = repaired;
        writeStore(store);
      }
      continue;
    }
    clampPanelEl(el);
  }
}

/**
 * Snapshot of every currently registered panel as
 * `Array<{ id: string, el: HTMLElement }>`. The panel-visibility module
 * consumes this — keep the name and shape stable.
 */
export function getRegisteredPanels() {
  return [..._registered].map(([id, { el }]) => ({ id, el }));
}

/**
 * Re-show a panel safely: clamp it fully into the viewport (so a panel
 * that drifted off-screen while hidden never reappears unreachable) and
 * raise it to the front. Called by the visibility module on show.
 */
export function showPanelClamped(el) {
  clampPanelEl(el);
  raisePanel(el);
}
