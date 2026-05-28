/*
  115_tower_lighthouse_sweep

  Eight tower bars become a rotating lighthouse / fresnel beacon.
  A bright vertical blade sweeps tower-to-tower, neighbor towers catch
  a halo, and vintage fixtures flicker like harbor lamps.

  Tower-only:
  - TowerBars: index 0..143, 8 towers x 18 pixels.
  - VintageOnly: soft harbor-lamp support.
  - Redwoods: explicitly black.

  Controls:
  - localSpeed: speed trim.
  - beamGlow: dim beacon -> bright lighthouse blade.
  - beamWidth: tight beam -> wide fresnel wash.
  - trail: clean sweep -> long rotating afterimage.
  - blackoutDepth: ambient atmosphere -> dramatic dark gaps.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var TOWER_BAR_HI = 143;
var REDWOOD_START = 204;
var REDWOOD_END = 221;

var TOWER_COUNT = 8;
var PIXELS_PER_TOWER = 18;

export var localSpeed = 0.5;
export var beamGlow = 0.78;
export var beamWidth = 0.36;
export var trail = 0.55;
export var blackoutDepth = 0.48;

export var cp1H = 0.62, cp1S = 1.0, cp1V = 0.95;
export var cp2H = 0.12, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBeamGlow(v) { beamGlow = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderTrail(v) { trail = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function wrap01(v) {
  v = v % 1.0;
  if (v < 0.0) v += 1.0;
  return v;
}

function circDist(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

function smoothstep01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function softPulse(d, w) {
  var n = clamp01(1.0 - d / w);
  return smoothstep01(n);
}

function hash01(v) {
  var h = sin(v * 12.9898) * 43758.5453;
  return h - floor(h);
}

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;

var tSweep = 0.0;
var tColumn = 0.0;
var tTrail = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1000.0) * localMult;

  tSweep  = wrap01(tSweep  + dt * (0.045 + beamGlow * 0.145));
  tColumn = wrap01(tColumn + dt * (0.080 + beamWidth * 0.180));
  tTrail  = wrap01(tTrail  + dt * (0.030 + trail * 0.095));
  tColor  = wrap01(tColor  + dt * (0.016 + beamGlow * 0.050));
  tSpark  = wrap01(tSpark  + dt * (0.35 + beamGlow * 1.20));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRedwoodByMask = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isRedwoodByIndex = index >= REDWOOD_START && index <= REDWOOD_END;
  var isRedwood = isRedwoodByMask || isRedwoodByIndex;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;
  var colorMix = 0.0;
  var brightness = 0.0;

  if (isRedwood) {
    // Tower-only pattern: keep redwoods dark.
  } else if (index <= TOWER_BAR_HI) {
    var towerId = floor(index / PIXELS_PER_TOWER);
    var barT = (index % PIXELS_PER_TOWER) / (PIXELS_PER_TOWER - 1.0);
    var towerPos = towerId / TOWER_COUNT;

    var beamHead = tSweep;
    var beamD = circDist(towerPos, beamHead);
    var beamW = 0.045 + beamWidth * 0.210;
    var beamCore = softPulse(beamD, beamW);

    var trailHead1 = wrap01(beamHead - 0.12 - trail * 0.08);
    var trailHead2 = wrap01(beamHead - 0.27 - trail * 0.12);
    var trail1 = softPulse(circDist(towerPos, trailHead1), beamW * 1.55) * trail * 0.42;
    var trail2 = softPulse(circDist(towerPos, trailHead2), beamW * 2.20) * trail * 0.22;

    // Vertical fresnel shimmer inside the tower as the beam hits.
    var columnHead = wave(tColumn + towerId * GOLDEN);
    var columnBlade = softPulse(abs(barT - columnHead), 0.105 + beamWidth * 0.150);
    var columnGhost = softPulse(abs(barT - wave(tTrail + towerId * 0.117)), 0.220 + trail * 0.180) * 0.26;

    var lightBody = clamp01(beamCore + trail1 + trail2);
    var verticalLife = clamp01(columnBlade * (0.30 + beamCore * 0.70) + columnGhost * trail);

    var shadow = pow(wave(barT * 2.0 - tTrail + towerId * 0.181), 2.2 + blackoutDepth * 4.0);
    brightness = (1.0 - blackoutDepth) * (0.025 + beamGlow * 0.045)
               + lightBody * (0.30 + beamGlow * 0.70)
               + verticalLife * beamGlow * 0.30;

    brightness = brightness * (1.0 - shadow * blackoutDepth * (0.28 + 0.34 * (1.0 - beamCore)));
    brightness = clamp01(brightness);

    var heightMix = barT;
    var rotatingMix = wave(tColor + towerPos * 0.71 + beamCore * 0.29);
    var bladeMix = wave(tColor * 0.7 + columnHead * 0.31 + barT * 0.41);
    colorMix = clamp01(0.38 * heightMix + 0.34 * rotatingMix + 0.28 * bladeMix);
    colorMix = clamp01(colorMix + beamCore * 0.14 - shadow * blackoutDepth * 0.08);

    var sparkSeed = hash01(index * 17.17 + floor(tSpark * 9.0) + towerId * 3.7);
    var glint = 0.0;
    if (sparkSeed > 0.958) {
      glint = (sparkSeed - 0.958) * 23.80 * beamGlow * beamCore;
    }

    brightness = clamp01(brightness + glint * 0.12);
    colorMix = clamp01(colorMix + glint * 0.10);

    w = clamp01((beamCore * columnBlade * 0.13 + glint * 0.06) * beamGlow);
    a = clamp01((beamCore * 0.030 + trail1 * 0.020) * beamGlow);

  } else if (isVintage) {
    var lampSweep = wave(x * 0.72 - tSweep + z * 0.18);
    var lampFlicker = pow(wave(tTrail + index * 0.023), 2.0);
    brightness = 0.025 + beamGlow * (lampSweep * 0.105 + lampFlicker * 0.070);
    brightness = brightness * (1.0 - blackoutDepth * 0.20);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.58 + 0.26 * lampSweep + 0.16 * wave(tColor + index * 0.011));
    a = clamp01(beamGlow * lampFlicker * 0.045);

  } else {
    // Low atmospheric echo if any unmasked pixels exist.
    var echoD = circDist(x, tSweep);
    var echo = softPulse(echoD, 0.22 + beamWidth * 0.30);
    var fog = pow(wave(tTrail + x * 0.31 + z * 0.17), 1.9);

    brightness = (1.0 - blackoutDepth) * 0.020 + beamGlow * (echo * 0.080 + fog * 0.040);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.35 + echo * 0.45 + fog * 0.20);
  }

  r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}