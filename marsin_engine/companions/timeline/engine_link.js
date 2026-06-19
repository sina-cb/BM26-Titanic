/*
 * engine_link.js — the Timeline Companion's LIVE link to the marsin ENGINE
 * (HTTP :6968 + WS). The Timeline Companion is a DRIVER, not an executor: it
 * decides WHEN, the engine stays the executor of WHAT (docs/38 §2.1). This
 * link is how it issues the WHAT — load a playlist / set autopilot / push the
 * param-center / switch a scene / toggle a scheduled task — and how it learns
 * the MUSIC MOOD (audioParty) the mood cues follow.
 *
 * ░░ MOOD over WS (subscribe, never re-analyze) ░░
 * The Audio Companion is the SOLE analyzer (docs/37). We subscribe to the
 * engine's canonical param feeds — /ws/signals (`liveParams` frames) AND
 * /ws/params (`sharedParams` frames) — and read the operator's mood key
 * (default `audioParty`) off `params[moodKey].value`. party = value >=
 * partyThreshold ? 1 : 0. Both sockets reconnect INDEPENDENTLY with the same
 * backoff discipline as the Audio Companion's engine_config_link.js.
 *
 * ░░ ACTIONS over HTTP (fail loud) ░░
 * Every action method is `fetch` with an AbortController 2s timeout and
 * REJECTS LOUDLY on any non-2xx (codex P0 — a cue pointing at a missing
 * playlist/scene/palette must surface as an error, never a silent skip). The
 * companion keeps ticking and the WS reconnects in the background if the
 * engine is down; a failed dispatch is recorded + broadcast, never hidden.
 *
 * Offline-safe: uses the vendored `ws` client + Node's built-in fetch. No
 * CDNs, no extra deps.
 */
import { WebSocket } from 'ws';

// Reconnect backoff: snappy first retry, capped so a long engine outage
// doesn't hammer the box. The tick loop is unaffected either way.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
// HTTP timeout for every action call. Short — the engine is on loopback; a
// hang means it's down, and we want to fail fast and surface it.
const HTTP_TIMEOUT_MS = 2000;

// The two engine param topics that carry the mood key. /ws/signals delivers
// the tight `liveParams` bundle (where audio* keys live); /ws/params delivers
// the steady `sharedParams` snapshot. We subscribe to both so the mood is
// fresh regardless of which bucket the engine routes the key into.
const MOOD_TOPICS = Object.freeze([
  { path: '/ws/signals', type: 'liveParams' },
  { path: '/ws/params', type: 'sharedParams' },
]);

export class EngineLink {
  /**
   * @param {object} opts
   * @param {string} opts.host            engine API host (e.g. '127.0.0.1')
   * @param {number} opts.port            engine API port (e.g. 6968)
   * @param {string} opts.moodKey         CPC key to read mood from (e.g. 'audioParty')
   * @param {number} opts.partyThreshold  value >= threshold → party (1), else calm (0)
   * @param {(mood:{party:0|1, value:number}) => void} [opts.onMood]
   * @param {(connected:boolean, info?:object) => void} [opts.onStatus]
   */
  constructor({ host, port, moodKey, partyThreshold, onMood, onStatus }) {
    if (typeof host !== 'string' || !host) throw new Error('EngineLink: host must be a non-empty string');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`EngineLink: port must be an integer in [1, 65535], got ${port}`);
    }
    if (typeof moodKey !== 'string' || !moodKey) throw new Error('EngineLink: moodKey must be a non-empty string');
    if (typeof partyThreshold !== 'number' || Number.isNaN(partyThreshold)) {
      throw new Error('EngineLink: partyThreshold must be a number');
    }
    this.host = host;
    this.port = port;
    this.moodKey = moodKey;
    this.partyThreshold = partyThreshold;
    this.onMood = typeof onMood === 'function' ? onMood : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.httpBase = `http://${host}:${port}`;
    // One WS slot per mood topic — each reconnects on its own clock.
    this._sockets = MOOD_TOPICS.map((t) => ({
      topic: t,
      url: `ws://${host}:${port}${t.path}`,
      ws: null,
      reconnectTimer: null,
      reconnectMs: RECONNECT_MIN_MS,
      connected: false,
    }));
    this._stopped = false;
    this.latestMoodValue = null;
    this.latestParty = null;
    this._httpUp = false;
  }

  /** True iff at least one mood socket is currently open. */
  get connected() {
    return this._sockets.some((s) => s.connected);
  }

  /** Open both mood WS clients (reconnect forever until stop()). */
  start() {
    this._stopped = false;
    for (const slot of this._sockets) this._connectSocket(slot);
  }

  /** Close every socket + cancel pending reconnects. */
  stop() {
    this._stopped = true;
    for (const slot of this._sockets) {
      if (slot.reconnectTimer) { clearTimeout(slot.reconnectTimer); slot.reconnectTimer = null; }
      if (slot.ws) {
        try { slot.ws.removeAllListeners(); slot.ws.close(); } catch { /* ignore */ }
        slot.ws = null;
      }
      slot.connected = false;
    }
  }

  /**
   * Current mood snapshot. Default CALM (party 0, value 0) when unknown — a
   * mood cue must never spuriously fire before the first frame arrives.
   */
  mood() {
    return { party: this.latestParty ?? 0, value: this.latestMoodValue ?? 0 };
  }

  /** Best-effort: true after the last HTTP action call succeeded. */
  httpUp() {
    return this._httpUp;
  }

  _scheduleReconnect(slot) {
    if (this._stopped || slot.reconnectTimer) return;
    const delay = slot.reconnectMs;
    slot.reconnectMs = Math.min(RECONNECT_MAX_MS, slot.reconnectMs * 2);
    slot.reconnectTimer = setTimeout(() => {
      slot.reconnectTimer = null;
      this._connectSocket(slot);
    }, delay);
  }

  _connectSocket(slot) {
    if (this._stopped) return;
    let ws;
    try {
      ws = new WebSocket(slot.url);
    } catch {
      this._scheduleReconnect(slot);
      return;
    }
    slot.ws = ws;

    ws.on('open', () => {
      slot.connected = true;
      slot.reconnectMs = RECONNECT_MIN_MS;   // reset backoff on success
      this.onStatus(this.connected, { url: slot.url });
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }   // these topics carry many shapes; ignore non-JSON
      this._consumeFrame(slot, msg);
    });

    const drop = () => {
      if (slot.ws !== ws) return;
      slot.connected = false;
      slot.ws = null;
      this.onStatus(this.connected, { url: slot.url });
      this._scheduleReconnect(slot);
    };
    ws.on('close', drop);
    ws.on('error', () => {
      // 'error' is followed by 'close'; let close drive reconnect. Swallow so
      // an ECONNREFUSED can't crash boot (the tick loop runs without the engine).
    });
  }

  // Pull the mood key out of any frame that carries `params[moodKey].value`.
  // Both `liveParams` and `sharedParams` use `params: { key: { value } }`.
  _consumeFrame(slot, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== slot.topic.type) return;
    const params = msg.params;
    if (!params || typeof params !== 'object') return;
    const slot2 = params[this.moodKey];
    if (!slot2 || typeof slot2 !== 'object' || typeof slot2.value !== 'number') return;
    const value = slot2.value;
    const party = value >= this.partyThreshold ? 1 : 0;
    this.latestMoodValue = value;
    this.latestParty = party;
    try { this.onMood({ party, value }); }
    catch (e) { console.warn(`[timeline engine-link] onMood threw: ${e && e.message}`); }
  }

  // ── HTTP plumbing ──────────────────────────────────────────────────────────

  async _request(method, route, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const init = { method, signal: ctrl.signal };
      if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(`${this.httpBase}${route}`, init);
      const text = await res.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : {}; }
      catch { parsed = { raw: text }; }
      if (!res.ok) {
        this._httpUp = false;
        const detail = parsed && parsed.error ? parsed.error : `${res.status}`;
        const err = new Error(`${method} ${route} → ${detail}`);
        err.status = res.status;
        throw err;
      }
      this._httpUp = true;
      return parsed;
    } finally {
      clearTimeout(t);
    }
  }

  // ── action methods (engine contract; all throw loud on non-2xx) ─────────────

  getStatus() {
    return this._request('GET', '/status');
  }

  listPlaylists() {
    return this._request('GET', '/playlists');
  }

  getMixer() {
    return this._request('GET', '/mixer');
  }

  loadDeckPlaylist(name) {
    return this._request('POST', '/deck/playlist', { name });
  }

  setDeckAutopilot({ active, delay_s, shuffle }) {
    const body = {};
    if (active !== undefined) body.active = active;
    if (delay_s !== undefined) body.delay_s = delay_s;
    if (shuffle !== undefined) body.shuffle = shuffle;
    return this._request('POST', '/deck/playlist/autopilot', body);
  }

  loadMixerPlaylist(id, name) {
    return this._request('POST', `/mixer/channels/${encodeURIComponent(id)}/playlist`, { name });
  }

  async setMixerAutopilot(id, state) {
    try {
      return await this._request('POST', `/mixer/channels/${encodeURIComponent(id)}/autopilot`, {
        active: state.active,
        delay_s: state.delay_s,
        shuffle: state.shuffle,
      });
    } catch (err) {
      // The per-channel autopilot route ships in a later engine slice
      // (docs/38 §14.2, docs/19 Phase 2.3). Surface that explicitly rather
      // than letting a bare 404 confuse the operator — never swallow.
      if (err && err.status === 404) {
        throw new Error('mixer autopilot route not available yet (engine phase 2.5)');
      }
      throw err;
    }
  }

  setParamCenter(obj) {
    return this._request('POST', '/param-center', obj);
  }

  requestScene(scene) {
    return this._request('POST', '/scene', { scene });
  }

  patchScheduledTask(id, patch) {
    return this._request('PATCH', `/scheduled-tasks/${encodeURIComponent(id)}`, patch);
  }

  fireScheduledTask(id) {
    return this._request('POST', `/scheduled-tasks/${encodeURIComponent(id)}/fire-now`);
  }
}
