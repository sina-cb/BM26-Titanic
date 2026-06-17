/*
  117_tower_molten_elevator

  Thick molten slabs rise through the tower columns like liquid light
  moving inside glass tubes. Each tower has a delay, turbulence, and drip
  memory below the main slab.

  Tower-only:
  - TowerBars: index 0..143, 8 towers x 18 pixels.
  - VintageOnly: furnace glow / low heat response.
  - Redwoods: explicitly black.

  Controls:
  - localSpeed: speed trim.
  - moltenGlow: dim liquid -> bright molten column.
  - sweepWidth: thin elevator slab -> thick glowing block.
  - dripTrail: clean rising slab -> long dripping afterimage.
  - blackoutDepth: ambient tube glow -> high-contrast molten darkness.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var TOWER_BAR_HI = 143;
var REDWOOD_START = 204;
var REDWOOD_END = 221;

var TOWER_COUNT = 8;
var PIXELS_PER_TOWER = 18;

export var localSpeed = 0.5;
export var moltenGlow = 0.80;
export var sweepWidth = 0.44;
export var dripTrail = 0.62;
export var blackoutDepth = 0.46;

export var cp1H = 0.03, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.58, cp2S = 1.0, cp2V = 0.95;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderMoltenGlow(v) { moltenGlow = v; }
export function sliderSweepWidth(v) { sweepWidth = v; }
export function sliderDripTrail(v) { dripTrail = v; }
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

var tRise = 0.0;
var tDrip = 0.0;
var tTurb = 0.0;
var tBreath = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1000.0) * localMult;

  tRise   = wrap01(tRise   + dt * (0.060 + moltenGlow * 0.155));
  tDrip   = wrap01(tDrip   + dt * (0.030 + dripTrail * 0.100));
  tTurb   = wrap01(tTurb   + dt * (0.120 + sweepWidth * 0.230));
  tBreath = wrap01(tBreath + dt * (0.035 + moltenGlow * 0.055));
  tColor  = wrap01(tColor  + dt * (0.014 + moltenGlow * 0.050));
  tSpark  = wrap01(tSpark  + dt * (0.45 + moltenGlow * 1.60));

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

    // Rising molten slab. Tower offsets make the columns answer each other.
    var head = wrap01(tRise + towerId * 0.071 + wave(tBreath + towerId * 0.13) * 0.035);
    var width = 0.080 + sweepWidth * 0.300;

    var slab = softPulse(abs(barT - head), width);

    // Drip trail below the rising slab. When the slab wraps, trail restarts cleanly.
    var downDist = 1.0;
    if (barT < head) {
      downDist = head - barT;
    }
    var trailBody = softPulse(downDist, 0.180 + dripTrail * 0.520) * dripTrail;

    // Secondary internal turbulence inside the molten glass.
    var turbulenceA = pow(wave(barT * 3.0 + tTurb + towerId * GOLDEN), 2.2);
    var turbulenceB = pow(wave(barT * 5.0 - tDrip * SQRT2 + towerId * 0.217), 4.0) * dripTrail;
    var turbulence = clamp01(turbulenceA * 0.24 + turbulenceB * 0.28);

    // Droplet sparks below the slab, deterministic but irregular.
    var eventBucket = floor(tSpark * 13.0);
    var dropSeed = hash01(index * 23.71 + eventBucket * 5.13 + towerId * 3.1);
    var droplet = 0.0;
    if (dropSeed > 0.950 && barT < head) {
      droplet = (dropSeed - 0.950) * 20.0 * dripTrail * moltenGlow;
    }

    var liquid = clamp01(slab + trailBody * 0.62 + turbulence + droplet * 0.35);

    var shadowRib = pow(wave(barT * 2.0 - tDrip + towerId * 0.197), 2.4 + blackoutDepth * 4.4);
    var floorGlow = (1.0 - blackoutDepth) * (0.022 + moltenGlow * 0.050);

    brightness = floorGlow + liquid * (0.26 + moltenGlow * 0.78);
    brightness = brightness * (1.0 - shadowRib * blackoutDepth * (0.26 + 0.42 * (1.0 - slab)));
    brightness = clamp01(brightness);

    // Color: cp1 at hot core/base, cp2 in cooler glass edges and upper trail.
    var heightMix = barT;
    var slabMix = wave(tColor + head * 0.29 + slab * 0.37);
    var glassMix = wave(tColor * 0.73 + towerPos * 0.47 + turbulence * 0.25);
    colorMix = clamp01(0.38 * heightMix + 0.34 * glassMix + 0.28 * slabMix);
    colorMix = clamp01(colorMix - slab * 0.10 + trailBody * 0.16 + droplet * 0.08);

    // White-hot glint only on the leading edge of the slab.
    var edge = softPulse(abs(barT - head), 0.035 + sweepWidth * 0.045);
    w = clamp01(edge * slab * moltenGlow * 0.075 + droplet * 0.050);
    a = clamp01((slab * 0.055 + trailBody * 0.030 + droplet * 0.025) * moltenGlow);

  } else if (isVintage) {
    // Furnace glow support.
    var furnace = pow(wave(tBreath + x * 0.23 + z * 0.19), 1.70);
    var ember = pow(wave(tDrip + index * 0.017), 3.00);
    brightness = 0.030 + moltenGlow * (furnace * 0.110 + ember * 0.065);
    brightness = brightness * (1.0 - blackoutDepth * 0.20);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.22 + furnace * 0.34 + ember * 0.18 + wave(tColor + index * 0.013) * 0.26);
    a = clamp01(moltenGlow * (furnace * 0.050 + ember * 0.035));

  } else {
    // Low heat shimmer for any unmasked pixels.
    var heat = pow(wave(tBreath + x * 0.29 + z * 0.21), 1.9);
    var vertical = wave(tRise + z * 0.31);
    brightness = (1.0 - blackoutDepth) * 0.020 + moltenGlow * (heat * 0.055 + vertical * 0.035);
    brightness = clamp01(brightness);
    colorMix = clamp01(0.26 + heat * 0.36 + vertical * 0.24);
    a = clamp01(heat * moltenGlow * 0.020);
  }

  r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}