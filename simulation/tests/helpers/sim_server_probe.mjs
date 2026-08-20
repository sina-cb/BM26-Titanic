/**
 * sim_server_probe.mjs — TCP-only liveness probe for the simulation dev
 * server, used by browser-driven suites to SKIP WITH REASON instead of
 * failing with ERR_CONNECTION_REFUSED when nothing is listening at
 * `http://127.0.0.1:6969/` (the operator's live stack owns that port).
 *
 * PROBE ONLY. This module opens a plain `net.connect`, destroys the socket
 * immediately on connect/timeout/error, and NEVER binds or listens on any
 * port itself.
 */
import net from 'node:net';

const SIM_HOST = '127.0.0.1';
const SIM_PORT = 6969;
const PROBE_TIMEOUT_MS = 500;

/**
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>} true iff a TCP connect to host:port succeeds
 *   within the probe timeout; false on refusal, timeout, or any other error.
 */
export function isPortListening(port, host = SIM_HOST) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** True iff the sim dev server at 127.0.0.1:6969 is currently listening. */
export function isSimServerUp() {
  return isPortListening(SIM_PORT, SIM_HOST);
}

/** The reason string these suites use when skipping — names the port and says
 * the sim must be running. */
export const SIM_SERVER_SKIP_REASON =
  `simulation dev server is not listening on ${SIM_HOST}:${SIM_PORT} — start it with ` +
  '`cd simulation && npm start` before running this browser-driven suite';

/**
 * Resolve the `skip` value for a node:test `test(name, options, fn)` call:
 * `false` when the sim is up (test runs normally), or the named reason
 * string when it is not (node:test reports the test as skipped, with this
 * reason).
 *
 * @returns {Promise<false|string>}
 */
export async function simServerSkip() {
  return (await isSimServerUp()) ? false : SIM_SERVER_SKIP_REASON;
}
