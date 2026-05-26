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
    name: 'Software Sync Strobe',
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
        label: 'White Drop',
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
          color: [0.3, 0.7, 1.0, 0.5, 0.0, 0.2],
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
        params: { color: [0.15, 0.85, 1.00, 0.20, 0.00, 0.10], amount: 0.75, mode: 'tint' },
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
    },
    apply: colorWashEffect.apply,
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

};
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
    default:
      throw new Error(`Unknown effectId: ${effectId}`);
  }
  return out;
}
