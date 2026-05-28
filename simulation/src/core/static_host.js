/**
 * static_host.js — Single source of truth for "is this page running as a
 * dev-server-less static artifact (e.g., GitHub Pages) or as a local dev
 * page with the full backend stack alongside it?"
 *
 * Used to gate dev-only network integrations that cannot possibly work
 * from a static host:
 *   - Engine HTTP API on port 6968 (status, /param-center, /global-effect, /global-blackout)
 *   - save-server on port 6970 (/save, /save-pattern, /delete-pattern, /save-cameras, /save-model)
 *   - sACN bridge WebSockets (in 6971, out 6972)
 *
 * Why HTTPS is the signal:
 *   The mixed-content policy in every modern browser blocks http:// fetches
 *   and ws:// sockets from any https:// page. Our dev stack always runs on
 *   http://localhost; any https:// origin is by definition a deployed static
 *   artifact with no backend reachable from the page.
 *
 * Per .agent/00_gol/00_codex.md P0: this is NOT a fallback. We are not
 * pretending a request succeeded, retrying silently, or substituting a
 * different transport. We are surfacing — once, at boot — that a feature
 * cannot exist in this hosting model and skipping it cleanly so the
 * console stays readable and the UI doesn't fire impossible requests.
 */

const _logged = new Set();

/**
 * @returns {boolean} true when running on a static host (HTTPS, no dev backend)
 */
export function isStaticHost() {
  if (typeof window === 'undefined' || !window.location) return false;
  return window.location.protocol === 'https:';
}

/**
 * Emit one log line per feature the first time it's gated by static-host mode.
 * Subsequent calls for the same feature are no-ops so user-action handlers
 * don't spam the console on every click.
 *
 * @param {string} feature  Short stable name, e.g. 'engine status'
 * @param {string} [reason] Optional override; defaults to a generic explanation
 */
export function logStaticHostSkip(feature, reason) {
  if (!isStaticHost()) return;
  if (_logged.has(feature)) return;
  _logged.add(feature);
  const msg = reason || 'no dev backend reachable from HTTPS';
  console.log(`[StaticHost] ${feature} disabled — ${msg}.`);
}
