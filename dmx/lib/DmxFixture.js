'use strict';
/**
 * DmxFixture — Base class for all DMX fixtures.
 *
 * A fixture knows its local channel layout (from a YAML profile) but has
 * NO knowledge of where it sits in a universe.  The universe calls
 * _attach(buffer, offset) at placement time; from that point all writes
 * go directly into the shared universe buffer at (offset + ch - 1).
 *
 * Nothing is sent to the network until DmxUniverse.send() is called.
 */

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class DmxFixture {
    /**
     * @param {string} label        - Fixture label from universes.yaml (e.g. "bar_1")
     * @param {string} profilePath  - Absolute path to the channel-profile YAML
     */
    constructor(label, profilePath) {
        this.label   = label;
        this.profile = yaml.load(fs.readFileSync(profilePath, 'utf8'));

        if (!this.profile.fixture || !this.profile.fixture.total_channels) {
            throw new Error(`[DmxFixture] Profile ${profilePath} missing fixture.total_channels`);
        }

        this.totalChannels = this.profile.fixture.total_channels;

        // Set by _attach() — not available before placement
        this._buffer = null;
        this._offset = 0;   // 0-indexed byte offset into the universe buffer
    }

    /**
     * Called by DmxUniverse when placing this fixture.
     * @param {Buffer} buffer   - The universe's 512-byte shared buffer
     * @param {number} offset   - 0-indexed byte offset (= dmx_start_address - 1)
     */
    _attach(buffer, offset) {
        this._buffer = buffer;
        this._offset = offset;
    }

    /** True once _attach() has been called */
    get attached() { return this._buffer !== null; }

    /**
     * Write a value to a local channel.
     * @param {number} ch  - Local channel number, 1-indexed (1 = first ch of this fixture)
     * @param {number} val - DMX value, 0-255
     */
    setChannel(ch, val) {
        if (!this._buffer) throw new Error(`[DmxFixture:${this.label}] Not attached to a universe`);
        if (ch < 1 || ch > this.totalChannels) {
            throw new RangeError(`[DmxFixture:${this.label}] Local channel ${ch} out of range (1–${this.totalChannels})`);
        }
        this._buffer[this._offset + ch - 1] = val & 0xFF;
    }

    /** Zero all local channels in the buffer (does NOT send). */
    blackout() {
        if (!this._buffer) return;
        this._buffer.fill(0, this._offset, this._offset + this.totalChannels);
    }
}

module.exports = { DmxFixture };
