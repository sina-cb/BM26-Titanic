// simulation_url — derive the canonical 2D Pixels simulator URL from the
// EFFECTIVE engine api_base.
//
// The simulator is supervised on the same show machine as the engine. The
// engine host is therefore authoritative; only the service port and route
// change. Keeping this pure and dependency-free lets the URL contract run in
// the regular Node test suite without React Native stubs.

/** Fixed HTTP port of the simulator started by launcher.js. */
export const SIMULATION_PORT = 6969;

/** Canonical operator projection shared with the simulator's 2D Pixels view. */
export const PIXEL_SIMULATION_PATH =
  '/simulation/?profile=2d_pixels&lighting_mode=sacn_in';

const BASE_RE = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?\/?$/i;

/**
 * Map an engine api_base onto the canonical 2D Pixels simulator view.
 *
 * @param apiBase effective engine base, e.g. 'http://10.1.1.151:6968'
 * @returns the same host on :6969 with the canonical projection query
 * @throws when apiBase is empty or not scheme://host[:port]
 */
export function simulationUrlFromApiBase(apiBase: string): string {
  if (typeof apiBase !== 'string' || !apiBase.trim()) {
    throw new Error(
      'simulationUrlFromApiBase: api_base is empty — cannot derive the simulator URL',
    );
  }

  const match = BASE_RE.exec(apiBase.trim());
  if (!match) {
    throw new Error(
      `simulationUrlFromApiBase: cannot parse api_base ${JSON.stringify(apiBase)} — ` +
      'expected scheme://host[:port] (e.g. http://10.1.1.151:6968)',
    );
  }

  return `${simulationOriginFromApiBase(apiBase)}${PIXEL_SIMULATION_PATH}`;
}

/**
 * The simulator's ORIGIN (scheme://host:6969), with no route attached.
 *
 * Exists because the simulator serves more than its own UI: its HTTP server's
 * document root is the REPO root, so sim-authored artifacts under `docs/` and
 * `simulation/` are plain read-only GETs on the same origin. The Deck PIXELS
 * window uses this to fetch the sim's resolved 2D pixel map
 * (`components/deck/pixel_view_logic.ts` → PIXEL_VIEW_ARTIFACT_PATH), which is
 * the operator's ruling that "simulation 2d pixels are the source of truth".
 *
 * Same host derivation and the same fail-loud parse as the iframe URL above —
 * one place decides where the simulator lives.
 *
 * @throws when apiBase is empty or not scheme://host[:port]
 */
export function simulationOriginFromApiBase(apiBase: string): string {
  if (typeof apiBase !== 'string' || !apiBase.trim()) {
    throw new Error(
      'simulationOriginFromApiBase: api_base is empty — cannot derive the simulator origin',
    );
  }

  const match = BASE_RE.exec(apiBase.trim());
  if (!match) {
    throw new Error(
      `simulationOriginFromApiBase: cannot parse api_base ${JSON.stringify(apiBase)} — ` +
      'expected scheme://host[:port] (e.g. http://10.1.1.151:6968)',
    );
  }

  const [, scheme, host] = match;
  return `${scheme.toLowerCase()}://${host}:${SIMULATION_PORT}`;
}
