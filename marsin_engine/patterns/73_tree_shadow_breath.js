/*
  tree_shadow_breath
  Distinctive Logsville redwood-only pattern.

  Visual idea:
    - Three redwood clusters breathe out of phase.
    - A moving "moon rift" travels through each tree canopy.
    - UV fills the shadow gaps while RGB follows strict cp1 <-> cp2.
    - White glints appear like branch edges catching light.
    - Strong negative space keeps it dramatic instead of mushy.

  Parameter rule:
    - localSpeed is mandatory and first.
    - Other sliders are few and visually obvious.
*/

var MASK_REDWOOD_PARS = 64;

export var localSpeed = 0.5;
export var shadowDepth = 0.75;
export var canopyMotion = 0.65;
export var edgeShimmer = 0.28;
export var blackoutDepth = 0.55;

export var cp1H = 0.0;
export var cp1S = 1.0;
export var cp1V = 1.0;
export var cp2H = 0.08;
export var cp2S = 1.0;
export var cp2V = 1.0;

export function colorPalette1(h, s, v) {
  cp1H = h;
  cp1S = s;
  cp1V = v;
}

export function colorPalette2(h, s, v) {
  cp2H = h;
  cp2S = s;
  cp2V = v;
}

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShadowDepth(v) { shadowDepth = v; }
export function sliderCanopyMotion(v) { canopyMotion = v; }
export function sliderEdgeShimmer(v) { edgeShimmer = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pBreath = 0.0;
var pDrift = 0.0;
var pRift = 0.0;
var pSpark = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H);
  if (hv < 0.0) hv += 1.0;

  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);

  if (iv == 0) {
    pr1 = cp1V; pg1 = tv; pb1 = pv;
  } else if (iv == 1) {
    pr1 = qv; pg1 = cp1V; pb1 = pv;
  } else if (iv == 2) {
    pr1 = pv; pg1 = cp1V; pb1 = tv;
  } else if (iv == 3) {
    pr1 = pv; pg1 = qv; pb1 = cp1V;
  } else if (iv == 4) {
    pr1 = tv; pg1 = pv; pb1 = cp1V;
  } else {
    pr1 = cp1V; pg1 = pv; pb1 = qv;
  }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H);
  if (hv < 0.0) hv += 1.0;

  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);

  if (iv == 0) {
    pr2 = cp2V; pg2 = tv; pb2 = pv;
  } else if (iv == 1) {
    pr2 = qv; pg2 = cp2V; pb2 = pv;
  } else if (iv == 2) {
    pr2 = pv; pg2 = cp2V; pb2 = tv;
  } else if (iv == 3) {
    pr2 = pv; pg2 = qv; pb2 = cp2V;
  } else if (iv == 4) {
    pr2 = tv; pg2 = pv; pb2 = cp2V;
  } else {
    pr2 = cp2V; pg2 = pv; pb2 = qv;
  }
}

function paletteR(mixAmount) {
  return pr1 + (pr2 - pr1) * clamp01(mixAmount);
}

function paletteG(mixAmount) {
  return pg1 + (pg2 - pg1) * clamp01(mixAmount);
}

function paletteB(mixAmount) {
  return pb1 + (pb2 - pb1) * clamp01(mixAmount);
}

function softShape(v) {
  var cv = clamp01(v);
  return cv * cv * (3.0 - 2.0 * cv);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var spd = clamp01(localSpeed);

  // time() avoids frozen patterns on surfaces where delta is unreliable.
  pBreath = time(0.24 - spd * 0.1881);
  pDrift = time(0.55 - spd * 0.4241);
  pRift = time(0.18 - spd * 0.143);
  pSpark = time(0.05 - spd * 0.0411);
}

export function render(index, x, y, z) {
  var nx = x;
  var ny = y;
  var nz = z;

  // Defensive normalization for both normalized and real-world-ish coords.
  if (nx > 1.5) nx = nx / 33.0;
  if (ny > 1.5) ny = ny / 3.5;
  if (nz > 1.5) nz = nz / 24.0;

  nx = clamp01(nx);
  ny = clamp01(ny);
  nz = clamp01(nz);

  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;

  // Fallback when viewMask is unavailable in preview/simulator.
  if (!isRedwood) {
    if (z > 15.0 || nz > 0.62) {
      isRedwood = 1.0;
    }
  }

  var red = 0.0;
  var grn = 0.0;
  var blu = 0.0;
  var wht = 0.0;
  var amb = 0.0;
  var uvv = 0.0;

  if (isRedwood) {
    // Treat the redwoods as 3 giant objects first.
    var tree = floor(nx * 3.0);
    if (tree > 2.0) tree = 2.0;

    var treeOffset = tree * (0.17 + canopyMotion * 0.13);

    // Large slow breathing, staggered per tree.
    var breathRaw = wave(pBreath + treeOffset + nz * 0.10);
    var breath = softShape(breathRaw);

    // A drifting dark/bright forest veil so it does not read as a flat pulse.
    var veil = wave(
      pDrift +
      treeOffset * 0.7 +
      nx * (0.55 + canopyMotion * 0.65) +
      nz * (0.25 + canopyMotion * 0.55)
    );

    // Moving moon-rift: a bright slit moving through each tree at different offsets.
    var riftPos = pRift + tree * 0.23;
    riftPos = riftPos - floor(riftPos);

    var riftDist = abs(nz - riftPos);
    var riftWrap = abs(nz - riftPos + 1.0);
    if (riftWrap < riftDist) riftDist = riftWrap;
    riftWrap = abs(nz - riftPos - 1.0);
    if (riftWrap < riftDist) riftDist = riftWrap;

    var riftWidth = 0.055 + canopyMotion * 0.075;
    var moonRift = 1.0 - smoothstep(riftWidth, riftWidth + 0.20, riftDist);
    moonRift = softShape(moonRift);

    // Branch-like high-frequency contour layered on top of the giant motion.
    var branch = wave(
      nz * (2.2 + canopyMotion * 3.2) +
      nx * 1.35 +
      pDrift * 1.7 +
      treeOffset
    );
    var branchEdge = smoothstep(0.72, 0.98, branch);

    // Negative space: moving black pockets carved into the canopy.
    var darkPocket = smoothstep(0.42, 0.96, veil);
    var darkCut = 1.0 - blackoutDepth * (0.20 + 0.80 * darkPocket);

    // Main brightness: breathing body + passing rift, then carved by darkness.
    var body = (0.12 + 0.72 * breath) * (0.35 + canopyMotion * 0.65);
    var brightness = body * darkCut + moonRift * (0.28 + canopyMotion * 0.42);
    brightness = clamp01(brightness);

    // Palette motion is obvious: breath and rift move through cp1/cp2.
    var colorMix = clamp01(
      0.10 +
      0.52 * breath +
      0.26 * moonRift +
      0.12 * branchEdge
    );

    red = paletteR(colorMix) * brightness;
    grn = paletteG(colorMix) * brightness;
    blu = paletteB(colorMix) * brightness;

    // UV lives in the shadow valleys, not as a full wash.
    uvv = shadowDepth *
      (0.08 + 0.58 * darkPocket) *
      (1.0 - moonRift * 0.65);

    // White appears as tiny branch-edge glints, not random noise.
    var sparkWave = wave(
      pSpark * 9.0 +
      index * 0.377 +
      tree * 0.19 +
      nz * 0.41
    );

    var sparkGate = smoothstep(
      0.965 - edgeShimmer * 0.065,
      0.998,
      sparkWave
    );

    wht = edgeShimmer *
      sparkGate *
      branchEdge *
      (0.22 + 0.38 * moonRift);

    // Keep WAU accents from overpowering cp1/cp2 on RGB fallback.
    uvv = uvv * 0.72;
    wht = wht * 0.70;
  }

  rgbwau(
    clamp01(red),
    clamp01(grn),
    clamp01(blu),
    clamp01(wht),
    clamp01(amb),
    clamp01(uvv)
  );
}