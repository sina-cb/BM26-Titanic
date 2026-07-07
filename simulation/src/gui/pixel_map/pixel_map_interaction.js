/**
 * pixel_map_interaction.js — pointer/keyboard input for the 2D Pixel Map.
 *
 * View mode: left-drag pans; hover updates the status strip. Edit mode:
 * drag a fixture to move (8u snap, Alt bypass), drag the rotation handle to
 * rotate (15° snap, Alt=1°), Q/E rotate, arrows nudge, drag empty space to
 * pan, click empty to clear selection. Space/middle-drag always pans; wheel
 * zooms to the cursor. Panning/zoom are per-session view transform (never
 * persisted). Layout edits persist once per gesture (commitEdit), not per
 * mousemove — a continuous relayout would reset the autosave debounce forever.
 * All canvas key/pointer events are isolated so the 3D scene shortcuts
 * (T/R/S/M/Delete…) never fire while editing here.
 */

import { hitTestFixture, fixturesInRect, fixturesInGroup } from './pixel_map_layout.js';

const DEAD = 3; // px of movement before a press counts as a drag (not a click)

export function attachPixelMapInteraction(canvas, renderer, store) {
  let drag = null;      // fixture move: { startDesign, origins:Map }
  let rotDrag = null;   // { key, pl, startRot, startAngle }
  let panning = null;   // { sx, sy, ox, oy }
  let marquee = null;   // box-select: { x0, y0, add }
  let pendingClear = false;
  let downX = 0, downY = 0, moved = false;
  let spaceDown = false;

  const rectPt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  const toDesign = (e) => { const { cx, cy } = rectPt(e); return renderer.clientToDesign(cx, cy); };

  const relayoutVisual = () => {
    renderer.setLayout(store.clusters, store.placements, store.typeOverrides, store.canvas);
    store.editTick.value++;
  };
  const commitEdit = () => { if (store.__markEdited) store.__markEdited(); };
  const setSelection = (keys) => { store.selection.value = new Set(keys); };

  function clampPan(p, z) {
    const scale = renderer.fit * z;
    const w = renderer.design.w * scale, h = renderer.design.h * scale;
    const cx0 = (renderer.cssW - w) / 2, cy0 = (renderer.cssH - h) / 2;
    const M = 80; // ≥80 CSS px of the design rect always visible
    return {
      x: Math.max(M - w - cx0, Math.min(renderer.cssW - M - cx0, p.x)),
      y: Math.max(M - h - cy0, Math.min(renderer.cssH - M - cy0, p.y)),
    };
  }
  const normRot = (rot) => ((rot + 180) % 360 + 360) % 360 - 180;

  const onMove = (e) => {
    const p = rectPt(e);
    if (!moved && Math.hypot(p.cx - downX, p.cy - downY) >= DEAD) moved = true;
    const d = renderer.clientToDesign(p.cx, p.cy);

    if (panning) {
      store.pan.value = clampPan({ x: panning.ox + (p.cx - panning.sx), y: panning.oy + (p.cy - panning.sy) }, store.zoom.value);
      return;
    }
    if (marquee) {
      renderer.setMarquee({ x0: marquee.x0, y0: marquee.y0, x1: d.x, y1: d.y });
      return;
    }
    if (rotDrag) {
      const a = Math.atan2(d.y - rotDrag.pl.y, d.x - rotDrag.pl.x);
      let rot = rotDrag.startRot + (a - rotDrag.startAngle) * 180 / Math.PI;
      rot = e.altKey ? Math.round(rot) : Math.round(rot / 15) * 15;
      rotDrag.pl.rot = normRot(rot);
      relayoutVisual();
      return;
    }
    if (drag) {
      const snap = !e.altKey;
      const dx = d.x - drag.startDesign.x, dy = d.y - drag.startDesign.y;
      for (const [key, o] of drag.origins) {
        let nx = o.x + dx, ny = o.y + dy;
        if (snap) { nx = Math.round(nx / 8) * 8; ny = Math.round(ny / 8) * 8; }
        const pl = store.placements.get(key);
        if (pl) { pl.x = Math.round(nx * 2) / 2; pl.y = Math.round(ny * 2) / 2; }
      }
      relayoutVisual();
      return;
    }

    // Idle hover: status-strip color + edit-mode hull highlight.
    const px = renderer.pixelAt(d.x, d.y);
    const col = px ? renderer.colorOf(px.gi) : null;
    store.hover.value = col ? { name: col.name, hex: col.hex } : null;
    if (store.mode.value === 'edit') {
      const hov = hitTestFixture(store.clusters, store.placements, store.typeOverrides, d.x, d.y);
      renderer.setHover(hov ? hov.fixKey : null);
      canvas.style.cursor = hov ? 'grab' : 'default';
    } else {
      canvas.style.cursor = 'grab';
    }
  };

  const startPan = (p) => { panning = { sx: p.cx, sy: p.cy, ox: store.pan.value.x, oy: store.pan.value.y }; canvas.style.cursor = 'grabbing'; };

  const onDown = (e) => {
    canvas.focus();
    e.stopPropagation();
    const p = rectPt(e);
    downX = p.cx; downY = p.cy; moved = false; pendingClear = false;
    const d = renderer.clientToDesign(p.cx, p.cy);

    // Space / middle button → pan (overrides everything, even over a fixture).
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(p); e.preventDefault(); return; }
    if (e.button !== 0) return;

    if (store.mode.value === 'edit') {
      // Rotation handle first.
      const h = renderer._rotHandle;
      if (h && Math.hypot(d.x - h.x, d.y - h.y) <= h.r * 1.8) {
        const pl = store.placements.get(h.fixKey);
        if (pl) { rotDrag = { key: h.fixKey, pl, startRot: pl.rot || 0, startAngle: Math.atan2(d.y - pl.y, d.x - pl.x) }; canvas.style.cursor = 'grabbing'; return; }
      }
      const hit = hitTestFixture(store.clusters, store.placements, store.typeOverrides, d.x, d.y);
      if (hit) {
        let sel = new Set(store.selection.value);
        if (e.shiftKey) { sel.has(hit.fixKey) ? sel.delete(hit.fixKey) : sel.add(hit.fixKey); }
        else if (!sel.has(hit.fixKey)) { sel = new Set([hit.fixKey]); }
        setSelection([...sel]);
        const origins = new Map();
        for (const key of sel) { const pl = store.placements.get(key); if (pl) origins.set(key, { x: pl.x, y: pl.y }); }
        drag = { startDesign: d, origins };
        canvas.style.cursor = 'grabbing';
        return;
      }
      // Empty edit space → box-select (marquee). Pan is space/middle-drag.
      // A click with no movement clears the selection (unless Shift).
      pendingClear = !e.shiftKey;
      marquee = { x0: d.x, y0: d.y, add: e.shiftKey };
      return;
    }
    // View mode → left-drag pans.
    startPan(p);
  };

  const onUp = () => {
    if (rotDrag) { if (moved) commitEdit(); rotDrag = null; }
    if (drag) { if (moved) commitEdit(); drag = null; }
    if (marquee) {
      if (moved) {
        const p = renderer.marquee;
        const inRect = p ? fixturesInRect(store.clusters, store.placements, store.typeOverrides, p.x0, p.y0, p.x1, p.y1) : [];
        const next = marquee.add ? new Set([...store.selection.value, ...inRect]) : new Set(inRect);
        setSelection([...next]);
      } else if (pendingClear) {
        setSelection([]);
      }
      marquee = null; renderer.setMarquee(null); pendingClear = false;
    }
    if (panning) { panning = null; }
    canvas.style.cursor = store.mode.value === 'edit' ? 'default' : 'grab';
  };

  const onWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { cx, cy } = rectPt(e);
    const before = renderer.clientToDesign(cx, cy);
    const z = Math.max(0.5, Math.min(8, store.zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const scale = renderer.fit * z;
    store.zoom.value = z;
    store.pan.value = clampPan({
      x: cx - before.x * scale - (renderer.cssW - renderer.design.w * scale) / 2,
      y: cy - before.y * scale - (renderer.cssH - renderer.design.h * scale) / 2,
    }, z);
  };

  const onDblClick = (e) => {
    e.stopPropagation();
    const d = toDesign(e);
    const hit = hitTestFixture(store.clusters, store.placements, store.typeOverrides, d.x, d.y);
    if (hit && store.mode.value === 'edit' && hit.group) {
      // Select the whole logical group (Left Vintage, Back Bar, …) for group move.
      setSelection(fixturesInGroup(store.clusters, hit.group));
    } else if (!hit) {
      store.zoom.value = 1; store.pan.value = { x: 0, y: 0 };   // Fit
    }
  };

  const rotateSelection = (deg) => {
    let any = false;
    for (const key of store.selection.value) {
      const pl = store.placements.get(key);
      if (pl) { pl.rot = normRot((pl.rot || 0) + deg); any = true; }
    }
    if (any) { relayoutVisual(); commitEdit(); }
  };
  const nudge = (dx, dy) => {
    let any = false;
    for (const key of store.selection.value) {
      const pl = store.placements.get(key);
      if (pl) { pl.x += dx; pl.y += dy; any = true; }
    }
    if (any) { relayoutVisual(); commitEdit(); }
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === ' ') { spaceDown = true; return; }
    if (store.mode.value !== 'edit') return;
    const step = e.shiftKey ? 8 : 1;
    switch (e.key) {
      case 'q': case 'Q': rotateSelection(e.shiftKey ? -1 : -15); break;
      case 'e': case 'E': rotateSelection(e.shiftKey ? 1 : 15); break;
      case 'ArrowLeft': nudge(-step, 0); e.preventDefault(); break;
      case 'ArrowRight': nudge(step, 0); e.preventDefault(); break;
      case 'ArrowUp': nudge(0, -step); e.preventDefault(); break;
      case 'ArrowDown': nudge(0, step); e.preventDefault(); break;
      case 'Escape': setSelection([]); break;
      default: break;
    }
  };
  const onKeyUp = (e) => { e.stopPropagation(); if (e.key === ' ') spaceDown = false; };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);

  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
  };
}
