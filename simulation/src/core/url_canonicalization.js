/**
 * url_canonicalization.js — fill missing boot URL params and mirror them in
 * the address bar.
 *
 * The operator-facing default sim view is Titanic on the 2D Pixel Map, fed by
 * sACN IN, with the analytic SpotLight pool disabled. Those four knobs already
 * have authoritative boot handlers (`main.js`, `url_overrides.js`); this module
 * makes them EXPLICIT in the URL so a bare `/simulation/` bookmark, reload, or
 * screenshot always names what the page is doing.
 *
 * Only the keys in `SIM_URL_BOOT_DEFAULTS` are filled when absent. Every other
 * query param (`renderer`, `readonly`, `theme`, `bench_mirror`, …) is left
 * exactly as the caller supplied it.
 *
 * Codex P0: no silent substitution — an explicitly-present value always wins.
 * Canonicalization runs once at module load via `history.replaceState`; it must
 * never reload the page or re-run on its own write (loop guard).
 */

/** Canonical boot defaults — keep aligned with launcher prod `simParams` + `SIM_QUERY_COMMON`. */
export const SIM_URL_BOOT_DEFAULTS = Object.freeze({
  scene: 'titanic',
  profile: '2d_pixels',
  lighting_mode: 'sacn_in',
  spotlights: '0',
});

/** Keys this module may fill when missing. Stable order for deterministic URLs. */
export const SIM_URL_CANONICAL_KEYS = Object.freeze(Object.keys(SIM_URL_BOOT_DEFAULTS));

/**
 * Build the canonical query string for `params`, emitting boot-default keys in
 * `SIM_URL_CANONICAL_KEYS` order and every other key afterward in first-seen
 * order.
 *
 * @param {URLSearchParams} params
 * @returns {string}
 */
export function canonicalUrlSearchString(params) {
  const src = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const extras = [];
  const seenExtra = new Set();
  for (const [key, value] of src.entries()) {
    if (SIM_URL_CANONICAL_KEYS.includes(key)) continue;
    if (seenExtra.has(key)) continue;
    seenExtra.add(key);
    extras.push([key, src.get(key)]);
  }

  const parts = [];
  for (const key of SIM_URL_CANONICAL_KEYS) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(src.get(key))}`);
  }
  for (const [key, value] of extras) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

/**
 * Fill missing boot-default keys. Pure — no DOM writes.
 *
 * @param {URLSearchParams|string|undefined} input
 * @returns {{ params: URLSearchParams, changed: boolean, filled: string[] }}
 */
export function resolveCanonicalUrlSearchParams(input) {
  const src = input instanceof URLSearchParams
    ? new URLSearchParams(input)
    : new URLSearchParams(String(input || ''));
  const out = new URLSearchParams();
  for (const [key, value] of src.entries()) {
    out.append(key, value);
  }

  const filled = [];
  for (const [key, defaultValue] of Object.entries(SIM_URL_BOOT_DEFAULTS)) {
    if (!src.has(key)) {
      out.set(key, defaultValue);
      filled.push(key);
    }
  }

  const changed = filled.length > 0
    || canonicalUrlSearchString(out) !== canonicalUrlSearchString(src);
  return { params: out, changed, filled };
}

/**
 * Rewrite the live address bar once when canonical keys are missing or out of
 * the stable key order. Returns the params the boot path must read.
 *
 * @param {{ pathname?: string, search?: string, hash?: string }} location
 * @param {{ replaceState?: Function, state?: * }} history
 * @returns {{ changed: boolean, params: URLSearchParams, filled: string[],
 *             href: string }}
 */
export function canonicalizeBrowserLocation(location, history = {}) {
  const pathname = location && location.pathname ? location.pathname : '/simulation/';
  const hash = location && location.hash ? location.hash : '';
  const resolved = resolveCanonicalUrlSearchParams(location && location.search);
  const canonicalSearch = canonicalUrlSearchString(resolved.params);
  const currentSearch = canonicalUrlSearchString(
    new URLSearchParams(String((location && location.search) || '').replace(/^\?/, '')),
  );
  const href = `${pathname}${canonicalSearch ? `?${canonicalSearch}` : ''}${hash}`;

  if (canonicalSearch !== currentSearch && typeof history.replaceState === 'function') {
    history.replaceState(history.state ?? null, '', href);
  }

  return {
    changed: canonicalSearch !== currentSearch,
    params: resolved.params,
    filled: resolved.filled,
    href,
  };
}
