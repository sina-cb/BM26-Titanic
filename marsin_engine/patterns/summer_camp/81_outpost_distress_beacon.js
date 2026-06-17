/*
  outpost_distress_beacon_optimized

  Creative direction:
    - A wandering distress searchlight moves through the stage floor plane.
    - The motion is complex but smooth: layered irrational wave paths.
    - The light speaks in an SOS-like pulse envelope instead of staying on.
    - Redwoods answer with delayed cp2 echo glow + UV shadow.
    - Vintage/tower areas get hot cp1 signal flashes and amber filament response.
    - Strong blackout gaps make it dramatic and readable.
    - RGB is strict cp1 <-> cp2. W/A/UV are physical accents only.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;

export var localSpeed = 0.5;
export var signalStrength = 0.85;
export var beamWidth = 0.32;
export var pathChaos = 0.58;
export var echoGlow = 0.42;
export var blackoutDepth = 0.62;

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
export function sliderSignalStrength(v) { signalStrength = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderPathChaos(v) { pathChaos = v; }
export function sliderEchoGlow(v) { echoGlow = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pPathA = 0.0;
var pPathB = 0.0;
var pSignal = 0.0;
var pEcho = 0.0;
var pSpark = 0.0;

var beaconX = 0.5;
var beaconZ = 0.5;
var ghostX = 0.5;
var ghostZ = 0.5;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function softShape(value) {
  var shaped = clamp01(value);
  return shaped * shaped * (3.0 - 2.0 * shaped);
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

function spotShape(distanceValue, widthValue) {
  var inner = widthValue * 0.12;
  return 1.0 - smoothstep(inner, widthValue, distanceValue);
}

function pulseBlock(rawUnit, startUnit, durationUnit) {
  var localUnit = rawUnit - startUnit;

  if (localUnit < 0.0) return 0.0;
  if (localUnit > durationUnit) return 0.0;

  var rise = smoothstep(0.0, 0.16, localUnit);
  var fall = 1.0 - smoothstep(durationUnit - 0.20, durationUnit, localUnit);

  return rise * fall;
}

function sosEnvelope() {
  var rawUnit = pSignal * 28.0;

  // ... --- ...
  var env = pulseBlock(rawUnit, 0.0, 0.78);
  env = max(env, pulseBlock(rawUnit, 2.0, 0.78));
  env = max(env, pulseBlock(rawUnit, 4.0, 0.78));

  env = max(env, pulseBlock(rawUnit, 7.0, 2.30));
  env = max(env, pulseBlock(rawUnit, 11.0, 2.30));
  env = max(env, pulseBlock(rawUnit, 15.0, 2.30));

  env = max(env, pulseBlock(rawUnit, 20.0, 0.78));
  env = max(env, pulseBlock(rawUnit, 22.0, 0.78));
  env = max(env, pulseBlock(rawUnit, 24.0, 0.78));

  return clamp01(env);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var speedTrim = clamp01(localSpeed);
  var chaos = clamp01(pathChaos);

  var pathScaleA = 0.56 - speedTrim * 0.4341;
  if (pathScaleA < 0.060) pathScaleA = 0.060;

  var pathScaleB = 0.71 - speedTrim * 0.5470;
  if (pathScaleB < 0.075) pathScaleB = 0.075;

  var signalScale = 0.26 - speedTrim * 0.1933;
  if (signalScale < 0.060) signalScale = 0.060;

  var echoScale = 0.41 - speedTrim * 0.2989;
  if (echoScale < 0.080) echoScale = 0.080;

  var sparkScale = 0.060 - speedTrim * 0.04444;
  if (sparkScale < 0.013) sparkScale = 0.013;

  pPathA = time(pathScaleA);
  pPathB = time(pathScaleB);
  pSignal = time(signalScale);
  pEcho = time(echoScale);
  pSpark = time(sparkScale);

  /*
    Complex but smooth path:
    wave() is turn-based and safe across MarsinScript versions.
    We mix fundamentals + irrational harmonics, then normalize.
  */
  var motionX =
    (wave(pPathA + pPathB * 0.17) - 0.5) * 2.0 +
    chaos * (wave(pPathA * GOLDEN * 2.7 + pPathB * 0.31) - 0.5);

  var motionZ =
    (wave(pPathB + pPathA * 0.13) - 0.5) * 2.0 +
    chaos * (wave(pPathB * SQRT2 * 1.9 + pPathA * 0.27) - 0.5);

  var norm = 1.0 / (1.0 + chaos * 0.5);
  var radius = 0.20 + chaos * 0.11;

  beaconX = 0.5 + motionX * norm * radius;
  beaconZ = 0.5 + motionZ * norm * radius;

  // A separate ghost center gives a trailing afterimage without storing history.
  var ghostMotionX =
    (wave(pPathA + 0.87 + pPathB * 0.11) - 0.5) * 2.0 +
    chaos * (wave((pPathA + 0.23) * GOLDEN * 2.7 + pPathB * 0.19) - 0.5);

  var ghostMotionZ =
    (wave(pPathB + 0.64 + pPathA * 0.09) - 0.5) * 2.0 +
    chaos * (wave((pPathB + 0.41) * SQRT2 * 1.9 + pPathA * 0.21) - 0.5);

  ghostX = 0.5 + ghostMotionX * norm * radius;
  ghostZ = 0.5 + ghostMotionZ * norm * radius;
}

export function render(index, x, y, z) {
  var nx = x;
  var ny = y;
  var nz = z;

  // Defensive normalization for both normalized and real-world-ish models.
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
  var uvv = 0.0;

  var width = 0.045 + beamWidth * 0.255;

  var dx = nx - beaconX;
  var dz = nz - beaconZ;
  var distanceMain = sqrt(dx * dx + dz * dz);

  var ghostDx = nx - ghostX;
  var ghostDz = nz - ghostZ;
  var distanceGhost = sqrt(ghostDx * ghostDx + ghostDz * ghostDz);

  var signal = sosEnvelope();
  var signalSoft = softShape(signal);

  var coreSpot = spotShape(distanceMain, width);
  var ghostSpot = spotShape(distanceGhost, width * 1.75) * echoGlow * 0.42;

  var beam = clamp01(coreSpot + ghostSpot);
  var coreHit = coreSpot * signalSoft;

  // The distress beacon should disappear between signal pulses.
  var blackout = 1.0 - blackoutDepth * (1.0 - signalSoft);
  blackout = clamp01(blackout);

  if (isRedwood) {
    /*
      Redwoods = the forest answering the distress signal.
      They glow cp2 when the beacon is between pulses, then catch cp1 when hit.
    */

    var tree = floor(nx * 3.0);
    if (tree > 2.0) tree = 2.0;

    var treeSlot = index % 6.0;

    var echoWave = wave(pEcho + tree * 0.23 + treeSlot * 0.061 + nz * 0.19);
    echoWave = smoothstep(0.28, 0.96, echoWave);

    var answer = echoGlow * echoWave * (0.25 + 0.75 * (1.0 - signalSoft));
    var hit = coreHit * (0.45 + signalStrength * 0.65);

    var colorMix = clamp01(0.78 * answer + 0.18 * ghostSpot);
    var redwoodLevel = clamp01(answer * 0.44 + hit + ghostSpot * 0.28);

    red = paletteR(colorMix) * redwoodLevel;
    grn = paletteG(colorMix) * redwoodLevel;
    blu = paletteB(colorMix) * redwoodLevel;

    // UV lives in the forest shadow/answer, not across the whole rig.
    uvv = (0.10 + 0.46 * answer) * (1.0 - hit * 0.55);

    // White glints only when the SOS beam actually lands on the canopy.
    var sparkle = smoothstep(
      0.950 - signalStrength * 0.050,
      0.998,
      wave(pSpark * 9.0 + index * 0.337 + tree * 0.21)
    );

    white = coreHit * signalStrength * sparkle * 0.44;

  } else if (isVintage) {
    /*
      Vintage = old beacon bulbs clicking the SOS code.
      Warm but not palette-breaking.
    */

    var lampFlicker = wave(pSpark * 4.0 + index * 0.173);
    var lampLevel = clamp01((coreHit * 0.82 + ghostSpot * 0.24) * signalStrength);

    var paletteMix = clamp01(0.15 + 0.65 * beam + 0.20 * lampFlicker);

    red = paletteR(paletteMix) * lampLevel * blackout;
    grn = paletteG(paletteMix) * lampLevel * blackout;
    blu = paletteB(paletteMix) * lampLevel * blackout;

    amber = lampLevel * (0.16 + 0.34 * signalSoft);
    white = coreHit * signalStrength * 0.30;

  } else {
    /*
      Tower / wall / bars = main wandering searchlight body.
      cp1 is the hot signal, cp2 is the fading ghost trail.
    */

    var body = clamp01((coreHit * 0.95 + ghostSpot * 0.38) * signalStrength);
    body = body * blackout;

    var trailBias = clamp01(ghostSpot * 1.2);
    var paletteMix = clamp01(0.10 + trailBias * 0.70 + coreSpot * 0.18);

    red = paletteR(paletteMix) * body;
    grn = paletteG(paletteMix) * body;
    blu = paletteB(paletteMix) * body;

    // Physical hot core: visible but controlled to preserve cp1/cp2.
    white = coreHit * signalStrength * 0.38;
    amber = coreHit * signalStrength * 0.22;
  }

  // Keep WAU accents from washing out palette on RGB fallback.
  white = white * 0.72;
  amber = amber * 0.68;
  uvv = uvv * 0.70;

  rgbwau(
    clamp01(red),
    clamp01(grn),
    clamp01(blu),
    clamp01(white),
    clamp01(amber),
    clamp01(uvv)
  );
}