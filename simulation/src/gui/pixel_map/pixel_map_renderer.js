/**
 * pixel_map_renderer.js — Canvas 2D renderer for the 2D Pixel Map.
 *
 * Canvas 2D (not WebGL) on purpose: a second GL context would fight the main
 * THREE renderer (real context-loss risk under SwiftShader, see
 * see_the_world.md), and chunky pixel-art + exact gaps are easier in 2D. Glow
 * is a 'lighter' composite pass — NEVER ctx.shadowBlur (catastrophically slow
 * per-shape).
 *
 * Design stance: an output monitor, not a toy. (1) Lit-pixel cores are 100%
 * color-true — no white/tint blended into the core. (2) All chrome is neutral
 * cool-gray hairlines. (3) Exactly one accent — the theme amber --primary —
 * used only for selection/edit affordances.
 *
 * Two layers: a static offscreen canvas (background, vignette, grid, off-bezels,
 * hulls/handles — redrawn only on layout/mode/selection/view change) and the
 * visible canvas (static blit + lit pixel fills every frame). Everything is in
 * fixed "design space"; one setTransform letterboxes it into the DPR-scaled
 * backing store, so pan/zoom/resize are pure re-fits and never mutate layout.
 */

import { entryDisplayRgb } from '../../core/rgbwau_blend.js';
import { clusterBounds, styleFor, clusterPixelPositions } from './pixel_map_layout.js';

const BG           = '#0b0d12';                  // neutral near-black
const GRID_MINOR   = 'rgba(140,160,200,0.05)';   // 8u lines
const GRID_MAJOR   = 'rgba(140,160,200,0.11)';   // 40u lines
const GRID_BORDER  = 'rgba(140,160,200,0.20)';   // design-canvas frame
const BEZEL_FILL   = '#10141c';
const BEZEL_STROKE = 'rgba(255,255,255,0.045)';
const HULL_HOVER   = 'rgba(148,163,190,0.35)';
const SELECT       = '#fabd2f';                  // = --primary
const MONO         = '"Cascadia Code", Consolas, monospace';

export class PixelMapRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.static = document.createElement('canvas');
    this.sctx = this.static.getContext('2d');
    this.design = { w: 900, h: 520 };
    this.mode = 'view';
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.dpr = 1;
    this.cssW = 600; this.cssH = 400;
    this.fit = 1;      // design→css scale (before zoom)
    this.ox = 0; this.oy = 0;
    this.pixels = [];   // flattened [{ gi, cx, cy, size, shape }]
    this.clusters = [];
    this.placements = null;
    this.typeOverrides = null;
    this.selection = new Set();
    this._hoverKey = null;
    this.marquee = null;      // { x0, y0, x1, y1 } design-space box-select overlay
    this._rotHandle = null;   // { fixKey, x, y, r } in design units (single-select edit)
    this._staticDirty = true;
    this.lastList = null;
    this.lastPatches = false;
    this.lastUnpatchedRed = false;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  setLayout(clusters, placements, typeOverrides, design) {
    this.clusters = clusters || [];
    this.placements = placements;
    this.typeOverrides = typeOverrides;
    if (design) this.design = design;
    this._rebuildPixels();
    this._staticDirty = true;
  }

  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this._staticDirty = true; } }
  setSelection(set) { this.selection = set || new Set(); this._staticDirty = true; }
  setMarquee(rect) { this.marquee = rect; }   // drawn on the dynamic layer (no static redraw)
  setHover(key) { if (key !== this._hoverKey) { this._hoverKey = key; this._staticDirty = true; } }
  setViewTransform(zoom, pan) { this.zoom = zoom; this.pan = pan || { x: 0, y: 0 }; if (this.canvas) this._refit(); }

  _rebuildPixels() {
    this.pixels = [];
    if (!this.placements) return;
    for (const c of this.clusters) {
      const pl = this.placements.get(c.fixKey);
      if (!pl) continue;
      const style = styleFor(c.fixtureType, this.typeOverrides);
      for (const p of clusterPixelPositions(c, pl, style)) this.pixels.push(p);
    }
  }

  // Recompute backing store from the CSS box, then refit the design transform.
  resize() {
    if (!this.canvas) return;
    const cssW = this.canvas.clientWidth || 600;
    const cssH = this.canvas.clientHeight || 400;
    this.dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cssW * this.dpr);
    const bh = Math.round(cssH * this.dpr);
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    if (this.static.width !== bw) this.static.width = bw;
    if (this.static.height !== bh) this.static.height = bh;
    this.cssW = cssW; this.cssH = cssH;
    this._refit();
  }

  _refit() {
    this.fit = Math.min(this.cssW / this.design.w, this.cssH / this.design.h);
    const scale = this.fit * this.zoom;
    this.ox = (this.cssW - this.design.w * scale) / 2 + this.pan.x;
    this.oy = (this.cssH - this.design.h * scale) / 2 + this.pan.y;
    this._staticDirty = true;
  }

  _applyTransform(ctx) {
    const scale = this.fit * this.zoom * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, this.ox * this.dpr, this.oy * this.dpr);
  }

  // client point (CSS px relative to canvas) → design space.
  clientToDesign(cx, cy) {
    const scale = this.fit * this.zoom;
    return { x: (cx - this.ox) / scale, y: (cy - this.oy) / scale };
  }

  get _k() { return 1 / (this.fit * this.zoom); }   // 1 device-independent design unit ≈ screen px

  _pathShape(ctx, x, y, sizeX, sizeY, shape, rot) {
    const hx = sizeX / 2, hy = sizeY / 2;
    const rad = (rot || 0) * Math.PI / 180;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(x, y, hx, hy, rad, 0, Math.PI * 2);   // ellipse when sizeX≠sizeY
    } else if (!rad) {
      _roundRect(ctx, x - hx, y - hy, sizeX, sizeY, Math.min(sizeX, sizeY) * 0.18);
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad);                                  // rectangle orients with the fixture
      _roundRect(ctx, -hx, -hy, sizeX, sizeY, Math.min(sizeX, sizeY) * 0.18);
      ctx.restore();
    }
  }

  _drawStatic() {
    const ctx = this.sctx;
    const W = this.static.width, H = this.static.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    // Vignette — pure darkening (never contaminates pixel color).
    const R = Math.hypot(W, H) / 2;
    const vg = ctx.createRadialGradient(W / 2, H / 2, R * 0.55, W / 2, H / 2, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    this._applyTransform(ctx);
    const k = this._k;
    this._rotHandle = null;

    if (this.mode === 'edit') this._drawGrid(ctx, k);

    // Off-bezels: dark sockets so the rig shape reads at blackout. Slightly
    // undersized so a full-size lit core fully covers them (no dark fringe).
    ctx.lineWidth = k;
    ctx.fillStyle = BEZEL_FILL;
    ctx.strokeStyle = BEZEL_STROKE;
    for (const p of this.pixels) {
      this._pathShape(ctx, p.cx, p.cy, p.sizeX * 0.96, p.sizeY * 0.96, p.shape, p.rot);
      ctx.fill();
      ctx.stroke();
    }

    if (this.mode === 'edit' && this.placements) this._drawEditChrome(ctx, k);
    this._staticDirty = false;
  }

  _drawGrid(ctx, k) {
    const { w, h } = this.design;
    const line = (step, style) => {
      ctx.strokeStyle = style; ctx.lineWidth = k;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    };
    line(8, GRID_MINOR);
    line(40, GRID_MAJOR);
    ctx.strokeStyle = GRID_BORDER; ctx.lineWidth = k;
    ctx.strokeRect(0, 0, w, h);
  }

  _drawEditChrome(ctx, k) {
    // Hover hull.
    if (this._hoverKey && !this.selection.has(this._hoverKey)) {
      const c = this.clusters.find((x) => x.fixKey === this._hoverKey);
      const pl = c && this.placements.get(c.fixKey);
      if (pl) {
        const b = clusterBounds(c, pl, styleFor(c.fixtureType, this.typeOverrides));
        ctx.strokeStyle = HULL_HOVER; ctx.lineWidth = k;
        _roundRect(ctx, b.minX - 4, b.minY - 4, b.w + 8, b.h + 8, 5); ctx.stroke();
      }
    }
    // Selected hulls + label chip + rotation handle (single select).
    const selClusters = this.clusters.filter((c) => this.selection.has(c.fixKey));
    for (const c of selClusters) {
      const pl = this.placements.get(c.fixKey);
      if (!pl) continue;
      const b = clusterBounds(c, pl, styleFor(c.fixtureType, this.typeOverrides));
      ctx.strokeStyle = SELECT; ctx.lineWidth = 1.5 * k;
      _roundRect(ctx, b.minX - 4, b.minY - 4, b.w + 8, b.h + 8, 5); ctx.stroke();

      if (selClusters.length === 1) {
        // Label chip (constant screen size).
        ctx.font = `${11 * k}px ${MONO}`;
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(c.fixKey).width;
        const padX = 5 * k, chipH = 16 * k, chipY = b.minY - 4 - chipH - 3 * k;
        ctx.fillStyle = 'rgba(11,13,18,0.85)';
        ctx.strokeStyle = SELECT; ctx.lineWidth = k;
        _roundRect(ctx, b.minX - 4, chipY, tw + padX * 2, chipH, 3 * k);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = SELECT;
        ctx.fillText(c.fixKey, b.minX - 4 + padX, chipY + chipH / 2);
        ctx.textBaseline = 'alphabetic';

        // Rotation handle: stalk + knob above the hull center.
        const hx = (b.minX + b.maxX) / 2;
        const y0 = b.minY - 4, y1 = y0 - 24 * k;
        ctx.strokeStyle = 'rgba(250,189,47,0.6)'; ctx.lineWidth = k;
        ctx.beginPath(); ctx.moveTo(hx, y0); ctx.lineTo(hx, y1); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, y1, 5 * k, 0, Math.PI * 2);
        ctx.fillStyle = SELECT; ctx.fill();
        ctx.strokeStyle = BG; ctx.lineWidth = 1.5 * k; ctx.stroke();
        this._rotHandle = { fixKey: c.fixKey, x: hx, y: y1, r: 5 * k };
      }
    }
  }

  /** Nearest pixel to a design-space point (within ~1× its size), or null. */
  pixelAt(dx, dy) {
    let best = null, bestD = Infinity;
    for (const p of this.pixels) {
      const d = Math.hypot(p.cx - dx, p.cy - dy);
      const r = Math.max(p.sizeX, p.sizeY);
      if (d < r && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Live display color of pixel index gi as {r,g,b,hex,name}, or null. */
  colorOf(gi) {
    if (!this.lastList) return null;
    const entry = this.lastList[gi];
    if (!entry) return null;
    const [r, g, b] = entryDisplayRgb(entry, this.lastPatches, this.lastUnpatchedRed);
    const hex = '#' + [r, g, b].map((v) => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
    return { r, g, b, hex, name: entry.name };
  }

  /** Draw one frame: static blit + live-lit pixels. */
  drawFrame(list, patchesActive, showUnpatchedRed) {
    if (!this.canvas || !this.ctx) return;
    this.lastList = list; this.lastPatches = patchesActive; this.lastUnpatchedRed = showUnpatchedRed;
    if (this._staticDirty) this._drawStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.static, 0, 0);
    if (!list || !this.pixels.length) {
      if (!this.pixels.length) this._noPixelsCaption(ctx);
      return;
    }

    this._applyTransform(ctx);
    const glow = this.mode === 'view';

    const lit = [];
    for (const p of this.pixels) {
      const entry = list[p.gi];
      if (!entry) continue;
      const [r, g, b] = entryDisplayRgb(entry, patchesActive, showUnpatchedRed);
      const luma = 0.30 * r + 0.59 * g + 0.11 * b;
      if (luma < 0.012) continue;
      lit.push({ p, r, g, b, luma });
    }

    // Halo pass (view mode): round, luma-driven bloom — tight on bright pixels,
    // near-nothing on dim ones (no milky low-level wash).
    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const L of lit) {
        const d = Math.max(L.p.sizeX, L.p.sizeY) * (1.35 + 0.65 * L.luma);
        ctx.globalAlpha = 0.08 + 0.14 * L.luma * L.luma;
        ctx.fillStyle = _rgb(L.r, L.g, L.b);
        ctx.beginPath();
        ctx.arc(L.p.cx, L.p.cy, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Core pass: 100% color-true.
    for (const L of lit) {
      ctx.fillStyle = _rgb(L.r, L.g, L.b);
      this._pathShape(ctx, L.p.cx, L.p.cy, L.p.sizeX, L.p.sizeY, L.p.shape, L.p.rot);
      ctx.fill();
      // Quiet glass wink — circles only; bars stay flat/exact.
      if (L.p.shape === 'circle' && L.luma >= 0.35) {
        const sm = Math.min(L.p.sizeX, L.p.sizeY);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(L.p.cx - sm * 0.20, L.p.cy - sm * 0.20, sm * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Marquee box-select overlay (dashed amber, faint fill).
    if (this.marquee) {
      const k = this._k;
      const m = this.marquee;
      const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      ctx.fillStyle = 'rgba(250,189,47,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = SELECT; ctx.lineWidth = k; ctx.setLineDash([4 * k, 3 * k]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  _noPixelsCaption(ctx) {
    ctx.fillStyle = '#5a6472';
    ctx.font = `${13 * this.dpr}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('NO PIXELS', this.canvas.width / 2, this.canvas.height / 2);
    ctx.textAlign = 'start';
  }
}

function _rgb(r, g, b) {
  return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
}

function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
