/*
  woodland_trident_sweep_optimized

  Creative direction:
    - Three curved trident prongs sweep across the rig.
    - Prongs leave ghost trails instead of flat static bands.
    - Redwoods receive stronger impact blooms + UV cores.
    - Vintage/rest of rig get softer floor/wall wash.
    - Strong negative space between hits.
    - RGB is strict cp1 <-> cp2. W/A/UV are physical accents only.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

export var localSpeed = 0.5;
export var sweepWidth = 0.34;
export var sweepImpact = 0.62;
export var prongSpread = 0.48;
export var trailGlow = 0.48;
export var blackoutDepth = 0.45;

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
export function sliderSweepWidth(v) { sweepWidth = v; }
export function sliderSweepImpact(v) { sweepImpact = v; }
export function sliderProngSpread(v) { prongSpread = v; }
export function sliderTrailGlow(v) { trailGlow = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pSweep = 0.0;
var pRipple = 0.0;
var pSpark = 0.0;
var pShadow = 0.0;

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

function pingPong(phaseValue) {
  var phaseFrac = phaseValue - floor(phaseValue);
  if (phaseFrac < 0.5) return phaseFrac * 2.0;
  return (1.0 - phaseFrac) * 2.0;
}

function sweepDirection(phaseValue) {
  var phaseFrac = phaseValue - floor(phaseValue);
  if (phaseFrac < 0.5) return 1.0;
  return -1.0;
}

function bandCore(posValue, centerValue, widthValue) {
  var distValue = abs(posValue - centerValue);
  return 1.0 - smoothstep(widthValue * 0.16, widthValue, distValue);
}

function bandTrail(posValue, centerValue, dirValue, widthValue, lengthValue) {
  var tailDist = (centerValue - posValue) * dirValue;
  if (tailDist < 0.0) return 0.0;
  return 1.0 - smoothstep(widthValue, lengthValue, tailDist);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var spd = clamp01(localSpeed);

  var sweepScale = 0.34 - spd * 0.2733;
  if (sweepScale < 0.055) sweepScale = 0.055;

  var rippleScale = 0.18 - spd * 0.1281;
  if (rippleScale < 0.035) rippleScale = 0.035;

  var sparkScale = 0.055 - spd * 0.0409;
  if (sparkScale < 0.018) sparkScale = 0.018;

  pSweep = time(sweepScale);
  pRipple = time(rippleScale);
  pSpark = time(sparkScale);
  pShadow = time(0.72 - spd * 0.5200);
}

export function render(index, x, y, z) {
  var nx = x;
  var ny = y;
  var nz = z;

  // Defensive normalization for preview/model variants.
  if (nx > 1.5) nx = nx / 33.0;
  if (ny > 1.5) ny = ny / 3.5;
  if (nz > 1.5) nz = nz / 24.0;

  nx = clamp01(nx);
  ny = clamp01(ny);
  nz = clamp01(nz);

  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  // Fallback when view masks are missing.
  if (!isRedwood && !isVintage) {
    if (z > 15.0 || nz > 0.62) {
      isRedwood = 1.0;
    }
  }

  var red = 0.0;
  var grn = 0.0;
  var blu = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;

  var head = pingPong(pSweep);
  var dir = sweepDirection(pSweep);

  var width = 0.025 + sweepWidth * 0.18;
  var spread = 0.06 + prongSpread * 0.21;
  var trailLength = width * (2.4 + trailGlow * 6.2);

  // Curved/living prongs. Depth bends the side prongs apart.
  var depthCurve = (nz - 0.5) * (0.08 + prongSpread * 0.25);
  var ripple = wave(pRipple + nz * 0.37 + nx * 0.13 + ny * 0.11);
  var microCurve = (ripple - 0.5) * width * 0.95;

  var centerOne = head - spread - depthCurve + microCurve;
  var centerTwo = head + microCurve * 0.32;
  var centerThree = head + spread + depthCurve - microCurve;

  var coreOne = bandCore(nx, centerOne, width);
  var coreTwo = bandCore(nx, centerTwo, width * 0.88);
  var coreThree = bandCore(nx, centerThree, width);

  var trailOne = bandTrail(nx, centerOne, dir, width, trailLength) * trailGlow * 0.58;
  var trailTwo = bandTrail(nx, centerTwo, dir, width, trailLength) * trailGlow * 0.72;
  var trailThree = bandTrail(nx, centerThree, dir, width, trailLength) * trailGlow * 0.58;

  var bandOne = max(coreOne, trailOne);
  var bandTwo = max(coreTwo, trailTwo);
  var bandThree = max(coreThree, trailThree);

  var totalBand = bandOne + bandTwo + bandThree;
  totalBand = clamp01(totalBand);

  var coreHit = max(coreOne, coreTwo);
  coreHit = max(coreHit, coreThree);

  // Moving negative space between trident strikes.
  var shadowWave = wave(pShadow + nx * 0.82 - nz * 0.36 + ny * 0.18);
  var darkPocket = smoothstep(0.35, 0.92, shadowWave);
  var darkCut = 1.0 - blackoutDepth * darkPocket * (1.0 - coreHit * 0.75);

  var paletteMix = 0.0;
  if (totalBand > 0.001) {
    paletteMix = (bandTwo * 0.5 + bandThree) / (bandOne + bandTwo + bandThree);
  }

  var baseRed = paletteR(paletteMix);
  var baseGrn = paletteG(paletteMix);
  var baseBlu = paletteB(paletteMix);

  if (isRedwood) {
    /*
      Redwoods = impact receivers.
      They bloom harder, with UV cores and white strike tips.
    */

    var tree = floor(nx * 3.0);
    if (tree > 2.0) tree = 2.0;

    var slot = index % 6.0;
    var orbit = wave(pRipple * 2.5 + slot * 0.166 + tree * 0.21);
    orbit = smoothstep(0.36, 0.96, orbit);

    var redwoodEnergy = totalBand * (0.72 + orbit * 0.28);
    redwoodEnergy = clamp01(redwoodEnergy * (0.48 + sweepImpact * 0.92) * darkCut);

    red = baseRed * redwoodEnergy;
    grn = baseGrn * redwoodEnergy;
    blu = baseBlu * redwoodEnergy;

    // UV is the trident core landing in the trees.
    uv = totalBand * (0.16 + sweepImpact * 0.52) * (0.55 + orbit * 0.45);

    // White strike tip: only on the sharp prong core.
    var sparkWave = wave(pSpark * 8.0 + index * 0.411 + tree * 0.17 + nz * 0.29);
    var sparkGate = smoothstep(
      0.955 - sweepImpact * 0.050,
      0.998,
      sparkWave
    );

    white = coreHit * sweepImpact * (0.18 + sparkGate * 0.62);

  } else if (isVintage) {
    /*
      Vintage = warm reflected strike.
      Reads as the trident crossing the wall/tower lamps.
    */

    var vintageEnergy = clamp01(totalBand * (0.26 + sweepImpact * 0.42) * darkCut);

    red = baseRed * vintageEnergy * 0.68;
    grn = baseGrn * vintageEnergy * 0.68;
    blu = baseBlu * vintageEnergy * 0.68;

    amber = vintageEnergy * 0.28;
    white = coreHit * sweepImpact * 0.16;

  } else {
    /*
      Rest of rig = softer woodland-floor wash.
      Enough to show the sweep path, not enough to flatten the redwood hits.
    */

    var floorEnergy = clamp01(totalBand * (0.14 + sweepImpact * 0.32) * darkCut);

    red = baseRed * floorEnergy;
    grn = baseGrn * floorEnergy;
    blu = baseBlu * floorEnergy;

    white = coreHit * sweepImpact * 0.08;
  }

  // Keep WAU from washing out palette on RGB fallback.
  white = white * 0.72;
  amber = amber * 0.72;
  uv = uv * 0.68;

  rgbwau(
    clamp01(red),
    clamp01(grn),
    clamp01(blu),
    clamp01(white),
    clamp01(amber),
    clamp01(uv)
  );
}