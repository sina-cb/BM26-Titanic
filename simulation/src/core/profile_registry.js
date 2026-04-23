/**
 * profile_registry.js
 * 
 * Central registry for all lighting profiles, decoupled from hardcoded logic chains.
 * Defines categories for rebuilding, environment flags for PBR/Bloom setups, 
 * and explicit rendering flags for fixture geometry visibility.
 */

export const LIGHTING_PROFILES = {
  /*
  full: {
    label: "Full (Heavy)",
    category: "full",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      spotLights: true,
      pointLights: false,
      halos: true,
      beams: true,
      bulbs: true,
      dots: true
    }
  },
  full_optimized: {
    label: "Full Optimized",
    category: "full",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      spotLights: true,
      pointLights: false,
      halos: false,
      beams: true,
      bulbs: true,
      dots: true
    }
  },
  unified: {
    label: "Unified",
    category: "unified",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      spotLights: "unified", // Special flag: handled by logic to only spawn on primary pixel
      pointLights: false,
      halos: false,
      beams: true,
      bulbs: true,
      dots: true
    }
  },
  unified_lite: {
    label: "Unified Lite",
    category: "lite",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      spotLights: false,
      pointLights: true,
      halos: false,
      beams: false,
      bulbs: true,  
      dots: true
    }
  },
  full_lite: {
    label: "Full Lite",
    category: "lite",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      spotLights: false,
      pointLights: true,
      halos: false,
      beams: false,
      bulbs: true,
      dots: true
    }
  },
  super_lite: {
    label: "Super Lite",
    category: "edit",
    isEditMode: true,
    mappingEnabled: true,
    render: {
      spotLights: false,
      pointLights: false,
      halos: false,
      beams: false,
      bulbs: false,
      dots: false
    }
  },
  simple_mapping: {
    label: "Simple Mapping",
    category: "edit",
    isEditMode: true,
    mappingEnabled: true,
    render: {
      spotLights: false,
      pointLights: false,
      halos: false,
      beams: false,
      bulbs: true,
      dots: false
    }
  },
  */
  edit: {
    label: "Edit Layout",
    category: "edit",
    isEditMode: true,
    mappingEnabled: false,
    render: {
      spotLights: false,
      pointLights: false,
      halos: false,
      beams: false,
      bulbs: false,  // Hitboxes shown instead
      dots: false
    }
  },
  pixel_mapping: {
    label: "Pixel Shading",
    category: "mapping_only",
    isEditMode: false,
    mappingEnabled: true,
    render: {
      effects: false,
      spotLights: false,
      pointLights: false,
      halos: false,
      beams: 'unified',
      bulbs: true,
      dots: false
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
