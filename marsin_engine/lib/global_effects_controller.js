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
} from './global_effect_library.js';
import { strobeEffect } from '../effects/strobe.js';
import { dropHitEffect } from '../effects/dropHit.js';
import { colorWashEffect } from '../effects/colorWash.js';
import { feedbackTrailsEffect } from '../effects/feedbackTrails.js';

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

    // Color wash.
    this.colorWashConfig = {
      enabled: false,
      preset: null,
      color: null,
      amount: 0,
      mode: 'tint',
      slotId: null,
      fadingOut: false,
      fadeStartMs: 0,
      fadeDurationMs: 0,
      fadeStartAmount: 0,
    };

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
   */
  applyMacros({ pixels, frameIndex, nowMs }) {
    // Order per design §2.2 + ordering note:
    //   1. Color Wash (preset takeover)
    //   2. Feedback Trails (captures wash output, so trails are
    //      colored consistently)
    //   3. Drop Hit (transient envelope flash; runs AFTER feedback so
    //      momentary whiteouts don't contaminate trail history)
    //   4. Strobe (final ON/OFF gate)
    if ((this.colorWashConfig.enabled || this.colorWashConfig.fadingOut) && this.colorWashConfig.color) {
      let amount = this.colorWashConfig.amount;
      if (this.colorWashConfig.fadingOut) {
        const elapsed = nowMs - this.colorWashConfig.fadeStartMs;
        if (elapsed >= this.colorWashConfig.fadeDurationMs) {
          this.colorWashConfig.fadingOut = false;
          this.colorWashConfig.color = null;
          this.colorWashConfig.preset = null;
          amount = 0;
        } else {
          const ratio = 1 - (elapsed / this.colorWashConfig.fadeDurationMs);
          amount = this.colorWashConfig.fadeStartAmount * ratio;
        }
      }
      if (amount > 0 && this.colorWashConfig.color) {
        colorWashEffect.apply({
          pixels,
          color6: this.colorWashConfig.color,
          amount,
          mode: this.colorWashConfig.mode,
        });
      }
    }

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
        const gate = strobeEffect.getGate({
          frameIndex,
          startedAtFrame: this.strobeStartedAtFrame,
          framesPerCycle: this.strobeConfig.framesPerCycle,
          onFrames: this.strobeConfig.onFrames,
        });
        
        // apply blended strobe: scale = (gateScale * blend) + 1.0 * (1 - blend)
        const intensity = this.strobeConfig.intensity ?? 1.0;
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

  get dropHitActive() { return this.dropHits.length > 0; }

  // ── Strobe control ────────────────────────────────────────────────
  setStrobe(active, hz, duty, intensity, frameIndex, meta = {}) {
    if (!active) {
      this.stopStrobe({ nowMs: meta.nowMs });
      return;
    }
    const timing = strobeEffect.getTiming({ hz, duty, frameRate: this.frameRate });
    this.strobeConfig = {
      hz, duty, intensity,
      framesPerCycle: timing.framesPerCycle,
      onFrames: timing.onFrames,
      actualHz: timing.actualHz,
      presetId: meta.presetId || null,
      slotId: meta.slotId || null,
      fadeOutMs: meta.fadeOutMs,
    };
    this.strobeStartedAtFrame = frameIndex;
    this.strobeBurstEndFrame = null;
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
  triggerDropHit(params, nowMs) {
    const duration = dropHitEffect.envelopeDurationMs({
      attackMs: params.attackMs,
      holdMs: params.holdMs,
      releaseMs: params.releaseMs,
    });
    this.dropHits.push({
      params: { ...params },
      triggeredAtMs: nowMs,
      durationMs: duration,
    });
  }

  // ── Color wash ────────────────────────────────────────────────────
  setColorWash(enabled, presetId = null, amount = 0, mode = 'tint', meta = {}) {
    if (!enabled) {
      const immediate = meta && meta.immediate;
      const nowMs = meta && meta.nowMs;
      if (!immediate && this.colorWashConfig.enabled) {
        this.colorWashConfig.fadingOut = true;
        this.colorWashConfig.fadeStartMs = nowMs ?? performance.now();
        const params = this.colorWashConfig.preset && GLOBAL_EFFECT_LIBRARY.colorWash.presets[this.colorWashConfig.preset]?.params;
        const fadeMs = params?.fadeOutMs ?? 1000;
        this.colorWashConfig.fadeDurationMs = fadeMs;
        this.colorWashConfig.fadeStartAmount = this.colorWashConfig.amount;
      } else if (immediate || !this.colorWashConfig.fadingOut) {
        this.colorWashConfig = {
          enabled: false, preset: null, color: null, amount: 0, mode: 'tint', slotId: null,
          fadingOut: false, fadeStartMs: 0, fadeDurationMs: 0, fadeStartAmount: 0,
        };
      }
      this.colorWashConfig.enabled = false;
      return;
    }
    const fx = GLOBAL_EFFECT_LIBRARY.colorWash;
    const preset = presetId && fx.presets[presetId];
    if (!preset) {
      throw new Error(`Unknown colorWash preset: ${presetId}`);
    }
    this.colorWashConfig = {
      enabled: true,
      preset: presetId,
      color: [...preset.params.color],
      amount: amount,
      mode: mode,
      slotId: meta.slotId || null,
      fadingOut: false,
      fadeStartMs: 0,
      fadeDurationMs: 0,
      fadeStartAmount: 0,
    };
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
      colorWash: { ...this.colorWashConfig },
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
    this.setColorWash(false, null, 0, 'tint', { immediate: true });
  }
}

// Re-export for convenience.
export { GLOBAL_EFFECT_LIBRARY, SAFETY_TIERS, MAX_BURST_MS, validateParams };
