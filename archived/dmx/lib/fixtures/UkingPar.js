'use strict';
/**
 * UkingPar — UKing RGBWAU PAR Light
 *
 * Extends DmxFixture for the 6-channel and 10-channel modes.
 *
 * 6-channel mode (d001):
 *   CH1 R  CH2 G  CH3 B  CH4 W  CH5 Y(Amber)  CH6 P(Purple)
 *
 * 10-channel mode (A001):
 *   CH1  Total dimming
 *   CH2  R   CH3 G   CH4 B   CH5 W   CH6 Y   CH7 P
 *   CH8  Total strobe
 *   CH9  Function select (0-50=manual, 51-100=color output, 101-150=jump,
 *                         151-200=fade, 201-250=pulse, 251-255=sound)
 *   CH10 Function speed
 */

const { DmxFixture } = require('../DmxFixture');

class UkingPar extends DmxFixture {
    constructor(label, profilePath) {
        super(label, profilePath);

        const totalCh = this.totalChannels;
        if (totalCh !== 6 && totalCh !== 10) {
            throw new Error(`[UkingPar] Unsupported channel count: ${totalCh}. Expected 6 or 10`);
        }

        // Channel map depends on mode
        if (totalCh === 6) {
            this._chR       = 1;
            this._chG       = 2;
            this._chB       = 3;
            this._chW       = 4;
            this._chY       = 5;
            this._chP       = 6;
            this._chDim     = null;
            this._chStrobe  = null;
            this._chFn      = null;
            this._chFnSpeed = null;
        } else {
            // 10-channel
            this._chDim     = 1;
            this._chR       = 2;
            this._chG       = 3;
            this._chB       = 4;
            this._chW       = 5;
            this._chY       = 6;
            this._chP       = 7;
            this._chStrobe  = 8;
            this._chFn      = 9;
            this._chFnSpeed = 10;
        }
    }

    // ── Color channels ────────────────────────────────────────────────────

    /** Red, 0-255 */
    setRed(val)    { this.setChannel(this._chR, val); }
    /** Green, 0-255 */
    setGreen(val)  { this.setChannel(this._chG, val); }
    /** Blue, 0-255 */
    setBlue(val)   { this.setChannel(this._chB, val); }
    /** White, 0-255 */
    setWhite(val)  { this.setChannel(this._chW, val); }
    /** Amber / Yellow, 0-255 */
    setAmber(val)  { this.setChannel(this._chY, val); }
    /** Purple, 0-255 */
    setPurple(val) { this.setChannel(this._chP, val); }

    /**
     * Set all six color channels at once.
     * @param {number} r @param {number} g @param {number} b
     * @param {number} w @param {number} y @param {number} p
     */
    setColor(r, g, b, w = 0, y = 0, p = 0) {
        this.setRed(r); this.setGreen(g); this.setBlue(b);
        this.setWhite(w); this.setAmber(y); this.setPurple(p);
    }

    // ── 10-ch only ────────────────────────────────────────────────────────

    /**
     * Master dimmer (10-ch mode only — CH1).
     * @param {number} val - 0=dark, 255=max
     */
    setDimmer(val) {
        if (this._chDim) this.setChannel(this._chDim, val);
    }

    /**
     * Total strobe (10-ch mode only — CH8).
     * @param {number} val - 0=off, 1-255=slow→fast
     */
    setStrobe(val) {
        if (this._chStrobe) this.setChannel(this._chStrobe, val);
    }

    /**
     * Function select (10-ch mode only — CH9).
     *   0–50:   Manual (CH2–7 control)
     *   51–100: Color output, 8 options selected by CH10
     *   101–150: Colors Jump Change
     *   151–200: Colors Gradate
     *   201–250: Colors Pulse Change
     *   251–255: Sound-Active
     * @param {number} val
     */
    setFunction(val) {
        if (this._chFn) this.setChannel(this._chFn, val);
    }

    /**
     * Function speed (10-ch mode only — CH10).
     * @param {number} val - 0=slow, 255=fast
     */
    setFunctionSpeed(val) {
        if (this._chFnSpeed) this.setChannel(this._chFnSpeed, val);
    }
}

module.exports = { UkingPar };
