/**
 * profile_registry.js
 * 
 * Central registry for all lighting profiles, decoupled from hardcoded logic chains.
 * Defines categories for rebuilding, environment flags for PBR/Bloom setups, 
 * and explicit rendering flags for fixture geometry visibility.
 */

export const LIGHTING_PROFILES = {
  edit: {
    label: "Edit Layout",
    category: "edit",
    isEditMode: true,
    mappingEnabled: false,
    allowConesUi: false,
    render: {
      emitterMode: 'none',
      analyticLightMode: 'none',
      coneMode: 'none',
      effectsMode: 'off'
    }
  },
  pixel_mapping: {
    label: "Pixel Mapping",
    category: "mapping_only",
    isEditMode: false,
    mappingEnabled: true,
    allowConesUi: false,
    render: {
      emitterMode: 'none',
      analyticLightMode: 'none',
      coneMode: 'pixel',
      effectsMode: 'off'
    }
  },
  emissive: {
    label: "Emissive",
    category: "lite",
    isEditMode: false,
    mappingEnabled: true,
    allowConesUi: true,
    render: {
      emitterMode: 'pixel', 
      analyticLightMode: 'none',
      coneMode: 'pixel',
      effectsMode: 'on'
    }
  },
  full: {
    label: "Full Analytic (Heavy)",
    category: "full",
    isEditMode: false,
    mappingEnabled: true,
    allowConesUi: true,
    render: {
      emitterMode: 'pixel',
      analyticLightMode: 'pixel',
      coneMode: 'pixel',
      effectsMode: 'on'
    }
  },
  // 2D-only headless profile: the engine + DMX/sACN pipeline run and the 2D
  // Pixel Map renders, but ALL per-frame GPU 3D work is skipped (scene render,
  // bloom, shadows, spotlight pool, instanced-dot flush, fixture visuals). Lets
  // the sim drive real fixtures + a 2D preview on a low-power box (Raspberry Pi)
  // with no capable GPU. `headless: true` is the flag animate() gates on.
  '2d_pixels': {
    label: "2D Pixels (Pi / no-GPU)",
    category: "lite",
    isEditMode: false,
    mappingEnabled: true,
    allowConesUi: false,
    headless: true,
    render: {
      emitterMode: 'none',
      analyticLightMode: 'none',
      coneMode: 'none',
      effectsMode: 'off'
    }
  }
};

/**
 * Returns a profile definition safely with fallback defaults.
 * @param {string} profileId - The string ID of the profile (e.g. 'full_optimized')
 */
export function getProfileDef(profileId) {
  if (!profileId || !LIGHTING_PROFILES[profileId]) {
    console.warn(`[profile_registry] Unknown profile '${profileId}'. Falling back to 'edit'.`);
    return LIGHTING_PROFILES['edit'];
  }
  return LIGHTING_PROFILES[profileId];
}

/**
 * Returns a deterministic key representing the structural requirements of a profile.
 * If this key changes, existing fixture groups must be destroyed and rebuilt.
 * @param {string} profileId 
 */
export function getProfileRebuildKey(profileId) {
  const p = getProfileDef(profileId);
  return JSON.stringify(p.render);
}
