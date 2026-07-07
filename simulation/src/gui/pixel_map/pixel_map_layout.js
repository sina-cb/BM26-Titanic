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
  _default:   { shape: 'square', sizeX: 13, sizeY: 13, gap: 3 },
};

export const DEFAULT_CANVAS = { w: 900, h: 520 };

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
      cur = {
        fixIndex: fi,
        fixKey: e.fixKey || e.name || `Fixture ${fi}`,
        fixtureType: e.fixtureType || 'Generic',
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
