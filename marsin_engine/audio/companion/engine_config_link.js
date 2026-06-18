/*
 * engine_config_link.js — the Audio Companion's LIVE two-way link to the
 * engine's SHARED audio TUNING config (input gain / source smoothing /
 * capture device).
 *
 * ░░ SINGLE SOURCE OF TRUTH ░░
 * The engine config is authoritative for the shared analyzer tuning. The
 * Companion is the SOLE analyzer, but it must analyze with the SAME gain /
 * smoothing / device the operator set anywhere (CaptainPad, the engine, or
 * the Companion's own UI). This link makes that real:
 *
 *   - SUBSCRIBE: opens a resilient WS client to the engine's /ws/control
 *     and listens for `audioConfig` broadcasts. On connect it also does a
 *     one-shot GET /audio/config to SEED (so it never waits for the first
 *     PATCH). Every config frame fires `onConfig(config)` — the Companion
 *     applies bands.inputGain → its analyzer gain, bands.sourceSmoothHz →
 *     its smoothing, capture.device → its device.
 *
 *   - WRITE THROUGH: `patch(partial)` PATCHes /audio/config on the engine.
 *     The engine persists it (single source of truth) and rebroadcasts to
 *     ALL subscribers (CaptainPad + this link's own echo), so the Companion
 *     applies on the echo — no divergent local-only state for shared params.
 *
 * ░░ GRACEFUL DEGRADATION (codex P0: fail loud, never silent-wrong) ░░
 * The Companion's ANALYSIS is INDEPENDENT of the engine (audio/README.md).
 * This link is an OPTIONAL ENHANCEMENT: if the engine WS isn't reachable it
 * reconnects in the BACKGROUND while the Companion keeps analyzing with its
 * last-known/local tuning — analysis NEVER blocks on the engine. A
 * write-through `patch()` that can't reach the engine REJECTS loudly (the
 * caller then applies locally + surfaces the degraded state); it never
 * swallows the failure and pretends the engine took the change.
 *
 * Offline-safe: uses the vendored `ws` client + Node's built-in fetch. No
 * CDNs, no extra deps.
 */
import { WebSocket } from 'ws';

// Reconnect backoff: snappy first retry, capped so a long engine outage
// doesn't hammer the box. Analysis is unaffected either way.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
// HTTP timeout for the seed GET + write-through PATCH. Short — the engine is
// on loopback; a hang means it's down, and we want to degrade fast.
const HTTP_TIMEOUT_MS = 2000;

export class EngineConfigLink {
  /**
   * @param {object} opts
   * @param {string} opts.host   engine API host (e.g. '127.0.0.1')
   * @param {number} opts.port   engine API port (e.g. 6968)
   * @param {(config:object) => void} opts.onConfig  applied on seed + every broadcast
   * @param {(connected:boolean, info?:object) => void} [opts.onStatus]  link up/down
   */
  constructor({ host, port, onConfig, onStatus }) {
    if (typeof host !== 'string' || !host) throw new Error('EngineConfigLink: host must be a non-empty string');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`EngineConfigLink: port must be an integer in [1, 65535], got ${port}`);
    }
    if (typeof onConfig !== 'function') throw new Error('EngineConfigLink: onConfig must be a function');
    this.host = host;
    this.port = port;
    this.onConfig = onConfig;
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.wsUrl = `ws://${host}:${port}/ws/control`;
    this.httpBase = `http://${host}:${port}`;
    this._ws = null;
    this._stopped = false;
    this._reconnectTimer = null;
    this._reconnectMs = RECONNECT_MIN_MS;
    this.connected = false;
  }

  /** Open the link and keep it open (reconnects forever until stop()). */
  start() {
    this._stopped = false;
    this._connect();
  }

  /** Close the link and cancel any pending reconnect. */
  stop() {
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      try { this._ws.removeAllListeners(); this._ws.close(); } catch { /* ignore */ }
      this._ws = null;
    }
    this.connected = false;
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer) return;
    const delay = this._reconnectMs;
    this._reconnectMs = Math.min(RECONNECT_MAX_MS, this._reconnectMs * 2);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _connect() {
    if (this._stopped) return;
    let ws;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (e) {
      // Construction itself failed (bad URL is impossible here, but be safe).
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this._reconnectMs = RECONNECT_MIN_MS;   // reset backoff on success
      this.onStatus(true, { url: this.wsUrl });
      // Seed once over HTTP in case the WS replay raced or the engine was
      // mid-boot. Idempotent with the replayed `audioConfig` frame — both
      // just call onConfig with the same shape.
      this._seed();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }   // /ws/control carries many types; ignore non-JSON
      if (msg && msg.type === 'audioConfig' && msg.config && typeof msg.config === 'object') {
        try { this.onConfig(msg.config); }
        catch (e) { console.warn(`[companion engine-link] onConfig threw: ${e && e.message}`); }
      }
    });

    const drop = () => {
      if (!this.connected && this._ws !== ws) return;
      this.connected = false;
      this._ws = null;
      this.onStatus(false, { url: this.wsUrl });
      this._scheduleReconnect();
    };
    ws.on('close', drop);
    ws.on('error', () => {
      // The 'error' is almost always followed by 'close'; let close drive
      // the reconnect. Swallow here so an ECONNREFUSED doesn't crash boot
      // (the Companion analyzes fine without the engine).
    });
  }

  async _seed() {
    try {
      const config = await this.fetchConfig();
      if (config) this.onConfig(config);
    } catch (e) {
      // Seed is best-effort; the WS `audioConfig` replay covers the gap.
      console.warn(`[companion engine-link] seed GET /audio/config failed: ${e && e.message}`);
    }
  }

  /**
   * One-shot GET /audio/config. Returns the config object, or null if the
   * engine reports audio isn't initialized. Throws on transport failure.
   */
  async fetchConfig() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.httpBase}/audio/config`, { signal: ctrl.signal });
      if (res.status === 503) return null;   // audio_not_initialized
      if (!res.ok) throw new Error(`GET /audio/config → ${res.status}`);
      const body = await res.json();
      return (body && typeof body === 'object') ? body : null;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Write a SHARED tuning change through to the engine (single source of
   * truth). `partial` is the same shape PATCH /audio/config accepts, e.g.
   *   { bands: { inputGain: 2.0 } }
   *   { capture: { device: ':1' } }
   *
   * Resolves with the engine's post-PATCH config (which then ALSO arrives
   * as an `audioConfig` broadcast → onConfig). REJECTS loudly on any
   * failure (engine down, 400 validation, etc.) so the caller can fall
   * back to a local apply and surface the degraded state — never a silent
   * swallow that pretends the engine accepted the change.
   */
  async patch(partial) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.httpBase}/audio/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body && body.error ? body.error : `PATCH /audio/config → ${res.status}`);
      }
      return body;
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Resolve the engine API endpoint the Companion should sync against from a
 * loaded config.yaml object. Order:
 *   1. companion.engine.{host,port}  (explicit override)
 *   2. companion.engine.port + loopback host
 *   3. server.port + loopback host   (the engine's own API port)
 *   4. default 127.0.0.1:6968
 *
 * Loopback is the right default host: the Companion and engine run on the
 * same Pi (mirrors how companion OSC resolves its send target).
 */
export function resolveEngineEndpoint(cfg) {
  const DEFAULT = { host: '127.0.0.1', port: 6968 };
  const eng = cfg && cfg.companion && cfg.companion.engine;
  if (eng && typeof eng === 'object') {
    const host = (typeof eng.host === 'string' && eng.host) ? eng.host : DEFAULT.host;
    if (Number.isInteger(eng.port) && eng.port >= 1 && eng.port <= 65535) {
      return { host, port: eng.port };
    }
  }
  if (cfg && cfg.server && Number.isInteger(cfg.server.port)) {
    return { host: DEFAULT.host, port: cfg.server.port };
  }
  return { ...DEFAULT };
}
