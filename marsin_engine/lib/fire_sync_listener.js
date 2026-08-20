/**
 * FireSyncListener — drive a global effect from REAL poofer fire.
 *
 * The BM26-Stoker fire controllers broadcast one small JSON datagram on every
 * actual relay-mask change (their read-only monitor task; outbound only). The
 * Stoker control panel relays those, by unicast, to this engine when the
 * operator enables "fire → lights sync" in its console. We translate each edge
 * into a loopback `POST /global-effect {effect, state}` so the lights hold
 * `vintageWhite` exactly while flame is out.
 *
 *   {"t":"fire_evt","v":1,"side":"A","mask":3,"prev":0,"seq":17,"up_ms":123456}
 *
 *   mask/prev bits: 0..2 = poofers 1..3, bit 3 = the Side-A steam whistle.
 *
 * Why the existing REST route instead of calling the controller directly:
 * `/global-effect` is idempotent and takes an EXPLICIT state (never a toggle,
 * which would desync under a lost or duplicated datagram), it does not depend on
 * the GEM slot layout (an operator remapping a slot must not silently break fire
 * sync), and reusing it means CaptainPad's WebSocket state broadcast comes for
 * free. `setEffect` throws on an unknown effect name, so a typo 400s loudly
 * rather than going quiet.
 *
 * SAFETY / SCOPE: this is a LIGHTS feature and is strictly one-way. Nothing here
 * can command, gate, or influence fire — the stoker feed is transmit-only on the
 * controllers, and this listener only ever answers with a `fire_ack`, which the
 * panel uses solely to colour a status dot. The datagrams are plaintext and
 * unauthenticated by design (documented threat model): a spoofer on the LAN can
 * make the lights flash, which is strictly less than what they could already do
 * by calling this engine's own unauthenticated `/global-effect` directly.
 *
 * Hard-fails fast, like OscListener: every config error throws from the
 * constructor — no silent skip, no half-configured listener. The engine boot
 * catches the throw and continues with fire sync disabled, loudly.
 */

import dgram from 'node:dgram';

export const PROTO_VERSION = 1;
export const POOFER_MASK = 0x07;   // bits 0..2 — the flame channels
export const WHISTLE_BIT = 0x08;   // bit 3 — steam whistle, NOT flame

// Default trigger mask: poofers only. The whistle rides the same wire so a
// future mapping can give it its own effect, but a steam whistle is not fire and
// must not flash the flame lights.
export const DEFAULT_TRIGGER_MASK = POOFER_MASK;
export const DEFAULT_MIN_ON_MS = 150;

// ── Trigger envelope (LIGHTS ONLY) ─────────────────────────────────────────
// Vintage filament heads take a moment to come up and a moment to die, so a
// 90 ms poof otherwise reads as a weak flicker and the end reads as a cut.
//   minOnMs   ATTACK — hold the trigger ON at least this long past the last
//             rising edge. A HOLD, not a ramp up: ramping up would make short
//             poofs dimmer, the opposite of what the physics asks for.
//   releaseMs RELEASE — ramp the white down over this long when the flame
//             stops (applied by GlobalEffectsController, which owns pixel
//             values). 0 = the historical instant off.
// Both live at runtime: the Stoker control panel is the operator's console and
// the persistent store, and it pushes a `fire_cfg` datagram (on save and every
// 10 s). The engine's config.yaml values are only the BOOT DEFAULT until one
// arrives; the engine deliberately writes no YAML back — the panel is the
// authority and re-pushes, so there is exactly one place a value is kept.
export const DEFAULT_RELEASE_MS = 400;
export const ENVELOPE_MAX_MS = 5000;   // same bound the panel enforces

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Parse one datagram into a frame object, or return an error tag.
 *
 * Returns `{ ok: true, frame }` for a well-formed, supported frame, or
 * `{ ok: false, reason }` where reason is one of 'malformed' | 'unsupported'.
 * NEVER throws: a hostile or stale sender must cost a counter increment, not an
 * exception storm on the event loop.
 *
 * @param {Buffer|string} buf
 */
export function parseFrame(buf) {
  let msg;
  try {
    msg = JSON.parse(typeof buf === 'string' ? buf : buf.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, reason: 'malformed' };
  }
  const t = msg.t;
  if (t === 'fire_ping') {
    // Reachability probe from the panel's SAVE & TEST button. Acked, never acted
    // on — it carries no mask and must not disturb the effect state.
    return { ok: true, frame: { t: 'fire_ping', seq: Number(msg.seq) || 0 } };
  }
  if (t === 'fire_cfg') {
    // Trigger-envelope push from the panel (LIGHTS ONLY — this frame cannot
    // start, extend or stop anything; it only changes how long the lights hold
    // and how fast they die). Both fields are REQUIRED and bounds-checked here:
    // an out-of-range value is 'malformed' and is dropped whole, never clamped
    // and never half-applied.
    if (msg.v !== PROTO_VERSION) return { ok: false, reason: 'unsupported' };
    const seq = msg.seq;
    const minOn = msg.min_on;
    const release = msg.release;
    if (!Number.isInteger(seq) || seq < 0) return { ok: false, reason: 'malformed' };
    if (!Number.isInteger(minOn) || minOn < 0 || minOn > ENVELOPE_MAX_MS) {
      return { ok: false, reason: 'malformed' };
    }
    if (!Number.isInteger(release) || release < 0 || release > ENVELOPE_MAX_MS) {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, frame: { t: 'fire_cfg', seq, minOn, release } };
  }
  if (t !== 'fire_evt') return { ok: false, reason: 'unsupported' };
  if (msg.v !== PROTO_VERSION) return { ok: false, reason: 'unsupported' };
  const side = typeof msg.side === 'string' ? msg.side : null;
  const mask = msg.mask;
  const seq = msg.seq;
  if (!side || !Number.isInteger(mask) || mask < 0 || mask > 255) {
    return { ok: false, reason: 'malformed' };
  }
  if (!Number.isInteger(seq) || seq < 0) return { ok: false, reason: 'malformed' };
  const prev = Number.isInteger(msg.prev) ? msg.prev : 0;
  return { ok: true, frame: { t: 'fire_evt', side, mask, prev, seq, upMs: Number(msg.up_ms) || 0 } };
}

/**
 * Per-side sequence dedupe.
 *
 * Each controller emits a per-BOOT monotonic counter and re-sends every edge
 * once, 50 ms later, with the SAME seq — that duplicate is what this drops. A
 * controller reboot restarts the counter at 1, which shows up as a seq that went
 * BACKWARDS; that is a new boot, not a replay, so it is accepted and the tracker
 * resets. (This channel is unauthenticated by design, so nothing here is a
 * security control — it is purely de-duplication.)
 *
 * Mutates `seen` (a plain object or Map-like keyed by side). Returns
 * `'accept' | 'duplicate' | 'reboot'`.
 */
export function classifySeq(seen, side, seq) {
  const last = seen[side];
  if (last === undefined) { seen[side] = seq; return 'accept'; }
  if (seq === last) return 'duplicate';
  if (seq < last) { seen[side] = seq; return 'reboot'; }
  seen[side] = seq;
  return 'accept';
}

/**
 * Combined desired state: is ANY side currently firing a triggering channel?
 * `masks` is a plain object of side -> last mask.
 */
export function combinedState(masks, triggerMask) {
  for (const key of Object.keys(masks)) {
    if ((masks[key] & triggerMask) !== 0) return true;
  }
  return false;
}

// ── FireSyncListener ───────────────────────────────────────────────────────

export class FireSyncListener {
  /**
   * @param {object} opts
   * @param {number} opts.port          — UDP port to bind (stoker: 7703)
   * @param {string} [opts.host]        — bind address, default 0.0.0.0
   * @param {string} opts.effect        — global-effect name, e.g. 'vintageWhite'
   * @param {number} [opts.triggerMask] — relay bits that count as fire (default 0x07)
   * @param {number} [opts.minOnMs]     — minimum visible ON time (default 150)
   * @param {number} [opts.releaseMs]   — white release ramp (default 400, 0 = cut)
   * @param {string} [opts.apiHost]     — engine REST host, default 127.0.0.1
   * @param {number} opts.apiPort       — engine REST port (config server.port)
   * @param {(state:boolean)=>Promise<void>} [opts.setEffect] — injectable
   *   transport, used by tests. Defaults to the loopback REST call.
   * @param {(ms:number)=>void} [opts.applyRelease] — hand the release time to
   *   whatever renders it (engine wiring passes the GlobalEffectsController's
   *   setVintageWhiteReleaseMs). Absent = the release half is inert and
   *   getStatus() says so, rather than silently pretending it applied.
   * @param {(s:object)=>void} [opts.onStats]
   */
  constructor(opts = {}) {
    const {
      port, host = '0.0.0.0',
      effect,
      triggerMask = DEFAULT_TRIGGER_MASK,
      minOnMs = DEFAULT_MIN_ON_MS,
      releaseMs = DEFAULT_RELEASE_MS,
      apiHost = '127.0.0.1',
      apiPort,
      setEffect = null,
      applyRelease = null,
      onStats = null,
    } = opts;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`fire_sync.port must be an integer in [1, 65535], got ${port}.`);
    }
    if (typeof effect !== 'string' || !effect.trim()) {
      throw new Error('fire_sync.effect must be a non-empty global-effect name.');
    }
    if (!Number.isInteger(triggerMask) || triggerMask < 1 || triggerMask > 255) {
      throw new Error(
        `fire_sync.triggerMask must be an integer in [1, 255], got ${triggerMask}.`);
    }
    if (!Number.isFinite(minOnMs) || minOnMs < 0 || minOnMs > 10000) {
      throw new Error(`fire_sync.minOnMs must be a number in [0, 10000], got ${minOnMs}.`);
    }
    if (!Number.isFinite(releaseMs) || releaseMs < 0 || releaseMs > ENVELOPE_MAX_MS) {
      throw new Error(
        `fire_sync.releaseMs must be a number in [0, ${ENVELOPE_MAX_MS}], got ${releaseMs}.`);
    }
    if (!setEffect && (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535)) {
      throw new Error(
        `fire_sync needs the engine API port (server.port) to post /global-effect, got ${apiPort}.`);
    }

    this.port = port;
    this.host = host;
    this.effect = effect.trim();
    this.triggerMask = triggerMask;
    this.minOnMs = minOnMs;
    this.releaseMs = releaseMs;
    this.apiHost = apiHost;
    this.apiPort = apiPort;
    this.onStats = onStats;
    this._setEffect = setEffect || ((state) => this._postGlobalEffect(state));
    this._applyRelease = applyRelease || null;
    // Envelope provenance, so status/debug can tell a pushed value from the
    // boot default instead of showing one number with no history.
    this._cfgSeq = 0;         // last fire_cfg seq applied (0 = none yet)
    this._cfgAppliedAt = 0;   // Date.now() of that apply

    this._socket = null;
    this._seenSeq = Object.create(null);   // side -> last seq
    this._masks = Object.create(null);     // side -> last mask
    // Effect state machine. `_target` is what the fire state says the lights
    // should be; `_sent` is what we have actually told the engine. They differ
    // only while a POST is in flight or a min-ON hold is running.
    this._target = false;
    this._sent = false;
    // Last state we ATTEMPTED to send. Distinct from `_sent` so a failed POST is
    // not retried in a tight loop: we tried, it failed, we say so, and the next
    // real fire edge is what tries again. (Codex: never auto-retry into a storm;
    // a stuck engine API must not become a flood of requests + log lines.)
    this._attempted = false;
    this._sending = false;
    this._onAt = 0;
    this._offTimer = null;
    this._lastError = null;
    this._counters = { rx: 0, applied: 0, duplicate: 0, invalid: 0, reboots: 0, posts: 0, errors: 0 };
  }

  /** Bind the socket. Rejects on bind failure (e.g. EADDRINUSE). */
  async startAsync() {
    if (this._socket) return;
    // Put the configured release time in force before the first frame can
    // arrive, so the engine is never running an envelope nobody asked for.
    if (this._applyRelease) this._applyRelease(this.releaseMs);
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (buf, rinfo) => this._onPacket(buf, rinfo));
    await new Promise((resolve, reject) => {
      const onBindError = (err) => {
        socket.removeListener('listening', onListening);
        try { socket.close(); } catch { /* already closed */ }
        reject(err);
      };
      const onListening = () => {
        socket.removeListener('error', onBindError);
        socket.on('error', (err) => {
          console.error('[fire-sync] socket error:', err && err.message);
        });
        resolve();
      };
      socket.once('error', onBindError);
      socket.once('listening', onListening);
      socket.bind(this.port, this.host);
    });
    this._socket = socket;
  }

  stop() {
    if (this._offTimer) { clearTimeout(this._offTimer); this._offTimer = null; }
    if (this._socket) {
      try { this._socket.close(); } catch { /* already closed */ }
      this._socket = null;
    }
  }

  getStatus() {
    return {
      enabled: !!this._socket,
      port: this.port,
      host: this.host,
      effect: this.effect,
      triggerMask: this.triggerMask,
      minOnMs: this.minOnMs,
      releaseMs: this.releaseMs,
      // false = nothing is rendering the release ramp (no applyRelease wired),
      // so releaseMs above is a stored number and NOT in force. Said out loud
      // rather than implied.
      releaseApplied: !!this._applyRelease,
      cfgSeq: this._cfgSeq,
      cfgAppliedAt: this._cfgAppliedAt,
      effectState: this._sent,
      sides: { ...this._masks },
      lastError: this._lastError,
      ...this._counters,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _onPacket(buf, rinfo) {
    this._counters.rx += 1;
    const res = parseFrame(buf);
    if (!res.ok) {
      this._counters.invalid += 1;
      return;
    }
    const frame = res.frame;

    if (frame.t === 'fire_cfg') {
      // Envelope push from the panel. Bounds were already checked in
      // parseFrame, so reaching here means the values are legal. Applied at
      // runtime and answered with the values NOW IN FORCE — the panel renders
      // only what this ack says, so it can never claim an applied value we did
      // not apply. Nothing about fire is touched.
      this._applyCfg(frame);
      this._cfgAck(frame.seq, rinfo);
      return;
    }

    // Ack EVERY understood frame back to whoever sent it. This is the panel's
    // only reachability signal, and it must be answered even for the
    // `fire_ping` probe (which deliberately carries no state).
    this._ack(frame.seq, rinfo);
    if (frame.t === 'fire_ping') return;

    const verdict = classifySeq(this._seenSeq, frame.side, frame.seq);
    if (verdict === 'duplicate') {
      // The controller's 50 ms loss-robustness re-send. Expected, not an error.
      this._counters.duplicate += 1;
      return;
    }
    if (verdict === 'reboot') this._counters.reboots += 1;

    this._counters.applied += 1;
    this._masks[frame.side] = frame.mask;
    this._evaluate();
  }

  /**
   * Apply a validated envelope. `minOnMs` is this listener's own coalescing
   * rule; `releaseMs` belongs to whoever renders pixel values, so it is handed
   * over through the injected callback. A callback that throws (e.g. a future
   * renderer with tighter bounds) must not take the socket down: it is logged
   * on the transition, and the ack then reports what is really in force.
   */
  _applyCfg(frame) {
    const changed = frame.minOn !== this.minOnMs || frame.release !== this.releaseMs;
    this.minOnMs = frame.minOn;
    if (this._applyRelease) {
      try {
        this._applyRelease(frame.release);
        this.releaseMs = frame.release;
      } catch (err) {
        const msg = (err && err.message) || String(err);
        if (this._lastError !== msg) {
          this._lastError = msg;
          console.warn(`[fire-sync] release ${frame.release} ms REFUSED by the renderer: ${msg}`);
        }
        this._counters.errors += 1;
      }
    } else {
      // Nothing renders the ramp in this wiring; store it so getStatus() is
      // honest (releaseApplied:false says it is not in force).
      this.releaseMs = frame.release;
    }
    this._cfgSeq = frame.seq;
    this._cfgAppliedAt = Date.now();
    if (changed) {
      console.log(`[fire-sync] envelope: min-ON ${this.minOnMs} ms, release ${this.releaseMs} ms` +
        (this._applyRelease ? '' : ' (release NOT rendered — no renderer wired)'));
    }
  }

  /** Echo the envelope values now IN FORCE (never the requested ones). */
  _cfgAck(seq, rinfo) {
    if (!this._socket) return;
    const payload = Buffer.from(JSON.stringify({
      t: 'cfg_ack', v: PROTO_VERSION, seq: seq | 0,
      min_on: this.minOnMs, release: this.releaseMs,
    }), 'utf8');
    try {
      this._socket.send(payload, rinfo.port, rinfo.address);
    } catch { /* fire-and-forget; a lost ack costs a console status line only */ }
  }

  _ack(seq, rinfo) {
    if (!this._socket) return;
    const payload = Buffer.from(
      JSON.stringify({ t: 'fire_ack', v: PROTO_VERSION, seq: seq | 0 }), 'utf8');
    try {
      this._socket.send(payload, rinfo.port, rinfo.address);
    } catch { /* fire-and-forget; a failed ack costs a status dot, nothing more */ }
  }

  /**
   * Apply the min-ON coalescing rule and drive the effect.
   *
   * A strobing effect can produce ~20 edges/s per side. Without this the engine
   * would issue an HTTP call — and the route's YAML state write — per edge, and
   * the flicker would be too fast to read as anything. Holding ON for at least
   * `minOnMs` past the last rising edge caps the call rate at ~1/minOnMs and
   * makes fast bursts read as one solid stab of white.
   */
  _evaluate() {
    const want = combinedState(this._masks, this.triggerMask);
    const now = Date.now();

    if (want) {
      if (this._offTimer) { clearTimeout(this._offTimer); this._offTimer = null; }
      this._onAt = now;
      if (!this._target) {
        this._target = true;
        this._flush();
      }
      return;
    }

    if (!this._target) return;             // already off (or never on)
    const heldFor = now - this._onAt;
    if (heldFor >= this.minOnMs) {
      this._target = false;
      this._flush();
      return;
    }
    if (this._offTimer) return;            // hold already scheduled
    this._offTimer = setTimeout(() => {
      this._offTimer = null;
      // Re-check: fire may have restarted while the hold was running.
      if (combinedState(this._masks, this.triggerMask)) return;
      this._target = false;
      this._flush();
    }, this.minOnMs - heldFor);
    if (this._offTimer.unref) this._offTimer.unref();
  }

  /**
   * Drive the engine toward `_target`, one request at a time. Serializing means
   * a burst collapses to the final state instead of racing two POSTs whose
   * responses could land out of order and leave the lights inverted.
   *
   * Gated on `_attempted`, not `_sent`: each target value is attempted exactly
   * once, so a failing API costs one request + one log line per EDGE rather than
   * an unbounded retry loop.
   */
  _flush() {
    if (this._sending || this._attempted === this._target) return;
    const state = this._target;
    this._attempted = state;
    this._sending = true;
    this._counters.posts += 1;
    Promise.resolve()
      .then(() => this._setEffect(state))
      .then(() => {
        this._sent = state;
        if (this._lastError) {
          console.log(`[fire-sync] ${this.effect} control recovered`);
          this._lastError = null;
        }
      })
      .catch((err) => {
        this._counters.errors += 1;
        const msg = (err && err.message) || String(err);
        // Log on the TRANSITION into failure only — a dead API during a long
        // burn must not flood the console with one line per poof.
        if (this._lastError !== msg) {
          this._lastError = msg;
          console.warn(`[fire-sync] failed to set ${this.effect}=${state}: ${msg}`);
        }
      })
      .finally(() => {
        this._sending = false;
        if (this.onStats) this.onStats({ type: 'fireSyncStats', ...this.getStatus() });
        this._flush();   // target may have moved while we were in flight
      });
  }

  async _postGlobalEffect(state) {
    const url = `http://${this.apiHost}:${this.apiPort}/global-effect`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effect: this.effect, state }),
    });
    if (!res.ok) {
      // setEffect throws on an unknown effect name and the route answers 400 —
      // surface that verbatim instead of pretending the lights changed.
      const body = await res.text().catch(() => '');
      throw new Error(`POST /global-effect ${res.status}: ${body.slice(0, 160)}`);
    }
  }
}
