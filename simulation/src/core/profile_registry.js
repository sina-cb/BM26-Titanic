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
