'use strict';
/**
 * DmxUniverse — One sACN (E1.31) output universe (512 channels).
 *
 * Owns a 512-byte DMX buffer. Fixtures are placed into the universe
 * via addFixture(); the universe assigns them their buffer offset and
 * they write directly into this shared buffer.
 *
 * Call send() to flush the full buffer as one sACN (E1.31) UDP packet.
 *
 * sACN priority (0-200) enables hardware-level source arbitration:
 * when another source (e.g. Chromatik at priority 150) sends to the
 * same universe, the PKnight node automatically follows the higher-
 * priority source.  When that source stops, the node falls back to
 * the lower-priority stream (this server at priority 100).
 */

const { Sender } = require('sacn');

class DmxUniverse {
    /**
     * @param {object} cfg              - Universe config block from universes.yaml
     * @param {string} cfg.id
     * @param {string} cfg.name
     * @param {object} cfg.controller
     * @param {string} cfg.controller.ip           - Unicast destination IP
     * @param {number} [cfg.controller.universe]    - sACN universe (1-63999, 1-indexed)
     * @param {number} [cfg.controller.priority]    - sACN priority (0-200, default 100)
     * @param {string} [cfg.controller.sourceName]  - sACN source name
     */
    constructor(cfg) {
        this.id   = cfg.id;
        this.name = cfg.name || cfg.id;

        // 512-byte DMX buffer — shared with all attached fixtures
        this.buffer = Buffer.alloc(512, 0);

        // Fixture map: label → fixture instance
        this._fixtures = new Map();

        // sACN configuration
        const c = cfg.controller;
        this._sacnUniverse  = c.universe || 1;
        this._sacnPriority  = c.priority != null ? c.priority : 100;
        this._sacnSourceName = c.sourceName || 'BM26-Titanic';
        this._unicastIp      = c.ip;

        // sACN sender (created in constructor, ready to send immediately)
        this._sender = new Sender({
            universe:              this._sacnUniverse,
            reuseAddr:             true,
            defaultPacketOptions: {
                sourceName:     this._sacnSourceName,
                priority:       this._sacnPriority,
                useRawDmxValues: true,
            },
            ...(this._unicastIp ? { useUnicastDestination: this._unicastIp } : {}),
        });
    }

    // ── Fixture Management ─────────────────────────────────────────────────

    /**
     * Place a fixture into this universe.
     * @param {import('./DmxFixture').DmxFixture} fixture
     * @param {number} dmxStartAddress - 1-indexed DMX start address
     */
    addFixture(fixture, dmxStartAddress) {
        const offset = dmxStartAddress - 1;   // convert to 0-indexed buffer offset
        const end    = offset + fixture.totalChannels;

        if (end > 512) {
            throw new RangeError(
                `[DmxUniverse:${this.id}] Fixture "${fixture.label}" ` +
                `(start=${dmxStartAddress}, len=${fixture.totalChannels}) exceeds 512 channels`
            );
        }

        fixture._attach(this.buffer, offset);
        this._fixtures.set(fixture.label, fixture);

        console.log(
            `[DmxUniverse:${this.id}] Placed "${fixture.label}" ` +
            `ch ${dmxStartAddress}–${dmxStartAddress + fixture.totalChannels - 1}`
        );
    }

    /**
     * Retrieve a fixture by label.
     * @param {string} label
     * @returns {import('./DmxFixture').DmxFixture}
     */
    fixture(label) {
        const f = this._fixtures.get(label);
        if (!f) throw new Error(`[DmxUniverse:${this.id}] Unknown fixture "${label}"`);
        return f;
    }

    /** All fixtures as a Map<label, fixture> */
    get fixtures() { return this._fixtures; }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Initialize the sACN sender.
     * The sacn Sender is ready immediately after construction, but
     * this method exists for API compatibility with the rest of the system.
     */
    async init() {
        console.log(
            `[DmxUniverse:${this.id}] sACN ready — universe ${this._sacnUniverse}, ` +
            `priority ${this._sacnPriority}, ` +
            `target ${this._unicastIp || 'multicast'}, ` +
            `${this._fixtures.size} fixture(s)`
        );
    }

    /** Close the sACN sender socket. */
    close() {
        this._sender.close();
        console.log(`[DmxUniverse:${this.id}] Closed`);
    }

    // ── Output ─────────────────────────────────────────────────────────────

    /**
     * Convert the 512-byte buffer to the sacn payload format.
     * Returns { 1: val, 2: val, ..., 512: val } with raw DMX values.
     * @returns {object}
     */
    _bufferToPayload() {
        const payload = {};
        for (let i = 0; i < 512; i++) {
            payload[i + 1] = this.buffer[i];
        }
        return payload;
    }

    /** Flush the full 512-byte buffer to the sACN network. */
    send() {
        this._sender.send({
            payload: this._bufferToPayload(),
            sourceName: this._sacnSourceName,
            priority: this._sacnPriority
        }).catch(err => {
            console.error(`[DmxUniverse:${this.id}] sACN send error:`, err.message);
        });
    }

    /** Set a universe-global channel (1-indexed) and send immediately. */
    setChannel(ch, val) {
        if (ch < 1 || ch > 512) throw new RangeError('Channel must be 1–512');
        this.buffer[ch - 1] = val & 0xFF;
        this.send();
    }

    /**
     * Bulk-copy a raw 512-byte buffer (e.g. from an external engine or sACN receiver).
     * Does NOT send — call send() after to flush.
     * @param {Buffer|Uint8Array} buf
     */
    writeRaw(buf) {
        const len = Math.min(buf.length, 512);
        buf.copy ? buf.copy(this.buffer, 0, 0, len)
                 : this.buffer.set(buf.subarray(0, len), 0);
    }

    /** Zero the buffer and send a blackout packet. */
    blackout() {
        this.buffer.fill(0);
        this.send();
        console.log(`[DmxUniverse:${this.id}] Blackout`);
    }
}

module.exports = { DmxUniverse };
