'use strict';
/**
 * VintageLed — Vintage LED Stage Light (6 Vertical Retro Lights)
 *
 * Extends DmxFixture for the 15-channel and 33-channel modes.
 *
 * Both modes share the same first 15 channels:
 *   CH1  Total dimming
 *   CH2  Total strobe
 *   CH3–8   Main light warm color 1–6 (per-head warm LEDs)
 *   CH9  Auxiliary red    CH10 Auxiliary green    CH11 Auxiliary blue
 *   CH12 Main light effect (see Appendix 1)
 *   CH13 Main light effect speed / voice sensitivity
 *   CH14 Auxiliary light effect (see Appendix 1)
 *   CH15 Auxiliary light effect speed
 *
 * 33-channel mode adds per-head auxiliary RGB:
 *   CH16–18  Aux RGB head 1   ...   CH31–33  Aux RGB head 6
 */

const { DmxFixture } = require('../DmxFixture');

class VintageLed extends DmxFixture {
    constructor(label, profilePath) {
        super(label, profilePath);

        const totalCh = this.totalChannels;
        if (totalCh !== 15 && totalCh !== 33) {
            throw new Error(`[VintageLed] Unsupported channel count: ${totalCh}. Expected 15 or 33`);
        }

        this._is33 = (totalCh === 33);
    }

    // ── Master controls ──────────────────────────────────────────────────

    /** Master dimmer, 0=dark, 255=bright */
    setDimmer(val)  { this.setChannel(1, val); }

    /** Master strobe, 0=off, 255=fast */
    setStrobe(val)  { this.setChannel(2, val); }

    // ── Main warm color channels (per head) ──────────────────────────────

    /** Set warm color for a specific head (1–6), 0-255 */
    setWarm(head, val) {
        if (head < 1 || head > 6) throw new RangeError(`[VintageLed] Head ${head} out of range (1–6)`);
        this.setChannel(2 + head, val);   // CH3–8
    }

    /** Set all 6 warm heads to the same value */
    fillWarm(val) {
        for (let h = 1; h <= 6; h++) this.setWarm(h, val);
    }

    // ── Auxiliary RGB (global, CH9–11) ────────────────────────────────────

    /** Auxiliary red (all heads), 0-255 */
    setRed(val)    { this.setChannel(9, val); }
    /** Auxiliary green (all heads), 0-255 */
    setGreen(val)  { this.setChannel(10, val); }
    /** Auxiliary blue (all heads), 0-255 */
    setBlue(val)   { this.setChannel(11, val); }

    /** Set auxiliary RGB at once */
    setAuxRgb(r, g, b) {
        this.setRed(r); this.setGreen(g); this.setBlue(b);
    }

    // ── Effect channels ──────────────────────────────────────────────────

    /** Main light effect (CH12), 0-255 — see Appendix 1 */
    setMainEffect(val)      { this.setChannel(12, val); }
    /** Main light effect speed (CH13), 0-127 fwd, 128-255 rev */
    setMainEffectSpeed(val) { this.setChannel(13, val); }
    /** Auxiliary light effect (CH14), 0-255 — see Appendix 1 */
    setAuxEffect(val)       { this.setChannel(14, val); }
    /** Auxiliary light effect speed (CH15), 0-127 fwd, 128-255 rev */
    setAuxEffectSpeed(val)  { this.setChannel(15, val); }

    // ── Per-head auxiliary RGB (33-ch only, CH16–33) ─────────────────────

    /**
     * Set auxiliary RGB for a specific head (33-ch mode only).
     * @param {number} head - Head number 1–6
     * @param {number} r    - Red 0-255
     * @param {number} g    - Green 0-255
     * @param {number} b    - Blue 0-255
     */
    setHeadAuxRgb(head, r, g, b) {
        if (!this._is33) return;   // silently no-op in 15-ch mode
        if (head < 1 || head > 6) throw new RangeError(`[VintageLed] Head ${head} out of range (1–6)`);
        const base = 13 + head * 3;   // head 1 → CH16, head 2 → CH19, …
        this.setChannel(base, r);
        this.setChannel(base + 1, g);
        this.setChannel(base + 2, b);
    }

    /** Set all per-head aux RGB to the same color (33-ch only) */
    fillHeadAuxRgb(r, g, b) {
        for (let h = 1; h <= 6; h++) this.setHeadAuxRgb(h, r, g, b);
    }
}

module.exports = { VintageLed };
