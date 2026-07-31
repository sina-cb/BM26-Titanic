/**
 * pixel_map_pane_view.js — one pane of the 2D Pixel Map multiview: its own
 * Canvas 2D surface, a static offscreen layer (background + dark off-bezels +
 * per-panel error banners), and a per-frame lit-fill pass driven by the SHARED
 * color buffer from the frame source (design §2.1 / §5).
 *
 * Contract with the frame source (§5): the pane registers `paint` as a
 * pane-painter; it is called `paint(colorBuf, list, version)` once per frame,
 * where colorBuf is a shared Float32Array of length 3n (one RGB triple per
 * pixel). Colors are ALREADY decoded (entryDisplayRgb + preview gamma)
 * once per pixel into `colorBuf`, so panes never re-decode — they only stamp
 * geometry. Geometry for each panel is handed in via `setPanels`, already
 * expanded into design space by the layout/view layer (S1/S2). This file is
 * deliberately free of cross-slice imports so it can be unit-tested in
 * isolation; the exported pure helpers (`panelSubRects`, `panelTransform`) pin
 * the geometry math.
 *
 * Each pane owns its own view transform (zoom/pan) and mode/selection — panes
 * are independent viewports onto the same live pixel data.
 */

// ── Palette (mirrors pixel_map_renderer's flat, no-glow stance) ────────────
const BG           = '#0b0d12';
const BEZEL_FILL   = '#10141c';
const BEZEL_STROKE = 'rgba(255,255,255,0.045)';
const SELECT       = '#fabd2f';                  // = --primary
const ERR_BG       = 'rgba(120,20,24,0.9)';
const ERR_FG       = '#ffd9d0';
const MONO         = '"Cascadia Code", Consolas, monospace';
const OFF_EPS      = 0.006;                       // sum-of-channels below → "off"

// ── Pure geometry helpers (exported for unit tests) ───────────────────────

/**
 * Arrange `panels` into sub-rects inside a `w`×`h` box, proportional to each
 * panel's `weight` (default 1), left→right. A single panel fills the box.
 * Returns [{ id, x, y, w, h }] aligned 1:1 with `panels`.
 */
export function panelSubRects(panels, w, h, gap = 0) {
  const n = panels.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: panels[0].id, x: 0, y: 0, w, h }];
  const weights = panels.map((p) => (p.weight > 0 ? p.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const inner = w - gap * (n - 1);
  const out = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const pw = inner * (weights[i] / total);
    out.push({ id: panels[i].id, x, y: 0, w: pw, h });
    x += pw + gap;
  }
  return out;
}

/**
 * Affine transform (uniform scale) mapping a panel's design space into its
 * screen sub-rect, letterboxed and aspect-preserving, then zoomed/panned about
 * the sub-rect center. Returns { scale, ox, oy } so screenX = x*scale + ox.
 */
export function panelTransform(design, rect, zoom = 1, pan = { x: 0, y: 0 }) {
  const dw = design.w || 1, dh = design.h || 1;
  // Guard degenerate (zero/negative) sub-rects — e.g. a pane measured before
  // layout, or a divider inset larger than a tiny box — so scale is never < 0.
  const base = Math.max(0, Math.min(rect.w / dw, rect.h / dh));
  const bx = rect.x + (rect.w - dw * base) / 2;
  const by = rect.y + (rect.h - dh * base) / 2;
  const ccx = rect.x + rect.w / 2, ccy = rect.y + rect.h / 2;
  return {
    scale: base * zoom,
    ox: ccx + zoom * (bx - ccx) + (pan.x || 0),
    oy: ccy + zoom * (by - ccy) + (pan.y || 0),
  };
}

// ── Fit to the VISIBLE part of a pane (operator order, 2026-07-30) ────────
// "fit to the area not under any menu, active" — fit the focused pane's content
// into the part of that pane no other UI is sitting on top of, so nothing lands
// hidden under the Lighting Controls panel, the camera-chip strip or a banner.
//
// Everything here is pure geometry on CSS-pixel rects in PANE-LOCAL coordinates
// ({ x, y, w, h }, origin = the pane canvas' top-left). The DOM measuring lives
// in the shell; these functions are what the tests pin.

/** Intersection of two rects, or null when they do not overlap. */
export function intersectRect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), bm = Math.min(a.y + a.h, b.y + b.h);
  if (!(r > x && bm > y)) return null;
  return { x, y, w: r - x, h: bm - y };
}

/**
 * Shrink `rect` until it clears every obstruction, giving up as little area as
 * possible.
 *
 * For each obstruction still overlapping, there are four ways out — trim from
 * the left, right, top or bottom — and the cheapest is taken. Trimming only
 * ever shrinks, so an obstruction that has been cleared stays cleared and one
 * pass is enough. An obstruction that spans the whole rect (nothing left to
 * trim to) is SKIPPED rather than collapsing the rect to nothing: a fit into a
 * zero-size box would be worse than a fit that ignores one overlay.
 *
 * Deliberately NOT the maximal-empty-rectangle problem: real chrome sits along
 * the edges (a docked panel on the right, a chip strip along the bottom, a
 * banner across the top), which edge-trimming handles exactly, and the result
 * is predictable enough for the operator to anticipate.
 */
export function unobstructedRect(rect, obstructions, minSize = 80) {
  let out = { ...rect };
  for (const ob of obstructions || []) {
    const hit = intersectRect(out, ob);
    if (!hit) continue;
    const cands = [
      { w: out.w - (hit.x + hit.w - out.x), rect: { x: hit.x + hit.w, y: out.y, w: out.x + out.w - (hit.x + hit.w), h: out.h } }, // trim left
      { w: hit.x - out.x, rect: { x: out.x, y: out.y, w: hit.x - out.x, h: out.h } },                                             // trim right
      { w: out.h - (hit.y + hit.h - out.y), rect: { x: out.x, y: hit.y + hit.h, w: out.w, h: out.y + out.h - (hit.y + hit.h) } }, // trim top
      { w: hit.y - out.y, rect: { x: out.x, y: out.y, w: out.w, h: hit.y - out.y } },                                             // trim bottom
    ];
    let best = null;
    for (const c of cands) {
      if (!(c.rect.w >= minSize && c.rect.h >= minSize)) continue;
      const area = c.rect.w * c.rect.h;
      if (!best || area > best.area) best = { area, rect: c.rect };
    }
    if (best) out = best.rect;   // no viable trim → leave this one obstructing
  }
  return out;
}

/**
 * Solve for the pane framing (zoom + pan) that puts every active panel's
 * content inside `free`.
 *
 * A pane's panels each scale about THEIR OWN sub-rect centre, so a multi-panel
 * pane cannot be rescaled by one similarity in screen space — but for a fixed
 * zoom the pan enters every panel identically, so the union of the panels'
 * content translates rigidly with it. That makes this exactly solvable:
 * binary-search the largest zoom whose union still fits (the union grows
 * monotonically with zoom), then translate that union onto the free rect's
 * centre.
 *
 * @param {Array<{rect:{x,y,w,h}, design:{w,h}, box:{minX,minY,maxX,maxY}}>} panels
 *        active panels: their sub-rect, design space, and content bbox in design units
 * @param {{x,y,w,h}} free      the obstruction-free area, pane-local CSS px
 * @param {{min:number,max:number}} zoomRange
 * @returns {{zoom:number, pan:{x:number,y:number}, clamped:boolean}}
 */
export function fitFramingFor(panels, free, zoomRange, pad = 10) {
  const usable = { w: Math.max(1, free.w - pad * 2), h: Math.max(1, free.h - pad * 2) };
  const live = (panels || []).filter((p) => p.box && Number.isFinite(p.box.minX));
  if (!live.length) return { zoom: 1, pan: { x: 0, y: 0 }, clamped: false };

  // Union of the panels' content in pane-local screen px at zoom z, pan 0.
  const unionAt = (z) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of live) {
      const dw = p.design.w || 1, dh = p.design.h || 1;
      const base = Math.max(0, Math.min(p.rect.w / dw, p.rect.h / dh));
      const bx = p.rect.x + (p.rect.w - dw * base) / 2;
      const by = p.rect.y + (p.rect.h - dh * base) / 2;
      const ccx = p.rect.x + p.rect.w / 2, ccy = p.rect.y + p.rect.h / 2;
      const ox = ccx + z * (bx - ccx), oy = ccy + z * (by - ccy);
      const s = base * z;
      minX = Math.min(minX, p.box.minX * s + ox); maxX = Math.max(maxX, p.box.maxX * s + ox);
      minY = Math.min(minY, p.box.minY * s + oy); maxY = Math.max(maxY, p.box.maxY * s + oy);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const fits = (z) => { const u = unionAt(z); return u.w <= usable.w && u.h <= usable.h; };
  let lo = zoomRange.min, hi = zoomRange.max;
  let clamped = false;
  if (fits(hi)) { lo = hi; clamped = true; }            // content is tiny: cap at max zoom
  else if (!fits(lo)) { hi = lo; clamped = true; }      // content cannot fit even at min zoom
  else {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
  }
  const zoom = lo;
  const u = unionAt(zoom);
  return {
    zoom,
    pan: {
      x: (free.x + free.w / 2) - (u.x + u.w / 2),
      y: (free.y + free.h / 2) - (u.y + u.h / 2),
    },
    clamped,
  };
}

/** Read display RGB (0..1) for pixel `gi` from the shared buffer, or null. */
export function bufColor(colorBuf, gi) {
  const i = gi * 3;
  if (!colorBuf || i < 0 || i + 2 >= colorBuf.length) return null;
  return [colorBuf[i], colorBuf[i + 1], colorBuf[i + 2]];
}

// ── The pane ──────────────────────────────────────────────────────────────

export class PixelMapPaneView {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.static = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    this.sctx = this.static ? this.static.getContext('2d') : null;
    this.panels = [];          // [{ id, label, design:{w,h}, pixels:[...], error, weight }]
    this.mode = 'view';        // 'view' | 'edit'
    this.selection = new Set();
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.focusPanel = null;    // panel id maximized within the pane, or null
    this.dpr = 1;
    this.cssW = 0; this.cssH = 0;
    this._staticDirty = true;
    this._rects = [];          // last computed panel sub-rects (CSS px)
    this._xforms = new Map();  // panelId → { scale, ox, oy }
    this.lastList = null;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  setPanels(panels) {
    this.panels = Array.isArray(panels) ? panels : [];
    this._recomputeRects();
    this._staticDirty = true;
  }

  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this._staticDirty = true; } }
  setSelection(set) { this.selection = set || new Set(); this._staticDirty = true; }
  /** Called after every pan/zoom so the owner can PERSIST the framing (report
   *  20260725_54). Set by the multiview shell; absent = transient-only. */
  setFramingSink(fn) { this._framingSink = typeof fn === 'function' ? fn : null; }

  setViewTransform(zoom, pan, { persist = true } = {}) {
    this.zoom = zoom || 1;
    this.pan = pan || { x: 0, y: 0 };
    this._recomputeRects();
    this._staticDirty = true;
    // `persist: false` is how the owner RESTORES a saved framing without
    // immediately writing it straight back out again.
    if (persist && this._framingSink) {
      this._framingSink({ zoom: this.zoom, panX: this.pan.x, panY: this.pan.y });
    }
  }
  setFocusPanel(id) { if (id !== this.focusPanel) { this.focusPanel = id; this._recomputeRects(); this._staticDirty = true; } }
  fit() { this.setViewTransform(1, { x: 0, y: 0 }); }

  /** Content bbox of each ACTIVE panel in design units, with its sub-rect —
   *  the input `fitFramingFor` solves against. Includes each pixel's glyph
   *  half-size, so a fit never clips a dot's edge off. */
  contentBoxes() {
    const active = this._activePanels();
    const out = [];
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const rect = this._rects[i];
      if (!rect || !p.pixels || !p.pixels.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of p.pixels) {
        const hx = (q.sizeX || 0) / 2, hy = (q.sizeY || 0) / 2;
        minX = Math.min(minX, q.cx - hx); maxX = Math.max(maxX, q.cx + hx);
        minY = Math.min(minY, q.cy - hy); maxY = Math.max(maxY, q.cy + hy);
      }
      if (!Number.isFinite(minX)) continue;
      out.push({ rect, design: p.design || { w: 1, h: 1 }, box: { minX, minY, maxX, maxY } });
    }
    return out;
  }

  /**
   * Fit this pane's content into the part of it that no other UI covers
   * (operator order, 2026-07-30). `obstructions` are pane-local CSS-px rects
   * measured by the caller from the live DOM — never assumed, because the split
   * divider moves and panels are resizable. Persists through the normal
   * framing sink, so the fit is remembered like any pan/zoom.
   *
   * @returns {{zoom, pan, free, clamped, obstructed:number}|null}
   */
  fitToVisible(obstructions = [], zoomRange = { min: 0.3, max: 8 }) {
    const boxes = this.contentBoxes();
    if (!boxes.length) return null;
    const pane = { x: 0, y: 0, w: this.cssW, h: this.cssH };
    const free = unobstructedRect(pane, obstructions);
    const r = fitFramingFor(boxes, free, zoomRange);
    this.setViewTransform(r.zoom, r.pan);
    return { ...r, free, obstructed: (obstructions || []).length };
  }

  resize() {
    if (!this.canvas) return;
    const cssW = this.canvas.clientWidth || 0;
    const cssH = this.canvas.clientHeight || 0;
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const bw = Math.round(cssW * this.dpr);
    const bh = Math.round(cssH * this.dpr);
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    if (this.static) {
      if (this.static.width !== bw) this.static.width = bw;
      if (this.static.height !== bh) this.static.height = bh;
    }
    this.cssW = cssW; this.cssH = cssH;
    this._recomputeRects();
    this._staticDirty = true;
  }

  // Panels the pane is currently showing (focus-maximize collapses to one).
  _activePanels() {
    if (this.focusPanel) {
      const one = this.panels.find((p) => p.id === this.focusPanel);
      if (one) return [one];
    }
    return this.panels;
  }

  _recomputeRects() {
    const active = this._activePanels();
    this._rects = panelSubRects(active, this.cssW, this.cssH, active.length > 1 ? 8 : 0);
    this._xforms = new Map();
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const rect = this._rects[i];
      this._xforms.set(p.id, panelTransform(p.design || { w: 1, h: 1 }, rect, this.zoom, this.pan));
    }
  }

  // ── Static layer: bg + dark off-bezels + error banners ──────────────────
  _drawStatic() {
    if (!this.sctx) return;
    const ctx = this.sctx;
    const W = this.static.width, H = this.static.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const active = this._activePanels();
    for (let i = 0; i < active.length; i++) {
      const panel = active[i];
      const rect = this._rects[i];
      const xf = this._xforms.get(panel.id);
      if (panel.error) { this._drawError(ctx, rect, panel); continue; }
      if (!xf || !panel.pixels) continue;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = BEZEL_FILL;
      ctx.strokeStyle = BEZEL_STROKE;
      ctx.lineWidth = 1 / xf.scale;
      for (const p of panel.pixels) {
        this._shape(ctx, xf, p.cx, p.cy, p.sizeX * 0.96, p.sizeY * 0.96, p.shape, p.rot);
        ctx.fill();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._staticDirty = false;
  }

  _drawError(ctx, rect, panel) {
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ERR_BG;
    const bh = 26 * d;
    ctx.fillRect(rect.x * d, (rect.y + rect.h / 2 - 13) * d, rect.w * d, bh);
    ctx.fillStyle = ERR_FG;
    ctx.font = `${12 * d}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = panel.label || panel.id || 'panel';
    ctx.fillText(`⚠ ${label}: ${panel.error}`, (rect.x + rect.w / 2) * d, (rect.y + rect.h / 2) * d);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Draw a pixel's shape in screen space given the panel transform. Uses the
  // fillRect fast path for unrotated squares (bars/strands/TE grid — the vast
  // majority); circles / rotated shapes take the path route.
  _shape(ctx, xf, cx, cy, sx, sy, shape, rot) {
    const x = cx * xf.scale + xf.ox;
    const y = cy * xf.scale + xf.oy;
    const w = sx * xf.scale, h = sy * xf.scale;
    // Degenerate size (zero-area pane before layout settles) → empty path, so
    // the caller's fill/stroke is a harmless no-op and never throws.
    if (!(w > 0) || !(h > 0)) { ctx.beginPath(); return; }
    if (shape !== 'circle' && !rot) {
      ctx.beginPath();
      ctx.rect(x - w / 2, y - h / 2, w, h);
      return;
    }
    const rad = (rot || 0) * Math.PI / 180;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, h / 2, rad, 0, Math.PI * 2);
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  // ── Per-frame paint (the registered pane painter) ───────────────────────
  paint(colorBuf, list, _version) {
    if (!this.canvas || !this.ctx) return;
    if (!(this.canvas.width > 0) || !(this.canvas.height > 0)) return;  // not laid out yet
    this.lastList = list;
    if (this._staticDirty) this._drawStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.static && this.static.width > 0 && this.static.height > 0) ctx.drawImage(this.static, 0, 0);

    const active = this._activePanels();
    for (let i = 0; i < active.length; i++) {
      const panel = active[i];
      if (panel.error || !panel.pixels || !panel.pixels.length) continue;
      const xf = this._xforms.get(panel.id);
      if (!xf) continue;
      let lastStyle = null;
      for (const p of panel.pixels) {
        const c = bufColor(colorBuf, p.gi);
        if (!c) continue;
        const [r, g, b] = c;
        if (!(r + g + b > OFF_EPS)) continue;
        const style = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
        if (style !== lastStyle) { ctx.fillStyle = style; lastStyle = style; }
        this._shape(ctx, xf, p.cx, p.cy, p.sizeX, p.sizeY, p.shape, p.rot);
        ctx.fill();
      }
      if (this.mode === 'edit') this._drawSelection(ctx, panel, xf);
    }
  }

  _drawSelection(ctx, panel, xf) {
    if (!this.selection.size) return;
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = Math.max(1, 1.5 * this.dpr);
    for (const p of panel.pixels) {
      if (!p.fixKey || !this.selection.has(p.fixKey)) continue;
      this._shape(ctx, xf, p.cx, p.cy, p.sizeX + 2, p.sizeY + 2, p.shape, p.rot);
      ctx.stroke();
    }
  }

  // ── Hit testing (for status strip / interaction) ────────────────────────

  /** Map a CSS-pixel client point to { panelId, x, y } in that panel's design
   *  space, or null if the point is outside every panel. */
  clientToContent(cssX, cssY) {
    for (let i = 0; i < this._rects.length; i++) {
      const r = this._rects[i];
      if (cssX < r.x || cssX > r.x + r.w || cssY < r.y || cssY > r.y + r.h) continue;
      const xf = this._xforms.get(r.id);
      if (!xf) continue;
      return { panelId: r.id, x: (cssX - xf.ox) / xf.scale, y: (cssY - xf.oy) / xf.scale };
    }
    return null;
  }

  /** Nearest pixel to a client point (within ~its size), or null. */
  pixelAt(cssX, cssY) {
    const hit = this.clientToContent(cssX, cssY);
    if (!hit) return null;
    const panel = this.panels.find((p) => p.id === hit.panelId);
    if (!panel || !panel.pixels) return null;
    let best = null, bestD = Infinity;
    for (const p of panel.pixels) {
      const d = Math.hypot(p.cx - hit.x, p.cy - hit.y);
      const rad = Math.max(p.sizeX, p.sizeY);
      if (d < rad && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  dispose() {
    this.canvas = null; this.ctx = null;
    this.panels = []; this._xforms.clear(); this._rects = [];
  }
}
