/**
 * track_change.js — silence + track-change detector → `audioSilence`,
 * `audioTrackChange` (report 20260620_2 #3).
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * When the DJ swaps tracks or there's a gap, the rig should do something
 * INTENTIONAL (fade / palette reset / attention sweep) instead of freezing on
 * stale signals — and it's a musically honest moment to re-pick pattern/palette.
 *
 * Outputs (published by DerivedSignals):
 *   audioSilence      0/1   — we are currently in a quiet gap (loudness below
 *                             the OFF threshold, held to debounce a 1-bar break).
 *   audioTrackChange  pulse — a one-shot edge marking a likely new track. Fires
 *                             on the strongest cue available:
 *                               (a) silence → re-onset (a gap then music returns),
 *                               (b) BPM unlock → relock at a NEW tempo,
 *                               (c) a sharp note / dominant-frequency discontinuity
 *                                   coincident with a loudness dip+recover.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * Reuses PartyMode's loudness-EMA + hysteresis + HOLD discipline so a 1-bar
 * breakdown inside a track is NOT mistaken for a track change:
 * 1. LOUDNESS. Weighted full-band sum, EMA-smoothed (so a lone sub rumble
 *    doesn't read as "music"). Schmitt: SILENCE on below `offThresh`, MUSIC on
 *    above `onThresh`. A silence must persist `silenceConfirmMs` before it
 *    latches `audioSilence` (covers a snare gap); re-onset clears it.
 * 2. TRACK-CHANGE CUES (all gated by a min spacing `changeRefractoryMs`):
 *    (a) GAP RE-ONSET. We latched silence for ≥ `gapMinMs`, then music returns →
 *        fire. The canonical, highest-confidence cue.
 *    (b) TEMPO RELOCK. BPM was locked, unlocked for ≥ `tempoUnlockMs`, then
 *        relocked at a tempo differing by ≥ `tempoJumpBpm` → fire.
 *    (c) HARMONIC DISCONTINUITY. The dominant pitch class jumps AND a loudness
 *        dip-then-recover bracketed it (a hard cut, not a melodic note change).
 *
 * Pure Math, allocation-free. Warmup-gates the change pulse so the engine's
 * first onset (silence→music at boot) isn't reported as a track change.
 * Validated offline (synth bank): `silence` bookended by `full_track` latches
 * audioSilence in the gap and fires ONE audioTrackChange on re-onset; a steady
 * `full_track` fires neither.
 */

export const TRACK_CHANGE_DEFAULTS = Object.freeze({
  wLow: 0.4, wMid: 0.4, wHigh: 0.2,
  loudTau: 0.35,            // s — loudness EMA
  onThresh: 0.20,          // loudness above → MUSIC
  offThresh: 0.10,         // loudness below → quiet (hysteresis gap)
  silenceConfirmMs: 450,   // sustained quiet before audioSilence latches
  gapMinMs: 600,           // a silence ≥ this, then re-onset = a track change
  changeRefractoryMs: 4000, // min spacing between track-change fires
  tempoUnlockMs: 1500,     // BPM must stay unlocked this long to arm a relock cue
  tempoJumpBpm: 6,         // relock tempo must differ by this many BPM to count
  noteDipWindowMs: 700,    // a loudness dip within this window brackets a hard cut
  noteDipDepth: 0.5,       // loudness must dip to ≤ depth×recentMax to count as a cut
  warmupMs: 1500,          // suppress the change pulse for the first warmupMs
});

export class TrackChange {
  constructor(opts = {}) {
    this.p = { ...TRACK_CHANGE_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._loud = 0;
    this.loudness = 0;
    this.silence = false;        // published audioSilence
    this._quietSinceMs = null;
    this._silenceLatchedAtMs = null;
    this._firstMs = null;

    this._lastChangeMs = -Infinity;

    // tempo-relock cue
    this._wasLocked = false;
    this._unlockedSinceMs = null;
    this._lastLockedBpm = 0;

    // harmonic-cut cue
    this._prevPc = -1;
    this._recentLoudMax = 0;
    this._loudDipAtMs = -Infinity;

    this.trackChange = false;    // published pulse (one hop)
  }

  /**
   * @param {object} s
   *   s.low, s.mid, s.high  — raw bands [0,1]
   *   s.bpm, s.bpmLocked    — tempo
   *   s.pitchClass (0..11/-1), s.noteStable (bool)
   *   s.dt (seconds), s.nowMs
   * @returns {{silence:boolean, trackChange:boolean}}
   */
  update(s) {
    const p = this.p;
    const now = s.nowMs;
    const dt = s.dt > 0 ? s.dt : 0;
    this.trackChange = false;

    if (this._firstMs === null) this._firstMs = now;
    const warmedUp = (now - this._firstMs) >= p.warmupMs;

    // ── Loudness EMA + silence latch (party-style hold) ─────────────────────
    const target = p.wLow * clamp01(s.low) + p.wMid * clamp01(s.mid) + p.wHigh * clamp01(s.high);
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / p.loudTau);
      this._loud += a * (target - this._loud);
    }
    this.loudness = this._loud;

    // Track a slow-decaying recent loudness max (for the dip-depth test).
    if (this._loud > this._recentLoudMax) this._recentLoudMax = this._loud;
    else this._recentLoudMax *= 0.999;   // ~ slow bleed so a dip is relative to recent music

    // Dip detector: note when loudness drops well below the recent max.
    if (this._recentLoudMax > p.offThresh && this._loud <= p.noteDipDepth * this._recentLoudMax) {
      this._loudDipAtMs = now;
    }

    // Schmitt silence with confirm-hold.
    const wasSilent = this.silence;
    if (this._loud < p.offThresh) {
      if (this._quietSinceMs === null) this._quietSinceMs = now;
      if ((now - this._quietSinceMs) >= p.silenceConfirmMs) {
        if (!this.silence) this._silenceLatchedAtMs = now;
        this.silence = true;
      }
    } else if (this._loud >= p.onThresh) {
      this._quietSinceMs = null;
      this.silence = false;
    }
    // (between offThresh and onThresh: hold the current silence state — hysteresis)

    const refractoryOk = (now - this._lastChangeMs) >= p.changeRefractoryMs;
    let fire = false;

    // ── Cue (a): gap re-onset ───────────────────────────────────────────────
    // We were latched silent (for ≥ gapMinMs) and music just returned.
    if (wasSilent && !this.silence) {
      const gapMs = this._silenceLatchedAtMs !== null ? (now - this._silenceLatchedAtMs) : 0;
      // _silenceLatchedAtMs is the latch time; the gap is from quiet-onset which
      // is silenceConfirmMs earlier — count the full quiet span.
      const fullGap = gapMs + p.silenceConfirmMs;
      if (fullGap >= p.gapMinMs && refractoryOk && warmedUp) fire = true;
    }

    // ── Cue (b): tempo relock at a new BPM ──────────────────────────────────
    if (s.bpmLocked && !this._wasLocked) {
      // just (re)locked
      const unlockedMs = this._unlockedSinceMs !== null ? (now - this._unlockedSinceMs) : 0;
      const bpmJump = Math.abs(s.bpm - this._lastLockedBpm);
      if (this._lastLockedBpm > 0 && unlockedMs >= p.tempoUnlockMs
          && bpmJump >= p.tempoJumpBpm && refractoryOk && warmedUp) {
        fire = true;
      }
      this._unlockedSinceMs = null;
    } else if (!s.bpmLocked && this._wasLocked) {
      this._unlockedSinceMs = now;   // just unlocked
    }
    if (s.bpmLocked && s.bpm > 0) this._lastLockedBpm = s.bpm;
    this._wasLocked = s.bpmLocked;

    // ── Cue (c): harmonic discontinuity bracketed by a loudness dip ─────────
    if (s.noteStable && s.pitchClass >= 0 && this._prevPc >= 0
        && s.pitchClass !== this._prevPc) {
      const dipRecent = (now - this._loudDipAtMs) <= p.noteDipWindowMs;
      if (dipRecent && !this.silence && refractoryOk && warmedUp) fire = true;
    }
    if (s.noteStable && s.pitchClass >= 0) this._prevPc = s.pitchClass;

    if (fire) {
      this.trackChange = true;
      this._lastChangeMs = now;
    }

    return { silence: this.silence, trackChange: this.trackChange };
  }
}

function clamp01(v) { return Number.isFinite(v) ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : 0; }

export default TrackChange;
