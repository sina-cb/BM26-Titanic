/**
 * audio_reactive_profile.js — the `audio_reactive` autopilot profile (E2).
 *
 * GUIDING PRINCIPLE (operator, 2026-07-06):
 *   PATTERN reacts to DYNAMICS  — a SUSTAINED energy pickup switches the pattern;
 *                                 a sustained calm SLOWS it down.
 *   COLOR   reacts to STABLE STATE — a "situation descriptor" (coarse energy
 *                                 band + regime + held note) that must CHANGE
 *                                 and HOLD before the palette drifts. Beats and
 *                                 raw drops alone never recolour.
 * Pattern and colour are therefore driven from DIFFERENT time-scales of the
 * energy signal so they don't fire together.
 *
 * ═══ ART-CAR ROBUSTNESS (Burning Man, 2026-07-06) ═══════════════════════════
 * From a SINGLE playa mic we cannot cleanly separate our own sound system from
 * a passing art car's. A car is loud EXTERNAL audio for ~10–40 s, then gone.
 * DESIGN PRINCIPLE: react to the SUSTAINED musical context of OUR track (over
 * minutes), treat brief swells as noise. Concretely:
 *   - a pattern switch requires energy to RISE **and STAY elevated** for a
 *     CONFIRMATION WINDOW (`switchConfirmMs`, ~5 s) — a swell that fades inside
 *     the window never switches;
 *   - the energy envelopes use LONG time-constants (`energySlowTau` ~20 s) so a
 *     20 s flyby can't dominate the sustained trend that drives speed;
 *   - the speed arc rides the SLOW (mood) envelope, not the fast one, so a
 *     transient can't yank the tempo scale;
 *   - colour is corroborated (energy band AND note both stable) AND held
 *     (`colorHoldMs` ~10 s) AND silence-gated — a transient foreign note/energy
 *     during a flyby must NOT recolour;
 *   - a heavy `minIntervalMs` (~12 s) means even a slipped-through false
 *     trigger can't churn the deck.
 * All thresholds are TUNABLE constructor params (see AUDIO_REACTIVE_DEFAULTS)
 * with documented BM defaults — see docs/41_audio_reactive_tuning.md.
 *
 * Behaviours:
 *   - PATTERN ADVANCE — event-driven (nextDelayMs() → null, no host timer). Two
 *     OR'd triggers into the SAME ctx.requestAdvance() path, both gated by
 *     minIntervalMs so they can't double-fire:
 *       (a) `audioSwitchPattern` pulse (drop / regime / slow-zone cue, already
 *           beat-quantized + min-dwelled at the source), and
 *       (b) a SUSTAINED energy pickup — energy that rises from a calm and then
 *           STAYS above pickupSustainAbove for switchConfirmMs (no instantaneous-
 *           slope test, no drop-pulse trigger — pure held elevation; a passing
 *           car's brief swell fails the hold, our track's build passes it).
 *     SUPPRESSED during silence / non-party AND when the autopilot is paused.
 *   - PATTERN SPEED (energy arc) — a smooth energy→speed-SCALE that SAGS as the
 *     music calms and recovers as energy stably rises. Implemented as a
 *     MULTIPLICATIVE scale [speedScaleFloor,1] layered on the bpmSpeedSync
 *     tempo→speed mapping via ctx.setSpeedScale() (calm → slower). Rides the
 *     SLOW envelope so a flyby can't yank it. Restored to 1 on detach.
 *   - MAX-DWELL SAFETY — if nothing advances for maxDwellS, advance anyway so
 *     the deck never freezes in an ambiguous passage.
 *   - PICK BIAS — loud → shuffle; slow-zone → group-locality (overlays the
 *     operator's stored autopilot fields at pick time, non-persistent).
 *   - COLOR — on a STABLE descriptor change held past colorHoldMs, map settled
 *     `audioNoteHue` → nearest curated palette by c1 hue distance and apply it.
 *     Seeded on the FIRST computation (no recolour on arm — F3), silence-gated.
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
 * per-tick energy loop, the bpmSpeed CPC restore, and the speed-scale restore.
 * All thresholds are explicit constants below.
 */

import { pickNextAutoCycleEntry } from '../autopilot_pick.js';

// ── Tunable behaviour constants (explicit, no magic numbers inline) ────────
// EVERY field here is a documented tunable — see docs/41_audio_reactive_tuning.md
// for the "more/less reactive" guidance. Override any subset via the constructor.
export const AUDIO_REACTIVE_DEFAULTS = Object.freeze({
  // Never advance the pattern faster than this even if triggers arrive in a
  // burst. BM default is HEAVY (12 s) so even a false trigger that slips through
  // the confirmation window can't churn the deck. Both pattern triggers
  // (switchPattern pulse + energy pickup) share this one guard.
  minIntervalMs: 12000,
  // Safety advance: if nothing advances for this long, advance anyway. Seconds.
  maxDwellS: 300,
  // Pick-bias thresholds.
  energyShuffleHi: 0.6,     // audioEnergyRatio above → shuffle
  slowGroupHi: 0.55,        // audioSlowZone above → group-locality
  // Gates: hold on silence / when not party.
  silenceHi: 0.5,           // audioSilence >= this → suppress advances
  partyLo: 0.5,             // audioParty < this → suppress advances
  // Speed window this profile arms on attach (bpmSpeedSync maps tempo into it).
  // The energy arc no longer moves this window — it drives a MULTIPLICATIVE
  // scale on the mapped speed instead (see speedScaleFloor).
  bpmSpeedMin: 60,
  bpmSpeedMax: 160,

  // ── Energy-arc envelope (the per-tick loop) ──────────────────────────────
  tickMs: 250,              // energy loop cadence
  energyFastTau: 2.0,       // s — fast envelope EMA time-constant (dynamics/pickup)
  energySlowTau: 25.0,      // s — slow envelope EMA (mood / speed arc / colour
                            //     band). LONG so a passing art-car swell can't
                            //     dominate the sustained trend.
  // ── Sustained-pickup detection (pattern switch) ──────────────────────────
  // A pickup ARMS when energyFast dips below pickupArmBelow (a calm), then FIRES
  // only if energyFast climbs to pickupSustainAbove and STAYS there CONTINUOUSLY
  // for switchConfirmMs. There is NO instantaneous-slope test (EMA slope is too
  // fragile — it broke real builds) and NO drop-pulse trigger (F6) — pure
  // sustained elevation. This is the core art-car rejection: a passing car PEAKS
  // then FADES, so its above-sustain dwell is shorter than the window and
  // cancels; OUR track's build PLATEAUS high and fires. A car parked adjacent
  // blasting LONGER than switchConfirmMs causes at most ONE (minInterval-capped)
  // switch — unavoidable from one mic; raise switchConfirmMs to reject longer swells.
  pickupArmBelow: 0.45,     // must have dipped below this recently to "pick up"
  pickupSustainAbove: 0.6,  // energyFast must STAY above this through the window
  switchConfirmMs: 15000,   // it must hold that high this long before it switches
  // ── Speed arc scale ──────────────────────────────────────────────────────
  // The multiplicative scale layered on bpm-sync: scale = floor + slowEnergy*(1-floor).
  // floor is the slowest the pattern runs in a deep calm (relative to its tempo
  // speed). 1.0 = never slow down; 0.0 = can stall on a full calm.
  speedScaleFloor: 0.35,
  speedArcRatePerS: 0.5,    // how fast the scale ramps toward its target (/s)

  // ── Colour on STABLE descriptor ──────────────────────────────────────────
  colorHoldMs: 15000,       // a descriptor change must hold this long to recolour
  colorMinIntervalMs: 8000, // never recolour faster than this
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
    // Sustained-pickup state machine.
    this._armedForPickup = false;    // has dipped below pickupArmBelow (a calm) → latched
    this._pickupPendingSinceMs = 0;  // when energy LANDED above sustain (0 = none pending)
    // Speed-scale arc state (the multiplicative scale layered on bpm-sync).
    this._speedScaleNow = 1;
    this._lastTickMs = 0;
    // Colour descriptor state.
    this._descriptor = null;         // the last APPLIED / SEEDED descriptor
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

    // SPEED: arm bpmSpeedSync so `speed` tracks tempo within a fixed window.
    // Capture prior values so detach restores them verbatim. The energy arc
    // drives a MULTIPLICATIVE scale on the mapped speed (ctx.setSpeedScale),
    // NOT this window — the window stays put.
    this._restore = {
      bpmSpeedSync: this._getNum(KEY.bpmSpeedSync),
      bpmSpeedMin: this._getNum(KEY.bpmSpeedMin),
      bpmSpeedMax: this._getNum(KEY.bpmSpeedMax),
    };
    this._speedScaleNow = 1;
    this._set(KEY.bpmSpeedSync, 1);
    this._set(KEY.bpmSpeedMin, this._p.bpmSpeedMin);
    this._set(KEY.bpmSpeedMax, this._p.bpmSpeedMax);
    this._applySpeedScale(1);

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
    // SPEED restore: drop the energy scale back to 1 (no attenuation) then put
    // bpmSpeedSync + window back to what they were before we armed them
    // (read-modify-restore, no fallback). A value we could not read at attach
    // (NaN) is left untouched — F4: guard on Number.isFinite, not `!== null`.
    this._applySpeedScale(1);
    if (this._restore) {
      if (Number.isFinite(this._restore.bpmSpeedSync)) this._set(KEY.bpmSpeedSync, this._restore.bpmSpeedSync);
      if (Number.isFinite(this._restore.bpmSpeedMin)) this._set(KEY.bpmSpeedMin, this._restore.bpmSpeedMin);
      if (Number.isFinite(this._restore.bpmSpeedMax)) this._set(KEY.bpmSpeedMax, this._restore.bpmSpeedMax);
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

  // Whether the autopilot host is currently ACTIVE (playing). A PAUSED autopilot
  // must not couple audio to speed/colour/advance (F2). A ctx without state()
  // (older unit stubs) is treated as active so those tests still drive _tick().
  _active() {
    if (!this._ctx || typeof this._ctx.state !== 'function') return true;
    const st = this._ctx.state();
    // `active` absent (never toggled) → treat as active; an explicit false pauses.
    return !(st && st.active === false);
  }

  // ── CPC change handler (pulse-driven candidates) ───────────────────────────
  _onChange(ev) {
    if (!ev || !Array.isArray(ev.changedKeys)) return;
    if (!this._active()) return;   // F2: paused autopilot = no audio coupling
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
      this._energyFast = this._ema(this._energyFast, energy, dt, this._p.energyFastTau);
      this._energySlow = this._ema(this._energySlow, energy, dt, this._p.energySlowTau);
    }

    // F2: when the autopilot is PAUSED, keep the envelopes warm (so a resume
    // isn't cold) but drive NO side-effects — no speed, no colour, no advance.
    if (!this._active()) return;

    // 2. Speed arc — ramp the MULTIPLICATIVE speed scale toward an energy-derived
    //    target (calm → slower). Rides the SLOW envelope so a transient flyby
    //    can't yank the tempo scale. Runs regardless of gating (a calm ≠ silence).
    this._rampSpeedScale(dt);

    // 3. Pattern pickup (trigger b) — a SUSTAINED fast positive slope after a calm.
    this._detectPickup(now, dt);

    // 4. Colour on stable descriptor — re-evaluate + apply if a change has held.
    this._evaluateColorDescriptor(now, /* candidateNow */ false);

    // 5. Max-dwell safety — force an advance if nothing has happened in a while.
    if (!this._gatedSilent() && (now - this._lastAdvanceMs >= this._p.maxDwellS * 1000)) {
      this._advance(now);
    }
  }

  // Ramp the multiplicative speed SCALE continuously toward
  // floor + slowEnergy*(1-floor), where the arc is the SLOW energy envelope
  // (mood, not dynamics). Rate-limited per second so it never steps. A lower
  // scale sags `speed` below the tempo mapping — calm → slower (F1 fix).
  _rampSpeedScale(dt) {
    if (!Number.isFinite(this._energySlow)) return;
    const floor = this._p.speedScaleFloor;
    const arc = Math.max(0, Math.min(1, this._energySlow));
    const target = floor + arc * (1 - floor);
    const maxStep = this._p.speedArcRatePerS * (dt || 0);
    const delta = target - this._speedScaleNow;
    const step = Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
    const next = this._speedScaleNow + step;
    // Only write on a meaningful change (avoid CPC churn on a settled arc).
    if (Math.abs(next - this._speedScaleNow) >= 0.01) {
      this._speedScaleNow = next;
      this._applySpeedScale(this._speedScaleNow);
    }
  }

  // Push the speed scale to the live BpmSpeedSync (via ctx). A unit ctx without
  // setSpeedScale simply skips (the arc is exercised at the HIL level).
  _applySpeedScale(scale) {
    if (this._ctx && typeof this._ctx.setSpeedScale === 'function') {
      try { this._ctx.setSpeedScale(scale); } catch (e) {
        console.warn('[audio_reactive] setSpeedScale failed:', e && e.message ? e.message : e);
      }
    }
  }

  // A SUSTAINED pickup, in two beats:
  //   ARM     — energyFast dips below pickupArmBelow (a calm stretch). This is a
  //             LATCH: it stays armed (we don't wipe progress every tick) until a
  //             switch fires. While still in the calm the confirm clock is held
  //             at 0 (energy hasn't picked up yet).
  //   CONFIRM — once armed, energyFast must climb to pickupSustainAbove and STAY
  //             there CONTINUOUSLY for switchConfirmMs. The clock starts when
  //             energy LANDS above the sustain bar and RESETS if it sinks back
  //             below (the swell faded) — so only an elevation that plateaus for
  //             the whole window fires.
  // No instantaneous-slope test (EMA slope decays as it approaches the target, so
  // a threshold on it was met only during the earliest sub-arm ticks and got
  // wiped by re-arming — it silently broke every real build). No drop-pulse
  // trigger either (F6). Pure "rose from a calm and held high" — which a passing
  // art car (peak-then-fade) fails and OUR track's build passes.
  _detectPickup(now, _dt) {
    if (!Number.isFinite(this._energyFast)) return;
    // ARM latch on a calm; being in the calm also cancels any confirmation in
    // progress (energy fell back — not a sustained pickup).
    if (this._energyFast < this._p.pickupArmBelow) {
      this._armedForPickup = true;
      this._pickupPendingSinceMs = 0;
      return;
    }
    if (!this._armedForPickup) return;
    // Armed (recently calm) and now above the arm floor.
    const elevated = this._energyFast >= this._p.pickupSustainAbove;
    if (!elevated) {
      // rising but not yet high enough — keep armed, hold the clock at 0
      this._pickupPendingSinceMs = 0;
      return;
    }
    if (this._pickupPendingSinceMs === 0) {
      this._pickupPendingSinceMs = now;   // clock starts when energy LANDS high
      return;
    }
    // Held above the sustain bar long enough → OUR music building, not a flyby.
    if (now - this._pickupPendingSinceMs >= this._p.switchConfirmMs) {
      this._armedForPickup = false;
      this._pickupPendingSinceMs = 0;
      this._maybeAdvance(now);
    }
  }

  // Shared advance gate: active + silence/party gate + minInterval re-guard.
  _maybeAdvance(now) {
    if (!this._active()) return;              // F2
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
  // mood shifts do. It is ALSO silence-gated (F3: a flyby's foreign note during
  // an otherwise-silent-for-us passage must not recolour) and SEEDED on first
  // computation (no recolour on arm). `candidateNow` (a switchColor pulse) does
  // NOT bypass the hold; it just prompts an immediate re-evaluation.
  _evaluateColorDescriptor(now, _candidateNow) {
    if (!this._active()) return;         // F2: paused = no recolour
    if (this._gatedSilent()) return;     // F3: silence/non-party = no recolour
    const desc = this._currentDescriptor();
    if (desc === null) return;   // not enough signal yet

    // F3: SEED on the first descriptor — adopt it as the current colour's
    // descriptor WITHOUT recolouring, so arming never triggers a palette change.
    if (this._descriptor === null) {
      this._descriptor = desc;
      this._pendingDescriptor = null;
      return;
    }

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
  // The recolour TRIGGER is a sustained MOOD change: the coarse energy band (from
  // the SLOW envelope, τ≈25 s) plus the slow-zone regime. It deliberately EXCLUDES
  // the instantaneous NOTE (a passing car injects a foreign note for its whole
  // pass — including it would recolour on every flyby) and the "under development"
  // structure detector. The NOTE still chooses WHICH palette at recolour time
  // (see _applyAudioColor) — it just doesn't decide WHETHER to recolour. Net:
  // colour drifts with our track's sustained energy/mood, not with transient pitch.
  _currentDescriptor() {
    if (!Number.isFinite(this._energySlow)) return null;
    const band = this._quantizeBand(this._energySlow);
    const slow = this._getNum(KEY.slowZone);
    const regime = Number.isFinite(slow) ? (slow > this._p.slowGroupHi ? 'slow' : 'norm') : 'norm';
    return `b${band}:${regime}`;
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

  // Write a CPC scalar. ParamCenter.set returns a STATUS object (it does NOT
  // throw), so F5: check result.status and warn on anything but 'ok' — e.g. a
  // source-lock rejection or an unknown key — rather than silently dropping it.
  _set(key, value) {
    const pc = this._ctx && this._ctx.paramCenter;
    if (!pc || typeof pc.set !== 'function') return;
    let result;
    try { result = pc.set(key, value, WRITE_SOURCE); } catch (e) {
      // A missing key means audio isn't wired in this scene — that's not a
      // profile bug, so warn rather than crash the arm.
      console.warn(`[audio_reactive] could not set ${key}: ${e && e.message ? e.message : e}`);
      return;
    }
    if (result && typeof result === 'object' && result.status && result.status !== 'ok') {
      console.warn(`[audio_reactive] set ${key} ignored: ${result.reason || result.status}`
        + (result.lockedTo ? ` (locked to ${result.lockedTo})` : ''));
    }
  }
}

export default AudioReactiveProfile;
