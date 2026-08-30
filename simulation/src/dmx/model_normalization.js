// Export-time model normalization (the `titanic_normalized` scene family).
//
// The physical piece is two ship halves "sinking" into the playa — each half
// listed ~30° and the halves yawed apart. Patterns, however, want a leveled,
// aligned light cloud. This module rewrites ONLY the exported engine model
// (applied inside saveModelJS, never inside generatePixelMap), so the sim's
// 3D view, its in-browser pattern engine, and the 2D pixel-map layouts keep
// rendering the as-built geometry.
//
// Approved recipe (operator, 2026-08-29 — prototyped and signed off):
//   1. LEVEL IN PLACE — rotate each half about its own centroid so the
//      sinking list disappears; both halves take the same horizontal heading
//      (the X<0 half's as-built axis). Each half then settles vertically so
//      it rests back at its original ground level.
//   2. Z-ALIGN — the X>0 half translates on Z only until its Z-extent
//      midpoint matches the X<0 half's; the detached X>0 small smokestack
//      follows with its own Z shift. Everything ends up inline along X.
//   3. X-CONDENSE — both halves slide toward each other on X until their
//      inner edges sit `xGap` apart (each moving half the distance); each
//      detached small stack follows its half's X shift.
//
// The per-half frame is fitted from the front/back wall ShehdsBar pixel
// runs. Those 90-pixel groups are collinear LINES (perpendicular spread
// ≤ 0.05 m), so a plane fit is degenerate — the frame comes from the wall
// LINE directions plus the back-wall→front-wall centroid axis.
//
// Hard constraint: the engine's auto-view builder derives LEFT/RIGHT from
// the SIGN of world X and throws when a `Left_*`/`Right_*` group token
// disagrees with it. The condense step therefore refuses (throws) any gap
// that would push a pixel of either half across x = 0 — no clamping, no
// silent fallback (codex P0).

const FRONT_WALLS = { left: "Left Front Wall", right: "Right Front Wall" };
const BACK_WALLS = { left: "Left Back Wall", right: "Right Back Wall" };
const MIN_WALL_PIXELS = 8;
const X_SIGN_MARGIN = 0.1; // metres each half must keep clear of x = 0

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function normalized(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (!(len > 0)) throw new Error("model_normalization: zero-length vector");
  return [a[0] / len, a[1] / len, a[2] / len];
}

function centroid(points) {
  return scale(points.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / points.length);
}

// Dominant principal direction via power iteration on the covariance matrix.
// The wall pixel runs are strongly 1-D (leading eigenvalue orders of
// magnitude above the rest), so this converges in a handful of steps.
function lineDirection(points) {
  const c = centroid(points);
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j];
    }
  }
  let v = [1, 1, 1];
  for (let k = 0; k < 80; k++) {
    v = normalized([dot(m[0], v), dot(m[1], v), dot(m[2], v)]);
  }
  return { centroid: c, dir: v };
}

function wallPoints(pixels, groupName) {
  const pts = pixels.filter(p => p.group === groupName).map(p => [p.x, p.y, p.z]);
  if (pts.length < MIN_WALL_PIXELS) {
    throw new Error(
      `model_normalization: wall group "${groupName}" has ${pts.length} pixel(s) ` +
      `(need >= ${MIN_WALL_PIXELS}) — normalization only applies to the titanic ` +
      "scene family; disable Normalize Engine Export for this scene.");
  }
  return pts;
}

// Level-in-place frame for one half: rows [athwart, up, axis] map the half's
// own directions onto world [X, Y, Z].
function halfFrame(pixels, frontWall, backWall) {
  const front = lineDirection(wallPoints(pixels, frontWall));
  const back = lineDirection(wallPoints(pixels, backWall));
  const axis = normalized(sub(front.centroid, back.centroid));
  let lineBack = back.dir;
  if (dot(lineBack, front.dir) < 0) lineBack = scale(lineBack, -1);
  let athwart = normalized(add(front.dir, lineBack));
  athwart = normalized(sub(athwart, scale(axis, dot(athwart, axis))));
  let up = cross(axis, athwart);
  if (up[1] < 0) {
    up = scale(up, -1);
    athwart = scale(athwart, -1);
  }
  return { rows: [athwart, up, axis], axis };
}

const isSmallStack = p => /Small/.test(p.group || "");

/**
 * Returns a transformed CLONE of the pixel list (input objects untouched)
 * with x/y/z rewritten per the approved normalization recipe and nx/ny/nz
 * recomputed from the new bounds. Pixel order, indices, groups, patches and
 * every other field pass through unchanged.
 */
export function normalizeModelPixels(pixels, { xGap = 2 } = {}) {
  if (!Array.isArray(pixels) || pixels.length === 0) {
    throw new Error("model_normalization: empty pixel list");
  }
  const out = pixels.map(p => ({ ...p }));
  // side membership is frozen from the AS-BUILT sign — every later shift keys
  // on this, never on a pixel's post-transform sign
  const sides = out.map(p => (p.x < 0 ? "left" : "right"));

  const halves = {
    left: out.filter(p => p.x < 0 && !isSmallStack(p)),
    right: out.filter(p => p.x >= 0 && !isSmallStack(p)),
  };
  for (const side of ["left", "right"]) {
    if (!halves[side].length) {
      throw new Error(`model_normalization: no pixels found for the ${side} half`);
    }
  }

  const frames = {
    left: halfFrame(halves.left, FRONT_WALLS.left, BACK_WALLS.left),
    right: halfFrame(halves.right, FRONT_WALLS.right, BACK_WALLS.right),
  };

  // shared heading: horizontal projection of the left (X<0) half's axis
  const heading = normalized([frames.left.axis[0], 0, frames.left.axis[2]]);
  const targetZ = heading;
  const targetY = [0, 1, 0];
  const targetX = cross(targetY, targetZ);

  // 1. level each half in place, then settle back to its ground level
  for (const side of ["left", "right"]) {
    const body = halves[side];
    const anchor = centroid(body.map(p => [p.x, p.y, p.z]));
    const rows = frames[side].rows;
    let minBefore = Infinity;
    let minAfter = Infinity;
    for (const p of body) minBefore = Math.min(minBefore, p.y);
    for (const p of body) {
      const d = sub([p.x, p.y, p.z], anchor);
      const local = [dot(rows[0], d), dot(rows[1], d), dot(rows[2], d)];
      const w = add(anchor, add(
        scale(targetX, local[0]),
        add(scale(targetY, local[1]), scale(targetZ, local[2]))));
      p.x = w[0]; p.y = w[1]; p.z = w[2];
      minAfter = Math.min(minAfter, p.y);
    }
    const lift = minBefore - minAfter;
    for (const p of body) p.y += lift;
  }

  // 2. Z-align: right half slides on Z into line with the left half; the
  //    right small stack then aligns its own Z-extent midpoint to the half's
  //    (matching the signed-off prototype — NOT a translate-by-the-half's-dz)
  const zMid = list => {
    let mn = Infinity, mx = -Infinity;
    for (const p of list) { mn = Math.min(mn, p.z); mx = Math.max(mx, p.z); }
    return (mn + mx) / 2;
  };
  const dzRight = zMid(halves.left) - zMid(halves.right);
  for (const p of halves.right) p.z += dzRight;
  const rightStack = out.filter(p => p.x >= 0 && isSmallStack(p));
  if (rightStack.length) {
    const dzStack = zMid(halves.right) - zMid(rightStack);
    for (const p of rightStack) p.z += dzStack;
  }

  // 3. X-condense: halves slide toward each other to `xGap` between inner
  //    edges; each small stack follows its half. Refuses to cross x = 0.
  const xMax = list => Math.max(...list.map(p => p.x));
  const xMin = list => Math.min(...list.map(p => p.x));
  const innerLeft = xMax(halves.left);
  const innerRight = xMin(halves.right);
  const close = (innerRight - innerLeft - xGap) / 2;
  if (innerLeft + close > -X_SIGN_MARGIN || innerRight - close < X_SIGN_MARGIN) {
    const minGap = Math.ceil((innerRight - innerLeft -
      2 * Math.min(-X_SIGN_MARGIN - innerLeft, innerRight - X_SIGN_MARGIN)) * 100) / 100;
    throw new Error(
      `model_normalization: xGap ${xGap} would push a half across x=0 ` +
      `(engine LEFT/RIGHT views derive from the x sign). Minimum viable gap ` +
      `here is ${minGap.toFixed(2)} m.`);
  }
  out.forEach((p, i) => {
    p.x += sides[i] === "left" ? close : -close;
  });

  // full-roster sign audit: the engine's auto-view builder throws at model
  // LOAD when a Left_/Right_ group token disagrees with the pixel's x sign.
  // That failure belongs HERE, at export time, with a clear message — the
  // half guard above only bounds the hulls, so this catches everything else
  // (detached small stacks, or any pixel the leveling swung across x = 0).
  for (const p of out) {
    const token = /^Left[ _]/.test(p.group || "") ? "left"
      : /^Right[ _]/.test(p.group || "") ? "right" : null;
    if (!token) continue;
    if (token === "left" ? p.x >= 0 : p.x <= 0) {
      throw new Error(
        `model_normalization: pixel "${p.name}" (group "${p.group}") ended at ` +
        `x=${p.x.toFixed(3)} which contradicts its ${token}-side group token — ` +
        "the engine would refuse this model at load. Adjust the geometry or gap.");
    }
  }

  // recompute normalized coords in generatePixelMap's order: coords are
  // rounded to 3 decimals FIRST, then bounds are taken over the rounded
  // values (the exporter rounds at pixel creation and derives n* after)
  for (const p of out) {
    p.x = +p.x.toFixed(3);
    p.y = +p.y.toFixed(3);
    p.z = +p.z.toFixed(3);
  }
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of out) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;
  for (const p of out) {
    p.nx = +((p.x - minX) / rangeX).toFixed(4);
    p.ny = +((p.y - minY) / rangeY).toFixed(4);
    p.nz = +((p.z - minZ) / rangeZ).toFixed(4);
  }
  return out;
}
