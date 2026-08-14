/**
 * GlobalEffectsController
 *
 * Two coexisting subsystems live in this class:
 *
 * 1. LEGACY rig-level DMX overrides (Vintage White boost, UV blast,
 *    fogger, horn, fire) — applied either to pixel structures
 *    (`applyPixels`) or directly to outgoing DMX universes
 *    (`applyDmx`). These remain unchanged so existing CaptainPad
 *    buttons (`vintageWhite`, `blastWhite`, `uvBlast`, `fogger`)
 *    keep working through the existing POST /global-effect route.
 *
 * 2. NEW Global Effect Macros (docs/28) — engine-side modular
 *    effects applied to the post-mixer pixel buffer before the
 *    intensity / blackout / sACN encoding pipeline. Runtime state
 *    for these (active strobe config, drop hit envelopes, color
 *    wash, feedback trail buffer) lives here; the apply functions
 *    themselves are stateless and imported from ../effects/*.
 */
import {
  GLOBAL_EFFECT_LIBRARY,
  SAFETY_TIERS,
  MAX_BURST_MS,
  validateParams,
  validateColor6,
} from './global_effect_library.js';
import { strobeEffect } from '../effects/strobe.js';
import { dropHitEffect } from '../effects/dropHit.js';
import { colorWashEffect } from '../effects/colorWash.js';
import { feedbackTrailsEffect } from '../effects/feedbackTrails.js';
import { groupFixedColorEffect } from '../effects/group_fixed_color.js';
import { invertEffect } from '../effects/invert.js';
import { beatPumpEffect } from '../effects/e1_beat_pump.js';
import { waterlineSweepEffect } from '../effects/e2_waterline_sweep.js';
import {
  applySpatialPaint,
  applySpatialIgnite,
  SPATIAL_AXIS_PAIRS,
  SPATIAL_FADE_SECONDS,
} from '../effects/spatial_paint.js';
import { kickPunchEffect } from '../effects/e3_kick_punch.js';
import { movementTraceEffect } from '../effects/movement_trace.js';
import { freezeFrameEffect } from '../effects/freeze_frame.js';
import { groupIndicesFor } from './pixel_group_index.js';
import { paletteCrushEffect } from '../effects/palette_crush.js';
import { oceanBreathEffect } from '../effects/ocean_breath.js';
import { frostSparkleEffect } from '../effects/frost_sparkle.js';

// Wave-1 party effect defaults. Kept here (not the library) because they
// are controller runtime tuning, mirrored by the GLOBAL_EFFECT_LIBRARY
// presets for the operator-facing slot layer.
const DROP_HIT_MAX_POLY = 6; // cap concurrent dropHit envelopes (E3 pile-up guard)

export class GlobalEffectsController {
  constructor(config = {}) {
    // ── Legacy effect toggles ───────────────────────────────────────
    this.effects = {
      vintageWhite: false,
      fogger: false,
      uvBlast: false,
      blastWhite: false,
      horn: false,
      fire: false,
      vintageWhiteBypassDimmer: false,
      uvBlastBypassDimmer: false,
      blastWhiteBypassDimmer: false,
    };
    this.foggers = [];
    this.horns = [];
    this.fires = [];

    // ── Macro runtime state (transient on boot per §8) ──────────────
    this.frameRate = (config && config.engine && config.engine.fps) || 40;
    this.modelPixelCount = Number.isInteger(config.modelPixelCount) && config.modelPixelCount > 0
      ? config.modelPixelCount : null;

    // Strobe.
    this.strobeActive = false;
    this.strobeConfig = null; // { hz, duty, intensity, presetId, slotId, framesPerCycle, onFrames }
    this.strobeStartedAtFrame = 0;
    this.strobeBurstEndFrame = null;
    this.activeStrobePresetId = null;
    this.activeStrobeSlotId = null;
    this.strobeFadingOut = false;
    this.strobeFadeStartMs = 0;
    this.strobeFadeDurationMs = 0;

    // Drop hit (poly: each trigger pushes a new envelope, multiple
    // overlapping envelopes are summed via the additive blend mode).
    this.dropHits = []; // [{ params, triggeredAtMs, durationMs }]

    // Color wash — MULTI-INSTANCE, keyed per slot (RCA 2026-07-13: Ocean Wash
    // slot 3 + Emergency Red slot 8 are two PRESETS of the SAME `colorWash`
    // effect; the pre-fix single runtime layer meant activating one REPLACED
    // the other). Each active wash now owns its own entry so two slots (even
    // two of the SAME preset) coexist as independent layers. Keying:
    //   slot dispatch  → `slot:${slotId}`
    //   slotless (scheduler dispatchEffectAction slotId:null, or a direct
    //     setColorWash with no slotId) → `sched:${presetId}`  (one entry per
    //     scheduled preset — re-dispatch upserts, never piles up).
    // Entry shape mirrors the old single config so per-entry fadeOut logic is
    // unchanged. `colorWashConfig` is kept as a LEGACY single-object VIEW that
    // points at the "primary" (highest-slotId) active entry — or a reset
    // default when none — so existing status/test consumers that read the
    // singular shape (getStatus().colorWash, ctrl.colorWashConfig) keep
    // working. The library still flags colorWash `singleton:true`; that flag
    // now scopes the SCHEDULER (one scheduled task per effect), NOT the
    // controller's runtime instance count (scheduled_tasks.js left as-is).
    this.colorWashes = new Map();
    this.colorWashConfig = this._makeColorWashDefault();

    // Feedback trails — lazy-allocated when first enabled.
    this.feedbackTrailsConfig = {
      enabled: false,
      preset: null,
      params: null,
      slotId: null,
      fadingOut: false,
      fadeStartMs: 0,
      fadeDurationMs: 0,
      fadeStartMix: 0,
    };
    this.feedbackTrailBuffer = null;
    this.feedbackTrailPixelCount = 0;

    // Group fixed colors (docs/32). Per-group color locks set from the
    // CaptainPad Dimmer Rack. Presence in the table === active — no
    // separate `enabled` flag (the summer-camp djLights hack kept one
    // and the apply path ignored it, leaving the lights stuck on).
    // Shape: { [groupName]: { color: number[6], brightness: 0..1 } }.
    // PERSISTENT rig state (globals_state.yaml), like the dimmers —
    // intentionally NOT cleared by panicStop().
    this.groupFixedColors = {};

    // NOTE (2026-07, operator decision): the GLOBAL Hue Shifter that used
    // to live here (hueShift {degrees, autoRotateDegPerSec} + setHueShift +
    // per-frame applyHueShift) was REMOVED end to end. Hue is PER-CHANNEL
    // ONLY now: PatternChannel.hue, applied via applyHueShift6chU8 in
    // pattern_mixer.js. A persisted globals_state.yaml `hueShift` key is
    // discarded (with a log line) at load — see StateManager.loadGlobalsState.

    // ── Global color Invert (docs/39 §F-invert) ──────────────────────
    // A first-class boolean toggle (like blackout), NOT a GEM slot/preset.
    // When enabled, inverts the RGB of the WHOLE post-mixer buffer (1 - v);
    // W/A/UV are never touched (see effects/invert.js header — mission-
    // critical exterior whites must never be flipped dark). PERSISTENT rig
    // state (globals_state.yaml). Like groupFixedColors, it is
    // intentionally NOT cleared by panicStop() (panic kills active
    // animation/flash; invert is a static chroma op, not a brightness/flash
    // hazard, and blackout still zeroes the output so safety is unaffected).
    this.invert = false;

    // ── Wave-1 party effects (report 20260708_2) ──────────────────────
    // All three consume the read-only `signals` bag assembled in
    // engine.js and passed into applyMacros(). When the Audio Companion
    // is off the audio signals read 0, so every audio-reactive path here
    // is inert (no fallback flashing) rather than crashing — see the
    // signals guards in engine.js.

    // E1 Beat Pump — BPM-locked luminance duck at the END of applyMacros.
    // panicStop clears it (it is animation).
    this.beatPump = {
      enabled: false,
      depth: 0.5,   // 0..1 dip depth
      rate: 1,      // beats-per-pump multiplier (0.5 half-time, 2 double)
      curve: 2,     // recovery shaping exponent
    };

    // E2 Waterline Sweep — a spatial band across nx/ny/nz. Runs after
    // colorWash, before feedbackTrails (so trails give it a comet tail).
    // The head position self-clocks off nowMs (free-run) or tempo when
    // synced; we accumulate phase so a tempo change doesn't jump the head.
    // panicStop clears it (animation).
    this.sweep = {
      enabled: false,
      axis: 'y',        // 'x'|'y'|'z'|'radial'
      width: 0.25,      // band half-width
      amount: 0.7,      // 0..1 strength
      mode: 'add',      // 'add'|'darken'
      color: [0.15, 0.5, 1.0, 0.0, 0.0, 0.0], // RGBWAU (u=0: UV opt-in)
      speedHz: 0.25,    // free-run sweeps per second
      sync: 'free',     // 'free'|'beat'|'bar'
    };
    this._sweepHead = 0;      // accumulated 0..1 head position
    this._sweepLastMs = 0;    // last nowMs seen (for delta integration)

    // MOVEMENT Trace - a pattern that travels along each GROUP, keyed on the
    // pixel's ordinal inside that group rather than on world coordinates. It
    // places the operator's palette; it never invents colour. Runs at step 0.5
    // (after Freeze, before Color Wash) so everything downstream - trails,
    // sparkle, strobe, pump - layers on top of the moving pattern.
    // panicStop clears it (animation).
    this.movement = {
      enabled: false,
      mode: 'one_per_color',   // 'every_other'|'one_per_color'
      travel: 'repeat',        // 'repeat' (wrap) | 'reverse' (ping-pong)
      colors: [[1, 0, 0, 0, 0, 0]], // palette, 6-channel entries
      amount: 1,               // 0..1 blend over what is already there
      blank: true,             // every_other: dark gaps, not a second colour
      pixelsPerBeat: 1,        // tempo-synced travel speed
      pixelsPerSecond: 6,      // free-run travel speed
      fadeSpan: 1,             // 0 hard cut, 1 crossfade the whole step
      // PULSE envelope (mode 'pulse'): a short burst at full, then a long
      // fall to `floor`. floor is deliberately NOT zero - "almost out" leaves
      // the ship visible between pulses instead of blacking it out, which on
      // an art piece at night is the difference between breathing and flicker.
      burstMs: 200,
      decayMs: 5000,
      floor: 0.04,
      switchMs: 800,           // crossfade when the PATTERN itself changes
      sync: 'beat',            // 'beat'|'free'
    };
    this._movementPhase = 0;   // accumulated travel position, in pixels
    this._movementDir = 1;     // +1 / -1, flipped by 'reverse' at the ends
    this._movementLastMs = 0;  // last nowMs seen (for delta integration)
    // Crossfade state for a change of PATTERN (not of step). Switching from
    // "all five at once" to "one colour at a time" swapped the whole picture on
    // one frame - the harshest cut the effect could make, and the fade bar had
    // nothing to do with it. `_movementPrev` holds the outgoing pattern and
    // `_movementSwitchT` walks 0 -> 1 across switchMs.
    this._movementPrev = null;
    this._movementSwitchT = 1;
    // COLOUR FADE BUFFER. A change of PALETTE is not a change of pattern, and
    // blending two whole patterns to move one colour is both wasteful and
    // jumpy. This holds the palette actually ON SCREEN and eases it toward the
    // requested one, so a scheme change or a wheel move arrives as a fade.
    // Crucially it is snapshotted from the RENDERED colours, not the config -
    // interrupt a fade half way and the next one starts from what the eye is
    // looking at instead of snapping back to where the last one began.
    this._movementColorFrom = null;
    this._movementColorT = 1;
    // Accumulated position inside the pulse cycle, in ms. Accumulated rather
    // than derived from the wall clock so changing the timings mid-show moves
    // the envelope on from where it is instead of jumping.
    this._pulseMs = 0;

    // E3 Kick Punch — controller-level trigger router. Reuses dropHit.
    // panic stops pending dropHits already; the router flag is also
    // cleared by panicStop so it stops firing.
    this.kickRouter = {
      enabled: false,
      threshold: 0.6,   // fire when kick signal > threshold
      minGapMs: 120,    // rate limit between fires
      source: 'auto',   // 'auto' (dropPulse→kick), 'dropPulse', 'kick'
      intensityFloor: 0.6,
      intensityCeil: 1.0,
      preset: null,     // dropHit params to fire (color6/AHR/blend)
      presetId: null,   // library preset id (punch|ice_punch) for preset-aware active check
      slotId: null,
    };
    this._kickLastFireMs = -Infinity;

    // ── Wave-2 party effects (report 20260708_3 / GEM-wired 20260708_7) ─
    // E4/E6/E9/E10 are Builder B's standalone modules, now assignable to
    // GEM slots. Each carries its runtime config here; the two stateful
    // ones (freeze, sparkle) also own an explicit module-state holder. The
    // apply calls run at their documented chain anchors via the extra-stage
    // registrations below.

    // E4 Freeze Frame — captures + replays the frame. FIRST in applyMacros
    // (preWash) so wash/sweep/strobe still animate on the frozen base.
    // panicStop kills it (releases the freeze; next engage re-captures).
    /* Group scope for the WHOLE effect chain. null = unrestricted (the shipped
       behaviour). See setEffectGroups(). */
    this.effectGroups = null;

    /* Parked (locked) groups - exempt from the grand master. See
       setParkedGroups(). null = nothing parked. */
    this.parkedGroups = null;

    this.freeze = { active: false, holdFadeMs: 0, presetId: null, slotId: null };
    this._freezeState = freezeFrameEffect.createState();

    // E6 Palette Crush — RGB posterize. Chroma stage AFTER invert
    // (postInvert), so a crushed image inverts crisply. panicStop PRESERVES
    // it (static chroma, like invert — no flash/brightness hazard).
    this.crush = { enabled: false, levels: 4, amount: 1, presetId: null, slotId: null };

    // E9 Ocean Breath — slow ambient swell. END of applyMacros (gate family)
    // so dimmers/blackout still cap it. Self-clocked off nowMs. panicStop
    // PRESERVES it (slow ambient, no flash hazard — report-3 recommendation).
    this.breath = {
      enabled: false, periodMs: 8000, depth: 0.4, warmth: 0.2,
      presetId: null, slotId: null,
    };

    // E10 Frost Sparkle — W-channel glint overlay AFTER trails (postTrails)
    // so glints stay crisp. Optional audio density off signals.micHigh.
    // panicStop kills it AND clears the field (glints must not linger).
    this.sparkle = {
      enabled: false, density: 0.02, decayMs: 200, intensity: 1,
      audioDensity: false, presetId: null, slotId: null,
    };
    this._sparkleState = frostSparkleEffect.createState();

    // Strobe beat phase-lock (report Table 1 strobe fix): when the active
    // strobe config opts in (config.phaseLock), the ON frame lands on the
    // downbeat via signals.audioBarPhase instead of free-running.
    // Computed per-frame in applyMacros; stored so getGate can read it.

    // ── Extensible post-mixer effect chain (report §"extensible") ─────
    // Wave-1 wires E1/E2/E3 inline in applyMacros at their documented
    // stage positions. Builder B's later modules (E4/E6/E9/E10) slot in
    // via this ordered stage list WITHOUT restructuring applyMacros: the
    // coordinator registers a stage with registerChainStage(name, at, fn)
    // and it runs at the named insertion point. Each stage fn receives
    // ({ pixels, frameIndex, nowMs, signals }) and gates itself (zero cost
    // when its effect is off). See registerChainStage() below for the
    // ordered anchor list.
    this._extraStages = {
      preWash: [],       // step 0 — before colorWash (E4 Freeze Frame)
      postWash: [],      // step 1.5 — after wash, before sweep/trails
      postTrails: [],    // after trails, before dropHit (E10 Frost Sparkle)
      postInvert: [],    // chroma stage after invert (E6 Palette Crush) — see engine.js
      end: [],           // END of applyMacros, beside pump (E7/E9)
    };

    // ── Register Builder B's party effects at their chain anchors ──────
    // (report 20260708_3 wiring spec / 20260708_7 GEM wiring). Each stage
    // gates itself (zero cost when its effect is off), mirroring the inline
    // E1/E2/E3 stages. E6 registers on 'postInvert', which engine.js runs
    // via applyPostInvert() right after applyInvert — so a crushed frame
    // inverts crisply.

    // E4 Freeze Frame — preWash (step 0). The freeze call is a cheap no-op
    // when inactive (early-returns + clears the prior capture), so no outer
    // gate is required, but we keep the symmetry guard for clarity.
    // ── SPATIAL PAINT: the operator draws on a top-down map of the hull ─────
    //
    // Lives HERE, above the pattern layer, because the operator's requirement is
    // that drawing works on EVERY pattern. The same idea exists as pattern
    // 130_spatial_paint riding that pattern's own sliders, which is dead on all
    // other patterns and dies mid-show when the autopilot cycles the deck.
    //
    // Runs at 'end' — after the deck, the wash, the sweep and the trails — so
    // the stroke sits ON TOP of whatever show is running rather than being
    // smeared by the effects downstream of it.
    this.spatial = {
      enabled: false,
      targetX: 0.5, targetY: 0.5,
      // A BRUSH, NOT A WASH. 0.22 in nx/nz covers roughly half the hull, and
      // the panel never sends a radius, so that default was what every operator
      // actually got: one touch lit most of the ship and TRAIL filled the rest
      // within a drag, leaving no edge to read the gesture by. Captured from
      // the sim this session — it looked like a global tint, not like drawing.
      radius: 0.10,
      // Per-axis radius so the brush is ROUND ON THE PAD (see spatial_paint.js).
      radiusY: 0.10,
      amount: 0.9,
      touch: false,
      // Active owner-scoped fingers. Empty keeps the legacy single-target API
      // byte-compatible; a populated array carries independent sweep origins.
      strokes: [],
      mode: 'trail',
      fadeSeconds: 0.5,
      axisX: 'nx', axisY: 'nz',
      pixelIndices: null,
      color: [1, 1, 1, 0, 0, 0],
      // The CONTRASTING colour (opposite hue), sent by the panel alongside the
      // ink. POOL paints in it and IGNITE lifts the hull in it, so neither can
      // land invisibly on a hull already painted the operator's own colour.
      colorAlt: [1, 1, 1, 0, 0, 0],
      slotId: null, presetId: null,
    };
    // Allocated on first use and re-allocated if the model changes size — the
    // pixel count is not known at construction.
    this._spatialHeat = null;
    this._spatialInk = null;
    this._spatialEnergy = 0;
    this._spatialLastMs = 0;
    this._spatialPixelMask = null;
    // TOUCH STALENESS DEADMAN (audit C1). While drawing, the panel re-sends
    // touch:true every ~33 ms; if those writes stop with touch stuck true (a
    // panel that died mid-stroke), the brush would keep painting — or worse,
    // ERASING — the same spot every frame FOREVER, and revertToAutomaticShow
    // could not undo it because the erase re-applies each frame on top of the
    // restored show. So the stage lifts a touch that has gone quiet. 10 s is
    // unambiguous death, not a slow stroke (300× the drawing interval).
    // A property, not a const, so tests can shrink the window.
    this.spatialTouchStaleMs = 10_000;
    this._spatialTouchSeenMs = null;   // frame-clock stamp of the last touch write
    // Where the brush was when it was last painted, so the stroke can be swept
    // from there to the current target instead of teleporting. null = no prior
    // point (stroke start), which paints a plain disc.
    this._spatialPrevX = null;
    this._spatialPrevY = null;

    /* NOT a chain stage — engine.js calls this AFTER applyGroupFixedColors.

       It was registered on the 'end' anchor inside applyMacros, which put it
       before the operator's group paint, and paint repaints its groups wholesale
       AFTER the whole chain (engine.js, "POST-PAINT ... the ones no effect may
       touch"). MEASURED: with a red stroke lifting the rig's red from 1893 to
       10345 (peak byte 255), painting all 24 groups dropped it to exactly 0 —
       the stroke was erased completely. That is the operator painting groups
       from the colour slots and then drawing, and seeing nothing happen, which
       is precisely the reported "spatial mode does not work".

       The stroke is a LIVE OPERATOR GESTURE, not part of the show, so it is the
       last colour word — but only over colour. The grand master, the parked-group
       exception, the section dimmers and blackout all still run after it, so
       every safety cutoff keeps the final say. */
    this.applySpatialStage = ({ pixels, nowMs }) => {
      const sp = this.spatial;
      if (!sp.enabled) return;                       // zero cost when off
      if (!Array.isArray(pixels) || pixels.length === 0) return;
      // TOUCH STALENESS (audit C1): a touch nobody has refreshed inside the
      // window is a dead panel's finger, not a slow stroke — lift it, loudly.
      // The stamp is lazy (first stage pass after the write) so the whole
      // check lives in the frame clock the stage is already handed.
      if (sp.touch) {
        if (this._spatialTouchSeenMs === null) {
          this._spatialTouchSeenMs = nowMs;
        } else if (nowMs - this._spatialTouchSeenMs > this.spatialTouchStaleMs) {
          sp.touch = false;
          sp.strokes = [];
          this._spatialTouchSeenMs = null;
          console.warn(`  ⚠ [spatial] touch went stale (no write for ${this.spatialTouchStaleMs} ms) — ` +
            'lifting the brush; a dead panel must not keep painting the ship');
        }
      } else {
        this._spatialTouchSeenMs = null;
      }
      if (!this._spatialHeat || this._spatialHeat.length < pixels.length) {
        this._spatialHeat = new Float32Array(pixels.length);
      }
      // Per-pixel painted colour (r,g,b), so a stroke that walks the palette
      // leaves BANDS on the hull instead of recolouring the whole trail.
      if (!this._spatialInk || this._spatialInk.length < pixels.length * 3) {
        this._spatialInk = new Float32Array(pixels.length * 3);
      }
      // WALL-CLOCK decay, not per-frame: a stroke must linger for the number of
      // seconds it was asked for whatever the frame rate or speed multiplier is.
      let dt = this._spatialLastMs === 0 ? 0 : (nowMs - this._spatialLastMs) / 1000;
      if (dt < 0) dt = 0;
      this._spatialLastMs = nowMs;
      const fadeStep = dt / sp.fadeSeconds;

      this._spatialEnergy = applySpatialPaint({
        pixels, heat: this._spatialHeat, ink: this._spatialInk,
        targetX: sp.targetX, targetY: sp.targetY,
        prevX: this._spatialPrevX, prevY: this._spatialPrevY,
        strokes: sp.strokes.length ? sp.strokes : undefined,
        radius: sp.radius, radiusY: sp.radiusY, amount: sp.amount,
        touch: sp.touch, mode: sp.mode, color6: sp.color, colorAlt: sp.colorAlt,
        fadeStep, axisX: sp.axisX, axisY: sp.axisY, pixelMask: this._spatialPixelMask,
      });
      // Only a PAINTING brush leaves a trail to sweep from. While lifted, the
      // segment must collapse, or the next touch-down would draw a line across
      // the hull from wherever the last stroke ended.
      if (sp.touch && sp.strokes.length === 0) {
        this._spatialPrevX = sp.targetX; this._spatialPrevY = sp.targetY;
      }
      else { this._spatialPrevX = null; this._spatialPrevY = null; }

      // IGNITE lifts the WHOLE hull with the stroke and lets it fall as the
      // trail cools. Applied after the per-pixel pass because it needs the mean
      // heat that pass just computed.
      if (sp.mode === 'ignite') {
        // CONTRASTING colour for the hull lift — operator ruling. Swelling the
        // ship in the colour it already wears reads as "slightly brighter",
        // not as a swell.
        applySpatialIgnite({
          pixels, energy: Math.min(1, this._spatialEnergy * 6),
          color6: sp.colorAlt, amount: sp.amount,
        });
      }
    };

    this.registerChainStage('preWash', ({ pixels, nowMs }) => {
      freezeFrameEffect.apply({
        pixels, state: this._freezeState,
        active: this.freeze.active, nowMs,
        // primaryIntensity: 'Hold Fade' (holdFadeMs)
        holdFadeMs: this.audioDrivenPrimary(this.freeze.slotId, this.freeze.holdFadeMs),
      });
    });

    // E10 Frost Sparkle — postTrails (after trails, before dropHit).
    this.registerChainStage('postTrails', ({ pixels, nowMs, signals }) => {
      if (!this.sparkle.enabled) return; // zero cost when off
      frostSparkleEffect.apply({
        pixels, state: this._sparkleState, enabled: true, nowMs,
        // primaryIntensity: 'Sparkle Density' (density)
        density: this.audioDrivenPrimary(this.sparkle.slotId, this.sparkle.density),
        decayMs: this.sparkle.decayMs,
        intensity: this.sparkle.intensity,
        audioDensity: this.sparkle.audioDensity,
        signals, // report-3 signals bag; may be undefined — module is safe
      });
    });

    // E6 Palette Crush — postInvert (chroma stage after invert).
    this.registerChainStage('postInvert', ({ pixels }) => {
      if (!this.crush.enabled) return; // zero cost when off
      paletteCrushEffect.apply({
        pixels, levels: this.crush.levels,
        // primaryIntensity: 'Crush' (amount)
        amount: this.audioDrivenPrimary(this.crush.slotId, this.crush.amount),
      });
    });

    // E9 Ocean Breath — END of applyMacros (gate family).
    this.registerChainStage('end', ({ pixels, nowMs, signals }) => {
      if (!this.breath.enabled) return; // zero cost when off
      // A tempo-bound breath swells on the music's PHRASING instead of having
      // its depth ridden. Four bars, not one: a breath that turns around every
      // bar is a wobble, and 16 beats at 120 bpm is 8000 ms — exactly the
      // free-run default, so locking it changes the clock, not the character.
      const bpm = signals && typeof signals.bpm === 'number' && signals.bpm > 0
        ? signals.bpm : 120;
      const periodMs = this.tempoSyncFor(
        this.breath.slotId, (16 * 60000) / bpm, this.breath.periodMs);
      oceanBreathEffect.apply({
        pixels, nowMs,
        periodMs, warmth: this.breath.warmth,
        // primaryIntensity: 'Breath Depth' (depth)
        depth: this.audioDrivenPrimary(this.breath.slotId, this.breath.depth),
      });
    });
  }

  // ── Legacy methods ────────────────────────────────────────────────
  setEffect(effectName, state) {
    // Codex P0: a typo in effectName must not silently no-op. Pre-fix
    // any `setEffect('horm', true)` (or similar) returned without
    // touching state, hiding the bug. Now: throw with a useful
    // message; callers (slot dispatcher, scheduler, /effect endpoint)
    // already surface to the operator.
    const known = this.effects.hasOwnProperty(effectName) || effectName.includes('Bypass');
    if (!known) {
      throw new Error(`setEffect: unknown effect '${effectName}'`);
    }
    this.effects[effectName] = !!state;
  }

  initFromModel(effectsArray) {
    this.foggers = [];
    this.horns = [];
    this.fires = [];
    if (!effectsArray) return;
    for (let i = 0; i < effectsArray.length; i++) {
      const fx = effectsArray[i];
      if (!fx.patch || !fx.patch.universe || !fx.patch.addr) continue;
      const patchInfo = {
        fixtureType: fx.fixtureType || fx.type,
        universe: fx.patch.universe,
        address: fx.patch.addr,
        kind: fx.kind || '',
      };
      if (patchInfo.kind === 'fog' || patchInfo.kind === 'haze' ||
        (patchInfo.fixtureType && (patchInfo.fixtureType.includes('Fog') || patchInfo.fixtureType === 'ChauvetHaze4D'))) {
        this.foggers.push(patchInfo);
      } else if (patchInfo.kind === 'horn' || (patchInfo.fixtureType && patchInfo.fixtureType.includes('Horn'))) {
        this.horns.push(patchInfo);
      } else if (patchInfo.kind === 'fire' || (patchInfo.fixtureType && patchInfo.fixtureType.includes('Fire'))) {
        this.fires.push(patchInfo);
      }
    }
  }

  applyPixels(pixels) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      px.ignoreDimmerForRGB = false;
      px.ignoreDimmerForW = false;
      px.ignoreDimmerForA = false;
      px.ignoreDimmerForU = false;

      if (this.effects.vintageWhite) {
        if (px.fixtureType === 'VintageLed' && px.name && px.name.includes('head_') && px.channels && px.channels.w !== undefined) {
          px.w = 1.0;
          if (this.effects.vintageWhiteBypassDimmer) px.ignoreDimmerForW = true;
        }
      }
      if (this.effects.uvBlast && px.channels && px.channels.u !== undefined) {
        px.u = 1.0;
        if (this.effects.uvBlastBypassDimmer) px.ignoreDimmerForU = true;
      }
      if (this.effects.blastWhite) {
        if (px.channels) {
          px.r = 1.0; px.g = 1.0; px.b = 1.0;
          if (px.channels.w !== undefined) px.w = 1.0;
          if (px.channels.a !== undefined) px.a = 1.0;
          if (this.effects.blastWhiteBypassDimmer) {
            px.ignoreDimmerForRGB = true;
            px.ignoreDimmerForW = true;
            px.ignoreDimmerForA = true;
          }
        }
      }
    }
  }

  applyDmx(dmxBuffers, { blackout = false } = {}) {
    // Hard e-stop: when blackout is set we force every DMX-only
    // fixture (fogger, horn, fire) OFF so the rig truly goes silent.
    // Without this the IntensityController would zero the pixel
    // buffer but the fogger/horn DMX writes here would still fire.
    const foggerActive = !blackout && this.effects.fogger;
    const hornActive   = !blackout && this.effects.horn;
    const fireActive   = !blackout && this.effects.fire;
    for (const fogger of this.foggers) {
      const frame = dmxBuffers[fogger.universe];
      if (!frame) continue;
      const isChauvet = fogger.fixtureType === 'ChauvetHaze4D';
      if (foggerActive) {
        if (isChauvet) { frame[fogger.address - 1] = 255; frame[fogger.address] = 255; }
        else { frame[fogger.address - 1] = 255; }
      } else {
        if (isChauvet) { frame[fogger.address - 1] = 0; frame[fogger.address] = 0; }
        else { frame[fogger.address - 1] = 0; }
      }
    }
    for (const horn of this.horns) {
      const frame = dmxBuffers[horn.universe];
      if (!frame) continue;
      frame[horn.address - 1] = hornActive ? 255 : 0;
    }
    for (const fire of this.fires) {
      const frame = dmxBuffers[fire.universe];
      if (!frame) continue;
      frame[fire.address - 1] = fireActive ? 255 : 0;
    }
  }

  // ── NEW Global Effect Macros ──────────────────────────────────────

  /**
   * Per-frame entry point for the new macros. Called by engine.js
   * BEFORE intensity / blackout / sACN encoding (pipeline §2.2).
   *
   * @param {object} args
   * @param {Array}  args.pixels      Post-mixer model.pixels.
   * @param {number} args.frameIndex  Monotonic frame counter.
   * @param {number} args.nowMs       performance.now() in ms.
   * @param {object} [args.signals]   Read-only tempo/audio bag assembled
   *   in engine.js (see engine.js tick()). OPTIONAL: defaults to an empty
   *   object so pre-existing callers and unit tests are untouched. All
   *   audio fields default to 0 with `audioPresent:false` when the Audio
   *   Companion is off, so audio-reactive stages are inert (never throw,
   *   never fall back to flashing).
   */
  applyMacros({ pixels, frameIndex, nowMs, signals = {} }) {
    // Ordered post-mixer chain (report 20260708_2 Table 2 insertion pts):
    //   step 0    preWash extra stages        (E4 Freeze Frame)
    //   0.5       Movement Trace (per-group travelling pattern)
    //   1.        Color Wash
    //   1.5       E2 Waterline Sweep + postWash extras
    //   2.        Feedback Trails (captures wash+sweep → comet tails)
    //   2.5       postTrails extras            (E10 Frost Sparkle)
    //   3.        E3 Kick router → Drop Hit envelopes
    //   4.        Strobe (ON/OFF gate)
    //   END       E1 Beat Pump + end extras    (E7 Bar Chase, E9 Breath)
    // Each stage gates itself → zero cost when its effect is off. The
    // extra-stage arrays let the coordinator slot Builder B's modules in
    // at their documented anchors without editing this method.
    const ctx = { pixels, frameIndex, nowMs, signals };

    this._runExtraStages('preWash', ctx);
    this._applyMovementTraceStage(ctx);
    this._applyColorWashStage(ctx);
    this._applyWaterlineSweepStage(ctx);
    this._runExtraStages('postWash', ctx);
    this._applyFeedbackTrailsStage(ctx);
    this._runExtraStages('postTrails', ctx);
    this._applyDropHitRouterStage(ctx);
    this._applyDropHitStage(ctx);
    this._applyStrobeStage(ctx);
    this._applyBeatPumpStage(ctx);
    this._runExtraStages('end', ctx);
  }

  /**
   * Register an extra chain stage at a named anchor so Builder B's later
   * effects (E4/E6/E9/E10) slot into applyMacros without restructuring.
   *
   * @param {string}   anchor  One of: 'preWash' | 'postWash' | 'postTrails'
   *                           | 'postInvert' | 'end'. 'postInvert' runs in
   *                           engine.js after applyInvert (see applyPostInvert).
   * @param {Function} fn      ({ pixels, frameIndex, nowMs, signals }) => void.
   *                           MUST gate itself (return early when off).
   */
  registerChainStage(anchor, fn) {
    if (!Object.prototype.hasOwnProperty.call(this._extraStages, anchor)) {
      throw new Error(`registerChainStage: unknown anchor '${anchor}'`);
    }
    if (typeof fn !== 'function') {
      throw new Error('registerChainStage: fn must be a function');
    }
    this._extraStages[anchor].push(fn);
  }

  _runExtraStages(anchor, ctx) {
    const stages = this._extraStages[anchor];
    for (let i = 0; i < stages.length; i++) {
      stages[i](ctx);
    }
  }

  /**
   * Chroma stage anchor run by engine.js AFTER applyInvert (so a crushed
   * image inverts crisply — report §interactions E6). Builder B's E6
   * Palette Crush registers on 'postInvert'; engine.js calls this right
   * after applyInvert.
   */
  applyPostInvert({ pixels, frameIndex, nowMs, signals = {} }) {
    this._runExtraStages('postInvert', { pixels, frameIndex, nowMs, signals });
  }

  // ── Chain stages (each self-gates: zero cost when its effect is off) ──

  _applyColorWashStage({ pixels, nowMs }) {
    if (this.colorWashes.size === 0) return;
    // Deterministic render order: ascending slotId. Slotless entries (slotId
    // null → sort key -1) render FIRST; higher slotIds render LAST. For the
    // 'replace'/'tint' blend that means the LATER (higher-slotId) wash WINS
    // where two washes overlap the same pixel, because it composites over the
    // earlier ones. 'multiply'/'max' compose order-independently. Each entry
    // runs its OWN fadeOut; finished fades are deleted after the sweep.
    const entries = [...this.colorWashes.values()].sort(
      (a, b) => (a.slotId ?? -1) - (b.slotId ?? -1),
    );
    let finished = null;
    for (let i = 0; i < entries.length; i++) {
      const w = entries[i];
      if (!(w.enabled || w.fadingOut) || !w.color) continue;
      let amount = w.amount;
      if (w.fadingOut) {
        const elapsed = nowMs - w.fadeStartMs;
        if (elapsed >= w.fadeDurationMs) {
          (finished || (finished = [])).push(w.key);
          continue;
        }
        amount = w.fadeStartAmount * (1 - elapsed / w.fadeDurationMs);
      }
      // primaryIntensity: 'Wash Depth' (amount)
      const washAmount = this.audioDrivenPrimary(w.slotId, amount);
      if (washAmount > 0 && w.color) {
        colorWashEffect.apply({ pixels, color6: w.color, amount: washAmount, mode: w.mode });
      }
    }
    if (finished) {
      for (let i = 0; i < finished.length; i++) this.colorWashes.delete(finished[i]);
      this._syncColorWashCompat();
    }
  }

  /**
   * E2 Waterline Sweep (report Table 2). Runs at step 1.5 — after wash,
   * before trails, so trails give the band a comet tail. Self-clocks the
   * head off nowMs (free-run) or the beat/bar grid when tempo-synced;
   * phase is accumulated so a tempo change never jumps the head.
   */
  _applyWaterlineSweepStage({ pixels, nowMs, signals }) {
    const s = this.sweep;
    if (!s.enabled) return; // zero cost when off

    // Advance the head. dt from the last frame we saw (guard the first
    // frame / a clock reset so a huge dt can't warp the head).
    let dt = this._sweepLastMs === 0 ? 0 : (nowMs - this._sweepLastMs) / 1000;
    if (dt < 0 || dt > 1) dt = 0;
    this._sweepLastMs = nowMs;

    // Binding a tempo signal to this slot means "sweep IN TIME", not "make the
    // sweep deeper on the beat". One pass per bar reads as a sweep that belongs
    // to the music; per beat is frantic on a ship this long.
    const sync = this.tempoSyncFor(s.slotId, 'bar', s.sync);
    if (sync === 'beat' || sync === 'bar') {
      // Tempo-sync: one full sweep per beat (or per bar). Use the derived
      // beatPhase / barPhase directly so the head tracks the grid. When
      // audio is absent beatPhase falls back to the tempo clock (assembled
      // in engine.js), so a synced sweep still runs steadily.
      const phase = sync === 'bar'
        ? (typeof signals.barPhase === 'number' ? signals.barPhase : signals.beatPhase || 0)
        : (signals.beatPhase || 0);
      this._sweepHead = phase - Math.floor(phase);
    } else {
      // Free-run: integrate speedHz.
      this._sweepHead = (this._sweepHead + dt * s.speedHz) % 1;
      if (this._sweepHead < 0) this._sweepHead += 1;
    }

    waterlineSweepEffect.apply({
      pixels,
      head: this._sweepHead,
      width: s.width,
      // primaryIntensity: 'Sweep Depth' (amount)
      amount: this.audioDrivenPrimary(s.slotId, s.amount),
      axis: s.axis,
      mode: s.mode,
      color6: s.color,
    });
  }

  /**
   * MOVEMENT Trace. Runs at step 0.5 - after Freeze, before Color Wash - so
   * the travelling pattern is laid down first and every downstream stage
   * (trails, sparkle, strobe, pump) treats it as the picture to work on.
   *
   * This stage owns TRAVEL; the effect module owns the pattern. Advancing the
   * phase here is what makes 'repeat' and 'reverse' share one piece of maths:
   *
   *   repeat   phase climbs forever. The effect wraps it per group, so a
   *            90-pixel wall and an 8-pixel row of pars each wrap at their
   *            own length off the same clock.
   *   reverse  direction flips at the ends, so the pattern runs to the end of
   *            the strand and walks back. The turn happens against the
   *            LONGEST group, so every group turns together instead of each
   *            reversing at its own end - the whole ship changes direction at
   *            once, which is the point of reverse.
   *
   * Phase is accumulated (never recomputed from the clock), so a tempo change
   * or a re-enable moves the pattern on from where it is instead of jumping.
   */
  _applyMovementTraceStage({ pixels, nowMs, signals }) {
    const m = this.movement;
    if (!m.enabled) return; // zero cost when off

    const { index, size, groupId } = groupIndicesFor(pixels);

    // The slot's audio gain scales how strongly this pattern is laid down, so
    // binding a signal to this button makes the pattern ride the music instead
    // of running flat. Unbound slots return 1 and nothing changes.
    const aGain = this.audioGainForSlot(m.slotId);

    let dt = this._movementLastMs === 0 ? 0 : (nowMs - this._movementLastMs) / 1000;
    if (dt < 0 || dt > 1) dt = 0;   // first frame / clock reset: do not warp
    this._movementLastMs = nowMs;

    // Advance the COLOUR fade (needs dt, so it lives below the clock) and
    // resolve the palette actually shown this frame.
    if (this._movementColorT < 1 && this._movementColorFrom) {
      const cms = m.switchMs > 0 ? m.switchMs : 1;
      this._movementColorT = Math.min(1, this._movementColorT + (dt * 1000) / cms);
    }
    const shownColors = this._resolveMovementColors();

    /* PULSE ENVELOPE. Burst at full for burstMs, then fall to `floor` across
       decayMs, then start again. The fall is shaped (cubic) rather than linear
       because a linear ramp reads as a mechanical wipe - a light dying away
       loses most of its brightness early and lingers at the bottom. */
    let pulseLevel = 1;
    if (m.mode === 'pulse') {
      const burst = m.burstMs > 0 ? m.burstMs : 1;
      const decay = m.decayMs > 0 ? m.decayMs : 1;
      const cycle = burst + decay;
      this._pulseMs = (this._pulseMs + dt * 1000) % cycle;
      if (this._pulseMs < burst) {
        pulseLevel = 1;
      } else {
        const k = (this._pulseMs - burst) / decay;      // 0..1 through the fall
        const fall = (1 - k) * (1 - k) * (1 - k);
        pulseLevel = m.floor + (1 - m.floor) * fall;
      }
    }

    // Pixels travelled this frame. Tempo-synced uses the same derived
    // beatsPerSecond the rest of the chain runs on, so movement stays locked
    // to the music; free-run integrates its own speed.
    let advance;
    // A tempo-bound slot TRAVELS on the beat rather than having its Trace
    // Amount ridden up and down by the beat envelope.
    if (this.tempoSyncFor(m.slotId, 'beat', m.sync) === 'beat') {
      const bpm = typeof signals.bpm === 'number' && signals.bpm > 0 ? signals.bpm : 120;
      advance = dt * (bpm / 60) * m.pixelsPerBeat;
    } else {
      advance = dt * m.pixelsPerSecond;
    }

    this._movementPhase += advance * this._movementDir;

    if (m.travel === 'reverse') {
      let longest = 0;
      for (let i = 0; i < size.length; i++) if (size[i] > longest) longest = size[i];
      if (longest > 1) {
        if (this._movementPhase >= longest) {
          this._movementPhase = longest;
          this._movementDir = -1;
        } else if (this._movementPhase <= 0) {
          this._movementPhase = 0;
          this._movementDir = 1;
        }
      }
    } else {
      this._movementDir = 1;
    }

    // CROSSFADE ON A PATTERN CHANGE. Two passes: the outgoing pattern at full
    // strength, then the incoming one blended over it at `amount * t`. Because
    // the effect blends toward its target, that second pass leaves exactly
    // old*(1-t) + new*t - a true crossfade, not a dissolve to black and back.
    if (this._movementSwitchT < 1 && this._movementPrev) {
      const ms = m.switchMs > 0 ? m.switchMs : 1;
      this._movementSwitchT = Math.min(1, this._movementSwitchT + (dt * 1000) / ms);
      const t = this._movementSwitchT;
      const eased = t * t * (3 - 2 * t);
      const prev = this._movementPrev;
      movementTraceEffect.apply({
        pixels,
        groupIndex: index,
        groupSize: size,
        groupId,
        phase: this._movementPhase,
        mode: prev.mode,
        colors: prev.colors,
        amount: m.amount * aGain,
        blank: prev.blank,
        fadeSpan: prev.fadeSpan,
      });
      movementTraceEffect.apply({
        pixels,
        groupIndex: index,
        groupSize: size,
        groupId,
        phase: this._movementPhase,
        mode: m.mode,
        colors: shownColors,
        level: pulseLevel,
        amount: m.amount * aGain * eased,
        blank: m.blank,
        fadeSpan: m.fadeSpan,
      });
      if (this._movementSwitchT >= 1) this._movementPrev = null;
      return;
    }

    movementTraceEffect.apply({
      pixels,
      groupIndex: index,
      groupSize: size,
      groupId,
      phase: this._movementPhase,
      mode: m.mode,
      colors: shownColors,
      level: pulseLevel,
      amount: m.amount * aGain,
      blank: m.blank,
      fadeSpan: m.fadeSpan,
    });
  }

  /**
   * The palette on screen right now: the requested colours, or a blend between
   * the palette we were showing and the requested one while a fade runs.
   */
  _resolveMovementColors() {
    const want = this.movement.colors;
    const from = this._movementColorFrom;
    if (!from || this._movementColorT >= 1) return want;
    const t = this._movementColorT;
    const e = t * t * (3 - 2 * t);
    const n = Math.max(from.length, want.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = from[i % from.length];
      const b = want[i % want.length];
      const c = new Array(6);
      for (let k = 0; k < 6; k++) c[k] = a[k] + (b[k] - a[k]) * e;
      out[i] = c;
    }
    return out;
  }

  /**
   * MOVEMENT Trace. `enabled` false stops it; true applies the merged params.
   * The phase keeps its place in _applyMovementTraceStage so a re-enable
   * continues the travel rather than snapping back to the end of the strand.
   */
  setMovementTrace(enabled, params = {}, meta = {}) {
    if (!enabled) {
      // REMEMBER WHAT WAS ON SCREEN. The operator surface switches patterns by
      // turning one button OFF and another ON, so the controller sees
      // disable-then-enable, not a change while enabled. Without this snapshot
      // the crossfade never armed on the path that is actually used, and every
      // switch was a hard cut however far up the fade bar was.
      if (this.movement.enabled) {
        this._movementPrev = {
          mode: this.movement.mode,
          travel: this.movement.travel,
          blank: this.movement.blank,
          colors: this.movement.colors.map((c) => [...c]),
          fadeSpan: this.movement.fadeSpan,
        };
      }
      this.movement.enabled = false;
      return;
    }
    if (params.amount !== undefined) this.movement.amount = params.amount;
    if (params.fadeSpan !== undefined) this.movement.fadeSpan = params.fadeSpan;
    if (params.pixelsPerBeat !== undefined) this.movement.pixelsPerBeat = params.pixelsPerBeat;
    if (params.pixelsPerSecond !== undefined) this.movement.pixelsPerSecond = params.pixelsPerSecond;
    if (params.sync !== undefined) this.movement.sync = params.sync;
    if (params.switchMs !== undefined) this.movement.switchMs = params.switchMs;
    // Snapshot BEFORE the new shape lands, and only when the shape actually
    // changes - re-sending the same pattern (a colour push, an intensity nudge)
    // must not restart a crossfade or the rig would never settle.
    // Compare against whatever is ON SCREEN: the running pattern if we are
    // enabled, otherwise the one we were showing when we were switched off.
    const ref = this.movement.enabled ? this.movement : this._movementPrev;
    const shapeChanged = !!ref && (
      (params.mode !== undefined && params.mode !== ref.mode)
      || (params.travel !== undefined && params.travel !== ref.travel)
      || (params.blank !== undefined && !!params.blank !== !!ref.blank)
    );
    if (shapeChanged) {
      if (ref === this.movement) {
        this._movementPrev = {
          mode: this.movement.mode,
          travel: this.movement.travel,
          blank: this.movement.blank,
          colors: this.movement.colors.map((c) => [...c]),
          fadeSpan: this.movement.fadeSpan,
        };
      }
      this._movementSwitchT = 0;
    }
    if (params.mode !== undefined) this.movement.mode = params.mode;
    if (params.travel !== undefined) this.movement.travel = params.travel;
    if (params.blank !== undefined) this.movement.blank = !!params.blank;
    if (params.burstMs !== undefined) this.movement.burstMs = params.burstMs;
    if (params.decayMs !== undefined) this.movement.decayMs = params.decayMs;
    if (params.floor !== undefined) this.movement.floor = params.floor;
    if (params.colors !== undefined) {
      if (!Array.isArray(params.colors) || params.colors.length === 0) {
        throw new Error('setMovementTrace: colors must be a non-empty array of 6-channel arrays');
      }
      const next = params.colors.map((c) => [...c]);
      const differs = next.length !== this.movement.colors.length
        || next.some((c, i) => c.some((v, k) => Math.abs(v - this.movement.colors[i][k]) > 0.002));
      if (differs) {
        // Fade FROM what is on screen (mid-fade included), not from the config.
        this._movementColorFrom = this._resolveMovementColors().map((c) => [...c]);
        this._movementColorT = (this.movement.switchMs > 0) ? 0 : 1;
      }
      this.movement.colors = next;
    }
    this.movement.enabled = true;
    this.movement.presetId = meta.presetId || null;
    this.movement.slotId = meta.slotId || null;
  }

  _applyFeedbackTrailsStage({ pixels, nowMs }) {
    if (this.feedbackTrailsConfig.enabled || this.feedbackTrailsConfig.fadingOut) {
      this._ensureFeedbackBuffer(pixels.length);
      const p = this.feedbackTrailsConfig.params;
      let mix = p.mix;
      let injection = p.injection;
      if (this.feedbackTrailsConfig.fadingOut) {
        const elapsed = nowMs - this.feedbackTrailsConfig.fadeStartMs;
        if (elapsed >= this.feedbackTrailsConfig.fadeDurationMs) {
          this.feedbackTrailsConfig.fadingOut = false;
          this.feedbackTrailsConfig.preset = null;
          this.feedbackTrailsConfig.params = null;
          this.feedbackTrailBuffer = null;
          this.feedbackTrailPixelCount = 0;
          mix = 0;
        } else {
          const ratio = 1 - (elapsed / this.feedbackTrailsConfig.fadeDurationMs);
          mix = this.feedbackTrailsConfig.fadeStartMix * ratio;
          injection = 0; // stop injection during fade out
        }
      }
      // primaryIntensity: 'Trail Mix' (mix)
      mix = this.audioDrivenPrimary(this.feedbackTrailsConfig.slotId, mix);
      if (mix > 0 && this.feedbackTrailBuffer) {
        feedbackTrailsEffect.apply({
          pixels,
          trailBuffer: this.feedbackTrailBuffer,
          decay: p.decay,
          injection,
          mix,
          blendMode: p.blendMode,
          colorBleed: p.colorBleed || 0,
        });
      }
    }
  }

  /**
   * E3 Kick Punch router (report Table 2). Controller-level trigger: when
   * the live kick/onset crosses threshold with a min-gap, fire the EXISTING
   * dropHit envelope. Adds zero per-pixel cost (dropHit does the pixel
   * work). Inert when audio is absent (kick reads 0) or when the router's
   * dropHit preset hasn't been set. Runs BEFORE _applyDropHitStage so a
   * kick fired this frame renders on the same frame.
   */
  _applyDropHitRouterStage({ nowMs, signals }) {
    const r = this.kickRouter;
    if (!r.enabled || !r.preset) return; // zero cost when off / unarmed

    // Source selection: 'auto' prefers the onset-shaped dropPulse, falling
    // back to raw micKick; explicit modes pin one source.
    let sig;
    if (r.source === 'dropPulse') sig = signals.dropPulse || 0;
    else if (r.source === 'kick') sig = signals.kick || 0;
    else sig = (signals.dropPulse || 0) > 0 ? (signals.dropPulse || 0) : (signals.kick || 0);

    if (!kickPunchEffect.shouldFire({
      signalValue: sig,
      threshold: r.threshold,
      nowMs,
      lastFireMs: this._kickLastFireMs,
      minGapMs: r.minGapMs,
    })) return;

    const intensity = kickPunchEffect.intensity({
      signalValue: sig,
      floor: r.intensityFloor,
      // primaryIntensity: 'Punch Strength' (intensityCeil) - a bound signal
      // sets how hard the punch is ALLOWED to land; the kick still decides
      // when it fires.
      ceil: this.audioDrivenPrimary(r.slotId, r.intensityCeil),
    });
    // Fire through the normal poly path (respects DROP_HIT_MAX_POLY cap).
    this.triggerDropHit({ ...r.preset, intensity }, nowMs);
    this._kickLastFireMs = nowMs;
  }

  _applyDropHitStage({ pixels, nowMs }) {
    if (this.dropHits.length > 0) {
      // Walk backwards so we can splice expired envelopes in place.
      for (let i = this.dropHits.length - 1; i >= 0; i--) {
        const e = this.dropHits[i];
        const elapsed = nowMs - e.triggeredAtMs;
        if (elapsed >= e.durationMs) {
          this.dropHits.splice(i, 1);
          continue;
        }
        const env = dropHitEffect.envelopeValue({
          elapsedMs: elapsed,
          attackMs: e.params.attackMs,
          holdMs: e.params.holdMs,
          releaseMs: e.params.releaseMs,
          curve: e.params.curve ?? 1,
        });
        const intensity = e.params.intensity ?? 1.0;
        dropHitEffect.apply({
          pixels,
          color6: e.params.color,
          amount: env * intensity,
          blendMode: e.params.blendMode || 'add',
        });
      }
    }
  }

  _applyStrobeStage({ pixels, frameIndex, nowMs, signals }) {
    if ((this.strobeActive && this.strobeConfig) || this.strobeFadingOut) {
      if (this.strobeActive && this.strobeBurstEndFrame !== null && frameIndex >= this.strobeBurstEndFrame) {
        this.stopStrobe({ nowMs });
      }

      let blend = 1.0;
      if (this.strobeFadingOut) {
        const elapsed = nowMs - this.strobeFadeStartMs;
        if (elapsed >= this.strobeFadeDurationMs) {
          this.strobeFadingOut = false;
          this.strobeConfig = null;
          this.strobeBurstEndFrame = null;
          blend = 0.0;
        } else {
          blend = 1.0 - (elapsed / this.strobeFadeDurationMs);
        }
      }

      if (blend > 0 && this.strobeConfig) {
        // Optional beat phase-lock (report Table 1 strobe fix): when the
        // active config opts in AND audio is present, shift the ON window
        // so it lands on the downbeat via audioBarPhase. Free-runs (offset
        // 0) otherwise, preserving prior behavior exactly.
        let phaseOffsetFrames = 0;
        // A TEMPO-BOUND STROBE LANDS ON THE GRID. Binding tempo to a strobe
        // used to ride Flash Strength — flashes of varying brightness, still
        // free-running against the music. Forcing the phase lock instead makes
        // the flashes land on the downbeat, which is what a strobe is for.
        const tempoLockedStrobe = this.isTempoLocked(this.strobeConfig.slotId);
        const phaseLock = this.strobeConfig.phaseLock || tempoLockedStrobe;
        // A TEMPO LOCK MUST NOT GATE ON audioPresent. That flag is hard-coded
        // false in engine.js (the audio-reactive channels are deliberately not
        // invented there), so requiring it made the tempo-locked strobe DEAD
        // CODE — it could never once fire. barPhase comes from the arbitrated
        // tempo clock, which runs whether or not a live audio feed exists, so a
        // tempo-bound strobe locks on the clock alone. The ORIGINAL opt-in
        // (strobeConfig.phaseLock) keeps its audio condition unchanged.
        const canPhaseLock = tempoLockedStrobe
          ? (typeof signals.bpm === 'number' && signals.bpm > 0)
          : signals.audioPresent;
        if (phaseLock && canPhaseLock) {
          const barPhase = typeof signals.barPhase === 'number' ? signals.barPhase : 0;
          const fpc = this.strobeConfig.framesPerCycle;
          // Align cycle start to the downbeat: negative shift by the frames
          // already elapsed into the beat.
          phaseOffsetFrames = -Math.round(barPhase * fpc);
        }
        const gate = strobeEffect.getGate({
          frameIndex,
          startedAtFrame: this.strobeStartedAtFrame,
          framesPerCycle: this.strobeConfig.framesPerCycle,
          onFrames: this.strobeConfig.onFrames,
          phaseOffsetFrames,
        });

        // apply blended strobe: scale = (gateScale * blend) + 1.0 * (1 - blend)
        // primaryIntensity: 'Flash Strength' (intensity) - audio rides the
        // strength of each flash, it does not gate the strobe on and off.
        const intensity = this.audioDrivenPrimary(
          this.strobeConfig.slotId, this.strobeConfig.intensity ?? 1.0);
        const gateScale = gate > 0 ? intensity : 0.0;
        const scale = gateScale * blend + (1.0 - blend);

        strobeEffect.apply({
          pixels,
          gate: 1, // force gate parameter to 1 since we handle gating scale manually
          intensity: scale,
        });
      }
    }
  }

  /**
   * E1 Beat Pump (report Table 2). END of applyMacros — a soft strobe:
   * the whole rig dips on the beat and swells back. Uses signals.beatPhase
   * (derived in engine.js from tempo + clock, or the audio grid). When
   * audio is absent beatPhase still runs off the tempo clock, so the pump
   * keeps a steady groove (never freezes). Zero cost when off or depth 0.
   */
  _applyBeatPumpStage({ pixels, signals }) {
    const bp = this.beatPump;
    if (!bp.enabled || bp.depth <= 0) return;
    // primaryIntensity: 'Pump Depth' (depth) - the music sets how hard the
    // rig ducks, while the beat grid still decides WHEN it ducks.
    const depth = this.audioDrivenPrimary(bp.slotId, bp.depth);
    if (depth <= 0) return;
    // Phase within a pump cycle: beatPhase scaled by `rate` (0.5 half-time,
    // 2 double-time), wrapped to [0,1).
    const base = typeof signals.beatPhase === 'number' ? signals.beatPhase : 0;
    let p = (base * bp.rate) % 1;
    if (p < 0) p += 1;
    const scale = beatPumpEffect.scale({ beatPhase: p, depth, curve: bp.curve });
    beatPumpEffect.apply({ pixels, scale });
  }

  get dropHitActive() { return this.dropHits.length > 0; }

  // ── Strobe control ────────────────────────────────────────────────
  setStrobe(active, hz, duty, intensity, frameIndex, meta = {}) {
    if (!active) {
      this.stopStrobe({ nowMs: meta.nowMs });
      return;
    }
    const timing = strobeEffect.getTiming({ hz, duty, frameRate: this.frameRate });

    // GLITCH-FREE LIVE RE-APPLY (glitch-fix campaign 2026-07): when a strobe is
    // ALREADY running for THIS slot/preset and the operator tweaks a param mid-
    // flight (Flash Strength jog-wheel → intensity, or Frequency encoder → hz),
    // the change must land WITHOUT restarting the ON/OFF cycle. The pre-fix code
    // hard-reset `strobeStartedAtFrame = frameIndex` on every call, so a live
    // intensity tweak re-anchored the phase and the gate snapped — a visible
    // dark hiccup mid-strobe. Here we detect the in-place case and PRESERVE the
    // phase anchor. For an intensity/duty-only change nothing about the cycle
    // grid moves. For an hz change the cycle LENGTH (framesPerCycle) changes, so
    // we RE-QUANTIZE the anchor: keep the operator's current fractional position
    // within the cycle so the beat alignment carries over rather than blanking.
    const sameRun = this.strobeActive
      && !this.strobeFadingOut
      && this.strobeConfig
      && this.strobeConfig.slotId === (meta.slotId || null)
      && this.strobeConfig.presetId === (meta.presetId || null);

    let anchor = frameIndex;
    if (sameRun) {
      const prevFpc = this.strobeConfig.framesPerCycle;
      const newFpc = timing.framesPerCycle;
      // Where are we in the CURRENT cycle right now (0..prevFpc)?
      const localFrame = Math.max(0, frameIndex - this.strobeStartedAtFrame);
      const prevPhaseFrame = ((localFrame % prevFpc) + prevFpc) % prevFpc;
      if (newFpc === prevFpc) {
        // Same cycle length (intensity/duty tweak): anchor is unchanged so the
        // gate keeps ticking exactly where it was.
        anchor = this.strobeStartedAtFrame;
      } else {
        // hz changed → cycle length changed. Map the current fractional phase
        // (prevPhaseFrame / prevFpc) onto the new cycle and re-anchor so
        // getGate reports that SAME fraction on this frame — the pulse train
        // re-tempos in place instead of jumping to a fresh cycle start.
        const frac = prevPhaseFrame / prevFpc;
        const newPhaseFrame = Math.round(frac * newFpc) % newFpc;
        anchor = frameIndex - newPhaseFrame;
      }
    }

    this.strobeConfig = {
      hz, duty, intensity,
      framesPerCycle: timing.framesPerCycle,
      onFrames: timing.onFrames,
      actualHz: timing.actualHz,
      presetId: meta.presetId || null,
      slotId: meta.slotId || null,
      fadeOutMs: meta.fadeOutMs,
    };
    this.strobeStartedAtFrame = anchor;
    // A live re-apply must not resurrect a burst window from a prior toggle:
    // only a fresh (non-sameRun) activation clears it, and a sameRun re-apply
    // keeps whatever burst frame was already set (burst re-apply goes through
    // triggerStrobeBurst which sets it after this call).
    if (!sameRun) this.strobeBurstEndFrame = null;
    this.strobeActive = true;
    this.strobeFadingOut = false;
    this.activeStrobePresetId = meta.presetId || null;
    this.activeStrobeSlotId = meta.slotId || null;
  }

  triggerStrobeBurst(hz, durationMs, frameIndex, meta = {}) {
    const clamped = Math.min(MAX_BURST_MS, Math.max(0, durationMs));
    this.setStrobe(true, hz, 0.5, 1.0, frameIndex, meta);
    const frames = Math.max(1, Math.round((clamped / 1000) * this.frameRate));
    this.strobeBurstEndFrame = frameIndex + frames;
  }

  stopStrobe({ immediate = false, nowMs = null } = {}) {
    const time = nowMs ?? performance.now();
    // Fade-out is opt-in via the preset's `fadeOutMs > 0`. Default is
    // immediate stop — the prior 1000 ms default fade caused operator
    // confusion ("can't turn off the strobe") because scheduled OFFs
    // and manual GEM-tap OFFs both pretended to ignore the request
    // while the rig kept pulsing through the fade tail. Strobe presets
    // in the library don't set fadeOutMs today, so this restores the
    // expected snap-off behavior. Any future preset that wants a soft
    // fade sets `params.fadeOutMs: <ms>` and it still works.
    const fadeMs = this.strobeConfig?.fadeOutMs;
    if (!immediate && this.strobeActive && this.strobeConfig && typeof fadeMs === 'number' && fadeMs > 0) {
      this.strobeFadingOut = true;
      this.strobeFadeStartMs = time;
      this.strobeFadeDurationMs = fadeMs;
    } else {
      this.strobeFadingOut = false;
      this.strobeConfig = null;
      this.strobeBurstEndFrame = null;
    }
    this.strobeActive = false;
    this.activeStrobePresetId = null;
    this.activeStrobeSlotId = null;
  }

  // ── Drop hit ──────────────────────────────────────────────────────
  //
  // Every call fires a NEW voice — this is the hand-drumming trigger path
  // (Sina drums the VSN1 keys; a fast re-press MUST re-fire, never be
  // dropped/coalesced). There is no retrigger suppression or refractory
  // window here on purpose. The only bound is DROP_HIT_MAX_POLY, and when
  // we hit it we RECYCLE the OLDEST ringing voice (steal its slot) so the
  // newest press always lands (voice-steal, never drop-the-new-press). The
  // constant used to be dead — declared but never enforced, so rapid drums
  // grew the array unbounded (a latent perf/memory hazard under sustained
  // hand-drumming); this makes the cap real without ever eating a press.
  triggerDropHit(params, nowMs) {
    const duration = dropHitEffect.envelopeDurationMs({
      attackMs: params.attackMs,
      holdMs: params.holdMs,
      releaseMs: params.releaseMs,
    });
    // Voice-steal: at cap, evict the OLDEST voice(s) so there is room for
    // the new one. `>=` (not `>`) because we are about to push one.
    while (this.dropHits.length >= DROP_HIT_MAX_POLY) {
      this.dropHits.shift();
    }
    this.dropHits.push({
      params: { ...params },
      triggeredAtMs: nowMs,
      durationMs: duration,
    });
  }

  /**
   * Immediately silence every ringing dropHit voice. dropHit is a TRIGGER
   * effect with no toggle-off action of its own — a hit "rings out" over its
   * release envelope. The global "disable all effects" (blackout) action needs
   * to stop a ringing trigger too, so this clears the live voice pool. panicStop
   * clears the same array; this is the surgical, per-effect version the slot
   * manager's disableAll() calls so it doesn't reach into controller internals.
   * Returns the number of voices that were cleared (0 = nothing was ringing).
   */
  clearDropHits() {
    const cleared = this.dropHits.length;
    this.dropHits.length = 0;
    return cleared;
  }

  // ── Color wash (multi-instance, keyed per slot) ───────────────────
  _makeColorWashDefault() {
    return {
      enabled: false, preset: null, color: null, amount: 0, mode: 'tint',
      slotId: null, key: null, fadingOut: false, fadeStartMs: 0,
      fadeDurationMs: 0, fadeStartAmount: 0,
    };
  }

  /**
   * Derive a wash entry's collection key. A slot-bound wash keys by its SLOT
   * so two slots (even the same preset) are two independent washes; a slotless
   * caller (scheduler dispatch, direct API) keys by preset. Returns null only
   * when NEITHER is known (the legacy "untargeted" disable — see setColorWash).
   */
  _colorWashKey({ slotId = null, presetId = null } = {}) {
    if (slotId !== null && slotId !== undefined) return `slot:${slotId}`;
    if (presetId) return `sched:${presetId}`;
    return null;
  }

  /**
   * Re-point the legacy single-object VIEW (`colorWashConfig`) at the PRIMARY
   * active wash — the highest-slotId entry (slotless entries rank below slotted;
   * newest wins on a tie), matching the render "later slot wins" rule. When no
   * wash is active it points at a reset default. Called after every mutation so
   * consumers reading the singular shape stay consistent. Identity is preserved
   * for an in-place tweak (the same entry object stays primary).
   */
  _syncColorWashCompat() {
    if (this.colorWashes.size === 0) {
      this.colorWashConfig = this._makeColorWashDefault();
      return;
    }
    let primary = null;
    for (const w of this.colorWashes.values()) {
      if (!primary || (w.slotId ?? -1) >= (primary.slotId ?? -1)) primary = w;
    }
    this.colorWashConfig = primary;
  }

  /** Begin the fade-out of one wash entry (idempotent while already fading). */
  _startColorWashFade(entry, time) {
    if (!entry.enabled && entry.fadingOut) return;
    entry.fadingOut = true;
    entry.enabled = false;
    entry.fadeStartMs = time;
    const params = entry.preset && GLOBAL_EFFECT_LIBRARY.colorWash.presets[entry.preset]?.params;
    entry.fadeDurationMs = params?.fadeOutMs ?? 1000;
    entry.fadeStartAmount = entry.amount;
  }

  /**
   * Clear EVERY active wash. `immediate` drops them instantly (blackout /
   * panic); otherwise each entry fades out on its own preset's fadeOutMs.
   */
  clearAllColorWashes({ immediate = false, nowMs = null } = {}) {
    if (immediate) {
      this.colorWashes.clear();
      this._syncColorWashCompat();
      return;
    }
    const time = nowMs ?? performance.now();
    for (const w of this.colorWashes.values()) this._startColorWashFade(w, time);
    this._syncColorWashCompat();
  }

  /**
   * Enable / disable a color wash for the caller's key (slot or slotless).
   *
   * enable  → UPSERT this key's entry (an in-place live tweak on the SAME
   *           running key+preset mutates the existing entry object so no fade
   *           is dropped and consumer refs / object identity survive).
   * disable → target ONLY the caller's key. A disable with NEITHER slotId nor
   *           presetId (the legacy "untargeted" call, e.g. an old panic path)
   *           falls back to clearing ALL washes — matching pre-fix broad
   *           semantics without reintroducing the cross-slot kill for TARGETED
   *           callers.
   */
  setColorWash(enabled, presetId = null, amount = 0, mode = 'tint', meta = {}) {
    const key = this._colorWashKey({ slotId: meta.slotId, presetId });
    if (!enabled) {
      const immediate = !!(meta && meta.immediate);
      const nowMs = meta && meta.nowMs;
      // Untargeted (no key): legacy broad kill of every wash.
      if (key === null) {
        this.clearAllColorWashes({ immediate, nowMs });
        return;
      }
      const entry = this.colorWashes.get(key);
      if (!entry) return; // nothing bound to this key — clean no-op
      if (immediate) {
        this.colorWashes.delete(key);
      } else if (entry.enabled) {
        this._startColorWashFade(entry, nowMs ?? performance.now());
      } else if (!entry.fadingOut) {
        this.colorWashes.delete(key);
      }
      this._syncColorWashCompat();
      return;
    }
    const fx = GLOBAL_EFFECT_LIBRARY.colorWash;
    const preset = presetId && fx.presets[presetId];
    if (!preset) {
      throw new Error(`Unknown colorWash preset: ${presetId}`);
    }
    const upsertKey = key; // an enable always carries a preset → key is non-null
    const existing = this.colorWashes.get(upsertKey);

    // GLITCH-FREE LIVE RE-APPLY: a live tweak (Wash Depth / Blend encoder) on a
    // RUNNING wash re-enters here via _reapplyIfActive('activate'). Same
    // key+preset, enabled, not fading → mutate the SAME entry object in place
    // (leave fade fields alone; a tweak is not a fade), preserving identity for
    // any held reference.
    if (existing && existing.enabled && !existing.fadingOut && existing.preset === presetId) {
      existing.amount = amount;
      existing.mode = mode;
      existing.color = [...preset.params.color];
      this._syncColorWashCompat();
      return;
    }

    // Fresh enable (or a re-enable after fade / a preset swap on this key).
    // Reuse the existing entry object when present so a mid-fade re-enable keeps
    // object identity (mirrors the interrupted-fade contract).
    const entry = existing || this._makeColorWashDefault();
    entry.enabled = true;
    entry.preset = presetId;
    entry.color = [...preset.params.color];
    entry.amount = amount;
    entry.mode = mode;
    entry.slotId = meta.slotId ?? null;
    entry.key = upsertKey;
    entry.fadingOut = false;
    entry.fadeStartMs = 0;
    entry.fadeDurationMs = 0;
    entry.fadeStartAmount = 0;
    this.colorWashes.set(upsertKey, entry);
    this._syncColorWashCompat();
  }

  // ── Feedback trails ───────────────────────────────────────────────
  setFeedbackTrails(enabled, presetId = null, paramsOverride = {}, meta = {}) {
    if (!enabled) {
      const immediate = meta && meta.immediate;
      const nowMs = meta && meta.nowMs;
      if (!immediate && this.feedbackTrailsConfig.enabled) {
        this.feedbackTrailsConfig.fadingOut = true;
        this.feedbackTrailsConfig.fadeStartMs = nowMs ?? performance.now();
        const p = this.feedbackTrailsConfig.params;
        const fadeMs = p?.fadeOutMs ?? 1000;
        this.feedbackTrailsConfig.fadeDurationMs = fadeMs;
        this.feedbackTrailsConfig.fadeStartMix = p?.mix ?? 0.5;
      } else if (immediate || !this.feedbackTrailsConfig.fadingOut) {
        this.feedbackTrailsConfig = {
          enabled: false, preset: null, params: null, slotId: null,
          fadingOut: false, fadeStartMs: 0, fadeDurationMs: 0, fadeStartMix: 0,
        };
        // Free the buffer so a future enable starts from a clean slate
        // (also covers the "buffer cleared on disable" test assertion).
        this.feedbackTrailBuffer = null;
        this.feedbackTrailPixelCount = 0;
      }
      this.feedbackTrailsConfig.enabled = false;
      return;
    }
    const fx = GLOBAL_EFFECT_LIBRARY.feedbackTrails;
    const preset = presetId && fx.presets[presetId];
    if (!preset) {
      throw new Error(`Unknown feedbackTrails preset: ${presetId}`);
    }
    const merged = { ...preset.params, ...paramsOverride };

    // GLITCH-FREE LIVE RE-APPLY (glitch-fix campaign 2026-07): a live param tweak
    // on a RUNNING trails effect (Trail Mix jog-wheel → mix, Blend encoder →
    // blendMode) re-enters here via _reapplyIfActive('activate'). The pre-fix
    // code rebuilt the whole config AND honoured `resetOnEnable` every time, so
    // it WIPED the accumulated trail buffer on each tweak — the ghost image
    // popped to black and re-accumulated from scratch. A buffer reset is a
    // FRESH-ENABLE gesture (off→on / preset swap), NOT a param tweak.
    //
    // In-place case: already enabled for THIS slot+preset → update params only,
    // keep the trail buffer (and the fade fields, which stay cleared) intact.
    const inPlace = this.feedbackTrailsConfig.enabled
      && !this.feedbackTrailsConfig.fadingOut
      && this.feedbackTrailsConfig.preset === presetId
      && this.feedbackTrailsConfig.slotId === (meta.slotId || null);
    if (inPlace) {
      this.feedbackTrailsConfig.params = merged;
      // No buffer reset — the history the operator is watching is preserved.
      return;
    }

    // Fresh enable (or a preset/slot switch): a full (re)build. resetOnEnable
    // clears the buffer here — this is exactly the off→on / swap moment where a
    // clean slate is wanted (a swapped preset shouldn't inherit stale history).
    this.feedbackTrailsConfig = {
      enabled: true,
      preset: presetId,
      params: merged,
      slotId: meta.slotId || null,
      fadingOut: false,
      fadeStartMs: 0,
      fadeDurationMs: 0,
      fadeStartMix: 0,
    };
    if (merged.resetOnEnable && this.feedbackTrailBuffer) {
      this.feedbackTrailBuffer.fill(0);
    }
  }

  // ── Group fixed colors (docs/32) ──────────────────────────────────

  /**
   * Lock a fixture group to a fixed RGBWAU color at a given brightness.
   * Replaces any existing override for the group. Throws on invalid
   * input — codex P0: a typo'd payload must fail loudly, never
   * half-apply.
   *
   * `brightness: 0` is valid and locks the group dark (per-group
   * blackout). Group-name existence in the model is validated by the
   * API layer (which owns the model); the controller validates shape.
   */
  /**
   * WHICH GROUPS THE EFFECT CHAIN IS ALLOWED TO TOUCH.
   *
   * Every effect in the library except group_fixed_color writes to all pixels
   * unconditionally - grep for `px.group` under effects/ and that is the only
   * hit. So until now an effect was rig-wide by construction: you could not
   * strobe the smokestacks and leave the hull alone.
   *
   * `null` (the default) means UNRESTRICTED - exactly the old behaviour, so
   * nothing changes for any caller that never sets this. An array restricts the
   * chain to those groups. An EMPTY array is legal and means "nowhere": that is
   * a real operator choice, not a mistake, and it is not quietly turned back
   * into "everywhere" (codex P0 - no fallbacks).
   *
   * Enforcement does NOT live in the effects. It is a snapshot/restore around
   * the whole chain in engine.js: whatever an effect did to an out-of-scope
   * pixel is undone. One place, and it cannot be got wrong by an effect author
   * writing pixels in some new way.
   *
   * @param {string[]|null} groups
   */
  setEffectGroups(groups) {
    if (groups === null || groups === undefined) {
      this.effectGroups = null;
      return;
    }
    if (!Array.isArray(groups)) {
      throw new Error('setEffectGroups: groups must be an array of group names, or null for unrestricted');
    }
    groups.forEach((g, i) => {
      if (typeof g !== 'string' || g.length === 0) {
        throw new Error(`setEffectGroups: groups[${i}] must be a non-empty string`);
      }
    });
    this.effectGroups = new Set(groups);
  }

  /** The live mask: a Set of group names, or null when unrestricted. */
  get effectGroupMask() {
    return this.effectGroups || null;
  }

  /**
   * PARKED (locked) groups - held exactly as the operator set them.
   *
   * OPERATOR RULING, made knowingly: a locked group is IMMUNE TO THE GRAND
   * MASTER. That is a deliberate exception to "the master is the master, no
   * exceptions" set earlier the same day; the operator was shown the conflict
   * and chose this anyway. It is the ONLY exception, and BLACKOUT still kills a
   * parked group - safety is not negotiable and the e-stop must never be
   * something a UI toggle can defeat.
   *
   * `null`/empty = nothing parked, which is the shipped behaviour.
   *
   * @param {string[]|null} groups
   */
  setParkedGroups(groups) {
    if (groups === null || groups === undefined) { this.parkedGroups = null; return; }
    if (!Array.isArray(groups)) {
      throw new Error('setParkedGroups: groups must be an array of group names, or null');
    }
    groups.forEach((g, i) => {
      if (typeof g !== 'string' || g.length === 0) {
        throw new Error(`setParkedGroups: groups[${i}] must be a non-empty string`);
      }
    });
    this.parkedGroups = groups.length ? new Set(groups) : null;
  }

  /** Set of parked group names, or null when nothing is parked. */
  get parkedGroupMask() {
    return this.parkedGroups || null;
  }

  setGroupFixedColor(group, color6, brightness, colors) {
    if (typeof group !== 'string' || group.length === 0) {
      throw new Error('setGroupFixedColor: group must be a non-empty string');
    }
    validateColor6(color6);
    if (typeof brightness !== 'number' || !Number.isFinite(brightness) ||
        brightness < 0 || brightness > 1) {
      throw new Error(`setGroupFixedColor: brightness=${brightness} out of range [0..1]`);
    }
    /* FIVE COLOURS AT ONCE (operator request). A group used to hold exactly one
       colour, painted flat across every pixel in it. `colors` lets a group carry
       a whole palette instead, spread across its own pixels by each pixel's
       ordinal WITHIN THE GROUP (see applyGroupFixedColors).
       `color` stays required and stays the first entry, so every existing
       caller, every persisted override and the WS payload keep working
       unchanged - this is additive, not a replacement. */
    let list = null;
    if (colors !== undefined && colors !== null) {
      if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error('setGroupFixedColor: colors must be a non-empty array of color6 entries');
      }
      colors.forEach((c, i) => {
        try {
          validateColor6(c);
        } catch (e) {
          throw new Error(`setGroupFixedColor: colors[${i}] invalid - ${e.message}`);
        }
      });
      list = colors.map(c => [...c]);
    }
    this.groupFixedColors[group] = {
      color: [...color6],
      brightness,
      ...(list ? { colors: list } : {}),
    };
  }

  /**
   * Remove a group's fixed-color override. Idempotent — returns true
   * when an override was actually removed, false when none existed.
   */
  clearGroupFixedColor(group) {
    if (typeof group !== 'string' || group.length === 0) {
      throw new Error('clearGroupFixedColor: group must be a non-empty string');
    }
    if (!Object.prototype.hasOwnProperty.call(this.groupFixedColors, group)) {
      return false;
    }
    delete this.groupFixedColors[group];
    return true;
  }

  /**
   * Per-frame pipeline stage (docs/32 §2.2). Called by engine.js AFTER
   * applyMacros() (locked groups must not be repainted by wash /
   * trails / strobe) and BEFORE IntensityController.apply() (section
   * dimmers + blackout keep the final say).
   */
  /**
   * AUDIO GAIN PER GROUP. Scales every pixel of a bound group by the 0..1 gain
   * the audio binding produced this frame - so binding HIGH to a group makes it
   * breathe with the hi-hats, and binding KICK in hit mode makes it punch.
   *
   * Runs at the END of applyGroupFixedColors, which is the only place that is
   * after BOTH the effect chain and the group paint: bind a group to a signal
   * and it rides the audio whether it is showing an effect or holding a flat
   * colour. Section dimmers still come after, so the group's own fader keeps
   * the last word - the audio scales what the fader allows, never past it.
   *
   * A group with no binding is not touched at all (gain absent, not 1), so this
   * costs nothing until an operator asks for it.
   */
  applyAudioGroupGains(pixels) {
    const gains = this._audioGains && this._audioGains.groups;
    if (!gains) return;
    const names = Object.keys(gains);
    if (names.length === 0) return;
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (!px || px.group === undefined) continue;
      const g = gains[px.group];
      if (g === undefined || g === 1) continue;
      px.r *= g; px.g *= g; px.b *= g;
      px.w *= g; px.a *= g; px.u *= g;
    }
  }

  /** Per-frame gains from the audio bindings: { effects:{slotId:g}, groups:{name:g} }. */
  setAudioGains(gains) {
    this._audioGains = gains || null;
  }

  /**
   * Update the spatial stroke. Partial: only the keys present are changed, so
   * the pad can send position at drag rate without restating mode/colour.
   *
   * VALIDATES AND THROWS rather than coercing — this is the one control whose
   * numbers come straight off a touch surface at ~20 writes/second, and a
   * silently clamped coordinate is a stroke landing somewhere the operator did
   * not point.
   */
  setSpatialPaint(patch) {
    if (!patch || typeof patch !== 'object') {
      throw new Error('setSpatialPaint: an object of fields is required');
    }
    const num = (k, lo, hi) => {
      const v = patch[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
        throw new Error(`setSpatialPaint: ${k} must be a finite number in [${lo},${hi}], got ${v}`);
      }
      return v;
    };
    const sp = this.spatial;
    const clearSpatial = () => {
      if (this._spatialHeat) this._spatialHeat.fill(0);
      if (this._spatialInk) this._spatialInk.fill(0);
      this._spatialEnergy = 0;
      this._spatialPrevX = null;
      this._spatialPrevY = null;
      this._spatialTouchSeenMs = null;
      sp.touch = false;
      sp.strokes = [];
    };
    const hasAxisX = patch.axisX !== undefined;
    const hasAxisY = patch.axisY !== undefined;
    if (hasAxisX !== hasAxisY) {
      throw new Error('setSpatialPaint: axisX and axisY must be changed together');
    }
    let nextAxisX = sp.axisX;
    let nextAxisY = sp.axisY;
    if (hasAxisX) {
      if (SPATIAL_AXIS_PAIRS.indexOf(`${patch.axisX}:${patch.axisY}`) === -1) {
        throw new Error(`setSpatialPaint: unsupported axis pair '${patch.axisX}:${patch.axisY}'`);
      }
      nextAxisX = patch.axisX;
      nextAxisY = patch.axisY;
    }
    let nextIndices = sp.pixelIndices;
    let nextMask = this._spatialPixelMask;
    if (patch.pixelIndices !== undefined) {
      if (this.modelPixelCount === null) {
        throw new Error('setSpatialPaint: modelPixelCount is required for a pixel mask');
      }
      if (!Array.isArray(patch.pixelIndices) || patch.pixelIndices.length === 0) {
        throw new Error('setSpatialPaint: pixelIndices must be a non-empty array');
      }
      const seen = new Set();
      nextIndices = patch.pixelIndices.map((value, index) => {
        if (!Number.isInteger(value) || value < 0 || value >= this.modelPixelCount) {
          throw new Error(`setSpatialPaint: pixelIndices[${index}] is out of range`);
        }
        if (seen.has(value)) throw new Error(`setSpatialPaint: duplicate pixel index ${value}`);
        seen.add(value);
        return value;
      }).sort((a, b) => a - b);
      nextMask = new Uint8Array(this.modelPixelCount);
      for (const index of nextIndices) nextMask[index] = 1;
    }
    const maskChanged = nextIndices !== sp.pixelIndices && (!sp.pixelIndices
      || sp.pixelIndices.length !== nextIndices.length
      || sp.pixelIndices.some((value, index) => value !== nextIndices[index]));
    const projectionChanged = nextAxisX !== sp.axisX || nextAxisY !== sp.axisY || maskChanged;
    if (patch.enabled && !nextMask) {
      throw new Error('setSpatialPaint: enabled paint requires a verified pixelIndices mask');
    }
    sp.axisX = nextAxisX;
    sp.axisY = nextAxisY;
    if (maskChanged) {
      sp.pixelIndices = nextIndices;
      this._spatialPixelMask = nextMask;
    }
    // Clear before applying the rest of this patch. This makes
    // {clear:true,touch:true,...} an atomic "new stroke on a clean canvas"
    // instead of clearing the touch that the same request just installed.
    if (projectionChanged || patch.clear) clearSpatial();
    if (patch.enabled !== undefined) {
      sp.enabled = !!patch.enabled;
    }
    if (patch.touch !== undefined && patch.strokes === undefined) {
      sp.touch = !!patch.touch;
      if (!sp.touch) sp.strokes = [];
      // Every touch-carrying write restarts the staleness window (the stage
      // stamps the frame clock on its next pass — one clock domain, no mixing
      // Date.now() into the nowMs stream, which is exactly the bug class the
      // strobe fade audit finding is about).
      this._spatialTouchSeenMs = null;
    }
    if (patch.targetX !== undefined) sp.targetX = num('targetX', 0, 1);
    if (patch.targetY !== undefined) sp.targetY = num('targetY', 0, 1);
    if (patch.strokes !== undefined) {
      if (!Array.isArray(patch.strokes)) {
        throw new Error('setSpatialPaint: strokes must be an array');
      }
      if (patch.strokes.length > 10) {
        throw new Error('setSpatialPaint: strokes supports at most 10 simultaneous touches');
      }
      const ids = new Set();
      const nextStrokes = patch.strokes.map((stroke, index) => {
        if (!stroke || typeof stroke !== 'object') {
          throw new Error(`setSpatialPaint: strokes[${index}] must be an object`);
        }
        if (!Number.isInteger(stroke.id) || stroke.id < 0 || stroke.id > 0x7fffffff) {
          throw new Error(`setSpatialPaint: strokes[${index}].id must be a non-negative integer`);
        }
        if (ids.has(stroke.id)) {
          throw new Error(`setSpatialPaint: duplicate stroke id ${stroke.id}`);
        }
        ids.add(stroke.id);
        const coordinate = (key) => {
          const value = stroke[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`setSpatialPaint: strokes[${index}].${key} must be in [0,1]`);
          }
          return value;
        };
        const hasPrevX = stroke.prevX !== undefined;
        const hasPrevY = stroke.prevY !== undefined;
        if (hasPrevX !== hasPrevY) {
          throw new Error(`setSpatialPaint: strokes[${index}] prevX and prevY must be supplied together`);
        }
        const out = {
          id: stroke.id,
          targetX: coordinate('targetX'),
          targetY: coordinate('targetY'),
        };
        if (hasPrevX) {
          out.prevX = coordinate('prevX');
          out.prevY = coordinate('prevY');
        }
        const color = (key) => {
          if (stroke[key] === undefined) return undefined;
          if (!Array.isArray(stroke[key]) || stroke[key].length < 6) {
            throw new Error(`setSpatialPaint: strokes[${index}].${key} must be a 6-element RGBWAU array`);
          }
          return stroke[key].slice(0, 6).map((value, channel) => {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
              throw new Error(`setSpatialPaint: strokes[${index}].${key}[${channel}] must be in [0,1]`);
            }
            return value;
          });
        };
        const strokeColor = color('color');
        const strokeAlt = color('colorAlt');
        if (strokeColor) out.color = strokeColor;
        if (strokeAlt) out.colorAlt = strokeAlt;
        return out;
      });
      const nextTouch = nextStrokes.length > 0;
      if (patch.touch !== undefined && !!patch.touch !== nextTouch) {
        throw new Error('setSpatialPaint: touch must match whether strokes is empty');
      }
      sp.strokes = nextStrokes;
      sp.touch = nextTouch;
      this._spatialPrevX = null;
      this._spatialPrevY = null;
      this._spatialTouchSeenMs = null;
    }
    if (patch.radius !== undefined) sp.radius = num('radius', 0.01, 1);
    if (patch.radiusY !== undefined) sp.radiusY = num('radiusY', 0.01, 2);
    // POWER overdrives past 1 (operator ruling: it did not hit hard enough).
    if (patch.amount !== undefined) sp.amount = num('amount', 0, 3);
    if (patch.fadeSeconds !== undefined) {
      const value = num('fadeSeconds', SPATIAL_FADE_SECONDS[0],
        SPATIAL_FADE_SECONDS[SPATIAL_FADE_SECONDS.length - 1]);
      if (SPATIAL_FADE_SECONDS.indexOf(value) === -1) {
        throw new Error(`setSpatialPaint: fadeSeconds must be one of ${SPATIAL_FADE_SECONDS.join('|')}`);
      }
      sp.fadeSeconds = value;
    }
    if (patch.mode !== undefined) {
      if (['pool', 'trail', 'erase', 'ignite'].indexOf(patch.mode) === -1) {
        throw new Error(`setSpatialPaint: mode '${patch.mode}' must be pool|trail|erase|ignite`);
      }
      sp.mode = patch.mode;
    }
    if (patch.color !== undefined) {
      if (!Array.isArray(patch.color) || patch.color.length < 6) {
        throw new Error('setSpatialPaint: color must be a 6-element RGBWAU array');
      }
      sp.color = patch.color.slice(0, 6).map(v => (typeof v === 'number' && Number.isFinite(v)
        ? Math.min(1, Math.max(0, v)) : 0));
    }
    if (patch.colorAlt !== undefined) {
      if (!Array.isArray(patch.colorAlt) || patch.colorAlt.length < 6) {
        throw new Error('setSpatialPaint: colorAlt must be a 6-element RGBWAU array');
      }
      sp.colorAlt = patch.colorAlt.slice(0, 6).map(v => (typeof v === 'number' && Number.isFinite(v)
        ? Math.min(1, Math.max(0, v)) : 0));
    }
    return this.getSpatialPaint();
  }

  getSpatialPaint() {
    const sp = this.spatial;
    return {
      enabled: sp.enabled, touch: sp.touch, activeTouchCount: sp.strokes.length,
      targetX: sp.targetX, targetY: sp.targetY,
      radius: sp.radius, radiusY: sp.radiusY, amount: sp.amount, mode: sp.mode,
      fadeSeconds: sp.fadeSeconds, axisX: sp.axisX, axisY: sp.axisY,
      pixelIndices: sp.pixelIndices ? sp.pixelIndices.slice() : null,
      color: sp.color.slice(), colorAlt: sp.colorAlt.slice(),
      energy: this._spatialEnergy,
    };
  }

  /** 0..1 audio gain for an effect slot, or 1 when nothing is bound to it. */
  audioGainForSlot(slotId) {
    const e = this._audioGains && this._audioGains.effects;
    if (!e || slotId === null || slotId === undefined) return 1;
    const g = e[String(slotId)];
    return typeof g === 'number' ? g : 1;
  }

  /**
   * Is this slot bound to a TEMPO signal (so it should run in time rather than
   * have its depth ridden)? Set by audio_bindings.evaluate, which is the only
   * place that knows which signal a slot is bound to.
   */
  isTempoLocked(slotId) {
    const t = this._audioGains && this._audioGains.tempoLocked;
    if (!t || slotId === null || slotId === undefined) return false;
    return t[String(slotId)] === true;
  }

  /**
   * Drive an effect's OWN primary parameter from the audio bound to its slot.
   *
   * WHY THIS EXISTS (operator report: "when bpm is added to the effects they
   * all pulse the effect that is on - I want it to control what the effect is
   * MADE to do"). Two different things were being conflated:
   *
   *   GROUP bindings multiply every pixel in a group (applyAudioGroupGains).
   *   That is a brightness pulse over whatever happens to be showing - correct
   *   for a FADER, which is what a group binding drives, but it is not the
   *   effect doing anything.
   *
   *   EFFECT bindings were computed by audio_bindings and then, for every
   *   effect except movementTrace, THROWN AWAY - audioGainForSlot() had
   *   exactly one caller. So binding BPM to STROBE did literally nothing, and
   *   binding it to a movement button scaled its brightness.
   *
   * Now an effect binding rides the parameter the effect declares as its own
   * magnitude - `primaryIntensity.param` in the effect registry, the same knob
   * the VSN1 jog-wheel writes. Strobe gets Flash Strength, beat pump gets Pump
   * Depth, breath gets Breath Depth, trails get Trail Mix, crush gets Crush.
   * The music makes the effect do ITS thing harder or softer.
   *
   * NOT setSlotIntensity(): that writes the operator's persisted jog-wheel
   * value and re-dispatches the effect. At 40 fps that would clobber their
   * setting, churn the state file, and re-dispatch 40x a second. This is a
   * per-frame modulation lane instead - the operator's value stays the BASE
   * and audio rides it, so releasing the binding restores exactly what they
   * dialled in.
   *
   * An unbound slot returns gain 1 and the base is handed back untouched, so
   * this costs nothing until someone asks for it.
   */
  audioDrivenPrimary(slotId, base) {
    // A TEMPO-LOCKED slot keeps the operator's depth EXACTLY as dialled. Riding
    // the magnitude off a beat envelope is the "it just pulses" behaviour the
    // operator rejected; a tempo-bound effect expresses the music through its
    // own rate/sync instead (see tempoSyncFor).
    if (this.isTempoLocked(slotId)) return base;
    const g = this.audioGainForSlot(slotId);
    return g === 1 ? base : base * g;
  }

  /**
   * The tempo-locked value for an effect's OWN rate/sync parameter, or null
   * when the slot is not tempo-bound and the operator's setting stands.
   *
   * Only 7 of the 19 effects own a rate at all — strobe, e1_beat_pump,
   * e2_waterline_sweep, e3_kick_punch, movement_trace, ocean_breath and
   * frost_sparkle. The other 12 have nothing but a depth, which is why binding
   * a tempo signal to them in LEVEL mode can only ever look like a throb; the
   * panel steers those to HIT so they stab on the beat instead.
   *
   * @param {*} slotId       the slot the effect is dispatched from
   * @param {*} lockedValue  what this effect's rate param means "on the beat"
   * @param {*} freeValue    the operator's own setting, used when not bound
   */
  tempoSyncFor(slotId, lockedValue, freeValue) {
    return this.isTempoLocked(slotId) ? lockedValue : freeValue;
  }

  /**
   * Paint the operator's per-group colours. Runs in TWO PHASES.
   *
   * WHY (operator): "the whole point is that you can pre-choose each group's
   * colour palette and then add effects, without global taking over."
   * That was impossible by construction. This paint has always run AFTER the
   * effect chain, so a painted group could never show an effect - it either
   * held its colour or it showed the show, never its colour WITH an effect
   * playing on it. Marking it FX aimed the effect chain at the group correctly
   * and the paint then covered the result a moment later.
   *
   *   'pre'   BEFORE the chain, for groups the effect scope INCLUDES. The
   *           group's chosen colours are laid down first and the effects then
   *           modulate THEM - strobe gates that colour, breath swells it,
   *           trails smear it. This is the new behaviour and the whole point.
   *   'post'  AFTER the chain, for every other painted group. Unchanged: a
   *           locked group must not flicker with the show (docs/32).
   *
   * With NO scope set (mask null) nothing paints early, so the behaviour is
   * byte-identical to before this split - every existing caller is unaffected.
   *
   * The audio group gains stay in 'post' only: they are a gain on the FINAL
   * colour, and applying them twice would square them.
   *
   * @param {Array} pixels
   * @param {'pre'|'post'} [phase='post']
   */
  applyGroupFixedColors(pixels, phase = 'post') {
    const names = Object.keys(this.groupFixedColors);
    const mask = this.effectGroupMask;

    if (phase === 'pre' && !mask) return;          // nothing paints early
    if (names.length === 0) {
      if (phase === 'post') this.applyAudioGroupGains(pixels);
      return;
    }

    // Split the painted groups by whether the effect chain may touch them.
    let overrides = this.groupFixedColors;
    if (mask) {
      overrides = {};
      for (const n of names) {
        if (mask.has(n) === (phase === 'pre')) overrides[n] = this.groupFixedColors[n];
      }
    }

    if (Object.keys(overrides).length > 0) {
      /* Only resolve the per-group ordinals when a palette actually needs them.
         groupIndicesFor() is memoised on the pixel array, so the cost is one
         cheap check per frame in the common single-colour case. */
      let groupIndex;
      for (const k of Object.keys(overrides)) {
        const ov = overrides[k];
        if (ov && ov.colors && ov.colors.length > 1) {
          groupIndex = groupIndicesFor(pixels).index;
          break;
        }
      }
      groupFixedColorEffect.apply({ pixels, overrides, groupIndex });
    }
    if (phase === 'post') this.applyAudioGroupGains(pixels);
  }

  // ── Global color Invert (docs/39 §F-invert) ───────────────────────

  /**
   * Enable/disable the global invert. Pure boolean — coerced via !! (no
   * fail-loud contract; any value coerces, like the legacy effect toggles).
   *
   * @param {boolean} enabled
   */
  setInvert(enabled) {
    this.invert = !!enabled;
  }

  /**
   * Per-frame pipeline stage. Called by engine.js AFTER applyMacros()
   * and BEFORE applyGroupFixedColors() (docs/39 §F-invert) so the global
   * chroma flip runs after the show macros but BEFORE group color-locks
   * and the intensity/blackout safety stages — locks + e-stop keep the
   * final say. Inverts RGB only; W/A/UV are untouched (mission-critical
   * exterior whites must never be flipped dark).
   *
   * Codex P0 (zero-cost default): when invert is off this returns BEFORE
   * touching any pixel — the default rig pays nothing.
   *
   * @param {Array} pixels  Post-mixer model.pixels.
   */
  applyInvert(pixels) {
    // Zero-cost gate: nothing to invert when off.
    if (!this.invert) return;
    invertEffect.apply({ pixels, enabled: true });
  }

  // ── Party effect setters (report 20260708_7 GEM wiring) ───────────
  // The slot manager flips these from activate/deactivate/toggle/trigger,
  // exactly like setStrobe/setColorWash/setFeedbackTrails. Each merges the
  // resolved slot params (preset defaults ⊕ paramsOverride, already
  // validated by resolveSlotBinding) onto the controller's runtime config.

  /**
   * E1 Beat Pump. `enabled` false clears the pump; true applies the merged
   * params (depth/rate/curve). No fade — the pump self-recovers each beat.
   */
  setBeatPump(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.beatPump.enabled = false;
      return;
    }
    if (params.depth !== undefined) this.beatPump.depth = params.depth;
    if (params.rate !== undefined) this.beatPump.rate = params.rate;
    if (params.curve !== undefined) this.beatPump.curve = params.curve;
    this.beatPump.enabled = true;
    this.beatPump.presetId = meta.presetId || null;
    this.beatPump.slotId = meta.slotId || null;
  }

  /**
   * E2 Waterline Sweep. `enabled` false stops the band; true applies the
   * merged spatial params. The head position keeps accumulating in
   * _applyWaterlineSweepStage so a re-enable doesn't jump.
   */
  setWaterlineSweep(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.sweep.enabled = false;
      return;
    }
    if (params.axis !== undefined) this.sweep.axis = params.axis;
    if (params.width !== undefined) this.sweep.width = params.width;
    if (params.amount !== undefined) this.sweep.amount = params.amount;
    if (params.mode !== undefined) this.sweep.mode = params.mode;
    if (params.color !== undefined) this.sweep.color = [...params.color];
    if (params.speedHz !== undefined) this.sweep.speedHz = params.speedHz;
    if (params.sync !== undefined) this.sweep.sync = params.sync;
    this.sweep.enabled = true;
    this.sweep.presetId = meta.presetId || null;
    this.sweep.slotId = meta.slotId || null;
  }

  /**
   * E3 Kick Punch router (AUTO mode). Arms/disarms the controller-level
   * trigger router that fires dropHit on live kicks. `enabled` false disarms
   * it; true arms it with the merged params + the dropHit preset it fires.
   * (The one-shot `trigger` path is handled directly in the slot dispatcher
   * via triggerDropHit — this setter only owns the auto router.)
   */
  setKickRouter(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.kickRouter.enabled = false;
      return;
    }
    if (params.threshold !== undefined) this.kickRouter.threshold = params.threshold;
    if (params.minGapMs !== undefined) this.kickRouter.minGapMs = params.minGapMs;
    if (params.source !== undefined) this.kickRouter.source = params.source;
    if (params.intensityFloor !== undefined) this.kickRouter.intensityFloor = params.intensityFloor;
    if (params.intensityCeil !== undefined) this.kickRouter.intensityCeil = params.intensityCeil;
    // The dropHit envelope the router fires (color6 + AHR + blend).
    this.kickRouter.preset = {
      color: params.color,
      attackMs: params.attackMs,
      holdMs: params.holdMs,
      releaseMs: params.releaseMs,
      blendMode: params.blendMode,
    };
    this.kickRouter.presetId = meta.presetId || null;
    this.kickRouter.slotId = meta.slotId || null;
    this.kickRouter.enabled = true;
  }

  /**
   * E4 Freeze Frame. `active` false releases the freeze (next engage
   * re-captures); true engages it with the merged holdFadeMs.
   */
  setFreeze(active, params = {}, meta = {}) {
    if (!active) {
      this.freeze.active = false;
      return;
    }
    if (params.holdFadeMs !== undefined) this.freeze.holdFadeMs = params.holdFadeMs;
    this.freeze.active = true;
    this.freeze.presetId = meta.presetId || null;
    this.freeze.slotId = meta.slotId || null;
  }

  /**
   * E6 Palette Crush. `enabled` false disables it; true applies the merged
   * levels/amount. Static chroma — no fade.
   */
  setPaletteCrush(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.crush.enabled = false;
      return;
    }
    if (params.levels !== undefined) this.crush.levels = params.levels;
    if (params.amount !== undefined) this.crush.amount = params.amount;
    this.crush.enabled = true;
    this.crush.presetId = meta.presetId || null;
    this.crush.slotId = meta.slotId || null;
  }

  /**
   * E9 Ocean Breath. `enabled` false stops the swell; true applies the
   * merged period/depth/warmth. periodMs must be > 0 (validated upstream).
   */
  setOceanBreath(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.breath.enabled = false;
      return;
    }
    if (params.periodMs !== undefined) this.breath.periodMs = params.periodMs;
    if (params.depth !== undefined) this.breath.depth = params.depth;
    if (params.warmth !== undefined) this.breath.warmth = params.warmth;
    this.breath.enabled = true;
    this.breath.presetId = meta.presetId || null;
    this.breath.slotId = meta.slotId || null;
  }

  /**
   * E10 Frost Sparkle. `enabled` false disables it AND clears the live glint
   * field (report-3: a plain early-return would freeze glints mid-air); true
   * applies the merged density/decay/intensity/audioDensity.
   */
  setFrostSparkle(enabled, params = {}, meta = {}) {
    if (!enabled) {
      this.sparkle.enabled = false;
      frostSparkleEffect.reset(this._sparkleState);
      return;
    }
    if (params.density !== undefined) this.sparkle.density = params.density;
    if (params.decayMs !== undefined) this.sparkle.decayMs = params.decayMs;
    if (params.intensity !== undefined) this.sparkle.intensity = params.intensity;
    if (params.audioDensity !== undefined) this.sparkle.audioDensity = params.audioDensity;
    this.sparkle.enabled = true;
    this.sparkle.presetId = meta.presetId || null;
    this.sparkle.slotId = meta.slotId || null;
  }

  _ensureFeedbackBuffer(pixelCount) {
    if (!this.feedbackTrailBuffer || this.feedbackTrailPixelCount !== pixelCount) {
      this.feedbackTrailBuffer = new Float32Array(pixelCount * 6);
      this.feedbackTrailPixelCount = pixelCount;
    }
  }

  // ── Generic dispatcher fallback ───────────────────────────────────
  // Only used when the SlotManager dispatches an effectId not covered
  // by the dedicated dispatch* helpers. Today this is unused (all v1
  // effects have dedicated paths) — future macros (sectionChase,
  // sparkleOverlay, etc.) will plug in here.
  triggerGenericMacro(_args) {
    throw new Error(`triggerGenericMacro: not implemented for effect '${_args.effectId}'`);
  }

  // ── Status snapshot ───────────────────────────────────────────────
  getStatus() {
    return {
      strobe: {
        active: this.strobeActive,
        presetId: this.activeStrobePresetId,
        slotId: this.activeStrobeSlotId,
        config: this.strobeConfig ? { ...this.strobeConfig } : null,
        burstEndFrame: this.strobeBurstEndFrame,
      },
      // Legacy single-object VIEW (primary wash) — kept for status/HIL
      // consumers that read the singular shape (controller.colorWash.enabled).
      colorWash: { ...this.colorWashConfig },
      // Full multi-instance collection (RCA 2026-07-13). Each active/ fading
      // wash, deep-cloned so consumers can't mutate the live entries.
      colorWashes: [...this.colorWashes.values()].map(w => ({
        ...w, color: w.color ? [...w.color] : null,
      })),
      feedbackTrails: {
        enabled: this.feedbackTrailsConfig.enabled,
        preset: this.feedbackTrailsConfig.preset,
        slotId: this.feedbackTrailsConfig.slotId,
        params: this.feedbackTrailsConfig.params ? { ...this.feedbackTrailsConfig.params } : null,
        bufferAllocated: !!this.feedbackTrailBuffer,
      },
      dropHit: {
        active: this.dropHitActive,
        count: this.dropHits.length,
      },
      // MOVEMENT Trace — reported so an operator surface (or a test) can see
      // what is travelling, how fast, and in which colours, rather than having
      // to infer it from the lights.
      movement: {
        enabled: this.movement.enabled,
        mode: this.movement.mode,
        travel: this.movement.travel,
        colorCount: this.movement.colors.length,
        // The colours the effect is ACTUALLY running, not the ones the slot has
        // stored. Those two can differ - patching a slot's params does not
        // reach a running effect - and without this there is no way to tell
        // from outside which of the two the rig is showing.
        colors: this.movement.colors.map((c) => c.map((v) => Math.round(v * 1000) / 1000)),
        // The palette ON SCREEN, which during a fade is NOT the requested one.
        // Without this the fade is invisible from outside and untestable - the
        // dump would report the target the instant it was asked for.
        renderedColors: this._resolveMovementColors().map((c) => c.map((v) => Math.round(v * 1000) / 1000)),
        colorFadeT: Math.round(this._movementColorT * 100) / 100,
        phase: this._movementPhase,
        direction: this._movementDir,
        // slotId and presetId are part of the CONTRACT, not decoration: a
        // surface that reconciles the engine against its own buttons matches
        // running effects to buttons BY SLOT. Reporting the effect without its
        // slot reads as "nothing is running", so the reconciler presses the
        // button again every tick and the effect flickers on and off.
        slotId: this.movement.slotId || null,
        presetId: this.movement.presetId || null,
      },
      // Per-group fixed-color locks (docs/32) — deep-cloned so status
      // consumers can't mutate the live table.
      groupFixedColors: JSON.parse(JSON.stringify(this.groupFixedColors)),
      // NOTE: the global hueShift key was REMOVED (2026-07) — hue is
      // per-channel only now, so getStatus carries no hue state.
      // Global color invert (docs/39 §F-invert) — a plain boolean toggle.
      invert: this.invert,
      // Party effects (report 20260708_7 GEM wiring) — active flags +
      // config so status consumers / _isSlotActive can mirror engine state.
      beatPump: { ...this.beatPump },
      sweep: { ...this.sweep, color: [...this.sweep.color] },
      kickRouter: {
        enabled: this.kickRouter.enabled,
        presetId: this.kickRouter.presetId,
        slotId: this.kickRouter.slotId,
      },
      freeze: { ...this.freeze },
      crush: { ...this.crush },
      breath: { ...this.breath },
      sparkle: { ...this.sparkle },
      // Legacy rig-globals state surfaced here too so CaptainPad's
      // RigContext consumers (dimmer_rack bypass checkboxes) can
      // mirror engine-side changes without a separate /globals poll.
      effects: { ...this.effects },
    };
  }

  /**
   * Panic stop (§5.3). Stops every active macro action but leaves
   * configuration (slot bindings, color wash settings) alone. Color
   * wash is intentionally NOT disabled here — operators use the
   * dedicated wash toggle for that. Blackout remains the harder
   * safety net.
   */
  panicStop() {
    this.stopStrobe({ immediate: true });
    this.dropHits.length = 0;
    this.setFeedbackTrails(false, null, {}, { immediate: true });
    // Legacy rig-globals are now slot effects too — kill them when
    // panic-stopping the unified macro grid. Color wash and fogger
    // stay panic-stopped as well so blackout/e-stop really is
    // "everything off" (color wash WAS previously left on by design
    // per docs/28 §5.3 but for the unified e-stop flow we want one
    // hard kill switch).
    for (const k of [
      'vintageWhite', 'blastWhite', 'uvBlast', 'fogger',
      'vintageWhiteBypassDimmer', 'blastWhiteBypassDimmer', 'uvBlastBypassDimmer',
    ]) {
      this.setEffect(k, false);
    }
    this.clearAllColorWashes({ immediate: true });

    // ── Party effects (report 20260708_7) ────────────────────────────
    // Kill everything that is ANIMATION or a FREEZE/OVERLAY hazard; PRESERVE
    // the static/ambient chroma ops (crush, breath) that carry no flash or
    // brightness hazard — same precedent as invert/group-locks above.
    // E1 Beat Pump — animation. E2 Waterline Sweep — animation. E3 Kick
    // router — disarm so it stops firing (pending dropHits already cleared
    // above). E4 Freeze — release. E10 Frost Sparkle — disable + clear field.
    this.setBeatPump(false);
    this.setWaterlineSweep(false);
    this.setMovementTrace(false);
    this.setKickRouter(false);
    this.setFreeze(false);
    this.setFrostSparkle(false); // also clears the live glint field
    // E6 Palette Crush and E9 Ocean Breath are intentionally LEFT ALONE:
    // crush is a static chroma op (like invert); breath is a slow ambient
    // swell with no flash hazard. Blackout still zeroes output, so safety
    // is unaffected (report-3 GEM table: E6/E9 = NO panic).

    // Global invert (docs/39 §F-invert) is intentionally LEFT ALONE here:
    // panic kills active animation/flash, but invert is a persistent static
    // chroma op (like the group color-locks, which panic also preserves),
    // not a brightness/flash hazard. Blackout still zeroes the output,
    // so safety is unaffected.
  }
}

// Re-export for convenience.
export { GLOBAL_EFFECT_LIBRARY, SAFETY_TIERS, MAX_BURST_MS, validateParams };
