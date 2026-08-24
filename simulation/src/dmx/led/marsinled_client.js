/**
 * marsinled_client.js — browser ES module for talking to MarsinLED LED-string
 * controllers over their HTTP JSON API (port 80). No dependencies: plain
 * `fetch`, `AbortController`, `setTimeout` — all available in the sim browser
 * and in Node 18+ (so the unit tests run with a stubbed global `fetch`).
 *
 * This is the discovery + read/write transport half of the LED integration
 * (plan 20260709_0, phase P1; device behavior: docs/41). It knows the device's
 * wire protocol and NOTHING about the sim's controller registry — the pure
 * derivation lives in device_config_mapper.js.
 *
 * Contract highlights (docs/41 §2–§4, codex P0 — fail loudly, no fallbacks):
 *  - Fingerprint: a host is a MarsinLED iff `GET /api/status` is `res.ok` and
 *    parses as JSON carrying `controllerId` AND `boardId` AND `strands`.
 *  - `probeDevice` returns `null` on a miss — that is the DESIGNED result of
 *    sweeping 254 IPs where most never answer, NOT a swallowed error. Every
 *    other call (getConfig/getStatus/pushForcedConfig/pushDmxToggle/
 *    rebootDevice) targets a device the operator chose, so it THROWS on any
 *    failure.
 *  - There are exactly TWO writers — the narrowed forced push
 *    (`buildForcedConfigBody` → `pushForcedConfig`) and the DMX toggle
 *    (`buildDmxToggleBody` → `pushDmxToggle`). Both build their body from ONE
 *    `GET /api/config` snapshot and both post it through the single
 *    `postConfigBody` seam, which refuses wifi/boardType/swarm/network/identity
 *    keys and surfaces an HTTP 400's `{field, detail}` verbatim. (The generic
 *    partial-body `pushConfig` + `validatePushPayload` path was DELETED once
 *    per-output became the only push style — nothing called it.)
 *  - No polling loops except the explicit `awaitReboot`.
 */

// ── Constants ───────────────────────────────────────────────────────────────

// ── Device timing budgets (measured on the live rig, not guessed) ───────────
// Two measurements set every budget below:
//   1. A COLD MarsinLED takes ~5 s to first HTTP byte (titanic_202 2026-07-10:
//      first GET 4984 ms, warm GETs 162–236 ms — ARP/WiFi wake-up, not CORS).
//   2. A per-output config write makes the device REBOOT, and the reboot was
//      measured at ~11 s on the live rig (report 20260725_56 addendum) —
//      POST reply to the device answering HTTP again.
// A single flat 5000 ms budget spanning the write is therefore GUARANTEED to
// fail on healthy hardware; that is exactly the failure the operator hit
// ("timed out after 5000 ms — device did not respond", report 20260725_69).
// Every phase of a push now carries its own budget, sized off (1) and (2).

// Probe timeout: 600ms aborted before any cold device could answer, so
// discovery reported an empty subnet. 6500ms covers the cold case with margin;
// the larger batch keeps the full /24 sweep ≈4 batches (~26s worst case).
const DEFAULT_PROBE_TIMEOUT_MS = 6500;  // per-IP scan probe (docs/41 §2)
const DEFAULT_BATCH_SIZE = 64;          // 254 IPs / 64 ≈ 4 Promise.all batches

// One read (or a legacy write) on a device the operator CHOSE. 5000 ms sat
// right on top of the ~5 s cold-first-byte measurement — a coin flip on the
// first call after the device has been idle. 8000 ms clears it with margin and
// still fails fast on a genuinely dead host.
export const DEFAULT_HTTP_TIMEOUT_MS = 8000;

// POST /api/config carrying a per-output mapping. Mapping changes may reboot the
// device, and a reboot can drop the HTTP reply. This budget gives the persist
// room to answer and overlaps the reboot when the reply is lost.
export const PER_OUTPUT_WRITE_TIMEOUT_MS = 12000;

// Overall budget for "the device is rebooting — wait for it to answer again".
// Reboot measured at ~11 s; 45 s is honest headroom for a cold WiFi
// re-associate on top of it, and it is a HARD deadline (no infinite spinner).
export const REBOOT_WAIT_TIMEOUT_MS = 45000;
export const REBOOT_POLL_INTERVAL_MS = 1000;

// ── Post-reboot READ retry (live evidence, seen twice on 4 real boards) ──────
// `awaitReboot` returns the moment ONE `/api/status` probe answers. On real
// hardware that first answer is not the same thing as "the board is serving
// reads again": the WiFi re-association finishes AFTER the first reply, and for
// a few seconds the board drops further requests. The verify's `getStatus` +
// `getConfig` each got a single 8 s attempt, so they timed out and the push
// declared a FALSE FAIL over a write that had in fact applied (proven by a
// later read-back).
//
// So the READ side — and ONLY the read side — retries on TIMEOUT. This never
// re-builds and never re-POSTs a body: the one-snapshot rule is untouched, and
// a device that ANSWERED (any non-2xx) is still a definite, immediate failure.
export const VERIFY_READ_ATTEMPTS = 4;
export const VERIFY_READ_BUDGET_MS = 30000;
export const VERIFY_READ_RETRY_DELAY_MS = 1500;

// docs/41 §4.2 validation bounds — mirrored client-side so a bad payload is
// rejected before it ever leaves the browser (loud, with the offending field).
// Only the bounds the SURVIVING writers check are kept: the per-output plan
// validator (universe range, colorOrder, count) and the deviceName repair. The
// strand-array / globalBrightness / maxMilliamps bounds went out with the
// generic `pushConfig` path this repo no longer has (nothing built those keys).
const SACN_UNIVERSE_MIN = 1;
const SACN_UNIVERSE_MAX = 63999;
const DEVICE_NAME_MAX = 32;
const COLOR_ORDER_RE = /^[RGBWA]{3,5}$/;

// The firmware's own deviceName rule (docs/41 §4.2, and the exact `detail` the
// device returns): 1–32 chars, letters/digits/-._ only. NO spaces.
export const DEVICE_NAME_RE = new RegExp(`^[A-Za-z0-9._-]{1,${DEVICE_NAME_MAX}}$`);
export const DEVICE_NAME_RULE_TEXT = `1-${DEVICE_NAME_MAX} chars, letters/digits/-._ only`;

// Per-output DMX (firmware capabilitiesExt.perOutputDmx). A MarsinLED that
// advertises it can carry a distinct sACN universe per strand — the sim assigns
// one universe per enabled output with dmxStartAddress ALWAYS 1 (the operator's
// convention). Firmware guardrails mirrored client-side (avoid 400s):
const DMX_UNIVERSE_SIZE = 512;          // channels 1–512 in one universe
const PER_OUTPUT_START_ADDRESS = 1;     // convention: always 1 per output
const PER_OUTPUT_SPAN_MAX = 16;         // (maxUniverse − minUniverse + 1) ≤ 16

// Keys the sim's patch flow must NEVER write (docs/41 §4.1, plan P1). A push
// payload carrying any of these is a bug — refuse it loudly rather than risk
// re-homing the network or renaming the device from the sim.
//
// The list is ASSERTED at the single write seam (`postConfigBody`), so it
// covers every body this module can post.
//
// ONE declared exception, and it is neither a rename nor a re-home:
// `deviceName`, when the device's STORED name is invalid, because such a board
// rejects every config write until it is fixed (see the deviceName section
// below). Both writers (`buildForcedConfigBody` / `buildDmxToggleBody`) add it
// only through `deviceNameRepairForPush`.
//
// `swarm` is NOT an exception any more (report `_363` §2.1, operator rulings
// 6/7 — `_362`'s Q1 is WITHDRAWN). NOTHING in this module writes a `swarm`
// key: the board's swarm config survives byte-for-byte because it is simply
// never mentioned, and swarm is managed by the operator on the controller's
// own web UI. `wifi` is NOT written either — the board's AP stays up after a
// push, which is cosmetic, not output ownership.
const DENIED_PUSH_KEYS = [
  'wifi', 'deviceName', 'boardType', 'boardTypes', 'swarm',
  'networkMode', 'enableMesh', 'controllerId',
];

/**
 * @typedef {Object} DiscoveredDevice
 * @property {string} ip
 * @property {string} controllerId
 * @property {string|undefined} deviceName   // absent from /api/status; in /api/config
 * @property {string} boardId
 * @property {string|undefined} boardType
 * @property {string|undefined} mac
 * @property {string|undefined} firmwareSHA
 * @property {string|undefined} firmwareTag
 * @property {string|undefined} version
 * @property {string|undefined} languageVersion
 * @property {number|undefined} fps
 * @property {number|undefined} pixelCount
 * @property {Array<Object>} strands
 * @property {Object|undefined} sacn
 * @property {Array<Object>|undefined} outputs
 * @property {string|undefined} networkMode
 * @property {Object} raw   // the full /api/status body
 */

// ── Subnet helpers (identical shape to CaptainPad useServerDiscovery) ────────

/**
 * Validate a user-supplied /24 prefix like "10.1.1". Returns the normalized
 * prefix (no trailing dot) or null if invalid — byte-for-byte the same rules
 * as CaptainPad's normalizeSubnetPrefix.
 */
export function normalizeSubnetPrefix(input) {
  const trimmed = (input || '').trim().replace(/\.+$/, '');
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
  }
  return parts.join('.');
}

// ── Low-level fetch with per-request timeout ─────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    // The only thing that aborts this signal is OUR timer (scanSubnet's own
    // cancel signal is checked between batches, never wired into fetch here), so
    // a fire from `timedOut` is unambiguously a timeout. Translate the raw
    // AbortError ("signal is aborted without reason") into a legible, human-
    // readable timeout — fail loud, but not cryptic (G6). Every other fetch
    // rejection (connection refused, DNS, etc.) propagates verbatim.
    if (timedOut) {
      const timeoutErr = new Error(`timed out after ${timeoutMs} ms — device did not respond`);
      // Marked so a caller can tell "the device gave us NO answer" (ambiguous —
      // the write may still have applied) from "the device answered and said no"
      // (definite). The per-output push reads the device back on the former.
      timeoutErr.timedOut = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Discovery ────────────────────────────────────────────────────────────────

function buildDiscoveredDevice(ip, status) {
  return {
    ip,
    controllerId: status.controllerId,
    deviceName: status.deviceName,      // undefined from /api/status (lives in config)
    boardId: status.boardId,
    boardType: status.boardType,
    mac: status.mac,
    firmwareSHA: status.firmwareSHA,
    firmwareTag: status.firmwareTag,
    version: status.version,
    languageVersion: status.languageVersion,
    fps: status.fps,
    pixelCount: status.pixelCount,
    strands: status.strands,
    sacn: status.sacn,
    outputs: status.outputs,
    networkMode: status.networkMode,
    raw: status,
  };
}

/**
 * True iff a parsed `/api/status` body carries the 3-field MarsinLED
 * fingerprint (docs/41 §2): a non-empty `controllerId`, a non-empty `boardId`
 * and a `strands` array.
 *
 * THE fingerprint — there is exactly one implementation. The server-side
 * reachability probe (`server/controller_probe_service.cjs`) kept a byte-for-
 * byte copy of it; that copy is gone and the CJS service now `require(esm)`s
 * this export, the same bridge `led_gamma_service.cjs` uses for the deviceName
 * doctrine. Two definitions of "is this a MarsinLED" is exactly the kind of
 * drift that makes the browser and the server disagree about the same board.
 */
export function isMarsinLedStatus(status) {
  return !!status
    && typeof status.controllerId === 'string' && status.controllerId.length > 0
    && typeof status.boardId === 'string' && status.boardId.length > 0
    && Array.isArray(status.strands);
}

/**
 * Probe a single IP for a MarsinLED controller.
 * @param {string} ip
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<DiscoveredDevice|null>} null on any miss (unreachable, not
 *   ok, non-JSON, or fingerprint mismatch) — the expected result across a
 *   subnet sweep, never a swallowed hard error.
 */
export async function probeDevice(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  try {
    const res = await fetchWithTimeout(`http://${ip}/api/status`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return null;
    const status = await res.json();
    if (!isMarsinLedStatus(status)) return null;
    return buildDiscoveredDevice(ip, status);
  } catch {
    // Timeout / connection refused / non-JSON — this IP is simply not a
    // MarsinLED. Returning null (not throwing) is the point of a sweep.
    return null;
  }
}

/**
 * Sweep a /24 subnet for MarsinLED controllers, mirroring CaptainPad's scan
 * (`.1`–`.254`, Promise.all batches of 32, per-IP AbortController timeout).
 * Cancellable via `options.signal` (an AbortSignal) — the loop stops between
 * batches when it aborts.
 *
 * @param {string} prefix - "a.b.c"; validated by normalizeSubnetPrefix (throws
 *   loudly if malformed — an invalid target is an operator error, not a miss).
 * @param {{onProgress?: Function, batchSize?: number, timeoutMs?: number,
 *          signal?: AbortSignal}} [options]
 * @returns {Promise<DiscoveredDevice[]>} discovered devices, deduped by IP.
 */
export async function scanSubnet(prefix, options = {}) {
  const normalized = normalizeSubnetPrefix(prefix);
  if (!normalized) {
    throw new Error(`[MarsinLED] invalid subnet prefix '${prefix}' — expected "a.b.c" ` +
      '(three dotted octets, e.g. "10.1.1")');
  }
  const {
    onProgress,
    batchSize = DEFAULT_BATCH_SIZE,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signal,
  } = options;

  const candidates = [];
  for (let i = 1; i <= 254; i++) candidates.push(`${normalized}.${i}`);

  const found = [];
  const seen = new Set();
  let completed = 0;

  for (let start = 0; start < candidates.length; start += batchSize) {
    if (signal && signal.aborted) break;
    const batch = candidates.slice(start, start + batchSize);
    const results = await Promise.all(batch.map((ip) => probeDevice(ip, { timeoutMs })));
    completed += batch.length;
    for (const dev of results) {
      if (dev && !seen.has(dev.ip)) {
        seen.add(dev.ip);
        found.push(dev);
      }
    }
    if (onProgress) {
      onProgress({ completed, total: candidates.length, found: [...found] });
    }
  }
  return found;
}

// ── Reads (fail loud — a chosen device that won't answer is an error) ────────

/**
 * GET /api/status of a known device. Unlike probeDevice this THROWS on any
 * failure (the caller picked this IP; a dead answer is a real problem).
 */
export async function getStatus(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const res = await fetchWithTimeout(`http://${ip}/api/status`, { method: 'GET' }, timeoutMs);
  if (!res.ok) {
    throw new Error(`[MarsinLED] GET /api/status ${ip} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * GET /api/config — the full persisted config (strands with hardware fields +
 * dmx). Read this before every push so the derivation copies real hardware
 * fields (read-modify-write, plan "stability rules"). THROWS on failure.
 */
export async function getConfig(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const res = await fetchWithTimeout(`http://${ip}/api/config`, { method: 'GET' }, timeoutMs);
  if (!res.ok) {
    throw new Error(`[MarsinLED] GET /api/config ${ip} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Run a READ (or a read pair) and retry it, but ONLY when it TIMED OUT.
 *
 * WHY THIS EXISTS (live evidence, 2026-08-23, hit twice on real boards). After a
 * needs-reboot write, `awaitReboot` succeeds as soon as ONE `/api/status` probe
 * answers — but the board finishes re-associating to WiFi after that first
 * reply, and for a few seconds it drops further reads. The verify's
 * `getStatus`/`getConfig` had one 8 s attempt each, so they timed out and the
 * push reported a FALSE FAIL over a write that HAD applied.
 *
 * The contract, deliberately narrow:
 *  - retries ONLY a rejection carrying `err.timedOut === true` (the marker
 *    `fetchWithTimeout` sets when OUR abort timer fired). A device that
 *    ANSWERED — 400, 409, 500, anything — is a definite failure and is
 *    re-thrown IMMEDIATELY, never retried. So is any other rejection shape
 *    (connection refused, non-JSON, a thrown assert): fail loud, don't paper
 *    over an unknown error class with a retry loop.
 *  - it retries READS. It never re-builds a body and never re-POSTs one — the
 *    one-snapshot rule (`_362` §2.3-3) is untouched by design: this helper only
 *    ever receives a read closure.
 *  - it is BOUNDED twice over: at most `attempts` tries, and a new attempt only
 *    starts while the wall-clock budget still has room for it, so a wedged
 *    board can never hold the UI forever (codex P0 — no infinite spinner).
 *  - exhaustion THROWS, carrying `timedOut` (still true — every attempt timed
 *    out) plus `readRetriesExhausted` and the attempt count, so the caller's
 *    failure text can say how hard it tried.
 *
 * @param {Function} read - `() => Promise<any>`; the read to run (a PAIR of
 *   reads is fine — the whole closure is the retried unit).
 * @param {{attempts?: number, budgetMs?: number, retryDelayMs?: number,
 *          label?: string, onRetry?: Function}} [opts]
 *   `onRetry({attempt, attempts, elapsedMs, message})` fires after each timeout
 *   that will be retried, so a dialog can say "the board is still coming back".
 * @returns {Promise<any>} the read's value.
 */
export async function readWithRetryOnTimeout(read, opts = {}) {
  if (typeof read !== 'function') {
    throw new Error('[MarsinLED] readWithRetryOnTimeout: `read` must be a function returning a ' +
      'promise — this helper retries READS, never writes');
  }
  const attempts = opts.attempts ?? VERIFY_READ_ATTEMPTS;
  const budgetMs = opts.budgetMs ?? VERIFY_READ_BUDGET_MS;
  const retryDelayMs = opts.retryDelayMs ?? VERIFY_READ_RETRY_DELAY_MS;
  const label = opts.label || 'read';
  const onRetry = opts.onRetry;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`[MarsinLED] readWithRetryOnTimeout: attempts must be a positive integer ` +
      `(got ${JSON.stringify(opts.attempts)})`);
  }
  const started = Date.now();
  const deadline = started + budgetMs;
  let lastTimeout = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await read();
    } catch (err) {
      // ANSWERED failures (and every non-timeout rejection) propagate verbatim,
      // on the FIRST attempt. Only a timeout is ambiguous enough to be worth
      // asking again.
      if (!err || err.timedOut !== true) throw err;
      lastTimeout = err;
      const elapsedMs = Date.now() - started;
      if (attempt >= attempts) break;
      if (Date.now() + retryDelayMs >= deadline) break;
      if (onRetry) onRetry({ attempt, attempts, elapsedMs, message: err.message });
      await delay(retryDelayMs);
    }
  }
  const elapsedMs = Date.now() - started;
  const err = new Error(`[MarsinLED] ${label} timed out on every attempt ` +
    `(${Math.round(elapsedMs / 1000)}s, budget ${Math.round(budgetMs / 1000)}s): ` +
    `${lastTimeout.message}`);
  err.timedOut = true;
  err.readRetriesExhausted = true;
  err.cause = lastTimeout;
  throw err;
}

// ── Client-side validation (docs/41 §4.2) — reject before any POST ──────────

function assertInt(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`[MarsinLED] validation: ${field} must be an integer in ` +
      `${min}–${max} (got ${JSON.stringify(value)})`);
  }
}

// ── deviceName: the field the firmware re-validates on EVERY apply ──────────
//
// ROOT CAUSE (live, 2026-08-03, report 20260725_124). `ConfigManager::update`
// merges the partial body into the STORED config and then validates the WHOLE
// merged document. A device whose stored `deviceName` is invalid — the bench
// board at 10.x.x.60 stores `""` — therefore rejects EVERY `POST /api/config`
// with `field=deviceName`, including bodies that never mention the field. Proof:
// a no-op gamma write (`{"gamma":{"r":1,"g":1,"b":1,"w":1}}`, the values the
// device already held) came back
// `400 {"error":"config apply failed","field":"deviceName",
//       "detail":"1-32 chars, letters/digits/-._ only"}`.
//
// So the push CANNOT leave the field alone on such a board: not writing it is
// not "leaving the device as it is", it is "no config can ever be written
// again". The sim repairs it with the operator's OWN controller-card name,
// VERBATIM — there is no sanitizing, truncating or substituting (that would be
// the silent mangle the codex forbids). Either the card name is already a legal
// device name and gets written as-is, or the push refuses and says exactly what
// to rename. `deviceName` stays in DENIED_PUSH_KEYS for every other path: this
// is a repair of an unwritable device, never a rename of a working one.

/** True iff `name` satisfies the firmware's deviceName rule (1–32, [A-Za-z0-9._-]). */
export function isValidDeviceName(name) {
  return typeof name === 'string' && DEVICE_NAME_RE.test(name);
}

/**
 * Decide whether a push must also repair the device's stored `deviceName`.
 *
 * PURE (no I/O) — this is the payload-construction seam, so it is unit-testable
 * without a device.
 *
 *  - stored name VALID → `null`: the push writes no `deviceName` at all
 *    (preserve what the box holds — the sim never renames a working device).
 *  - stored name ABSENT from `GET /api/config` → `null`: a firmware that does
 *    not report the field is not one we can reason about, and inventing a name
 *    for it would be a rename nobody asked for.
 *  - stored name PRESENT and INVALID → `{from, to, message}`: the device is
 *    unwritable until it is fixed, so the push carries `deviceName =
 *    controllerName` **verbatim**, declared in the confirm dialog.
 *  - stored name PRESENT and INVALID, and the card name cannot be used as-is →
 *    THROWS naming exactly what to rename (no fallback, codex P0).
 *
 * @param {{ip: string, storedName: *, controllerName: *}} params
 * @returns {{from: string, to: string, message: string}|null}
 */
export function deviceNameRepairForPush({ ip, storedName, controllerName } = {}) {
  if (storedName === undefined) return null;   // firmware does not report the field
  if (isValidDeviceName(storedName)) return null;
  const stored = JSON.stringify(storedName);
  const why = `[MarsinLED] ${ip} stores an INVALID deviceName ${stored} — the firmware ` +
    're-validates the WHOLE config on every apply, so it rejects EVERY POST /api/config with ' +
    `field=deviceName (${DEVICE_NAME_RULE_TEXT}) until that name is fixed, even for a body that ` +
    'never mentions it. ';
  if (controllerName === undefined || controllerName === null || controllerName === '') {
    throw new Error(`${why}The push repairs it with this controller card's name, but no card name ` +
      'was supplied — name the controller, or set the device name once in its own web UI ' +
      `(http://${ip}/#config), then push again.`);
  }
  if (!isValidDeviceName(controllerName)) {
    throw new Error(`${why}The push repairs it with this controller card's name, but ` +
      `'${controllerName}' is not a legal device name either (${DEVICE_NAME_RULE_TEXT} — no ` +
      'spaces). RENAME THE CONTROLLER CARD to a legal name and push again, or set the device ' +
      `name once in the device's own web UI (http://${ip}/#config).`);
  }
  return {
    from: storedName,
    to: controllerName,
    message: `the device's stored deviceName ${stored} is invalid, which makes the firmware ` +
      `reject every config write — this push also sets deviceName to '${controllerName}' ` +
      "(this card's name, verbatim) so the write can land",
  };
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Low-level POST /api/config with a fully-formed body object. THE ONLY WRITE
 * SEAM in this module — `pushForcedConfig` (the narrowed push) and
 * `pushDmxToggle` both go through it, so the CORS + 400-surfacing logic lives
 * in ONE place. Callers are responsible for validating the body first (their
 * builders do).
 *
 * The write-scope doctrine is enforced HERE, at that one seam (see
 * DENIED_PUSH_KEYS): no body this module posts may carry a `wifi`, `swarm`,
 * `boardType`, `controllerId` or network key, and `deviceName` only under the
 * §4.1.1 repair. It used to be checked in `validatePushPayload`, on the generic
 * `pushConfig` path — which the narrowed push and the toggle never used and
 * which is now deleted, so the guard moved to where every write actually
 * passes rather than being deleted with its old caller.
 *
 * Content-Type text/plain (not application/json) keeps this a CORS "simple
 * request" so the browser does NOT send an OPTIONS preflight. The MarsinLED
 * firmware answers OPTIONS on unregistered routes with 404 (only /api/time has
 * an OPTIONS handler), and a non-2xx preflight makes the browser abort the POST
 * with "Failed to fetch". The firmware's POST /api/config handler parses the raw
 * body as JSON and ignores Content-Type, so text/plain is accepted identically.
 * Do NOT add custom headers here — any non-simple header would re-trigger the
 * preflight. (Fixed 2026-07-10.)
 *
 * @throws on HTTP 400 an Error carrying `.field` / `.detail` / `.fields` /
 *   `.deviceError` verbatim from the device (docs/41 §4 + per-output error body
 *   `{status, error, field, detail, fields:[{field,detail}]}`); on any other
 *   non-2xx a plain loud error.
 */
async function postConfigBody(ip, body, timeoutMs) {
  // The write-scope guard, at the one seam every write passes through. It is an
  // ASSERT on this module's own builders, not operator input — tripping it means
  // a body was constructed that would re-home the network, rename a working
  // device or overwrite the operator's swarm config, and the correct answer is
  // to refuse before the socket opens (codex P0).
  for (const key of DENIED_PUSH_KEYS) {
    if (!(key in body)) continue;
    // `deviceName` is the ONE declared exception (docs/41 §4.1.1, report
    // 20260725_124): a board storing an invalid name rejects EVERY config
    // write, so the push repairs it with the card's name, verbatim.
    if (key === 'deviceName') continue;
    throw new Error(`[MarsinLED] refusing to POST key '${key}' to ${ip} — the sim never writes ` +
      'wifi/boardType/swarm/network/identity config (docs/41 §4.1); this body should never have ' +
      'been built');
  }
  const res = await fetchWithTimeout(`http://${ip}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (res.status === 400) {
    const errBody = await res.json();
    const fieldDetails = Array.isArray(errBody.fields)
      ? errBody.fields.map((f) => `${f.field}: ${f.detail}`).join('; ') : '';
    const err = new Error(`[MarsinLED] ${ip} rejected config: ` +
      `${errBody.error || 'validation failed'}` +
      (errBody.field ? ` (field=${errBody.field})` : '') +
      (errBody.detail ? ` — ${errBody.detail}` : '') +
      (fieldDetails ? ` [${fieldDetails}]` : ''));
    err.field = errBody.field;
    err.detail = errBody.detail;
    err.fields = errBody.fields;
    err.deviceError = errBody;
    err.httpStatus = 400;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`[MarsinLED] POST /api/config ${ip} failed: ` +
      `HTTP ${res.status} ${res.statusText}`);
    // The device ANSWERED — this write definitively did not apply. Carrying the
    // status lets the per-output push tell it apart from a lost reply.
    err.httpStatus = res.status;
    throw err;
  }
  return res.json();
}

/**
 * POST /api/system/reboot. THROWS on an HTTP error reply. (The device may drop
 * the socket as it reboots — the normal patch flow relies on pushConfig's
 * needs-reboot auto-reboot + awaitReboot; this is the explicit escape hatch.)
 */
export async function rebootDevice(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const res = await fetchWithTimeout(`http://${ip}/api/system/reboot`, { method: 'POST' }, timeoutMs);
  if (!res.ok) {
    throw new Error(`[MarsinLED] POST /api/system/reboot ${ip} failed: HTTP ${res.status}`);
  }
  return true;
}

// ── Per-output DMX (each strand carries its own sACN universe) ───────────────

/**
 * Feature-detect: does this controller's firmware support a per-output sACN
 * universe? True iff `GET /api/status` carries `capabilitiesExt.perOutputDmx ===
 * true`. Firmware without it is too old — the caller MUST NOT send per-output
 * fields to it and falls back to the legacy global-mapping push unchanged.
 */
export function deviceSupportsPerOutput(status) {
  return !!status
    && !!status.capabilitiesExt
    && status.capabilitiesExt.perOutputDmx === true;
}

/**
 * Read the device's CONFIRMED per-output mapping from a `GET /api/status` body:
 * `sacn.perOutput = [{index, universe, startAddress, enabled}]`. Legacy (global
 * mapping) is an empty array. THROWS if the field is present but not an array
 * (a shape the sim never expects — fail loud, don't guess).
 */
export function readPerOutput(status) {
  if (!status || !status.sacn) return [];
  const perOutput = status.sacn.perOutput;
  if (perOutput === undefined || perOutput === null) return [];
  if (!Array.isArray(perOutput)) {
    throw new Error('[MarsinLED] readPerOutput: sacn.perOutput must be an array ' +
      `(got ${typeof perOutput})`);
  }
  return perOutput;
}

/**
 * Read the SAVED per-output mapping from a GET /api/config document. Mapping
 * pushes verify this surface, not the receiver's boot-runtime status.
 */
export function readConfiguredPerOutput(config) {
  if (!config || !Array.isArray(config.strands)) {
    throw new Error('[MarsinLED] readConfiguredPerOutput: config.strands must be an array');
  }
  return config.strands.map((strand, index) => ({
    index,
    universe: strand.dmxUniverse,
    startAddress: strand.dmxStartAddress,
    enabled: strand.enabled === true,
  }));
}

/**
 * Normalize an output→universe assignment to a `Map<number, number>`. Accepts a
 * `Map` or a plain object keyed by the (0-based) strand slot index.
 */
function normalizeUniverseMap(universeByOutputIndex) {
  const out = new Map();
  const put = (key, value) => {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`[MarsinLED] per-output: output index '${key}' must be a ` +
        'non-negative integer');
    }
    out.set(idx, value);
  };
  if (universeByOutputIndex instanceof Map) {
    for (const [k, v] of universeByOutputIndex) put(k, v);
  } else if (universeByOutputIndex && typeof universeByOutputIndex === 'object') {
    for (const [k, v] of Object.entries(universeByOutputIndex)) put(k, v);
  } else {
    throw new Error('[MarsinLED] per-output: universeByOutputIndex must be a Map or an ' +
      'object of {outputIndex: universe}');
  }
  return out;
}

/**
 * Client-side validation of a per-output plan against the firmware rules
 * (docs/41 §4 / this slice) — reject BEFORE any POST so a bad plan never earns a
 * device 400. THROWS on the first violation with a precise message. Returns the
 * computed `{spans, enabledIndices, universes}` on success.
 *
 * Rules:
 *  - ALL-OR-NONE: every ENABLED strand must get a universe (and only enabled
 *    strands may carry one).
 *  - RANGE: universe 1–63999; start address is always 1.
 *  - SPAN ≤ 16: (maxUniverse − minUniverse + 1) ≤ 16 across enabled outputs.
 *  - NO OVERLAP: with start=1 and a distinct universe per output, an output only
 *    collides if a strand longer than one universe (RGBW >128px, RGB >170px)
 *    spills into the next output's universe.
 *
 * @param {Array<Object>} strands - the device's `/api/config` strands array.
 * @param {Map|Object} universeByOutputIndex - output slot → assigned universe.
 */
export function validatePerOutputPlan(strands, universeByOutputIndex) {
  if (!Array.isArray(strands)) {
    throw new Error('[MarsinLED] validatePerOutputPlan: strands must be an array');
  }
  const uni = normalizeUniverseMap(universeByOutputIndex);

  const enabledIndices = [];
  strands.forEach((s, i) => { if (s && s.enabled === true) enabledIndices.push(i); });
  if (enabledIndices.length === 0) {
    throw new Error('[MarsinLED] per-output: no enabled strand to assign a universe to');
  }

  // Only enabled strands may carry a per-output universe.
  for (const idx of uni.keys()) {
    if (!enabledIndices.includes(idx)) {
      throw new Error(`[MarsinLED] per-output: output ${idx} carries a universe but is not an ` +
        'enabled strand — only enabled outputs take a per-output universe');
    }
  }
  // ALL-OR-NONE across the enabled outputs.
  const assigned = enabledIndices.filter((i) => uni.has(i));
  if (assigned.length !== enabledIndices.length) {
    throw new Error(`[MarsinLED] per-output: all-or-none — ${assigned.length}/${enabledIndices.length} ` +
      'enabled outputs have a universe; every enabled output must get one (start=1 each)');
  }

  // RANGE + per-output universe spans (start is always 1).
  const spans = [];
  for (const i of enabledIndices) {
    const universe = uni.get(i);
    assertInt(universe, SACN_UNIVERSE_MIN, SACN_UNIVERSE_MAX, `output ${i} dmxUniverse`);
    const order = strands[i].colorOrder;
    if (typeof order !== 'string' || !COLOR_ORDER_RE.test(order)) {
      throw new Error(`[MarsinLED] per-output: output ${i} colorOrder '${order}' must match ` +
        'RGBWA letters, length 3–5 (needed to size the universe span)');
    }
    const bytesPerPixel = order.length;
    const count = strands[i].count;
    assertInt(count, 1, Number.MAX_SAFE_INTEGER, `output ${i} count`);
    const pixelsPerUniverse = Math.floor(DMX_UNIVERSE_SIZE / bytesPerPixel);
    const extraUniverses = Math.ceil(count / pixelsPerUniverse) - 1;
    spans.push({ index: i, start: universe, end: universe + extraUniverses });
  }

  // SPAN ≤ 16 across enabled outputs.
  const starts = spans.map((s) => s.start);
  const minU = Math.min(...starts);
  const maxU = Math.max(...starts);
  const span = maxU - minU + 1;
  if (span > PER_OUTPUT_SPAN_MAX) {
    throw new Error(`[MarsinLED] per-output: universe span ${span} exceeds the ${PER_OUTPUT_SPAN_MAX}-` +
      `universe window (min U${minU}, max U${maxU})`);
  }

  // NO OVERLAP — sort by start, ensure each output ends before the next begins.
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1];
    const cur = sorted[k];
    if (cur.start <= prev.end) {
      throw new Error(`[MarsinLED] per-output: output ${prev.index} (U${prev.start}` +
        (prev.end > prev.start ? `–U${prev.end}` : '') + `) overlaps output ${cur.index} ` +
        `(U${cur.start}) — a strand longer than one universe spills into the next output's ` +
        'universe; give it more headroom or shorten the strand');
    }
  }

  return { spans, enabledIndices, universes: starts };
}

/**
 * Assert `plan` is a per-output plan object (`derivePerOutputPlan`'s result) and
 * return it. There is NO bare-map path: a caller that hands over only a universe
 * map would silently restore the pre-20260725_70 behaviour of leaving every
 * output's enable state alone, which is exactly what made "drive output 4 from
 * one port row" impossible (codex P0 — no fallbacks).
 */
function assertPerOutputPlan(plan, where) {
  if (!plan || typeof plan !== 'object' || !plan.universeByOutputIndex) {
    throw new Error(`[MarsinLED] ${where}: a per-output PLAN is required ` +
      '({universeByOutputIndex, assignments, …} from derivePerOutputPlan) — a bare universe ' +
      'map cannot express which outputs the push must enable and which it must disable');
  }
  return plan;
}

/**
 * Read-modify-write helper: return a NEW strands array carrying the FORCED plan.
 *
 * FORCE SEMANTICS (operator ruling, report `_362` §2.1). The sim's controller
 * panel is the SINGLE SOURCE OF TRUTH for what a board's outputs do, so this
 * transform is one-way and TOTAL: every output slot is written, none is passed
 * through untouched.
 *
 *  - HARDWARE TRUTH is copied from the board's own `GET /api/config` strand —
 *    `type`, `pinData`, `pinClock`, `colorOrder`, `rgbwMode`, `deadPixels` /
 *    `deadPixelIndices` and anything else the firmware stores there. docs/41
 *    §4.1(a) forbids inventing pins (the `angio4` pins are locked) and the sim
 *    does not model these fields; copying them is not "merging board tweaks",
 *    it is refusing to invent hardware identity.
 *  - An output the plan ASSIGNS gets `enabled: true`, `count` = the port's
 *    mapped pixel count, `dmxUniverse` = the plan's universe and
 *    `dmxStartAddress: 1`. The count is FORCED IN BOTH DIRECTIONS — this
 *    supersedes the older "count on an already-enabled output is hardware truth
 *    and is never rewritten" rule (report 20260725_70); the confirm dialog
 *    lists every count change before the write.
 *  - Every OTHER output gets `enabled: false`. This supersedes the older "the
 *    push NEVER writes enabled:false" ruling. No `dmxUniverse` /
 *    `dmxStartAddress` is written onto a disabled output — the sim states no
 *    universe for an output it is darkening.
 *
 * Pure (no I/O). The caller validates the APPLIED array — not the device's —
 * because only the applied array expresses the post-push enable state.
 *
 * @param {Array<Object>} strands - the device's `/api/config` strands array.
 * @param {Object} plan - `derivePerOutputPlan`'s result.
 */
export function applyForcedPlan(strands, plan) {
  if (!Array.isArray(strands)) {
    throw new Error('[MarsinLED] applyForcedPlan: strands must be an array');
  }
  assertPerOutputPlan(plan, 'applyForcedPlan');
  const uni = normalizeUniverseMap(plan.universeByOutputIndex);
  const countByIndex = new Map();
  for (const entry of plan.assignments || []) {
    if (!entry || !Number.isInteger(entry.outputIndex) || entry.outputIndex < 0) {
      throw new Error('[MarsinLED] applyForcedPlan: assignments[].outputIndex ' +
        `'${entry && entry.outputIndex}' must be a non-negative integer`);
    }
    assertInt(entry.pixelCount, 1, Number.MAX_SAFE_INTEGER,
      `assignments[output ${entry.outputIndex}].pixelCount`);
    countByIndex.set(entry.outputIndex, entry.pixelCount);
  }
  for (const index of uni.keys()) {
    if (index >= strands.length) {
      throw new Error(`[MarsinLED] applyForcedPlan: the plan assigns output ${index}, but the ` +
        `device reports only ${strands.length} output(s)`);
    }
    if (!countByIndex.has(index)) {
      throw new Error(`[MarsinLED] applyForcedPlan: output ${index} carries a universe but no ` +
        'assignment with a pixel count — a forced push writes count, universe and enable ' +
        'together, so a universe with no count is an incoherent plan');
    }
  }
  return strands.map((s, i) => {
    const next = { ...(s || {}) };
    if (uni.has(i)) {
      next.enabled = true;
      next.count = countByIndex.get(i);
      next.dmxUniverse = uni.get(i);
      next.dmxStartAddress = PER_OUTPUT_START_ADDRESS;
    } else {
      next.enabled = false;
      // A darkened output states NO universe. The board may have carried one
      // (it was enabled a moment ago), and leaving it on a disabled strand
      // violates the firmware's ALL-OR-NONE rule — "only enabled outputs may
      // carry a per-output universe" — which is a 400 on exactly the rope-board
      // case this force push exists for.
      delete next.dmxUniverse;
      delete next.dmxStartAddress;
    }
    return next;
  });
}

/**
 * Read the board's OWN saved `dmx` object out of a `GET /api/config` snapshot,
 * or THROW. Every MarsinLED config carries the block; a snapshot without it is
 * a shape this module refuses to reason about, because the alternative —
 * inventing a `dmx` object — would write blackout timeouts and a protocol
 * nobody chose onto the operator's board (codex P0: no fallbacks).
 *
 * Both writers (`buildForcedConfigBody`, `buildDmxToggleBody`) merge INTO this
 * object rather than sending a sparse `{enabled:…}`: the firmware merges the
 * partial body into the stored config and re-validates the whole document, and
 * sending the full block sidesteps every ambiguity about partial nested-object
 * merges.
 */
function requireSnapshotDmx(snapshot, where) {
  const dmx = snapshot && snapshot.dmx;
  if (!dmx || typeof dmx !== 'object' || Array.isArray(dmx)) {
    throw new Error(`[MarsinLED] ${where}: the snapshot carries no dmx object ` +
      `(got ${JSON.stringify(dmx)}) — every MarsinLED config has one, and this write merges ` +
      'into the board\'s own block rather than inventing it');
  }
  return dmx;
}

/**
 * Build the ONE `POST /api/config` body a forced push sends. PURE (no I/O), so
 * the confirm dialog previews the EXACT object that will be posted — the
 * payload shown and the payload written are the same value, not two
 * constructions of it.
 *
 * NARROWED by operator ruling 6 (report `_363` §2.1): the push forces exactly
 * three things — strand counts+enables, the per-output universes, and DMX ON.
 * It carries, and only carries:
 *
 *  - `strands` — the full array, read-modify-WRITE per entry (`applyForcedPlan`),
 *    validated against the firmware's per-output rules (`validatePerOutputPlan`)
 *    BEFORE any POST so a bad plan never earns a device 400. An assigned output
 *    gets `enabled:true`, the mapped `count`, its `dmxUniverse` and
 *    `dmxStartAddress: 1`; an unassigned output gets `enabled:false` with
 *    `dmxUniverse`/`dmxStartAddress` DELETED (D1 — the firmware's all-or-none
 *    per-output rule 400s on a disabled strand carrying a universe). EVERY
 *    other key of the entry — `type`, `colorOrder`, `rgbwMode`, pins,
 *    dead-pixel fields, any future key — passes through UNTOUCHED. Strand type
 *    and color order are explicitly NOT pushed: the operator manages chip type
 *    and color order on the controller itself.
 *  - `dmx` — `{...snapshot.dmx, enabled: true, protocol: 0}`. `enabled` is the
 *    third forced thing; `protocol: 0` is forced because the per-output
 *    universes being written are sACN-only by firmware rule (docs/41 §3.5), so
 *    a body stating ArtNet alongside them would be incoherent. `timeoutMs` and
 *    every other `dmx` key are PRESERVED from the board.
 *  - `deviceName` — ONLY when the stored name is invalid and therefore makes
 *    the firmware reject every write (`deviceNameRepairForPush`; the repaired
 *    value is `plan.controllerName` verbatim, and an unusable card name is a
 *    loud refusal BEFORE the POST, not a mangled name).
 *
 * NEVER carried: `swarm` (the board's swarm config is operator-managed and
 * survives byte-for-byte because it is never mentioned) and `gamma` (gone from
 * the sim's push surface entirely — ruling 7).
 *
 * @param {{snapshot: Object, plan: Object, ip?: string}} params
 *   `snapshot` is the GET /api/config document the plan was derived from — the
 *   SAME read, never a second one (that read-twice window is the drift bug this
 *   closes). `ip` only sharpens the deviceName refusal text.
 * @returns {Object} the body to POST.
 */
export function buildForcedConfigBody({ snapshot, plan, ip } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.strands)) {
    throw new Error('[MarsinLED] buildForcedConfigBody: snapshot must be a GET /api/config ' +
      'document with a strands[] array');
  }
  const snapshotDmx = requireSnapshotDmx(snapshot, 'buildForcedConfigBody');
  assertPerOutputPlan(plan, 'buildForcedConfigBody');
  const strands = applyForcedPlan(snapshot.strands, plan);
  validatePerOutputPlan(strands, plan.universeByOutputIndex);
  const body = { strands, dmx: { ...snapshotDmx, enabled: true, protocol: 0 } };
  const nameRepair = deviceNameRepairForPush({
    ip, storedName: snapshot.deviceName, controllerName: plan.controllerName,
  });
  if (nameRepair) body.deviceName = nameRepair.to;
  return body;
}

/**
 * POST a forced-push body. TRANSPORT ONLY — it validates nothing beyond
 * `body.strands` being an array (the builder already validated everything) and
 * it does NO internal GET: the body was built from the same snapshot the plan
 * was derived from, and a second read here would reopen the drift window
 * between "what we planned against" and "what we applied to".
 *
 * Feature-detect with `deviceSupportsPerOutput` BEFORE calling this — it never
 * re-checks capability.
 *
 * A forced write always changes strand fields, so the device reboots on success
 * ({outcome:"needs-reboot", reboot:true}); the caller waits, then verifies with
 * `diffForcedConfig`.
 *
 * AMBIGUOUS WRITES: if the POST produces no ANSWER (our timeout, or a socket the
 * rebooting device dropped) the returned rejection carries
 * `err.writeResponseLost === true`. That is NOT proof the write failed — the
 * firmware persists the config and reboots, and on the live rig it reboots
 * before flushing the reply. The caller must wait out the reboot and read the
 * device back to find out. A device that ANSWERED (400 or any other non-2xx)
 * definitively did not apply the body and is never flagged.
 *
 * @param {string} ip
 * @param {Object} body - a `buildForcedConfigBody` result.
 * @param {{writeTimeoutMs?: number}} [opts]
 * @returns {Promise<Object>} the device's apply/reboot reply.
 */
export async function pushForcedConfig(ip, body, opts = {}) {
  if (opts.timeoutMs !== undefined) {
    throw new Error('[MarsinLED] pushForcedConfig: pass {writeTimeoutMs} — the write spans the ' +
      'device reboot and gets its own budget (report 20260725_69)');
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.strands)) {
    throw new Error('[MarsinLED] pushForcedConfig: body must be a buildForcedConfigBody() result ' +
      'with a strands[] array — this transport validates nothing else, the builder did');
  }
  const writeTimeoutMs = opts.writeTimeoutMs ?? PER_OUTPUT_WRITE_TIMEOUT_MS;
  try {
    return await postConfigBody(ip, body, writeTimeoutMs);
  } catch (err) {
    if (err.httpStatus !== undefined) throw err;   // the device answered — definite failure
    err.writeResponseLost = true;                  // no answer at all — the read-back decides
    throw err;
  }
}

/**
 * The informational (NON-failing) swarm note of the narrowed verify (report
 * `_363` §2.2). PURE. The push does not touch swarm, so a board reporting
 * `swarm.enabled === true` after a push is NOT a mismatch — but it IS worth
 * saying out loud, because such a board runs DMX and SWARM at once and the
 * operator owns that decision on the controller's own UI.
 *
 * Deliberately NOT part of `diffForcedConfig`'s return value: that array is the
 * pass/fail verdict, and a note that rode inside it would turn an intended
 * state into a failure. Callers render it beside the outcome line.
 *
 * @param {Object} verifyConfig - post-reboot GET /api/config.
 * @returns {string|null} the note, or null when the board reports no swarm.
 */
export function swarmEnabledNote(verifyConfig) {
  const swarm = verifyConfig && verifyConfig.swarm;
  if (!swarm || typeof swarm !== 'object' || swarm.enabled !== true) return null;
  return 'ℹ board also reports SWARM enabled — swarm is operator-managed; the sim does not ' +
    'touch it';
}

/**
 * The post-push verify — NARROWED to exactly what the push wrote (report
 * `_363` §2.2, superseding `_362` §2.4). PURE: hand it the read-back pair and
 * the body that was POSTed, get back the list of human-readable mismatches
 * ([] ⇒ the device confirmed everything the push claimed).
 *
 * ASSERTED:
 *  1. every index of the pushed `strands` array: `enabled` matches; on the
 *     enabled ones `count`, `dmxUniverse` and `dmxStartAddress: 1` match; on
 *     the disabled ones the read-back carries NO integer `dmxUniverse` (D1
 *     proven on the device — the firmware's all-or-none rule);
 *  2. the SAVED show mode: `dmx.enabled === true`, `dmx.protocol === 0`;
 *  3. the RUNTIME receiver: `status.sacn.enabled === true` (the saved config and
 *     the running receiver can diverge). `dmxOwnsOutput` is asserted only when
 *     the firmware reports it — an absent field is never read as agreement;
 *  4. identity: the board still answers with the controllerId it had before the
 *     push, when the caller states one (bind-by-controllerId, docs/41 §2).
 *
 * NOT ASSERTED (ruling 6.2 — the push does not write these, so it judges
 * nothing about them): strand `type` / `colorOrder` / pins, `dmx.timeoutMs`
 * (preserved, not forced), `swarm.*` (untouched — see `swarmEnabledNote` for
 * the informational surface) and `gamma` (gone from the sim entirely).
 *
 * @param {Object} verifyConfig - post-reboot GET /api/config.
 * @param {Object} verifyStatus - post-reboot GET /api/status.
 * @param {Object} body - the `buildForcedConfigBody` result that was POSTed.
 * @param {{controllerId?: string}} [expected] - pre-push identity to hold to.
 * @returns {string[]} mismatch sentences; empty ⇒ verified.
 */
export function diffForcedConfig(verifyConfig, verifyStatus, body, expected = {}) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.strands)) {
    throw new Error('[MarsinLED] diffForcedConfig: body must be the buildForcedConfigBody() ' +
      'result that was POSTed');
  }
  if (!verifyConfig || typeof verifyConfig !== 'object' || !Array.isArray(verifyConfig.strands)) {
    throw new Error('[MarsinLED] diffForcedConfig: verifyConfig must be a GET /api/config ' +
      'document with a strands[] array');
  }
  if (!verifyStatus || typeof verifyStatus !== 'object') {
    throw new Error('[MarsinLED] diffForcedConfig: verifyStatus must be a GET /api/status document');
  }
  const mismatches = [];

  // 1 — the FULL strands array, every index, both directions.
  if (verifyConfig.strands.length !== body.strands.length) {
    mismatches.push(`device reports ${verifyConfig.strands.length} output(s), the push wrote ` +
      `${body.strands.length}`);
  }
  body.strands.forEach((want, i) => {
    const got = verifyConfig.strands[i];
    if (!got || typeof got !== 'object') {
      mismatches.push(`output ${i}: device reported no strand entry`);
      return;
    }
    const wantEnabled = want.enabled === true;
    if ((got.enabled === true) !== wantEnabled) {
      mismatches.push(`output ${i}: device enabled=${got.enabled} ≠ wanted enabled=${wantEnabled}`);
      return;
    }
    if (!wantEnabled) {
      // D1 read-back: the push DELETED the universe keys on this output, so a
      // board still reporting one never applied the all-or-none rule — the exact
      // state that 400s the NEXT write.
      if (Number.isInteger(got.dmxUniverse)) {
        mismatches.push(`output ${i}: device still reports U${got.dmxUniverse} on a DISABLED ` +
          'output — the push wrote no universe there (firmware all-or-none)');
      }
      return;
    }
    if (got.count !== want.count) {
      mismatches.push(`output ${i}: device count ${got.count} px ≠ wanted ${want.count} px`);
    }
    if (got.dmxUniverse !== want.dmxUniverse) {
      mismatches.push(`output ${i}: device U${got.dmxUniverse} ≠ wanted U${want.dmxUniverse}`);
    }
    if (got.dmxStartAddress !== PER_OUTPUT_START_ADDRESS) {
      mismatches.push(`output ${i}: device startAddress ${got.dmxStartAddress} ≠ ` +
        `${PER_OUTPUT_START_ADDRESS}`);
    }
  });

  // 2 — the SAVED show mode: the push's whole point is a DMX-driven board.
  // `dmx.timeoutMs` (and every other dmx key) was PRESERVED from the board, not
  // forced, so it is not judged here.
  const dmx = verifyConfig.dmx;
  if (!dmx || dmx.enabled !== true) {
    mismatches.push(`dmx.enabled=${dmx && dmx.enabled} ≠ true — the board is NOT DMX-driven`);
  }
  if (!dmx || dmx.protocol !== 0) {
    mismatches.push(`dmx.protocol=${dmx && dmx.protocol} ≠ 0 (sACN)`);
  }

  // 3 — the RUNTIME receiver. Saved config and running receiver can diverge.
  const sacn = verifyStatus.sacn;
  if (!sacn || sacn.enabled !== true) {
    mismatches.push(`sacn.enabled=${sacn && sacn.enabled} ≠ true — the sACN receiver is not ` +
      'listening');
  }
  if (verifyStatus.dmxOwnsOutput !== undefined && verifyStatus.dmxOwnsOutput !== true) {
    mismatches.push(`dmxOwnsOutput=${verifyStatus.dmxOwnsOutput} ≠ true — DMX does not own the ` +
      'outputs');
  }

  // 4 — identity (bind-by-controllerId): same board before and after.
  if (expected && expected.controllerId !== undefined
      && verifyStatus.controllerId !== expected.controllerId) {
    mismatches.push(`controllerId '${verifyStatus.controllerId}' ≠ the pre-push ` +
      `'${expected.controllerId}' — this is not the same board`);
  }

  return mismatches;
}

// ── The DMX ON/OFF toggle (report `_363` §3 — the anti-switch) ──────────────
//
// DMX on/off is a FIELD of the `dmx` block of /api/config; the firmware offers
// no lighter runtime endpoint for it (pinned at source + docs/MARSINLED_API.md).
// Any `dmx` change is reboot-to-apply; writing the value the board already
// holds answers `applied` with no reboot (idempotent). After the reboot,
// `status.sacn.enabled` mirrors the saved flag.
//
// One button, one write, one read-back: no fleet toggle, no status sweep, no
// DMX⇄SWARM mode model, no swarm writes, no polling, no cache.

/**
 * Build the ONE `POST /api/config` body a DMX toggle sends. PURE (no I/O).
 *
 * `{ dmx: {...snapshot.dmx, enabled} }` — the board's FULL stored `dmx` object
 * with only `enabled` flipped (the same sidestep-partial-merge rule as the
 * push), plus `deviceName` under the unchanged repair. Nothing else: the toggle
 * claims nothing about strands, swarm or gamma.
 *
 * @param {{snapshot: Object, enabled: boolean, controllerName?: string,
 *          ip?: string}} params
 * @returns {Object} the body to POST.
 */
export function buildDmxToggleBody({ snapshot, enabled, controllerName, ip } = {}) {
  if (typeof enabled !== 'boolean') {
    throw new Error('[MarsinLED] buildDmxToggleBody: `enabled` must be a boolean (got ' +
      `${JSON.stringify(enabled)}) — the toggle states the target state explicitly`);
  }
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('[MarsinLED] buildDmxToggleBody: snapshot must be a GET /api/config document');
  }
  const snapshotDmx = requireSnapshotDmx(snapshot, 'buildDmxToggleBody');
  const body = { dmx: { ...snapshotDmx, enabled } };
  const nameRepair = deviceNameRepairForPush({
    ip, storedName: snapshot.deviceName, controllerName,
  });
  if (nameRepair) body.deviceName = nameRepair.to;
  return body;
}

/**
 * Verify a DMX toggle. PURE: the read-back pair plus the state that was asked
 * for, back comes the mismatch list ([] ⇒ confirmed).
 *
 *  1. `config.dmx.enabled === enabled` — the SAVED flag;
 *  2. `status.sacn.enabled === enabled` — the RUNTIME receiver (saved config and
 *     running receiver can diverge);
 *  3. identity: the board still answers with the controllerId it had before,
 *     when the caller states one.
 *
 * Nothing else is asserted — the toggle wrote nothing else.
 *
 * @param {Object} verifyConfig - post-reboot GET /api/config.
 * @param {Object} verifyStatus - post-reboot GET /api/status.
 * @param {boolean} enabled - the state the toggle asked for.
 * @param {{controllerId?: string}} [expected] - pre-write identity to hold to.
 * @returns {string[]} mismatch sentences; empty ⇒ verified.
 */
export function diffDmxToggle(verifyConfig, verifyStatus, enabled, expected = {}) {
  if (typeof enabled !== 'boolean') {
    throw new Error('[MarsinLED] diffDmxToggle: `enabled` must be the boolean the toggle asked ' +
      `for (got ${JSON.stringify(enabled)})`);
  }
  if (!verifyConfig || typeof verifyConfig !== 'object') {
    throw new Error('[MarsinLED] diffDmxToggle: verifyConfig must be a GET /api/config document');
  }
  if (!verifyStatus || typeof verifyStatus !== 'object') {
    throw new Error('[MarsinLED] diffDmxToggle: verifyStatus must be a GET /api/status document');
  }
  const mismatches = [];
  const dmx = verifyConfig.dmx;
  if (!dmx || dmx.enabled !== enabled) {
    mismatches.push(`dmx.enabled=${dmx && dmx.enabled} ≠ ${enabled} — the board did not take the ` +
      'DMX flag');
  }
  const sacn = verifyStatus.sacn;
  if (!sacn || sacn.enabled !== enabled) {
    mismatches.push(`sacn.enabled=${sacn && sacn.enabled} ≠ ${enabled} — the running sACN ` +
      'receiver does not match the saved flag');
  }
  if (expected && expected.controllerId !== undefined
      && verifyStatus.controllerId !== expected.controllerId) {
    mismatches.push(`controllerId '${verifyStatus.controllerId}' ≠ the pre-write ` +
      `'${expected.controllerId}' — this is not the same board`);
  }
  return mismatches;
}

/**
 * POST a DMX-toggle body. TRANSPORT ONLY — the exact mirror of
 * `pushForcedConfig`: it validates nothing beyond `body.dmx` being an object
 * (the builder already validated everything), it does NO internal GET (the body
 * was built from ONE snapshot; a second read here would reopen the drift
 * window), and it never retries.
 *
 * A `dmx` change is reboot-to-apply, so the device reboots on success
 * ({outcome:"needs-reboot", reboot:true}) and can drop the HTTP reply doing it:
 * an unanswered POST rejects with `err.writeResponseLost === true`, which is
 * AMBIGUOUS, never proof of failure — the caller waits out the reboot and reads
 * the device back (`diffDmxToggle`). A device that ANSWERED — a 400, the 409 the
 * firmware returns during an active staged-config confirm window, or any other
 * non-2xx — definitively did not apply the body and is a loud failure, never
 * flagged ambiguous (D2).
 *
 * @param {string} ip
 * @param {Object} body - a `buildDmxToggleBody` result.
 * @param {{writeTimeoutMs?: number}} [opts]
 * @returns {Promise<Object>} the device's apply/reboot reply.
 */
export async function pushDmxToggle(ip, body, opts = {}) {
  if (opts.timeoutMs !== undefined) {
    throw new Error('[MarsinLED] pushDmxToggle: pass {writeTimeoutMs} — the write spans the ' +
      'device reboot and gets its own budget (report 20260725_69)');
  }
  if (!body || typeof body !== 'object' || !body.dmx || typeof body.dmx !== 'object'
      || Array.isArray(body.dmx)) {
    throw new Error('[MarsinLED] pushDmxToggle: body must be a buildDmxToggleBody() result with ' +
      'a dmx object — this transport validates nothing else, the builder did');
  }
  const writeTimeoutMs = opts.writeTimeoutMs ?? PER_OUTPUT_WRITE_TIMEOUT_MS;
  try {
    return await postConfigBody(ip, body, writeTimeoutMs);
  } catch (err) {
    if (err.httpStatus !== undefined) throw err;   // the device answered — definite failure
    err.writeResponseLost = true;                  // no answer at all — the read-back decides
    throw err;
  }
}

// ── The GAMMA push (report `_363` §11 — PUSH ONLY, no pull, ever) ───────────
//
// Gamma is a key of the SAME /api/config document the narrowed push and the DMX
// toggle write, so it rides exactly the same machinery: one snapshot → one
// body → one POST → read-back verify. Two things make it its own shape:
//
//  1. LIVE-APPLY. A gamma change does NOT reboot the board (pinned at firmware
//     source, docs/MARSINLED_API.md): the reply is `{outcome:"applied"}` and
//     the curve takes effect immediately. The caller still HONORS a
//     `needs-reboot` reply if a future firmware ever asks for one — believing
//     the device is not the same thing as assuming it.
//  2. FLOAT32 read-back. The firmware stores each exponent as a float32, so a
//     pushed 2.2 reads back as 2.200000047683716. The verify therefore compares
//     per channel at GAMMA_VERIFY_EPSILON, never with `===`.
//
// There is NO read direction here and there never will be (operator ruling,
// unconditional): no `getGamma`, no refresh, no cache, no mirror-from-device.
// The curve pushed is the curve the operator set in the sim; the device is only
// ever asked to CONFIRM it.

export const GAMMA_CHANNELS = Object.freeze(['r', 'g', 'b', 'w']);

// The controller's own accepted range, mirrored client-side so a bad curve is
// refused before it leaves the browser. led_gamma.js (the scene mirror) and
// led_wire.js agree on the same 1.0–3.0 window; a divergence between the three
// would be a bug, not a preference.
export const GAMMA_MIN = 1.0;
export const GAMMA_MAX = 3.0;

// The firmware stores gamma as float32: 2.2 → 2.200000047683716 (error ~5e-8).
// 1e-3 is three orders of magnitude above that noise and two below the slider's
// 0.05 grid, so it accepts every honest read-back and rejects every real change.
export const GAMMA_VERIFY_EPSILON = 1e-3;

/**
 * Validate + normalize a gamma curve to `{r,g,b,w}` finite numbers in
 * 1.0–3.0. PURE. THROWS naming the offending channel — a curve the sim cannot
 * state exactly must never reach a board (codex P0, no fallbacks: nothing here
 * clamps, rounds or substitutes a default).
 *
 * A missing channel is an error: the curve is always complete, because a
 * partial `gamma` object merged into the stored config would leave the operator
 * guessing which channels the board kept.
 *
 * @param {*} raw
 * @param {string} [label] - what to call it in the error text.
 * @returns {{r:number,g:number,b:number,w:number}} a fresh, plain object.
 */
export function validateGammaCurve(raw, label = 'gamma') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`[MarsinLED] ${label} must be an object with r/g/b/w exponents ` +
      `(got ${JSON.stringify(raw)})`);
  }
  for (const key of Object.keys(raw)) {
    if (!GAMMA_CHANNELS.includes(key)) {
      throw new Error(`[MarsinLED] ${label} has unknown key '${key}' (expected r, g, b, w)`);
    }
  }
  const out = {};
  for (const ch of GAMMA_CHANNELS) {
    const v = raw[ch];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < GAMMA_MIN || v > GAMMA_MAX) {
      const err = new Error(`[MarsinLED] ${label}.${ch} ${JSON.stringify(raw[ch])} must be a ` +
        `finite number in ${GAMMA_MIN}–${GAMMA_MAX} (1.0 = curve off) — the range the LED ` +
        'controller accepts');
      err.channel = ch;
      throw err;
    }
    out[ch] = v;
  }
  return out;
}

/**
 * Build the ONE `POST /api/config` body a gamma push sends. PURE (no I/O).
 *
 * `{ gamma: {r,g,b,w} }` — nothing else — plus `deviceName` under the unchanged
 * §4.1.1 repair (a board whose STORED name is invalid rejects EVERY config
 * write, gamma included; that is exactly how the quirk was found — report
 * 20260725_124's proof case was a no-op gamma write).
 *
 * The snapshot is required even though no key of it is copied into the body:
 * it is where `deviceName` is read from, and demanding it keeps the gamma push
 * on the same one-snapshot discipline as the other two writers rather than
 * letting it POST blind.
 *
 * @param {{snapshot: Object, gamma: Object, controllerName?: string,
 *          ip?: string}} params
 * @returns {Object} the body to POST.
 */
export function buildGammaPushBody({ snapshot, gamma, controllerName, ip } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('[MarsinLED] buildGammaPushBody: snapshot must be a GET /api/config document ' +
      '— the gamma push reads the board once before it writes, like every other writer here');
  }
  const clean = validateGammaCurve(gamma, 'buildGammaPushBody: gamma');
  const body = { gamma: clean };
  const nameRepair = deviceNameRepairForPush({
    ip, storedName: snapshot.deviceName, controllerName,
  });
  if (nameRepair) body.deviceName = nameRepair.to;
  return body;
}

/**
 * Verify a gamma push. PURE: the read-back pair plus the curve that was asked
 * for, back comes the mismatch list ([] ⇒ confirmed).
 *
 *  1. `config.gamma` carries all four channels, each within
 *     GAMMA_VERIFY_EPSILON of what was pushed (float32 storage — see above);
 *  2. identity: the board still answers with the controllerId it had before the
 *     write, when the caller states one.
 *
 * Nothing else is asserted — the gamma push wrote nothing else. In particular
 * it claims NOTHING about strands, dmx or swarm, and it never treats an absent
 * `config.gamma` as agreement: a firmware that does not report the block back
 * is a board this push cannot confirm, so it is a loud mismatch.
 *
 * @param {Object} verifyConfig - post-write GET /api/config.
 * @param {Object} verifyStatus - post-write GET /api/status.
 * @param {Object} expectedGamma - the curve that was POSTed (`body.gamma`).
 * @param {{controllerId?: string}} [expected] - pre-write identity to hold to.
 * @returns {string[]} mismatch sentences; empty ⇒ verified.
 */
export function diffGammaPush(verifyConfig, verifyStatus, expectedGamma, expected = {}) {
  if (!verifyConfig || typeof verifyConfig !== 'object') {
    throw new Error('[MarsinLED] diffGammaPush: verifyConfig must be a GET /api/config document');
  }
  if (!verifyStatus || typeof verifyStatus !== 'object') {
    throw new Error('[MarsinLED] diffGammaPush: verifyStatus must be a GET /api/status document');
  }
  const want = validateGammaCurve(expectedGamma, 'diffGammaPush: expectedGamma');
  const mismatches = [];
  const got = verifyConfig.gamma;
  if (!got || typeof got !== 'object' || Array.isArray(got)) {
    mismatches.push(`the board reports no gamma block (${JSON.stringify(got)}) — the push ` +
      'cannot be confirmed');
  } else {
    for (const ch of GAMMA_CHANNELS) {
      const v = got[ch];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        mismatches.push(`gamma.${ch}=${JSON.stringify(v)} is not a number in the read-back`);
        continue;
      }
      if (Math.abs(v - want[ch]) > GAMMA_VERIFY_EPSILON) {
        mismatches.push(`gamma.${ch}=${v} ≠ pushed ${want[ch]} (tolerance ` +
          `${GAMMA_VERIFY_EPSILON})`);
      }
    }
  }
  if (expected && expected.controllerId !== undefined
      && verifyStatus.controllerId !== expected.controllerId) {
    mismatches.push(`controllerId '${verifyStatus.controllerId}' ≠ the pre-write ` +
      `'${expected.controllerId}' — this is not the same board`);
  }
  return mismatches;
}

/**
 * POST a gamma-push body. TRANSPORT ONLY — the exact mirror of `pushDmxToggle`:
 * it validates nothing beyond `body.gamma` being an object (the builder already
 * validated the curve), it does NO internal GET (the body was built from ONE
 * snapshot), and it never retries.
 *
 * Gamma is LIVE-APPLY, so the expected reply is `{outcome:"applied"}` with no
 * reboot and the POST normally answers. The lost-reply arbitration is kept
 * anyway and means the same thing it does everywhere else: an unanswered POST
 * rejects with `err.writeResponseLost === true`, which is AMBIGUOUS and settled
 * by the read-back — never proof of failure. A device that ANSWERED non-2xx (a
 * 400, the staged-config 409, anything) definitively did not apply the body and
 * is a loud failure, never flagged ambiguous (D2).
 *
 * @param {string} ip
 * @param {Object} body - a `buildGammaPushBody` result.
 * @param {{writeTimeoutMs?: number}} [opts]
 * @returns {Promise<Object>} the device's apply reply.
 */
export async function pushGammaPush(ip, body, opts = {}) {
  if (opts.timeoutMs !== undefined) {
    throw new Error('[MarsinLED] pushGammaPush: pass {writeTimeoutMs} — every /api/config write ' +
      'in this module carries its own budget (report 20260725_69)');
  }
  if (!body || typeof body !== 'object' || !body.gamma || typeof body.gamma !== 'object'
      || Array.isArray(body.gamma)) {
    throw new Error('[MarsinLED] pushGammaPush: body must be a buildGammaPushBody() result with ' +
      'a gamma object — this transport validates nothing else, the builder did');
  }
  const writeTimeoutMs = opts.writeTimeoutMs ?? PER_OUTPUT_WRITE_TIMEOUT_MS;
  try {
    return await postConfigBody(ip, body, writeTimeoutMs);
  } catch (err) {
    if (err.httpStatus !== undefined) throw err;   // the device answered — definite failure
    err.writeResponseLost = true;                  // no answer at all — the read-back decides
    throw err;
  }
}

/**
 * Poll /api/status until the device answers the fingerprint again after a
 * reboot (the receiver latches the live sACN stream on boot — keep the source
 * streaming). HARD errors on timeout (codex P0 — no infinite spinner).
 *
 * This is the reboot-wait PHASE of a per-output push: it is the only phase
 * allowed to span the measured ~11 s reboot, and its budget
 * (REBOOT_WAIT_TIMEOUT_MS) is deliberately much larger than any single-request
 * budget. `onProgress({elapsedMs, timeoutMs, attempts})` fires after every miss
 * so the push dialog can say how long it has been waiting.
 *
 * @param {string} ip
 * @param {{timeoutMs?: number, pollIntervalMs?: number, probeTimeoutMs?: number,
 *          onProgress?: Function}} [opts]
 * @returns {Promise<DiscoveredDevice>} the device once it is back.
 */
export async function awaitReboot(ip, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? REBOOT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? REBOOT_POLL_INTERVAL_MS;
  const probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const onProgress = opts.onProgress;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    const dev = await probeDevice(ip, { timeoutMs: probeTimeoutMs });
    attempts += 1;
    if (dev) return dev;
    if (onProgress) onProgress({ elapsedMs: Date.now() - started, timeoutMs, attempts });
    await delay(pollIntervalMs);
  }
  throw new Error(`[MarsinLED] device ${ip} did not come back within ${timeoutMs}ms after ` +
    `reboot (${attempts} probe(s))`);
}
