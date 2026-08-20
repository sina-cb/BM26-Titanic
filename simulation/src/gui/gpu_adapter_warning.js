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
 * switch. The remedy is a one-time Windows per-app GPU preference.
 *
 * The pure state function is exported separately so Node unit tests can cover
 * it without a DOM (`gpu_adapter.test.js`).
 */

import { adapterWarningText } from '../core/gpu_adapter.js';

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

/**
 * Mount / update the banner for a detected adapter. Creates the element lazily;
 * safe to call before <body> exists (defers via DOMContentLoaded once).
 * @param {{renderer: string|null, integrated: boolean, detectionFailed: boolean}|null} adapter
 */
export function setupGpuAdapterWarning(adapter) {
  const state = bannerStateForAdapter(adapter);
  const render = () => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      if (!state.show) return; // healthy adapter — nothing to mount, nothing to hide
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.setAttribute('role', 'alert');
      el.setAttribute('aria-live', 'assertive');
      // Fixed top-center, below the multi-client banner (top: 44px) so the two
      // can co-exist. Error palette via theme vars; pointer events off — it
      // warns, it never blocks the UI. Deliberately NOT in the edit-mode hide
      // list and NOT hidden by the render tool's UI-hiding pass: a screenshot
      // taken on the wrong GPU should carry the stamp that says so.
      el.style.cssText =
        'position:fixed;top:84px;left:50%;transform:translateX(-50%);' +
        'max-width:min(880px, calc(100vw - 28px));' +
        'background:color-mix(in srgb, var(--error) 26%, var(--surface));' +
        'border:2px solid var(--error-container-border);color:var(--error);' +
        'padding:10px 20px;border-radius:8px;font-family:var(--font-headline);' +
        'font-size:12px;font-weight:700;letter-spacing:0.04em;line-height:1.5;' +
        'text-align:center;pointer-events:none;z-index:10001;';
      document.body.appendChild(el);
    }
    el.textContent = state.text;
    el.style.display = state.show ? '' : 'none';
  };
  if (typeof document === 'undefined') return;
  if (document.body) render();
  else window.addEventListener('DOMContentLoaded', render, { once: true });
}
