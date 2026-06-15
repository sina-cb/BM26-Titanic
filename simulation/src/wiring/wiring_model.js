/**
 * wiring_model.js — Wiring Tracer data core (Phase 1, see docs/36_wiring_tracer.md).
 *
 * Pure data, no THREE. Loads & validates a `wiring.yaml` document, resolves the
 * cable-type catalog / components / endpoints, computes the calibrated real-world
 * scale, and produces a bill of materials. Every malformed input throws loudly
 * (codex P0: no fallback behaviors); over-max stock and oversubscription are
 * surfaced as warnings, not failures.
 *
 * Public API:
 *   parseWiring(yamlString, opts)  -> model   (yaml string -> validated model)
 *   buildWiringModel(rawDoc, opts) -> model   (parsed object -> validated model)
 *   computeBom(model, opts)        -> bom
 *   formatBomText(bom)             -> string
 */

import yaml from 'js-yaml';

const DEFAULT_CABLE_GAP = 0.04;
const DEFAULT_SLACK = 0.15;
const SCALE_DISAGREE_TOLERANCE = 0.03; // 3% between cross-check references

// ─── Loading ──────────────────────────────────────────────────────────────

export function parseWiring(yamlString, opts = {}) {
  const doc = yaml.load(yamlString);
  return buildWiringModel(doc, opts);
}

/**
 * Validate a parsed wiring document and return an indexed, resolved model.
 * @param {object} rawDoc parsed `wiring.yaml`
 * @param {object} opts   { validCameraKeys?: string[], knownGroups?: string[] }
 */
export function buildWiringModel(rawDoc, opts = {}) {
  if (!rawDoc || typeof rawDoc !== 'object') {
    fail('document is empty or not a mapping');
  }
  const root = rawDoc.wiring;
  if (!root || typeof root !== 'object') {
    fail('missing top-level `wiring:` block');
  }

  const cableTypes = validateCableTypes(root.cableTypes);
  const components = validateComponents(root.components);
  const anchors = validateAnchors(root.anchors);
  const harnesses = validateHarnesses(root.harnesses);
  const scale = validateScale(root.scale);
  const defaults = validateDefaults(root.defaults);
  const routes = validateRoutes(root.routes, {
    cableTypes, components, anchors, harnesses, knownGroups: opts.knownGroups,
  });
  const printViews = validatePrintViews(root.printViews, {
    harnesses, validCameraKeys: opts.validCameraKeys,
  });

  return {
    version: root.version ?? null,
    cableTypes, components, anchors, harnesses, scale, defaults, routes, printViews,
  };
}

// ─── Cable-type catalog (§3.2) ──────────────────────────────────────────────

const CABLE_FAMILIES = new Set(['power', 'ethernet', 'dmx']);

function validateCableTypes(raw) {
  if (!raw || typeof raw !== 'object') fail('`cableTypes` is required and must be a mapping');
  const out = new Map();
  for (const [id, def] of Object.entries(raw)) {
    if (out.has(id)) fail(`duplicate cableType id "${id}"`);
    if (!def || typeof def !== 'object') fail(`cableType "${id}" must be a mapping`);
    if (!CABLE_FAMILIES.has(def.family)) {
      fail(`cableType "${id}" has unknown family "${def.family}" (expected ${[...CABLE_FAMILIES].join(' | ')})`);
    }
    if (typeof def.connector !== 'string' || !def.connector) {
      fail(`cableType "${id}" missing connector`);
    }
    const stock = def.stockLengths;
    if (!Array.isArray(stock) || stock.length === 0 || !stock.every(isFinitePositive)) {
      fail(`cableType "${id}" needs a non-empty stockLengths array of positive numbers`);
    }
    out.set(id, {
      id,
      family: def.family,
      connector: def.connector,
      stockLengths: [...stock].sort((a, b) => a - b),
      color: def.color ?? '#cccccc',
      radius: isFinitePositive(def.radius) ? def.radius : 0.03,
      weatherproof: def.weatherproof === true,
      bomGroup: def.bomGroup ?? def.family,
    });
  }
  return out;
}

// ─── Components & ports (§3.3) ───────────────────────────────────────────────

const COMPONENT_TYPES = new Set([
  'server', 'switch', 'outlet', 'generator', 'adapter', 'computer', 'injector',
]);
const SURFACE_SIDES = new Set(['inside', 'outside', 'raised', 'free']);

function validateComponents(raw) {
  if (raw == null) return new Map();
  if (!Array.isArray(raw)) fail('`components` must be a list');
  const out = new Map();
  for (const def of raw) {
    if (!def || typeof def !== 'object') fail('each component must be a mapping');
    const id = requireId(def, 'component');
    if (out.has(id)) fail(`duplicate component id "${id}"`);
    if (!COMPONENT_TYPES.has(def.type)) {
      fail(`component "${id}" has unknown type "${def.type}"`);
    }
    const placement = requirePlacement(def.placement, `component "${id}"`);
    const ports = validatePorts(def.ports, id);
    out.set(id, { id, name: def.name ?? id, type: def.type, placement, ports });
  }
  return out;
}

function validatePorts(raw, componentId) {
  if (raw == null) return new Map();
  if (!Array.isArray(raw)) fail(`component "${componentId}" ports must be a list`);
  const out = new Map();
  for (const p of raw) {
    if (!p || typeof p !== 'object') fail(`component "${componentId}" has a malformed port`);
    const id = requireId(p, `port on component "${componentId}"`);
    if (out.has(id)) fail(`duplicate port id "${id}" on component "${componentId}"`);
    if (!Array.isArray(p.accepts) || p.accepts.length === 0 || !p.accepts.every((a) => typeof a === 'string' && a)) {
      fail(`port "${id}" on component "${componentId}" needs a non-empty accepts list`);
    }
    const count = p.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      fail(`port "${id}" on component "${componentId}" has invalid count ${p.count}`);
    }
    out.set(id, { id, accepts: [...p.accepts], count });
  }
  return out;
}

// ─── Anchors (§3.4) ──────────────────────────────────────────────────────────

function validateAnchors(raw) {
  if (raw == null) return new Map();
  if (!Array.isArray(raw)) fail('`anchors` must be a list');
  const out = new Map();
  for (const def of raw) {
    if (!def || typeof def !== 'object') fail('each anchor must be a mapping');
    const id = requireId(def, 'anchor');
    if (out.has(id)) fail(`duplicate anchor id "${id}"`);
    out.set(id, { id, placement: requirePlacement(def.placement, `anchor "${id}"`) });
  }
  return out;
}

// ─── Harnesses (§3.6) ────────────────────────────────────────────────────────

function validateHarnesses(raw) {
  if (raw == null) return new Map();
  if (!Array.isArray(raw)) fail('`harnesses` must be a list');
  const out = new Map();
  for (const def of raw) {
    if (!def || typeof def !== 'object') fail('each harness must be a mapping');
    const id = requireId(def, 'harness');
    if (out.has(id)) fail(`duplicate harness id "${id}"`);
    out.set(id, { id, name: def.name ?? id, color: def.color ?? '#dddddd' });
  }
  return out;
}

// ─── Scale calibration (§3.8) ────────────────────────────────────────────────

function validateScale(raw) {
  if (raw == null) return null; // calibration is checked at BOM/export time
  if (typeof raw !== 'object') fail('`scale` must be a mapping');
  if (typeof raw.unit !== 'string' || !raw.unit) fail('`scale.unit` is required');
  if (!Array.isArray(raw.references) || raw.references.length === 0) {
    fail('`scale.references` must be a non-empty list');
  }
  const ids = new Set();
  const references = raw.references.map((ref) => {
    if (!ref || typeof ref !== 'object') fail('each scale reference must be a mapping');
    const id = requireId(ref, 'scale reference');
    if (ids.has(id)) fail(`duplicate scale reference id "${id}"`);
    ids.add(id);
    if (!Array.isArray(ref.points) || ref.points.length < 2) {
      fail(`scale reference "${id}" needs at least two points`);
    }
    const points = ref.points.map((pt, i) => requirePoint(pt, `scale reference "${id}" point ${i}`));
    if (!isFinitePositive(ref.actualDistance)) {
      fail(`scale reference "${id}" needs a positive actualDistance`);
    }
    const modelDistance = polylineLength(points);
    if (modelDistance <= 1e-9) {
      fail(`scale reference "${id}" points are coincident (zero model distance)`);
    }
    return {
      id,
      role: ref.role ?? 'check',
      actualDistance: ref.actualDistance,
      modelDistance,
      realPerUnit: ref.actualDistance / modelDistance,
    };
  });
  const primaries = references.filter((r) => r.role === 'primary');
  if (primaries.length > 1) fail('more than one scale reference has role "primary"');
  return { unit: raw.unit, references, primary: primaries[0] ?? null };
}

function validateDefaults(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const cableGap = isFinitePositive(d.cableGap) ? d.cableGap : DEFAULT_CABLE_GAP;
  const slack = Number.isFinite(d.slack) && d.slack >= 0 ? d.slack : DEFAULT_SLACK;
  return { cableGap, slack };
}

// ─── Routes & endpoints (§3.4, §3.5) ─────────────────────────────────────────

function validateRoutes(raw, ctx) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail('`routes` must be a list');
  const ids = new Set();
  return raw.map((def) => {
    if (!def || typeof def !== 'object') fail('each route must be a mapping');
    const id = requireId(def, 'route');
    if (ids.has(id)) fail(`duplicate route id "${id}"`);
    ids.add(id);

    if (!Array.isArray(def.endpoints) || def.endpoints.length !== 2) {
      fail(`route "${id}" must have exactly two endpoints`);
    }
    const endpoints = def.endpoints.map((ep) => validateEndpoint(ep, id, ctx));
    const waypoints = validateWaypoints(def.waypoints, id);
    const cables = validateCables(def.cables, id, endpoints, ctx);

    let harness = null;
    if (def.harness != null) {
      if (!ctx.harnesses.has(def.harness)) {
        fail(`route "${id}" references unknown harness "${def.harness}"`);
      }
      harness = def.harness;
    }
    return { id, name: def.name ?? id, endpoints, waypoints, cables, harness };
  });
}

function validateEndpoint(ep, routeId, ctx) {
  if (!ep || typeof ep !== 'object') fail(`route "${routeId}" has a malformed endpoint`);
  const keys = ['component', 'groupStart', 'anchor'].filter((k) => ep[k] != null);
  if (keys.length !== 1) {
    fail(`route "${routeId}" endpoint must have exactly one of component | groupStart | anchor`);
  }
  if (ep.component != null) {
    const comp = ctx.components.get(ep.component);
    if (!comp) fail(`route "${routeId}" references unknown component "${ep.component}"`);
    if (ep.port == null) fail(`route "${routeId}" endpoint on component "${ep.component}" must name a port`);
    const port = comp.ports.get(ep.port);
    if (!port) fail(`route "${routeId}" references unknown port "${ep.port}" on component "${ep.component}"`);
    return { kind: 'component', component: ep.component, port: ep.port };
  }
  if (ep.anchor != null) {
    if (!ctx.anchors.has(ep.anchor)) fail(`route "${routeId}" references unknown anchor "${ep.anchor}"`);
    return { kind: 'anchor', anchor: ep.anchor };
  }
  // groupStart — group membership is resolved at render/measure time from the
  // scene. Validate against knownGroups when the caller provides them.
  if (ctx.knownGroups && !ctx.knownGroups.includes(ep.groupStart)) {
    fail(`route "${routeId}" references unknown groupStart "${ep.groupStart}"`);
  }
  return { kind: 'groupStart', groupStart: ep.groupStart };
}

function validateWaypoints(raw, routeId) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail(`route "${routeId}" waypoints must be a list`);
  return raw.map((wp, i) => {
    const where = `route "${routeId}" waypoint ${i}`;
    const pt = requirePoint(wp, where);
    const side = wp.side ?? 'outside';
    if (!SURFACE_SIDES.has(side)) fail(`${where} has invalid side "${side}"`);
    const off = wp.off;
    if (off != null && !(Number.isFinite(off) && off >= 0)) fail(`${where} has invalid off ${off}`);
    return { ...pt, side, off: off ?? null };
  });
}

function validateCables(raw, routeId, endpoints, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`route "${routeId}" must carry at least one cable`);
  }
  return raw.map((c, i) => {
    if (!c || typeof c !== 'object') fail(`route "${routeId}" cable ${i} must be a mapping`);
    const type = c.type;
    const def = ctx.cableTypes.get(type);
    if (!def) fail(`route "${routeId}" cable ${i} references unknown cableType "${type}"`);
    // Port compatibility: every component endpoint port must accept this type.
    for (const ep of endpoints) {
      if (ep.kind !== 'component') continue;
      const port = ctx.components.get(ep.component).ports.get(ep.port);
      const ok = port.accepts.includes(type) || port.accepts.includes(def.connector);
      if (!ok) {
        fail(`route "${routeId}" cable "${type}" is incompatible with port "${ep.port}" `
          + `on component "${ep.component}" (accepts: ${port.accepts.join(', ')})`);
      }
    }
    const lengthOverrideFt = c.lengthOverrideFt;
    if (lengthOverrideFt != null && !isFinitePositive(lengthOverrideFt)) {
      fail(`route "${routeId}" cable ${i} has invalid lengthOverrideFt ${lengthOverrideFt}`);
    }
    return { type, label: c.label ?? null, lengthOverrideFt: lengthOverrideFt ?? null };
  });
}

// ─── Print views (§3.9) ──────────────────────────────────────────────────────

const FILTER_FAMILIES = CABLE_FAMILIES;
const FILTER_SIDES = new Set(['port', 'starboard']);

function validatePrintViews(raw, ctx) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail('`printViews` must be a list');
  const ids = new Set();
  return raw.map((def) => {
    if (!def || typeof def !== 'object') fail('each printView must be a mapping');
    const id = requireId(def, 'printView');
    if (ids.has(id)) fail(`duplicate printView id "${id}"`);
    ids.add(id);
    validateCamera(def.camera, id, ctx.validCameraKeys);
    const filter = def.filter ?? {};
    if (typeof filter !== 'object') fail(`printView "${id}" filter must be a mapping`);
    if (filter.family != null && !FILTER_FAMILIES.has(filter.family)) {
      fail(`printView "${id}" filter.family "${filter.family}" is invalid`);
    }
    if (filter.side != null && !FILTER_SIDES.has(filter.side)) {
      fail(`printView "${id}" filter.side "${filter.side}" is invalid`);
    }
    if (filter.harness != null && !ctx.harnesses.has(filter.harness)) {
      fail(`printView "${id}" filter.harness references unknown harness "${filter.harness}"`);
    }
    return { id, name: def.name ?? id, camera: def.camera, filter };
  });
}

function validateCamera(camera, viewId, validCameraKeys) {
  if (typeof camera === 'string') {
    if (validCameraKeys && !validCameraKeys.includes(camera)) {
      fail(`printView "${viewId}" references unknown camera preset "${camera}"`);
    }
    return;
  }
  if (camera && typeof camera === 'object') {
    requirePoint(camera.position, `printView "${viewId}" camera.position`);
    requirePoint(camera.target, `printView "${viewId}" camera.target`);
    return;
  }
  fail(`printView "${viewId}" needs a camera preset key or an inline { position, target }`);
}

// ─── Endpoint position resolution ────────────────────────────────────────────

function resolveEndpointPosition(model, ep, groupStartResolver) {
  if (ep.kind === 'component') return model.components.get(ep.component).placement;
  if (ep.kind === 'anchor') return model.anchors.get(ep.anchor).placement;
  // groupStart
  if (typeof groupStartResolver !== 'function') {
    fail(`cannot measure route to groupStart "${ep.groupStart}" without a groupStartResolver`);
  }
  const pos = groupStartResolver(ep.groupStart);
  if (!pos || !isFinite3(pos)) {
    fail(`groupStartResolver returned no position for group "${ep.groupStart}"`);
  }
  return pos;
}

// ─── BOM (§6) ────────────────────────────────────────────────────────────────

/**
 * @param {object} model     from buildWiringModel
 * @param {object} opts       { groupStartResolver?: (name)=>({x,y,z}) }
 * @returns {object} bom      { unit, realPerUnit, groups, totals, warnings, lines }
 */
export function computeBom(model, opts = {}) {
  const warnings = [];

  if (!model.scale || !model.scale.primary) {
    return {
      unit: model.scale?.unit ?? null,
      realPerUnit: null,
      calibrated: false,
      groups: [],
      totals: {},
      lines: [],
      warnings: ['Not calibrated — set a scale reference with role "primary" before exporting a BOM'],
    };
  }

  const realPerUnit = model.scale.primary.realPerUnit;
  const slack = model.defaults.slack;
  const unit = model.scale.unit;

  // Cross-check references disagree?
  for (const ref of model.scale.references) {
    if (ref.role === 'primary') continue;
    const drift = Math.abs(ref.realPerUnit - realPerUnit) / realPerUnit;
    if (drift > SCALE_DISAGREE_TOLERANCE) {
      warnings.push(`Reference "${ref.id}" scale disagrees with primary by `
        + `${(drift * 100).toFixed(1)}% (${ref.realPerUnit.toFixed(4)} vs ${realPerUnit.toFixed(4)} ${unit}/unit)`);
    }
  }

  // Port oversubscription
  const portUse = new Map(); // `${component}.${port}` -> count
  for (const route of model.routes) {
    for (const ep of route.endpoints) {
      if (ep.kind !== 'component') continue;
      const key = `${ep.component}.${ep.port}`;
      portUse.set(key, (portUse.get(key) ?? 0) + 1);
    }
  }
  for (const [key, used] of portUse) {
    const [cId, pId] = key.split('.');
    const cap = model.components.get(cId).ports.get(pId).count;
    if (used > cap) warnings.push(`Port "${pId}" on component "${cId}" oversubscribed: ${used} routes > ${cap} ports`);
  }

  // Per-cable lines
  const lines = [];
  for (const route of model.routes) {
    const pts = [
      resolveEndpointPosition(model, route.endpoints[0], opts.groupStartResolver),
      ...route.waypoints,
      resolveEndpointPosition(model, route.endpoints[1], opts.groupStartResolver),
    ];
    const modelLen = polylineLength(pts);
    const drapedReal = modelLen * realPerUnit * (1 + slack);

    for (const cable of route.cables) {
      const def = model.cableTypes.get(cable.type);
      const measured = cable.lengthOverrideFt != null ? cable.lengthOverrideFt : drapedReal;
      const maxStock = def.stockLengths[def.stockLengths.length - 1];
      const pick = def.stockLengths.find((s) => s >= measured) ?? null;
      if (pick == null) {
        warnings.push(`Route "${route.id}" cable "${cable.type}" measures `
          + `${measured.toFixed(1)} ${unit} — exceeds max stock ${maxStock} ${unit}; needs a join/coupler`);
      }
      lines.push({
        route: route.id,
        name: route.name,
        harness: route.harness,
        cableType: def.id,
        family: def.family,
        connector: def.connector,
        weatherproof: def.weatherproof,
        bomGroup: def.bomGroup,
        measured,
        stock: pick,
        overMax: pick == null,
      });
    }
  }

  // Group lines by (cableType, connector, weatherproof, harness, stock)
  const groupMap = new Map();
  for (const ln of lines) {
    const key = [ln.cableType, ln.connector, ln.weatherproof, ln.harness ?? '-', ln.stock ?? 'OVER'].join('|');
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        cableType: ln.cableType, family: ln.family, connector: ln.connector,
        weatherproof: ln.weatherproof, harness: ln.harness, stock: ln.stock,
        overMax: ln.overMax, count: 0, measuredTotal: 0,
      });
    }
    const g = groupMap.get(key);
    g.count += 1;
    g.measuredTotal += ln.measured;
  }
  const groups = [...groupMap.values()].sort((a, b) =>
    a.family.localeCompare(b.family) || a.cableType.localeCompare(b.cableType)
    || (a.stock ?? 1e9) - (b.stock ?? 1e9));

  // Totals per family
  const totals = {};
  for (const g of groups) {
    const stockFt = g.stock != null ? g.stock * g.count : 0;
    totals[g.family] = totals[g.family] || { rounded: 0, measured: 0 };
    totals[g.family].rounded += stockFt;
    totals[g.family].measured += g.measuredTotal;
  }

  return { unit, realPerUnit, calibrated: true, groups, totals, lines, warnings };
}

export function formatBomText(bom) {
  const out = [];
  out.push(`WIRING — BILL OF MATERIALS`);
  if (!bom.calibrated) {
    out.push('');
    out.push(`  ⚠ ${bom.warnings[0]}`);
    return out.join('\n');
  }
  out.push(`  scale: ${bom.realPerUnit.toFixed(4)} ${bom.unit}/model-unit`);
  out.push('');
  let lastFamily = null;
  for (const g of bom.groups) {
    if (g.family !== lastFamily) {
      out.push(`${g.family.toUpperCase()}`);
      lastFamily = g.family;
    }
    const wp = g.weatherproof ? ', WP' : '';
    const harness = g.harness ? `  [harness ${g.harness}]` : '';
    const stock = g.overMax ? `OVER-MAX × ${g.count}` : `${g.stock} ${bom.unit} × ${g.count}`;
    out.push(`  ${g.cableType} (${g.connector}${wp})  ${stock}`
      + `  (${g.measuredTotal.toFixed(1)} ${bom.unit} measured)${harness}`);
  }
  out.push('');
  for (const [family, t] of Object.entries(bom.totals)) {
    out.push(`  ── total ${family}: ${t.rounded.toFixed(0)} ${bom.unit} (rounded), `
      + `${t.measured.toFixed(1)} ${bom.unit} (measured)`);
  }
  if (bom.warnings.length) {
    out.push('');
    out.push('WARNINGS');
    for (const w of bom.warnings) out.push(`  ⚠ ${w}`);
  }
  return out.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fail(msg) {
  throw new Error(`[wiring] ${msg}`);
}

function requireId(def, what) {
  if (typeof def.id !== 'string' || !def.id) fail(`${what} is missing a string id`);
  return def.id;
}

function requirePoint(pt, where) {
  if (!pt || typeof pt !== 'object' || !isFinite3(pt)) {
    fail(`${where} must be a point with finite x, y, z`);
  }
  return { x: pt.x, y: pt.y, z: pt.z };
}

function requirePlacement(placement, where) {
  if (!placement || typeof placement !== 'object' || !isFinite3(placement)) {
    fail(`${where} needs a placement with finite x, y, z`);
  }
  const side = placement.surface;
  if (side != null && !SURFACE_SIDES.has(side)) fail(`${where} has invalid surface "${side}"`);
  return { x: placement.x, y: placement.y, z: placement.z, surface: side ?? null };
}

function isFinite3(p) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function isFinitePositive(n) {
  return Number.isFinite(n) && n > 0;
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}
