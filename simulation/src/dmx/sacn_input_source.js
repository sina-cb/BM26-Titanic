/**
 * sacn_input_source.js — Browser-side sACN receiver via WebSocket.
 *
 * Connects to the Node.js sacn_bridge WebSocket server, receives
 * DMX frames, and feeds them to the UniverseRouter as a high-priority source.
 *
 * This is a "lighting engine" that can be selected in the UI alongside
 * pixelblaze and gradient modes.
 *
 * Binary protocol (from server):
 *   Byte 0-1:  Universe number (uint16 LE)
 *   Byte 2:    Priority (uint8)
 *   Byte 3-514: DMX data (512 bytes)
 */

import { isStaticHost, logStaticHostSkip } from '../core/static_host.js';
import { handleClientCensus } from '../gui/multi_client_warning.js';

const RECONNECT_DELAY_MS = 3000;
const SACN_SOURCE_ID = 'sacn_in';
const SACN_DEFAULT_PRIORITY = 200; // Higher than pixelblaze (100)

export class SacnInputSource {
  /**
   * @param {string} wsUrl — WebSocket URL (e.g. 'ws://localhost:5555')
   */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this._ws = null;
    this._connected = false;
    this._enabled = false;
    this._reconnectTimer = null;
    this._frameCount = 0;
    this._lastLogTime = 0;
    this._lastSourceName = '';
    // Pending `getRoutes` queries (report 20260725_127): reqId → {resolve,
    // reject, timer}. The bridge echoes the reqId on its `{type:'routes'}`
    // reply so concurrent queries cannot steal each other's answer.
    this._routeWaiters = new Map();
    this._routeReqSeq = 0;

    // Stats
    this.stats = {
      connected: false,
      framesReceived: 0,
      fps: 0,
      lastUniverse: 0,
      lastPriority: 0,
      activeUniverses: new Set(),
      // Freshness: the monitor surfaces a STALLED state from this — a
      // connected socket with aging frames is otherwise invisible
      // (task 021: frames froze for 40 s with zero indication).
      lastFrameAt: 0,
      // (Re)connect timestamp: framesReceived is cumulative across
      // reconnects, so the stall clock must restart from here or the
      // monitor cries STALLED in the reconnect→first-frame gap.
      connectedAt: 0,
    };
  }

  /**
   * Enable the sACN input source and connect to the bridge.
   */
  enable() {
    if (this._enabled) return;
    // Static host: no bridge, no ws:// from https://. Refuse to enable so the
    // reconnect loop in _connect() never starts.
    if (isStaticHost()) {
      logStaticHostSkip('sACN IN enable (port 6971)');
      return;
    }
    this._enabled = true;
    console.log('[sACN Input] Enabling — connecting to', this.wsUrl);
    this._connect();
  }

  /**
   * Disable the sACN input source and disconnect.
   */
  disable() {
    this._enabled = false;
    this._cleanup();
    console.log('[sACN Input] Disabled');

    // Remove source from router so it stops contributing
    if (window.dmxRouter) {
      window.dmxRouter.removeSource(SACN_SOURCE_ID);
    }

    this.stats.connected = false;
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  get connected() {
    return this._connected;
  }

  /**
   * Read the bridge's ACTIVE route table back (report 20260725_127): sends
   * `{type:'getRoutes', reqId}` and resolves with the bridge's
   * `{type:'routes', routes, engineOwned, mirrorOwned, activeScenes}` reply.
   *
   * REJECTS loudly when the socket is down, the send fails, or the bridge does
   * not answer within `timeoutMs` — the caller (the LED push's third check)
   * must render that as a failed measurement, never assume routes followed.
   *
   * Sent on the SAME socket `setScene` notifies travel, so a query issued
   * after a notify is answered from the post-recompute table (WS ordering).
   *
   * @param {number} [timeoutMs]
   * @returns {Promise<Object>} the bridge's routes reply, verbatim.
   */
  queryRoutes(timeoutMs = 2000) {
    if (!this._ws || this._ws.readyState !== 1) {
      return Promise.reject(new Error(
        'sACN bridge WebSocket not connected — the route table cannot be read'));
    }
    this._routeReqSeq += 1;
    const reqId = `routes-${this._routeReqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._routeWaiters.delete(reqId);
        reject(new Error(`the sACN bridge did not answer the route-table query within ` +
          `${timeoutMs} ms — is it running current code? Restart the launcher.`));
      }, timeoutMs);
      this._routeWaiters.set(reqId, { resolve, reject, timer });
      try {
        this._ws.send(JSON.stringify({ type: 'getRoutes', reqId }));
      } catch (e) {
        clearTimeout(timer);
        this._routeWaiters.delete(reqId);
        reject(new Error(`could not send the route-table query to the sACN bridge: ${e.message}`));
      }
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _connect() {
    if (!this._enabled) return;
    if (!this.wsUrl) return; // Guard for async config injection
    this._cleanup();

    try {
      this._ws = new WebSocket(this.wsUrl);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this._connected = true;
        this.stats.connected = true;
        this.stats.connectedAt = Date.now();
        if (window.sacnLog) window.sacnLog('Connected to bridge', 'source');

        // Dynamically tell the server which scene config to route outbound IPs for
        try {
          const params = new URLSearchParams(window.location.search);
          const activeScene = params.get('scene') || 'titanic';
          this._ws.send(JSON.stringify({ type: 'setScene', scene: activeScene }));
        } catch(e) {}
      };

      this._ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this._ws.onclose = () => {
        this._connected = false;
        this.stats.connected = false;
        // Census unknown while disconnected — hide the multi-client banner
        // rather than display stale information (it re-arms on reconnect).
        handleClientCensus(null);
        if (this._enabled) {
          if (window.sacnLog) window.sacnLog('Disconnected — reconnecting...', 'warn');
          this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
        }
      };

      this._ws.onerror = () => {
        if (this._connected && window.sacnLog) {
          window.sacnLog('WebSocket error', 'error');
        }
      };
    } catch (e) {
      console.warn('[sACN Input] Connection failed:', e.message);
      if (this._enabled) {
        this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
      }
    }
  }

  _cleanup() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    // A socket that goes away takes its unanswered route queries with it —
    // reject them NOW so the push's read-back fails fast and loud instead of
    // sitting out its full timeout against a dead connection.
    for (const waiter of this._routeWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(
        'sACN bridge WebSocket closed before the route-table reply arrived'));
    }
    this._routeWaiters.clear();
    if (this._ws) {
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onclose = null;
      this._ws.onerror = null;
      try { this._ws.close(); } catch (e) {}
      this._ws = null;
    }
    this._connected = false;
  }

  /**
   * Handle incoming WebSocket message.
   * Binary: [universe(2)] [priority(1)] [dmx(512)] = 515 bytes
   * Text/JSON: { type: 'log', msg, level }
   */
  _handleMessage(data) {
    // Text message — may arrive as string or ArrayBuffer (binaryType='arraybuffer')
    if (typeof data === 'string') {
      this._handleTextMessage(data);
      return;
    }

    // ArrayBuffer — could be DMX frame (515 bytes) or JSON log (shorter)
    if (data instanceof ArrayBuffer) {
      if (data.byteLength === 515) {
        // DMX frame
        this._handleDmxFrame(data);
      } else {
        // Try as text (JSON log from bridge)
        try {
          const text = new TextDecoder().decode(data);
          this._handleTextMessage(text);
        } catch (e) { /* ignore */ }
      }
    }
  }

  _handleTextMessage(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.type === 'log' && window.sacnLog) {
        window.sacnLog(parsed.msg, parsed.level || 'info');
      } else if (parsed.type === 'clients') {
        // Bridge client census — >1 connected sim window is a production
        // hazard (GPU contention + duplicate sACN writers, report
        // 20260724_15). Surface the HUD banner in THIS window too.
        handleClientCensus(parsed.count);
      } else if (parsed.type === 'routes') {
        const waiter = this._routeWaiters.get(parsed.reqId);
        if (waiter) {
          clearTimeout(waiter.timer);
          this._routeWaiters.delete(parsed.reqId);
          waiter.resolve(parsed);
        }
      }
    } catch (e) { /* ignore non-JSON */ }
  }

  _handleDmxFrame(data) {

    const view = new DataView(data);
    const universe = view.getUint16(0, true); // little-endian
    const priority = view.getUint8(2);
    const dmx = new Uint8Array(data, 3, 512);



    // Submit to the router
    if (window.dmxRouter) {
      // Ensure universe exists in router
      if (!window.dmxRouter.getUniverse(universe)) {
        window.dmxRouter.addUniverse(universe);
        if (window.sacnLog) window.sacnLog(`Auto-added universe ${universe}`, 'source');
      }
      window.dmxRouter.submitFrame(SACN_SOURCE_ID, priority || SACN_DEFAULT_PRIORITY, universe, dmx);
    }

    // Stats
    this._frameCount++;
    this.stats.framesReceived++;
    this.stats.lastUniverse = universe;
    this.stats.lastPriority = priority;
    this.stats.activeUniverses.add(universe);
    this.stats.lastFrameAt = Date.now();

    const now = performance.now();
    if (now - this._lastLogTime > 5000) {
      this.stats.fps = Math.round(this._frameCount / 5);
      this._frameCount = 0;
      this._lastLogTime = now;
      // Reset active universes for next window (re-populated on next frames)
      this.stats.activeUniverses = new Set();
    }
  }
}

// Singleton — created once, toggled via enable/disable
let _instance = null;

/**
 * Get or create the sACN input source singleton.
 * @param {string} [wsUrl] — defaults to ws://localhost:6970/sacn
 * @returns {SacnInputSource}
 */
export function getSacnInput(wsUrl) {
  if (!_instance) {
    _instance = new SacnInputSource(wsUrl || null);
    window.sacnInput = _instance; // Expose for console debugging

    if (isStaticHost()) {
      logStaticHostSkip('sACN IN bridge (port 6971)');
      return _instance;
    }

    if (!wsUrl) {
      const host = window.location.hostname || 'localhost';
      // Resolve the WebSocket port from the dev server's config.yaml. Use a
      // relative URL so the path is correct under a non-root base path; the
      // previous absolute "/simulation/config.yaml" 404'd on github.io/<repo>/.
      fetch('config.yaml')
        .then((r) => r.text())
        .then((txt) => {
          const match = txt.match(/sacn_port:\s*(\d+)/);
          const port = match ? match[1] : '6971';
          _instance.wsUrl = `ws://${host}:${port}`;

          // Also update the UI header dynamically if exists
          const el = document.querySelector('.sacn-title');
          if (el && el.innerText.includes('sACN IN')) {
            el.innerText = `📡 sACN IN Monitor (${port})`;
          }

          if (_instance._enabled && !_instance._connected) {
            _instance._connect();
          }
        })
        .catch((e) => {
          console.warn('[sACN Input] Could not fetch server_config.yaml, using default port 6971');
          _instance.wsUrl = `ws://${host}:6971`;
          if (_instance._enabled && !_instance._connected) _instance._connect();
        });
    }
  }
  return _instance;
}
