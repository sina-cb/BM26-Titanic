/**
 * OscListener — UDP OSC source adapter for the Central Parameter
 * Center (CPC).
 *
 * Reads OSC packets, looks up each address in a binding map
 * (canonical addresses from the CPC registry + user-defined bindings
 * from config.yaml), coerces argument types, and dispatches all
 * writes from a single packet through `paramCenter.setMany` so the
 * downstream onChange fires exactly once per packet.
 *
 * Design doc: docs/24_osc_integration.md (§3, §6, §7).
 * Implementation plan: .agent/02_reports/202605/20260524_1_osc_impl.md (Phase 3).
 *
 * Hard-fails fast: every config error throws from the constructor —
 * no silent skip of bad bindings, no partial binding map. The
 * engine boot in engine.js catches the throw and continues with
 * OSC disabled per docs/24 §13.1.
 */

import dgram from 'node:dgram';
import * as osc from 'osc-min';

import { gainByKeyForOsc } from '../audio/postproc/audio_signals.js';

// Per-signal post-processing (docs/29) runs in the engine via
// `lib/signal_post_processor.js`. The OSC listener accepts an OPTIONAL
// `signalPostProcessor` constructor arg and routes each gainable
// scalar write through `signalPostProcessor.process(key, raw, dt)`
// before publishing — so the chain framework's Gain op (and any
// downstream ops the operator adds) applies uniformly to stems just
// like it does to mic bands.
//
// GAIN_BY_KEY is preserved here as the source-side validation map:
// every live key the listener knows about that should be gain-aware
// MUST have its `*Gain` partner in the CPC registry, else boot
// crashes (Codex P0: a half-wired gain knob would silently do
// nothing, which is the failure mode this map exists to prevent).
// The MATH of gain is now in the chain framework — this map stays
// only as a boot-time existence check.
//
// DERIVED from `lib/audio_signals.js` (the single source of truth for
// the audio signal family) via `gainByKeyForOsc()` — NOT hand-listed —
// so adding/removing a gain-aware OSC signal is a one-line descriptor
// edit there. The `<liveKey>Raw` mirror map below is likewise derived at
// construction time from whichever `<key>Raw` keys exist in the registry.
export const GAIN_BY_KEY = Object.freeze(gainByKeyForOsc());

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Normalize a textual IP for allowlist comparison. Node UDP may
 * report loopback as 127.0.0.1, ::1, or as IPv4-mapped IPv6
 * (::ffff:127.0.0.1). Treat all three loopback forms as equal,
 * strip the IPv4-mapped prefix from any other v4-in-v6 address,
 * and lowercase whatever remains for v6 case-insensitivity.
 * Returns null on input that's clearly not a string.
 */
export function normalizeIp(addr) {
  if (typeof addr !== 'string') return null;
  let s = addr.trim();
  if (!s) return null;
  // Some Node versions surface "::ffff:127.0.0.1" — strip the
  // IPv4-mapped IPv6 prefix to compare against bare IPv4 config.
  if (/^::ffff:/i.test(s)) {
    s = s.slice(7);
  }
  // Loopback collapse: treat IPv6 loopback identically to v4.
  if (s === '::1') return '127.0.0.1';
  // Bracketed v6 ([::1]:port) — strip brackets.
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  return s.toLowerCase();
}

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
function isIpLiteral(str) {
  if (typeof str !== 'string') return false;
  if (IPV4_RE.test(str)) {
    return str.split('.').every(n => {
      const v = parseInt(n, 10);
      return v >= 0 && v <= 255;
    });
  }
  // Very loose IPv6 detection — Node's dgram itself will reject bad
  // literals on socket bind, and we use this only at startup-time
  // config validation, not at runtime. Allow any string with at
  // least one colon and only hex / colon / dot / brackets / ::ffff:.
  return /^[0-9a-f:.\[\]]+$/i.test(str) && str.includes(':');
}

/**
 * Coerce an osc-min arg into the scalar a CPC float/int expects.
 * Returns null for shapes we don't accept (caller should bump
 * `invalid`). See docs/24 §8.3.
 *
 * osc-min message arg shape: { type: 'float'|'integer'|'double'|
 *   'string'|'true'|'false'|'null'|'blob'|..., value: ... } — but
 * shorthand pure-number args are also accepted in case the encoder
 * upstream skipped the wrapping.
 */
export function coerceArg(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'object') {
    const t = raw.type;
    const v = raw.value;
    if (t === 'float' || t === 'integer' || t === 'double') {
      return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    }
    if (t === 'true') return 1;
    if (t === 'false') return 0;
    if (t === 'string' && typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// ── Canonical-binding construction ─────────────────────────────────────────

/**
 * Internal binding entry shape:
 *   { key: string, kind: 'scalar' | 'hsv-h' | 'hsv-s' | 'hsv-v',
 *     argIndex: number }
 *
 * One OSC address may resolve to multiple binding entries (object-
 * form bindings for XY pads, multi-arg packets, etc.). The
 * dispatcher feeds all of them into a single `setMany` call.
 */
function buildCanonicalBindings(schema) {
  const map = new Map();
  for (const entry of schema) {
    if (!entry.oscAddress) continue;
    if (entry.type === 'hsv') {
      // HSV gets four canonical addresses: aggregate + 3 sub-fields.
      // The aggregate address is not auto-bound — clients should use
      // the explicit sub-addresses (docs/24 §4.2). Skipping the
      // aggregate keeps the wire model orthogonal to component-wise
      // updates and matches user choice "hsv_addressing: sub_addresses".
      map.set(`${entry.oscAddress}/h`, [{ key: entry.key, kind: 'hsv-h', argIndex: 0 }]);
      map.set(`${entry.oscAddress}/s`, [{ key: entry.key, kind: 'hsv-s', argIndex: 0 }]);
      map.set(`${entry.oscAddress}/v`, [{ key: entry.key, kind: 'hsv-v', argIndex: 0 }]);
    } else {
      map.set(entry.oscAddress, [{ key: entry.key, kind: 'scalar', argIndex: 0 }]);
    }
  }
  return map;
}

/**
 * Merge user-defined bindings on top of canonical, validating each.
 * Throws on any malformed entry — never silently skip (docs/24 §13.1).
 *
 *   "/x": "speed"                          // shorthand → scalar arg 0
 *   "/touchosc/1/xy1":                     // object form → multi-key
 *     - { key: rotate, arg: 0 }
 *     - { key: size,   arg: 1 }
 */
function mergeCustomBindings(canonicalMap, userBindings, registryByKey) {
  if (!userBindings || typeof userBindings !== 'object') return;
  for (const [oscAddr, spec] of Object.entries(userBindings)) {
    if (canonicalMap.has(oscAddr)) {
      throw new Error(
        `OSC binding "${oscAddr}" collides with a canonical CPC address — ` +
        `remove the override or change the canonical oscAddress in PARAM_REGISTRY.`
      );
    }
    const entries = normalizeUserSpec(oscAddr, spec, registryByKey);
    canonicalMap.set(oscAddr, entries);
  }
}

function normalizeUserSpec(oscAddr, spec, registryByKey) {
  if (typeof spec === 'string') {
    return [makeBindingEntry(oscAddr, { key: spec, arg: 0 }, registryByKey)];
  }
  if (Array.isArray(spec)) {
    return spec.map(item => makeBindingEntry(oscAddr, item, registryByKey));
  }
  if (spec && typeof spec === 'object' && spec.key) {
    return [makeBindingEntry(oscAddr, spec, registryByKey)];
  }
  throw new Error(
    `OSC binding "${oscAddr}" has invalid shape; expected string, object, ` +
    `or array of objects with at least a "key" field.`
  );
}

function makeBindingEntry(oscAddr, item, registryByKey) {
  if (!item || typeof item.key !== 'string') {
    throw new Error(`OSC binding "${oscAddr}" entry missing "key".`);
  }
  const entry = registryByKey[item.key];
  if (!entry) {
    throw new Error(
      `OSC binding "${oscAddr}" references unknown CPC key "${item.key}".`
    );
  }
  const argIndex = (item.arg === undefined) ? 0 : item.arg;
  // arg validation at startup: integer, non-negative, reasonably
  // small (docs/24 §13.1, expert review #5). Runtime arg-count
  // bounds are checked per-packet (counts toward `invalid`).
  if (!Number.isInteger(argIndex) || argIndex < 0 || argIndex > 16) {
    throw new Error(
      `OSC binding "${oscAddr}" key "${item.key}" has arg=${argIndex}; ` +
      `must be a non-negative integer ≤ 16.`
    );
  }
  // HSV-typed CPC keys can't use shorthand: ambiguous which field
  // it would write. Force explicit sub-address bindings.
  if (entry.type === 'hsv' && !item.field) {
    throw new Error(
      `OSC binding "${oscAddr}" key "${item.key}" is HSV-typed; use the ` +
      `canonical sub-addresses ${entry.oscAddress}/{h,s,v} or specify ` +
      `field: 'h'|'s'|'v' in the binding entry.`
    );
  }
  let kind = 'scalar';
  if (entry.type === 'hsv') {
    if (item.field !== 'h' && item.field !== 's' && item.field !== 'v') {
      throw new Error(
        `OSC binding "${oscAddr}" key "${item.key}" field must be 'h', 's', or 'v'.`
      );
    }
    kind = `hsv-${item.field}`;
  }
  return { key: item.key, kind, argIndex };
}

function buildAllowedSenders(allowedSenders) {
  if (!Array.isArray(allowedSenders)) {
    throw new Error('osc.allowedSenders must be an array.');
  }
  const map = new Map();
  const namesSeen = new Set();
  for (const entry of allowedSenders) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('osc.allowedSenders entry must be an object with name + ip.');
    }
    const { name, ip } = entry;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('osc.allowedSenders entry missing "name".');
    }
    if (typeof ip !== 'string' || !ip.trim()) {
      throw new Error(`osc.allowedSenders entry "${name}" missing "ip".`);
    }
    if (!isIpLiteral(ip)) {
      throw new Error(
        `osc.allowedSenders entry "${name}" ip="${ip}" is not a parseable ` +
        `IPv4 / IPv6 literal (DNS names not supported in v1).`
      );
    }
    if (namesSeen.has(name)) {
      throw new Error(`osc.allowedSenders has duplicate name "${name}".`);
    }
    namesSeen.add(name);
    const normIp = normalizeIp(ip);
    if (!normIp) {
      throw new Error(`osc.allowedSenders entry "${name}" ip failed to normalize.`);
    }
    map.set(normIp, { name });
  }
  return map;
}

// ── OscListener ────────────────────────────────────────────────────────────

export class OscListener {
  /**
   * @param {object} opts
   * @param {number} opts.port
   * @param {string} [opts.host='0.0.0.0']
   * @param {object} [opts.bindings]
   * @param {Array}  [opts.allowedSenders]
   * @param {object} opts.paramCenter   — CPC instance (setMany/setHsvField/set)
   * @param {(stats: object) => void} [opts.onStats]
   * @param {object} [opts.signalPostProcessor] — when present, every
   *   gainable scalar write (keys in GAIN_BY_KEY) is routed through
   *   `signalPostProcessor.process(key, rawValue, dtSeconds)` before
   *   the post value is published. The raw mirror is written
   *   unchanged. When omitted (older boots / tests), gainable writes
   *   pass through unprocessed — the chain framework gracefully
   *   degrades to identity rather than block packets.
   */
  constructor(opts = {}) {
    const {
      port, host = '0.0.0.0',
      bindings = {}, allowedSenders = [],
      paramCenter, onStats,
      signalPostProcessor = null,
    } = opts;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`osc.port must be an integer in [1, 65535], got ${port}.`);
    }
    if (!paramCenter || typeof paramCenter.setMany !== 'function') {
      throw new Error('OscListener requires a paramCenter with setMany().');
    }
    if (typeof paramCenter.get !== 'function') {
      throw new Error(
        'OscListener requires a paramCenter with .get(key) for source-side gain reads.',
      );
    }

    this.port = port;
    this.host = host;
    this.paramCenter = paramCenter;
    this.onStats = onStats;
    this.signalPostProcessor = signalPostProcessor;
    // Last-dispatched timestamp per signal key — feeds dt into the
    // per-signal chain so time-domain ops (LPF, Envelope, Hold) get a
    // valid delta even though OSC packets land aperiodically. Seeded
    // at constructor time so the first packet sees dt = 0.
    this._lastDispatchAt = Object.create(null);

    // Build maps eagerly so any bad config throws BEFORE we open
    // the socket. No partial binding map ever survives the
    // constructor.
    const schema = paramCenter.getSchema();
    const registryByKey = Object.fromEntries(schema.map(e => [e.key, e]));
    this._bindingsByAddr = buildCanonicalBindings(schema);
    mergeCustomBindings(this._bindingsByAddr, bindings, registryByKey);
    this._allowedByIp = buildAllowedSenders(allowedSenders);

    // Source-side gain validation. For every (liveKey → gainKey) pair
    // in GAIN_BY_KEY, IF the live key is in the active registry we
    // require the gain key to be present too — otherwise the listener
    // would silently fall back to "no gain" for that band and the
    // operator's knob would do nothing (the exact bug this whole
    // refactor fixes). Codex P0 — fail at boot, not at first packet.
    //
    // We ALSO record an optional `<liveKey>Raw` mirror — when the
    // matching registry entry exists, the dispatcher writes the
    // PRE-gain value to it alongside the post-gain value. CaptainPad
    // SIGNAL DIAGNOSTICS reads these mirrors to show raw vs post.
    // No error if the *Raw key is missing (e.g. a deployment with an
    // older registry); raw publishing is a UI-only enhancement, the
    // gain pipeline stays intact either way.
    this._gainByKey = {};
    this._rawMirrorByKey = {};
    for (const [liveKey, gainKey] of Object.entries(GAIN_BY_KEY)) {
      if (!registryByKey[liveKey]) continue;
      if (!registryByKey[gainKey]) {
        throw new Error(
          `OscListener: live key ${liveKey} requires gain key ${gainKey} ` +
          `in the CPC registry (per GAIN_BY_KEY contract), but it is missing.`,
        );
      }
      this._gainByKey[liveKey] = gainKey;
      const rawKey = `${liveKey}Raw`;
      if (registryByKey[rawKey]) this._rawMirrorByKey[liveKey] = rawKey;
    }

    // Stats state. Counters are per-second snapshots, reset on
    // every fire (docs/24 §10.1).
    this._counters = { rx: 0, mapped: 0, dropped: 0, invalid: 0 };
    this._lastSeenMs = 0;
    this._lastSender = null;
    this._statsTimer = null;
    this._socket = null;
    this._logBudget = new Map();  // key -> nextAllowedMs

    // Pre-computed metadata for telemetry.
    this._bindingsCount = this._bindingsByAddr.size;
    this._allowedCount = this._allowedByIp.size;
  }

  /**
   * Add a runtime scalar OSC binding (address → CPC key, arg 0). Used by
   * the Audio Companion manifest path to wire a freshly-registered dynamic
   * live key without rebuilding the whole listener. Idempotent: re-adding
   * the same (address, key) pair is a no-op; a DIFFERENT key on the same
   * address replaces the binding (the Companion owns its addresses).
   *
   * Refuses to clobber a CANONICAL address (one that already carries a
   * binding NOT created by addDynamicBinding) — that would silently
   * redirect a built-in signal. Codex P0: fail loud.
   *
   * @param {string} address — OSC address (e.g. /marsin/companion/foo)
   * @param {string} key — CPC key the address writes to
   * @throws {Error} on a non-string address/key or a canonical-address collision.
   */
  addDynamicBinding(address, key) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error('addDynamicBinding: address must be a non-empty string.');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('addDynamicBinding: key must be a non-empty string.');
    }
    this._dynamicAddrs = this._dynamicAddrs || new Set();
    const prior = this._bindingsByAddr.get(address);
    if (prior && !this._dynamicAddrs.has(address)) {
      // The address already carries a binding the listener built at
      // construction time. If that binding is the SAME single scalar key
      // we're adding, it's a benign duplicate — the dynamic key was
      // registered in the CPC BEFORE this listener was constructed, so
      // buildCanonicalBindings already wired it. Adopt it into the dynamic
      // set so removeDynamicBinding can clean it up later. Otherwise it
      // points at a DIFFERENT (built-in) key — refuse loudly so a Companion
      // address can't silently hijack a curated signal (Codex P0).
      const sameScalarKey = prior.length === 1
        && prior[0].kind === 'scalar' && prior[0].key === key;
      if (!sameScalarKey) {
        throw new Error(
          `addDynamicBinding: address "${address}" collides with a non-dynamic ` +
          `OSC binding — refusing to override.`,
        );
      }
    }
    this._bindingsByAddr.set(address, [{ key, kind: 'scalar', argIndex: 0 }]);
    this._dynamicAddrs.add(address);
    this._bindingsCount = this._bindingsByAddr.size;
  }

  /**
   * Remove a runtime binding previously added via addDynamicBinding.
   * No-op if the address isn't a dynamic binding. Returns true if removed.
   * @param {string} address
   * @returns {boolean}
   */
  removeDynamicBinding(address) {
    if (!this._dynamicAddrs || !this._dynamicAddrs.has(address)) return false;
    this._bindingsByAddr.delete(address);
    this._dynamicAddrs.delete(address);
    this._bindingsCount = this._bindingsByAddr.size;
    return true;
  }

  start() {
    if (this._socket) return;
    // `reuseAddr: true` lets us take the port back immediately after a
    // previous engine instance dies. Without it the OS holds the UDP
    // socket in a brief grace period and a fresh restart races into
    // EADDRINUSE — exactly the failure the operator saw across hot
    // restarts ("force kill the port and make sure we can attach to
    // it for OSC"). SO_REUSEADDR on UDP is safe: a previously-bound
    // socket from the SAME process still has priority, and a stale
    // socket from a dead process is already gone.
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (buf, rinfo) => this._onPacket(buf, rinfo));
    socket.on('error', (err) => {
      console.error('[OSC] socket error:', err && err.message);
    });
    socket.bind(this.port, this.host);
    this._socket = socket;
    this._statsTimer = setInterval(() => this._publishStats(), 1000);
    // Don't keep the event loop alive just for the stats timer —
    // engine lifecycle owns shutdown.
    if (this._statsTimer.unref) this._statsTimer.unref();
  }

  /**
   * Same as start() but returns a promise that resolves once the
   * socket is actually bound, or rejects with the bind error (e.g.
   * EADDRINUSE). Lets engine.js retry-with-backoff cleanly when a
   * stale process is releasing the port slowly.
   *
   * @returns {Promise<void>}
   */
  async startAsync() {
    if (this._socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (buf, rinfo) => this._onPacket(buf, rinfo));
    await new Promise((resolve, reject) => {
      const onBindError = (err) => {
        socket.removeListener('listening', onListening);
        try { socket.close(); } catch (_) { /* ignore */ }
        reject(err);
      };
      const onListening = () => {
        socket.removeListener('error', onBindError);
        // Swap to the steady-state error logger.
        socket.on('error', (err) => {
          console.error('[OSC] socket error:', err && err.message);
        });
        resolve();
      };
      socket.once('error', onBindError);
      socket.once('listening', onListening);
      socket.bind(this.port, this.host);
    });
    this._socket = socket;
    this._statsTimer = setInterval(() => this._publishStats(), 1000);
    if (this._statsTimer.unref) this._statsTimer.unref();
  }

  stop() {
    if (this._statsTimer) {
      clearInterval(this._statsTimer);
      this._statsTimer = null;
    }
    if (this._socket) {
      try { this._socket.close(); } catch (_) { /* already closed */ }
      this._socket = null;
    }
  }

  /** Snapshot for boot-time "disabled" payload + diagnostic sheets. */
  getStatus() {
    return {
      enabled: !!this._socket,
      port: this.port,
      host: this.host,
      allowedSendersCount: this._allowedCount,
      bindingsCount: this._bindingsCount,
      rxMessagesPerSec: this._counters.rx,
      mappedMessagesPerSec: this._counters.mapped,
      droppedMessagesPerSec: this._counters.dropped,
      invalidMessagesPerSec: this._counters.invalid,
      lastSeenMs: this._lastSeenMs,
      lastSender: this._lastSender,
      now: Date.now(),
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _publishStats() {
    if (this.onStats) {
      this.onStats({ type: 'oscStats', ...this.getStatus() });
    }
    this._counters.rx = 0;
    this._counters.mapped = 0;
    this._counters.dropped = 0;
    this._counters.invalid = 0;
  }

  _warnOncePerMinute(key, msg) {
    const now = Date.now();
    const next = this._logBudget.get(key) || 0;
    if (now < next) return;
    this._logBudget.set(key, now + 60_000);
    console.warn(msg);
  }

  _onPacket(buf, rinfo) {
    this._counters.rx += 1;

    // Allowlist gate (only enforced when non-empty).
    const normIp = normalizeIp(rinfo.address) || rinfo.address;
    let origin;
    if (this._allowedByIp.size > 0) {
      const sender = this._allowedByIp.get(normIp);
      if (!sender) {
        this._counters.dropped += 1;
        this._warnOncePerMinute(
          `unauth:${normIp}`,
          `[OSC] rejected packet from unauthorized sender ${normIp}`
        );
        return;
      }
      origin = `osc:${sender.name}`;
    } else {
      origin = `osc:${normIp}:${rinfo.port}`;
    }

    // Decode. osc-min throws on malformed input; treat the entire
    // packet as `invalid` and move on (docs/24 §6.6).
    let decoded;
    try {
      decoded = osc.fromBuffer(buf);
    } catch (err) {
      this._counters.invalid += 1;
      this._warnOncePerMinute(
        `malformed:${normIp}`,
        `[OSC] malformed packet from ${normIp}: ${err.message}`
      );
      return;
    }

    if (decoded.oscType === 'bundle') {
      // Flatten one level of bundle so a TouchOSC packet with multiple
      // messages still goes through one batch *per address*. We
      // don't try to merge messages across addresses into one
      // setMany — that would change observable timing semantics.
      for (const el of decoded.elements || []) {
        if (el.oscType === 'message') {
          this._dispatchMessage(el, origin, normIp);
        }
      }
      return;
    }
    this._dispatchMessage(decoded, origin, normIp);
  }

  _dispatchMessage(msg, origin, normIp) {
    if (!msg || typeof msg.address !== 'string') {
      this._counters.invalid += 1;
      return;
    }
    const bindings = this._bindingsByAddr.get(msg.address);
    if (!bindings) {
      this._counters.dropped += 1;
      return;
    }
    const args = msg.args || [];
    const writes = [];
    for (const b of bindings) {
      const raw = args[b.argIndex];
      if (raw === undefined) {
        // Runtime: the packet shape doesn't match the binding's
        // declared arg index. Skip this entry, others on the same
        // packet still apply (docs/24 §6.6).
        this._counters.invalid += 1;
        continue;
      }
      const value = coerceArg(raw);
      if (value === null) {
        this._counters.invalid += 1;
        continue;
      }
      if (b.kind === 'scalar') {
        // Source-side post-processing: if this live key has a gain
        // partner (stems*, mic*) AND the engine wired a
        // signalPostProcessor, push the value through the chain
        // BEFORE it lands in CPC. Every downstream consumer sees the
        // post-processed value — one truth. The chain's first op is
        // a Gain tied to `paramKey: '<key>Gain'`, so the operator's
        // existing gain slider behaviour is preserved verbatim while
        // any extra ops (LPF / Schmitt / Hold / etc.) layer on top.
        const hasGain = this._gainByKey[b.key] !== undefined;
        let outValue = value;
        if (hasGain && this.signalPostProcessor) {
          const nowMs = Date.now();
          const prevMs = this._lastDispatchAt[b.key];
          const dt = (prevMs === undefined) ? 0 : Math.max(0, (nowMs - prevMs) / 1000);
          this._lastDispatchAt[b.key] = nowMs;
          outValue = this.signalPostProcessor.process(b.key, value, dt);
        }
        writes.push({ kind: 'scalar', key: b.key, value: outValue });
        // RAW mirror: when the registry has a `<liveKey>Raw` entry
        // (e.g. stemsBassRaw), publish the PRE-processing value to it
        // in the same setMany batch. CaptainPad SIGNAL DIAGNOSTICS
        // uses these to show raw vs post side-by-side without having
        // to reconstruct raw from `post / gain` (which can't recover
        // clipped post=1.0 cases). The raw value is clamped to [0, 1]
        // to match the live-key contract — a malformed OSC sender
        // shouldn't put a denormal on the wire.
        const rawKey = this._rawMirrorByKey[b.key];
        if (rawKey !== undefined) {
          const clamped = value < 0 ? 0 : (value > 1 ? 1 : value);
          writes.push({ kind: 'scalar', key: rawKey, value: clamped });
        }
      } else {
        const field = b.kind.slice(4);  // 'h'|'s'|'v'
        writes.push({ kind: 'hsv', key: b.key, field, value });
      }
    }
    if (writes.length === 0) return;
    this.paramCenter.setMany(writes, 'osc', origin);
    this._counters.mapped += writes.length;
    this._lastSeenMs = Date.now();
    this._lastSender = origin;
  }
}
