/**
 * lib/global_effect_library.js — Effect registry.
 *
 * Static metadata + presets + pure apply helpers for every v1 Global
 * Effect Macro. All MUTABLE runtime state (envelopes, counters,
 * feedback buffers, active preset ids) lives in
 * GlobalEffectsController — never here. See docs/28 §4.
 */
import { strobeEffect } from '../effects/strobe.js';
import { dropHitEffect } from '../effects/dropHit.js';
import { colorWashEffect } from '../effects/colorWash.js';
import { feedbackTrailsEffect } from '../effects/feedbackTrails.js';
import { vintageWhiteEffect } from '../effects/vintageWhite.js';
import { blastWhiteEffect } from '../effects/blastWhite.js';
import { uvBlastEffect } from '../effects/uvBlast.js';
import { foggerEffect } from '../effects/fogger.js';
import { invertEffect } from '../effects/invert.js';
// ── Party effects (report 20260708_2/_3, GEM-wired 20260708_7) ─────────
import { beatPumpEffect } from '../effects/e1_beat_pump.js';
import { waterlineSweepEffect } from '../effects/e2_waterline_sweep.js';
import { kickPunchEffect } from '../effects/e3_kick_punch.js';
import { freezeFrameEffect } from '../effects/freeze_frame.js';
import { paletteCrushEffect } from '../effects/palette_crush.js';
import { oceanBreathEffect } from '../effects/ocean_breath.js';
import { frostSparkleEffect } from '../effects/frost_sparkle.js';
import { movementTraceEffect } from '../effects/movement_trace.js';

/** Safety tiers, in increasing strictness. */
export const SAFETY_TIERS = Object.freeze({
  NORMAL: 'normal',
  WARNING: 'warning',
  HOLD_ONLY: 'hold_only',
  EXPERT_BURST: 'expert_burst',
});

/** Max single-burst duration accepted by the safety clamp (§5.2). */
export const MAX_BURST_MS = 2000;

// Library iteration order is operator-facing: the swap sheet in
// CaptainPad shows effects in this order, top to bottom. Operator
// review May 2026 asked for the original rig globals (vintage white,
// blast white, uv blast, fogger) to sit at the TOP so the most-used
// legacy cues are one tap away from the bottom of the swap list.
// Bypass-dimmer behavior is owned by the dimmer rack's
// BypassCheckbox (sets controller.effects.<effectId>BypassDimmer)
// — there is exactly ONE preset per legacy effect now (previously
// each had `default` + `bypass_dimmer` which confused the slot
// active-state logic and produced duplicate library entries).
export const GLOBAL_EFFECT_LIBRARY = {
  // ── Legacy rig-globals (operator favourites, listed first) ────────
  vintageWhite: {
    id: 'vintageWhite',
    name: 'Vintage White Boost',
    category: 'legacy',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    legacyEffectId: 'vintageWhite',
    presets: {
      default: {
        label: 'Vintage White',
        // No bypassDimmer override — that flag is owned by the
        // dimmer-rack BypassCheckbox now. See _dispatchLegacy.
        params: {},
        defaultBehavior: 'toggle',
      },
    },
    apply: vintageWhiteEffect.apply,
  },

  blastWhite: {
    id: 'blastWhite',
    name: 'Blast White',
    category: 'legacy',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    legacyEffectId: 'blastWhite',
    presets: {
      default: {
        label: 'Blast White',
        params: {},
        defaultBehavior: 'toggle',
      },
    },
    apply: blastWhiteEffect.apply,
  },

  uvBlast: {
    id: 'uvBlast',
    name: 'UV Blast',
    category: 'legacy',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    legacyEffectId: 'uvBlast',
    presets: {
      default: {
        label: 'UV Blast',
        params: {},
        defaultBehavior: 'toggle',
      },
    },
    apply: uvBlastEffect.apply,
  },

  fogger: {
    id: 'fogger',
    name: 'Fogger / Haze',
    category: 'legacy',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    legacyEffectId: 'fogger',
    // Declarative: the fogger is a bare on/off haze burst with NO magnitude
    // knob, so the VSN1 value encoder / jog-wheel has nothing to drive.
    // Surfaced on the slot-status API (`valueParam`) so the UI disables the
    // encoder for this slot instead of showing a dead knob. Purely
    // informational — no behavior change (primaryIntensity is already null).
    valueParam: 'none',
    presets: {
      default: {
        label: 'Fogger',
        params: {},
        defaultBehavior: 'toggle',
      },
    },
    apply: foggerEffect.apply,
  },

  // ── Modern macro effects ─────────────────────────────────────────
  strobe: {
    id: 'strobe',
    // Presented as "Strobe" (operator-approved party spec, 2026-07-11). The
    // frequency is no longer in the effect NAME — it moved to the primaryMode
    // 'Frequency' wheel (VSN1 encoder press) on strobeEffect.primaryMode, so
    // ONE "Strobe" slot walks 2/4/5/10/20 Hz and the jog-wheel sets Flash
    // Strength. The five per-Hz presets below are KEPT verbatim (backward-
    // compat: old playlists / state files / DEFAULT_SLOT_CONFIG reference
    // pulse_2hz…max_20hz) and each still carries its own display label +
    // safety tier. This IS the synced implementation (getFrameLockedStrobe*,
    // frame-locked to the 40 fps engine grid; each mode is an EXACT integer
    // divisor of 40 fps so there is zero quantization drift) — it supersedes
    // the pre-consolidation fixed-frequency strobe the operator found badly
    // tuned. There is no separate strobe module/id left to migrate.
    name: 'Strobe',
    category: 'gate',
    // Operator review May 2026 #10: all strobes are toggle-only now.
    // `hold` is removed across the entire library (hardware hold-to-
    // fire doesn't work on this rig), and operators want explicit
    // on/off control even for the fast presets — no auto-expiring
    // bursts. Safety tiers are kept for the corner pip but the
    // HOLD_ONLY / EXPERT_BURST behavior gates are dropped from the
    // dispatcher (see global_effect_slot_manager.js).
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: true,
    presets: {
      pulse_2hz: {
        label: '2 Hz Pulse',
        params: { hz: 2, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        safetyTier: SAFETY_TIERS.NORMAL,
      },
      sync_4hz: {
        label: '4 Hz Sync',
        params: { hz: 4, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        safetyTier: SAFETY_TIERS.NORMAL,
      },
      punch_5hz: {
        label: '5 Hz Punch',
        params: { hz: 5, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        safetyTier: SAFETY_TIERS.WARNING,
      },
      hard_10hz: {
        label: '10 Hz Hard',
        params: { hz: 10, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        // Demoted from HOLD_ONLY to WARNING — the operator-side hold
        // gesture isn't reliable and they want toggle-only operation.
        safetyTier: SAFETY_TIERS.WARNING,
      },
      max_20hz: {
        label: '20 Hz Max',
        params: { hz: 20, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        // Demoted from EXPERT_BURST: the dispatcher no longer enforces
        // burst-only on this preset. Operators tap it on, tap it off.
        safetyTier: SAFETY_TIERS.WARNING,
      },
    },
    apply: strobeEffect.apply,
    helpers: {
      getTiming: strobeEffect.getTiming,
      getGate: strobeEffect.getGate,
    },
  },

  dropHit: {
    id: 'dropHit',
    name: 'Drop Hit / Whiteout',
    category: 'envelope',
    behaviorTypes: ['trigger'],
    singleton: false,
    safetySensitive: false,
    presets: {
      white_drop: {
        // Display label only (operator-approved party spec 2026-07-11);
        // preset id `white_drop` stays stable for state/playlist compat.
        label: 'White Flash',
        params: {
          color: [1.0, 1.0, 1.0, 1.0, 0.2, 0.0],
          intensity: 1.0,
          attackMs: 25,
          holdMs: 75,
          releaseMs: 300,
          blendMode: 'add',
        },
        defaultBehavior: 'trigger',
      },
      iceberg_flash: {
        label: 'Iceberg Flash',
        params: {
          color: [0.3, 0.7, 1.0, 0.15, 0.0, 0.2],
          intensity: 1.0,
          attackMs: 20,
          holdMs: 90,
          releaseMs: 500,
          blendMode: 'add',
        },
        defaultBehavior: 'trigger',
      },
      vintage_burst: {
        label: 'Vintage Burst',
        params: {
          color: [1.0, 0.65, 0.25, 0.2, 1.0, 0.0],
          intensity: 1.0,
          attackMs: 25,
          holdMs: 120,
          releaseMs: 600,
          blendMode: 'add',
        },
        defaultBehavior: 'trigger',
      },
    },
    apply: dropHitEffect.apply,
    helpers: {
      envelopeValue: dropHitEffect.envelopeValue,
      envelopeDurationMs: dropHitEffect.envelopeDurationMs,
    },
  },

  colorWash: {
    id: 'colorWash',
    name: 'Color Wash Takeover',
    category: 'color',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      ocean_blue: {
        label: 'Ocean Blue',
        params: { color: [0.05, 0.20, 1.00, 0.00, 0.00, 0.15], amount: 0.7, mode: 'tint' },
        defaultBehavior: 'toggle',
      },
      iceberg_cyan: {
        label: 'Iceberg Cyan',
        params: { color: [0.15, 0.85, 1.00, 0.00, 0.00, 0.10], amount: 0.75, mode: 'tint' },
        defaultBehavior: 'toggle',
      },
      emergency_red: {
        label: 'Emergency Red',
        params: { color: [1.00, 0.00, 0.00, 0.00, 0.20, 0.00], amount: 0.9, mode: 'replace' },
        defaultBehavior: 'toggle',
      },
      vintage_amber: {
        label: 'Vintage Amber',
        params: { color: [1.00, 0.45, 0.05, 0.10, 1.00, 0.00], amount: 0.65, mode: 'tint' },
        defaultBehavior: 'toggle',
      },
      purple: {
        label: 'Purple',
        params: { color: [0.55, 0.00, 1.00, 0.00, 0.00, 0.25], amount: 0.75, mode: 'tint' },
        defaultBehavior: 'toggle',
      },
    },
    apply: colorWashEffect.apply,
  },

  // ── Global color Invert (docs/39 §F-invert) ──────────────────────
  // Now an ASSIGNABLE slot effect (channels-optimization campaign,
  // June 2026) instead of a dedicated fixed button. Routes through
  // GlobalEffectsController.setInvert / controller.invert — see
  // _isSlotActive / _dispatchResolved in global_effect_slot_manager.js.
  // No tunable params; a single 'default' preset; toggle-only.
  invert: {
    id: 'invert',
    name: 'Invert',
    category: 'color',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      default: {
        label: 'Invert',
        params: {},
        defaultBehavior: 'toggle',
      },
    },
  },

  feedbackTrails: {
    id: 'feedbackTrails',
    name: 'Feedback Trails / Ghost Trails',
    category: 'feedback',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      soft_afterimage: {
        label: 'Soft Afterimage',
        params: {
          decay: 0.88, injection: 0.45, mix: 0.45,
          blendMode: 'add', colorBleed: 0.02, resetOnEnable: true,
        },
        defaultBehavior: 'toggle',
      },
      ghost_ship: {
        label: 'Ghost Ship',
        params: {
          decay: 0.94, injection: 0.25, mix: 0.60,
          blendMode: 'replace', colorBleed: 0.12, resetOnEnable: true,
        },
        defaultBehavior: 'toggle',
      },
      long_afterimage: {
        label: 'Long Afterimage',
        params: {
          decay: 0.96, injection: 0.35, mix: 0.45,
          blendMode: 'add', colorBleed: 0.02, resetOnEnable: true,
        },
        defaultBehavior: 'toggle',
      },
      cosmic_trails: {
        label: 'Cosmic Trails',
        params: {
          decay: 0.93, injection: 0.40, mix: 0.55,
          blendMode: 'max', colorBleed: 0.08, resetOnEnable: true,
        },
        defaultBehavior: 'toggle',
      },
    },
    apply: feedbackTrailsEffect.apply,
  },

  // ── Party effects — assignable to GEM slots (report 20260708_7) ────
  // Wave-1 (E1/E2/E3) were config-gated chain stages; E4/E6/E9/E10 were
  // standalone modules. All seven are now first-class library entries so
  // they can sit on the 8 UI/MIDI effect slots and route through the slot
  // manager's activate/deactivate/trigger/toggle/down/up + intensity paths.
  // Each entry's `apply` fn is the module's per-frame transform (the
  // controller drives it at the documented chain anchor); the slot manager
  // never calls `.apply` directly for these — it flips controller state via
  // the dedicated setters, exactly like strobe/wash/trails.

  // E1 Beat Pump — BPM-locked luminance duck (END of applyMacros). Toggle.
  beatPump: {
    id: 'beatPump',
    name: 'Beat Pump',
    category: 'gate',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      soft:   { label: 'Soft Pump',   params: { depth: 0.35, rate: 1,   curve: 2 }, defaultBehavior: 'toggle' },
      deep:   { label: 'Deep Pump',   params: { depth: 0.6,  rate: 1,   curve: 2 }, defaultBehavior: 'toggle' },
      halftime: { label: 'Half-Time', params: { depth: 0.5,  rate: 0.5, curve: 2 }, defaultBehavior: 'toggle' },
    },
    apply: beatPumpEffect.apply,
  },

  // E2 Waterline Sweep — spatial band across nx/ny/nz (step 1.5). Toggle.
  // MOVEMENT family - patterns that travel along a GROUP, keyed on where a
  // pixel sits inside that group rather than on world coordinates. They place
  // the operator's palette and never invent colour, so they stack with the
  // colour picker instead of fighting it. See effects/movement_trace.js.
  movementTrace: {
    id: 'movementTrace',
    name: 'Movement Trace',
    category: 'movement',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    valueParam: 'amount',
    presets: {
      every_other_repeat: {
        label: 'Every Other - Repeat',
        params: { mode: 'every_other', travel: 'repeat', blank: true, amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      every_other_reverse: {
        label: 'Every Other - Reverse',
        params: { mode: 'every_other', travel: 'reverse', blank: true, amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      every_other_two_tone: {
        label: 'Every Other - Two Tone',
        params: { mode: 'every_other', travel: 'repeat', blank: false, amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      one_per_color_repeat: {
        label: 'One Per Colour - Repeat',
        params: { mode: 'one_per_color', travel: 'repeat', amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      one_per_color_reverse: {
        label: 'One Per Colour - Reverse',
        params: { mode: 'one_per_color', travel: 'reverse', amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      pulse_slow_fade: {
        label: 'Pulse - Burst then Long Fade',
        params: { mode: 'pulse', travel: 'repeat', amount: 1, fadeSpan: 0, sync: 'free',
          pixelsPerSecond: 0, burstMs: 200, decayMs: 5000, floor: 0.04 },
        defaultBehavior: 'toggle',
      },
      whole_group_repeat: {
        label: 'One Colour At A Time',
        params: { mode: 'whole_group', travel: 'repeat', amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      whole_group_reverse: {
        label: 'One Colour At A Time - Reverse',
        params: { mode: 'whole_group', travel: 'reverse', amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 1 },
        defaultBehavior: 'toggle',
      },
      one_per_color_double: {
        label: 'One Per Colour - Double Time',
        params: { mode: 'one_per_color', travel: 'repeat', amount: 1, fadeSpan: 1, sync: 'beat', pixelsPerBeat: 2 },
        defaultBehavior: 'toggle',
      },
    },
    apply: movementTraceEffect.apply,
  },

  waterlineSweep: {
    id: 'waterlineSweep',
    name: 'Waterline Sweep',
    category: 'spatial',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      rising_tide: {
        label: 'Rising Tide',
        params: { axis: 'y', width: 0.25, amount: 0.7, mode: 'add', color: [0.15, 0.5, 1.0, 0.0, 0.0, 0.0], speedHz: 0.25, sync: 'free' },
        defaultBehavior: 'toggle',
      },
      beat_wipe: {
        label: 'Beat Wipe',
        params: { axis: 'y', width: 0.2, amount: 0.8, mode: 'add', color: [0.2, 0.6, 1.0, 0.0, 0.0, 0.0], speedHz: 0.5, sync: 'beat' },
        defaultBehavior: 'toggle',
      },
      shadow_pass: {
        label: 'Shadow Pass',
        params: { axis: 'x', width: 0.3, amount: 0.6, mode: 'darken', color: [0, 0, 0, 0, 0, 0], speedHz: 0.2, sync: 'free' },
        defaultBehavior: 'toggle',
      },
    },
    apply: waterlineSweepEffect.apply,
  },

  // E3 Kick Punch — controller-level trigger router reusing dropHit.
  // Behaviors: `trigger` fires one hit; `toggle` arms the auto router
  // (fires on live kicks). Spec: trigger-or-auto.
  kickPunch: {
    id: 'kickPunch',
    name: 'Kick Punch',
    category: 'envelope',
    behaviorTypes: ['trigger', 'toggle'],
    singleton: false,
    safetySensitive: false,
    presets: {
      punch: {
        label: 'Punch',
        params: {
          threshold: 0.6, minGapMs: 120, source: 'auto',
          intensityFloor: 0.6, intensityCeil: 1.0,
          color: [1.0, 1.0, 1.0, 1.0, 0.2, 0.0],
          attackMs: 20, holdMs: 60, releaseMs: 200, blendMode: 'add',
        },
        defaultBehavior: 'trigger',
      },
      ice_punch: {
        label: 'Ice Punch',
        params: {
          threshold: 0.65, minGapMs: 140, source: 'auto',
          intensityFloor: 0.5, intensityCeil: 1.0,
          color: [0.3, 0.7, 1.0, 0.5, 0.0, 0.2],
          attackMs: 20, holdMs: 80, releaseMs: 300, blendMode: 'add',
        },
        defaultBehavior: 'trigger',
      },
    },
    apply: kickPunchEffect.shouldFire, // present for parity; controller owns routing
  },

  // E4 Freeze Frame — captures + replays the frame (preWash, step 0).
  freeze: {
    id: 'freeze',
    name: 'Freeze Frame',
    category: 'time',
    behaviorTypes: ['toggle', 'hold'],
    singleton: true,
    safetySensitive: false,
    presets: {
      hold:    { label: 'Hold',     params: { holdFadeMs: 0 },    defaultBehavior: 'hold' },
      fade_2s: { label: 'Fade 2s',  params: { holdFadeMs: 2000 }, defaultBehavior: 'toggle' },
      stutter: { label: 'Stutter',  params: { holdFadeMs: 0 },    defaultBehavior: 'toggle' },
    },
    apply: freezeFrameEffect.apply,
  },

  // E6 Palette Crush — RGB posterize (postInvert chroma stage). Toggle.
  crush: {
    id: 'crush',
    name: 'Palette Crush',
    category: 'color',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      hard_2:  { label: '2-level',      params: { levels: 2, amount: 1 },   defaultBehavior: 'toggle' },
      bold_4:  { label: '4-level',      params: { levels: 4, amount: 1 },   defaultBehavior: 'toggle' },
      soft_6:  { label: '6-level soft', params: { levels: 6, amount: 0.6 }, defaultBehavior: 'toggle' },
    },
    apply: paletteCrushEffect.apply,
  },

  // E9 Ocean Breath — slow ambient swell (END of applyMacros). Toggle.
  breath: {
    id: 'breath',
    name: 'Ocean Breath',
    category: 'ambient',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      calm:    { label: 'Calm 8s',  params: { periodMs: 8000,  depth: 0.35, warmth: 0.2 }, defaultBehavior: 'toggle' },
      deep:    { label: 'Deep 14s', params: { periodMs: 14000, depth: 0.5,  warmth: 0.3 }, defaultBehavior: 'toggle' },
      sunrise: { label: 'Sunrise',  params: { periodMs: 20000, depth: 0.4,  warmth: 0.5 }, defaultBehavior: 'toggle' },
    },
    apply: oceanBreathEffect.apply,
  },

  // E10 Frost Sparkle — W-channel glint overlay (postTrails). Toggle.
  sparkle: {
    id: 'sparkle',
    name: 'Frost Sparkle',
    category: 'overlay',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      fizz:     { label: 'Fizz',     params: { density: 0.01, decayMs: 400, intensity: 1, audioDensity: false }, defaultBehavior: 'toggle' },
      blizzard: { label: 'Blizzard', params: { density: 0.15, decayMs: 80,  intensity: 1, audioDensity: false }, defaultBehavior: 'toggle' },
      hihat:    { label: 'Hi-Hat',   params: { density: 0.0,  decayMs: 120, intensity: 1, audioDensity: true  }, defaultBehavior: 'toggle' },
    },
    apply: frostSparkleEffect.apply,
  },

};

// ── Primary-intensity registry (docs/42 VSN1 jog-wheel) ───────────────
//
// Each GEM-bindable effect exposes ONE "primary intensity": the single
// most party-meaningful knob, so a normalized 0..1 value (from the VSN1
// endless jog-wheel, or POST /global-effect-slots/:id/intensity) maps
// linearly onto that param's real range. The descriptor lives on the
// effect MODULE (`xEffect.primaryIntensity`) so it sits next to the code
// it drives; this registry pins each library effectId to its module's
// descriptor and validates the wiring at load.
//
// Descriptor shape: { label, param, default, min, max }
//   - label    operator-facing name for the knob (e.g. 'Flash Strength').
//   - param    the effect param the intensity writes (e.g. 'intensity').
//   - default  the param value used when intensity was never touched.
//   - min/max  the real param range a normalized 0..1 maps onto.
// An effect with NO tunable magnitude declares `primaryIntensity: null`
// explicitly — a deliberate "no primary", distinct from a MISSING
// declaration which is a hard startup error (Codex P0: no silent
// fallbacks).
//
// `map01ToPrimary` / `mapPrimaryTo01` convert between the normalized 0..1
// API value and the real param value.
const PRIMARY_INTENSITY_SOURCES = {
  strobe: strobeEffect,
  dropHit: dropHitEffect,
  colorWash: colorWashEffect,
  feedbackTrails: feedbackTrailsEffect,
  invert: invertEffect,
  vintageWhite: vintageWhiteEffect,
  blastWhite: blastWhiteEffect,
  uvBlast: uvBlastEffect,
  fogger: foggerEffect,
  // Party effects (report 20260708_7) — each module declares its own
  // primaryIntensity descriptor next to its code; pin it here so the
  // registry validates the wiring at load.
  beatPump: beatPumpEffect,
  waterlineSweep: waterlineSweepEffect,
  kickPunch: kickPunchEffect,
  freeze: freezeFrameEffect,
  crush: paletteCrushEffect,
  breath: oceanBreathEffect,
  sparkle: frostSparkleEffect,
  // MOVEMENT family. Was in GLOBAL_EFFECT_LIBRARY but never pinned here, so
  // it was the one library effect with no registry entry - both registry
  // completeness tests failed and getPrimaryIntensity('movementTrace') threw.
  movementTrace: movementTraceEffect,
};

/**
 * Validate + freeze one effect's primary-intensity descriptor. Throws on a
 * MISSING declaration (undefined) or a malformed one. An explicit `null`
 * ("no primary") passes through unchanged. Exported so tests can lock the
 * loud-error contract (Codex P0: a forgotten declaration must crash, never
 * silently default).
 */
export function normalizePrimaryDescriptor(effectId, desc) {
  if (desc === undefined) {
    throw new Error(
      `Effect '${effectId}' is missing a primaryIntensity declaration. ` +
      `Every GEM-bindable effect module MUST export primaryIntensity ` +
      `({label,param,default,min,max}) or an explicit null (no primary).`
    );
  }
  if (desc === null) return null;
  if (typeof desc !== 'object') {
    throw new Error(`Effect '${effectId}' primaryIntensity must be an object or null`);
  }
  const { label, param, default: def, min, max } = desc;
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(`Effect '${effectId}' primaryIntensity.label must be a non-empty string`);
  }
  if (typeof param !== 'string' || param.length === 0) {
    throw new Error(`Effect '${effectId}' primaryIntensity.param must be a non-empty string`);
  }
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || !(max > min)) {
    throw new Error(`Effect '${effectId}' primaryIntensity min/max must be finite with max>min`);
  }
  if (!isFiniteNumber(def) || def < min || def > max) {
    throw new Error(`Effect '${effectId}' primaryIntensity.default=${def} out of [${min}..${max}]`);
  }
  return Object.freeze({ label, param, default: def, min, max });
}

/**
 * effectId → frozen primary-intensity descriptor (or null). Built + fully
 * validated at module load so a forgotten declaration crashes the engine at
 * boot, never at showtime.
 */
export const PRIMARY_INTENSITY_REGISTRY = Object.freeze(
  Object.fromEntries(
    Object.entries(PRIMARY_INTENSITY_SOURCES).map(([id, fx]) => [
      id,
      normalizePrimaryDescriptor(id, fx ? fx.primaryIntensity : undefined),
    ])
  )
);

/**
 * Look up an effect's primary-intensity descriptor.
 * @returns {{label,param,default,min,max}|null} frozen descriptor, or null
 *   when the effect declares no primary.
 * @throws when the effectId is unknown to the registry.
 */
export function getPrimaryIntensity(effectId) {
  if (!Object.prototype.hasOwnProperty.call(PRIMARY_INTENSITY_REGISTRY, effectId)) {
    throw new Error(`getPrimaryIntensity: unknown effectId '${effectId}'`);
  }
  return PRIMARY_INTENSITY_REGISTRY[effectId];
}

// ── Primary-mode registry (docs/42 VSN1 encoder-press) ────────────────
//
// The SECOND MIDI-addressable control on every GEM-bindable effect: a
// DISCRETE mode/toggle cycled by the VSN1 encoder press (or POST
// /global-effect-slots/:id/mode/cycle). Mirrors the primaryIntensity
// pattern exactly — the descriptor lives on the effect MODULE
// (`xEffect.primaryMode`) so it sits next to the code it drives, and this
// registry pins each library effectId to its module's descriptor and
// validates the wiring at load.
//
// Descriptor shape: { label, param, values: [...], default, valueLabels? }
//   - label    operator-facing name for the mode wheel (e.g. 'Tempo').
//   - param    the effect param the mode writes (e.g. 'rate', 'sync').
//   - values   the ordered discrete list the encoder cycles through. A
//              boolean toggle is just a 2-value list ([false, true]); a
//              tempo selector is [0.5, 1, 2]; a text enum is a string list.
//   - default  the value used when the mode was never touched (MUST be a
//              member of `values`).
//   - valueLabels  OPTIONAL parallel array of operator-facing display strings,
//              one per `values` entry (same length). Surfaces render these on
//              the VSN1 LCD + CaptainPad instead of the raw value so a numeric
//              mode reads e.g. "2 Hz · 1/4" not a bare "2" (and never "M1/M2").
//              Omit it and the surfaces fall back to the raw value — no effect
//              is REQUIRED to declare labels.
// An effect with NO discrete mode declares `primaryMode: null` explicitly
// — a deliberate "no mode", distinct from a MISSING declaration which is a
// hard startup error (Codex P0: no silent fallbacks), exactly as the
// primaryIntensity registry treats a forgotten declaration.

const PRIMARY_MODE_SOURCES = PRIMARY_INTENSITY_SOURCES; // same module set

/**
 * Validate + freeze one effect's primary-mode descriptor. Throws on a
 * MISSING declaration (undefined) or a malformed one. An explicit `null`
 * ("no mode") passes through unchanged. Exported so tests can lock the
 * loud-error contract (Codex P0: a forgotten declaration must crash, never
 * silently default).
 */
export function normalizeModeDescriptor(effectId, desc) {
  if (desc === undefined) {
    throw new Error(
      `Effect '${effectId}' is missing a primaryMode declaration. ` +
      `Every GEM-bindable effect module MUST export primaryMode ` +
      `({label,param,values,default}) or an explicit null (no mode).`
    );
  }
  if (desc === null) return null;
  if (typeof desc !== 'object') {
    throw new Error(`Effect '${effectId}' primaryMode must be an object or null`);
  }
  const { label, param, values, default: def, valueLabels } = desc;
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(`Effect '${effectId}' primaryMode.label must be a non-empty string`);
  }
  if (typeof param !== 'string' || param.length === 0) {
    throw new Error(`Effect '${effectId}' primaryMode.param must be a non-empty string`);
  }
  if (!Array.isArray(values) || values.length < 2) {
    throw new Error(`Effect '${effectId}' primaryMode.values must be an array of >= 2 entries`);
  }
  if (!modeValuesInclude(values, def)) {
    throw new Error(`Effect '${effectId}' primaryMode.default=${JSON.stringify(def)} not in values`);
  }
  // Optional per-value display labels. If present, MUST be a string array the
  // same length as `values` (loud on a mismatch — Codex P0: no silent skew
  // between a value and the label the operator reads on the LCD). Absent =>
  // surfaces fall back to the raw value.
  let frozenLabels = null;
  if (valueLabels !== undefined) {
    if (!Array.isArray(valueLabels) || valueLabels.length !== values.length) {
      throw new Error(
        `Effect '${effectId}' primaryMode.valueLabels must be an array of ${values.length} ` +
        `(one per value)`
      );
    }
    if (!valueLabels.every((s) => typeof s === 'string' && s.length > 0)) {
      throw new Error(`Effect '${effectId}' primaryMode.valueLabels must all be non-empty strings`);
    }
    frozenLabels = Object.freeze([...valueLabels]);
  }
  return Object.freeze({
    label, param, values: Object.freeze([...values]), default: def, valueLabels: frozenLabels,
  });
}

/** Strict membership check for a mode value inside a values list. */
function modeValuesInclude(values, v) {
  return values.some((x) => x === v);
}

/**
 * effectId → frozen primary-mode descriptor (or null). Built + fully
 * validated at module load so a forgotten declaration crashes the engine at
 * boot, never at showtime.
 */
export const PRIMARY_MODE_REGISTRY = Object.freeze(
  Object.fromEntries(
    Object.entries(PRIMARY_MODE_SOURCES).map(([id, fx]) => [
      id,
      normalizeModeDescriptor(id, fx ? fx.primaryMode : undefined),
    ])
  )
);

/**
 * Look up an effect's primary-mode descriptor.
 * @returns {{label,param,values,default}|null} frozen descriptor, or null
 *   when the effect declares no mode.
 * @throws when the effectId is unknown to the registry.
 */
export function getPrimaryMode(effectId) {
  if (!Object.prototype.hasOwnProperty.call(PRIMARY_MODE_REGISTRY, effectId)) {
    throw new Error(`getPrimaryMode: unknown effectId '${effectId}'`);
  }
  return PRIMARY_MODE_REGISTRY[effectId];
}

/**
 * The index of a mode value within its effect's `values` list. Returns the
 * default's index when `value` is null/undefined or not a member (so a
 * stale/absent value resolves to the default, never a silent -1). Throws
 * when the effect has no mode.
 */
export function modeIndexOf(effectId, value) {
  const d = getPrimaryMode(effectId);
  if (!d) throw new Error(`Effect '${effectId}' has no primary mode`);
  const i = d.values.findIndex((x) => x === value);
  if (i >= 0) return i;
  return d.values.findIndex((x) => x === d.default);
}

/**
 * The NEXT mode value after `current`, wrapping around the list. Used by the
 * encoder-press cycle. A null/absent `current` starts from the default, so
 * the first cycle steps default → next. Throws when the effect has no mode.
 */
export function nextModeValue(effectId, current) {
  const d = getPrimaryMode(effectId);
  if (!d) throw new Error(`Effect '${effectId}' has no primary mode`);
  const i = modeIndexOf(effectId, current);
  return d.values[(i + 1) % d.values.length];
}

/**
 * Map a normalized 0..1 intensity onto the effect's real primary param
 * value. Clamps `v01` to [0,1] first. Throws if the effect has no primary.
 */
export function map01ToPrimary(effectId, v01) {
  const d = getPrimaryIntensity(effectId);
  if (!d) throw new Error(`Effect '${effectId}' has no primary intensity`);
  const t = v01 < 0 ? 0 : v01 > 1 ? 1 : v01;
  return d.min + (d.max - d.min) * t;
}

/**
 * Inverse of map01ToPrimary: map a real primary param value back to the
 * normalized 0..1 scale. Clamps the result to [0,1].
 */
export function mapPrimaryTo01(effectId, value) {
  const d = getPrimaryIntensity(effectId);
  if (!d) throw new Error(`Effect '${effectId}' has no primary intensity`);
  const t = (value - d.min) / (d.max - d.min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Serializable description of the registry (no fn refs) for
 * GET /global-effect-library.
 */
export function describeLibrary(library = GLOBAL_EFFECT_LIBRARY) {
  const out = {};
  for (const [id, fx] of Object.entries(library)) {
    out[id] = {
      id: fx.id,
      name: fx.name,
      category: fx.category,
      behaviorTypes: [...fx.behaviorTypes],
      singleton: !!fx.singleton,
      safetySensitive: !!fx.safetySensitive,
      legacyEffectId: fx.legacyEffectId || null,
      // Declarative value-encoder opt-out (e.g. fogger → 'none'); null when
      // the effect declares nothing, so the VSN1/UI knows to disable the knob.
      valueParam: fx.valueParam !== undefined ? fx.valueParam : null,
      presets: Object.fromEntries(
        Object.entries(fx.presets).map(([pid, p]) => [pid, {
          id: pid,
          label: p.label,
          defaultBehavior: p.defaultBehavior,
          safetyTier: p.safetyTier || SAFETY_TIERS.NORMAL,
          params: JSON.parse(JSON.stringify(p.params)),
        }])
      ),
    };
  }
  return out;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Validate a color6 (RGBWAU) array per §5.2.
 */
export function validateColor6(c) {
  if (!Array.isArray(c) || c.length !== 6) {
    throw new Error('color must be a 6-element RGBWAU array');
  }
  for (let i = 0; i < 6; i++) {
    if (!isFiniteNumber(c[i]) || c[i] < 0 || c[i] > 1) {
      throw new Error(`color[${i}]=${c[i]} out of range [0..1]`);
    }
  }
}

/**
 * Validate a params override blob against an effect spec. Mutates &
 * returns a sanitized copy. Throws on unrecoverable errors.
 *
 * - Numeric clamps applied silently per design spec (e.g. burst
 *   durations >2000ms are clamped, not rejected).
 * - Structural errors (wrong types, bad shapes, missing keys) THROW.
 *   The dispatcher converts these to 400s.
 */
export function validateParams(effectId, params = {}) {
  const out = { ...params };
  switch (effectId) {
    case 'strobe': {
      if (out.hz !== undefined) {
        if (!isFiniteNumber(out.hz)) throw new Error('strobe.hz must be a number');
        if (out.hz < 1.0 || out.hz > 20.0) {
          throw new Error(`strobe.hz=${out.hz} out of safety range [1..20]`);
        }
      }
      if (out.duty !== undefined) {
        if (!isFiniteNumber(out.duty) || out.duty < 0.05 || out.duty > 0.95) {
          throw new Error(`strobe.duty=${out.duty} out of range [0.05..0.95]`);
        }
      }
      if (out.intensity !== undefined) {
        if (!isFiniteNumber(out.intensity)) throw new Error('strobe.intensity must be a number');
        out.intensity = clamp01(out.intensity);
      }
      if (out.durationMs !== undefined) {
        if (!isFiniteNumber(out.durationMs) || out.durationMs <= 0) {
          throw new Error(`strobe.durationMs=${out.durationMs} must be > 0`);
        }
        if (out.durationMs > MAX_BURST_MS) out.durationMs = MAX_BURST_MS;
      }
      if (out.fadeOutMs !== undefined) {
        if (!isFiniteNumber(out.fadeOutMs) || out.fadeOutMs < 0) {
          throw new Error(`strobe.fadeOutMs=${out.fadeOutMs} must be a non-negative number`);
        }
      }
      break;
    }
    case 'dropHit': {
      if (out.color !== undefined) validateColor6(out.color);
      if (out.intensity !== undefined) {
        if (!isFiniteNumber(out.intensity)) throw new Error('dropHit.intensity must be a number');
        out.intensity = clamp01(out.intensity);
      }
      for (const k of ['attackMs', 'holdMs', 'releaseMs']) {
        if (out[k] !== undefined) {
          if (!isFiniteNumber(out[k]) || out[k] < 0) {
            throw new Error(`dropHit.${k}=${out[k]} must be a non-negative number`);
          }
        }
      }
      if (out.blendMode !== undefined && !['add', 'replace', 'max'].includes(out.blendMode)) {
        throw new Error(`dropHit.blendMode='${out.blendMode}' must be one of add|replace|max`);
      }
      break;
    }
    case 'colorWash': {
      if (out.color !== undefined) validateColor6(out.color);
      if (out.amount !== undefined) {
        if (!isFiniteNumber(out.amount) || out.amount < 0 || out.amount > 1) {
          throw new Error(`colorWash.amount=${out.amount} out of range [0..1]`);
        }
      }
      if (out.mode !== undefined && !['tint', 'replace', 'multiply', 'max'].includes(out.mode)) {
        throw new Error(`colorWash.mode='${out.mode}' must be one of tint|replace|multiply|max`);
      }
      if (out.fadeOutMs !== undefined) {
        if (!isFiniteNumber(out.fadeOutMs) || out.fadeOutMs < 0) {
          throw new Error(`colorWash.fadeOutMs=${out.fadeOutMs} must be a non-negative number`);
        }
      }
      break;
    }
    case 'feedbackTrails': {
      for (const k of ['decay', 'injection', 'mix', 'colorBleed']) {
        if (out[k] !== undefined) {
          if (!isFiniteNumber(out[k]) || out[k] < 0 || out[k] > 1) {
            throw new Error(`feedbackTrails.${k}=${out[k]} out of range [0..1]`);
          }
        }
      }
      if (out.blendMode !== undefined && !['add', 'replace', 'max'].includes(out.blendMode)) {
        throw new Error(`feedbackTrails.blendMode='${out.blendMode}' must be one of add|replace|max`);
      }
      if (out.fadeOutMs !== undefined) {
        if (!isFiniteNumber(out.fadeOutMs) || out.fadeOutMs < 0) {
          throw new Error(`feedbackTrails.fadeOutMs=${out.fadeOutMs} must be a non-negative number`);
        }
      }
      break;
    }
    case 'vintageWhite':
    case 'blastWhite':
    case 'uvBlast': {
      if (out.bypassDimmer !== undefined && typeof out.bypassDimmer !== 'boolean') {
        throw new Error(`${effectId}.bypassDimmer must be a boolean`);
      }
      break;
    }
    case 'fogger': {
      // No tunable params; ignore any overrides.
      break;
    }
    case 'invert': {
      // No tunable params; ignore any overrides (toggle-only global).
      break;
    }
    // ── Party effects (report 20260708_7) ────────────────────────────
    case 'beatPump': {
      if (out.depth !== undefined) {
        if (!isFiniteNumber(out.depth) || out.depth < 0 || out.depth > 1) {
          throw new Error(`beatPump.depth=${out.depth} out of range [0..1]`);
        }
      }
      if (out.rate !== undefined) {
        if (!isFiniteNumber(out.rate) || out.rate <= 0) {
          throw new Error(`beatPump.rate=${out.rate} must be > 0`);
        }
      }
      if (out.curve !== undefined) {
        if (!isFiniteNumber(out.curve) || out.curve <= 0) {
          throw new Error(`beatPump.curve=${out.curve} must be > 0`);
        }
      }
      break;
    }
    case 'movementTrace': {
      if (out.mode !== undefined && !['every_other', 'one_per_color', 'whole_group', 'pulse'].includes(out.mode)) {
        throw new Error(`movementTrace.mode='${out.mode}' must be one of every_other|one_per_color|whole_group|pulse`);
      }
      for (const k of ['burstMs', 'decayMs']) {
        if (out[k] !== undefined && (!isFiniteNumber(out[k]) || out[k] < 0)) {
          throw new Error(`movementTrace.${k}=${out[k]} must be a non-negative number`);
        }
      }
      if (out.floor !== undefined) {
        if (!isFiniteNumber(out.floor)) throw new Error('movementTrace.floor must be a number');
        out.floor = clamp01(out.floor);
      }
      if (out.travel !== undefined && !['repeat', 'reverse'].includes(out.travel)) {
        throw new Error(`movementTrace.travel='${out.travel}' must be one of repeat|reverse`);
      }
      if (out.amount !== undefined) {
        if (!isFiniteNumber(out.amount)) throw new Error('movementTrace.amount must be a number');
        out.amount = clamp01(out.amount);
      }
      if (out.blank !== undefined && typeof out.blank !== 'boolean') {
        throw new Error('movementTrace.blank must be a boolean');
      }
      if (out.fadeSpan !== undefined) {
        if (!isFiniteNumber(out.fadeSpan)) throw new Error('movementTrace.fadeSpan must be a number');
        out.fadeSpan = clamp01(out.fadeSpan);
      }
      if (out.switchMs !== undefined) {
        if (!isFiniteNumber(out.switchMs) || out.switchMs < 0) {
          throw new Error(`movementTrace.switchMs=${out.switchMs} must be a non-negative number`);
        }
      }
      if (out.pixelsPerBeat !== undefined) {
        if (!isFiniteNumber(out.pixelsPerBeat) || out.pixelsPerBeat < 0) {
          throw new Error(`movementTrace.pixelsPerBeat=${out.pixelsPerBeat} must be a non-negative number`);
        }
      }
      if (out.pixelsPerSecond !== undefined) {
        if (!isFiniteNumber(out.pixelsPerSecond) || out.pixelsPerSecond < 0) {
          throw new Error(`movementTrace.pixelsPerSecond=${out.pixelsPerSecond} must be a non-negative number`);
        }
      }
      if (out.sync !== undefined && !['free', 'beat'].includes(out.sync)) {
        throw new Error(`movementTrace.sync='${out.sync}' must be one of free|beat`);
      }
      if (out.colors !== undefined) {
        if (!Array.isArray(out.colors) || out.colors.length === 0) {
          throw new Error('movementTrace.colors must be a non-empty array of 6-channel colors');
        }
        out.colors.forEach((c) => validateColor6(c));
      }
      break;
    }
    case 'waterlineSweep': {
      if (out.axis !== undefined && !['x', 'y', 'z', 'radial'].includes(out.axis)) {
        throw new Error(`waterlineSweep.axis='${out.axis}' must be one of x|y|z|radial`);
      }
      if (out.width !== undefined) {
        if (!isFiniteNumber(out.width) || out.width <= 0 || out.width > 1) {
          throw new Error(`waterlineSweep.width=${out.width} must be in (0..1]`);
        }
      }
      if (out.amount !== undefined) {
        if (!isFiniteNumber(out.amount)) throw new Error('waterlineSweep.amount must be a number');
        out.amount = clamp01(out.amount);
      }
      if (out.mode !== undefined && !['add', 'darken'].includes(out.mode)) {
        throw new Error(`waterlineSweep.mode='${out.mode}' must be one of add|darken`);
      }
      if (out.color !== undefined) validateColor6(out.color);
      if (out.speedHz !== undefined) {
        if (!isFiniteNumber(out.speedHz) || out.speedHz < 0) {
          throw new Error(`waterlineSweep.speedHz=${out.speedHz} must be a non-negative number`);
        }
      }
      if (out.sync !== undefined && !['free', 'beat', 'bar'].includes(out.sync)) {
        throw new Error(`waterlineSweep.sync='${out.sync}' must be one of free|beat|bar`);
      }
      break;
    }
    case 'kickPunch': {
      if (out.color !== undefined) validateColor6(out.color);
      if (out.threshold !== undefined) {
        if (!isFiniteNumber(out.threshold)) throw new Error('kickPunch.threshold must be a number');
        out.threshold = clamp01(out.threshold);
      }
      if (out.minGapMs !== undefined) {
        if (!isFiniteNumber(out.minGapMs) || out.minGapMs < 0) {
          throw new Error(`kickPunch.minGapMs=${out.minGapMs} must be a non-negative number`);
        }
      }
      if (out.source !== undefined && !['auto', 'dropPulse', 'kick'].includes(out.source)) {
        throw new Error(`kickPunch.source='${out.source}' must be one of auto|dropPulse|kick`);
      }
      for (const k of ['intensityFloor', 'intensityCeil']) {
        if (out[k] !== undefined) {
          if (!isFiniteNumber(out[k])) throw new Error(`kickPunch.${k} must be a number`);
          out[k] = clamp01(out[k]);
        }
      }
      for (const k of ['attackMs', 'holdMs', 'releaseMs']) {
        if (out[k] !== undefined) {
          if (!isFiniteNumber(out[k]) || out[k] < 0) {
            throw new Error(`kickPunch.${k}=${out[k]} must be a non-negative number`);
          }
        }
      }
      if (out.blendMode !== undefined && !['add', 'replace', 'max'].includes(out.blendMode)) {
        throw new Error(`kickPunch.blendMode='${out.blendMode}' must be one of add|replace|max`);
      }
      break;
    }
    case 'freeze': {
      if (out.holdFadeMs !== undefined) {
        if (!isFiniteNumber(out.holdFadeMs) || out.holdFadeMs < 0) {
          throw new Error(`freeze.holdFadeMs=${out.holdFadeMs} must be a non-negative number`);
        }
      }
      break;
    }
    case 'crush': {
      if (out.levels !== undefined) {
        if (!isFiniteNumber(out.levels)) throw new Error('crush.levels must be a number');
        // Clamped + rounded inside the module; clamp here too for a clean status.
        out.levels = Math.max(2, Math.min(8, Math.round(out.levels)));
      }
      if (out.amount !== undefined) {
        if (!isFiniteNumber(out.amount)) throw new Error('crush.amount must be a number');
        out.amount = clamp01(out.amount);
      }
      break;
    }
    case 'breath': {
      if (out.periodMs !== undefined) {
        if (!isFiniteNumber(out.periodMs) || out.periodMs <= 0) {
          throw new Error(`breath.periodMs=${out.periodMs} must be > 0`);
        }
      }
      if (out.depth !== undefined) {
        if (!isFiniteNumber(out.depth) || out.depth < 0 || out.depth > 0.6) {
          throw new Error(`breath.depth=${out.depth} out of range [0..0.6]`);
        }
      }
      if (out.warmth !== undefined) {
        if (!isFiniteNumber(out.warmth)) throw new Error('breath.warmth must be a number');
        out.warmth = clamp01(out.warmth);
      }
      break;
    }
    case 'sparkle': {
      if (out.density !== undefined) {
        if (!isFiniteNumber(out.density) || out.density < 0) {
          throw new Error(`sparkle.density=${out.density} must be a non-negative number`);
        }
      }
      if (out.decayMs !== undefined) {
        if (!isFiniteNumber(out.decayMs) || out.decayMs < 0) {
          throw new Error(`sparkle.decayMs=${out.decayMs} must be a non-negative number`);
        }
      }
      if (out.intensity !== undefined) {
        if (!isFiniteNumber(out.intensity)) throw new Error('sparkle.intensity must be a number');
        out.intensity = clamp01(out.intensity);
      }
      if (out.audioDensity !== undefined && typeof out.audioDensity !== 'boolean') {
        throw new Error('sparkle.audioDensity must be a boolean');
      }
      break;
    }
    default:
      throw new Error(`Unknown effectId: ${effectId}`);
  }
  return out;
}
