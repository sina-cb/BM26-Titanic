/**
 * pixel_map_panel.js — Modern (Preact) 2D Pixel Map full-screen viewport.
 *
 * The host chrome for the MULTIVIEW (S4 integration): a top toolbar (VIEW/EDIT
 * mode, live fixture/pixel count, Views manager), the multiview pane grid
 * itself (mounted imperatively into the canvas host), a status strip, and the
 * Views manager overlay. Exclusive to the `2d_pixels` lighting profile — it
 * replaces the (blacked-out) 3D canvas, driven by the headless latch in
 * animate.js and the `M` key.
 *
 * The single onPixelFrame subscription, the "views are data" container, and the
 * recluster/persistence bridges all live in pixel_map_store.js; this file wires
 * them to the S3 multiview shell (mountPixelMapMultiview) via the deps object.
 */

import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';

import { params } from '../../core/state.js';
import { FloatingPanel } from './floating_panel.js';
import { mountPixelMapMultiview } from './pixel_map_multiview_panel.js';
import {
  store, showPixelMap, registerPixelMapGlobals,
  loadViewsFromParams, startPixelMapDataPlane, buildMultiviewDeps,
  addBlankViewOp, duplicateViewOp, removeViewOp, renameViewOp,
} from '../pixel_map/pixel_map_store.js';

const PANEL_ID = 'pixel-map-panel';

// ── Top toolbar: mode, count, Views manager ────────────────────────────────
function Toolbar() {
  const mode = store.mode.value;
  return html`
    <div class="pm-toolbar">
      <div class="pm-seg">
        <button class=${`pm-seg-btn${mode === 'view' ? ' active' : ''}`} onClick=${() => { store.mode.value = 'view'; }}>VIEW</button>
        <button class=${`pm-seg-btn${mode === 'edit' ? ' active' : ''}`} onClick=${() => { store.mode.value = 'edit'; }}>EDIT</button>
      </div>
      <span class="pm-count">${store.fixtureCount.value} fix · ${store.pixelCount.value} px</span>
      <button class="pm-mini pm-reset" title="Add / remove / rename views" onClick=${() => { store.managerOpen.value = true; }}>⧉ Views…</button>
    </div>
  `;
}

function StatusStrip() {
  const hover = store.hover.value;
  return html`
    <div class="pm-status">
      <span class="pm-swatch" style=${`background:${hover ? hover.hex : 'transparent'}`}></span>
      <span class="pm-status-txt">${hover
        ? `${hover.name}  ${hover.hex}`
        : (store.mode.value === 'edit'
            ? 'EDIT — click a fixture, drag to move · Q/E rotate · arrows nudge · shift multi-select · dbl-click panel to maximize'
            : 'VIEW — drag to pan · wheel to zoom · \\ / - split · Tab focus · [ ] cycle view · z zoom pane')}</span>
      <span class="pm-status-right">
        <span class="pm-zoom">${store.mode.value.toUpperCase()}</span>
      </span>
    </div>
  `;
}

// ── Views manager overlay ──────────────────────────────────────────────────
function ViewsManager() {
  store.viewsTick.value;              // subscribe so the list re-renders on change
  if (!store.managerOpen.value) return null;
  const views = store.views ? store.views.views : [];
  let err = null;
  const guard = (fn) => { try { fn(); } catch (e) { store.hover.value = null; alertErr(e); } };
  const alertErr = (e) => { console.warn('[PixelMap] views manager:', e.message); toast(e.message); };
  return html`
    <div class="pm-manager-scrim" onClick=${(e) => { if (e.target === e.currentTarget) store.managerOpen.value = false; }}>
      <div class="pm-manager">
        <div class="pm-manager-head">
          <span class="pm-manager-title">Views</span>
          <button class="pm-mini" onClick=${() => guard(() => addBlankViewOp())}>+ Add</button>
          <button class="pm-mini" style="margin-left:auto" onClick=${() => { store.managerOpen.value = false; }}>Close ✕</button>
        </div>
        <div class="pm-manager-list">
          ${views.map((v) => html`
            <div class="pm-manager-row" key=${v.id}>
              <input class="pm-manager-name" value=${v.label} title=${`id: ${v.id}`}
                     onChange=${(e) => guard(() => renameViewOp(v.id, e.target.value))} />
              <code class="pm-manager-id">${v.id}</code>
              <button class="pm-mini" title="Duplicate" onClick=${() => guard(() => duplicateViewOp(v.id))}>Dup</button>
              <button class="pm-mini pm-del" title="Delete" onClick=${() => guard(() => removeViewOp(v.id))}>Del</button>
            </div>`)}
        </div>
        <div class="pm-manager-hint">
          Selectors are edited in scene YAML (params.pixelMapViews). Rename changes the label; the id stays stable so bound panes keep resolving. Deleting a bound view leaves its pane showing "view removed — pick another".
        </div>
      </div>
    </div>
  `;
}

let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('pm-manager-toast') || (() => {
    const d = document.createElement('div'); d.id = 'pm-manager-toast'; d.className = 'pm-manager-toast';
    document.body.appendChild(d); return d;
  })();
  el.textContent = `⚠ ${msg}`;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

// ── The panel ──────────────────────────────────────────────────────────────
function PixelMapPanel() {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mvHost = null;
    let unmount = null;
    // Mount the multiview only while the viewport is actually shown; unmount on
    // hide/profile-switch so every pane painter unregisters and the frame source
    // tears down its onPixelFrame subscription (zero cost in 3D profiles).
    const dispose = effect(() => {
      const show = store.visible.value && !store.collapsed.value;
      if (show && !unmount) {
        mvHost = document.createElement('div');
        mvHost.className = 'pm-multiview-host';
        host.appendChild(mvHost);
        unmount = mountPixelMapMultiview(mvHost, buildMultiviewDeps());
      } else if (!show && unmount) {
        unmount(); unmount = null;
        if (mvHost && mvHost.parentNode) mvHost.parentNode.removeChild(mvHost);
        mvHost = null;
      }
    });
    return () => {
      dispose();
      if (unmount) unmount();
      if (mvHost && mvHost.parentNode) mvHost.parentNode.removeChild(mvHost);
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
        <div class="pm-canvas-host" ref=${hostRef}></div>
        <${StatusStrip} />
        <${ViewsManager} />
      </div>
    <//>
  `;
}

export function initPixelMapPanel() {
  registerPixelMapGlobals();
  loadViewsFromParams();       // build container + migrate legacy + seed defaults
  startPixelMapDataPlane();    // one shared frame source + recluster bridge

  const host = document.createElement('div');
  host.id = 'modern-pixel-map';
  document.body.appendChild(host);
  render(html`<${PixelMapPanel} />`, host);

  // ?pixelmap=view|edit only picks the initial mode; showPixelMap() is gated on
  // the 2d_pixels profile.
  const pmParam = new URLSearchParams(location.search).get('pixelmap');
  if (pmParam === 'view' || pmParam === 'edit') store.mode.value = pmParam;
  if (params.lightingProfile === '2d_pixels') showPixelMap(true);
}
