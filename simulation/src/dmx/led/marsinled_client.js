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
 *    other call (getConfig/getStatus/pushConfig/rebootDevice) targets a device
 *    the operator chose, so it THROWS on any failure.
 *  - `pushConfig` refuses to write wifi/deviceName/boardType/swarm/network keys
 *    (assert before POST), client-validates the docs/41 §4.2 bounds before the
 *    POST, and on HTTP 400 throws an Error carrying the device's `{field,
 *    detail}` verbatim.
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

// POST /api/config carrying a per-output plan. The firmware persists the new
// strand table to flash and then reboots — and on the live rig it reboots
// BEFORE flushing the HTTP reply, so the socket simply goes quiet. This budget
// gives a slow flash commit room to answer, and costs nothing when the reply is
// lost: it overlaps the ~11 s reboot, so the reboot poll that follows finds a
// device that is already back.
export const PER_OUTPUT_WRITE_TIMEOUT_MS = 12000;

// Overall budget for "the device is rebooting — wait for it to answer again".
// Reboot measured at ~11 s; 45 s is honest headroom for a cold WiFi
// re-associate on top of it, and it is a HARD deadline (no infinite spinner).
export const REBOOT_WAIT_TIMEOUT_MS = 45000;
export const REBOOT_POLL_INTERVAL_MS = 1000;

// docs/41 §4.2 validation bounds — mirrored client-side so a bad payload is
// rejected before it ever leaves the browser (loud, with the offending field).
const SACN_UNIVERSE_MIN = 1;
const SACN_UNIVERSE_MAX = 63999;
const DMX_START_ADDRESS_MIN = 1;
const DMX_START_ADDRESS_MAX = 512;
const STRANDS_MIN = 1;
const STRANDS_MAX = 16;
const GLOBAL_BRIGHTNESS_MAX = 255;
const MAX_MILLIAMPS_MAX = 65535;
const DEVICE_NAME_MAX = 32;
const COLOR_ORDER_RE = /^[RGBWA]{3,5}$/;

// Per-output DMX (firmware capabilitiesExt.perOutputDmx). A MarsinLED that
// advertises it can carry a distinct sACN universe per strand — the sim assigns
// one universe per enabled output with dmxStartAddress ALWAYS 1 (the operator's
// convention). Firmware guardrails mirrored client-side (avoid 400s):
const DMX_UNIVERSE_SIZE = 512;          // channels 1–512 in one universe
const PER_OUTPUT_START_ADDRESS = 1;     // convention: always 1 per output
const PER_OUTPUT_SPAN_MAX = 16;         // (maxUniverse − minUniverse + 1) ≤ 16
const PER_OUTPUT_PROTOCOL_SACN = 0;     // per-output rejects ArtNet (sACN only)
const DMX_HOLD_TIMEOUT_MS = 3000;       // hold-then-blackout while a source streams

// Keys the sim's patch flow must NEVER write (docs/41 §4.1, plan P1). A push
// payload carrying any of these is a bug — refuse it loudly rather than risk
// re-homing the network or renaming the device from the sim.
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

/** True iff a parsed /api/status body carries the 3-field MarsinLED fingerprint. */
function isMarsinLedStatus(status) {
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

// ── Client-side validation (docs/41 §4.2) — reject before any POST ──────────

function assertInt(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`[MarsinLED] validation: ${field} must be an integer in ` +
      `${min}–${max} (got ${JSON.stringify(value)})`);
  }
}

function validateStrands(strands) {
  if (!Array.isArray(strands)) {
    throw new Error('[MarsinLED] validation: strands must be an array');
  }
  if (strands.length < STRANDS_MIN || strands.length > STRANDS_MAX) {
    throw new Error(`[MarsinLED] validation: strands must have ${STRANDS_MIN}–${STRANDS_MAX} ` +
      `entries (got ${strands.length})`);
  }
  let enabledCount = 0;
  const seenPins = new Set();
  strands.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`[MarsinLED] validation: strands[${i}] must be an object`);
    }
    if (s.enabled === true) enabledCount += 1;
    assertInt(s.count, 1, Number.MAX_SAFE_INTEGER, `strands[${i}].count`);
    if (typeof s.type !== 'string' || s.type.length === 0) {
      throw new Error(`[MarsinLED] validation: strands[${i}].type must be a non-empty string`);
    }
    if (typeof s.colorOrder !== 'string' || !COLOR_ORDER_RE.test(s.colorOrder)) {
      throw new Error(`[MarsinLED] validation: strands[${i}].colorOrder '${s.colorOrder}' must ` +
        'match RGBWA letters, length 3–5');
    }
    if (typeof s.rgbwMode !== 'string' || s.rgbwMode.length === 0) {
      throw new Error(`[MarsinLED] validation: strands[${i}].rgbwMode must be a non-empty string`);
    }
    if (s.pinData !== undefined) {
      if (seenPins.has(s.pinData)) {
        throw new Error(`[MarsinLED] validation: duplicate pinData ${s.pinData} across strands`);
      }
      seenPins.add(s.pinData);
    }
    if (s.deadPixels !== undefined) {
      assertInt(s.deadPixels, 0, s.count, `strands[${i}].deadPixels`);
    }
    if (s.deadPixelIndices !== undefined) {
      if (!Array.isArray(s.deadPixelIndices)) {
        throw new Error(`[MarsinLED] validation: strands[${i}].deadPixelIndices must be an array`);
      }
      s.deadPixelIndices.forEach((idx, k) => {
        assertInt(idx, 0, s.count - 1, `strands[${i}].deadPixelIndices[${k}]`);
      });
    }
  });
  if (enabledCount < 1) {
    throw new Error('[MarsinLED] validation: at least one strand must be enabled');
  }
}

function validateDmx(dmx) {
  if (!dmx || typeof dmx !== 'object') {
    throw new Error('[MarsinLED] validation: dmx must be an object');
  }
  if (dmx.enabled !== undefined && typeof dmx.enabled !== 'boolean') {
    throw new Error('[MarsinLED] validation: dmx.enabled must be a boolean');
  }
  if (dmx.protocol !== undefined) assertInt(dmx.protocol, 0, 1, 'dmx.protocol');
  if (dmx.universe !== undefined) {
    assertInt(dmx.universe, SACN_UNIVERSE_MIN, SACN_UNIVERSE_MAX, 'dmx.universe');
  }
  if (dmx.startAddress !== undefined) {
    assertInt(dmx.startAddress, DMX_START_ADDRESS_MIN, DMX_START_ADDRESS_MAX, 'dmx.startAddress');
  }
  if (dmx.timeoutMs !== undefined) assertInt(dmx.timeoutMs, 0, Number.MAX_SAFE_INTEGER, 'dmx.timeoutMs');
}

/**
 * Validate a partial push payload against docs/41 §4.2 and the sim write-scope
 * rules. THROWS on the first violation (with the offending field). Exported so
 * the UI can pre-flight a payload before the confirm dialog.
 */
export function validatePushPayload(partial) {
  if (!partial || typeof partial !== 'object') {
    throw new Error('[MarsinLED] push payload must be an object');
  }
  for (const key of DENIED_PUSH_KEYS) {
    if (key in partial) {
      throw new Error(`[MarsinLED] refusing to push key '${key}' — the sim never writes ` +
        `wifi/deviceName/boardType/swarm/network config (docs/41 §4.1)`);
    }
  }
  const keys = Object.keys(partial);
  if (keys.length === 0) {
    throw new Error('[MarsinLED] push payload is empty — nothing to write');
  }
  if ('strands' in partial) validateStrands(partial.strands);
  if ('dmx' in partial) validateDmx(partial.dmx);
  if ('globalBrightness' in partial) {
    assertInt(partial.globalBrightness, 0, GLOBAL_BRIGHTNESS_MAX, 'globalBrightness');
  }
  if ('maxMilliamps' in partial) assertInt(partial.maxMilliamps, 0, MAX_MILLIAMPS_MAX, 'maxMilliamps');
  if ('maxMilliampsEnabled' in partial && typeof partial.maxMilliampsEnabled !== 'boolean') {
    throw new Error('[MarsinLED] validation: maxMilliampsEnabled must be a boolean');
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * POST /api/config with a PARTIAL body (only the keys being changed).
 * Refuses forbidden keys and client-validates §4.2 bounds BEFORE the POST.
 *
 * @returns {Promise<{status?: string, outcome: string, reboot: boolean,
 *   message?: string}>} the device's apply/reboot reply on success.
 * @throws on HTTP 400 an Error whose `.field` / `.detail` / `.deviceError`
 *   carry the device's validation response verbatim (no swallowing); on any
 *   other non-2xx a plain loud error.
 */
export async function pushConfig(ip, partial, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  validatePushPayload(partial);
  return postConfigBody(ip, partial, timeoutMs);
}

/**
 * Low-level POST /api/config with a fully-formed body object. Shared by the
 * legacy pushConfig and the per-output push/revert — the CORS + 400-surfacing
 * logic lives in ONE place. Caller is responsible for validating the body first.
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
      '({universeByOutputIndex, enables, parked, …} from derivePerOutputPlan) — a bare universe ' +
      'map cannot express which outputs the push must enable');
  }
  return plan;
}

/**
 * Read-modify-write helper: return a NEW strands array carrying the plan.
 *
 *  - every output in `plan.enables` (a port drives it, but the board has it
 *    DISABLED) gets `enabled: true` + `count` = the port's mapped pixel count.
 *    This is the ONE asymmetric write (report 20260725_70 §2.3): the push may
 *    switch an output ON, NEVER off, so it can never dark a strand somebody
 *    wired outside the sim;
 *  - every key of `plan.universeByOutputIndex` (assigned AND parked) gets
 *    `dmxUniverse` + `dmxStartAddress: 1`;
 *  - `count` on an ALREADY-enabled output is never touched — the physical strand
 *    length is hardware truth and the sim's model is a belief. A mismatch is a
 *    warning from the derive, never a write;
 *  - every other strand, and every other field, is copied through untouched (the
 *    array is replaced wholesale on the device).
 *
 * Pure (no I/O). The caller validates the APPLIED array — not the device's —
 * because only the applied array expresses the post-push enable state.
 */
export function applyPerOutputPlan(strands, plan) {
  assertPerOutputPlan(plan, 'applyPerOutputPlan');
  const uni = normalizeUniverseMap(plan.universeByOutputIndex);
  const enableByIndex = new Map();
  for (const entry of plan.enables || []) {
    if (!Number.isInteger(entry.outputIndex) || entry.outputIndex < 0) {
      throw new Error(`[MarsinLED] applyPerOutputPlan: enables[].outputIndex ` +
        `'${entry.outputIndex}' must be a non-negative integer`);
    }
    assertInt(entry.count, 1, Number.MAX_SAFE_INTEGER,
      `enables[output ${entry.outputIndex}].count`);
    enableByIndex.set(entry.outputIndex, entry.count);
  }
  return strands.map((s, i) => {
    const next = { ...(s || {}) };
    if (enableByIndex.has(i)) {
      next.enabled = true;
      next.count = enableByIndex.get(i);
    }
    if (next.enabled === true && uni.has(i)) {
      next.dmxUniverse = uni.get(i);
      next.dmxStartAddress = PER_OUTPUT_START_ADDRESS;
    }
    return next;
  });
}

/**
 * Push a per-output universe plan (full read-modify-write). Feature-detect with
 * `deviceSupportsPerOutput` BEFORE calling this — it never re-checks capability
 * (a device that lacks per-output must take the legacy path instead).
 *
 *  1. GET /api/config.
 *  2. APPLY the plan to the live strands (`applyPerOutputPlan`): enable the
 *     outputs a port drives that the board has off (with their pixel count), and
 *     stamp `dmxUniverse` + `dmxStartAddress:1` on every assigned AND parked
 *     output. Nothing is ever disabled.
 *  3. Validate the APPLIED array (`validatePerOutputPlan`), not the device's —
 *     the applied array is the intended POST-push state, so the firmware's
 *     ALL-OR-NONE / only-enabled-carry-a-universe / span / no-overlap rules are
 *     checked against what the device will actually hold. Validating the
 *     pre-push array could not express an enable and would refuse a legal plan.
 *  4. POST { strands, dmx:{enabled:true, protocol:0, timeoutMs:3000} }.
 *
 * The device REBOOTS on success ({outcome:"needs-reboot", reboot:true}); the
 * caller runs `awaitReboot` then `readPerOutput(getStatus)`.
 *
 * PHASE BUDGETS (report 20260725_69): the read and the write are timed
 * SEPARATELY — the write spans a reboot, the read does not. A flat `timeoutMs`
 * covering both is the bug this function was fixed for, so passing one is
 * refused rather than silently half-honoured.
 *
 * AMBIGUOUS WRITES: if the POST produces no ANSWER (our timeout, or a socket the
 * rebooting device dropped) the returned rejection carries
 * `err.writeResponseLost === true`. That is NOT proof the write failed — the
 * firmware persists the config and reboots, and on the live rig it reboots
 * before flushing the reply. The caller must wait out the reboot and read the
 * device back to find out. A device that ANSWERED (400 or any other non-2xx)
 * definitively did not apply the plan and is never flagged.
 *
 * @param {string} ip
 * @param {{plan: Object,
 *          opts?: {readTimeoutMs?: number, writeTimeoutMs?: number}}} params
 *   `plan` is `derivePerOutputPlan`'s result and is REQUIRED.
 * @returns {Promise<Object>} the device's apply/reboot reply.
 */
export async function pushPerOutputUniverses(ip, { plan, opts = {} } = {}) {
  if (opts.timeoutMs !== undefined) {
    throw new Error('[MarsinLED] pushPerOutputUniverses: one flat timeoutMs cannot cover ' +
      'both the read and the reboot-spanning write — pass {readTimeoutMs, writeTimeoutMs}');
  }
  assertPerOutputPlan(plan, 'pushPerOutputUniverses');
  const readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const writeTimeoutMs = opts.writeTimeoutMs ?? PER_OUTPUT_WRITE_TIMEOUT_MS;
  const config = await getConfig(ip, { timeoutMs: readTimeoutMs });
  if (!config || !Array.isArray(config.strands)) {
    throw new Error(`[MarsinLED] pushPerOutputUniverses: ${ip} GET /api/config returned no strands[]`);
  }
  const strands = applyPerOutputPlan(config.strands, plan);
  validatePerOutputPlan(strands, plan.universeByOutputIndex);
  const body = {
    strands,
    dmx: { enabled: true, protocol: PER_OUTPUT_PROTOCOL_SACN, timeoutMs: DMX_HOLD_TIMEOUT_MS },
  };
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
