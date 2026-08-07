/**
 * config.js — YAML config tree parsing and serialization.
 * Reads/writes the flat `params` object from the nested YAML structure.
 */
import { params } from "./state.js";
import { prunePixelOrder } from "../dmx/pixel_order_store.js";

// Euclidean distance between two {x,y,z} points (plain math — no THREE here,
// config.js loads before the 3D scene exists).
function _dist3(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * One-time, loud migration of DMX-generator traces from the legacy
 * `spacing`-driven point count to an explicit `count` (number of lights).
 *
 * Old saved traces carry `spacing` (metres between lights) but no `count`.
 * We convert each such trace's `spacing` to a `count` derived from the path
 * length (so the visible light count is preserved across the migration),
 * then DELETE `spacing` so there is no dual code path reading it at render
 * time. New traces are created with an explicit `count` and never get a
 * `spacing` field. This runs at config-load time, which is the single point
 * where traces are backfilled.
 */
export function normalizeTraces(traces) {
  if (!Array.isArray(traces)) return;
  for (const trace of traces) {
    if (typeof trace.count === "number" && trace.count >= 1) {
      // Already on the new model — drop any stale spacing residue.
      delete trace.spacing;
      continue;
    }

    // Derive a count from the legacy spacing + path length so the migrated
    // trace shows roughly the same number of lights it did before.
    const spacing = typeof trace.spacing === "number" && trace.spacing > 0
      ? trace.spacing
      : 2; // legacy default spacing

    let count;
    if (trace.shape === "circle") {
      const r = typeof trace.radius === "number" ? trace.radius : 5;
      const arcDeg = typeof trace.arc === "number" ? trace.arc : 360;
      const circumference = r * (arcDeg * Math.PI / 180);
      count = Math.max(1, Math.round(circumference / spacing));
    } else if (trace.shape === "corner") {
      const len =
        _dist3(
          trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0,
          trace.cornerX ?? 5, trace.cornerY ?? 5, trace.cornerZ ?? 0
        ) +
        _dist3(
          trace.cornerX ?? 5, trace.cornerY ?? 5, trace.cornerZ ?? 0,
          trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0
        );
      count = Math.max(2, Math.round(len / spacing) + 1);
    } else {
      // line (and any unknown shape — treat as line)
      const len = _dist3(
        trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0,
        trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0
      );
      count = Math.max(2, Math.round(len / spacing) + 1);
    }

    trace.count = count;
    delete trace.spacing; // no fallback: spacing is gone after migration
  }
}

/**
 * Return a copy of the group-override map containing only groups that carry a
 * real (non-default) On/Off + Brightness master OR a group LOCK. Default =
 * enabled & 100 % & unlocked. The `locked` flag (rigid group move) persists
 * exactly like the master so a saved scene reopens with its groups still
 * locked. Used for both DMX/par groups and the mirror LED-strand group map.
 */
export function pruneGroupOverrides(groupOverrides) {
  const clean = {};
  if (!groupOverrides || typeof groupOverrides !== "object") return clean;
  for (const name of Object.keys(groupOverrides)) {
    const g = groupOverrides[name];
    if (!g || typeof g !== "object") continue;
    const enabled = g.enabled !== false;
    const brightness = (g.brightness === undefined || g.brightness === null) ? 100 : g.brightness;
    const locked = g.locked === true;
    if (!enabled || brightness !== 100 || locked) {
      const entry = { enabled, brightness };
      if (locked) entry.locked = true;
      clean[name] = entry;
    }
  }
  return clean;
}

/**
 * Return a cleaned copy of the 2D Pixel Map per-scene config, or null when it
 * is pure default (nothing to persist — keeps virgin scenes clean). Mirrors
 * pruneGroupOverrides.
 */
export function prunePixelMap2d(pm) {
  if (!pm || typeof pm !== "object") return null;
  const enabled = pm.enabled === true;
  const fixtures = (pm.fixtures && typeof pm.fixtures === "object") ? pm.fixtures : {};
  const types = (pm.types && typeof pm.types === "object") ? pm.types : {};
  const hasFixtures = Object.keys(fixtures).length > 0;
  const hasTypes = Object.keys(types).length > 0;
  const canvas = (pm.canvas && pm.canvas.w && pm.canvas.h) ? pm.canvas : null;
  const nonDefaultCanvas = !!canvas && (canvas.w !== 900 || canvas.h !== 520);
  const nonDefaultPlane = pm.plane && pm.plane !== "auto";
  if (!enabled && !hasFixtures && !hasTypes && !nonDefaultCanvas && !nonDefaultPlane) return null;
  const out = {};
  if (enabled) out.enabled = true;
  if (nonDefaultPlane) out.plane = pm.plane;
  if (nonDefaultCanvas) out.canvas = { w: canvas.w, h: canvas.h };
  if (hasTypes) out.types = types;
  if (hasFixtures) out.fixtures = fixtures;
  return out;
}

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
      normalizeTraces(params.traces);
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
    if (key === "gradientStops" && Array.isArray(node[key])) {
      params.gradientStops = node[key];
      continue;
    }
    // Group-level On/Off + Brightness masters, keyed by group name. A plain
    // map ({ [group]: {enabled, brightness} }), NOT a control sub-section, so
    // intercept it before the generic { value } recursion below mangles it.
    if (key === "groupOverrides" && node[key] && typeof node[key] === "object") {
      params.groupOverrides = node[key];
      continue;
    }
    // LED-strand group masters + lock, keyed by the strand DISPLAY group. Same
    // shape as groupOverrides ({ [group]: {enabled, brightness, locked} }) but a
    // separate namespace (LED strands ≠ DMX/par groups). Plain map — intercept
    // before the generic { value } recursion.
    if (key === "ledGroupOverrides" && node[key] && typeof node[key] === "object") {
      params.ledGroupOverrides = node[key];
      continue;
    }
    // 2D Pixel Map per-scene layout (plain data map, like groupOverrides).
    if (key === "pixelMap2d" && node[key] && typeof node[key] === "object") {
      params.pixelMap2d = node[key];
      continue;
    }
    // Per-fixture PIXEL ORDER (normal | reversed), keyed by fixture NAME — the
    // one identity a generator-generated fixture has. A plain map
    // ({ [fixtureName]: 'reversed' }), NOT a control sub-section, so intercept
    // it before the generic { value } recursion below mangles it. It lives at
    // the top level (not on the fixture literals) precisely so it SURVIVES the
    // destroy-and-recreate of every regeneration — the groupOverrides idiom.
    // See src/dmx/pixel_order_store.js.
    if (key === "pixelOrder") {
      if (node[key] && typeof node[key] === "object" && !Array.isArray(node[key])) {
        params.pixelOrder = node[key];
      } else {
        // Malformed hand edit (scalar, array, or null). No fallback
        // interpretation: the key is ignored, remembered so the GUI validation
        // pass can surface it as a visible warning, and dropped on next save.
        params.pixelOrderMalformed = JSON.stringify(node[key]);
        console.error(
          `[pixelOrder] scene_config.yaml top-level "pixelOrder:" must be a map ` +
          `of {"<fixture name>": reversed} — got ${JSON.stringify(node[key])}. ` +
          `The key is IGNORED and will be dropped on the next save.`,
        );
      }
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

  if (parentKey === null) {
    if (params.traces && params.traces.length > 0) {
      if (!node.traces) node.traces = [];
    } else if (params.traces && params.traces.length === 0) {
      delete node.traces;
    }
    // Persist group masters only when at least one group carries a real
    // (non-default) override; otherwise keep the scene file clean.
    const groupClean = pruneGroupOverrides(params.groupOverrides);
    if (Object.keys(groupClean).length > 0) {
      if (!node.groupOverrides) node.groupOverrides = {};
    } else {
      delete node.groupOverrides;
    }
    // LED-strand group masters + lock — mirror the groupOverrides persistence
    // (same prune, same "clean when default" rule).
    const ledGroupClean = pruneGroupOverrides(params.ledGroupOverrides);
    if (Object.keys(ledGroupClean).length > 0) {
      if (!node.ledGroupOverrides) node.ledGroupOverrides = {};
    } else {
      delete node.ledGroupOverrides;
    }
    // 2D Pixel Map: persist only when non-default; otherwise keep scene clean.
    const pmClean = prunePixelMap2d(params.pixelMap2d);
    if (pmClean) {
      if (!node.pixelMap2d) node.pixelMap2d = {};
    } else {
      delete node.pixelMap2d;
    }
    // Pixel order: only non-default (`reversed`) entries persist. A scene with
    // nothing reversed keeps the key out of the file entirely — absence IS the
    // normal state, so an all-NORMAL scene saves byte-identically to before this
    // feature existed.
    const pixelOrderClean = prunePixelOrder(params.pixelOrder);
    if (Object.keys(pixelOrderClean).length > 0) {
      if (!node.pixelOrder) node.pixelOrder = {};
    } else {
      delete node.pixelOrder;
    }
  }
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
    if (key === "gradientStops" && Array.isArray(node[key])) {
      node[key] = params.gradientStops;
      continue;
    }
    if (key === "groupOverrides") {
      node[key] = pruneGroupOverrides(params.groupOverrides);
      continue;
    }
    if (key === "ledGroupOverrides") {
      node[key] = pruneGroupOverrides(params.ledGroupOverrides);
      continue;
    }
    if (key === "pixelMap2d") {
      node[key] = prunePixelMap2d(params.pixelMap2d) || {};
      continue;
    }
    if (key === "pixelOrder") {
      node[key] = prunePixelOrder(params.pixelOrder);
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
