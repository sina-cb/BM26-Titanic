/**
 * pixel_map_pane_tree.js — pure binary split-tree model for the 2D Pixel Map
 * multiview (vim/tmux-style panes). No DOM, no canvas, no signals: every op is
 * a pure function that returns a NEW state, so the whole thing is trivially
 * unit-testable and cheap to persist.
 *
 * Data model (design §2.3):
 *   node  := { split: 'h'|'v', ratio: 0..1, a: node, b: node }   // internal
 *          | { view: '<viewId>' }                                // leaf pane
 *   state := { root: node, focus: '<path>', zoom: null|'<path>' }
 *
 * A `path` is a string of 'a'/'b' characters walking from the root ('' = root).
 * `focus` always points at a leaf; `zoom` is null or a leaf path (tmux zoom —
 * render one pane full-bleed, tree untouched).
 *
 * Split orientation matches the keyboard:
 *   'v' → vertical divider, panes side-by-side (a = left,  b = right)
 *   'h' → horizontal divider, panes stacked    (a = top,   b = bottom)
 * `ratio` is the fraction of the split's primary axis given to child `a`.
 *
 * Persistence lives here too (localStorage, per scene) but is a thin wrapper
 * over serialize/deserialize — the model itself never touches the environment.
 */

// ── Constants ─────────────────────────────────────────────────────────────
export const RATIO_MIN = 0.15;   // clamp for interactive resize (design §2.3)
export const RATIO_MAX = 0.85;
export const STORAGE_PREFIX = 'bm26.pixelmap.paneLayout.';
const DIVIDER_PX = 6;            // default divider hit-target thickness
const RESIZE_STEP = 0.04;        // Ctrl+Alt+arrow grow/shrink increment

// ── Node helpers ──────────────────────────────────────────────────────────
export function leaf(viewId) {
  return { view: viewId };
}

export function isLeaf(node) {
  return !!node && typeof node.view === 'string';
}

export function isSplit(node) {
  return !!node && (node.split === 'h' || node.split === 'v');
}

/** Fresh single-pane state bound to `viewId`. */
export function createState(viewId) {
  return { root: leaf(viewId), focus: '', zoom: null };
}

/** Resolve a path ('' = root) to its node, or null if the path is invalid. */
export function getNode(root, path) {
  let node = root;
  for (const ch of path) {
    if (!isSplit(node)) return null;
    node = ch === 'a' ? node.a : ch === 'b' ? node.b : null;
    if (!node) return null;
  }
  return node;
}

/** In-order list of every leaf path (left/top → right/bottom). */
export function leafPaths(root, prefix = '') {
  if (isLeaf(root)) return [prefix];
  if (!isSplit(root)) return [];
  return [...leafPaths(root.a, prefix + 'a'), ...leafPaths(root.b, prefix + 'b')];
}

/** First leaf path at/under `path` (deterministic: always descends into `a`). */
export function firstLeaf(root, path = '') {
  let node = getNode(root, path);
  let p = path;
  while (isSplit(node)) { node = node.a; p += 'a'; }
  return isLeaf(node) ? p : null;
}

// Deep clone a node (structuredClone is available in modern Node + browsers).
function cloneNode(node) {
  return structuredClone(node);
}

// Rebuild `root`, replacing the subtree at `path` with `next`. Pure.
function replaceAt(root, path, next) {
  if (path === '') return next;
  const ch = path[0];
  if (!isSplit(root)) throw new Error(`replaceAt: path '${path}' runs past a leaf`);
  if (ch === 'a') return { ...root, a: replaceAt(root.a, path.slice(1), next) };
  if (ch === 'b') return { ...root, b: replaceAt(root.b, path.slice(1), next) };
  throw new Error(`replaceAt: bad path char '${ch}'`);
}

// ── Structural ops (all return a new state) ───────────────────────────────

/**
 * Split the leaf at `path` (default: the focused pane). The new sibling
 * inherits the focused pane's view. dir 'v' = side-by-side, 'h' = stacked.
 * Focus moves to the new pane; any active zoom is cleared (structural change).
 */
export function splitPane(state, path = state.focus, dir = 'v') {
  if (dir !== 'h' && dir !== 'v') throw new Error(`splitPane: bad dir '${dir}'`);
  const node = getNode(state.root, path);
  if (!isLeaf(node)) throw new Error(`splitPane: '${path}' is not a leaf`);
  const split = { split: dir, ratio: 0.5, a: leaf(node.view), b: leaf(node.view) };
  const root = replaceAt(state.root, path, split);
  return { root, focus: path + 'b', zoom: null };
}

/**
 * Close the leaf at `path` (default: focused). Its sibling collapses up into
 * the parent's slot. Closing the last remaining pane is a no-op (returns the
 * same state reference). Focus is remapped through the collapse.
 */
export function closePane(state, path = state.focus) {
  if (path === '') return state;                 // last pane — no-op
  const node = getNode(state.root, path);
  if (!isLeaf(node) && !isSplit(node)) throw new Error(`closePane: bad path '${path}'`);
  const parentPath = path.slice(0, -1);
  const rmChar = path[path.length - 1];
  const keepChar = rmChar === 'a' ? 'b' : 'a';
  const parent = getNode(state.root, parentPath);
  if (!isSplit(parent)) throw new Error(`closePane: '${path}' has no split parent`);
  const keepSubtree = keepChar === 'a' ? parent.a : parent.b;

  const root = replaceAt(state.root, parentPath, cloneNode(keepSubtree));
  const keepPrefix = parentPath + keepChar;
  const focus = _remapFocus(state.focus, parentPath, keepPrefix, root);
  const zoom = _remapPathOrNull(state.zoom, parentPath, keepPrefix, root);
  return { root, focus, zoom };
}

// A path under `keepPrefix` shifts up to `parentPath`; a path under the removed
// sibling is gone → fall back to the first leaf now sitting at `parentPath`.
function _remapFocus(oldPath, parentPath, keepPrefix, newRoot) {
  const remapped = _remapPathOrNull(oldPath, parentPath, keepPrefix, newRoot);
  return remapped == null ? firstLeaf(newRoot, parentPath) : remapped;
}

function _remapPathOrNull(oldPath, parentPath, keepPrefix, newRoot) {
  if (oldPath == null) return null;
  if (oldPath.startsWith(keepPrefix)) {
    const shifted = parentPath + oldPath.slice(keepPrefix.length);
    return isLeaf(getNode(newRoot, shifted)) ? shifted : firstLeaf(newRoot, parentPath);
  }
  // Under the removed sibling (same parent, other child) → invalid now.
  if (oldPath.startsWith(parentPath) && oldPath.length > parentPath.length
      && oldPath[parentPath.length] !== keepPrefix[parentPath.length]) {
    return null;
  }
  // Outside the collapsed parent entirely → unchanged (still valid).
  return isLeaf(getNode(newRoot, oldPath)) ? oldPath : null;
}

/** Set the split ratio at `path` (must be a split node), clamped 0.15–0.85. */
export function setRatio(state, path, ratio) {
  const node = getNode(state.root, path);
  if (!isSplit(node)) throw new Error(`setRatio: '${path}' is not a split`);
  const r = Math.max(RATIO_MIN, Math.min(RATIO_MAX, ratio));
  return { ...state, root: replaceAt(state.root, path, { ...node, ratio: r }) };
}

/** Bind `viewId` to the leaf at `path` (default: focused). */
export function bindView(state, viewId, path = state.focus) {
  const node = getNode(state.root, path);
  if (!isLeaf(node)) throw new Error(`bindView: '${path}' is not a leaf`);
  return { ...state, root: replaceAt(state.root, path, { view: viewId }) };
}

/** tmux zoom: toggle full-bleed rendering of the leaf at `path`. */
export function toggleZoom(state, path = state.focus) {
  const node = getNode(state.root, path);
  if (!isLeaf(node)) throw new Error(`toggleZoom: '${path}' is not a leaf`);
  return { ...state, zoom: state.zoom === path ? null : path };
}

// ── Focus movement ────────────────────────────────────────────────────────

/** Cycle focus through the leaves in order (delta +1 = next, -1 = prev). */
export function cycleFocus(state, delta = 1) {
  const leaves = leafPaths(state.root);
  if (leaves.length <= 1) return state;
  const i = leaves.indexOf(state.focus);
  const next = leaves[((i < 0 ? 0 : i) + delta + leaves.length) % leaves.length];
  return { ...state, focus: next };
}

/**
 * Directional focus: pick the geometric nearest-neighbor leaf in `dir`
 * ('left'|'right'|'up'|'down'). Unit-square geometry, so it is aspect-agnostic
 * and pure. Returns the same state if there is no pane in that direction.
 */
export function moveFocus(state, dir) {
  const rects = _unitRects(state.root);
  const cur = rects.find((r) => r.path === state.focus);
  if (!cur) return state;
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  let best = null, bestScore = Infinity;
  for (const r of rects) {
    if (r.path === state.focus) continue;
    const rx = r.x + r.w / 2, ry = r.y + r.h / 2;
    const dx = rx - cx, dy = ry - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx
      : dir === 'up' ? -dy : dy;
    if (along <= 1e-6) continue;                         // wrong side
    const perp = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
    const score = along + perp * 2;                      // prefer aligned + near
    if (score < bestScore) { bestScore = score; best = r.path; }
  }
  return best ? { ...state, focus: best } : state;
}

/**
 * Grow/shrink the focused pane toward `dir` by moving the divider on that side
 * (Ctrl+Alt+arrows). Acts on the nearest ancestor split with a divider on the
 * requested side; no-op if the focused pane already touches that edge.
 */
export function resizeFocused(state, dir, step = RESIZE_STEP) {
  const axis = (dir === 'left' || dir === 'right') ? 'v' : 'h';
  // A divider is on the focused pane's right/bottom when it descends into `a`;
  // on its left/top when it descends into `b`.
  const wantChild = (dir === 'right' || dir === 'down') ? 'a' : 'b';
  const anc = _ancestors(state.focus)
    .filter((x) => getNode(state.root, x.path).split === axis && x.child === wantChild)
    .pop();                                              // nearest (deepest)
  if (!anc) return state;
  const node = getNode(state.root, anc.path);
  // Growing the focused pane: if focus is in `a`, bump ratio up; in `b`, down.
  const delta = anc.child === 'a' ? step : -step;
  return setRatio(state, anc.path, node.ratio + delta);
}

// Enumerate (ancestorPath, child) pairs from root down to the leaf `path`.
function _ancestors(path) {
  const out = [];
  for (let i = 0; i < path.length; i++) out.push({ path: path.slice(0, i), child: path[i] });
  return out;
}

// Leaf rects in the unit square [0,1]² (exact tiling, no divider gap).
function _unitRects(root, x = 0, y = 0, w = 1, h = 1, path = '', out = []) {
  if (isLeaf(root)) { out.push({ path, x, y, w, h }); return out; }
  if (isSplit(root)) {
    if (root.split === 'v') {
      const aw = w * root.ratio;
      _unitRects(root.a, x, y, aw, h, path + 'a', out);
      _unitRects(root.b, x + aw, y, w - aw, h, path + 'b', out);
    } else {
      const ah = h * root.ratio;
      _unitRects(root.a, x, y, w, ah, path + 'a', out);
      _unitRects(root.b, x, y + ah, w, h - ah, path + 'b', out);
    }
  }
  return out;
}

// ── Pixel-space layout (for the panel / dividers) ─────────────────────────

/**
 * Tile the tree into a `w`×`h` pixel box. Returns:
 *   { panes: [{ path, view, x, y, w, h }], dividers: [{ path, dir, x, y, w, h }] }
 * When `state.zoom` is set, only the zoomed leaf is returned (full-bleed, no
 * dividers) — the tree is left untouched.
 */
export function computeLayout(state, w, h, dividerPx = DIVIDER_PX) {
  if (state.zoom) {
    const node = getNode(state.root, state.zoom);
    if (isLeaf(node)) {
      return { panes: [{ path: state.zoom, view: node.view, x: 0, y: 0, w, h }], dividers: [] };
    }
  }
  const panes = [];
  const dividers = [];
  _layout(state.root, 0, 0, w, h, '', dividerPx, panes, dividers);
  return { panes, dividers };
}

function _layout(node, x, y, w, h, path, dpx, panes, dividers) {
  if (isLeaf(node)) { panes.push({ path, view: node.view, x, y, w, h }); return; }
  if (!isSplit(node)) return;
  const half = dpx / 2;
  if (node.split === 'v') {
    const aw = w * node.ratio;
    _layout(node.a, x, y, aw - half, h, path + 'a', dpx, panes, dividers);
    _layout(node.b, x + aw + half, y, w - aw - half, h, path + 'b', dpx, panes, dividers);
    dividers.push({ path, dir: 'v', x: x + aw - half, y, w: dpx, h });
  } else {
    const ah = h * node.ratio;
    _layout(node.a, x, y, w, ah - half, path + 'a', dpx, panes, dividers);
    _layout(node.b, x, y + ah + half, w, h - ah - half, path + 'b', dpx, panes, dividers);
    dividers.push({ path, dir: 'h', x, y: y + ah - half, w, h: dpx });
  }
}

// ── Serialization + validation ────────────────────────────────────────────

/** Plain-object snapshot (deep clone) — the literal node shape, per contract. */
export function serialize(state) {
  return { root: cloneNode(state.root), focus: state.focus, zoom: state.zoom ?? null };
}

/**
 * Validate + normalize a serialized layout. Throws a descriptive Error on any
 * schema violation, unknown viewId (when `validViewIds` is supplied), or a
 * focus/zoom path that does not resolve to a leaf. Never falls back silently —
 * the caller catches, reports loudly, and rebuilds the default (design §2.3).
 *
 * @param {object} obj serialized {root, focus, zoom}
 * @param {Set<string>|Array<string>|null} validViewIds allowed view ids, or null to skip that check
 */
export function deserialize(obj, validViewIds = null) {
  if (!obj || typeof obj !== 'object') throw new Error('pane layout: not an object');
  const valid = validViewIds == null ? null
    : (validViewIds instanceof Set ? validViewIds : new Set(validViewIds));
  const root = _validateNode(obj.root, valid, '');
  if (typeof obj.focus !== 'string') throw new Error('pane layout: focus must be a string path');
  if (!isLeaf(getNode(root, obj.focus))) throw new Error(`pane layout: focus '${obj.focus}' is not a leaf`);
  let zoom = obj.zoom ?? null;
  if (zoom !== null) {
    if (typeof zoom !== 'string' || !isLeaf(getNode(root, zoom))) {
      throw new Error(`pane layout: zoom '${zoom}' is not a leaf`);
    }
  }
  return { root, focus: obj.focus, zoom };
}

function _validateNode(node, valid, path) {
  if (!node || typeof node !== 'object') throw new Error(`pane layout: node at '${path}' is missing`);
  if (typeof node.view === 'string') {
    if (valid && !valid.has(node.view)) {
      throw new Error(`pane layout: leaf '${path}' binds unknown view '${node.view}'`);
    }
    return { view: node.view };
  }
  if (node.split !== 'h' && node.split !== 'v') {
    throw new Error(`pane layout: node at '${path}' has bad split '${node.split}'`);
  }
  if (typeof node.ratio !== 'number' || !isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) {
    throw new Error(`pane layout: node at '${path}' has bad ratio '${node.ratio}'`);
  }
  const ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, node.ratio));
  return {
    split: node.split,
    ratio,
    a: _validateNode(node.a, valid, path + 'a'),
    b: _validateNode(node.b, valid, path + 'b'),
  };
}

// ── Persistence (per scene, localStorage) ─────────────────────────────────

function _storage() {
  const ls = globalThis.localStorage;
  if (!ls) throw new Error('pane layout: localStorage is unavailable');
  return ls;
}

/** Persist the layout for `scene`. Throws loudly if localStorage is missing. */
export function saveLayout(scene, state) {
  _storage().setItem(STORAGE_PREFIX + scene, JSON.stringify(serialize(state)));
}

/**
 * Load + validate the saved layout for `scene`. Returns null when nothing is
 * stored (a legitimate "no layout yet" — the caller builds the default).
 * A corrupt or stale entry (bad JSON, schema violation, unknown viewId) throws
 * — the caller reports it and recovers to the single-pane default.
 */
export function loadLayout(scene, validViewIds = null) {
  const raw = _storage().getItem(STORAGE_PREFIX + scene);
  if (raw == null) return null;
  return deserialize(JSON.parse(raw), validViewIds);
}

/** Remove any saved layout for `scene` (used by loud recovery). */
export function clearLayout(scene) {
  _storage().removeItem(STORAGE_PREFIX + scene);
}
