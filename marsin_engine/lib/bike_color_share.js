import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * bike_color_share — links the engine's shared global palette
 * (colorPalette1/colorPalette2) out
 * to the BM26 bikes: MarsinLED controllers riding around camp, each running
 * its own local pattern but happy to take an ENGINE-OWNED color override so a
 * bike rolling past the ship reads as part of the same show.
 *
 * ── THE FIRMWARE CONTRACT (sanitized, authoritative) ────────────────────────
 *   POST /api/colors { color1:[h,s,v], color2:[h,s,v], engine:true } — floats
 *     0..1. Writes are ABSOLUTE and always accepted; they refresh a 60 s
 *     firmware-held lease. Shared Color 1/2 changes are coalesced and sent
 *     promptly, with at most one change-driven cycle per second. A fresh copy
 *     is still sent every 10 s while idle, and the bike auto-restores its
 *     pre-engine colors if those keepalives stop, on its
 *     own — so a crashed or unplugged engine fails SAFE without this module
 *     doing anything at all.
 *   GET /api/status  → controllerId (identity — NEVER the IP), mac,
 *     firmwareTag, activePattern, colors.engine.{leased,msRemaining}.
 *   GET /api/colors also exists; a 404 there (older 1.x firmware) means the
 *     board CANNOT take an engine override — marked UNSUPPORTED and left
 *     alone. No fallback write path (codex P0): we never guess at a legacy
 *     protocol for a board that told us it doesn't have this API.
 *
 * ── WHY POLLING, NOT PUSH-ONLY ───────────────────────────────────────────────
 * Bikes move. A controllerId can show up at a new DHCP address, vanish for an
 * hour crossing the playa, or come back at an address another bike now
 * squats. Discovery (sweepOnce) re-resolves identity → address on a slow
 * cadence; the keepalive (pushOnce) is a SEPARATE, faster cadence so a slow
 * discovery sweep across up to 256 addresses can never blow the 60 s lease.
 * Both loops are gentle on purpose — ESP32-class HTTP servers do not want a
 * parallel blast, so every sweep/push cycle walks its targets SEQUENTIALLY
 * with a stagger between requests.
 *
 * ── ENABLED:FALSE IS THE DEFAULT AND MUST STAY THAT WAY ─────────────────────
 * DEFAULT_BIKE_COLOR_SHARE_CONFIG.enabled is `false`. Merging this module
 * into the engine must not make the live rig start scanning IP ranges —
 * that's an operator opt-in, made explicit in config.yaml.
 *
 * ── RUNTIME STATE IS NOT CONFIG (mirrors lib/color_autopilot.js) ────────────
 * `setConfig`/`saveConfig` persist ONLY this feature's block, ONLY to a
 * sibling runtime YAML file — never back to the tracked, comment-bearing
 * config.yaml. See the `runtimeFile` getter below for the full rationale
 * (identical failure mode already MEASURED for colorAutopilot).
 */

/** Fixed production cadence. It is intentionally not operator-tunable. */
export const BIKE_COLOR_PUSH_INTERVAL_MS = 10000;

/** A short fixed window folds color-wheel/slider chatter into one newest-value push. */
export const BIKE_COLOR_CHANGE_DEBOUNCE_MS = 100;

/** Flood guard: change-driven cycles may begin no more than once per second. */
export const BIKE_COLOR_CHANGE_MIN_GAP_MS = 1000;

/** Boot defaults. `enabled: false` is mandatory — see file header. */
export const DEFAULT_BIKE_COLOR_SHARE_CONFIG = Object.freeze({
  enabled: false,
  targets: '',
  port: 80,
  scanIntervalMs: 15000,
  probeTimeoutMs: 2000,
  probeStaggerMs: 50,
  pushIntervalMs: BIKE_COLOR_PUSH_INTERVAL_MS,
  pushTimeoutMs: 3000,
  staleAfterFailures: 2,
  goneAfterMs: 300000,
  dropAfterMs: 1800000,
});

const KNOWN_CONFIG_KEYS = new Set(Object.keys(DEFAULT_BIKE_COLOR_SHARE_CONFIG));

/** Lifecycle a discovered bike moves through. */
export const BIKE_STATES = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  LINKED: 'LINKED',
  UNSUPPORTED: 'UNSUPPORTED',
  STALE: 'STALE',
  GONE: 'GONE',
});

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const BRACKET_RANGE_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\[(\d{1,3})\.\.\.(\d{1,3})\](?::(\d+))?$/;

/** Parse+range-check one dotted-quad. Throws (naming the bad string) on failure. */
function parseIpv4(str, context) {
  const m = IPV4_RE.exec(str);
  if (!m) {
    throw new Error(`bike_color_share targets: ${context} is not a valid IPv4 address, got ${JSON.stringify(str)}`);
  }
  const octets = m.slice(1, 5).map(Number);
  for (const o of octets) {
    if (o < 0 || o > 255) {
      throw new Error(`bike_color_share targets: ${context} has an octet out of range 0..255, got ${JSON.stringify(str)}`);
    }
  }
  return octets;
}

/** Push one expanded target, deduping by address and enforcing the 256 cap
 *  as we go (so a runaway range fails fast instead of building a huge array
 *  first). */
function addTarget(out, seen, host, port) {
  const address = `${host}:${port}`;
  if (seen.has(address)) return;
  seen.add(address);
  out.push({ host, port, address });
  if (out.length > 256) {
    throw new Error(
      'bike_color_share targets: expansion exceeds the 256-address cap — this is a deliberate '
      + 'conservative pacing limit for ESP32-class devices, not an arbitrary round number.');
  }
}

function parsePort(value, entry) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`bike_color_share targets: malformed port in ${JSON.stringify(entry)}`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`bike_color_share targets: port out of range 1..65535 in ${JSON.stringify(entry)}`);
  }
  return port;
}

function addLastOctetRange(out, seen, startOctets, endOctets, port, entry) {
  for (let i = 0; i < 3; i++) {
    if (startOctets[i] !== endOctets[i]) {
      throw new Error(
        `bike_color_share targets: range ${JSON.stringify(entry)} must share the first three octets `
        + '(only the last octet may vary)');
    }
  }
  if (endOctets[3] < startOctets[3]) {
    throw new Error(`bike_color_share targets: range ${JSON.stringify(entry)} end is before start`);
  }
  for (let last = startOctets[3]; last <= endOctets[3]; last++) {
    const host = `${startOctets[0]}.${startOctets[1]}.${startOctets[2]}.${last}`;
    addTarget(out, seen, host, port);
  }
}

/**
 * Expand `targets` (comma-separated 'A.B.C.D' | 'A.B.C.D:port' |
 * 'A.B.C.[D...E]' | 'A.B.C.[D...E]:port' |
 * 'A.B.C.D-A.B.C.E' last-octet-range entries) into
 * `[{ host, port, address }]`, deduped, input order preserved.
 *
 * THROWS on: a malformed entry (not one of the three forms), a range whose
 * end < start or whose first three octets don't match the start, or a total
 * expansion over 256 addresses.
 */
export function expandTargets(targets, defaultPort) {
  if (typeof targets !== 'string') {
    throw new Error(`bike_color_share targets: must be a string, got ${JSON.stringify(targets)}`);
  }
  const entries = targets.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const bracketRange = BRACKET_RANGE_RE.exec(entry);
    if (bracketRange) {
      const prefix = `${bracketRange[1]}.${bracketRange[2]}.${bracketRange[3]}`;
      const startOctets = parseIpv4(
        `${prefix}.${bracketRange[4]}`,
        `range start in ${JSON.stringify(entry)}`,
      );
      const endOctets = parseIpv4(
        `${prefix}.${bracketRange[5]}`,
        `range end in ${JSON.stringify(entry)}`,
      );
      const port = bracketRange[6] === undefined ? defaultPort : parsePort(bracketRange[6], entry);
      addLastOctetRange(out, seen, startOctets, endOctets, port, entry);
      continue;
    }
    if (entry.includes('-')) {
      const parts = entry.split('-');
      if (parts.length !== 2) {
        throw new Error(`bike_color_share targets: malformed range entry ${JSON.stringify(entry)}`);
      }
      const startOctets = parseIpv4(parts[0].trim(), `range start in ${JSON.stringify(entry)}`);
      const endOctets = parseIpv4(parts[1].trim(), `range end in ${JSON.stringify(entry)}`);
      addLastOctetRange(out, seen, startOctets, endOctets, defaultPort, entry);
      continue;
    }
    const colonIdx = entry.lastIndexOf(':');
    let hostPart = entry;
    let port = defaultPort;
    if (colonIdx !== -1) {
      hostPart = entry.slice(0, colonIdx);
      const portStr = entry.slice(colonIdx + 1);
      port = parsePort(portStr, entry);
    }
    parseIpv4(hostPart, `entry ${JSON.stringify(entry)}`);
    addTarget(out, seen, hostPart, port);
  }
  return out;
}

/**
 * Validate + normalize a bike_color_share wire object. THROW-style (codex
 * P0): every refusal names the field and the value it saw. Returns a FRESH
 * object carrying every known key (defaults filled in for anything absent).
 */
export function validateBikeColorShareConfig(obj, label = 'bike_color_share') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${label} must be an object, got ${JSON.stringify(obj)}`);
  }
  for (const key of Object.keys(obj)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      throw new Error(`${label}: unknown key '${key}' (known: ${[...KNOWN_CONFIG_KEYS].join(', ')})`);
    }
  }
  const merged = { ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, ...obj };

  if (typeof merged.enabled !== 'boolean') {
    throw new Error(`${label}.enabled must be a boolean, got ${JSON.stringify(merged.enabled)}`);
  }
  if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) {
    throw new Error(`${label}.port must be an integer 1..65535, got ${JSON.stringify(merged.port)}`);
  }
  if (typeof merged.targets !== 'string') {
    throw new Error(`${label}.targets must be a string, got ${JSON.stringify(merged.targets)}`);
  }
  if (merged.enabled && merged.targets.trim().length === 0) {
    throw new Error(`${label}.targets must be non-empty when enabled is true, got ${JSON.stringify(merged.targets)}`);
  }
  // Syntax check as a side effect — throws by itself on a malformed entry,
  // a bad range, or an expansion over the 256-address cap.
  expandTargets(merged.targets, merged.port);

  const positiveFiniteFields = [
    'scanIntervalMs', 'probeTimeoutMs', 'pushIntervalMs', 'pushTimeoutMs', 'goneAfterMs', 'dropAfterMs',
  ];
  for (const field of positiveFiniteFields) {
    const v = merged[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`${label}.${field} must be a finite positive number, got ${JSON.stringify(v)}`);
    }
  }
  // probeStaggerMs alone may be 0 (no gap at all is a valid, if impolite, choice).
  if (typeof merged.probeStaggerMs !== 'number' || !Number.isFinite(merged.probeStaggerMs) || merged.probeStaggerMs < 0) {
    throw new Error(`${label}.probeStaggerMs must be a finite number >= 0, got ${JSON.stringify(merged.probeStaggerMs)}`);
  }
  if (!Number.isInteger(merged.staleAfterFailures) || merged.staleAfterFailures < 1) {
    throw new Error(`${label}.staleAfterFailures must be an integer >= 1, got ${JSON.stringify(merged.staleAfterFailures)}`);
  }
  // Fixed contract: linked bikes get the current shared global Color 1/2 pair
  // every ten seconds. Reject a wire/config attempt to make this faster or
  // slower; loadConfig explicitly migrates values accepted by older builds.
  if (merged.pushIntervalMs !== BIKE_COLOR_PUSH_INTERVAL_MS) {
    throw new Error(
      `${label}.pushIntervalMs is fixed at ${BIKE_COLOR_PUSH_INTERVAL_MS} ms, got `
      + `${JSON.stringify(merged.pushIntervalMs)}`);
  }

  return { ...merged };
}

/** True iff `hsv` is `{h,s,v}` with every member a finite number in 0..1. */
function isValidTriple(hsv) {
  if (!hsv || typeof hsv !== 'object') return false;
  for (const k of ['h', 's', 'v']) {
    const v = hsv[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

/** setTimeout as a Promise, unref'd so a stagger delay never holds the process open. */
function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
  });
}

export class BikeColorShare {
  /**
   * @param {object} opts
   * @param {object|null} [opts.config] — a pre-built config; validated as-is.
   *   When omitted, the instance self-loads from `configFile` (config.yaml's
   *   `bike_color_share` block, overlaid with the runtime file — see
   *   `loadConfig`).
   * @param {string|null} [opts.configFile] — overrides
   *   `process.env.MARSIN_CONFIG_FILE` and the default `../config.yaml`.
   * @param {() => {color1:{h,s,v}, color2:{h,s,v}}} opts.getPalette —
   *   REQUIRED. Reads the shared global Color 1/2 values.
   * @param {typeof fetch} [opts.fetchImpl] — injection seam for tests.
   * @param {() => number} [opts.now] — injected clock, defaults to Date.now.
   * @param {Console} [opts.logger] — defaults to console.
   */
  constructor({ config = null, configFile = null, getPalette, fetchImpl = fetch, now = Date.now, logger = console } = {}) {
    if (typeof getPalette !== 'function') {
      throw new Error('BikeColorShare: getPalette is required');
    }
    this.getPalette = getPalette;
    this._fetch = fetchImpl;
    this._now = now;
    this._logger = logger;
    this.configFile = configFile || process.env.MARSIN_CONFIG_FILE
      || path.join(__dirname, '..', 'config.yaml');

    this.config = config !== null
      ? validateBikeColorShareConfig(config)
      : this.loadConfig();

    // Generation counter: bumped on every stop() so a timer or an in-flight
    // .finally() reschedule from a PRIOR life can recognize itself as stale
    // and bail rather than re-arming a timer nobody asked for (mirrors
    // lib/color_autopilot.js's `_scheduleNext` generation guard).
    this.generation = 0;
    this._sweepTimer = null;
    this._pushTimer = null;
    this._changeTimer = null;
    this._changePending = false;
    this._lastPushStartedMs = Number.NEGATIVE_INFINITY;
    this._sweeping = false;
    this._pushing = false;
    // Aborts every in-flight fetch on stop(). Replaced (not just re-created
    // conditionally) in start() so a stop()→start() pair always hands out a
    // fresh, unaborted signal to the new generation's requests.
    this._abortController = new AbortController();

    // controllerId -> bike record. Keyed by identity, never by address —
    // bikes move.
    this._registry = new Map();
    // address -> controllerId, so a sweep can detect "this address now
    // answers as a DIFFERENT controllerId" (a bike swap) in O(1).
    this._addressIndex = new Map();

    this.stats = {
      sweeps: 0,
      pushCycles: 0,
      changePushCycles: 0,
      pushCycleOverruns: 0,
      pushesOk: 0,
      pushesFailed: 0,
      paletteErrors: 0,
      paletteChangeNotifications: 0,
      paletteChangeNotificationsCoalesced: 0,
    };
  }

  /* RUNTIME STATE IS NOT CONFIG — the same split lib/color_autopilot.js
     already makes (see that file's `runtimeFile` note, MEASURED there: a
     whole-document yaml.dump round-trip over the tracked, comment-bearing
     config.yaml silently destroyed unrelated lines, including a hex literal
     mangled into decimal). saveConfig() below writes ONLY this feature's
     block, ONLY to this derived runtime file — config.yaml is never
     rewritten by this module. Derived from configFile so a test pointing at
     a scratch config automatically gets a scratch runtime file too. */
  get runtimeFile() {
    return String(this.configFile).replace(/\.ya?ml$/i, '') + '.bike_color_share_runtime.yaml';
  }

  /** config.yaml's `bike_color_share` block (absent → defaults), overlaid
   *  with the runtime file's block on top, then validated. */
  loadConfig() {
    let block = {};
    if (fs.existsSync(this.configFile)) {
      const doc = yaml.load(fs.readFileSync(this.configFile, 'utf8')) || {};
      if (doc && typeof doc === 'object' && doc.bike_color_share && typeof doc.bike_color_share === 'object') {
        block = { ...doc.bike_color_share };
      }
    }
    try {
      if (fs.existsSync(this.runtimeFile)) {
        const rt = yaml.load(fs.readFileSync(this.runtimeFile, 'utf8')) || {};
        if (rt && rt.bike_color_share && typeof rt.bike_color_share === 'object') {
          block = { ...block, ...rt.bike_color_share };
        }
      }
    } catch (e) {
      // A corrupt runtime file must not stop the show booting — but it must
      // not be silent either (codex P0: log err.message, never swallow).
      this._logger.warn(`[bike-color-share] corrupt runtime file ignored: ${e.message}`);
    }
    // Older builds allowed any cadence from 20..55000 ms and persisted the
    // fully expanded block. Migrate those formerly-valid numeric values to the
    // new fixed cadence instead of disabling an already-configured link after
    // upgrade. Malformed values still fail loudly in validation below.
    if (typeof block.pushIntervalMs === 'number'
        && Number.isFinite(block.pushIntervalMs)
        && block.pushIntervalMs >= 20
        && block.pushIntervalMs <= 55000
        && block.pushIntervalMs !== BIKE_COLOR_PUSH_INTERVAL_MS) {
      this._logger.warn(
        `[bike-color-share] migrating stored pushIntervalMs=${block.pushIntervalMs} to fixed `
        + `${BIKE_COLOR_PUSH_INTERVAL_MS} ms global-color cadence`);
      block = { ...block, pushIntervalMs: BIKE_COLOR_PUSH_INTERVAL_MS };
    }
    return validateBikeColorShareConfig(block);
  }

  /** Persist ONLY the bike_color_share block, ONLY to the runtime file. */
  saveConfig() {
    fs.writeFileSync(this.runtimeFile, yaml.dump({ bike_color_share: this.config }));
  }

  /** Deep copy — callers may freely mutate what they get back. */
  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  isEnabled() {
    return this.config.enabled === true;
  }

  /**
   * Shallow-merge KNOWN keys of `partial` over the current config, validate
   * the WHOLE result, and apply it live. Does NOT persist — call
   * saveConfig() after if the caller wants the change to survive a restart.
   * Returns the normalized config (a copy).
   */
  setConfig(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new Error(`bike_color_share.setConfig: partial must be an object, got ${JSON.stringify(partial)}`);
    }
    const merged = validateBikeColorShareConfig({ ...this.config, ...partial }, 'bike_color_share.setConfig');
    const wasEnabled = this.config.enabled;
    // A targets/port change invalidates the current discovery scope, so it
    // needs the same clean re-arm a straight enabled flip gets — otherwise
    // the running sweep would keep scanning the OLD address list until its
    // next natural reschedule.
    const scopeChanged = this.config.targets !== merged.targets || this.config.port !== merged.port;
    this.config = merged;
    if (wasEnabled !== merged.enabled || (merged.enabled && scopeChanged)) {
      if (merged.enabled) this.start(); else this.stop();
    }
    return this.getConfig();
  }

  /** enabled:false ⇒ log one line, arm nothing. Else (re)arm both timers
   *  against a fresh generation + AbortController. Always stops first, so
   *  start() is safe to call on an already-running instance. */
  start() {
    this.stop();
    if (!this.config.enabled) {
      this._logger.log('[bike-color-share] disabled (config bike_color_share.enabled: false) — not scanning');
      return;
    }
    this._abortController = new AbortController();
    this._changePending = false;
    this._lastPushStartedMs = Number.NEGATIVE_INFINITY;
    this._scheduleSweep(0);
    this._schedulePush(this.config.pushIntervalMs);
  }

  /** Idempotent. Clears both timers, bumps the generation, aborts anything
   *  in flight. */
  stop() {
    this.generation++;
    if (this._sweepTimer) { clearTimeout(this._sweepTimer); this._sweepTimer = null; }
    if (this._pushTimer) { clearTimeout(this._pushTimer); this._pushTimer = null; }
    if (this._changeTimer) { clearTimeout(this._changeTimer); this._changeTimer = null; }
    this._changePending = false;
    try { this._abortController.abort(); } catch (e) { /* already aborted */ }
  }

  _scheduleSweep(delayMs) {
    const gen = this.generation;
    this._sweepTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      this.sweepOnce()
        .catch((e) => this._logger.error(`[bike-color-share] sweep failed: ${e.message}`))
        .finally(() => {
          if (gen === this.generation) this._scheduleSweep(this.config.scanIntervalMs);
        });
    }, delayMs);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  _schedulePush(delayMs) {
    const gen = this.generation;
    this._pushTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      this._pushTimer = null;
      this.pushOnce({ reason: 'keepalive' })
        .catch((e) => this._logger.error(`[bike-color-share] push cycle failed: ${e.message}`))
        .finally(() => {
          if (gen !== this.generation) return;
          if (this._changePending) this._scheduleChangePush();
          else this._schedulePush(this.config.pushIntervalMs);
        });
    }, delayMs);
    if (this._pushTimer.unref) this._pushTimer.unref();
  }

  /**
   * Signal that the SHARED global Color 1/2 pair actually changed. The caller
   * owns equality detection; this method owns wire pacing. A leading 100 ms
   * coalescing window absorbs UI chatter, a one-second start-to-start gap caps
   * sustained activity, and the newest palette is read only when the cycle
   * begins. The idle keepalive is cancelled/rebased so a change cannot cause a
   * back-to-back keepalive.
   */
  notifyPaletteChanged() {
    if (!this.config.enabled) return;
    this.stats.paletteChangeNotifications++;
    if (this._changePending || this._changeTimer || this._pushing) {
      this.stats.paletteChangeNotificationsCoalesced++;
    }
    this._changePending = true;
    if (this._pushTimer) {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
    }
    this._scheduleChangePush();
  }

  _scheduleChangePush() {
    if (!this.config.enabled || !this._changePending || this._changeTimer || this._pushing) return;
    const earliestByRateLimit = this._lastPushStartedMs + BIKE_COLOR_CHANGE_MIN_GAP_MS;
    const delayMs = Math.max(
      BIKE_COLOR_CHANGE_DEBOUNCE_MS,
      earliestByRateLimit - this._now(),
    );
    const gen = this.generation;
    this._changeTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      this._changeTimer = null;
      this._changePending = false;
      this.pushOnce({ reason: 'change' })
        .catch((e) => this._logger.error(`[bike-color-share] change push cycle failed: ${e.message}`))
        .finally(() => {
          if (gen !== this.generation) return;
          if (this._changePending) this._scheduleChangePush();
          else this._schedulePush(this.config.pushIntervalMs);
        });
    }, delayMs);
    if (this._changeTimer.unref) this._changeTimer.unref();
  }

  /** Combine the instance's stop()-abort signal with a per-request timeout. */
  _signalFor(timeoutMs) {
    return AbortSignal.any([this._abortController.signal, AbortSignal.timeout(timeoutMs)]);
  }

  /**
   * One full discovery sweep: walk expandTargets() SEQUENTIALLY (stagger
   * between probes — never parallel-blast an ESP32-class HTTP server),
   * upsert the registry, then age STALE→GONE→dropped. Single-flight: a
   * concurrent call while one is already running is a no-op.
   */
  async sweepOnce() {
    if (this._sweeping) return;
    this._sweeping = true;
    try {
      const targets = expandTargets(this.config.targets, this.config.port);
      for (let i = 0; i < targets.length; i++) {
        if (i > 0 && this.config.probeStaggerMs > 0) {
          await sleep(this.config.probeStaggerMs);
        }
        await this._probeOne(targets[i]);
      }
      this._ageRegistry();
      this.stats.sweeps++;
    } finally {
      this._sweeping = false;
    }
  }

  /** Probe one address: GET /api/status. A valid bike is HTTP 200 + JSON
   *  with a non-empty string controllerId — anything else (timeout, network
   *  error, non-JSON, missing/blank controllerId) is IGNORED for discovery,
   *  never entered into the registry. */
  async _probeOne(target) {
    const { address } = target;
    let body;
    try {
      const res = await this._fetch(`http://${address}/api/status`, {
        signal: this._signalFor(this.config.probeTimeoutMs),
      });
      if (res.status !== 200) return;
      body = await res.json();
    } catch (e) {
      return;
    }
    if (!body || typeof body !== 'object' || typeof body.controllerId !== 'string' || body.controllerId.length === 0) {
      return;
    }
    const controllerId = body.controllerId;
    const now = this._now();

    // ADDRESS CONFLICT: another controllerId currently claims this address —
    // a bike swap at the same IP. That prior record is no longer reachable
    // where we thought it was, so mark it STALE immediately rather than
    // waiting for it to time out on its own.
    const priorHolderId = this._addressIndex.get(address);
    if (priorHolderId && priorHolderId !== controllerId) {
      const priorBike = this._registry.get(priorHolderId);
      if (priorBike && priorBike.state !== BIKE_STATES.STALE) {
        priorBike.state = BIKE_STATES.STALE;
        this._logger.warn(
          `[bike-color-share] ${priorHolderId} @ ${address} STALE — that address now answers as `
          + `${controllerId} (bike swap at the same address)`);
      }
    }

    let bike = this._registry.get(controllerId);
    const isNew = !bike;
    if (!bike) {
      bike = {
        controllerId,
        address, ip: target.host, port: target.port,
        state: BIKE_STATES.DISCOVERED,
        firmwareTag: null, activePattern: null, mac: null,
        lastSeenMs: now, leaseMsRemaining: null,
        pushStats: { ok: 0, failed: 0, consecutiveFailures: 0, lastPushMs: null },
      };
      this._registry.set(controllerId, bike);
    }
    bike.address = address;
    bike.ip = target.host;
    bike.port = target.port;
    bike.firmwareTag = typeof body.firmwareTag === 'string' ? body.firmwareTag : bike.firmwareTag;
    bike.activePattern = typeof body.activePattern === 'string' ? body.activePattern : bike.activePattern;
    bike.mac = typeof body.mac === 'string' ? body.mac : bike.mac;
    bike.lastSeenMs = now;
    bike.leaseMsRemaining = (body.colors && body.colors.engine && typeof body.colors.engine.msRemaining === 'number')
      ? body.colors.engine.msRemaining
      : null;
    this._addressIndex.set(address, controllerId);

    const needsSupportCheck = isNew
      || bike.state === BIKE_STATES.UNSUPPORTED
      || bike.state === BIKE_STATES.STALE
      || bike.state === BIKE_STATES.GONE;
    if (needsSupportCheck) {
      await this._checkSupport(bike);
    }
  }

  /** GET /api/colors: 200 ⇒ LINKED (auto-relink, reset consecutiveFailures),
   *  404 ⇒ UNSUPPORTED (loud, ONCE per transition — 1.x firmware, no fallback
   *  write path), anything else ⇒ treated as a transport-shaped failure:
   *  logged, state left as-is. */
  async _checkSupport(bike) {
    const prevState = bike.state;
    try {
      const res = await this._fetch(`http://${bike.address}/api/colors`, {
        signal: this._signalFor(this.config.probeTimeoutMs),
      });
      if (res.status === 200) {
        bike.state = BIKE_STATES.LINKED;
        bike.pushStats.consecutiveFailures = 0;
        if (prevState !== BIKE_STATES.LINKED) {
          this._logger.log(
            `[bike-color-share] ${bike.controllerId} @ ${bike.address} LINKED`
            + (prevState === BIKE_STATES.DISCOVERED ? ' (discovered)' : ` (auto-relinked from ${prevState})`));
        }
        return;
      }
      if (res.status === 404) {
        bike.state = BIKE_STATES.UNSUPPORTED;
        if (prevState !== BIKE_STATES.UNSUPPORTED) {
          this._logger.error(
            `[bike-color-share] ${bike.controllerId} @ ${bike.address} UNSUPPORTED — firmware has no `
            + '/api/colors (pre-1.x era). No pushes will be sent to this bike; no fallback write path.');
        }
        return;
      }
      this._logger.warn(
        `[bike-color-share] ${bike.controllerId} @ ${bike.address} GET /api/colors → unexpected `
        + `${res.status}; leaving state ${bike.state}`);
    } catch (e) {
      this._logger.warn(`[bike-color-share] ${bike.controllerId} @ ${bike.address} support check failed: ${e.message}`);
    }
  }

  /** End-of-sweep aging: STALE unseen past goneAfterMs ⇒ GONE; GONE unseen
   *  past dropAfterMs ⇒ deleted from the registry entirely. */
  _ageRegistry() {
    const now = this._now();
    for (const bike of this._registry.values()) {
      if (bike.state === BIKE_STATES.STALE && (now - bike.lastSeenMs) > this.config.goneAfterMs) {
        bike.state = BIKE_STATES.GONE;
        this._logger.log(
          `[bike-color-share] ${bike.controllerId} @ ${bike.address} GONE — not seen for `
          + `${now - bike.lastSeenMs} ms`);
      }
    }
    for (const [id, bike] of [...this._registry.entries()]) {
      if (bike.state === BIKE_STATES.GONE && (now - bike.lastSeenMs) > this.config.dropAfterMs) {
        this._registry.delete(id);
        if (this._addressIndex.get(bike.address) === id) this._addressIndex.delete(bike.address);
        this._logger.log(
          `[bike-color-share] ${bike.controllerId} @ ${bike.address} dropped from registry (unseen `
          + `${now - bike.lastSeenMs} ms > dropAfterMs)`);
      }
    }
  }

  /**
   * One keepalive cycle: read getPalette() ONCE, validate it, then POST to
   * every LINKED bike SEQUENTIALLY (staggered — same ESP32-gentleness rule
   * as sweepOnce). Never throws (a timer must not die from this); a bad
   * palette or a bike failure is logged and skipped, not propagated.
   * Single-flight: a concurrent call while one is already running is a
   * no-op.
   */
  async pushOnce({ reason = 'manual' } = {}) {
    if (this._pushing) return;
    this._pushing = true;
    const startedAtMs = this._now();
    this._lastPushStartedMs = startedAtMs;
    try {
      let palette;
      try {
        palette = this.getPalette();
      } catch (e) {
        this._logger.error(`[bike-color-share] getPalette() threw: ${e.message} — skipping push cycle`);
        this.stats.paletteErrors++;
        return;
      }
      if (!palette || !isValidTriple(palette.color1) || !isValidTriple(palette.color2)) {
        this._logger.error(
          `[bike-color-share] invalid palette from getPalette() (expected {color1:{h,s,v},color2:{h,s,v}} `
          + `0..1), got ${JSON.stringify(palette)} — skipping push cycle (never pushing garbage)`);
        this.stats.paletteErrors++;
        return;
      }

      const linked = [...this._registry.values()].filter((b) => b.state === BIKE_STATES.LINKED);
      for (let i = 0; i < linked.length; i++) {
        if (i > 0 && this.config.probeStaggerMs > 0) {
          await sleep(this.config.probeStaggerMs);
        }
        await this._pushOne(linked[i], palette);
      }

      this.stats.pushCycles++;
      if (reason === 'change') this.stats.changePushCycles++;
      const durationMs = this._now() - startedAtMs;
      if (durationMs > this.config.pushIntervalMs) {
        this.stats.pushCycleOverruns++;
        this._logger.warn(
          `[bike-color-share] push cycle took ${durationMs} ms, over the ${this.config.pushIntervalMs} ms `
          + 'cadence — LEASE RISK: the firmware lease is 60 s; a slow cadence can miss two keepalives '
          + 'and let a bike auto-revert its pre-engine colors.');
      }
    } finally {
      this._pushing = false;
      // A notification can arrive while any scheduled or manually-invoked
      // cycle is in flight. Guarantee one trailing newest-value cycle; the
      // scheduler guards make this idempotent with the timer wrappers above.
      if (this._changePending) this._scheduleChangePush();
    }
  }

  async _pushOne(bike, palette) {
    const wireBody = {
      color1: [palette.color1.h, palette.color1.s, palette.color1.v],
      color2: [palette.color2.h, palette.color2.s, palette.color2.v],
      engine: true,
    };
    try {
      const res = await this._fetch(`http://${bike.address}/api/colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wireBody),
        signal: this._signalFor(this.config.pushTimeoutMs),
      });
      if (res.status === 200) {
        const respBody = await res.json().catch(() => null);
        const now = this._now();
        bike.pushStats.ok++;
        bike.pushStats.consecutiveFailures = 0;
        bike.pushStats.lastPushMs = now;
        bike.lastSeenMs = now;
        if (respBody && respBody.engine && typeof respBody.engine.msRemaining === 'number') {
          bike.leaseMsRemaining = respBody.engine.msRemaining;
        }
        this.stats.pushesOk++;
        return;
      }
      if (res.status === 404) {
        // Firmware downgraded mid-show, or a different (unsupported) board
        // now answers at this address — either way, stop pushing to it.
        bike.state = BIKE_STATES.UNSUPPORTED;
        this._logger.error(
          `[bike-color-share] ${bike.controllerId} @ ${bike.address} UNSUPPORTED — POST /api/colors 404 `
          + 'mid-push. No further pushes will be sent to this bike; no fallback write path.');
        return;
      }
      this._recordPushFailure(bike, `POST /api/colors → ${res.status}`);
    } catch (e) {
      this._recordPushFailure(bike, e.message);
    }
  }

  _recordPushFailure(bike, reason) {
    bike.pushStats.failed++;
    bike.pushStats.consecutiveFailures++;
    this.stats.pushesFailed++;
    if (bike.pushStats.consecutiveFailures >= this.config.staleAfterFailures && bike.state !== BIKE_STATES.STALE) {
      bike.state = BIKE_STATES.STALE;
      this._logger.error(
        `[bike-color-share] ${bike.controllerId} @ ${bike.address} STALE — `
        + `${bike.pushStats.consecutiveFailures} consecutive push failures (${reason}); the firmware `
        + 'lease will now expire and the bike will auto-revert to its pre-engine colors.');
    } else {
      this._logger.warn(`[bike-color-share] ${bike.controllerId} @ ${bike.address} push failed: ${reason}`);
    }
  }

  /** JSON-safe snapshot for GET /bikes. */
  snapshot() {
    return {
      enabled: this.config.enabled,
      config: this.getConfig(),
      stats: { ...this.stats },
      bikes: [...this._registry.values()].map((b) => ({
        controllerId: b.controllerId,
        address: b.address,
        ip: b.ip,
        port: b.port,
        state: b.state,
        firmwareTag: b.firmwareTag,
        activePattern: b.activePattern,
        mac: b.mac,
        lastSeenMs: b.lastSeenMs,
        leaseMsRemaining: b.leaseMsRemaining,
        pushStats: { ...b.pushStats },
      })),
    };
  }
}
