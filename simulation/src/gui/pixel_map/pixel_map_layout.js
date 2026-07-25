/**
 * pixel_map_layout.js — pure layout math for the 2D Pixel Map (no DOM, no
 * canvas). Turns the live _batchRenderList into fixture clusters, seeds a
 * pleasing initial 2D placement from world coordinates, and expands each
 * fixture into per-pixel screen positions given its placement + per-type style.
 *
 * All positions are in the Pixel Map's fixed "design space" (logical units),
 * NOT CSS pixels — the renderer letterboxes design space into the canvas.
 *
 * Seed projection math is adapted from the gallery live visualizer
 * (marsin_engine/tools/gallery/live_layout.mjs → buildMap): pick the two
 * world axes with the largest spread, normalize preserving aspect, flip Y.
 */

// ─── Per-type "goofy pixel" styles ────────────────────────────────────────
// sizeX/sizeY/gap are in design units. sizeX = pixel width along the fixture's
// run (the bar's length direction); sizeY = height perpendicular to it — so you
// can fatten pixels independently. gap spaces them along the run. shape ∈
// 'square' | 'circle' (a non-square size makes rectangles / ellipses).
// `sectionEvery` adds a subtle extra gap after every Nth pixel (segments a bar
// into its physical sections).
export const TYPE_STYLES = {
  ShehdsBar:  { shape: 'square', sizeX: 13, sizeY: 13, gap: 3, sectionEvery: 6, sectionGap: 4 },
  VintageLed: { shape: 'circle', sizeX: 15, sizeY: 15, gap: 5, specular: true },
  UkingPar:   { shape: 'circle', sizeX: 24, sizeY: 24, gap: 0, bezelRing: true },
  // LED strand pixels are many & small — tight dots so a 40-px strand reads as
  // a strand, not a wall. TeLedGrid40 is the TE sign (a true 2-D grid, expanded
  // via the `planar` layout): compact square cells with a hair of gap.
  LedStrand:   { shape: 'square', sizeX: 7,  sizeY: 7,  gap: 2 },
  TeLedGrid40: { shape: 'square', sizeX: 9,  sizeY: 9,  gap: 2 },
  // TE Sign V3 — the real sign's two interlocking logo halves (LED-class, DMX
  // transport). Irregular per-pixel `dots` (not a grid): expanded via `planar`
  // from real world coords, so these are just the dot sizes. Small dots so the
  // 74-px logo reads as a sign, not a wall.
  TeSignV3A40: { shape: 'square', sizeX: 7,  sizeY: 7,  gap: 1 },
  TeSignV3B34: { shape: 'square', sizeX: 7,  sizeY: 7,  gap: 1 },
  _default:   { shape: 'square', sizeX: 13, sizeY: 13, gap: 3 },
};

export const DEFAULT_CANVAS = { w: 900, h: 520 };

// Fixture types that are DMX-TRANSPORTED on the wire but classified as LED
// fixtures in the taxonomy (operator ruling, Sina 2026-07-24). Their cluster
// `kind` is derived as 'led' even though the exporter/model bytes and the wire
// transport stay DMX — this is a display/selector classification only, so S1's
// exporter byte-parity test is unaffected. The titanic scene's TE sign is now
// the real TE Sign V3 pair (TeSignV3A40 + TeSignV3B34, group 'TE Sign'); the
// legacy TeLedGrid40 placeholder is retired (no scene uses it).
export const LED_CLASS_FIXTURE_TYPES = new Set(['TeSignV3A40', 'TeSignV3B34']);

const _warnedTypes = new Set();

/** Merge default style for `fixtureType` with any per-scene size/gap override.
 *  Accepts legacy single `size` (applied to both axes) for back-compat. */
export function styleFor(fixtureType, typeOverrides) {
  let base = TYPE_STYLES[fixtureType];
  if (!base) {
    base = TYPE_STYLES._default;
    if (!_warnedTypes.has(fixtureType)) {
      _warnedTypes.add(fixtureType);
      console.info(`[PixelMap] unknown fixtureType '${fixtureType}' → default square style.`);
    }
  }
  const ov = typeOverrides && typeOverrides[fixtureType];
  if (!ov) return { ...base };
  const out = { ...base };
  if (typeof ov.sizeX === 'number') out.sizeX = ov.sizeX;
  else if (typeof ov.size === 'number') out.sizeX = ov.size;
  if (typeof ov.sizeY === 'number') out.sizeY = ov.sizeY;
  else if (typeof ov.size === 'number') out.sizeY = ov.size;
  if (typeof ov.gap === 'number') out.gap = ov.gap;
  return out;
}

// ─── Cluster the flat pixel list into fixtures ────────────────────────────
// Entries for one physical fixture are contiguous and share `fixIndex`
// (added by the exporter — fId is unreliable, often 0). Duplicate fixKeys get
// a deterministic ~n suffix so placements stay addressable.
export function buildClusters(batchList) {
  if (!batchList || batchList.length === 0) return [];
  const clusters = [];
  let cur = null;
  for (let gi = 0; gi < batchList.length; gi++) {
    const e = batchList[gi];
    const fi = e.fixIndex;
    if (!cur || cur.fixIndex !== fi) {
      // `kind` classifies the cluster as 'dmx' | 'led'. It is LED when the
      // pixel is LED-TRANSPORTED, OR when its fixtureType is LED-class by ruling
      // (the TE LED Grid is DMX-wired but an LED fixture — operator 2026-07-24;
      // see LED_CLASS_FIXTURE_TYPES). A strand pixel carries an empty serialized
      // fixtureType (byte-identity — the exporter never stamps 'LedStrand' on the
      // model), so the cluster's display type is derived here: an LED cluster
      // styles as 'LedStrand' unless it has an explicit type. This is a
      // display/selector classification only — the model bytes stay untouched.
      const serializedType = e.fixtureType || '';
      const kind = (e.type === 'led' || LED_CLASS_FIXTURE_TYPES.has(serializedType)) ? 'led' : 'dmx';
      const fixtureType = serializedType || (kind === 'led' ? 'LedStrand' : 'Generic');
      cur = {
        fixIndex: fi,
        fixKey: e.fixKey || e.name || `Fixture ${fi}`,
        fixtureType,
        kind,
        group: e.group || '',
        pixels: [], // { gi } — index into batchList for live color read
      };
      clusters.push(cur);
    }
    cur.pixels.push({ gi });
  }
  // Disambiguate duplicate fixKeys (operator should name fixtures uniquely).
  const seen = new Map();
  for (const c of clusters) {
    const n = (seen.get(c.fixKey) || 0) + 1;
    seen.set(c.fixKey, n);
    if (n > 1) {
      console.warn(`[PixelMap] duplicate fixture name '${c.fixKey}' → keyed as '${c.fixKey}~${n}'.`);
      c.fixKey = `${c.fixKey}~${n}`;
    }
  }
  return clusters;
}

/** World centroid of a cluster from the live entries. */
function clusterCentroid(cluster, batchList) {
  let x = 0, y = 0, z = 0;
  const n = cluster.pixels.length || 1;
  for (const p of cluster.pixels) {
    const e = batchList[p.gi];
    x += e.wx || 0; y += e.wy || 0; z += e.wz || 0;
  }
  return { x: x / n, y: y / n, z: z / n };
}

function rot15(deg) { return Math.round(deg / 15) * 15; }

// ─── Seed an initial 2D placement from world coordinates ──────────────────
// Returns Map<fixKey, {x, y, rot}> in design units.
export function seedLayout(clusters, batchList, plane, canvasW, canvasH, typeOverrides) {
  const placements = new Map();
  if (!clusters.length) return placements;

  const centroids = clusters.map((c) => clusterCentroid(c, batchList));
  const spread = (key) => {
    const v = centroids.map((c) => c[key]);
    return Math.max(...v) - Math.min(...v);
  };
  const sx = spread('x'), sy = spread('y'), sz = spread('z');

  // Choose the projection plane: two largest-spread axes for 'auto'.
  let axA, axB;
  if (plane === 'top') { axA = 'x'; axB = 'z'; }
  else if (plane === 'front') { axA = 'x'; axB = 'y'; }
  else {
    const ranked = [['x', sx], ['y', sy], ['z', sz]].sort((a, b) => b[1] - a[1]);
    axA = ranked[0][0]; axB = ranked[1][0];
  }

  const ha = centroids.map((c) => c[axA]);
  const va = centroids.map((c) => c[axB]);
  const ha0 = Math.min(...ha), ha1 = Math.max(...ha);
  const va0 = Math.min(...va), va1 = Math.max(...va);
  const hR = (ha1 - ha0) || 1;
  const vR = (va1 - va0) || 1;

  // Preserve aspect: fit the world rectangle into the padded canvas box.
  const maxSize = Math.max(...clusters.map((c) => {
    const s = styleFor(c.fixtureType, typeOverrides); return Math.max(s.sizeX, s.sizeY);
  }));
  const pad = maxSize * 2 + 20;
  const boxW = Math.max(1, canvasW - pad * 2);
  const boxH = Math.max(1, canvasH - pad * 2);
  const worldAspect = vR / hR;
  const boxAspect = boxH / boxW;
  let drawW, drawH;
  if (worldAspect <= boxAspect) { drawW = boxW; drawH = boxW * worldAspect; }
  else { drawH = boxH; drawW = boxH / worldAspect; }
  const ox = pad + (boxW - drawW) / 2;
  const oy = pad + (boxH - drawH) / 2;

  clusters.forEach((c, idx) => {
    const cen = centroids[idx];
    const hx = (cen[axA] - ha0) / hR;      // 0..1 left→right
    const vy = 1 - (cen[axB] - va0) / vR;  // 0..1 top→bottom (flip)
    const x = ox + hx * drawW;
    const y = oy + vy * drawH;

    // Rotation seed: project the fixture's own axis (first→last pixel) onto
    // the plane so bars/vintage rows lie along their physical direction.
    let rot = 0;
    if (c.pixels.length > 1) {
      const a = batchList[c.pixels[0].gi];
      const b = batchList[c.pixels[c.pixels.length - 1].gi];
      const dh = (b['w' + axA] ?? b[axAWorld(axA)]) - (a['w' + axA] ?? a[axAWorld(axA)]);
      const dv = (b[axAWorld(axB)]) - (a[axAWorld(axB)]);
      rot = rot15(Math.atan2(-dv, dh) * 180 / Math.PI);
    }
    placements.set(c.fixKey, { x: round1(x), y: round1(y), rot });
  });

  relaxCollisions(clusters, placements, typeOverrides);
  return placements;
}

// world-field accessor: axis 'x'|'y'|'z' → entry field 'wx'|'wy'|'wz'
function axAWorld(ax) { return ax === 'x' ? 'wx' : ax === 'y' ? 'wy' : 'wz'; }
function round1(v) { return Math.round(v * 2) / 2; }

// Nudge fixtures that seeded on top of each other apart perpendicular to
// their run — seeds should never look pre-overlapped.
function relaxCollisions(clusters, placements, typeOverrides) {
  for (let a = 0; a < clusters.length; a++) {
    for (let b = a + 1; b < clusters.length; b++) {
      const pa = placements.get(clusters[a].fixKey);
      const pb = placements.get(clusters[b].fixKey);
      if (!pa || !pb) continue;
      const ha = clusterHalfLen(clusters[a], typeOverrides);
      const hb = clusterHalfLen(clusters[b], typeOverrides);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy);
      const minD = 0.6 * (ha + hb);
      if (d < minD) {
        const push = (minD - d) + 6;
        const ux = d > 0.001 ? dx / d : 0, uy = d > 0.001 ? dy / d : 1;
        pb.x = round1(pb.x + ux * push);
        pb.y = round1(pb.y + uy * push);
      }
    }
  }
}

function clusterHalfLen(cluster, typeOverrides) {
  const s = styleFor(cluster.fixtureType, typeOverrides);
  const n = cluster.pixels.length;
  return ((n - 1) * (s.sizeX + s.gap)) / 2 + s.sizeX / 2;
}

// ─── Expand a fixture into per-pixel screen positions ─────────────────────
// Returns [{ gi, cx, cy, size, shape }] in design units. Pixels run along the
// fixture's local X (rotated by placement.rot), centered on the anchor.
export function clusterPixelPositions(cluster, placement, style) {
  const n = cluster.pixels.length;
  const pitch = style.sizeX + style.gap;
  const rot = placement.rot || 0;
  const rad = rot * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  // Precompute cumulative local X with optional section gaps, then center.
  const locals = [];
  let x = 0;
  for (let k = 0; k < n; k++) {
    locals.push(x);
    x += pitch;
    if (style.sectionEvery && (k + 1) % style.sectionEvery === 0 && k < n - 1) {
      x += style.sectionGap || 0;
    }
  }
  const span = locals.length ? locals[locals.length - 1] : 0;
  const half = span / 2;

  const out = [];
  for (let k = 0; k < n; k++) {
    const lx = locals[k] - half;
    const ly = 0;
    out.push({
      gi: cluster.pixels[k].gi,
      cx: placement.x + lx * cos - ly * sin,
      cy: placement.y + lx * sin + ly * cos,
      sizeX: style.sizeX,
      sizeY: style.sizeY,
      shape: style.shape,
      rot,
    });
  }
  return out;
}

/** Bounding box of a placed fixture (design units) — for hit testing/hulls.
 *  Uses each pixel's half-diagonal so a rotated rectangle still fits. */
export function clusterBounds(cluster, placement, style) {
  const pts = clusterPixelPositions(cluster, placement, style);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const r = Math.hypot(p.sizeX, p.sizeY) / 2;
    minX = Math.min(minX, p.cx - r); minY = Math.min(minY, p.cy - r);
    maxX = Math.max(maxX, p.cx + r); maxY = Math.max(maxY, p.cy + r);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** fixKeys of every fixture whose hull intersects the design-space rect. */
export function fixturesInRect(clusters, placements, typeOverrides, x0, y0, x1, y1) {
  const rx0 = Math.min(x0, x1), rx1 = Math.max(x0, x1);
  const ry0 = Math.min(y0, y1), ry1 = Math.max(y0, y1);
  const keys = [];
  for (const c of clusters) {
    const pl = placements.get(c.fixKey);
    if (!pl) continue;
    const b = clusterBounds(c, pl, styleFor(c.fixtureType, typeOverrides));
    if (b.minX <= rx1 && b.maxX >= rx0 && b.minY <= ry1 && b.maxY >= ry0) keys.push(c.fixKey);
  }
  return keys;
}

/** fixKeys of every fixture in the same logical group (Left Vintage, …). */
export function fixturesInGroup(clusters, groupName) {
  return clusters.filter((c) => c.group === groupName).map((c) => c.fixKey);
}

// ─── Panel-level layout (multiview): seed + expand per layout type ────────
// A "panel" is a view's fixture SUBSET already resolved by the view layer (S2);
// `clusters` here is that subset, not the whole rig. seedPanel produces anchor
// placements, expandPanel turns anchors + pixels into screen positions. Layout
// types: 'spatial' (today's world projection), 'radial' (ring per group by world
// bearing), 'planar' (true 2-D grid from the pixel cloud — TE sign), 'lanes'
// (one horizontal row per fixture). Contract: report 20260724_9 §5.

/** Projection plane → [horizontalWorldAxis, verticalWorldAxis]. */
function planeAxes(projection) {
  if (projection === 'front') return ['x', 'y'];
  if (projection === 'side') return ['z', 'y'];
  return ['x', 'z']; // top (default)
}

/** The two widest-spread world axes across a set of {x,y,z} points. */
function bestTwoAxes(points) {
  const spread = (k) => { const v = points.map((p) => p[k]); return Math.max(...v) - Math.min(...v); };
  const ranked = [['x', spread('x')], ['y', spread('y')], ['z', spread('z')]]
    .sort((a, b) => b[1] - a[1]);
  return [ranked[0][0], ranked[1][0]];
}

/** Fit world points (projected on axA/axB) into the canvas box, aspect-preserved.
 *  Returns screen {x,y} per input point (single point → canvas center). */
function fitPointsToBox(points, axA, axB, canvasW, canvasH, padFrac = 0.2) {
  if (points.length === 1) return [{ x: canvasW / 2, y: canvasH / 2 }];
  const padX = canvasW * padFrac, padY = canvasH * padFrac;
  const boxW = Math.max(1, canvasW - padX * 2), boxH = Math.max(1, canvasH - padY * 2);
  const ha = points.map((p) => p[axA]), va = points.map((p) => p[axB]);
  const ha0 = Math.min(...ha), ha1 = Math.max(...ha);
  const va0 = Math.min(...va), va1 = Math.max(...va);
  const hR = (ha1 - ha0) || 1, vR = (va1 - va0) || 1;
  const worldAspect = vR / hR, boxAspect = boxH / boxW;
  let drawW, drawH;
  if (worldAspect <= boxAspect) { drawW = boxW; drawH = boxW * worldAspect; }
  else { drawH = boxH; drawW = boxH / worldAspect; }
  const ox = padX + (boxW - drawW) / 2, oy = padY + (boxH - drawH) / 2;
  return points.map((p) => ({
    x: ox + ((p[axA] - ha0) / hR) * drawW,
    y: oy + (1 - (p[axB] - va0) / vR) * drawH, // flip Y (world up → screen up)
  }));
}

/** Group world centroid = mean of member cluster centroids. */
function groupWorldCentroid(clusters, batchList) {
  let x = 0, y = 0, z = 0;
  const n = clusters.length || 1;
  for (const c of clusters) {
    const cc = clusterCentroid(c, batchList);
    x += cc.x; y += cc.y; z += cc.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

/** Smallest positive gap between distinct values (world cell size of a grid). */
function minPositiveGap(vals) {
  const uniq = [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < uniq.length; i++) {
    const d = uniq[i] - uniq[i - 1];
    if (d > 1e-6 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : 0;
}

// One ring per group: fixtures sit on a circle around their group centroid, the
// on-screen angle = the fixture's real world bearing around that centroid, so a
// physical par ring reads as a ring. Multiple groups' ring centers are laid out
// with the same aspect-preserving fit as spatial.
function seedRadial(clusters, batchList, projection, canvasW, canvasH, typeOverrides) {
  const placements = new Map();
  const [axA, axB] = planeAxes(projection);
  const groups = new Map();
  for (const c of clusters) {
    const g = c.group || c.fixKey; // an ungrouped fixture is its own 1-ring
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const groupList = [...groups.values()];
  const groupCentroids = groupList.map((cs) => groupWorldCentroid(cs, batchList));
  const centers = fitPointsToBox(groupCentroids, axA, axB, canvasW, canvasH);
  groupList.forEach((cs, gi) => {
    const center = centers[gi];
    const gc = groupCentroids[gi];
    const maxSize = Math.max(1, ...cs.map((c) => {
      const s = styleFor(c.fixtureType, typeOverrides); return Math.max(s.sizeX, s.sizeY);
    }));
    const spacing = maxSize * 1.6;
    const radius = Math.max(maxSize * 1.5, (cs.length * spacing) / (2 * Math.PI));
    for (const c of cs) {
      const cen = clusterCentroid(c, batchList);
      const bearing = Math.atan2(cen[axB] - gc[axB], cen[axA] - gc[axA]);
      const x = center.x + radius * Math.cos(bearing);
      const y = center.y - radius * Math.sin(bearing); // screen Y flips
      placements.set(c.fixKey, { x: round1(x), y: round1(y), rot: rot15(-bearing * 180 / Math.PI) });
    }
  });
  return placements;
}

// One horizontal row per fixture, ordered by (group, name) — the "logical"
// strands view. Rows are centered on canvasW/2 and stacked top→down.
function seedLanes(clusters, batchList, canvasW, canvasH, typeOverrides) {
  const placements = new Map();
  const ordered = [...clusters].sort((a, b) => {
    const g = (a.group || '').localeCompare(b.group || '');
    return g !== 0 ? g : (a.fixKey || '').localeCompare(b.fixKey || '');
  });
  const rowPitch = Math.max(1, ...clusters.map((c) => styleFor(c.fixtureType, typeOverrides).sizeY)) + 10;
  const topPad = Math.max(rowPitch, canvasH * 0.08);
  ordered.forEach((c, r) => {
    placements.set(c.fixKey, { x: round1(canvasW / 2), y: round1(topPad + r * rowPitch), rot: 0 });
  });
  return placements;
}

// Planar anchors: ALL fixtures in the panel share ONE anchor (the canvas
// center), rot 0. Planar is a SHARED-FRAME layout — every fixture's real pixel
// world coords are projected into one common plane/scale at expand time
// (planarPanelPositions), so two fixtures that physically interlock (e.g. the
// TE Sign V3 A/B halves along their diagonal seam) render interlocked, not
// normalized apart. A per-fixture anchor would spread near-identical centroids
// to opposite corners — exactly the artifact this avoids.
function seedPlanar(clusters, canvasW, canvasH) {
  const placements = new Map();
  const cx = round1(canvasW / 2), cy = round1(canvasH / 2);
  for (const c of clusters) placements.set(c.fixKey, { x: cx, y: cy, rot: 0 });
  return placements;
}

/** Seed anchor placements for a resolved panel subset (see §5).
 *  @returns {Map<string,{x,y,rot}>} fixKey → anchor. */
export function seedPanel(panelDef, clusters, batchList, canvasW, canvasH, typeOverrides) {
  if (!clusters || !clusters.length) return new Map();
  const layout = (panelDef && panelDef.layout) || 'spatial';
  const projection = (panelDef && panelDef.projection) || 'top';
  const w = canvasW || DEFAULT_CANVAS.w, h = canvasH || DEFAULT_CANVAS.h;
  switch (layout) {
    case 'radial': return seedRadial(clusters, batchList, projection, w, h, typeOverrides);
    case 'lanes': return seedLanes(clusters, batchList, w, h, typeOverrides);
    case 'planar': return seedPlanar(clusters, w, h);
    case 'spatial':
    default: return seedLayout(clusters, batchList, projection, w, h, typeOverrides);
  }
}

// Every pixel's real world point (for best-fit plane detection).
function panelPixelWorld(clusters, batchList) {
  const pts = [];
  for (const c of clusters) {
    for (const px of c.pixels) {
      const e = batchList[px.gi];
      pts.push({ x: e.wx || 0, y: e.wy || 0, z: e.wz || 0 });
    }
  }
  return pts;
}

/**
 * Whole-panel TRUE projection: place EVERY pixel at its real world position
 * projected onto the (axA,axB) plane, so the pane looks like the physical rig
 * from that direction — top-down really is the ship from above, front really is
 * the front, the TE-sign halves interlock along their real seam. Two scale
 * modes:
 *   - 'fit'  (spatial): scale + letterbox the whole projected cloud to fill the
 *            canvas, aspect-preserved, padded for pixel size. The rig is
 *            screen-fitting and spatially representative (operator priority).
 *   - 'cell' (planar): scale so the tightest world cell = the style pitch (true,
 *            un-normalized size) and center — for a self-contained grid/logo.
 * Positions come straight from world coords (no per-fixture centroid+line
 * abstraction, no collision relaxation), so nothing is distorted or pushed
 * off-canvas. Screen Y is flipped (world up → screen up).
 */
function projectedPanelPixels(clusters, batchList, typeOverrides, axA, axB, canvasW, canvasH, scaleMode) {
  const P = [];
  let maxHalf = 1, pitch = 1;
  for (const c of clusters) {
    const style = styleFor(c.fixtureType, typeOverrides);
    maxHalf = Math.max(maxHalf, style.sizeX / 2, style.sizeY / 2);
    pitch = Math.max(pitch, style.sizeX + style.gap);
    for (const px of c.pixels) {
      const e = batchList[px.gi];
      P.push({ gi: px.gi, fixKey: c.fixKey, style, u: e[axAWorld(axA)] || 0, v: e[axAWorld(axB)] || 0 });
    }
  }
  if (!P.length) return [];
  const us = P.map((p) => p.u), vs = P.map((p) => p.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const uR = (u1 - u0) || 1, vR = (v1 - v0) || 1;
  let scale, ox, oy;
  if (scaleMode === 'cell') {
    const gU = minPositiveGap(us), gV = minPositiveGap(vs);
    const worldCell = Math.min(gU || gV || 1, gV || gU || 1) || 1;
    scale = pitch / worldCell;
    ox = (canvasW - uR * scale) / 2;
    oy = (canvasH - vR * scale) / 2;
  } else { // 'fit'
    const pad = maxHalf + 24;
    const boxW = Math.max(1, canvasW - pad * 2), boxH = Math.max(1, canvasH - pad * 2);
    scale = Math.min(boxW / uR, boxH / vR);
    ox = pad + (boxW - uR * scale) / 2;
    oy = pad + (boxH - vR * scale) / 2;
  }
  return P.map((p) => ({
    gi: p.gi, fixKey: p.fixKey,
    cx: ox + (p.u - u0) * scale,
    cy: oy + (v1 - p.v) * scale, // flip: world up → screen up
    sizeX: p.style.sizeX, sizeY: p.style.sizeY, shape: p.style.shape, rot: 0,
  }));
}

/** Expand a resolved panel subset into per-pixel screen positions (see §5).
 *  spatial + planar are TRUE whole-panel projections (spatially representative,
 *  screen-fitting — operator priority, 2026-07-24); radial + lanes keep the
 *  per-fixture anchor/line model (editable arrangements). Design space is the
 *  fixed DEFAULT_CANVAS; the pane letterboxes it into its sub-rect.
 *  @returns {Array<{gi,cx,cy,sizeX,sizeY,shape,rot,fixKey}>} flat over all clusters. */
export function expandPanel(panelDef, clusters, batchList, placements, typeOverrides) {
  if (!clusters || !clusters.length) return [];
  const layout = (panelDef && panelDef.layout) || 'spatial';
  const W = DEFAULT_CANVAS.w, H = DEFAULT_CANVAS.h;
  if (layout === 'spatial') {
    const [axA, axB] = planeAxes((panelDef && panelDef.projection) || 'top');
    return projectedPanelPixels(clusters, batchList, typeOverrides, axA, axB, W, H, 'fit');
  }
  if (layout === 'planar') {
    const [axA, axB] = bestTwoAxes(panelPixelWorld(clusters, batchList));
    return projectedPanelPixels(clusters, batchList, typeOverrides, axA, axB, W, H, 'cell');
  }
  // radial | lanes → per-fixture anchor + local-line expansion (editable).
  const out = [];
  if (!placements) return out;
  for (const c of clusters) {
    const pl = placements.get(c.fixKey);
    if (!pl) continue; // seedPanel fills every cluster; a miss is a caller bug
    const style = styleFor(c.fixtureType, typeOverrides);
    // Stamp fixKey so the pane can render per-fixture selection + resolve
    // edit-mode hit tests (S4 seam — the §5 expandPanel shape documents fixKey).
    for (const p of clusterPixelPositions(c, pl, style)) { p.fixKey = c.fixKey; out.push(p); }
  }
  return out;
}

/** Topmost fixture whose bounds contain design-space point (px,py), or null. */
export function hitTestFixture(clusters, placements, typeOverrides, px, py) {
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i];
    const pl = placements.get(c.fixKey);
    if (!pl) continue;
    const b = clusterBounds(c, pl, styleFor(c.fixtureType, typeOverrides));
    if (px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY) return c;
  }
  return null;
}
