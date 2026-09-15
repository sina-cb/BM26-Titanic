/**
 * gpu_adapter_warning.js — HUD banner for "the wrong GPU is rendering".
 *
 * Companion to `src/core/gpu_adapter.js`. When the sim is running on an
 * integrated GPU (or when the browser refuses to name the adapter at all), the
 * frame rate collapses to ~10-20 FPS on this scene and every FPS measurement
 * taken in that window is worthless. Report `20260725_38` spent a full session
 * proving that exact symptom was NOT a code regression, so the condition must
 * be impossible to mistake for one again.
 *
 * Warning surface ONLY — no auto-fallback, no profile downgrade, no backend
 * switch. The remedy is a Windows per-app GPU preference plus a FULL browser
 * relaunch (report `20260914_372`).
 *
 * Dismissable (✕, or `H` → hide_all) since 2026-09-14: the adapter is fixed for
 * the life of the page, so a dismissal lasts until reload. Agent screenshots
 * (agent_render.cjs) run in a fresh browser where nothing has been dismissed,
 * so a capture taken on the wrong GPU still carries the stamp that says so.
 *
 * The pure state function is exported separately so Node unit tests can cover
 * it without a DOM (`gpu_adapter.test.js`).
 */

import { adapterWarningText } from '../core/gpu_adapter.js';
import { createHudBanner } from './hud_banner.js';

const BANNER_ID = 'gpu-adapter-warning';

/**
 * Pure banner state for a detected adapter.
 * @param {{renderer: string|null, integrated: boolean, detectionFailed: boolean}|null} adapter
 *        — as produced by `classifyAdapter` / `detectGpuAdapter`. A null/absent
 *        adapter means detection has not run yet: show nothing (the detector
 *        itself does the shouting when it fails).
 * @returns {{ show: boolean, text: string }}
 */
export function bannerStateForAdapter(adapter) {
  const text = adapterWarningText(adapter);
  if (!text) return { show: false, text: '' };
  return { show: true, text };
}

// Fixed top-center, below the multi-client banner (top: 44px, ~30px tall) and
// the BENCH MIRROR banner (top: 78px, ~30px tall) so all three can co-exist —
// the old top: 84px sat on top of the bench banner. Error palette via theme
// vars; pointer events off — it warns, it never blocks the UI; only its ✕
// (hud_banner.js) takes the pointer. Still NOT hidden by the render tool's
// UI-hiding pass: a screenshot taken on the wrong GPU should carry the stamp.
const BANNER_CSS =
  'position:fixed;top:112px;left:50%;transform:translateX(-50%);' +
  'max-width:min(880px, calc(100vw - 28px));' +
  'background:color-mix(in srgb, var(--error) 26%, var(--surface));' +
  'border:2px solid var(--error-container-border);color:var(--error);' +
  'padding:10px 20px;border-radius:8px;font-family:var(--font-headline);' +
  'font-size:12px;font-weight:700;letter-spacing:0.04em;line-height:1.5;' +
  'text-align:center;pointer-events:none;z-index:10001;';

const _banner = createHudBanner({
  id: BANNER_ID,
  cssText: BANNER_CSS,
  closeTitle: 'Hide this warning until reload — the sim still renders on this GPU',
});

/**
 * Mount / update the banner for a detected adapter. Creates the element lazily;
 * safe to call before <body> exists (defers via DOMContentLoaded once).
 * @param {{renderer: string|null, integrated: boolean, detectionFailed: boolean}|null} adapter
 */
export function setupGpuAdapterWarning(adapter) {
  _banner.update(bannerStateForAdapter(adapter));
}
