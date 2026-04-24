/**
 * config.js — YAML config tree parsing and serialization.
 * Reads/writes the flat `params` object from the nested YAML structure.
 */
import { params } from "./state.js";

/**
 * Walk the YAML config tree and extract all { value: ... } entries into flat params.
 */
export function extractParams(node, parentKey = null) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "_section") continue;

    // Explicit array handling for fixtures
    if (key === "fixtures" && Array.isArray(node[key])) {
      if (parentKey === "dmxLights") params.dmxFixtures = node[key];
      else params.parLights = node[key];
      continue;
    }
    if (key === "dmxLights" && Array.isArray(node[key])) {
      params.dmxFixtures = node[key];
      continue;
    }
    if (key === "traces" && Array.isArray(node[key])) {
      params.traces = node[key];
      // Restore traceGenerated flag on fixtures belonging to trace groups
      const traceGroupNames = new Set(params.traces.filter(t => t.generated).map(t => t.groupName || t.name));
      (params.dmxFixtures || params.parLights || []).forEach(light => {
        if (traceGroupNames.has(light.group)) light.traceGenerated = true;
      });
      continue;
    }
    if (key === "strands" && Array.isArray(node[key])) {
      params.ledStrands = node[key];
      continue;
    }
    if (key === "icebergs" && Array.isArray(node[key])) {
      params.icebergs = node[key];
      continue;
    }
    if (key === "gradientStops" && Array.isArray(node[key])) {
      params.gradientStops = node[key];
      continue;
    }

    const entry = node[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (entry.value !== undefined) {
        // Leaf control — extract value into flat params
        params[key] = entry.value;
      } else {
        // Recurse into sub-section
        extractParams(entry, key);
      }
    }
  }
}

/**
 * Walk the config tree and update all value fields from current params (for saving).
 */
export function reconstructYAML(node, parentKey = null) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "_section") continue;

    if (key === "fixtures" && Array.isArray(node[key])) {
      const sourceList = (parentKey === "dmxLights" && params.dmxFixtures) ? params.dmxFixtures : params.parLights;
      // Strip internal fields (prefixed with _) before saving
      node[key] = sourceList.map(light => {
        const clean = {};
        for (const k of Object.keys(light)) {
          if (!k.startsWith('_')) clean[k] = light[k];
        }
        return clean;
      });
      continue;
    }
    if (key === "dmxLights" && Array.isArray(node[key])) {
      node[key] = params.dmxFixtures.map(light => {
        const clean = {};
        for (const k of Object.keys(light)) {
          if (!k.startsWith('_')) clean[k] = light[k];
        }
        return clean;
      });
      continue;
    }
    if (key === "traces" && Array.isArray(node[key])) {
      node[key] = params.traces;
      continue;
    }
    if (key === "strands" && Array.isArray(node[key])) {
      node[key] = params.ledStrands;
      continue;
    }
    if (key === "icebergs" && Array.isArray(node[key])) {
      node[key] = params.icebergs;
      continue;
    }
    if (key === "gradientStops" && Array.isArray(node[key])) {
      node[key] = params.gradientStops;
      continue;
    }

    const entry = node[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (entry.value !== undefined && !entry.transient) {
        entry.value = params[key];
      } else {
        reconstructYAML(entry, key);
      }
    }
  }
}
