/**
 * save_endpoint.js — Single accessor for the save-server endpoint.
 *
 * Mirrors engine_endpoint.js: the save port lives in config.yaml (`save_port`),
 * fetched into `window.serverConfig` at boot (main.js). Every browser call to
 * the save-server derives its URL from here instead of hardcoding `6970` — a
 * hardcoded literal made every save/export land on WHATEVER save-server owned
 * :6970, silently writing into a different checkout when two stacks coexisted
 * (worktree on 6990 vs main on 6970, found 2026-07-10).
 *
 * Read LAZILY (call at request time, never at module-eval time) so the config
 * fetch has resolved. No silent fallback: if the port is missing we throw
 * loudly rather than guessing.
 */

export function getSaveHost() {
  return (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
}

export function getSavePort() {
  const port = typeof window !== 'undefined' && window.serverConfig && window.serverConfig.save_port;
  if (!Number.isInteger(port)) {
    throw new Error('[save_endpoint] save_port missing from config.yaml (window.serverConfig not loaded?).');
  }
  return port;
}

/** Full HTTP URL for a save-server path, e.g. saveHttpUrl('/save?scene=x'). */
export function saveHttpUrl(pathname = '') {
  return `http://${getSaveHost()}:${getSavePort()}${pathname}`;
}
