/**
 * smokestack_status_service.cjs — read-only DMX ⇄ swarm GLANCE for the four
 * smokestack rope controllers (save-server route `POST /smokestack/status`).
 *
 * Runs SERVER-SIDE for the same reason the reachability probe does: the
 * browser cannot make a cross-origin HTTP call to a board. Per board it
 * performs exactly two GETs against the MarsinLED HTTP API surface —
 * `GET /api/status` then `GET /api/config` — and derives:
 *
 *   reachable      did /api/status answer with a recognizable body?
 *   dmxEnabled     config `dmx.enabled` — the mode source of truth
 *                  (true = DMX render, false = native swarm render);
 *                  null when the config could not be read.
 *   swarm          {enabled, isLeader, followState, lastBeaconMsAgo}
 *   health         {configSource, stagedPending, uptimeMs}
 *   capabilities   {perOutputDmx} — the only capability the switch flow gates on
 *   sacn           {perOutput} — the board's RUNTIME per-strand sACN origins,
 *                  or null when it reported none (Advanced Recovery renders
 *                  a missing array as UNVERIFIED, never as agreement)
 *   controllerId / firmwareTag / fps — the board's own identity + vitals
 *
 * ZERO MUTATION, ever. This service has no POST path at all — the mode SWITCH
 * runs exclusively through the private deploy CLI (smokestack_cli_service.cjs),
 * with its registry/MAC gates intact. A board whose config cannot be read
 * reports `dmxEnabled: null` — never a guessed mode (codex P0).
 *
 * Transport is INJECTABLE (`opts.io.httpGetJson`) so the unit tests drive this
 * with fakes and never touch a real board. The real transport is the probe
 * service's hardened httpGetJson (absolute deadline + response byte cap).
 */

const {
  httpGetJson,
  isValidIp,
  validateTimeoutMs,
  DEFAULT_TIMEOUT_MS,
  PLACEHOLDER_IP,
} = require('./controller_probe_service.cjs');

// Four boards; a tiny fixed pool is plenty and keeps the sweep gentle.
const STATUS_CONCURRENCY = 4;

/** True iff a parsed /api/status body carries the MarsinLED fingerprint. */
function isMarsinLedStatus(status) {
  return !!status
    && typeof status.controllerId === 'string' && status.controllerId.length > 0
    && typeof status.boardId === 'string' && status.boardId.length > 0;
}

/**
 * Glance at ONE rope controller `{id, name, ip}`. Never rejects — an
 * unreachable board is a RESULT (`reachable: false` with the reason), not an
 * exception.
 */
async function smokestackBoardStatus(target, opts = {}) {
  const at = new Date().toISOString();
  const base = { id: target.id, name: target.name, at };
  const get = (opts.io && opts.io.httpGetJson) || httpGetJson;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const httpPort = Number.isInteger(opts.httpPort) ? opts.httpPort : 80;

  if (!target.ip || target.ip === PLACEHOLDER_IP || !isValidIp(target.ip)) {
    return {
      ...base,
      reachable: false,
      detail: `'${target.ip || ''}' is not a probeable IPv4 address`,
    };
  }

  let statusJson;
  try {
    const res = await get(target.ip, '/api/status', timeoutMs, httpPort);
    if (res.status !== 200 || !isMarsinLedStatus(res.json)) {
      return {
        ...base,
        reachable: false,
        detail: `something answered on :${httpPort} but not with a MarsinLED /api/status ` +
          `(HTTP ${res.status}) — check the IP`,
      };
    }
    statusJson = res.json;
  } catch (err) {
    return {
      ...base,
      reachable: false,
      detail: `GET /api/status failed (${(err && err.code) || (err && err.message)})`,
    };
  }

  const sw = statusJson.swarm || {};
  const sacn = statusJson.sacn || {};
  const follow = sw.follow || {};
  const health = statusJson.health || {};
  const caps = statusJson.capabilitiesExt || {};

  const result = {
    ...base,
    reachable: true,
    detail: `MarsinLED ${statusJson.controllerId} (${statusJson.boardId})`,
    controllerId: statusJson.controllerId,
    firmwareTag: statusJson.firmwareTag,
    fps: statusJson.fps,
    swarm: {
      enabled: sw.enabled === true,
      isLeader: sw.isLeader === true,
      followState: typeof follow.state === 'string' ? follow.state : null,
      lastBeaconMsAgo: Number.isFinite(follow.lastBeaconMsAgo) ? follow.lastBeaconMsAgo : null,
    },
    health: {
      configSource: health.configSource,
      stagedPending: health.stagedPending,
      uptimeMs: health.uptimeMs,
    },
    capabilities: { perOutputDmx: caps.perOutputDmx === true },
    // Runtime sACN origins the board reports per ENABLED strand
    // ({index, universe, startAddress, enabled}) — the same array the deploy
    // CLI's verify ladder compares against the saved strand origins. `null`
    // means the board did not report the array at all; the force-recovery
    // model renders that as UNVERIFIED, never as agreement.
    sacn: {
      perOutput: Array.isArray(sacn.perOutput)
        ? sacn.perOutput.map((entry) => ({
          index: Number.isInteger(entry && entry.index) ? entry.index : null,
          universe: Number.isFinite(entry && entry.universe) ? entry.universe : null,
          startAddress: Number.isFinite(entry && entry.startAddress)
            ? entry.startAddress : null,
          enabled: !!(entry && entry.enabled),
        }))
        : null,
    },
    dmxEnabled: null,
  };

  try {
    const cfg = await get(target.ip, '/api/config', timeoutMs, httpPort);
    if (cfg.status === 200 && cfg.json && typeof cfg.json === 'object') {
      const dmx = cfg.json.dmx || {};
      result.dmxEnabled = dmx.enabled === true;
    } else {
      result.detail += ` — GET /api/config HTTP ${cfg.status}, mode unknown`;
    }
  } catch (err) {
    result.detail += ` — GET /api/config failed (${(err && err.code) || (err && err.message)}), ` +
      'mode unknown';
  }

  return result;
}

/**
 * Glance at MANY rope controllers with a small bounded pool. Always returns
 * ONE result per target in input order — a board silently missing from the
 * answer would leave a row claiming a state nobody measured.
 *
 * @param {Array<{id, name, ip}>} targets
 * @param {{timeoutMs?, httpPort?, io?}} [opts]
 * @returns {Promise<{results: Array, at: string}>}
 */
async function smokestackStatusSweep(targets, opts = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const slot = cursor++;
      if (slot >= list.length) return;
      results[slot] = await smokestackBoardStatus(list[slot], opts);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(STATUS_CONCURRENCY, list.length) }, worker));
  return { results, at: new Date().toISOString() };
}

module.exports = {
  STATUS_CONCURRENCY,
  smokestackBoardStatus,
  smokestackStatusSweep,
  validateTimeoutMs,
};
