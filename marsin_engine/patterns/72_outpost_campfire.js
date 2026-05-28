/*
  outpost_campfire_optimized
  MarsinScript-safe rewrite.

  Fixes:
    - Motion uses time(), not delta accumulation, so it animates on surfaces
      where delta is missing or unreliable.
    - Uses render(index, x, y, z), the most portable entrypoint.
    - RGB always comes from cp1 <-> cp2 interpolation.
    - Amber/white/UV are physical accents so they do not overpower palette.
    - If Logsville viewMask bits are missing, it falls back to coordinates.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

export var localSpeed = 0.5;
export var flickerSpeed = 0.55;
export var campfireHeat = 0.65;
export var woodSparkle = 0.35;
export var uvIntensity = 0.45;
export var emberDepth = 0.7;
export var contrast = 0.55;

// Optional CPC/audio modulation input. Works fine at 0.
export var audioBass = 0.0;

export var cp1H = 0.02;
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
export function sliderFlickerSpeed(v) { flickerSpeed = v; }
export function sliderCampfireHeat(v) { campfireHeat = v; }
export function sliderWoodSparkle(v) { woodSparkle = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }
export function sliderEmberDepth(v) { emberDepth = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderAudioBass(v) { audioBass = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pFlicker = 0.0;
var pEmber = 0.0;
var pSlow = 0.0;
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

function contrastShape(v) {
  var cv = clamp01(v);
  var low = 0.06 + contrast * 0.22;
  return smoothstep(low, 1.0, cv);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var s = clamp01(localSpeed);
  var f = clamp01(flickerSpeed);

  // Smaller time scale = faster loop in current MarsinScript.
  pSlow = time(0.18 - s * 0.143);
  pEmber = time(0.13 - s * 0.1041);
  pFlicker = time(0.075 - f * 0.060);
  pSpark = time(0.040 - f * 0.032);
}

export function render(index, x, y, z) {
  var nx = x;
  var ny = y;
  var nz = z;

  // Coordinate fallback supports normalized and rough real-world coords.
  if (nx > 1.5) nx = nx / 33.0;
  if (ny > 1.5) ny = ny / 3.5;
  if (nz > 1.5) nz = nz / 24.0;

  nx = clamp01(nx);
  ny = clamp01(ny);
  nz = clamp01(nz);

  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  // If named view masks are missing, do not go black/static.
  if (!isRedwood && !isVintage) {
    if (z > 15.0 || nz > 0.62) {
      isRedwood = 1.0;
    } else {
      isVintage = 1.0;
    }
  }

  var r = 0.0;
  var g = 0.0;
  var b = 0.0;
  var w = 0.0;
  var a = 0.0;
  var u = 0.0;

  var bassLift = audioBass * 0.28;

  var tree = floor(nx * 3.0);
  if (tree > 2.0) tree = 2.0;

  if (isVintage) {
    // Smooth organic flicker.
    var f1 = wave(pFlicker * 5.0 + index * 0.173 + nx * 0.37);
    var f2 = wave(pFlicker * 8.7 + index * 0.061 + nz * 0.29);
    var f3 = wave(pSlow * 2.0 + nx * 0.5 + ny * 0.25);

    var rawFlicker = f1 * 0.52 + f2 * 0.33 + f3 * 0.15;
    var flicker = 0.22 + 0.78 * contrastShape(rawFlicker);

    var heat = clamp01((0.32 + campfireHeat * 0.68 + bassLift) * flicker);

    // Visible palette travel: darker parts near cp1, hot peaks pull to cp2.
    var mixAmount = clamp01(0.08 + flicker * 0.82 + woodSparkle * 0.10);

    r = paletteR(mixAmount) * heat;
    g = paletteG(mixAmount) * heat;
    b = paletteB(mixAmount) * heat;

    // Amber is warmth accent, not the main visible color.
    a = campfireHeat * (0.08 + 0.24 * flicker);

    // Deterministic animated ember pops.
    var sparkWave = wave(pSpark * 13.0 + index * 0.431 + nx * 0.7);
    var sparkGate = smoothstep(0.91 - woodSparkle * 0.10, 0.995, sparkWave);

    w = woodSparkle * sparkGate * smoothstep(0.56, 0.95, flicker) * 0.70;

  } else if (isRedwood) {
    // Three-tree giant-pixel motion first, per-PAR detail second.
    var treeOffset = tree * (0.07 + emberDepth * 0.23);

    var canopyWave = wave(pEmber + treeOffset + nz * emberDepth * 0.20);
    var canopy = contrastShape(canopyWave);

    // Slow color crawl follows cp1/cp2 clearly.
    var colorTravel = wave(pSlow + treeOffset + nz * 0.31 + nx * 0.08);

    // Small leaf/ring movement without destroying big-tree readability.
    var leafMove = wave(pFlicker * 1.7 + index * 0.137 + treeOffset);
    var leafDetail = 0.78 + 0.22 * leafMove;

    var base = clamp01((0.08 + 0.82 * canopy) * leafDetail * (0.82 + bassLift));

    r = paletteR(colorTravel) * base;
    g = paletteG(colorTravel) * base;
    b = paletteB(colorTravel) * base;

    // UV breathes behind the palette. Moderate so RGB remains legible.
    u = uvIntensity * (0.15 + 0.55 * canopy);

    // Tiny cold glints on tree rings when sparkle is high.
    var treeSpark = smoothstep(
      0.965 - woodSparkle * 0.055,
      0.998,
      wave(pSpark * 7.0 + index * 0.293 + tree)
    );

    w = woodSparkle * treeSpark * 0.22;
  }

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}