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

    // Stats
    this.stats = {
      connected: false,
      framesReceived: 0,
      fps: 0,
      lastUniverse: 0,
      lastPriority: 0,
      activeUniverses: new Set(),
    };
  }

  /**
   * Enable the sACN input source and connect to the bridge.
   */
  enable() {
    if (this._enabled) return;
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

  // ── Internal ─────────────────────────────────────────────────────────

  _connect() {
    if (!this._enabled) return;
    this._cleanup();

    try {
      this._ws = new WebSocket(this.wsUrl);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this._connected = true;
        this.stats.connected = true;
        if (window.sacnLog) window.sacnLog('Connected to bridge', 'source');
      };

      this._ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this._ws.onclose = () => {
        this._connected = false;
        this.stats.connected = false;
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
    const host = window.location.hostname || 'localhost';
    const url = wsUrl || `ws://${host}:6971`;
    _instance = new SacnInputSource(url);
    window.sacnInput = _instance; // Expose for console debugging
  }
  return _instance;
}
