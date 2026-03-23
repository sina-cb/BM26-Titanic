'use strict';
/**
 * EndyshowBar — Endyshow 240W Stage Strobe LED Bar
 *
 * Extends DmxFixture with high-level methods for all channel sections.
 * Supports modes: 7 / 13 / 82 / 130 / 135 channels.
 *
 * Verified pixel channel order: R, G, B (manual had R, B, G typo).
 *
 * Pixel layout (135-ch mode):
 *   CH1–96    32 RGB pixels (3 ch each)
 *   CH97–112  16 Amber segments
 *   CH113–128 16 White segments
 *   CH129     RGB Strobe
 *   CH130     ACW Strobe
 *   CH131     RGB Effect Channel
 *   CH132     RGB Speed
 *   CH133     RGB Background Color
 *   CH134     ACW Effect Channel
 *   CH135     ACW Speed
 */

const path = require('path');
const { DmxFixture } = require('../DmxFixture');

// Derive channel offsets from the number of RGB pixels supported per mode
const MODE_LAYOUT = {
    7:   { rgbPixels: 0,  amberPixels: 0,  whitePixels: 0,  controlStart: 1  },
    13:  { rgbPixels: 0,  amberPixels: 0,  whitePixels: 0,  controlStart: 1  },
    82:  { rgbPixels: 16, amberPixels: 16, whitePixels: 16, controlStart: 81 },
    130: { rgbPixels: 32, amberPixels: 16, whitePixels: 16, controlStart: 129 },
    135: { rgbPixels: 32, amberPixels: 16, whitePixels: 16, controlStart: 129 },
};

class EndyshowBar extends DmxFixture {
    /**
     * @param {string} label
     * @param {string} profilePath - Absolute path to channels_N.yaml
     */
    constructor(label, profilePath) {
        super(label, profilePath);

        const totalCh = this.totalChannels;
        if (!MODE_LAYOUT[totalCh]) {
            throw new Error(`[EndyshowBar] Unsupported channel count: ${totalCh}. Expected 7/13/82/130/135`);
        }

        const layout = MODE_LAYOUT[totalCh];
        this._rgbPixels    = layout.rgbPixels;
        this._amberPixels  = layout.amberPixels;
        this._whitePixels  = layout.whitePixels;
        this._controlStart = layout.controlStart;   // 1-indexed local ch of first control ch

        // Pre-compute section starts (1-indexed local channels)
        // ⚠ VERIFIED 2026-03-21: Despite manual labeling CH97-112 as "Amber" and
        //   CH113-128 as "White", physical testing confirms the fixture outputs:
        //     CH97–112  = WHITE segments
        //     CH113–128 = AMBER segments
        this._whiteStart = this._rgbPixels * 3 + 1;   // CH97 in 135-ch mode
        this._amberStart = this._whiteStart + this._whitePixels; // CH113 in 135-ch mode

        // Channel order from profile: e.g. ['red','green','blue']
        // Determines which offset within a pixel triplet carries each colour.
        const order = (this.profile.rgb_pixels || {}).channel_order || ['red', 'green', 'blue'];
        // Build a lookup: param name → byte offset (0/1/2)
        this._rgbOrder = order;   // ['red','green','blue'] means offset0=R, offset1=G, offset2=B
    }

    // ── RGB Pixels ────────────────────────────────────────────────────────

    /**
     * Set an RGB pixel.  Channel order is R,G,B (verified against physical fixture).
     * @param {number} n   - Pixel index, 1-indexed (1–32 in 135-ch mode)
     * @param {number} r   - Red, 0-255
     * @param {number} g   - Green, 0-255
     * @param {number} b   - Blue, 0-255
     */
    setPixel(n, r, g, b) {
        if (n < 1 || n > this._rgbPixels) {
            throw new RangeError(`[EndyshowBar:${this.label}] Pixel ${n} out of range (1–${this._rgbPixels})`);
        }
        const base = (n - 1) * 3 + 1;   // local ch of first colour in this pixel's triplet
        // Map r/g/b parameters to channel offsets using the profile's channel_order.
        // e.g. channel_order ['red','green','blue'] → offset 0=R, 1=G, 2=B
        //      channel_order ['red','blue','green'] → offset 0=R, 1=B, 2=G
        const vals = { red: r, green: g, blue: b };
        for (let i = 0; i < 3; i++) {
            this.setChannel(base + i, vals[this._rgbOrder[i]]);
        }
    }

    /**
     * Fill all RGB pixels with one colour.
     * @param {number} r @param {number} g @param {number} b
     */
    fillPixels(r, g, b) {
        for (let n = 1; n <= this._rgbPixels; n++) this.setPixel(n, r, g, b);
    }

    // ── Amber Segments ────────────────────────────────────────────────────

    /**
     * @param {number} n   - Segment 1-indexed
     * @param {number} val - 0-255
     */
    setAmber(n, val) {
        if (n < 1 || n > this._amberPixels) {
            throw new RangeError(`[EndyshowBar:${this.label}] Amber segment ${n} out of range`);
        }
        this.setChannel(this._amberStart + n - 1, val);
    }

    /** Fill all amber segments. */
    fillAmber(val) {
        for (let n = 1; n <= this._amberPixels; n++) this.setAmber(n, val);
    }

    // ── White Segments ────────────────────────────────────────────────────

    /**
     * @param {number} n   - Segment 1-indexed
     * @param {number} val - 0-255
     */
    setWhite(n, val) {
        if (n < 1 || n > this._whitePixels) {
            throw new RangeError(`[EndyshowBar:${this.label}] White segment ${n} out of range`);
        }
        this.setChannel(this._whiteStart + n - 1, val);
    }

    /** Fill all white segments. */
    fillWhite(val) {
        for (let n = 1; n <= this._whitePixels; n++) this.setWhite(n, val);
    }

    // ── Control Channels (135/130-ch modes) ───────────────────────────────

    /** CH129 — RGB Strobe: 0=off, 10-255=slow→fast */
    setRgbStrobe(val) { this._ctrl(1, val); }

    /** CH130 — ACW (amber+white) Strobe: 0=off, 10-255=slow→fast */
    setAcwStrobe(val) { this._ctrl(2, val); }

    /** CH131 — RGB Effect pattern select (0-255, see channel table) */
    setRgbEffect(val) { this._ctrl(3, val); }

    /** CH132 — RGB Effect speed (0=slow, 255=fast) */
    setRgbSpeed(val) { this._ctrl(4, val); }

    /** CH133 — RGB Background color select (see color table in manual) */
    setRgbBackground(val) { this._ctrl(5, val); }

    /** CH134 — ACW Effect pattern select */
    setAcwEffect(val) { this._ctrl(6, val); }

    /** CH135 — ACW Effect speed */
    setAcwSpeed(val) { this._ctrl(7, val); }

    _ctrl(n, val) {
        const ch = this._controlStart + n - 1;
        if (ch > this.totalChannels) return;   // control ch not present in this mode
        this.setChannel(ch, val);
    }
}

module.exports = { EndyshowBar };
