/**
 * pixel_map_interaction.js — per-pane pointer/keyboard input for the 2D Pixel
 * Map MULTIVIEW (S4). Each pane's canvas gets its own handler bound to that
 * pane's PixelMapPaneView + an edit context (from the store) that reads/writes
 * the pane's BOUND VIEW placements.
 *
 * View mode: left-drag pans, wheel zooms to the cursor, hover updates the
 * status strip, double-click on a multi-panel pane toggles panel focus-maximize
 * (else fits). Edit mode: click a fixture to select (Shift toggles / adds),
 * drag to move (8u snap, Alt bypass), Q/E rotate the selection (15° / Alt 1°),
 * arrows nudge, Escape/empty-click clears. Layout edits persist once per gesture
 * (ctx.commit), never per pointermove — a continuous relayout would reset the
 * autosave debounce forever.
 *
 * EVERY key/pointer event on the pane canvas is stopPropagation'd so the 3D
 * scene shortcuts (T/R/S/M/…) can never fire while a pane has focus.
 */

const DEAD = 3; // px of movement before a press counts as a drag (not a click)
const ZOOM_MIN = 0.3, ZOOM_MAX = 8;

const normRot = (r) => ((r + 180) % 360 + 360) % 360 - 180;

/**
 * Attach interaction to one pane canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {import('./pixel_map_pane_view.js').PixelMapPaneView} paneView
 * @param {object} ctx  edit context (see store.makeEditCtx)
 * @returns {() => void} detach
 */
export function attachPaneInteraction(canvas, paneView, ctx) {
  let panning = null;   // { sx, sy, ox, oy }
  let drag = null;      // fixture move: { start:{x,y}, origins:Map<fixKey,{x,y}> }
  let downX = 0, downY = 0, moved = false;
  let spaceDown = false;

  if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');

  const rectPt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };

  const onMove = (e) => {
    const p = rectPt(e);
    if (!moved && Math.hypot(p.cx - downX, p.cy - downY) >= DEAD) moved = true;

    if (panning) {
      paneView.setViewTransform(paneView.zoom, {
        x: panning.ox + (p.cx - panning.sx),
        y: panning.oy + (p.cy - panning.sy),
      });
      return;
    }
    if (drag) {
      const hit0 = paneView.clientToContent(p.cx, p.cy);
      if (hit0) {
        const snap = !e.altKey;
        let dx = hit0.x - drag.start.x, dy = hit0.y - drag.start.y;
        for (const [key, o] of drag.origins) {
          let nx = o.x + dx, ny = o.y + dy;
          if (snap) { nx = Math.round(nx / 8) * 8; ny = Math.round(ny / 8) * 8; }
          const cur = ctx.getPlacement(key) || o;
          ctx.setPlacement(key, { x: Math.round(nx * 2) / 2, y: Math.round(ny * 2) / 2, rot: cur.rot || 0 });
        }
        ctx.rebuild();
      }
      return;
    }

    // Idle hover: status-strip color.
    const px = paneView.pixelAt(p.cx, p.cy);
    ctx.setHover(px ? ctx.colorOf(px.gi) : null);
    canvas.style.cursor = (ctx.getMode() === 'edit' && px) ? 'grab' : (ctx.getMode() === 'edit' ? 'default' : 'grab');
  };

  const startPan = (p) => {
    panning = { sx: p.cx, sy: p.cy, ox: paneView.pan.x, oy: paneView.pan.y };
    canvas.style.cursor = 'grabbing';
  };

  const onDown = (e) => {
    canvas.focus();
    e.stopPropagation();
    const p = rectPt(e);
    downX = p.cx; downY = p.cy; moved = false;

    // Space / middle button → pan (overrides everything).
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(p); e.preventDefault(); return; }
    if (e.button !== 0) return;

    if (ctx.getMode() === 'edit') {
      ctx.materialize();                       // ensure every fixture has a stored anchor
      const px = paneView.pixelAt(p.cx, p.cy);
      if (px && px.fixKey) {
        let sel = new Set(ctx.getSelection());
        if (e.shiftKey) { sel.has(px.fixKey) ? sel.delete(px.fixKey) : sel.add(px.fixKey); }
        else if (!sel.has(px.fixKey)) sel = new Set([px.fixKey]);
        ctx.setSelection(sel);
        const start = paneView.clientToContent(p.cx, p.cy);
        const origins = new Map();
        for (const key of sel) { const pl = ctx.getPlacement(key); if (pl) origins.set(key, { x: pl.x, y: pl.y }); }
        if (start) drag = { start, origins };
        canvas.style.cursor = 'grabbing';
        return;
      }
      // Empty edit space → left-drag pans; a click clears the selection.
      if (!e.shiftKey) ctx.setSelection(new Set());
      startPan(p);
      return;
    }
    // View mode → left-drag pans.
    startPan(p);
  };

  const onUp = () => {
    if (drag) { if (moved) ctx.commit(); drag = null; }
    if (panning) panning = null;
    canvas.style.cursor = ctx.getMode() === 'edit' ? 'default' : 'grab';
  };

  const onWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { cx, cy } = rectPt(e);
    const before = paneView.clientToContent(cx, cy);       // design point under cursor
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, paneView.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    paneView.setViewTransform(z, paneView.pan);            // recomputes xforms
    if (before) {
      const xf = paneView._xforms.get(before.panelId);      // where the point lands now
      if (xf) {
        const sx = before.x * xf.scale + xf.ox;
        const sy = before.y * xf.scale + xf.oy;
        paneView.setViewTransform(z, { x: paneView.pan.x + (cx - sx), y: paneView.pan.y + (cy - sy) });
      }
    }
  };

  const onDblClick = (e) => {
    e.stopPropagation();
    const p = rectPt(e);
    const hit = paneView.clientToContent(p.cx, p.cy);
    if (paneView.panels.length > 1 && hit) {
      // Click-to-focus maximize of a panel section (design §2.3).
      paneView.setFocusPanel(paneView.focusPanel === hit.panelId ? null : hit.panelId);
    } else {
      paneView.fit();
    }
  };

  const rotateSelection = (deg) => {
    let any = false;
    for (const key of ctx.getSelection()) {
      const pl = ctx.getPlacement(key);
      if (pl) { ctx.setPlacement(key, { x: pl.x, y: pl.y, rot: normRot((pl.rot || 0) + deg) }); any = true; }
    }
    if (any) { ctx.rebuild(); ctx.commit(); }
  };
  const nudge = (dx, dy) => {
    let any = false;
    for (const key of ctx.getSelection()) {
      const pl = ctx.getPlacement(key);
      if (pl) { ctx.setPlacement(key, { x: pl.x + dx, y: pl.y + dy, rot: pl.rot || 0 }); any = true; }
    }
    if (any) { ctx.rebuild(); ctx.commit(); }
  };

  const onKeyDown = (e) => {
    e.stopPropagation();                 // never leak to the 3D scene shortcuts
    if (e.key === ' ') { spaceDown = true; return; }
    if (ctx.getMode() !== 'edit') return;
    const step = e.shiftKey ? 8 : 1;
    switch (e.key) {
      case 'q': case 'Q': rotateSelection(e.shiftKey ? -1 : -15); break;
      case 'e': case 'E': rotateSelection(e.shiftKey ? 1 : 15); break;
      case 'ArrowLeft':  if (!e.altKey && !e.ctrlKey) { nudge(-step, 0); e.preventDefault(); } break;
      case 'ArrowRight': if (!e.altKey && !e.ctrlKey) { nudge(step, 0); e.preventDefault(); } break;
      case 'ArrowUp':    if (!e.altKey && !e.ctrlKey) { nudge(0, -step); e.preventDefault(); } break;
      case 'ArrowDown':  if (!e.altKey && !e.ctrlKey) { nudge(0, step); e.preventDefault(); } break;
      case 'Escape': ctx.setSelection(new Set()); break;
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
