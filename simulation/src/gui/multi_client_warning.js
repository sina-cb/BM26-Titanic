/**
 * multi_client_warning.js — HUD banner for the multi-client contention risk.
 *
 * The sACN bridge broadcasts a client census (`{type:'clients', count}`) on
 * every browser connect/disconnect. More than one connected sim window is a
 * production hazard (2026-07-24, operator decision): extra windows contend
 * for the GPU (viewport freezes) and — in sacn_in mode — each window is an
 * independent prio-150 sACN writer to the hardware (report 20260724_15 §2.3),
 * so the condition must be IMPOSSIBLE to miss in every connected window.
 *
 * This is a warning surface ONLY — no auto-kick, no writer arbitration; that
 * decision (options i/ii/iii in the report) stays with the operator.
 *
 * Top-level HUD element (own module, not part of the pixel-map UI). The pure
 * state function is exported separately so Node unit tests can cover the
 * transitions without a DOM (multi_client_warning.test.js).
 */

const BANNER_ID = 'multi-client-warning';

/**
 * Pure banner state for a census count.
 * @param {number|null|undefined} count — connected sim clients per the
 *        bridge. null/undefined/non-finite = census unknown (e.g. bridge
 *        connection lost): hide rather than scream stale information.
 * @returns {{ show: boolean, text: string }}
 */
export function bannerStateForCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 1) return { show: false, text: '' };
  return {
    show: true,
    text: `⚠ ${Math.floor(n)} sim windows connected — hardware output contention risk`,
  };
}

/**
 * Apply a census update to the HUD banner. Creates the element lazily; safe
 * to call before <body> exists (defers via DOMContentLoaded once).
 * @param {number|null} count
 */
export function handleClientCensus(count) {
  const state = bannerStateForCount(count);
  const render = () => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      if (!state.show) return; // nothing to hide
      el = document.createElement('div');
      el.id = BANNER_ID;
      // Fixed top-center, just below the unsaved-changes chip; error palette
      // via theme vars (matches the spotlight-cap toast recipe). Pointer
      // events off — it warns, it never blocks the UI.
      el.style.cssText =
        'position:fixed;top:44px;left:50%;transform:translateX(-50%);' +
        'background:color-mix(in srgb, var(--error) 22%, var(--surface));' +
        'border:1px solid var(--error-container-border);color:var(--error);' +
        'padding:6px 18px;border-radius:8px;font-family:var(--font-headline);' +
        'font-size:12px;font-weight:700;letter-spacing:0.06em;' +
        'pointer-events:none;z-index:1000;transition:opacity 0.3s;';
      document.body.appendChild(el);
    }
    el.textContent = state.text;
    el.style.opacity = state.show ? '1' : '0';
  };
  if (typeof document === 'undefined') return;
  if (document.body) render();
  else window.addEventListener('DOMContentLoaded', render, { once: true });
}
