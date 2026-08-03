/**
 * controller_probe_service.cjs — ONLINE / OFFLINE / UNKNOWN reachability for
 * every controller in the scene (operator request 2026-07-31: "nice to have an
 * ONLINE/OFFLINE status for all DMX and LED controllers … make it fast and
 * parallel to not cause delays in the UI").
 *
 * Runs SERVER-SIDE (save-server route `POST /controllers/probe`). It has to:
 * the browser cannot open a raw TCP socket, and a cross-origin HTTP probe to a
 * DMX gateway would be blocked long before the answer came back. The page
 * therefore asks the sim's own server, which already owns the device hop for
 * the gamma routes (led_gamma_service.cjs).
 *
 * ── THREE STATES, AND WHY THE THIRD ONE EXISTS ──────────────────────────────
 *   online   something at that address answered us, right now.
 *   offline  we reached the network and nothing came back before the deadline.
 *   unknown  we did not, or could not, ask — no IP, the `0.0.0.0` placeholder
 *            sentinel, or an error class that says nothing about the box (a
 *            local socket limit, EACCES, a DNS failure).
 * `unknown` is not padding: codex P0 applies to what the UI CLAIMS just as much
 * as to what the code does. A probe we never performed must never render as a
 * confident "OFFLINE" dot — that is the same silent-lie shape as a green
 * surface over a dark rope.
 *
 * ── PER-TYPE PROBES (the transports differ, so the probes must) ─────────────
 *   LED (MarsinLED)  `GET http://<ip>/api/status`. These boards DO NOT ANSWER
 *                    ICMP (docs/41 §2, memory `marsinled-controller-onboarding`)
 *                    — ping would report every one of them offline. The reply
 *                    is also the board's fingerprint, so an LED probe doubles as
 *                    FIRST CONTACT for a provisional binding: the identity comes
 *                    back with the status and the panel can promote (see
 *                    src/dmx/led/provisional_binding.js).
 *   DMX gateway      TCP connect to a small port ladder (80, then 8080). sACN
 *                    and Art-Net receivers answer nothing on their data path by
 *                    design — an E1.31 sink has no query verb — so there is no
 *                    protocol-level "are you there". A TCP SYN is the honest
 *                    substitute, and its FAILURE MODE carries the signal:
 *                    ECONNREFUSED/ECONNRESET means a live IP stack said "not
 *                    that port", which PROVES the box is on the network. Only a
 *                    timeout or an unreachable-host error is OFFLINE.
 *                    (Deliberately NOT ICMP: raw sockets need admin on Windows,
 *                    and shelling out to `ping` per controller is neither fast
 *                    nor portable. Deliberately NOT ArtPoll: only Art-Net nodes
 *                    answer it, so it would silently mis-report every sACN
 *                    gateway — exactly the fallback-shaped lie P0 bans.)
 *
 * FAST + PARALLEL: probes run concurrently under a bounded pool with a short
 * per-probe deadline, and the last verdict is cached, so the UI renders from
 * cache instantly and never blocks on the network.
 *
 * Every transport is INJECTABLE (`opts.io`) so the unit tests drive this with
 * fakes and never touch a real board.
 */

const http = require('http');
const net = require('net');

const STATE_ONLINE = 'online';
const STATE_OFFLINE = 'offline';
const STATE_UNKNOWN = 'unknown';
const PROBE_STATES = [STATE_ONLINE, STATE_OFFLINE, STATE_UNKNOWN];

// The repo's own "no address yet" sentinel (report 20260725_92 §1) — a
// reservation, not an address. Probing it would be meaningless.
const PLACEHOLDER_IP = '0.0.0.0';

const DEFAULT_TIMEOUT_MS = 1200;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_CACHE_TTL_MS = 5000;
const DMX_PROBE_PORTS = [80, 8080];

// A probe timeout is a wall-clock budget in milliseconds. It must be a finite
// number strictly greater than zero and no larger than this ceiling — a
// negative value is what `socket.setTimeout` throws ERR_OUT_OF_RANGE on
// (report 20260725_109 P1-1, the save-server process kill), and an absurdly
// large value would let one slow host hold a pool slot for minutes.
const MAX_TIMEOUT_MS = 60_000;

// A single /api/status body is a few hundred bytes; a MarsinLED never sends
// megabytes. Cap what we absorb so a hostile or broken host on :80 cannot make
// us buffer an unbounded response (report 20260725_109 P2-10: 48 MB absorbed
// whole). Past the cap we abort the read and classify the host — it answered,
// so it is ONLINE-but-unrecognized, never a silent OOM.
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Validate a caller-supplied probe timeout. Returns the number when it is a
 * finite value in (0, MAX_TIMEOUT_MS]; throws a named Error otherwise so the
 * HTTP route can answer 400 instead of forwarding a value that crashes the
 * socket. `undefined`/`null` are allowed (the caller falls back to the default).
 */
function validateTimeoutMs(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`timeoutMs must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be > 0 and <= ${MAX_TIMEOUT_MS}, got ${value}`);
  }
  return value;
}

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIp(ip) {
  const m = IP_RE.exec(String(ip || ''));
  if (!m) return false;
  return m.slice(1).every((octet) => Number(octet) <= 255);
}

/** Error codes that mean the HOST answered (so it is up), just not on that port. */
const HOST_ANSWERED_CODES = ['ECONNREFUSED', 'ECONNRESET'];
/** Error codes that mean we asked and the network said no. */
const HOST_UNREACHABLE_CODES = ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN'];

/**
 * TCP connect probe against one port. Resolves
 * `{state, detail, rttMs}` — never rejects: an unreachable box is a RESULT
 * here, not an exception (the loud-failure rule is about hiding things, and
 * "offline" hides nothing).
 */
function tcpProbe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let deadline = null;
    const finish = (state, detail) => {
      if (settled) return;
      settled = true;
      if (deadline) { clearTimeout(deadline); deadline = null; }
      try { socket.destroy(); } catch { /* already gone */ }
      resolve({ state, detail, rttMs: Date.now() - started });
    };
    const socket = net.connect({ host: ip, port });
    // Register the `error` handler BEFORE any call that can throw. A still-
    // connecting socket with no `error` listener whose connect later fails
    // emits an UNHANDLED 'error' and exits the process — this is the exact
    // shape of the save-server kill (report 20260725_109 P1-1): `setTimeout`
    // threw on a bad value before the listener below was attached.
    socket.on('error', (err) => {
      const code = err && err.code;
      if (HOST_ANSWERED_CODES.includes(code)) {
        // A live IP stack sent us a refusal. The box IS on the network.
        finish(STATE_ONLINE, `tcp/${port} refused (${code}) — the host is on the network`);
      } else if (HOST_UNREACHABLE_CODES.includes(code)) {
        finish(STATE_OFFLINE, `${code} on tcp/${port}`);
      } else {
        // Anything else says something about OUR machine, not the board.
        finish(STATE_UNKNOWN, `probe error ${code || (err && err.message)} on tcp/${port}`);
      }
    });
    socket.on('connect', () => finish(STATE_ONLINE, `tcp/${port} open`));
    socket.on('timeout', () => finish(STATE_OFFLINE,
      `no answer on tcp/${port} within ${timeoutMs} ms`));
    // ABSOLUTE deadline (report 20260725_109 P1-3): socket idle timeouts reset
    // on activity, so a slow-drip host can hold a probe far past `timeoutMs`
    // and wedge the whole pool. This timer fires no matter what and caps the
    // probe's total wall-clock at `timeoutMs`.
    deadline = setTimeout(() => finish(STATE_OFFLINE,
      `no answer on tcp/${port} within absolute ${timeoutMs} ms deadline`), timeoutMs);
    // `setTimeout` throws ERR_OUT_OF_RANGE for a negative/NaN value. The route
    // validates first, but a bad value reaching here (a direct caller, a future
    // regression) must still not crash: the `error` listener is already
    // attached, and this catch turns the throw into an honest UNKNOWN.
    try {
      socket.setTimeout(timeoutMs);
    } catch (err) {
      finish(STATE_UNKNOWN, `invalid probe timeout ${JSON.stringify(timeoutMs)}: ${err.message}`);
    }
  });
}

/**
 * DMX-gateway probe: walk the port ladder and take the FIRST verdict that is
 * not `offline`. A refusal on :80 is a better answer than a timeout on :8080,
 * and an `unknown` (our machine misbehaving) must not be buried under a
 * meaningless offline.
 */
async function probeDmxController(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const ports = opts.ports || DMX_PROBE_PORTS;
  const connect = (opts.io && opts.io.tcpProbe) || tcpProbe;
  let last = { state: STATE_OFFLINE, detail: 'no ports probed', rttMs: 0 };
  for (const port of ports) {
    const res = await connect(ip, port, timeoutMs);
    if (res.state !== STATE_OFFLINE) return { ...res, probe: `tcp:${port}` };
    last = { ...res, probe: `tcp:${port}` };
  }
  return last;
}

/**
 * One HTTP GET with a hard deadline. Resolves `{status, json, rttMs}`; rejects
 * with an Error carrying `.code` for the classifier.
 */
function httpGetJson(ip, urlPath, timeoutMs, port = 80) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (deadline) { clearTimeout(deadline); deadline = null; }
      fn(arg);
    };
    const req = http.request({ host: ip, port, path: urlPath, method: 'GET', timeout: timeoutMs },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            // The host is clearly up (it is streaming at us), just not a sane
            // MarsinLED — stop reading rather than buffer an unbounded body.
            res.destroy();
            settle(resolve, { status: res.statusCode, json: null, rttMs: Date.now() - started,
              overflow: true });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* reported as null */ }
          settle(resolve, { status: res.statusCode, json, rttMs: Date.now() - started });
        });
        res.on('error', (err) => settle(reject, err));
      });
    req.on('timeout', () => {
      const err = new Error(`no answer within ${timeoutMs} ms`);
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (err) => settle(reject, err));
    // ABSOLUTE deadline (report 20260725_109 P1-3): `timeout` above is an IDLE
    // timeout — a slow-drip host emitting one byte per interval resets it
    // forever and held a probe 10.4 s in the red-team measurement, wedging
    // every later sweep. This timer caps the probe's TOTAL wall-clock so one
    // misbehaving host can never stall the pool.
    let deadline = setTimeout(() => {
      const err = new Error(`absolute probe deadline ${timeoutMs} ms exceeded`);
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    }, timeoutMs);
    req.end();
  });
}

/** True iff a parsed /api/status body carries the 3-field MarsinLED fingerprint. */
function isMarsinLedStatus(status) {
  return !!status
    && typeof status.controllerId === 'string' && status.controllerId.length > 0
    && typeof status.boardId === 'string' && status.boardId.length > 0
    && Array.isArray(status.strands);
}

/**
 * LED-controller probe: `GET /api/status`. On a hit the board's own identity
 * rides back on the result as `device` — this is the FIRST CONTACT payload the
 * provisional-binding promote flow consumes.
 */
async function probeLedController(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const get = (opts.io && opts.io.httpGetJson) || httpGetJson;
  // `httpPort` exists so the tests can stand a real stub board on a loopback
  // port. Production always uses 80 — that is the only port MarsinLED firmware
  // serves (docs/41 §2).
  const httpPort = Number.isInteger(opts.httpPort) ? opts.httpPort : 80;
  try {
    const res = await get(ip, '/api/status', timeoutMs, httpPort);
    if (isMarsinLedStatus(res.json)) {
      const status = res.json;
      return {
        state: STATE_ONLINE,
        detail: `MarsinLED ${status.controllerId} (${status.boardId})`,
        rttMs: res.rttMs,
        probe: 'http:/api/status',
        device: {
          ip,
          controllerId: status.controllerId,
          boardId: status.boardId,
          deviceName: status.deviceName,
          firmwareSHA: status.firmwareSHA,
          strands: status.strands,
          raw: status,
        },
      };
    }
    // Something is listening on :80 and it is NOT a MarsinLED. The HOST is
    // unambiguously online; say so, and say loudly what answered — an operator
    // typo landing on the office printer must not read as a healthy board.
    return {
      state: STATE_ONLINE,
      detail: `HTTP ${res.status} on :80, but the body is not a MarsinLED /api/status ` +
        '— check the IP',
      rttMs: res.rttMs,
      probe: 'http:/api/status',
      device: null,
      unrecognized: true,
    };
  } catch (err) {
    const code = err && err.code;
    if (HOST_ANSWERED_CODES.includes(code)) {
      return {
        state: STATE_ONLINE,
        detail: `:80 refused (${code}) — the host is on the network but its web API is not ` +
          'answering; a MarsinLED always serves /api/status, so check the IP',
        rttMs: 0,
        probe: 'http:/api/status',
        device: null,
        unrecognized: true,
      };
    }
    if (HOST_UNREACHABLE_CODES.includes(code)) {
      return { state: STATE_OFFLINE, detail: `${code} — no answer on :80`, rttMs: 0, probe: 'http:/api/status' };
    }
    return {
      state: STATE_UNKNOWN,
      detail: `probe error ${code || (err && err.message)}`,
      rttMs: 0,
      probe: 'http:/api/status',
    };
  }
}

/**
 * Probe ONE controller target `{id, name, ip, type}`. Never rejects.
 * A target we cannot legitimately probe returns `unknown` WITH THE REASON —
 * it is never downgraded to `offline`.
 */
async function probeController(target, opts = {}) {
  const at = new Date().toISOString();
  const base = { id: target.id, ip: target.ip, type: target.type, at };
  if (!target.ip || String(target.ip).trim().length === 0) {
    return { ...base, state: STATE_UNKNOWN, detail: 'no IP set on this controller', probe: 'none' };
  }
  if (target.ip === PLACEHOLDER_IP) {
    return {
      ...base,
      state: STATE_UNKNOWN,
      detail: `${PLACEHOLDER_IP} is the placeholder sentinel — a reserved patch with no address ` +
        'yet, so there is nothing to reach',
      probe: 'none',
      placeholder: true,
    };
  }
  if (!isValidIp(target.ip)) {
    return {
      ...base,
      state: STATE_UNKNOWN,
      detail: `'${target.ip}' is not a valid IPv4 address`,
      probe: 'none',
    };
  }
  const res = target.type === 'LED'
    ? await probeLedController(target.ip, opts)
    : await probeDmxController(target.ip, opts);
  return { ...base, ...res };
}

// ── Last-verdict cache (so the UI paints instantly and never waits) ──────────
// key = `${type}:${ip}` — the verdict is a property of the BOX, not of the card,
// so two cards on one address share it and a scene switch cannot serve a stale
// answer for a different box.
const probeCache = new Map();

function cacheKey(target) {
  return `${target.type}:${target.ip}`;
}

function getCachedProbe(target, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const hit = probeCache.get(cacheKey(target));
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > ttlMs) return null;
  return hit.result;
}

function clearProbeCache() {
  probeCache.clear();
}

/**
 * Probe MANY controllers, concurrently, with a bounded pool.
 *
 * @param {Array<{id, name?, ip, type}>} targets
 * @param {{timeoutMs?, concurrency?, cacheTtlMs?, force?, io?, ports?}} [opts]
 *   `force` bypasses the cache for this sweep. `io` injects the transports.
 * @returns {Promise<{results: Array, at: string, probed: number, cached: number}>}
 *   Never rejects, and always returns ONE result per target in input order —
 *   a controller silently missing from the answer would leave a card with a
 *   stale dot and no way to know.
 */
async function probeControllers(targets, opts = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const concurrency = Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY);
  const ttlMs = Number.isFinite(opts.cacheTtlMs) ? opts.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const results = new Array(list.length);
  let cached = 0;
  let probed = 0;

  // De-duplicate WITHIN the sweep as well as across sweeps: two cards on one
  // address are one box, and probing it twice in the same pass would double the
  // packets for an answer that cannot differ.
  const byBox = new Map(); // cacheKey → { target, indexes: [] }
  list.forEach((target, index) => {
    if (!opts.force) {
      const hit = getCachedProbe(target, ttlMs);
      if (hit) {
        results[index] = { ...hit, id: target.id, fromCache: true };
        cached += 1;
        return;
      }
    }
    const key = cacheKey(target);
    if (byBox.has(key)) byBox.get(key).indexes.push(index);
    else byBox.set(key, { target, indexes: [index] });
  });
  const queue = [...byBox.values()];

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const slot = cursor++;
      if (slot >= queue.length) return;
      const { target, indexes } = queue[slot];
      const result = await probeController(target, opts);
      probeCache.set(cacheKey(target), { cachedAt: Date.now(), result });
      for (const index of indexes) {
        results[index] = { ...result, id: list[index].id, fromCache: false };
      }
      probed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  return { results, at: new Date().toISOString(), probed, cached };
}

module.exports = {
  STATE_ONLINE,
  STATE_OFFLINE,
  STATE_UNKNOWN,
  PROBE_STATES,
  PLACEHOLDER_IP,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_CACHE_TTL_MS,
  DMX_PROBE_PORTS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  validateTimeoutMs,
  clearProbeCache,
  getCachedProbe,
  isValidIp,
  probeController,
  probeControllers,
  probeDmxController,
  probeLedController,
  tcpProbe,
};
