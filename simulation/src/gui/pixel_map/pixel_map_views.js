/**
 * pixel_map_views.js — "views are data" engine for the 2D Pixel Map multiview.
 *
 * A *view* is a named, editable arrangement of fixtures made of one or more
 * *panels*. Each panel is:
 *   - a set of fixture *selectors* (union): kind / fixtureType / group / name
 *     (glob) / view (resolved through the Views-Rehaul `view_registry`), with
 *     an optional `exclude` list,
 *   - a *projection* (top | front | side) — the world plane a spatial seed uses,
 *   - a *layout* type (spatial | radial | planar | lanes).
 * Placements (fixKey → {x,y,rot}) and per-type style overrides are stored PER
 * VIEW, so the same fixture can sit differently in "top-down" vs "front".
 *
 * This module is pure logic — NO DOM, NO canvas, NO signals. It owns:
 *   - schema validation (fail-loud: throws on unknown keys / bad structure),
 *   - selector resolution against the layout clusters (zero-match → a loud,
 *     renderable per-panel error, never a silent empty pane — codex P0),
 *   - the runtime add / remove / duplicate lifecycle on a views container,
 *   - persistence to/from the `params.pixelMapViews` scene-YAML shape, plus
 *     one-time migration of the legacy single-view `params.pixelMap2d`.
 *
 * Cross-slice contract (design report 20260724_9 §5):
 *   resolveView(viewDef, clusters, list, ctx) → { id, label, panels: [
 *     { def, clusters, placements: Map<fixKey,{x,y,rot}>, styles, error? } ] }
 * `clusters` are the layout's `buildClusters` output, each carrying
 *   { fixIndex, fixKey, fixtureType, kind: 'dmx'|'led', group, pixels }.
 * `ctx.viewRegistry` (a `createViewRegistry` result) is required ONLY when a
 * panel uses a `view:` selector; absent-registry with a `view:` selector is a
 * wiring bug and throws. `list` (the batch render list) is accepted for
 * contract symmetry with the layout expanders; selection matches on the
 * cluster fields alone and does not read it.
 */

// ─── Vocabulary (locked here; unknown values fail loud) ───────────────────
export const SELECTOR_KEYS = ['kind', 'fixtureType', 'group', 'name', 'view'];
export const KINDS = ['dmx', 'led'];
export const LAYOUTS = ['spatial', 'radial', 'planar', 'lanes'];
export const PROJECTIONS = ['top', 'front', 'side'];

export const VIEWS_SCHEMA_VERSION = 1;

const SELECTOR_KEY_SET = new Set(SELECTOR_KEYS);
const KIND_SET = new Set(KINDS);
const LAYOUT_SET = new Set(LAYOUTS);
const PROJECTION_SET = new Set(PROJECTIONS);

// ─── Glob matching (name / group selectors) ───────────────────────────────
// A pattern with no glob metacharacter is an exact, case-sensitive match; `*`
// matches any run (incl. empty), `?` matches one char. Anchored full match.
const _globCache = new Map();

function globToRegExp(pattern) {
  let re = _globCache.get(pattern);
  if (re) return re;
  const body = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  re = new RegExp(`^${body}$`);
  _globCache.set(pattern, re);
  return re;
}

function globMatch(pattern, value) {
  const p = String(pattern);
  const v = String(value == null ? '' : value);
  if (!p.includes('*') && !p.includes('?')) return v === p;
  return globToRegExp(p).test(v);
}

// ─── Schema validation (fail-loud) ─────────────────────────────────────────

/** Throw unless `sel` is a plain object whose keys are all known selectors. */
export function validateSelector(sel, where) {
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) {
    throw new Error(`[PixelMapViews] ${where}: selector must be an object, got ` +
      `${JSON.stringify(sel)}`);
  }
  for (const [k, v] of Object.entries(sel)) {
    if (!SELECTOR_KEY_SET.has(k)) {
      throw new Error(`[PixelMapViews] ${where}: unknown selector key '${k}' — ` +
        `valid keys are ${SELECTOR_KEYS.join(', ')}`);
    }
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`[PixelMapViews] ${where}: selector '${k}' must be a ` +
        `non-empty string, got ${JSON.stringify(v)}`);
    }
    if (k === 'kind' && !KIND_SET.has(v)) {
      throw new Error(`[PixelMapViews] ${where}: kind must be one of ` +
        `${KINDS.join(' | ')}, got '${v}'`);
    }
  }
  // An empty selector object ({}) is intentionally allowed = "match all".
  return true;
}

/** Throw unless `panel` is a structurally valid panel definition. */
export function validatePanelDef(panel, where) {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
    throw new Error(`[PixelMapViews] ${where}: panel must be an object`);
  }
  if (typeof panel.id !== 'string' || panel.id.length === 0) {
    throw new Error(`[PixelMapViews] ${where}: panel needs a non-empty string id`);
  }
  const pWhere = `${where} panel '${panel.id}'`;
  if (!Array.isArray(panel.select) || panel.select.length === 0) {
    throw new Error(`[PixelMapViews] ${pWhere}: 'select' must be a non-empty array`);
  }
  panel.select.forEach((s, i) => validateSelector(s, `${pWhere} select[${i}]`));
  if (panel.exclude !== undefined) {
    if (!Array.isArray(panel.exclude)) {
      throw new Error(`[PixelMapViews] ${pWhere}: 'exclude' must be an array`);
    }
    panel.exclude.forEach((s, i) => validateSelector(s, `${pWhere} exclude[${i}]`));
  }
  if (!LAYOUT_SET.has(panel.layout)) {
    throw new Error(`[PixelMapViews] ${pWhere}: layout must be one of ` +
      `${LAYOUTS.join(' | ')}, got ${JSON.stringify(panel.layout)}`);
  }
  if (panel.projection !== undefined && !PROJECTION_SET.has(panel.projection)) {
    throw new Error(`[PixelMapViews] ${pWhere}: projection must be one of ` +
      `${PROJECTIONS.join(' | ')}, got ${JSON.stringify(panel.projection)}`);
  }
  if (panel.weight !== undefined &&
      (typeof panel.weight !== 'number' || !(panel.weight > 0))) {
    throw new Error(`[PixelMapViews] ${pWhere}: weight must be a positive number`);
  }
  return true;
}

function validatePlacements(placements, where) {
  if (placements === undefined) return;
  if (!placements || typeof placements !== 'object' || Array.isArray(placements)) {
    throw new Error(`[PixelMapViews] ${where}: placements must be an object`);
  }
  for (const [k, v] of Object.entries(placements)) {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') {
      throw new Error(`[PixelMapViews] ${where}: placement '${k}' must have ` +
        `numeric x and y, got ${JSON.stringify(v)}`);
    }
    if (v.rot !== undefined && typeof v.rot !== 'number') {
      throw new Error(`[PixelMapViews] ${where}: placement '${k}' rot must be a number`);
    }
  }
}

/** Throw unless `view` is a structurally valid view definition. */
export function validateViewDef(view, where = `view '${view && view.id}'`) {
  if (!view || typeof view !== 'object' || Array.isArray(view)) {
    throw new Error(`[PixelMapViews] ${where}: view must be an object`);
  }
  if (typeof view.id !== 'string' || view.id.length === 0) {
    throw new Error(`[PixelMapViews] ${where}: view needs a non-empty string id`);
  }
  if (view.label !== undefined && typeof view.label !== 'string') {
    throw new Error(`[PixelMapViews] ${where}: label must be a string`);
  }
  if (!Array.isArray(view.panels) || view.panels.length === 0) {
    throw new Error(`[PixelMapViews] ${where}: 'panels' must be a non-empty array`);
  }
  const seen = new Set();
  for (const p of view.panels) {
    validatePanelDef(p, where);
    if (seen.has(p.id)) {
      throw new Error(`[PixelMapViews] ${where}: duplicate panel id '${p.id}'`);
    }
    seen.add(p.id);
  }
  validatePlacements(view.placements, where);
  if (view.typeStyles !== undefined &&
      (typeof view.typeStyles !== 'object' || Array.isArray(view.typeStyles))) {
    throw new Error(`[PixelMapViews] ${where}: typeStyles must be an object`);
  }
  return true;
}

// ─── Normalization ─────────────────────────────────────────────────────────
// Clone a validated view into the container's canonical internal shape:
// placements/typeStyles always present as plain objects (serializable, Map-free)
// so persistence is a straight structuredClone-free deep copy.

function normalizeSelector(sel) {
  const out = {};
  for (const k of SELECTOR_KEYS) if (sel[k] !== undefined) out[k] = sel[k];
  return out;
}

function normalizePanel(panel) {
  const out = {
    id: panel.id,
    select: panel.select.map(normalizeSelector),
    layout: panel.layout,
  };
  if (panel.label !== undefined) out.label = panel.label;
  if (panel.exclude !== undefined) out.exclude = panel.exclude.map(normalizeSelector);
  if (panel.projection !== undefined) out.projection = panel.projection;
  if (panel.weight !== undefined) out.weight = panel.weight;
  return out;
}

function normalizePlacements(placements) {
  const out = {};
  if (placements) {
    for (const [k, v] of Object.entries(placements)) {
      out[k] = { x: v.x, y: v.y, rot: v.rot || 0 };
    }
  }
  return out;
}

/** Deep-copy a raw (already-validated) view into the canonical stored shape. */
export function normalizeViewDef(view) {
  const out = {
    id: view.id,
    label: typeof view.label === 'string' ? view.label : view.id,
    panels: view.panels.map(normalizePanel),
    placements: normalizePlacements(view.placements),
    typeStyles: view.typeStyles ? JSON.parse(JSON.stringify(view.typeStyles)) : {},
  };
  return out;
}

// ─── Container: the ordered set of views (params.pixelMapViews) ────────────

/**
 * Build a validated views container from a raw `params.pixelMapViews` tree (or
 * undefined for a fresh scene). Throws on any invalid view or duplicate id — a
 * broken persisted tree is a hard stop, never silently repaired (codex P0).
 */
export function createViewsContainer(raw) {
  const container = { version: VIEWS_SCHEMA_VERSION, views: [] };
  if (raw === undefined || raw === null) return container;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[PixelMapViews] params.pixelMapViews must be an object');
  }
  if (raw.version !== undefined && raw.version !== VIEWS_SCHEMA_VERSION) {
    throw new Error(`[PixelMapViews] unsupported pixelMapViews.version ` +
      `${raw.version} (this build speaks v${VIEWS_SCHEMA_VERSION})`);
  }
  const views = raw.views;
  if (views !== undefined) {
    if (!Array.isArray(views)) {
      throw new Error('[PixelMapViews] pixelMapViews.views must be an array');
    }
    for (const v of views) addView(container, v);
  }
  return container;
}

export function findView(container, id) {
  return container.views.find((v) => v.id === id) || null;
}

/** Validate, normalize, and append a view. Throws on a duplicate id. */
export function addView(container, view) {
  validateViewDef(view);
  if (findView(container, view.id)) {
    throw new Error(`[PixelMapViews] a view with id '${view.id}' already exists`);
  }
  const normalized = normalizeViewDef(view);
  container.views.push(normalized);
  return normalized;
}

/** Create a minimal view (one spatial panel selecting everything by default). */
export function addBlankView(container, { id, label, select, layout, projection } = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('[PixelMapViews] addBlankView needs a non-empty id');
  }
  const view = {
    id,
    label: label || id,
    panels: [{
      id: 'main',
      select: Array.isArray(select) && select.length ? select : [{}],
      layout: layout || 'spatial',
      ...(projection ? { projection } : {}),
    }],
  };
  return addView(container, view);
}

/** Remove a view by id. Throws if it is not present (fail loud). */
export function removeView(container, id) {
  const i = container.views.findIndex((v) => v.id === id);
  if (i < 0) throw new Error(`[PixelMapViews] cannot remove unknown view '${id}'`);
  return container.views.splice(i, 1)[0];
}

/** Lowest free `${base}` / `${base}_copy` / `${base}_copyN` id in the container. */
function freeId(container, base) {
  if (!findView(container, base)) return base;
  let candidate = `${base}_copy`;
  let n = 2;
  while (findView(container, candidate)) candidate = `${base}_copy${n++}`;
  return candidate;
}

/**
 * Deep-duplicate a view (incl. its per-view placements + styles) under a new,
 * unique id. `newId` is auto-derived (`<id>_copy`, `<id>_copy2`, …) when omitted
 * or already taken.
 */
export function duplicateView(container, id, newId, newLabel) {
  const src = findView(container, id);
  if (!src) throw new Error(`[PixelMapViews] cannot duplicate unknown view '${id}'`);
  const targetId = (typeof newId === 'string' && newId.length && !findView(container, newId))
    ? newId
    : freeId(container, newId && newId.length ? newId : id);
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = targetId;
  clone.label = newLabel || `${src.label} copy`;
  return addView(container, clone);
}

// ─── Persistence (↔ params.pixelMapViews) ──────────────────────────────────

/** Plain, serializable snapshot for `params.pixelMapViews` (scene YAML). */
export function toParams(container) {
  return {
    version: container.version,
    views: container.views.map((v) => ({
      id: v.id,
      label: v.label,
      panels: v.panels.map(normalizePanel),
      placements: normalizePlacements(v.placements),
      typeStyles: JSON.parse(JSON.stringify(v.typeStyles || {})),
    })),
  };
}

/**
 * One-time migration of the legacy single-view `params.pixelMap2d` into an
 * `all_fixtures` view, so operator-tuned placements/styles survive the rehaul.
 * No-op (returns false) when the container already has views or there is no
 * legacy layout to carry over. Reported by the caller in one console line.
 */
export function migrateLegacyPixelMap2d(container, legacy) {
  if (container.views.length > 0) return false;
  if (!legacy || typeof legacy !== 'object') return false;
  const hasFixtures = legacy.fixtures && Object.keys(legacy.fixtures).length > 0;
  const hasTypes = legacy.types && Object.keys(legacy.types).length > 0;
  if (!hasFixtures && !hasTypes) return false;

  const projection = legacy.plane === 'top' || legacy.plane === 'front'
    ? legacy.plane
    : undefined;
  addView(container, {
    id: 'all_fixtures',
    label: 'All Fixtures',
    panels: [{
      id: 'main',
      select: [{}],           // match every fixture
      layout: 'spatial',
      ...(projection ? { projection } : {}),
    }],
    placements: legacy.fixtures || {},
    typeStyles: legacy.types || {},
  });
  return true;
}

// ─── Selector resolution ───────────────────────────────────────────────────

/**
 * The set of group names a `view:` selector resolves to via the scene's
 * view_registry: a base group name resolves to itself; a custom-view name
 * resolves to that view's member groups. Returns null when the name is
 * unknown (caller turns that into a loud per-panel error). Throws only when a
 * `view:` selector is used with no registry supplied (a wiring bug).
 */
function resolveViewGroups(viewName, registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error(`[PixelMapViews] selector 'view: ${viewName}' needs a ` +
      `view_registry in ctx.viewRegistry — none was provided`);
  }
  if (registry.groupBits && registry.groupBits[viewName] !== undefined) {
    return new Set([viewName]);
  }
  const custom = (registry.custom || []).find((v) => v.name === viewName);
  if (custom) return new Set(custom.groups || []);
  return null; // unknown view name
}

function selectorMatches(sel, cluster, viewGroupCache) {
  for (const [k, v] of Object.entries(sel)) {
    if (k === 'kind') {
      if (cluster.kind !== v) return false;
    } else if (k === 'fixtureType') {
      if (cluster.fixtureType !== v) return false;
    } else if (k === 'group') {
      if (!globMatch(v, cluster.group)) return false;
    } else if (k === 'name') {
      if (!globMatch(v, cluster.fixKey)) return false;
    } else if (k === 'view') {
      const groups = viewGroupCache.get(v);
      if (!groups || !groups.has(cluster.group)) return false;
    }
  }
  return true; // empty selector → matches every cluster
}

// Pre-resolve every `view:` name referenced by a panel's selectors. Returns
// { cache: Map<name,Set<group>>, unknown: [names] } — unknown names become a
// loud panel error rather than a silent zero-match.
function buildViewGroupCache(panel, registry) {
  const cache = new Map();
  const unknown = [];
  const scan = (selectors) => {
    for (const sel of selectors || []) {
      if (typeof sel.view !== 'string') continue;
      if (cache.has(sel.view) || unknown.includes(sel.view)) continue;
      const groups = resolveViewGroups(sel.view, registry);
      if (groups === null) unknown.push(sel.view);
      else cache.set(sel.view, groups);
    }
  };
  scan(panel.select);
  scan(panel.exclude);
  return { cache, unknown };
}

function resolvePanel(panel, clusters, registry) {
  const { cache, unknown } = buildViewGroupCache(panel, registry);
  if (unknown.length) {
    return {
      def: panel,
      clusters: [],
      error: `Panel '${panel.id}': selector references unknown view(s) ` +
        `${unknown.map((n) => `'${n}'`).join(', ')} in the view registry`,
    };
  }
  const exclude = panel.exclude || [];
  const matched = clusters.filter((c) =>
    panel.select.some((s) => selectorMatches(s, c, cache)) &&
    !exclude.some((s) => selectorMatches(s, c, cache)));
  if (matched.length === 0) {
    return {
      def: panel,
      clusters: [],
      error: `Panel '${panel.id}': no fixtures match its selectors ` +
        `(${describeSelectors(panel.select)})`,
    };
  }
  return { def: panel, clusters: matched };
}

function describeSelectors(select) {
  return select.map((s) => {
    const keys = Object.keys(s);
    if (keys.length === 0) return '{all}';
    return keys.map((k) => `${k}=${s[k]}`).join('&');
  }).join(' | ');
}

/** placements plain object → the Map<fixKey,{x,y,rot}> the layout expects. */
function placementsToMap(placements) {
  const m = new Map();
  if (placements) {
    for (const [k, v] of Object.entries(placements)) {
      m.set(k, { x: v.x, y: v.y, rot: v.rot || 0 });
    }
  }
  return m;
}

/**
 * Resolve a view against the current layout clusters. Returns the view's
 * panels, each carrying the clusters its selectors matched plus the view's
 * shared placements (as a Map) and style overrides. A panel whose selectors
 * match nothing (or reference an unknown registry view) carries a loud `error`
 * string and an empty cluster list — renderable, never silently blank.
 *
 * Throws on an invalid view schema (unknown selector key, bad layout, …) — the
 * whole view is unrenderable and must fail loudly, not degrade.
 */
export function resolveView(viewDef, clusters, list, ctx = {}) {
  validateViewDef(viewDef);
  const registry = ctx.viewRegistry;
  const placements = placementsToMap(viewDef.placements);
  const styles = viewDef.typeStyles || {};
  const panels = viewDef.panels.map((p) => {
    const r = resolvePanel(p, clusters || [], registry);
    return { ...r, placements, styles };
  });
  return { id: viewDef.id, label: viewDef.label || viewDef.id, panels };
}
