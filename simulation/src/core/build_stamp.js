/**
 * build_stamp.js — single stable module-cache token for this page load.
 *
 * Imported once at boot (main.js) and re-used for any dynamic import that must
 * bust a stale WKWebView module graph after a deploy. Intentionally NOT
 * Date.now() — that would change on every import and fight offline reload loops.
 *
 * Bump MODULE_CACHE_EPOCH when pixel-map lifecycle or other hot-fix surfaces
 * change in ways that must force a fresh module graph on already-open tabs.
 */
export const MODULE_CACHE_EPOCH = '20260818_pixel_map_sidecar_guard_2';

/** Append to a module URL for cache-safe dynamic import in probes/tests. */
export function moduleUrl(base, origin = '') {
  const root = origin ? `${origin}/${base.replace(/^\//, '')}` : base;
  const sep = root.includes('?') ? '&' : '?';
  return `${root}${sep}v=${MODULE_CACHE_EPOCH}`;
}
