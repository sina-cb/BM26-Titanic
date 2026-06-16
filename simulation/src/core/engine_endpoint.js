/**
 * engine_endpoint.js — Single accessor for the marsin_engine API endpoint.
 *
 * The engine port lives in config.yaml (`marsin_engine_port`), fetched into
 * `window.serverConfig` at boot (main.js). Every browser call to the engine
 * derives its URL from here instead of hardcoding `6968`, so a port change in
 * config.yaml can't leave stale literals pointing at a dead port.
 *
 * Read LAZILY (call these at request time, never at module-eval time) so the
 * config fetch has resolved. No silent fallback: if the port is missing we
 * throw loudly rather than guessing.
 */

export function getEngineHost() {
  return (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
}

export function getEnginePort() {
  const port = typeof window !== 'undefined' && window.serverConfig && window.serverConfig.marsin_engine_port;
  if (!Number.isInteger(port)) {
    throw new Error('[engine_endpoint] marsin_engine_port missing from config.yaml (window.serverConfig not loaded?).');
  }
  return port;
}

/** Full HTTP URL for an engine API path, e.g. engineHttpUrl('/status'). */
export function engineHttpUrl(pathname = '') {
  return `http://${getEngineHost()}:${getEnginePort()}${pathname}`;
}

/** Engine WebSocket base URL. */
export function engineWsUrl() {
  return `ws://${getEngineHost()}:${getEnginePort()}`;
}
