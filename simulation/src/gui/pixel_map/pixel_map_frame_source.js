/**
 * pixel_map_frame_source.js — the ONE per-frame color decode shared by every
 * pane of the 2D Pixel Map multiview.
 *
 * Why a shared source: the display color of a pixel is identical in every pane
 * (only geometry differs), so the RGBWAU→display-RGB decode (+ the preview
 * brightness lift) must run exactly ONCE per frame into a shared color buffer,
 * and N panes must never mean N onPixelFrame subscriptions (report 20260724_9
 * §2.1/§3). Panes register a painter; each painter is handed the shared buffer
 * and only stamps geometry.
 *
 * Wiring note: the single onPixelFrame subscription is INJECTED via
 * startFrameSource(subscribe) rather than importing animate.js directly.
 * animate.js touches `window` at module-eval time and pulls in browser-only
 * deps (chroma-js), so importing it here would make this module — and every
 * pane test — unloadable under `node --test`. Injection keeps the module pure
 * and node-testable while still being the single real subscriber. The
 * cross-slice contract (registerPanePainter / onTopology, §5) is unchanged.
 */

import { entryDisplayRgb } from '../../core/rgbwau_blend.js';
import { params } from '../../core/state.js';

// Preview-only brightness lift — MUST match pixel_map_renderer.js PREVIEW_GAMMA
// so a pane shows the same color the single-view map showed. A gamma on the
// pixel's VALUE (max channel) lifts dim lights so they read on-screen while full
// brightness stays put; scaling all channels equally keeps hue/saturation. This
// affects the 2D PREVIEW only — never DMX/sACN output.
const PREVIEW_GAMMA = 0.6;

const _painters = new Set();
const _topologyListeners = new Set();

let _subscribe = null;   // injected onPixelFrame
let _unsub = null;       // active subscription teardown
let _colorBuf = null;    // Float32Array(3n): preview-brightened display RGB
let _bufPixels = 0;
let _lastVersion = -2;

/** Preview-brighten one display RGB triple in place-ish (returns a 3-tuple). */
function _previewBrighten(r, g, b) {
  const v = Math.max(r, g, b);
  if (v <= 0) return [r, g, b];
  const s = Math.pow(v, PREVIEW_GAMMA) / v; // = v^(GAMMA-1); ≥1, biggest when dim
  return [Math.min(1, r * s), Math.min(1, g * s), Math.min(1, b * s)];
}

function _ensureBuf(n) {
  if (!_colorBuf || _bufPixels < n) {
    _colorBuf = new Float32Array(3 * n);
    _bufPixels = n;
  }
  return _colorBuf;
}

function _ensureSubscribed() {
  if (_unsub || !_subscribe || _painters.size === 0) return;
  _lastVersion = -2; // force a topology notify on the first frame
  _unsub = _subscribe(_dispatch);
}

function _teardown() {
  if (_unsub) { _unsub(); _unsub = null; }
  _lastVersion = -2;
}

// The single onPixelFrame callback. Decodes once, then fans out to painters.
function _dispatch(list, version) {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (_painters.size === 0) return;

  // Topology bump: notify BEFORE decode so listeners (re)cluster/reseed first.
  if (version !== _lastVersion) {
    _lastVersion = version;
    for (const fn of [..._topologyListeners]) {
      try {
        fn(list, version);
      } catch (err) {
        console.error('[PixelMapFrameSource] topology listener threw — unsubscribed:', err);
        _topologyListeners.delete(fn);
      }
    }
  }

  const n = list ? list.length : 0;
  const buf = _ensureBuf(n);
  const patchesActive = !!(typeof window !== 'undefined' && window._patchesActive);
  const showUnpatchedRed = !!(params && params.showUnpatchedRed);

  // ── The ONE decode per frame ──
  for (let gi = 0; gi < n; gi++) {
    const entry = list[gi];
    const j = gi * 3;
    if (!entry) { buf[j] = 0; buf[j + 1] = 0; buf[j + 2] = 0; continue; }
    const [r, g, b] = entryDisplayRgb(entry, patchesActive, showUnpatchedRed);
    const [pr, pg, pb] = _previewBrighten(r, g, b);
    buf[j] = pr; buf[j + 1] = pg; buf[j + 2] = pb;
  }

  for (const fn of [..._painters]) {
    try {
      fn(buf, list, version);
    } catch (err) {
      // Mirror the onPixelFrame contract: a painter that throws is dropped
      // loudly (its pane visibly freezes — that IS the loud failure).
      console.error('[PixelMapFrameSource] pane painter threw — unsubscribed:', err);
      _painters.delete(fn);
    }
  }
  if (_painters.size === 0) _teardown();
}

/** Wire the single per-frame subscription. `subscribe` is animate.js's
 *  onPixelFrame; called once at panel init. Idempotent. */
export function startFrameSource(subscribe) {
  if (typeof subscribe !== 'function') {
    throw new Error('[PixelMapFrameSource] startFrameSource requires the onPixelFrame subscriber.');
  }
  _subscribe = subscribe;
  _ensureSubscribed();
}

/** Register a pane painter `fn(colorBuf, list, builtVersion)`, where colorBuf is
 *  a Float32Array(3n) of preview-brightened display RGB (0..1), ready to fill.
 *  @returns {() => void} unregister. */
export function registerPanePainter(fn) {
  if (typeof fn !== 'function') {
    throw new Error('[PixelMapFrameSource] registerPanePainter requires a function.');
  }
  _painters.add(fn);
  _ensureSubscribed();
  return () => {
    _painters.delete(fn);
    if (_painters.size === 0) _teardown();
  };
}

/** Subscribe to topology bumps: `fn(list, builtVersion)` fires when the model
 *  is rebuilt (recluster/reseed trigger). @returns {() => void} unsubscribe. */
export function onTopology(fn) {
  if (typeof fn !== 'function') {
    throw new Error('[PixelMapFrameSource] onTopology requires a function.');
  }
  _topologyListeners.add(fn);
  return () => _topologyListeners.delete(fn);
}

/** Test/introspection hook: current registered-painter count. */
export function _painterCount() { return _painters.size; }

/** Test hook: drive one frame directly (bypasses the injected subscriber). */
export function _dispatchForTest(list, version) { _dispatch(list, version); }

/** Test hook: reset all module state between cases. */
export function _resetForTest() {
  _painters.clear();
  _topologyListeners.clear();
  _teardown();
  _subscribe = null;
  _colorBuf = null;
  _bufPixels = 0;
}
