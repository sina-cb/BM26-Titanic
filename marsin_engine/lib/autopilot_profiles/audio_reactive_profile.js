/**
 * audio_reactive_profile.js — the `audio_reactive` autopilot profile (E2).
 *
 * GUIDING PRINCIPLE (operator, 2026-07-06):
 *   PATTERN reacts to DYNAMICS  — fast energy transients (a pickup switches the
 *                                 pattern; a sustained calm SLOWS it down).
 *   COLOR   reacts to STABLE STATE — a "situation descriptor" (coarse energy
 *                                 band + regime + held note) that must CHANGE
 *                                 and HOLD before the palette drifts. Beats and
 *                                 raw drops alone never recolour.
 * Pattern and colour are therefore driven from DIFFERENT time-scales of the
 * energy signal so they don't fire together.
 *
 * Behaviours:
 *   - PATTERN ADVANCE — event-driven (nextDelayMs() → null, no host timer). Two
 *     OR'd triggers into the SAME ctx.requestAdvance() path, both gated by
 *     minIntervalMs so they can't double-fire:
 *       (a) `audioSwitchPattern` pulse (drop / regime / slow-zone cue), and
 *       (b) a FAST positive slope in the smoothed energy envelope (a low→high
 *           "pickup" after a calm stretch); `audioDropPulse` is a strong
 *           confirmation. Reactive-slope is a valid v1 — predictive pre-arm via
 *           riser/dropCountdown/buildEta is optional and NOT required.
 *     SUPPRESSED during silence / non-party.
 *   - PATTERN SPEED (energy arc) — a smooth energy→speed-scale that SAGS as the
 *     music calms and recovers as energy stably rises. Implemented by ramping
 *     the bpmSpeedSync CEILING (`bpmSpeedMax`) between a floor and the armed
 *     ceiling, so it LAYERS ON bpmSpeedSync (tempo→speed) rather than fighting
 *     it for the `speed` key. Continuous (never stepwise), hysteretic (no
 *     jitter). Restored on detach.
 *   - MAX-DWELL SAFETY — if nothing advances for maxDwellS, advance anyway so
 *     the deck never freezes in an ambiguous passage.
 *   - PICK BIAS — loud → shuffle; slow-zone → group-locality (overlays the
 *     operator's stored autopilot fields at pick time, non-persistent).
 *   - COLOR — on a STABLE descriptor change held past colorHoldMs, map settled
 *     `audioNoteHue` → nearest curated palette by c1 hue distance and apply it.
 *     `audioSwitchColor` is only a CANDIDATE moment that still must pass the
 *     hold gate — a raw drop/onset alone must NOT recolour.
 *   - BRIGHTNESS — untouched (grand master never driven; operator gate A1).
 *
 * ═══ Spike 0 finding (why LEVEL-triggered, not edge-triggered) ═══
 * `audioSwitchPattern`/`audioSwitchColor` are SINGLE-HOP pulses at the source
 * (switch_signals.js sets them false each update(), true only on the firing
 * hop). The Companion throttles OSC sends via a phase accumulator (~60 Hz)
 * while the analyzer runs ~86 hops/s (companion_server.js sendOsc), so a pulse
 * landing on a dropped hop is LOST — there is no edge-hold on the wire. We
 * therefore trigger on "value > 0 observed" with a profile-side minInterval
 * re-guard, NOT a strict rising edge, and never assume every pulse arrives.
 *
 * The profile holds no persisted state; attach/detach own its subscription, its
 * per-tick energy loop, and the bpmSpeed CPC restore. All thresholds are
 * explicit constants below.
 */

import { pickNextAutoCycleEntry } from '../autopilot_pick.js';

// ── Tunable behaviour constants (explicit, no magic numbers inline) ────────
export const AUDIO_REACTIVE_DEFAULTS = Object.freeze({
  // Never advance the pattern faster than this even if triggers arrive in a
  // burst (the source already enforces a 6 s min-dwell; we re-guard so a wire
  // glitch or a slope+pulse coincidence can't strobe). Both pattern triggers
  // (switchPattern pulse + energy pickup) share this one guard.
  minIntervalMs: 6000,
  // Safety advance: if nothing advances for this long, advance anyway. Seconds.
  maxDwellS: 300,
  // Pick-bias thresholds.
  energyShuffleHi: 0.6,     // audioEnergyRatio above → shuffle
  slowGroupHi: 0.55,        // audioSlowZone above → group-locality
  // Gates: hold on silence / when not party.
  silenceHi: 0.5,           // audioSilence >= this → suppress advances
  partyLo: 0.5,             // audioParty < this → suppress advances
  // Speed window this profile arms on attach (the bpmSpeedSync ceiling floats
  // between bpmSpeedMaxFloor and bpmSpeedMax with the energy arc).
  bpmSpeedMin: 60,
  bpmSpeedMax: 160,
  bpmSpeedMaxFloor: 80,     // the lowest the ceiling sags to in a deep calm

  // ── Energy-arc envelope (the per-tick loop) ──────────────────────────────
  tickMs: 250,              // energy loop cadence
  energyFastTau: 2.0,       // s — fast envelope EMA time-constant (dynamics)
  energySlowTau: 10.0,      // s — slow envelope EMA (mood / stable state)
  // Pickup: a fast positive slope of energyFast over ~1s, after a calm stretch.
  pickupSlopePerS: 0.35,    // Δ(energyFast)/s above this = a pickup
  pickupArmBelow: 0.45,     // must have dipped below this recently to "pick up"
  // Speed arc: map energyFast → ceiling scale with hysteresis so the ramp is
  // smooth, not jittery. The ceiling target = floor + arc*(ceil-floor).
  speedArcRatePerS: 0.6,    // how fast the ceiling ramps toward its target (/s)

  // ── Colour on STABLE descriptor ──────────────────────────────────────────
  colorHoldMs: 6000,        // a descriptor change must hold this long to recolour
  colorMinIntervalMs: 4000, // never recolour faster than this
  energyBandEdges: [0.25, 0.5, 0.75],  // quantise energySlow → 4 bands (0..3)
});

// CPC keys this profile reads / writes. Named so a registry rename surfaces
// here rather than as a silent dead subscription.
const KEY = Object.freeze({
  switchPattern: 'audioSwitchPattern',
  switchColor: 'audioSwitchColor',
  noteHue: 'audioNoteHue',
  note: 'audioNote',
  energyRatio: 'audioEnergyRatio',
  slowZone: 'audioSlowZone',
  structure: 'audioStructure',
  dropPulse: 'audioDropPulse',
  genre: 'audioGenre',
  genreConf: 'audioGenreConf',
  silence: 'audioSilence',
  party: 'audioParty',
  bpmSpeedSync: 'bpmSpeedSync',
  bpmSpeedMin: 'bpmSpeedMin',
  bpmSpeedMax: 'bpmSpeedMax',
});

const WRITE_SOURCE = 'autopilot:audio_reactive';

export class AudioReactiveProfile {
  constructor(opts = {}) {
    this.name = 'audio_reactive';
    this._p = { ...AUDIO_REACTIVE_DEFAULTS, ...opts };
    this._ctx = null;
    this._unsub = null;
    this._tickTimer = null;
    this._lastAdvanceMs = 0;
    this._lastColorMs = 0;
    // Energy-arc envelope state (per-tick loop).
    this._energyFast = null;   // null = un-seeded; seeds to first sample
    this._energySlow = null;
    this._energyFastPrev = null;
    this._armedForPickup = false;   // dipped below pickupArmBelow → a rise counts
    this._ceilingNow = null;        // the currently-applied bpmSpeedMax ceiling
    this._lastTickMs = 0;
    // Colour descriptor state.
    this._descriptor = null;         // the last APPLIED (recoloured) descriptor
    this._pendingDescriptor = null;  // a candidate that must hold colorHoldMs
    this._pendingSinceMs = 0;
    // CPC values captured at attach so detach restores EXACTLY what was there.
    this._restore = null;
  }

  // EVENT-DRIVEN: no host timer. The host arms nothing; this profile advances
  // via ctx.requestAdvance() on an audio cue (or the per-tick loop).
  nextDelayMs(_state) {
    return null;
  }

  attach(ctx) {
    this._ctx = ctx;
    const now = Date.now();
    this._lastAdvanceMs = now;
    this._lastColorMs = now;
    this._lastTickMs = now;

    // SPEED: arm bpmSpeedSync so `speed` tracks tempo. Capture prior values so
    // detach restores them verbatim. The ceiling starts at the armed max and
    // floats with the energy arc thereafter.
    this._restore = {
      bpmSpeedSync: this._getNum(KEY.bpmSpeedSync),
      bpmSpeedMin: this._getNum(KEY.bpmSpeedMin),
      bpmSpeedMax: this._getNum(KEY.bpmSpeedMax),
    };
    this._ceilingNow = this._p.bpmSpeedMax;
    this._set(KEY.bpmSpeedSync, 1);
    this._set(KEY.bpmSpeedMin, this._p.bpmSpeedMin);
    this._set(KEY.bpmSpeedMax, this._ceilingNow);

    // Subscribe to the CPC for the pulse-driven triggers (switchPattern advance
    // candidate, switchColor colour candidate).
    if (ctx.paramCenter && typeof ctx.paramCenter.subscribe === 'function') {
      this._unsub = ctx.paramCenter.subscribe((ev) => this._onChange(ev));
    }

    // The per-tick energy loop: envelopes, speed arc, pickup detection,
    // descriptor-hold colour gate, and the max-dwell safety advance. unref so
    // it never keeps the event loop alive on its own.
    this._tickTimer = setInterval(() => this._tick(), this._p.tickMs);
    if (this._tickTimer.unref) this._tickTimer.unref();
  }

  detach() {
    if (this._unsub) { try { this._unsub(); } catch { /* already gone */ } this._unsub = null; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    // SPEED restore: put bpmSpeedSync + window back to what they were before we
    // armed them (read-modify-restore, no fallback). A value we could not read
    // at attach is left untouched (null → skip).
    if (this._restore) {
      if (this._restore.bpmSpeedSync !== null) this._set(KEY.bpmSpeedSync, this._restore.bpmSpeedSync);
      if (this._restore.bpmSpeedMin !== null) this._set(KEY.bpmSpeedMin, this._restore.bpmSpeedMin);
      if (this._restore.bpmSpeedMax !== null) this._set(KEY.bpmSpeedMax, this._restore.bpmSpeedMax);
      this._restore = null;
    }
    this._ctx = null;
  }

  // PICK BIAS: overlay audio-derived shuffle/group onto the operator's stored
  // autopilot fields at pick time (non-persistent). Loud → shuffle; slow zone →
  // group-locality. Otherwise fall through to the operator's stored settings.
  pickNextEntry(pl, autopilot, curEntryId, groupRuntime) {
    const energy = this._getNum(KEY.energyRatio);
    const slow = this._getNum(KEY.slowZone);
    let ap = autopilot;
    if (Number.isFinite(slow) && slow > this._p.slowGroupHi) {
      ap = { ...autopilot, groupMode: true };
    } else if (Number.isFinite(energy) && energy > this._p.energyShuffleHi) {
      ap = { ...autopilot, shuffle: true, groupMode: false };
    }
    return pickNextAutoCycleEntry(pl, ap, curEntryId, groupRuntime);
  }

  // `audio_reactive` carries no profile-specific persisted wire fields in v1
  // (its behaviour is tuned in-code); nothing to validate.
  validateState(_wire) {}

  // ── CPC change handler (pulse-driven candidates) ───────────────────────────
  _onChange(ev) {
    if (!ev || !Array.isArray(ev.changedKeys)) return;
    // COLOUR CANDIDATE: a switchColor pulse is ONLY a candidate moment — it
    // still has to pass the stable-descriptor hold gate in _tick(). So here we
    // just re-evaluate the descriptor immediately (a pulse coinciding with a
    // real settled change recolours; a bare transient does not).
    if (ev.changedKeys.includes(KEY.switchColor) && this._pulseHigh(ev, KEY.switchColor)) {
      this._evaluateColorDescriptor(Date.now(), /* candidateNow */ true);
    }
    // PATTERN ADVANCE (trigger a): a switchPattern pulse → same requestAdvance
    // path as the energy pickup, both gated by minIntervalMs.
    if (ev.changedKeys.includes(KEY.switchPattern) && this._pulseHigh(ev, KEY.switchPattern)) {
      this._maybeAdvance(Date.now());
    }
  }

  // LEVEL-triggered (Spike 0): treat "value > 0 on this event" as the trigger —
  // do NOT require a strict rising edge (the wire drops single-hop pulses).
  _pulseHigh(ev, key) {
    const slot = ev.state && ev.state.params && ev.state.params[key];
    const v = slot ? Number(slot.value) : NaN;
    return Number.isFinite(v) && v > 0;
  }

  // ── Per-tick energy loop ───────────────────────────────────────────────────
  _tick() {
    if (!this._ctx) return;
    const now = Date.now();
    const dt = this._lastTickMs ? Math.max(0, (now - this._lastTickMs) / 1000) : 0;
    this._lastTickMs = now;

    // 1. Update the two energy envelopes (fast = dynamics, slow = mood).
    const energy = this._getNum(KEY.energyRatio);
    if (Number.isFinite(energy)) {
      this._energyFastPrev = this._energyFast;
      this._energyFast = this._ema(this._energyFast, energy, dt, this._p.energyFastTau);
      this._energySlow = this._ema(this._energySlow, energy, dt, this._p.energySlowTau);
    }

    // 2. Speed arc — ramp the bpmSpeedSync ceiling toward an energy-derived
    //    target. Runs regardless of gating (a calm ≠ silence). Layers on
    //    bpmSpeedSync: a lower ceiling sags the mapped speed.
    this._rampSpeedCeiling(dt);

    // 3. Pattern pickup (trigger b) — a fast positive slope after a calm dip.
    this._detectPickup(now, dt);

    // 4. Colour on stable descriptor — re-evaluate + apply if a change has held.
    this._evaluateColorDescriptor(now, /* candidateNow */ false);

    // 5. Max-dwell safety — force an advance if nothing has happened in a while.
    if (!this._gatedSilent() && (now - this._lastAdvanceMs >= this._p.maxDwellS * 1000)) {
      this._advance(now);
    }
  }

  // Ramp the ceiling continuously toward floor + arc*(ceil-floor), where the arc
  // is the fast energy envelope. Rate-limited per second so it never steps.
  _rampSpeedCeiling(dt) {
    if (!Number.isFinite(this._energyFast) || this._ceilingNow === null) return;
    const floor = this._p.bpmSpeedMaxFloor;
    const ceil = this._p.bpmSpeedMax;
    const arc = Math.max(0, Math.min(1, this._energyFast));
    const target = floor + arc * (ceil - floor);
    // Move at most speedArcRatePerS * (ceil-floor) per second toward target.
    const maxStep = this._p.speedArcRatePerS * (ceil - floor) * (dt || 0);
    const delta = target - this._ceilingNow;
    const step = Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
    const next = this._ceilingNow + step;
    // Only write on a meaningful change (avoid CPC churn on a settled arc).
    if (Math.abs(next - this._ceilingNow) >= 0.5) {
      this._ceilingNow = next;
      this._set(KEY.bpmSpeedMax, Math.round(this._ceilingNow));
    }
  }

  // A SUDDEN pickup: energyFast rose fast after having dipped into a calm. Uses
  // hysteresis (arm on a dip, fire on the rise) so a steady loud passage doesn't
  // repeatedly fire. OR's into the shared requestAdvance path (minInterval-gated).
  _detectPickup(now, dt) {
    if (!Number.isFinite(this._energyFast) || !Number.isFinite(this._energyFastPrev) || dt <= 0) {
      return;
    }
    if (this._energyFast < this._p.pickupArmBelow) this._armedForPickup = true;
    const slope = (this._energyFast - this._energyFastPrev) / dt;   // per second
    const drop = this._getNum(KEY.dropPulse);
    const dropConfirms = Number.isFinite(drop) && drop >= 0.5;
    if (this._armedForPickup && (slope >= this._p.pickupSlopePerS || dropConfirms)) {
      this._armedForPickup = false;
      this._maybeAdvance(now);
    }
  }

  // Shared advance gate: silence/party gate + minInterval re-guard, then advance.
  _maybeAdvance(now) {
    if (this._gatedSilent()) return;
    if (now - this._lastAdvanceMs < this._p.minIntervalMs) return;
    this._advance(now);
  }

  _advance(now) {
    this._lastAdvanceMs = now;
    if (this._ctx && typeof this._ctx.requestAdvance === 'function') {
      // requestAdvance may return a Promise (the swap's done). We don't await —
      // the daemon's generation guard + EBUSY skip make a re-entrant call safe.
      try { this._ctx.requestAdvance(); } catch (e) {
        console.warn('[audio_reactive] requestAdvance failed:', e && e.message ? e.message : e);
      }
    }
  }

  _gatedSilent() {
    const silence = this._getNum(KEY.silence);
    const party = this._getNum(KEY.party);
    if (Number.isFinite(silence) && silence >= this._p.silenceHi) return true;
    if (Number.isFinite(party) && party < this._p.partyLo) return true;
    return false;
  }

  // ── Colour on STABLE descriptor ─────────────────────────────────────────────
  // Build a coarse "situation descriptor" from SLOW signals: quantised energy
  // band (from energySlow), regime (slowZone + structure), and held note class.
  // A colour change is triggered ONLY when this descriptor CHANGES and then HOLDS
  // for colorHoldMs — so beats/raw drops (fast) never recolour, only sustained
  // mood shifts do. `candidateNow` (a switchColor pulse) does NOT bypass the
  // hold; it just prompts an immediate re-evaluation.
  _evaluateColorDescriptor(now, _candidateNow) {
    const desc = this._currentDescriptor();
    if (desc === null) return;   // not enough signal yet

    if (desc !== this._descriptor) {
      // A different descriptor than the one we last coloured. Start (or continue)
      // holding it; recolour only once it has held long enough.
      if (desc !== this._pendingDescriptor) {
        this._pendingDescriptor = desc;
        this._pendingSinceMs = now;
        return;
      }
      const held = now - this._pendingSinceMs >= this._p.colorHoldMs;
      const spaced = now - this._lastColorMs >= this._p.colorMinIntervalMs;
      if (held && spaced) {
        this._applyAudioColor();
        this._descriptor = desc;
        this._pendingDescriptor = null;
        this._lastColorMs = now;
      }
    } else {
      // Back to the current colour's descriptor before the pending one settled —
      // drop the pending change (no recolour to a state we're already showing).
      this._pendingDescriptor = null;
    }
  }

  // Coarse descriptor string, or null if the core signal (energySlow) is absent.
  _currentDescriptor() {
    if (!Number.isFinite(this._energySlow)) return null;
    const band = this._quantizeBand(this._energySlow);
    const slow = this._getNum(KEY.slowZone);
    const regime = Number.isFinite(slow) ? (slow > this._p.slowGroupHi ? 'slow' : 'norm') : 'norm';
    // Structure index (0/1/2) when trustworthy; else omit from the descriptor.
    const structure = this._getNum(KEY.structure);
    const struct = Number.isFinite(structure) ? Math.round(structure) : 'x';
    // Held note class (0..11) as a stable harmonic anchor; NaN → 'x'.
    const note = this._getNum(KEY.note);
    const noteClass = Number.isFinite(note) ? Math.round(note) : 'x';
    return `b${band}:${regime}:s${struct}:n${noteClass}`;
  }

  _quantizeBand(v) {
    const edges = this._p.energyBandEdges;
    let band = 0;
    for (let i = 0; i < edges.length; i++) { if (v >= edges[i]) band = i + 1; }
    return band;
  }

  // Map settled audioNoteHue → nearest curated palette by circular c1-hue
  // distance, then apply it. Optionally narrow to a genre subset when the genre
  // classifier is confident (audioGenreConf > 0.5). Both hues are [0,1].
  _applyAudioColor() {
    if (!this._ctx || typeof this._ctx.applyColorPalette !== 'function') return;
    const hue = this._getNum(KEY.noteHue);
    if (!Number.isFinite(hue)) return;
    const palettes = typeof this._ctx.colorPalettes === 'function' ? this._ctx.colorPalettes() : [];
    if (!Array.isArray(palettes) || palettes.length === 0) return;
    let best = null;
    let bestDist = Infinity;
    for (const p of palettes) {
      if (!p || !p.id || typeof p.c1 !== 'number') continue;
      const d = this._hueDist(hue, p.c1);
      if (d < bestDist) { bestDist = d; best = p.id; }
    }
    if (best) {
      try { this._ctx.applyColorPalette(best); } catch (e) {
        console.warn('[audio_reactive] applyColorPalette failed:', e && e.message ? e.message : e);
      }
    }
  }

  // Circular distance on the [0,1) hue wheel.
  _hueDist(a, b) {
    let d = Math.abs(a - b) % 1;
    if (d > 0.5) d = 1 - d;
    return d;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  // Exponential moving average with a time-constant tau (seconds). Seeds to the
  // first sample. dt=0 → hold. A large tau moves slowly (mood); small tau fast.
  _ema(prev, sample, dt, tau) {
    if (!Number.isFinite(prev)) return sample;
    if (dt <= 0 || tau <= 0) return prev;
    const alpha = 1 - Math.exp(-dt / tau);
    return prev + alpha * (sample - prev);
  }

  // Read a CPC scalar, or NaN if the key is unregistered (audio off) / errors.
  // NOT a fallback default — NaN callers explicitly skip on non-finite.
  _getNum(key) {
    const pc = this._ctx && this._ctx.paramCenter;
    if (!pc || typeof pc.get !== 'function') return NaN;
    try {
      const v = Number(pc.get(key));
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;   // unregistered key (audio disabled) — caller skips
    }
  }

  _set(key, value) {
    const pc = this._ctx && this._ctx.paramCenter;
    if (!pc || typeof pc.set !== 'function') return;
    try { pc.set(key, value, WRITE_SOURCE); } catch (e) {
      // A missing key means audio isn't wired in this scene — that's not a
      // profile bug, so warn rather than crash the arm.
      console.warn(`[audio_reactive] could not set ${key}: ${e && e.message ? e.message : e}`);
    }
  }
}

export default AudioReactiveProfile;
