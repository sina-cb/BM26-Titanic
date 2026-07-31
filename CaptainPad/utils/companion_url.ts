// companion_url — derive the Audio Companion web-UI URL from the app's
// EFFECTIVE engine api_base.
//
// Why derive instead of configuring a second address: the operator already
// points CaptainPad at the show machine ONCE (Config tab → AsyncStorage
// `API_BASE`, e.g. http://10.1.1.151:6968). The Audio Companion is a
// supervised sidecar that runs on the SAME machine as the engine (see
// launcher.js → COMPANIONS.audio), so its host is always the engine's host —
// only the port differs. Deriving keeps the two from drifting and makes the
// iPad resolve to http://10.1.1.151:6966, never 127.0.0.1.
//
// PURE + dependency-free by design (no react-native imports) so vitest can
// exercise it under `utils/*.test.ts` with no RN stubs.

/** Fixed HTTP/WS port of the Marsin Audio Companion — launcher.js COMPANIONS.audio.port. */
export const AUDIO_COMPANION_PORT = 6966;

// scheme://host[:port][/trailing]  — host may be a hostname, IPv4, or a
// bracketed IPv6 literal. Anything else is a misconfigured base and must fail
// LOUDLY (codex P0: no silent fallback to a guessed address).
const BASE_RE = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?\/?$/i;

/**
 * Map an engine api_base onto the Audio Companion's web UI on the same host.
 *
 * @param apiBase effective engine base, e.g. 'http://10.1.1.151:6968'
 * @returns e.g. 'http://10.1.1.151:6966'
 * @throws if apiBase is empty or not a parseable scheme://host[:port] URL.
 */
export function companionUrlFromApiBase(apiBase: string): string {
  if (typeof apiBase !== 'string' || !apiBase.trim()) {
    throw new Error('companionUrlFromApiBase: api_base is empty — cannot derive the Audio Companion URL');
  }
  const m = BASE_RE.exec(apiBase.trim());
  if (!m) {
    throw new Error(
      `companionUrlFromApiBase: cannot parse api_base ${JSON.stringify(apiBase)} — ` +
      'expected scheme://host[:port] (e.g. http://10.1.1.151:6968)',
    );
  }
  const [, scheme, host] = m;
  return `${scheme.toLowerCase()}://${host}:${AUDIO_COMPANION_PORT}`;
}
