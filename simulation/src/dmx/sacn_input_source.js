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
        console.log('[sACN Input] ✅ Connected to sACN bridge');
      };

      this._ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this._ws.onclose = () => {
        this._connected = false;
        this.stats.connected = false;
        if (this._enabled) {
          console.log(`[sACN Input] Disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
          this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
        }
      };

      this._ws.onerror = (err) => {
        // Suppress noisy connection-refused errors
        if (this._connected) {
          console.warn('[sACN Input] WebSocket error');
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
   * Handle incoming binary WebSocket message.
   * Format: [universe(2)] [priority(1)] [dmx(512)] = 515 bytes
   */
  _handleMessage(data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 515) return;

    const view = new DataView(data);
    const universe = view.getUint16(0, true); // little-endian
    const priority = view.getUint8(2);
    const dmx = new Uint8Array(data, 3, 512);

    // Submit to the router
    if (window.dmxRouter) {
      // Ensure universe exists in router
      if (!window.dmxRouter.getUniverse(universe)) {
        window.dmxRouter.addUniverse(universe);
        console.log(`[sACN Input] Auto-added universe ${universe} to router`);
      }
      window.dmxRouter.submitFrame(SACN_SOURCE_ID, priority || SACN_DEFAULT_PRIORITY, universe, dmx);
    }

    // Stats
    this._frameCount++;
    this.stats.framesReceived++;
    this.stats.lastUniverse = universe;
    this.stats.lastPriority = priority;

    const now = performance.now();
    if (now - this._lastLogTime > 5000) {
      this.stats.fps = Math.round(this._frameCount / 5);
      if (this._frameCount > 0) {
        console.log(`[sACN Input] ${this.stats.fps} fps, universe ${universe}, priority ${priority}`);
      }
      this._frameCount = 0;
      this._lastLogTime = now;
    }
  }
}

// Singleton — created once, toggled via enable/disable
let _instance = null;

/**
 * Get or create the sACN input source singleton.
 * @param {string} [wsUrl] — defaults to ws://localhost:5555
 * @returns {SacnInputSource}
 */
export function getSacnInput(wsUrl) {
  if (!_instance) {
    const url = wsUrl || `ws://${window.location.hostname || 'localhost'}:5555`;
    _instance = new SacnInputSource(url);
    window.sacnInput = _instance; // Expose for console debugging
  }
  return _instance;
}
