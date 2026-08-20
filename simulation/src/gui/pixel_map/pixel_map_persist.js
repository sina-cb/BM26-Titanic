/**
 * pixel_map_persist.js — SCOPED, auto-saving persistence for the 2D Pixel Map
 * views (report 20260725_66).
 *
 * The bug this exists to kill: `params.pixelMapViews` was a params key with NO
 * YAML wiring at either end — `reconstructYAML` never wrote it into the config
 * tree and `extractParams` never read it back (src/core/config.js only ever
 * knew the retired `pixelMap2d`). So every EDIT-mode move, every framing, every
 * hand-placed anchor lived in memory only: a full save wrote the whole scene
 * WITHOUT the layout, and the next boot found no persisted views, re-seeded the
 * four shipped defaults, and the operator's arrangement was gone. Silently.
 *
 * The fix is a sidecar of its own — `scenes/<scene>/pixel_map_views.yaml`,
 * written through `POST /save-pixel-map-views` — deliberately NOT a new section
 * of scene_config.yaml:
 *
 *   - It is SCOPED. The operator runs `autoSave: false` on purpose. The pixel
 *     map must be able to save ITS OWN layout automatically without dragging
 *     the entire scene (fixtures, patches, models, the engine sidecars) to disk
 *     behind his back. One write, one file, nothing else touched.
 *   - `configTree.views` is already taken by the view REGISTRY (views.yaml), so
 *     a `views` key in the scene tree would have been a name collision waiting
 *     to happen.
 *   - It mirrors the sidecar idiom this repo already uses (patches.yaml,
 *     views.yaml, controllers.yaml, cameras.yaml): parsed at boot in main.js,
 *     hard-stopping the boot if it is corrupt.
 *
 * FAIL LOUD, no fallbacks (codex P0): a failed persist raises the operator's
 * own save toast AND a console error. Nothing is retried behind a green UI, and
 * a save that cannot happen at all (static host) says so once and returns a
 * verbatim reason rather than pretending.
 */

import { saveHttpUrl } from '../../core/save_endpoint.js';
import { isStaticHost, logStaticHostSkip } from '../../core/static_host.js';

/** The scene-relative sidecar this module owns (server-side filename too). */
export const PIXEL_MAP_VIEWS_FILE = 'pixel_map_views.yaml';

/** The save-server route that writes it. Pinned by test against save-server.js. */
export const PIXEL_MAP_VIEWS_ENDPOINT = '/save-pixel-map-views';

/**
 * Debounce for the edit-tab auto-save. Long enough that a drag (one commit),
 * an arrow-nudge burst (one commit per keypress) and a pan/zoom (already
 * debounced 400 ms upstream) coalesce into a single write; short enough that
 * "move it, then reload" cannot outrun the save in normal operator use.
 */
export const AUTOSAVE_DEBOUNCE_MS = 800;

// The store installs this at load time. A getter (not a snapshot) so the
// debounced write always sends the LATEST layout, not the one that armed it.
let viewsSource = null;
let saveTimer = null;
let unloadInstalled = false;
// Serializes overlapping writes: a second commit landing mid-flight must not
// race the first onto disk out of order.
let inFlight = Promise.resolve();

/**
 * Install the accessor that returns the plain, serializable views tree
 * (`toParams(container)`). Called by the store once its container exists.
 */
export function setPixelMapViewsSource(fn) {
  if (typeof fn !== 'function') {
    throw new Error('[PixelMapPersist] setPixelMapViewsSource needs a function');
  }
  viewsSource = fn;
}

/** True while a debounced auto-save is armed (tests + the unload flush). */
export function pixelMapViewsSavePending() {
  return saveTimer !== null;
}

function sceneQuery() {
  const scene = (typeof window !== 'undefined' && window.__activeScene) || '';
  return scene ? `?scene=${encodeURIComponent(scene)}` : '';
}

/** The exact JSON body the endpoint (and the unload beacon) sends. */
function serializeViews() {
  if (!viewsSource) {
    throw new Error('[PixelMapPersist] no views source installed — the pixel map ' +
      'layout cannot be saved (loadViewsFromParams must run first)');
  }
  const tree = viewsSource();
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.views)) {
    throw new Error('[PixelMapPersist] views source returned no { views: [...] } tree — ' +
      'refusing to overwrite the saved layout with garbage');
  }
  return JSON.stringify(tree);
}

/**
 * Shout at the operator through the surface his saves already use. A pixel-map
 * layout that failed to persist is EXACTLY the failure that produced this
 * report — it must never be quiet again.
 */
function reportFailure(reason) {
  const msg = `⚠ PIXEL MAP LAYOUT NOT SAVED — ${reason}`;
  console.error(`[PixelMap] ${msg}`);
  if (typeof window === 'undefined') return;
  if (window.showSaveToast) window.showSaveToast(msg, true);
  if (window.sacnLog) window.sacnLog(msg, 'error');
}

/**
 * Write the layout NOW, bypassing the debounce. Resolves `{ok, reason?}` and
 * never rejects — the callers are fire-and-forget UI paths, and an unhandled
 * rejection would be a silent failure by another name.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function savePixelMapViewsNow() {
  clearTimeout(saveTimer);
  saveTimer = null;

  let body;
  try {
    body = serializeViews();
  } catch (err) {
    reportFailure(err.message);
    return { ok: false, reason: err.message };
  }

  if (isStaticHost()) {
    logStaticHostSkip('save pixel map views (save server)');
    return { ok: false,
      reason: 'static host — the save server is not reachable, the layout is NOT on disk' };
  }

  const run = async () => {
    try {
      const res = await fetch(saveHttpUrl(`${PIXEL_MAP_VIEWS_ENDPOINT}${sceneQuery()}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`save server responded ${res.status}`);
      console.log(`[PixelMap] layout saved → ${PIXEL_MAP_VIEWS_FILE}` +
        `${sceneQuery() ? ` (scene: ${window.__activeScene})` : ''}`);
      return { ok: true };
    } catch (err) {
      reportFailure(err.message);
      return { ok: false, reason: err.message };
    }
  };

  // Chain onto any in-flight write so two commits cannot land out of order.
  const chained = inFlight.then(run, run);
  inFlight = chained.then(() => undefined, () => undefined);
  return chained;
}

/**
 * AUTO-SAVE (operator order, 2026-07-30): after any edit-tab change the layout
 * persists on its own, debounced. SCOPED to the pixel-map sidecar — it does NOT
 * mark the scene dirty and does NOT trigger a full scene save, so the
 * operator's `autoSave: false` stays exactly as he set it.
 */
export function schedulePixelMapViewsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePixelMapViewsNow();
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Flush a pending layout write on page unload — the only transport that
 * survives it. Without this, a move made inside the debounce window and
 * followed immediately by a reload would be lost, which is the very shape of
 * the bug being fixed. Returns true when there was pending work.
 */
export function flushPixelMapViewsBeacon() {
  if (saveTimer === null) return false;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (isStaticHost()) {
    logStaticHostSkip('flush pixel map views (save server)');
    return false;
  }
  try {
    const body = serializeViews();
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      throw new Error('navigator.sendBeacon is unavailable — the pending layout write is lost');
    }
    navigator.sendBeacon(saveHttpUrl(`${PIXEL_MAP_VIEWS_ENDPOINT}${sceneQuery()}`),
      new Blob([body], { type: 'application/json' }));
    return true;
  } catch (err) {
    reportFailure(`unload flush failed: ${err.message}`);
    return true;
  }
}

/** Arm the unload flush. Idempotent; called once from initPixelMapPanel. */
export function installPixelMapPersistence() {
  if (unloadInstalled || typeof window === 'undefined') return;
  unloadInstalled = true;
  window.addEventListener('beforeunload', () => { flushPixelMapViewsBeacon(); });
}
