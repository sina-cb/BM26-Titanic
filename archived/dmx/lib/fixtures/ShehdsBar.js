'use strict';
/**
 * ShehdsBar — SHEHDS 18x18W RGBWAV LED Wall Wash Bar
 *
 * Extends DmxFixture with high-level methods for RGBWAV pixel control.
 * Supports modes: 12 / 108 / 119 channels.
 *
 * ⚠ HARDWARE NOTE: The manual claims 120ch mode, but the real firmware
 *   reports 119 channels. The master channel order also differs from the
 *   manual. See channels_120.yaml for the hardware-verified layout.
 *
 * 12-channel mode (master only, all 18 LEDs as one block):
 *   CH1 Dimmer  CH2 Strobe  CH3 Auto  CH4 Speed  CH5 8/16bit
 *   CH6 Red  CH7 Green  CH8 Blue  CH9 White  CH10 Amber  CH11 Violet  CH12 BackColor
 *
 * 108-channel mode (pixel only, no master):
 *   18 pixels × 6ch (R, G, B, W, A, V) = CH1–108
 *
 * 119-channel mode (full control, hardware-verified):
 *   CH1 Dimmer  CH2 Strobe  CH3 Function  CH4 Speed  CH5 BgColor
 *   CH6–11 Dim-RGBWAV
 *   CH12–119: 18 pixels × 6ch
 */

const { DmxFixture } = require('../DmxFixture');

const CHANNELS_PER_PIXEL = 6; // R, G, B, W, Amber, Violet

class ShehdsBar extends DmxFixture {
    /**
     * @param {string} label
     * @param {string} profilePath - Absolute path to channels_N.yaml
     */
    constructor(label, profilePath) {
        super(label, profilePath);

        const totalCh = this.totalChannels;
        if (totalCh !== 12 && totalCh !== 108 && totalCh !== 119) {
            throw new Error(`[ShehdsBar] Unsupported channel count: ${totalCh}. Expected 12/108/119`);
        }

        this._pixelCount = 0;
        this._pixelStart = 0;   // 1-indexed local ch where pixel data begins

        if (totalCh === 12) {
            // Master-only mode — no pixels
            this._pixelCount = 0;
            this._hasMaster = true;
            this._masterMap = this._buildMasterMap12();
        } else if (totalCh === 108) {
            // Pixel-only mode — no master
            this._pixelCount = 18;
            this._pixelStart = 1;
            this._hasMaster = false;
            this._masterMap = null;
        } else {
            // 119ch — master + pixels (hardware-verified)
            this._pixelCount = 18;
            this._pixelStart = 12;
            this._hasMaster = true;
            this._masterMap = this._buildMasterMap119();
        }
    }

    _buildMasterMap12() {
        return {
            dimmer: 1, strobe: 2, autoMode: 3, autoSpeed: 4,
            bitMode: 5, red: 6, green: 7, blue: 8,
            white: 9, amber: 10, violet: 11, backColor: 12,
        };
    }

    _buildMasterMap119() {
        return {
            dimmer: 1, strobe: 2, autoMode: 3, autoSpeed: 4,
            bgColor: 5, red: 6, green: 7, blue: 8,
            white: 9, amber: 10, violet: 11,
        };
    }

    // ── Master channels (12ch / 119ch) ───────────────────────────────────

    /** Master dimmer, 0-255 */
    setDimmer(val) { this._master('dimmer', val); }

    /** Strobe, 0=off, 1-255=slow→fast */
    setStrobe(val) { this._master('strobe', val); }

    /** Master Red, 0-255 */
    setRed(val) { this._master('red', val); }

    /** Master Green, 0-255 */
    setGreen(val) { this._master('green', val); }

    /** Master Blue, 0-255 */
    setBlue(val) { this._master('blue', val); }

    /** Master White, 0-255 */
    setWhite(val) { this._master('white', val); }

    /** Master Amber, 0-255 */
    setAmber(val) { this._master('amber', val); }

    /** Master Violet, 0-255 */
    setViolet(val) { this._master('violet', val); }

    /** Auto mode / function select */
    setAutoMode(val) { this._master('autoMode', val); }

    /** Auto mode speed */
    setAutoSpeed(val) { this._master('autoSpeed', val); }

    /** Background color */
    setBgColor(val) { this._master('bgColor', val); }

    /**
     * Set all six master color channels at once.
     * @param {number} r @param {number} g @param {number} b
     * @param {number} w @param {number} a @param {number} v
     */
    setColor(r, g, b, w = 0, a = 0, v = 0) {
        this.setRed(r); this.setGreen(g); this.setBlue(b);
        this.setWhite(w); this.setAmber(a); this.setViolet(v);
    }

    _master(name, val) {
        if (!this._masterMap || !this._masterMap[name]) return;
        this.setChannel(this._masterMap[name], val);
    }

    // ── Pixel channels (108ch / 119ch) ────────────────────────────────────

    /**
     * Set an RGBWAV pixel.
     * @param {number} n   - Pixel index, 1-indexed (1–18)
     * @param {number} r   - Red, 0-255
     * @param {number} g   - Green, 0-255
     * @param {number} b   - Blue, 0-255
     * @param {number} w   - White, 0-255
     * @param {number} a   - Amber, 0-255
     * @param {number} v   - Violet, 0-255
     */
    setPixel(n, r, g, b, w = 0, a = 0, v = 0) {
        if (n < 1 || n > this._pixelCount) {
            throw new RangeError(`[ShehdsBar:${this.label}] Pixel ${n} out of range (1–${this._pixelCount})`);
        }
        const base = this._pixelStart + (n - 1) * CHANNELS_PER_PIXEL;
        this.setChannel(base + 0, r);
        this.setChannel(base + 1, g);
        this.setChannel(base + 2, b);
        this.setChannel(base + 3, w);
        this.setChannel(base + 4, a);
        this.setChannel(base + 5, v);
    }

    /**
     * Fill all pixels with one colour.
     */
    fillPixels(r, g, b, w = 0, a = 0, v = 0) {
        for (let n = 1; n <= this._pixelCount; n++) {
            this.setPixel(n, r, g, b, w, a, v);
        }
    }

    /** @returns {number} Number of individually addressable pixels (0 in 12ch mode) */
    get pixelCount() { return this._pixelCount; }

    /** @returns {boolean} Whether master channels are available */
    get hasMaster() { return this._hasMaster; }
}

module.exports = { ShehdsBar };
