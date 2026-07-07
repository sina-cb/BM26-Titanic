/**
 * pixel_map_panel.js — Modern (Preact) 2D Pixel Map window.
 *
 * A FloatingPanel hosting a Canvas 2D live pixel-art map of the model, colored
 * from the same per-frame data as the 3D dots (via onPixelFrame). Follows the
 * sACN-monitor panel conventions: a signal store + FloatingPanel rendered into
 * a host div, registered with panel_layout for geometry persistence.
 *
 * Edit gestures update the view visually on every input and persist once per
 * gesture (onChange / gesture-end) — see pixel_map_interaction + the store.
 */

import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';

import { params } from '../../core/state.js';
import { FloatingPanel } from './floating_panel.js';
import { PixelMapRenderer } from '../pixel_map/pixel_map_renderer.js';
import {
  store, syncSubscription, showPixelMap, loadFromParams, reseedAll,
  registerPixelMapGlobals,
} from '../pixel_map/pixel_map_store.js';
import { attachPixelMapInteraction } from '../pixel_map/pixel_map_interaction.js';

const PANEL_ID = 'pixel-map-panel';
const normRot = (r) => ((r + 180) % 360 + 360) % 360 - 180;

function relayout() {
  if (store.renderer) store.renderer.setLayout(store.clusters, store.placements, store.typeOverrides, store.canvas);
  store.editTick.value++;
}
function commit() { if (store.__markEdited) store.__markEdited(); }

function Toolbar() {
  const mode = store.mode.value;
  const setMode = (m) => { store.mode.value = m; };
  return html`
    <div class="pm-toolbar">
      <div class="pm-seg">
        <button class=${`pm-seg-btn${mode === 'view' ? ' active' : ''}`} onClick=${() => setMode('view')}>VIEW</button>
        <button class=${`pm-seg-btn${mode === 'edit' ? ' active' : ''}`} onClick=${() => setMode('edit')}>EDIT</button>
      </div>
      <span class="pm-count">${store.fixtureCount.value} fix · ${store.pixelCount.value} px</span>
      <button class="pm-mini" title="Seed projection plane — click to cycle + reseed"
              onClick=${() => reseedAll(store.plane.value === 'top' ? 'front' : store.plane.value === 'front' ? 'auto' : 'top')}>
        plane: ${store.plane.value}
      </button>
      ${mode === 'edit' ? html`<button class="pm-mini pm-reset" onClick=${() => reseedAll()}>Reset seed</button>` : null}
    </div>
  `;
}

function EditControls() {
  if (store.mode.value !== 'edit') return null;
  const t = store.typeOverrides;
  const cur = (type, field, dflt) => (t[type] && typeof t[type][field] === 'number' ? t[type][field] : dflt);
  const setTypeVisual = (type, field, v) => {
    store.typeOverrides = { ...store.typeOverrides, [type]: { ...(store.typeOverrides[type] || {}), [field]: v } };
    relayout();
  };
  const row = (label, type, hasGap, sxD, syD, gapD) => html`
    <div class="pm-typerow">
      <span class="pm-typelabel">${label}</span>
      <label title="pixel width — along the fixture's run (size_x)">W <input type="range" min="4" max="60" step="1"
        value=${cur(type, 'sizeX', sxD)}
        onInput=${(e) => setTypeVisual(type, 'sizeX', +e.target.value)} onChange=${commit} /></label>
      <label title="pixel height — across the run (size_y)">H <input type="range" min="4" max="60" step="1"
        value=${cur(type, 'sizeY', syD)}
        onInput=${(e) => setTypeVisual(type, 'sizeY', +e.target.value)} onChange=${commit} /></label>
      ${hasGap ? html`<label>gap <input type="range" min="0" max="16" step="1" value=${cur(type, 'gap', gapD)}
        onInput=${(e) => setTypeVisual(type, 'gap', +e.target.value)} onChange=${commit} /></label>` : null}
    </div>`;
  const setCanvas = (field, v) => {
    store.canvas = { ...store.canvas, [field]: Math.max(200, v | 0) };
    if (store.renderer) { store.renderer.setLayout(store.clusters, store.placements, store.typeOverrides, store.canvas); store.renderer.resize(); }
    commit();
  };
  return html`
    <div class="pm-edit-controls">
      ${row('Bars', 'ShehdsBar', true, 13, 13, 3)}
      ${row('Vintage', 'VintageLed', true, 15, 15, 5)}
      ${row('Pars', 'UkingPar', false, 24, 24, 0)}
      <div class="pm-typerow">
        <span class="pm-typelabel">Canvas</span>
        <label>W <input type="number" class="pm-num" value=${store.canvas.w} onChange=${(e) => setCanvas('w', +e.target.value)} /></label>
        <label>H <input type="number" class="pm-num" value=${store.canvas.h} onChange=${(e) => setCanvas('h', +e.target.value)} /></label>
      </div>
    </div>
  `;
}

function Inspector() {
  if (store.mode.value !== 'edit') return null;
  const sel = store.selection.value;
  if (sel.size !== 1) return null;
  store.editTick.value; // subscribe so drags refresh the fields live
  const key = [...sel][0];
  const pl = store.placements.get(key);
  if (!pl) return null;
  const setField = (f, v, doCommit) => {
    pl[f] = f === 'rot' ? normRot(v) : Math.round(v * 2) / 2;
    relayout();
    if (doCommit) commit();
  };
  return html`
    <div class="pm-inspector">
      <div class="pm-insp-name">${key}</div>
      <div class="pm-typerow">
        <label>X <input type="number" class="pm-num" step="0.5" value=${pl.x}
          onInput=${(e) => setField('x', +e.target.value, false)} onChange=${(e) => setField('x', +e.target.value, true)} /></label>
        <label>Y <input type="number" class="pm-num" step="0.5" value=${pl.y}
          onInput=${(e) => setField('y', +e.target.value, false)} onChange=${(e) => setField('y', +e.target.value, true)} /></label>
      </div>
      <div class="pm-typerow">
        <span class="pm-typelabel">Rot</span>
        <input type="range" min="-180" max="180" step="15" value=${pl.rot || 0}
          onInput=${(e) => setField('rot', +e.target.value, false)} onChange=${(e) => setField('rot', +e.target.value, true)} />
        <input type="number" class="pm-num" step="1" value=${Math.round(pl.rot || 0)}
          onInput=${(e) => setField('rot', +e.target.value, false)} onChange=${(e) => setField('rot', +e.target.value, true)} />°
      </div>
    </div>
  `;
}

function StatusStrip() {
  const hover = store.hover.value;
  const fit = () => { store.zoom.value = 1; store.pan.value = { x: 0, y: 0 }; };
  return html`
    <div class="pm-status">
      <span class="pm-swatch" style=${`background:${hover ? hover.hex : 'transparent'}`}></span>
      <span class="pm-status-txt">${hover
        ? `${hover.name}  ${hover.hex}`
        : (store.mode.value === 'edit'
            ? 'drag: box-select · dbl-click: group · Q/E: rotate · space/middle-drag: pan'
            : '—')}</span>
      <span class="pm-status-right">
        <span class="pm-zoom">${Math.round(store.zoom.value * 100)}%</span>
        <button class="pm-mini" onClick=${fit}>Fit</button>
      </span>
    </div>
  `;
}

function PixelMapPanel() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new PixelMapRenderer();
    renderer.attach(canvas);
    renderer.setMode(store.mode.value);
    store.renderer = renderer;

    const detachInteraction = attachPixelMapInteraction(canvas, renderer, store);
    const disposeMode = effect(() => { renderer.setMode(store.mode.value); });
    const disposeSel = effect(() => { renderer.setSelection(store.selection.value); });
    const disposeXf = effect(() => { renderer.setViewTransform(store.zoom.value, store.pan.value); });
    const disposeSub = effect(() => { store.visible.value; store.collapsed.value; syncSubscription(); });
    const disposeShow = effect(() => {
      if (store.visible.value && !store.collapsed.value) requestAnimationFrame(() => renderer.resize());
    });

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas);
    const onWinResize = () => renderer.resize();
    window.addEventListener('resize', onWinResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      detachInteraction();
      disposeMode(); disposeSel(); disposeXf(); disposeSub(); disposeShow();
      if (store.renderer === renderer) store.renderer = null;
    };
  }, []);

  return html`
    <${FloatingPanel}
      id=${PANEL_ID}
      headerClass="pm-header" titleClass="pm-title"
      title="🧩 Pixel Map"
      hidden=${!store.visible.value}
      collapsed=${store.collapsed.value}
      onToggleCollapse=${() => { store.collapsed.value = !store.collapsed.value; }}
      headerExtra=${html`<span class=${`pm-mode-chip ${store.mode.value}`}>${store.mode.value === 'edit' ? 'EDIT' : 'VIEW'}</span>`}
    >
      <div class=${`pm-body ${store.mode.value}`}>
        <${Toolbar} />
        <${EditControls} />
        <${Inspector} />
        <div class="pm-canvas-host">
          <canvas ref=${canvasRef} class="pm-canvas" tabindex="0"></canvas>
        </div>
        <${StatusStrip} />
      </div>
    <//>
  `;
}

export function initPixelMapPanel() {
  registerPixelMapGlobals();
  loadFromParams();
  const host = document.createElement('div');
  host.id = 'modern-pixel-map';
  document.body.appendChild(host);
  render(html`<${PixelMapPanel} />`, host);

  // Full-screen, profile-bound viewport — NOT a floating panel (no
  // registerPanel/geometry). ?pixelmap=view|edit only picks the initial mode;
  // showPixelMap() is gated on the 2d_pixels profile.
  const pmParam = new URLSearchParams(location.search).get('pixelmap');
  if (pmParam === 'view' || pmParam === 'edit') store.mode.value = pmParam;
  if (params.lightingProfile === '2d_pixels') showPixelMap(true);
}
