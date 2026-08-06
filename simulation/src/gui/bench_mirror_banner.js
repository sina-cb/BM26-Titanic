/**
 * bench_mirror_banner.js — persistent HUD banner for the BENCH MIRROR runtime
 * mode (report 20260804_151).
 *
 * While armed, the sACN bridge stops relaying certain (universe → controller)
 * pairs and composes them instead: physical boxes are being driven by a
 * re-address map rather than by the scene that patched them. That is a large,
 * invisible change to what the hardware means, so it must be IMPOSSIBLE to miss
 * in every connected window — including a window that was reloaded after the
 * arm, which is why the bridge pushes `benchMirrorStatus` to every new
 * connection as well as on every transition.
 *
 * PANEL-INDEPENDENT ON PURPOSE. The ARM/DISARM control lives in the 🎛
 * Controllers view header, which the operator can close, and the status must
 * survive that: while armed the ENTIRE SHIP has stopped receiving physical data
 * and the bench is the only output. A window with every panel closed must still
 * say so. This banner is a top-level HUD element, structurally a sibling of
 * multi_client_warning.js — pure state function (unit-testable with no DOM) plus
 * lazy DOM creation that is safe before <body> exists.
 *
 * Real controller IPs are shown deliberately: this is live operator state on
 * their own screen, not a tracked document, and "ARMED" that does not name the
 * boxes that changed hands is not actionable.
 */

const BANNER_ID = 'bench-mirror-banner';

/**
 * Pure banner state for a bridge `benchMirrorStatus` message.
 *
 * @param {Object|null} status — the bridge's status object. null/undefined =
 *        status unknown (bridge connection lost): hide rather than assert a
 *        stale ARMED, exactly as the client census does.
 * @returns {{ show: boolean, text: string }}
 */
export function bannerStateForStatus(status) {
  if (!status || status.armed !== true) return { show: false, text: '' };
  const label = (typeof status.label === 'string' && status.label.trim() !== '')
    ? status.label.trim().toUpperCase()
    : String(status.scene || '').toUpperCase();
  const dests = Array.isArray(status.destinations) ? status.destinations : [];
  const owned = dests.map((d) => `U${d.universe}→${d.ip}`).join(', ');
  const selection = Array.isArray(status.selection) ? status.selection : [];
  const mapped = selection.filter((s) => s.source).length;
  const dark = selection.length - mapped;
  const source = typeof status.sourceScene === 'string' && status.sourceScene
    ? ` ← ${status.sourceScene}` : '';
  return {
    show: true,
    // The headline is NOT "armed" — it is what changed about the whole rig. An
    // operator who reads only the first clause must still learn that the ship
    // stopped receiving data.
    text: `🪞 BENCH MIRROR ACTIVE — ${label}${source} · ALL SHIP OUTPUT SUSPENDED — BENCH ONLY · ` +
      `${mapped} slot(s) mapped, ${dark} dark · owns ${owned || 'nothing'}`,
  };
}

/**
 * Apply a bench-mirror status update to the HUD banner. Creates the element
 * lazily; safe to call before <body> exists (defers via DOMContentLoaded once).
 * @param {Object|null} status
 */
export function handleBenchMirrorStatus(status) {
  const state = bannerStateForStatus(status);
  const render = () => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      if (!state.show) return; // nothing to hide
      el = document.createElement('div');
      el.id = BANNER_ID;
      // Fixed top-center, stacked BELOW the multi-client warning (top:44px) so
      // both can be visible at once — arming with >1 window connected is
      // allowed-but-warned, which is exactly when both appear. Primary (amber)
      // palette rather than error red: armed is a deliberate mode, not a fault,
      // and it must be distinguishable at a glance from the contention warning.
      el.style.cssText =
        'position:fixed;top:78px;left:50%;transform:translateX(-50%);' +
        'background:color-mix(in srgb, var(--primary) 22%, var(--surface));' +
        'border:1px solid var(--primary);color:var(--primary);' +
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
