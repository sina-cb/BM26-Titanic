/**
 * party_mode_strong.js — "is a REAL party happening at THIS fixture right now".
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * `party_mode.js` (`audioParty`) is a pure band-loudness Schmitt trigger. Live
 * sampling of the show machine with NO music playing (report 20260725_10 §2.2)
 * showed `audioParty = 1` sustained on room noise alone: `micKickRaw = 0.000`,
 * `micLowRaw ≈ 0`, party driven entirely by mid+high — i.e. the OPPOSITE
 * spectral shape of dance music. Raising the level threshold cannot fix that: a
 * loud conversation or a generator clears any level a real party also clears.
 * The gate needs a DIFFERENT KIND of evidence.
 *
 * This shaper is that gate. It is a SIBLING of PartyMode, not a replacement —
 * `audioParty` keeps its existing consumers (genre classifier gating, effects);
 * `audioPartyStrong` is what the SHOW DIRECTOR trusts to start a party session.
 *
 * ── The four terms (all must hold) ────────────────────────────────────────────
 *   L      = EMA_loudTau( wLow*low + wMid*mid + wHigh*high )     (slow: 1.5 s)
 *   level  : L ≥ ambientFloor * marginX
 *              — CALIBRATED, not a magic constant. `ambientFloor` is captured on
 *                the playa (see docs / report §"Live tuning"): the 95th
 *                percentile of L on a quiet night with our system OFF.
 *   beat   : kickRate ∈ [kickRateMin, kickRateMax] kicks/s
 *            AND kickReg ≥ kickRegMin AND (bpmLocked when requireBpmLock)
 *              — THE room-noise rejector. Voices/wind/generators produce no kick
 *                onset train at all: micKickRaw is flat 0 and the BPM tracker
 *                never locks. This term alone kills the observed false positive.
 *   shape  : lowShare ≥ shapeLowMin AND highShare ≥ shapeHighMin
 *              — THE far-camp rejector. Air absorption kills HF first, so music
 *                from a camp hundreds of metres away arrives BASS-ONLY: low
 *                share high, high share near zero. Requiring a genuine high band
 *                is the physically-correct distant-music discriminator.
 *   quiet  : silence < silenceMax
 *              — cheap negative evidence from the track-change detector.
 *
 * ── Debounce ──────────────────────────────────────────────────────────────────
 * The instantaneous AND of the four terms is `qualify`. The published flag is a
 * long-window latch on top:
 *   OFF → ON  after `onSustainMs`  (default 20 s) of CONTINUOUS qualification
 *             — an art car parked next to us for 30 s never gets there once the
 *               timeline's own `minDwellSec: 120` is stacked on top.
 *   ON  → OFF after `offConfirmMs` (default 30 s) of CONTINUOUS disqualification
 *             — a breakdown or a gap between tracks does not drop the session.
 * `warmupMs` suppresses the ON latch until the slow loudness EMA has settled, so
 * a boot transient can never latch party.
 *
 * ── Kick rate + regularity ────────────────────────────────────────────────────
 * Computed HERE from the raw kick pulse train rather than borrowed from the
 * genre classifier: the classifier's copy is gated behind `audioParty` (which is
 * exactly the signal we do not trust), so reusing it would be circular. Rising
 * edges over `kickEdgeThresh`, `kickMinIntervalMs` refractory, a ring of the
 * last `kickRingN` inter-onset intervals →
 *   kickRate = 1000 / mean(interval)          (kicks per second)
 *   kickReg  = 1 - CV(interval)               (1 = metronomic, 0 = random)
 * If no kick arrives for `kickIdleMs` the ring is CLEARED and both read 0 — a
 * stale mean must never keep asserting "there is a beat" after the music stops.
 *
 * Pure math, allocation-free (one preallocated Float64Array ring). Every
 * threshold is a named tunable (`setParams`) so the operator turns knobs in
 * config.yaml and never edits code.
 */

export const PARTY_MODE_STRONG_DEFAULTS = Object.freeze({
  // ── loudness ──
  wLow: 0.35, wMid: 0.45, wHigh: 0.20,
  loudTau: 1.5,            // s — slower than PartyMode's 0.4 s: sections, not hits
  ambientFloor: 0.09,      // ← CALIBRATE ON PLAYA (quiet-night P95 of audioLoudness)
  marginX: 2.5,            // party must be this many × the ambient floor
  // ── rhythmic evidence ──
  kickRateMin: 1.2,        // kicks/s — below this it is not a dance beat
  kickRateMax: 3.2,        // kicks/s — above this it is chatter/noise, not a kick
  kickRegMin: 0.45,        // 1 - CV of the kick interval ring
  requireBpmLock: true,    // the BPM tracker must be in its LOCKED state
  // ── spectral shape (far-camp rejector) ──
  shapeLowMin: 0.20,
  shapeHighMin: 0.12,      // ← distant music arrives bass-only; this rejects it
  shapeTau: 1.5,           // s — band EMA feeding the share ratios
  // ── negative evidence ──
  silenceMax: 0.5,         // audioSilence ≥ this ⇒ disqualified
  // ── debounce ──
  onSustainMs: 20000,
  offConfirmMs: 30000,
  warmupMs: 3000,
  // ── kick tracking ──
  kickEdgeThresh: 0.5,
  kickMinIntervalMs: 220,  // refractory, matches the analyzer's kick detector
  kickRingN: 12,
  kickIdleMs: 2500,        // no kick for this long ⇒ clear the ring, rate/reg → 0
});

/** Keys `setParams` accepts. Anything else is an authoring error → throw. */
const TUNABLE_KEYS = Object.freeze(Object.keys(PARTY_MODE_STRONG_DEFAULTS));

export class PartyModeStrong {
  constructor(opts = {}) {
    this.p = { ...PARTY_MODE_STRONG_DEFAULTS };
    if (opts && Object.keys(opts).length > 0) this.setParams(opts);
    this._ring = new Float64Array(this.p.kickRingN);
    this.reset();
  }

  /**
   * Merge operator tunables (config.yaml `party:` block). FAIL LOUD: an unknown
   * key or a non-finite value is a typo in the operator's config, and silently
   * ignoring it would leave the gate running on defaults while the operator
   * believes he tuned it (codex P0 — no fallback behaviours).
   * @param {object} opts
   */
  setParams(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('PartyModeStrong.setParams: an object is required');
    }
    for (const k of Object.keys(opts)) {
      if (!TUNABLE_KEYS.includes(k)) {
        throw new Error(
          `PartyModeStrong.setParams: unknown tunable "${k}" `
          + `(known: ${TUNABLE_KEYS.join(', ')})`);
      }
      const v = opts[k];
      if (k === 'requireBpmLock') {
        if (typeof v !== 'boolean') {
          throw new TypeError(`PartyModeStrong.setParams: ${k} must be a boolean, got ${JSON.stringify(v)}`);
        }
      } else if (!Number.isFinite(v)) {
        throw new TypeError(`PartyModeStrong.setParams: ${k} must be a finite number, got ${JSON.stringify(v)}`);
      }
      this.p[k] = v;
    }
    // The ring size is structural — resize (and clear) when it changes.
    if (!this._ring || this._ring.length !== this.p.kickRingN) {
      this._ring = new Float64Array(this.p.kickRingN);
      this._ringHead = 0;
      this._ringFilled = 0;
    }
    return this.p;
  }

  /**
   * Operator-facing snapshot: every metric, every per-term verdict, the live
   * level threshold, and the DEBOUNCE PROGRESS (how long the gate has been
   * continuously qualifying / disqualifying). The companion's PARTY tab renders
   * this so the operator SEES the gate decide instead of inferring it from a
   * 0/1 flag — it is the read model behind report 20260725_12 §6.
   *
   * Read-only: nothing here advances the detector.
   *
   * @param {number} nowMs — the analyzer hop clock, same clock update() is fed
   */
  getState(nowMs) {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError(`PartyModeStrong.getState: nowMs must be finite, got ${JSON.stringify(nowMs)}`);
    }
    const p = this.p;
    return {
      party: this.party,
      loudness: this.loudness,
      kickRate: this.kickRate,
      kickReg: this.kickReg,
      lowShare: this.lowShare,
      highShare: this.highShare,
      qualify: this.qualify,
      levelOk: this.levelOk,
      beatOk: this.beatOk,
      shapeOk: this.shapeOk,
      quietOk: this.quietOk,
      // The literal line the loudness EMA is compared against.
      levelThreshold: p.ambientFloor * p.marginX,
      // Debounce progress in ms. Exactly ONE of these is non-zero at a time
      // (qualify and disqualify anchors are mutually exclusive by construction).
      qualifyingForMs: this._qualSinceMs === null ? 0 : nowMs - this._qualSinceMs,
      disqualifyingForMs: this._disqualSinceMs === null ? 0 : nowMs - this._disqualSinceMs,
      warmedUp: this._firstMs !== null && (nowMs - this._firstMs) >= p.warmupMs,
      params: { ...p },
    };
  }

  reset() {
    this._loud = 0;
    this._eLow = 0; this._eMid = 0; this._eHigh = 0;
    this._ringHead = 0;
    this._ringFilled = 0;
    this._prevKick = 0;
    this._lastKickMs = -Infinity;
    this._firstMs = null;
    this._qualSinceMs = null;     // continuous-qualify anchor (OFF → ON)
    this._disqualSinceMs = null;  // continuous-disqualify anchor (ON → OFF)

    this.party = false;
    this.loudness = 0;
    this.kickRate = 0;
    this.kickReg = 0;
    this.lowShare = 0;
    this.highShare = 0;
    this.qualify = false;
    this.levelOk = false;
    this.beatOk = false;
    this.shapeOk = false;
    this.quietOk = false;
  }

  /** @private ingest one hop of the kick pulse train, refresh rate + regularity. */
  _updateKick(kick, nowMs) {
    const p = this.p;
    const rising = kick >= p.kickEdgeThresh && this._prevKick < p.kickEdgeThresh;
    this._prevKick = kick;
    if (rising && (nowMs - this._lastKickMs) >= p.kickMinIntervalMs) {
      if (this._lastKickMs > -Infinity) {
        this._ring[this._ringHead] = nowMs - this._lastKickMs;
        this._ringHead = (this._ringHead + 1) % p.kickRingN;
        if (this._ringFilled < p.kickRingN) this._ringFilled++;
      }
      this._lastKickMs = nowMs;
    }

    // Idle collapse: a mean interval from kicks that stopped a minute ago is a
    // lie. No onset for kickIdleMs ⇒ there is no beat, full stop.
    if ((nowMs - this._lastKickMs) > p.kickIdleMs) {
      this._ringFilled = 0;
      this._ringHead = 0;
      this.kickRate = 0;
      this.kickReg = 0;
      return;
    }

    if (this._ringFilled < 3) { this.kickRate = 0; this.kickReg = 0; return; }
    let mean = 0;
    for (let i = 0; i < this._ringFilled; i++) mean += this._ring[i];
    mean /= this._ringFilled;
    if (!(mean > 0)) { this.kickRate = 0; this.kickReg = 0; return; }
    let varAcc = 0;
    for (let i = 0; i < this._ringFilled; i++) {
      const d = this._ring[i] - mean; varAcc += d * d;
    }
    varAcc /= this._ringFilled;
    const cv = Math.sqrt(varAcc) / mean;
    this.kickRate = 1000 / mean;
    this.kickReg = cv >= 1 ? 0 : (cv <= 0 ? 1 : 1 - cv);
  }

  /**
   * Advance one analyzer hop.
   * @param {object} i
   * @param {number} i.low       micLowRaw  [0,1]
   * @param {number} i.mid       micMidRaw  [0,1]
   * @param {number} i.high      micHighRaw [0,1]
   * @param {number} i.kick      micKickRaw [0,1] pulse train
   * @param {number} i.silence   audioSilence 0/1
   * @param {boolean} i.bpmLocked BpmTracker lock state
   * @param {number} i.dt        seconds since the previous hop
   * @param {number} i.nowMs     analyzer hop clock (ms)
   */
  update({ low, mid, high, kick, silence, bpmLocked, dt, nowMs }) {
    // Fail loud on a non-finite input: a NaN would poison the loudness EMA and
    // the share ratios for the rest of the session. The caller finite-guards its
    // CPC reads, so a non-finite here is a real upstream contract violation.
    if (!Number.isFinite(low) || !Number.isFinite(mid) || !Number.isFinite(high)
      || !Number.isFinite(kick) || !Number.isFinite(silence)
      || !Number.isFinite(dt) || !Number.isFinite(nowMs)) {
      throw new TypeError(
        `PartyModeStrong.update: non-finite input (low=${low}, mid=${mid}, high=${high}, `
        + `kick=${kick}, silence=${silence}, dt=${dt}, nowMs=${nowMs})`);
    }
    const p = this.p;

    // 1. Loudness (slow EMA of the weighted full-band sum).
    const target = p.wLow * low + p.wMid * mid + p.wHigh * high;
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / p.loudTau);
      this._loud += a * (target - this._loud);
      const b = 1 - Math.exp(-dt / p.shapeTau);
      this._eLow += b * (low - this._eLow);
      this._eMid += b * (mid - this._eMid);
      this._eHigh += b * (high - this._eHigh);
    }
    this.loudness = this._loud;

    // 2. Spectral shape (level-robust band shares off the smoothed bands).
    const tot = this._eLow + this._eMid + this._eHigh + 1e-9;
    this.lowShare = this._eLow / tot;
    this.highShare = this._eHigh / tot;

    // 3. Rhythmic evidence.
    this._updateKick(kick, nowMs);

    // 4. The four terms.
    this.levelOk = this._loud >= p.ambientFloor * p.marginX;
    this.beatOk = this.kickRate >= p.kickRateMin && this.kickRate <= p.kickRateMax
      && this.kickReg >= p.kickRegMin
      && (p.requireBpmLock ? bpmLocked === true : true);
    this.shapeOk = this.lowShare >= p.shapeLowMin && this.highShare >= p.shapeHighMin;
    this.quietOk = silence < p.silenceMax;
    this.qualify = this.levelOk && this.beatOk && this.shapeOk && this.quietOk;

    // 5. Warmup + long-window debounce.
    if (this._firstMs === null) this._firstMs = nowMs;
    const warmedUp = (nowMs - this._firstMs) >= p.warmupMs;

    if (this.qualify) {
      if (this._qualSinceMs === null) this._qualSinceMs = nowMs;
      this._disqualSinceMs = null;
    } else {
      if (this._disqualSinceMs === null) this._disqualSinceMs = nowMs;
      this._qualSinceMs = null;
    }

    if (!this.party) {
      if (warmedUp && this._qualSinceMs !== null
        && (nowMs - this._qualSinceMs) >= p.onSustainMs) {
        this.party = true;
      }
    } else if (this._disqualSinceMs !== null
      && (nowMs - this._disqualSinceMs) >= p.offConfirmMs) {
      this.party = false;
    }

    return {
      party: this.party,
      loudness: this.loudness,
      kickRate: this.kickRate,
      kickReg: this.kickReg,
      lowShare: this.lowShare,
      highShare: this.highShare,
      qualify: this.qualify,
      levelOk: this.levelOk,
      beatOk: this.beatOk,
      shapeOk: this.shapeOk,
      quietOk: this.quietOk,
    };
  }
}

export default PartyModeStrong;
