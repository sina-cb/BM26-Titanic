/**
 * lib/global_effect_slot_manager.js
 *
 * Six performance slots binding a library effect + preset to a UI
 * button. Resolution / dispatch logic per docs/28 §4.4-§4.5.
 *
 * State ownership:
 *   - `this.slots` is the persistent binding config (slot 1..6).
 *   - All ACTIVE runtime state (which strobe preset is currently
 *     running, which wash is up, etc.) lives in GlobalEffectsController.
 */
import {
  GLOBAL_EFFECT_LIBRARY,
  SAFETY_TIERS,
  MAX_BURST_MS,
  validateParams,
} from './global_effect_library.js';

/** Default 6-slot layout from docs/28 §4.3. */
export const DEFAULT_SLOT_CONFIG = [
  { slotId: 1, enabled: true, label: '4 Hz Sync',      effectId: 'strobe',         presetId: 'sync_4hz',        behavior: 'toggle',  paramsOverride: {} },
  { slotId: 2, enabled: true, label: 'White Drop',     effectId: 'dropHit',        presetId: 'white_drop',      behavior: 'trigger', paramsOverride: {} },
  { slotId: 3, enabled: true, label: 'Ocean Wash',     effectId: 'colorWash',      presetId: 'ocean_blue',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 4, enabled: true, label: 'Ghost Trails',   effectId: 'feedbackTrails', presetId: 'ghost_ship',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 5, enabled: true, label: 'Iceberg Flash',  effectId: 'dropHit',        presetId: 'iceberg_flash',   behavior: 'trigger', paramsOverride: {} },
  { slotId: 6, enabled: true, label: '20 Hz Burst',    effectId: 'strobe',         presetId: 'max_20hz',        behavior: 'burst',   paramsOverride: { durationMs: 1000 } },
];

/**
 * Validate that a slot points at a real (effectId, presetId) pair
 * and that the chosen behavior is supported.
 *
 * Throws on any mismatch — callers (boot loader, PATCH endpoint)
 * convert to either a hard crash (boot) or a 400 (API).
 *
 * Returns the resolved descriptor with merged params (preset
 * defaults overlaid with `slot.paramsOverride`).
 */
export function resolveSlotBinding({ slot, library = GLOBAL_EFFECT_LIBRARY }) {
  if (!slot || typeof slot !== 'object') {
    throw new Error('resolveSlotBinding: slot is required');
  }
  if (!slot.enabled) {
    throw new Error(`Slot ${slot.slotId} is disabled`);
  }
  const effect = library[slot.effectId];
  if (!effect) {
    throw new Error(`Unknown effectId: ${slot.effectId}`);
  }
  const preset = effect.presets && effect.presets[slot.presetId];
  if (!preset) {
    throw new Error(`Unknown presetId '${slot.presetId}' for effect '${slot.effectId}'`);
  }

  const overrides = slot.paramsOverride || {};
  // Validate (and silently clamp) overrides before merging.
  const sanitized = validateParams(slot.effectId, overrides);
  const params = { ...preset.params, ...sanitized };

  const behavior = slot.behavior || preset.defaultBehavior;
  if (!effect.behaviorTypes.includes(behavior)) {
    throw new Error(`Effect '${slot.effectId}' does not support behavior '${behavior}'`);
  }

  const safetyTier = preset.safetyTier || SAFETY_TIERS.NORMAL;

  // Server-side safety: expert_burst (max_20hz) refuses toggle / hold.
  if (safetyTier === SAFETY_TIERS.EXPERT_BURST && (behavior === 'toggle' || behavior === 'hold')) {
    throw new Error(
      `Preset '${slot.presetId}' is safety tier 'expert_burst'; only 'burst' behavior is allowed`
    );
  }
  // hold_only presets must not be configured as toggle.
  if (safetyTier === SAFETY_TIERS.HOLD_ONLY && behavior === 'toggle') {
    throw new Error(
      `Preset '${slot.presetId}' is safety tier 'hold_only'; 'toggle' behavior is not allowed`
    );
  }

  return {
    slotId: slot.slotId,
    effectId: slot.effectId,
    presetId: slot.presetId,
    label: slot.label || preset.label,
    behavior,
    params,
    safetyTier,
  };
}

/**
 * Validate an entire slot array — used at boot (must throw on any
 * invalid binding) AND when PATCH replaces the whole config.
 */
export function validateSlotsConfig(slotsConfig, library = GLOBAL_EFFECT_LIBRARY) {
  if (!Array.isArray(slotsConfig)) {
    throw new Error('slotsConfig must be an array');
  }
  if (slotsConfig.length !== 6) {
    throw new Error(`slotsConfig must have exactly 6 entries (got ${slotsConfig.length})`);
  }
  const seenIds = new Set();
  for (const slot of slotsConfig) {
    if (!Number.isInteger(slot.slotId) || slot.slotId < 1 || slot.slotId > 6) {
      throw new Error(`Invalid slotId: ${slot.slotId} (must be 1..6)`);
    }
    if (seenIds.has(slot.slotId)) {
      throw new Error(`Duplicate slotId: ${slot.slotId}`);
    }
    seenIds.add(slot.slotId);
    if (slot.enabled) {
      // resolveSlotBinding will throw if effect/preset/behavior bad.
      resolveSlotBinding({ slot, library });
    }
  }
}

export class GlobalEffectSlotManager {
  constructor(controller, slotsConfig = DEFAULT_SLOT_CONFIG) {
    this.controller = controller;
    this.setSlots(slotsConfig);
  }

  setSlots(slotsConfig) {
    validateSlotsConfig(slotsConfig);
    // Deep clone so external mutations to the input array don't bleed.
    this.slots = JSON.parse(JSON.stringify(slotsConfig));
  }

  getSlots() {
    return JSON.parse(JSON.stringify(this.slots));
  }

  getSlot(slotId) {
    return this.slots.find(s => s.slotId === slotId);
  }

  patchSlot(slotId, patch) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    const next = { ...slot, ...patch };
    if (patch.paramsOverride !== undefined) {
      next.paramsOverride = { ...patch.paramsOverride };
    }
    // Round-trip through resolveSlotBinding (only if enabled) for full
    // validation including safety tier policy.
    if (next.enabled) {
      resolveSlotBinding({ slot: next });
    }
    Object.assign(slot, next);
    return slot;
  }

  /**
   * Slot status (active flag + resolved descriptor) for
   * GET /global-effect-slots/status.
   */
  getStatus() {
    return this.slots.map(slot => {
      let resolved = null;
      let resolveError = null;
      try {
        if (slot.enabled) {
          resolved = resolveSlotBinding({ slot });
        }
      } catch (err) {
        resolveError = err.message;
      }
      return {
        slotId: slot.slotId,
        enabled: slot.enabled,
        label: slot.label,
        effectId: slot.effectId,
        presetId: slot.presetId,
        behavior: slot.behavior,
        paramsOverride: { ...(slot.paramsOverride || {}) },
        safetyTier: resolved ? resolved.safetyTier : null,
        active: this._isSlotActive(slot),
        resolveError,
      };
    });
  }

  _isSlotActive(slot) {
    if (!slot.enabled) return false;
    const c = this.controller;
    switch (slot.effectId) {
      case 'strobe':
        return c.strobeActive && c.activeStrobePresetId === slot.presetId;
      case 'colorWash':
        return !!c.colorWashConfig.enabled && c.colorWashConfig.preset === slot.presetId;
      case 'feedbackTrails':
        return !!c.feedbackTrailsConfig.enabled && c.feedbackTrailsConfig.preset === slot.presetId;
      case 'dropHit':
        return c.dropHitActive;
      default:
        return false;
    }
  }

  /**
   * Route a UI/API action to the controller.
   * @param {object} args
   * @param {number} args.slotId      1..6
   * @param {string} args.action      'activate' | 'deactivate' | 'trigger' | 'toggle' | 'down' | 'up'
   * @param {number} args.frameIndex
   * @param {number} args.nowMs
   */
  dispatchSlotAction({ slotId, action, frameIndex, nowMs }) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    const resolved = resolveSlotBinding({ slot });

    // Hard server-side guard: expert_burst can ONLY be 'trigger' / 'burst'-equivalent.
    if (resolved.safetyTier === SAFETY_TIERS.EXPERT_BURST && (action === 'toggle' || action === 'hold')) {
      throw new Error(
        `Slot ${slotId} preset '${resolved.presetId}' is safety tier 'expert_burst'; ` +
        `action '${action}' is not allowed`
      );
    }

    switch (resolved.effectId) {
      case 'strobe':
        this._dispatchStrobe({ resolved, action, frameIndex });
        return;
      case 'dropHit':
        if (['trigger', 'activate', 'down'].includes(action)) {
          this.controller.triggerDropHit(resolved.params, nowMs);
        }
        return;
      case 'colorWash':
        this._dispatchColorWash({ resolved, action });
        return;
      case 'feedbackTrails':
        this._dispatchFeedbackTrails({ resolved, action });
        return;
      default:
        this.controller.triggerGenericMacro({
          effectId: resolved.effectId,
          params: resolved.params,
          action, frameIndex, nowMs,
        });
    }
  }

  _dispatchStrobe({ resolved, action, frameIndex }) {
    const p = resolved.params;
    if (resolved.behavior === 'burst') {
      const dur = Math.min(MAX_BURST_MS, Math.max(0, p.durationMs ?? 1000));
      this.controller.triggerStrobeBurst(p.hz, dur, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId,
      });
      return;
    }
    if (resolved.behavior === 'hold') {
      if (action === 'down' || action === 'activate') {
        this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
          presetId: resolved.presetId, slotId: resolved.slotId,
        });
      } else if (action === 'up' || action === 'deactivate') {
        this.controller.stopStrobe();
      }
      return;
    }
    // toggle
    if (action === 'deactivate' || action === 'up') {
      this.controller.stopStrobe();
      return;
    }
    const sameStrobe = this.controller.strobeActive &&
      this.controller.activeStrobePresetId === resolved.presetId;
    if (sameStrobe && (action === 'toggle' || action === undefined)) {
      this.controller.stopStrobe();
    } else {
      this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId,
      });
    }
  }

  _dispatchColorWash({ resolved, action }) {
    const p = resolved.params;
    if (action === 'deactivate' || action === 'up') {
      this.controller.setColorWash(false);
      return;
    }
    if (resolved.behavior === 'toggle') {
      const sameWash = this.controller.colorWashConfig.enabled &&
        this.controller.colorWashConfig.preset === resolved.presetId;
      if (sameWash && (action === 'toggle' || action === undefined)) {
        this.controller.setColorWash(false);
      } else {
        this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode, {
          slotId: resolved.slotId,
        });
      }
    } else {
      this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode, {
        slotId: resolved.slotId,
      });
    }
  }

  _dispatchFeedbackTrails({ resolved, action }) {
    if (action === 'deactivate' || action === 'up') {
      this.controller.setFeedbackTrails(false);
      return;
    }
    const same = this.controller.feedbackTrailsConfig.enabled &&
      this.controller.feedbackTrailsConfig.preset === resolved.presetId;
    if (same && (action === 'toggle' || action === undefined)) {
      this.controller.setFeedbackTrails(false);
    } else {
      this.controller.setFeedbackTrails(true, resolved.presetId, resolved.params, {
        slotId: resolved.slotId,
      });
    }
  }
}
