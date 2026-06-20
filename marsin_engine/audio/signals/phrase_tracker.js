/**
 * phrase_tracker.js — 8/16-bar phrase tracking → `audioPhrasePhase`,
 * `audioPhraseBoundary` (report 20260620_2 #6).
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * Dance music is organized in PHRASES (8 or 16 bars). Landing pattern/palette
 * swaps on a phrase boundary looks intentional; landing them mid-phrase looks
 * random. The bpm_tracker already emits `audioDownbeat` (a pulse once per bar)
 * and `audioBarPhase` (0..1 within the bar) — this counts bars into phrases.
 *
 * Outputs (published by DerivedSignals):
 *   audioPhrasePhase     0..1  — position within the current phrase (continuous:
 *                                bars-into-phrase + intra-bar fraction, /phraseBars).
 *   audioPhraseBoundary  pulse — a one-shot edge on the downbeat that STARTS a
 *                                new phrase (bar count wraps to 0).
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. COUNT BARS on the downbeat pulse (rising edge of audioDownbeat). Every
 *    `phraseBars` bars, the count wraps to 0 and we fire audioPhraseBoundary.
 * 2. CONTINUOUS PHASE = (barCount + barPhase) / phraseBars, in [0,1).
 * 3. RE-ANCHOR ON DROPS. A drop is the strongest structural reset in EDM and
 *    almost always lands on a phrase boundary — when audioDropPulse fires we
 *    reset the bar count to 0 (the drop IS bar 0 of the new phrase). This makes
 *    the RELATIVE phrase grid (anchored to drops) reliable even though the
 *    ABSOLUTE phrase alignment is unknowable from audio alone (report caveat).
 *
 * Honesty (codex P0): the phase is only published as meaningful when the BPM is
 * locked AND music is actually playing (`active`). The BPM tracker can spuriously
 * lock on a near-silent noise floor — counting bars/phase on that would publish a
 * fictitious phrase grid over silence. We require `active` (the caller's party /
 * loud-music gate) so the phrase grid only runs when there is real music. Unlocked
 * or inactive → phase 0, no boundary fires; we do NOT fabricate a grid.
 *
 * Pure Math, allocation-free. Validated offline (synth bank): a steady
 * `full_track` fires audioPhraseBoundary on bar multiples (every phraseBars
 * bars); `edm_drop` re-anchors the count on the drop; `silence` fires nothing.
 */

export const PHRASE_TRACKER_DEFAULTS = Object.freeze({
  phraseBars: 8,           // bars per phrase (8 is the safe musical default; 16 = a section)
  downbeatFire: 0.5,       // audioDownbeat above this = a bar edge
  dropFire: 0.5,           // audioDropPulse above this = a re-anchor
  dropReanchorMs: 1500,    // ignore repeat drop re-anchors within this window
});

export class PhraseTracker {
  constructor(opts = {}) {
    this.p = { ...PHRASE_TRACKER_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._barCount = 0;          // bars into the current phrase [0, phraseBars)
    this._prevDownbeat = 0;
    this._prevDrop = 0;
    this._lastReanchorMs = -Infinity;
    this.phrasePhase = 0;
    this.phraseBoundary = false;
  }

  /**
   * @param {object} s
   *   s.downbeat   — audioDownbeat [0,1] (pulse once per bar)
   *   s.barPhase   — audioBarPhase [0,1] within the bar
   *   s.dropPulse  — audioDropPulse [0,1]
   *   s.bpmLocked  — only count when the bar grid is real
   *   s.active     — music actually playing (party/loud gate); guards against the
   *                  BPM tracker spuriously locking on a silent noise floor
   *   s.nowMs
   * @returns {{phrasePhase:number, phraseBoundary:number}}
   */
  update(s) {
    const p = this.p;
    this.phraseBoundary = false;

    // No real bar grid (unlocked) OR no music (inactive) → publish nothing
    // meaningful and HOLD the count reset (no fabricated phase over silence).
    if (!s.bpmLocked || s.active === false) {
      this._prevDownbeat = s.downbeat;
      this._prevDrop = s.dropPulse;
      this._barCount = 0;
      this.phrasePhase = 0;
      return { phrasePhase: 0, phraseBoundary: false };
    }

    // Re-anchor on a drop edge: the drop IS bar 0 of a new phrase.
    const dropEdge = s.dropPulse >= p.dropFire && this._prevDrop < p.dropFire;
    if (dropEdge && (s.nowMs - this._lastReanchorMs) >= p.dropReanchorMs) {
      this._barCount = 0;
      this._lastReanchorMs = s.nowMs;
      this.phraseBoundary = true;   // a drop starts a new phrase
    }

    // Count bars on the downbeat rising edge.
    const downEdge = s.downbeat >= p.downbeatFire && this._prevDownbeat < p.downbeatFire;
    if (downEdge && !dropEdge) {
      this._barCount += 1;
      if (this._barCount >= p.phraseBars) {
        this._barCount = 0;
        this.phraseBoundary = true;   // phrase wrap
      }
    }
    this._prevDownbeat = s.downbeat;
    this._prevDrop = s.dropPulse;

    // Continuous phase: bars-in + intra-bar fraction, normalized to the phrase.
    const barPhase = clamp01(s.barPhase);
    this.phrasePhase = clamp01((this._barCount + barPhase) / p.phraseBars);
    return { phrasePhase: this.phrasePhase, phraseBoundary: this.phraseBoundary };
  }

  /** Current integer bar position in the phrase (for the countdown module). */
  get barInPhrase() { return this._barCount; }
}

function clamp01(v) { return Number.isFinite(v) ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : 0; }

export default PhraseTracker;
