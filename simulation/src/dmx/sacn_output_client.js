/**
 * sacn_output_client.js — Browser-side sACN output via WebSocket bridge.
 *
 * Connects to the sacn_output_bridge WebSocket server and sends
 * DMX universe frames to real sACN controllers.
 *
 * Binary protocol (to server):
 *   Byte 0-1:   Universe number (uint16 LE)
 *   Byte 2-5:   Controller IPv4 (4 bytes)
 *   Byte 6:     Priority (uint8)
 *   Byte 7-518: DMX data (512 bytes)
 *   Total: 519 bytes
 */

const RECONNECT_DELAY_MS = 3000;
const DEFAULT_PRIORITY = 100;

export class SacnOutputClient {
  /**
   * @param {string} wsUrl — WebSocket URL (e.g. 'ws://localhost:6972')
   */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this._ws = null;
    this._connected = false;
    this._enabled = false;
    this._reconnectTimer = null;
    this._frameCount = 0;
    this._lastLogTime = 0;

    this.stats = {
      connected: false,
      framesSent: 0,
      fps: 0,
      activeUniverses: new Set(),
    };
  }

  /** Enable the output client and connect to the bridge. */
  enable() {
    if (this._enabled) return;
    this._enabled = true;
    console.log('[sACN Out] Enabling — connecting to', this.wsUrl);
    this._connect();
  }

  /** Disable the output client and disconnect. */
  disable() {
    this._enabled = false;
    this._cleanup();
    console.log('[sACN Out] Disabled');
    this.stats.connected = false;
  }

  /** Check if connected. */
  get connected() {
    return this._connected;
  }

  /**
   * Send a DMX universe frame to a specific controller.
   * @param {number} universeId — sACN universe (1-63999)
   * @param {string} controllerIp — Unicast destination (e.g. '10.1.1.102')
   * @param {number} priority — sACN priority (0-200)
   * @param {Uint8Array} dmxBuffer — 512-byte DMX frame
   */
  sendUniverse(universeId, controllerIp, priority, dmxBuffer) {
    if (!this._connected || !this._ws) return;

    // Build 519-byte binary frame
    const frame = new ArrayBuffer(519);
    const view = new DataView(frame);

    // Universe (2 bytes LE)
    view.setUint16(0, universeId, true);

    // Controller IP (4 bytes)
    const parts = controllerIp.split('.');
    for (let i = 0; i < 4; i++) {
      view.setUint8(2 + i, parseInt(parts[i], 10) || 0);
    }

    // Priority (1 byte)
    view.setUint8(6, priority || DEFAULT_PRIORITY);

    // DMX data (512 bytes)
    const dmxView = new Uint8Array(frame, 7, 512);
    const len = Math.min(dmxBuffer.length, 512);
    dmxView.set(dmxBuffer.subarray(0, len));

    try {
      this._ws.send(frame);
      this._frameCount++;
      this.stats.framesSent++;
      this.stats.activeUniverses.add(universeId);
    } catch (e) {
      // Connection probably dropped
    }

    // FPS tracking
    const now = performance.now();
    if (now - this._lastLogTime > 5000) {
      this.stats.fps = Math.round(this._frameCount / 5);
      this._frameCount = 0;
      this._lastLogTime = now;
    }
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
        console.log('[sACN Out] ✅ Connected to output bridge');
        if (typeof window.sacnOutLog === 'function') window.sacnOutLog('Connected to output bridge');
      };

      this._ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          try {
            const parsed = JSON.parse(evt.data);
            if (parsed.type === 'log') {
              if (typeof window.sacnOutLog === 'function') window.sacnOutLog(parsed.msg, parsed.level || 'info');
              else console.log(parsed.msg);
            }
          } catch(e) {}
        }
      };

      this._ws.onclose = () => {
        this._connected = false;
        this.stats.connected = false;
        if (this._enabled) {
          this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
        }
      };

      this._ws.onerror = () => {
        // Will trigger onclose
      };
    } catch (e) {
      console.warn('[sACN Out] Connection failed:', e.message);
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
      this._ws.onclose = null;
      this._ws.onerror = null;
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }
    this._connected = false;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────
let _instance = null;

/**
 * Get or create the sACN output client singleton.
 * @param {string} [wsUrl] — defaults to ws://localhost:6972
 * @returns {SacnOutputClient}
 */
export function getSacnOutput(wsUrl) {
  if (!_instance) {
    _instance = new SacnOutputClient(wsUrl || null);
    window.sacnOutput = _instance; // Expose for console debugging

    if (!wsUrl) {
      const host = window.location.hostname || 'localhost';
      fetch('/simulation/config.yaml')
        .then((r) => r.text())
        .then((txt) => {
          const match = txt.match(/sacn_output_port:\s*(\d+)/);
          const port = match ? match[1] : '6972';
          _instance.wsUrl = `ws://${host}:${port}`;

          const el = document.querySelector('.sacn-title:contains("OUT")') || 
                     [...document.querySelectorAll('.sacn-title')].find(e => e.innerText.includes('OUT'));
          if (el) el.innerText = `📡 sACN OUT Monitor (${port})`;

          if (_instance._enabled && !_instance._connected) _instance._connect();
        })
        .catch(() => {
          _instance.wsUrl = `ws://${host}:6972`;
          if (_instance._enabled && !_instance._connected) _instance._connect();
        });
    }
  }
  return _instance;
}
