/**
 * pixel_map_views.js — "views are data" engine for the 2D Pixel Map multiview.
 *
 * A *view* is a named, editable arrangement of fixtures made of one or more
 * *panels*. Each panel is:
 *   - a set of fixture *selectors* (union): kind / fixtureType / group / name
 *     (glob) / view (resolved through the Views-Rehaul `view_registry`), with
 *     an optional `exclude` list,
 *   - a *projection* (top | front | side) — the world plane a spatial seed uses,
 *   - a *layout* type (spatial | radial | planar | lanes),
 *   - an optional *rotate* (0 | 90 | 180 | 270, degrees counter-clockwise) that
 *     re-orients a TRUE projection (spatial | planar) as a whole.
 * Placements (fixKey → {x,y,rot}), per-type style overrides and the operator's
 * FRAMING (pan/zoom) are stored PER VIEW, so the same fixture can sit
 * differently — and be framed differently — in "top-down" vs "front".
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
// Quarter-turn re-orientation of a TRUE projection (degrees COUNTER-CLOCKWISE).
// Only the projected layouts have an orientation to turn; radial/lanes place
// fixtures from per-fixture anchors, so `rotate` there would be meaningless and
// is rejected rather than ignored (codex P0: fail loud).
export const ROTATIONS = [0, 90, 180, 270];
// Persisted per-view framing (operator pan/zoom). Bounds MUST match the
// interaction layer's wheel clamp (pixel_map_interaction ZOOM_MIN/ZOOM_MAX) or a
// framing he can reach by scrolling would be rejected on reload.
export const FRAMING_ZOOM_MIN = 0.3;
export const FRAMING_ZOOM_MAX = 8;
export const ROTATABLE_LAYOUTS = ['spatial', 'planar'];

export const VIEWS_SCHEMA_VERSION = 1;

const SELECTOR_KEY_SET = new Set(SELECTOR_KEYS);
const KIND_SET = new Set(KINDS);
const LAYOUT_SET = new Set(LAYOUTS);
const PROJECTION_SET = new Set(PROJECTIONS);
const ROTATION_SET = new Set(ROTATIONS);
const ROTATABLE_LAYOUT_SET = new Set(ROTATABLE_LAYOUTS);

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
  if (panel.rotate !== undefined) {
    if (!ROTATION_SET.has(panel.rotate)) {
      throw new Error(`[PixelMapViews] ${pWhere}: rotate must be one of ` +
        `${ROTATIONS.join(' | ')} (degrees counter-clockwise), got ` +
        `${JSON.stringify(panel.rotate)}`);
    }
    if (!ROTATABLE_LAYOUT_SET.has(panel.layout)) {
      throw new Error(`[PixelMapViews] ${pWhere}: rotate is only meaningful on a ` +
        `TRUE projection (${ROTATABLE_LAYOUTS.join(' | ')}) — layout is ` +
        `'${panel.layout}', whose fixtures are placed from per-fixture anchors`);
    }
  }
  if (panel.fit !== undefined) {
    if (typeof panel.fit !== 'boolean') {
      throw new Error(`[PixelMapViews] ${pWhere}: fit must be boolean, got ` +
        `${JSON.stringify(panel.fit)}`);
    }
    if (panel.layout !== 'planar') {
      throw new Error(`[PixelMapViews] ${pWhere}: fit is only meaningful on a ` +
        `'planar' panel — layout is '${panel.layout}'`);
    }
  }
  if (panel.washAngle !== undefined &&
      (typeof panel.washAngle !== 'number' || !Number.isFinite(panel.washAngle)
        || panel.washAngle < -180 || panel.washAngle > 180)) {
    throw new Error(`[PixelMapViews] ${pWhere}: washAngle must be a finite ` +
      `number from -180 to 180 degrees, got ${JSON.stringify(panel.washAngle)}`);
  }
  // ─── The two operator-ordered departures from the true projection ────────
  // Both only make sense where the projected axes ARE world axes, i.e. on a
  // `spatial` panel — anywhere else they are a wiring bug, not a preference.
  if (panel.compress !== undefined) {
    const c = panel.compress;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new Error(`[PixelMapViews] ${pWhere}: compress must be an object ` +
        '{ minWorldGap, gapWorld }');
    }
    for (const k of ['minWorldGap', 'gapWorld']) {
      if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < 0) {
        throw new Error(`[PixelMapViews] ${pWhere}: compress.${k} must be a ` +
          `non-negative finite number, got ${JSON.stringify(c[k])}`);
      }
    }
    if (!(c.gapWorld < c.minWorldGap)) {
      throw new Error(`[PixelMapViews] ${pWhere}: compress.gapWorld ` +
        `(${c.gapWorld}) must be SMALLER than compress.minWorldGap ` +
        `(${c.minWorldGap}) — otherwise a collapsed band would come out wider ` +
        'than the gap that qualified it, which is not a compression');
    }
    if (panel.layout !== 'spatial') {
      throw new Error(`[PixelMapViews] ${pWhere}: compress needs a 'spatial' ` +
        `layout (its axes are real world axes) — layout is '${panel.layout}'`);
    }
  }
  if (panel.expandPitch !== undefined) {
    const e = panel.expandPitch;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      throw new Error(`[PixelMapViews] ${pWhere}: expandPitch must be an object ` +
        'keyed by fixtureType, e.g. { VintageLed: 0.6 }');
    }
    for (const [type, val] of Object.entries(e)) {
      const plainPitch = typeof val === 'number' && val > 0;
      const lineForm = !!val && typeof val === 'object' && !Array.isArray(val) &&
        typeof val.pitch === 'number' && val.pitch > 0 && val.layout === 'line' &&
        (val.direction === undefined || val.direction === 'vertical') &&
        Object.keys(val).every((k) => k === 'pitch' || k === 'layout' || k === 'direction');
      if (!plainPitch && !lineForm) {
        throw new Error(`[PixelMapViews] ${pWhere}: expandPitch['${type}'] must ` +
          `be a positive number of WORLD units or ` +
          `{ pitch, layout: 'line', direction?: 'vertical' }, ` +
          `got ${JSON.stringify(val)}`);
      }
    }
    if (panel.layout !== 'spatial') {
      throw new Error(`[PixelMapViews] ${pWhere}: expandPitch needs a 'spatial' ` +
        `layout — layout is '${panel.layout}'`);
    }
  }
  if (panel.weight !== undefined &&
      (typeof panel.weight !== 'number' || !(panel.weight > 0))) {
    throw new Error(`[PixelMapViews] ${pWhere}: weight must be a positive number`);
  }
  return true;
}

/**
 * Per-fixture MOVE offsets for a view, in design units (report 20260725_55).
 *
 * Distinct from `placements` on purpose. `placements` are ABSOLUTE anchors and
 * only the `radial`/`lanes` layouts read them — a `spatial`/`planar` panel is a
 * TRUE projection that computes every position from world coordinates, which is
 * why dragging a fixture in the shipped Top-Down view moved nothing at all
 * before this existed (the operator's "has no move"). An offset is a DELTA
 * applied after the projection's fit, so the projection stays the source of
 * truth and his adjustment layers on top of it — the same relationship the
 * defaults and his other adjustments already have.
 */
export function validateOffsets(offsets, where) {
  if (offsets === undefined || offsets === null) return;
  if (typeof offsets !== 'object' || Array.isArray(offsets)) {
    throw new Error(`[PixelMapViews] ${where}: offsets must be an object keyed by fixture`);
  }
  for (const [k, v] of Object.entries(offsets)) {
    if (!v || typeof v.dx !== 'number' || typeof v.dy !== 'number'
        || !Number.isFinite(v.dx) || !Number.isFinite(v.dy)) {
      throw new Error(`[PixelMapViews] ${where}: offset '${k}' must have finite ` +
        `numeric dx and dy, got ${JSON.stringify(v)}`);
    }
    if (v.rot !== undefined && (typeof v.rot !== 'number' || !Number.isFinite(v.rot)
        || v.rot < -180 || v.rot > 180)) {
      throw new Error(`[PixelMapViews] ${where}: offset '${k}'.rot must be a ` +
        `finite number from -180 to 180 degrees, got ${JSON.stringify(v.rot)}`);
    }
  }
}

/**
 * The operator's saved pan/zoom for a view (report 20260725_54). Optional; a
 * view without one opens at the shipped fit, which is what every view did
 * before this existed.
 */
export function validateFraming(framing, where) {
  if (framing === undefined || framing === null) return;
  if (typeof framing !== 'object' || Array.isArray(framing)) {
    throw new Error(`[PixelMapViews] ${where}: framing must be an object ` +
      '{ zoom, panX, panY }');
  }
  for (const k of ['zoom', 'panX', 'panY']) {
    if (typeof framing[k] !== 'number' || !Number.isFinite(framing[k])) {
      throw new Error(`[PixelMapViews] ${where}: framing.${k} must be a finite ` +
        `number, got ${JSON.stringify(framing[k])}`);
    }
  }
  if (framing.zoom < FRAMING_ZOOM_MIN || framing.zoom > FRAMING_ZOOM_MAX) {
    throw new Error(`[PixelMapViews] ${where}: framing.zoom must be between ` +
      `${FRAMING_ZOOM_MIN} and ${FRAMING_ZOOM_MAX}, got ${framing.zoom}`);
  }
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
  validateOffsets(view.offsets, where);
  validateFraming(view.framing, where);
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
  if (panel.rotate !== undefined) out.rotate = panel.rotate;
  if (panel.fit !== undefined) out.fit = panel.fit;
  if (panel.washAngle !== undefined) out.washAngle = panel.washAngle;
  if (panel.compress !== undefined) out.compress = { ...panel.compress };
  if (panel.expandPitch !== undefined) out.expandPitch = { ...panel.expandPitch };
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
  // Absent framing stays ABSENT (not defaulted to 1/0/0) so "he never framed
  // this view" is distinguishable from "he framed it back to the shipped fit".
  if (view.framing) {
    out.framing = { zoom: view.framing.zoom, panX: view.framing.panX, panY: view.framing.panY };
  }
  if (view.offsets && Object.keys(view.offsets).length) {
    out.offsets = {};
    for (const [k, v] of Object.entries(view.offsets)) {
      out.offsets[k] = { dx: v.dx, dy: v.dy };
      if (v.rot !== undefined) out.offsets[k].rot = v.rot;
    }
  }
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

/**
 * Migrate `{group: '<old>'}` selectors across a group rename (plan
 * 20260725_44 step 12).
 *
 * A view's panels reference groups BY NAME, so renaming a group in the editor
 * silently dropped that group out of every view that named it — exactly what
 * happened to the right chimney ring when the operator renamed 'Right Top
 * Chimney Generator' (report `_44` §3.6): the panel just went quiet.
 *
 * Only EXACT matches migrate. A glob (`*`, `?`) is deliberate operator intent
 * about a family of names, not a reference to one group, so rewriting it would
 * be guessing — those are left alone and the caller's zero-match warning
 * surfaces any that stop matching.
 *
 * Returns one row per rewritten selector so the caller logs it loudly.
 *
 * @returns {Array<{view: string, panel: string, where: 'select'|'exclude', index: number}>}
 */
export function renameGroupInViews(container, oldName, newName) {
  const changed = [];
  if (!container || !Array.isArray(container.views)) return changed;
  if (typeof oldName !== 'string' || oldName.length === 0) {
    throw new Error('[PixelMapViews] renameGroupInViews needs a non-empty oldName');
  }
  if (typeof newName !== 'string' || newName.length === 0) {
    throw new Error('[PixelMapViews] renameGroupInViews needs a non-empty newName');
  }
  if (oldName === newName) return changed;
  for (const view of container.views) {
    for (const panel of view.panels || []) {
      for (const where of ['select', 'exclude']) {
        const list = panel[where];
        if (!Array.isArray(list)) continue;
        list.forEach((sel, index) => {
          if (!sel || sel.group !== oldName) return;
          sel.group = newName;
          changed.push({ view: view.id, panel: panel.id, where, index });
        });
      }
    }
  }
  return changed;
}

/**
 * Drop every reference to a DELETED fixture: exact `{name: '<fixture>'}`
 * selectors, plus the per-view `offsets` / `placements` entries keyed by its
 * name (the layout's `fixKey` defaults to the fixture name).
 *
 * Used by the orphan-fixture removal path (report 20260725_76). Deleting a
 * fixture without this leaves a selector that can never match again and a move
 * offset that silently re-attaches the day a fixture is created with the same
 * name — the same phantom class the rename hygiene work eliminated for the
 * patch tree.
 *
 * Globs are left alone for the same reason `renameGroupInViews` leaves them:
 * a glob is intent about a family of names, not a reference to this fixture.
 *
 * THROWS when removal would empty a panel's `select` — `validatePanelDef`
 * rejects an empty `select`, so silently corrupting the tree (or silently
 * skipping the removal) are both worse than refusing. The caller enumerates
 * this case up front (`pixelMapReferences().selectors[].lastInSelect`) and
 * refuses the delete before anything is mutated.
 *
 * @returns {{selectors: Array<{view, panel, where, index}>, offsets: string[],
 *   placements: string[]}}
 */
export function removeFixtureFromViews(container, fixtureName) {
  const removed = { selectors: [], offsets: [], placements: [] };
  if (!container || !Array.isArray(container.views)) return removed;
  if (typeof fixtureName !== 'string' || fixtureName.length === 0) {
    throw new Error('[PixelMapViews] removeFixtureFromViews needs a non-empty fixtureName');
  }
  for (const view of container.views) {
    for (const panel of view.panels || []) {
      for (const where of ['select', 'exclude']) {
        const list = panel[where];
        if (!Array.isArray(list)) continue;
        const keep = [];
        const dropped = [];
        list.forEach((sel, index) => {
          if (sel && sel.name === fixtureName) dropped.push(index);
          else keep.push(sel);
        });
        if (dropped.length === 0) continue;
        if (where === 'select' && keep.length === 0) {
          throw new Error(`[PixelMapViews] removeFixtureFromViews: '${fixtureName}' is the ` +
            `ONLY selector of panel '${panel.id}' in view '${view.id}' — removing it would ` +
            'leave an empty `select`, which the schema rejects. Re-point or delete that ' +
            'panel first.');
        }
        panel[where] = keep;
        for (const index of dropped) {
          removed.selectors.push({ view: view.id, panel: panel.id, where, index });
        }
      }
    }
    if (view.offsets && Object.prototype.hasOwnProperty.call(view.offsets, fixtureName)) {
      delete view.offsets[fixtureName];
      removed.offsets.push(view.id);
    }
    if (view.placements && Object.prototype.hasOwnProperty.call(view.placements, fixtureName)) {
      delete view.placements[fixtureName];
      removed.placements.push(view.id);
    }
  }
  return removed;
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
      ...(v.framing ? { framing: { ...v.framing } } : {}),
      ...(v.offsets && Object.keys(v.offsets).length
        ? { offsets: JSON.parse(JSON.stringify(v.offsets)) } : {}),
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
 * unknown, and the string 'per-fixture' when the view exists but has NO
 * group membership — its members live in per-fixture mask bits (fixture
 * configs), which cluster selection cannot see, so silently resolving it to
 * the empty set would drop it from a selector union without a trace (the
 * exact silent-partial-loss codex P0 forbids). The caller turns both
 * non-Set results into a loud per-panel error. Throws only when a
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
  if (custom) {
    const groups = new Set(custom.groups || []);
    return groups.size > 0 ? groups : 'per-fixture';
  }
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
  const perFixture = [];
  const scan = (selectors) => {
    for (const sel of selectors || []) {
      if (typeof sel.view !== 'string') continue;
      if (cache.has(sel.view) || unknown.includes(sel.view) ||
          perFixture.includes(sel.view)) continue;
      const groups = resolveViewGroups(sel.view, registry);
      if (groups === null) unknown.push(sel.view);
      else if (groups === 'per-fixture') perFixture.push(sel.view);
      else cache.set(sel.view, groups);
    }
  };
  scan(panel.select);
  scan(panel.exclude);
  return { cache, unknown, perFixture };
}

function resolvePanel(panel, clusters, registry) {
  const { cache, unknown, perFixture } = buildViewGroupCache(panel, registry);
  if (unknown.length) {
    return {
      def: panel,
      clusters: [],
      error: `Panel '${panel.id}': selector references unknown view(s) ` +
        `${unknown.map((n) => `'${n}'`).join(', ')} in the view registry`,
    };
  }
  if (perFixture.length) {
    // A group-less custom view keeps its members in per-fixture mask bits,
    // which these group-based cluster selectors cannot resolve. Erroring the
    // whole panel is deliberate: in a selector UNION the view would otherwise
    // contribute silently nothing (partial loss with no trace).
    return {
      def: panel,
      clusters: [],
      error: `Panel '${panel.id}': view(s) ` +
        `${perFixture.map((n) => `'${n}'`).join(', ')} have per-fixture (clicked-fixture) ` +
        'membership, which 2D Pixel Map `view:` selectors cannot resolve — attach groups ' +
        'to the view, or select the fixtures here by name/group instead',
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
    // The pane paints the error on the canvas (pixel_map_pane_view
    // `_drawError`), but a group rename that empties a panel is most often
    // noticed in the console — so say it there too, ONCE per distinct
    // panel+reason (resolveView runs on every structural rebuild).
    if (r.error) warnPanelErrorOnce(viewDef.id, r.error);
    return { ...r, placements, styles };
  });
  return { id: viewDef.id, label: viewDef.label || viewDef.id, panels };
}

const _warnedPanelErrors = new Set();

function warnPanelErrorOnce(viewId, error) {
  const key = `${viewId}::${error}`;
  if (_warnedPanelErrors.has(key)) return;
  _warnedPanelErrors.add(key);
  console.warn(`[PixelMapViews] ⚠ view '${viewId}': ${error}. A renamed or deleted ` +
    'group leaves its selector pointing at nothing — re-point it in the view editor.');
}

/** Forget the once-per-reason warning ledger (a rename may fix or break panels). */
export function resetPanelErrorWarnings() {
  _warnedPanelErrors.clear();
}
