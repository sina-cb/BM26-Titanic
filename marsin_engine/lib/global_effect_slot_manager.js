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

/**
 * Default slot layout. Expanded to 10 slots in May 2026 so the migrated
 * legacy rig-globals (Vintage Wht / Blast Wht / UV Blast / Fogger) sit
 * inside the unified Global Effect Macros grid instead of a separate
 * RigGlobals strip. Slot count is no longer fixed at 6 — see
 * MIN_SLOTS / MAX_SLOTS below.
 */
export const DEFAULT_SLOT_CONFIG = [
  // Slots 1..6 — unchanged from docs/28 §4.3 (pre-existing tests +
  // operator muscle memory depend on these indices).
  { slotId: 1,  enabled: true, label: '4 Hz Sync',      effectId: 'strobe',         presetId: 'sync_4hz',        behavior: 'toggle',  paramsOverride: {} },
  { slotId: 2,  enabled: true, label: 'White Drop',     effectId: 'dropHit',        presetId: 'white_drop',      behavior: 'trigger', paramsOverride: {} },
  { slotId: 3,  enabled: true, label: 'Ocean Wash',     effectId: 'colorWash',      presetId: 'ocean_blue',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 4,  enabled: true, label: 'Ghost Trails',   effectId: 'feedbackTrails', presetId: 'ghost_ship',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 5,  enabled: true, label: 'Iceberg Flash',  effectId: 'dropHit',        presetId: 'iceberg_flash',   behavior: 'trigger', paramsOverride: {} },
  { slotId: 6,  enabled: true, label: '20 Hz Max',      effectId: 'strobe',         presetId: 'max_20hz',        behavior: 'toggle',  paramsOverride: {} },
  // Slots 7..10 — legacy RigGlobals migrated into the GEM grid
  // (May 2026). These route through controller.setEffect(...) so the
  // existing dimmer-aware pixel + DMX paths keep working.
  { slotId: 7,  enabled: true, label: 'Vintage Wht',    effectId: 'vintageWhite',   presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 8,  enabled: true, label: 'Blast Wht',      effectId: 'blastWhite',     presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 9,  enabled: true, label: 'UV Blast',       effectId: 'uvBlast',        presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 10, enabled: true, label: 'Fogger',         effectId: 'fogger',         presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 11, enabled: true, label: 'Long Trails',    effectId: 'feedbackTrails', presetId: 'long_afterimage', behavior: 'toggle',  paramsOverride: {} },
  { slotId: 12, enabled: true, label: 'Cosmic Trails',  effectId: 'feedbackTrails', presetId: 'cosmic_trails',   behavior: 'toggle',  paramsOverride: {} },
];

export const MIN_SLOTS = 1;
export const MAX_SLOTS = 16;

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
  let preset = effect.presets && effect.presets[slot.presetId];
  if (!preset) {
    // Forward-compat: presets removed between engine versions (e.g.
    // the May 2026 legacy-effect collapse that dropped `bypass_dimmer`)
    // should not brick the saved YAML. Fall back to `default` if the
    // effect has one; otherwise pick the first declared preset. Warn
    // so the operator notices and re-binds via the swap sheet.
    const fallbackId = effect.presets && effect.presets.default
      ? 'default'
      : (effect.presets ? Object.keys(effect.presets)[0] : null);
    if (fallbackId) {
      console.warn(
        `[GEM] slot ${slot.slotId}: preset '${slot.presetId}' missing from effect '${slot.effectId}'; ` +
        `falling back to '${fallbackId}'. Re-bind via the swap sheet to silence this.`
      );
      preset = effect.presets[fallbackId];
      slot.presetId = fallbackId; // canonicalize so the next save persists the right id
    } else {
      throw new Error(`Unknown presetId '${slot.presetId}' for effect '${slot.effectId}'`);
    }
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

  // Operator review May 2026 #10: the legacy HOLD_ONLY / EXPERT_BURST
  // behavior gates are dropped. Hold isn't supported anywhere in the
  // app and operators want toggle-only operation even for the fast
  // strobes. The safety tier is still surfaced via the slot status'
  // `safetyTier` field (used by HIL tests + telemetry); the UI
  // intentionally no longer renders any per-tier badge.

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
  if (slotsConfig.length < MIN_SLOTS || slotsConfig.length > MAX_SLOTS) {
    throw new Error(`slotsConfig must have between ${MIN_SLOTS} and ${MAX_SLOTS} entries (got ${slotsConfig.length})`);
  }
  const seenIds = new Set();
  for (const slot of slotsConfig) {
    if (!Number.isInteger(slot.slotId) || slot.slotId < 1 || slot.slotId > MAX_SLOTS) {
      throw new Error(`Invalid slotId: ${slot.slotId} (must be 1..${MAX_SLOTS})`);
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
      // Legacy effects: just look up the boolean toggle on
      // controller.effects, since they're singletons (no preset
      // distinction in the legacy path beyond the bypassDimmer twin).
      case 'vintageWhite':
        return !!c.effects.vintageWhite;
      case 'blastWhite':
        return !!c.effects.blastWhite;
      case 'uvBlast':
        return !!c.effects.uvBlast;
      case 'fogger':
        return !!c.effects.fogger;
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
        this._dispatchStrobe({ resolved, action, frameIndex, nowMs });
        return;
      case 'dropHit':
        if (['trigger', 'activate', 'down'].includes(action)) {
          this.controller.triggerDropHit(resolved.params, nowMs);
        }
        return;
      case 'colorWash':
        this._dispatchColorWash({ resolved, action, nowMs });
        return;
      case 'feedbackTrails':
        this._dispatchFeedbackTrails({ resolved, action, nowMs });
        return;
      // Legacy rig-globals (migrated May 2026): the slot dispatcher
      // routes through `controller.setEffect(...)` so the existing
      // dimmer-aware pixel pipeline / DMX writers keep working.
      case 'vintageWhite':
      case 'blastWhite':
      case 'uvBlast':
      case 'fogger':
        this._dispatchLegacy({ resolved, action });
        return;
      default:
        this.controller.triggerGenericMacro({
          effectId: resolved.effectId,
          params: resolved.params,
          action, frameIndex, nowMs,
        });
    }
  }

  _dispatchLegacy({ resolved, action }) {
    const c = this.controller;
    const effectId = resolved.effectId;
    const isOn = !!c.effects[effectId];
    let next;
    if (action === 'deactivate' || action === 'up') next = false;
    else if (action === 'activate' || action === 'down' || action === 'trigger') next = true;
    else if (action === 'toggle' || action === undefined) next = !isOn;
    else next = !isOn;
    c.setEffect(effectId, next);
    // bypassDimmer is OWNED by the dimmer rack's BypassCheckbox now
    // (operator review May 2026). Pre-May-2026 each legacy effect
    // had two presets (`default` + `bypass_dimmer`) which set this
    // flag at slot-dispatch time and stomped over the dimmer rack's
    // setting. That double-source-of-truth caused operators to find
    // their bypass flag flipping unexpectedly when they activated
    // a slot. Now: the slot dispatcher TOUCHES THE EFFECT TOGGLE
    // ONLY. The bypass flag stays exactly where the dimmer rack
    // last put it.
  }

  _dispatchStrobe({ resolved, action, frameIndex, nowMs }) {
    const p = resolved.params;
    if (resolved.behavior === 'burst') {
      const dur = Math.min(MAX_BURST_MS, Math.max(0, p.durationMs ?? 1000));
      this.controller.triggerStrobeBurst(p.hz, dur, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
      });
      return;
    }
    if (resolved.behavior === 'hold') {
      if (action === 'down' || action === 'activate') {
        this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
          presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
        });
      } else if (action === 'up' || action === 'deactivate') {
        this.controller.stopStrobe({ nowMs });
      }
      return;
    }
    // toggle
    if (action === 'deactivate' || action === 'up') {
      this.controller.stopStrobe({ nowMs });
      return;
    }
    const sameStrobe = this.controller.strobeActive &&
      this.controller.activeStrobePresetId === resolved.presetId;
    if (sameStrobe && (action === 'toggle' || action === undefined)) {
      this.controller.stopStrobe({ nowMs });
    } else {
      this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
      });
    }
  }

  _dispatchColorWash({ resolved, action, nowMs }) {
    const p = resolved.params;
    if (action === 'deactivate' || action === 'up') {
      this.controller.setColorWash(false, null, 0, 'tint', { nowMs });
      return;
    }
    if (resolved.behavior === 'toggle') {
      const sameWash = this.controller.colorWashConfig.enabled &&
        this.controller.colorWashConfig.preset === resolved.presetId;
      if (sameWash && (action === 'toggle' || action === undefined)) {
        this.controller.setColorWash(false, null, 0, 'tint', { nowMs });
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

  _dispatchFeedbackTrails({ resolved, action, nowMs }) {
    if (action === 'deactivate' || action === 'up') {
      this.controller.setFeedbackTrails(false, null, {}, { nowMs });
      return;
    }
    const same = this.controller.feedbackTrailsConfig.enabled &&
      this.controller.feedbackTrailsConfig.preset === resolved.presetId;
    if (same && (action === 'toggle' || action === undefined)) {
      this.controller.setFeedbackTrails(false, null, {}, { nowMs });
    } else {
      this.controller.setFeedbackTrails(true, resolved.presetId, resolved.params, {
        slotId: resolved.slotId,
      });
    }
  }
}
