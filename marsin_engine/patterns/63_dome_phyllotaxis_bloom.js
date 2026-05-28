/*
  63_dome_phyllotaxis_bloom.js — WOW rewrite
  D7 — "A sunflower eclipse opening from the APEX."

  This version intentionally avoids fake audio_* params.
  It is designed to look good with no CPC/audio wiring:
  - high negative space / dark void
  - bold spiral petals, not tiny mathematical speckles
  - APEX heart as the visual anchor
  - outward shockwave bloom front
  - warm vintage pollen, but only as supporting texture
*/

export var localSpeed = 0.5;
export var bloomGrowth = 0.70;
export var armCount = 0.56;        // 3..8 arms
export var seedSize = 0.48;        // lower = thinner petals, higher = wider petals
export var breathDepth = 0.78;
export var centerImpact = 0.90;
export var vintageWarm = 0.45;
export var blackoutDepth = 0.78;   // high by default: real negative space

// New visual controls.
export var voidDepth = 0.76;       // how much black space between petals
export var petalSharpness = 0.72;  // crisp, laser-cut petals
export var shockwavePower = 0.82;  // outward bloom front strength

export var cp1H = 0.095, cp1S = 1.00, cp1V = 1.00;  // molten gold
export var cp2H = 0.855, cp2S = 0.98, cp2V = 0.98;  // ultraviolet magenta
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBloomGrowth(v) { bloomGrowth = v; }
export function sliderArmCount(v) { armCount = v; }
export function sliderSeedSize(v) { seedSize = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderCenterImpact(v) { centerImpact = v; }
export function sliderVintageWarm(v) { vintageWarm = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderVoidDepth(v) { voidDepth = v; }
export function sliderPetalSharpness(v) { petalSharpness = v; }
export function sliderShockwavePower(v) { shockwavePower = v; }

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

function softPulse(dist, width) {
  var xVal = clamp01(1.0 - dist / width);
  return xVal * xVal * (3.0 - 2.0 * xVal);
}

function hash01(v) {
  var h = sin(v * 12.9898) * 43758.5453;
  return h - floor(h);
}

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;
var PH0 = 0.000;
var PH1 = 0.382;
var PH2 = 0.764;

var tOpen = 0.0;
var tSpin = 0.0;
var tBloom = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1000.0) * localMult;

  // Big, readable periods. No fake audio inputs.
  tOpen  = tOpen  + dt * (0.040 + bloomGrowth * 0.055);
  tSpin  = tSpin  + dt * (0.055 + bloomGrowth * 0.105);
  tBloom = tBloom + dt * (0.145 + bloomGrowth * 0.235);
  tSpark = tSpark + dt * (0.85 + bloomGrowth * 1.15);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var arms = floor(3.0 + armCount * 5.0);  // 3..8

  // Flower opens/closes slowly, but never becomes a flat full wash.
  var openWave = wave(tOpen * 0.5);
  var openness = clamp01(0.18 + breathDepth * 0.72 * openWave);

  // A clear expanding ring, reused per section.
  var bloomHead = wrap01(tBloom);
  var petalExp = 1.25 + petalSharpness * 6.0;
  var narrow = 0.022 + seedSize * 0.070;

  var stage = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;
  var mixv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    var ph = PH0;
    if (edgeId == 1) ph = PH1;
    if (edgeId == 2) ph = PH2;

    // Edge behaves like a comet path from APEX to perimeter.
    var front = softPulse(circDist(edgeT, bloomHead), 0.055 + seedSize * 0.070);
    var tail = softPulse(circDist(edgeT, wrap01(bloomHead - 0.13)), 0.035 + seedSize * 0.055);

    var spiral = wave(edgeT * (arms * 0.72 + 2.2) - tSpin * 1.9 + ph);
    var petal = pow(spiral, petalExp);

    var apexFlare = softPulse(edgeT, 0.16 + centerImpact * 0.10)
                  * pow(wave(tBloom * SQRT2 + ph), 2.6);

    // Most of the edge stays dark. Only the comet/front/petal is bright.
    stage = clamp01(apexFlare * (0.30 + centerImpact * 0.45)
                  + front * (0.55 + petal * 0.55) * shockwavePower
                  + tail * petal * 0.35
                  + petal * 0.13 * openness);

    white = clamp01(apexFlare * 0.30 + front * petal * 0.35);
    uv = clamp01(apexFlare * 0.16 + front * (1.0 - edgeT) * 0.22);
    mixv = wrap01(ph + edgeT * 0.50 + petal * 0.22 + front * 0.35);

  } else if (isTrianglePar) {
    var parId = index - 54;
    if (parId < 0 || parId > 2) parId = index % 3;

    var parOff = PH0;
    if (parId == 1) parOff = PH1;
    if (parId == 2) parOff = PH2;

    // APEX heart: bright, pulsing, ceremonial.
    var heart = pow(wave(tBloom * 1.35 + parOff), 2.2);
    var iris = pow(wave(tOpen * GOLDEN + parOff * 1.9), 1.6);
    var ignition = softPulse(circDist(bloomHead, parOff), 0.16);

    stage = clamp01(0.10
                  + heart * (0.30 + centerImpact * 0.42)
                  + iris * openness * 0.24
                  + ignition * shockwavePower * 0.38);

    white = clamp01(0.06 + heart * 0.44 + ignition * 0.35);
    amber = clamp01(heart * 0.22 + ignition * 0.26);
    uv = clamp01(iris * 0.22 + ignition * 0.18);
    mixv = wrap01(parOff * 0.58 + heart * 0.34 + ignition * 0.45);

  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var theta = wrap01((atan2(z, x) / PI2) + 0.5);

    // Big sunflower petals: sparse, bold, high contrast.
    var spiralA = theta * arms
                + barT * (3.8 + openness * 4.7)
                - tSpin * (1.15 + bloomGrowth * 0.25)
                + barIndex * 0.087;

    var spiralB = -theta * (arms * GOLDEN + 1.0)
                + barT * (2.6 + openness * 2.2)
                + tSpin * 0.72
                + barIndex * 0.131;

    var petalA = pow(wave(spiralA), petalExp);
    var petalB = pow(wave(spiralB), 3.8 + petalSharpness * 3.5) * 0.36;

    var petal = clamp01(petalA + petalB);

    // Expanding APEX-out shockwave. This should be the wow moment.
    var front = softPulse(circDist(barT, bloomHead), 0.050 + seedSize * 0.080);
    var front2 = softPulse(circDist(barT, wrap01(bloomHead - 0.19)), 0.030 + seedSize * 0.045);

    // Open mask prevents the whole bar row from becoming a wash.
    var openMask = clamp01(openness * 1.34 - barT * 0.42 + 0.16);

    // Voids carve out black regions between petals.
    var voidCarve = pow(wave(spiralA + 0.5), 1.5 + voidDepth * 4.0);
    var carvedPetal = clamp01(petal * (1.0 - voidCarve * voidDepth * 0.88));

    // Rare hot seeds on the petals, not everywhere.
    var seedGate = hash01(floor(barT * 18.0) * 2.7 + barIndex * 11.1 + floor(tSpark * 1.7));
    var hotSeed = 0.0;
    if (seedGate > 0.82) {
      hotSeed = pow(wave(theta * 7.0 + barT * 11.0 - tSpark * 0.42), 8.0) * carvedPetal;
    }

    // Extremely low baseline. The old version felt bland because this was too high.
    var blackFloor = 0.004 + (1.0 - voidDepth) * 0.026;

    stage = clamp01(blackFloor
                  + carvedPetal * openMask * 0.32
                  + front * (0.46 + carvedPetal * 0.78) * shockwavePower
                  + front2 * carvedPetal * 0.30
                  + hotSeed * 0.50);

    white = clamp01(front * carvedPetal * 0.32 + hotSeed * 0.55);
    uv = clamp01(front * (1.0 - barT) * 0.22 + hotSeed * 0.18);
    mixv = wrap01(theta * 0.72 + barT * 0.35 + tSpin * 0.045 + front * 0.36 + hotSeed * 0.55);

  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    // Sparse pollen lanterns. Keep them warm and low so the APEX/bar petals dominate.
    var pollen = pow(wave(tOpen * 0.61 + fixtureNo * 0.271 + lampNo * 0.113), 3.2);
    var twinkle = pow(hash01(fixtureNo * 13.7 + lampNo * 5.1 + floor(tSpark * 2.0)), 9.0);

    amber = clamp01((pollen * 0.42 + twinkle * 0.28) * vintageWarm);
    stage = clamp01(amber * 0.36);
    white = clamp01(twinkle * vintageWarm * 0.08);
    mixv = wrap01(fixtureNo * 0.20 + pollen * 0.20 + tOpen * 0.035);
  }

  // Final negative-space shaping.
  var globalFloor = (1.0 - blackoutDepth) * 0.020;
  var shaped = pow(clamp01(stage), 0.78);
  var brightness = clamp01(globalFloor + shaped * 1.05);

  if (isTrianglePar) brightness = clamp01(0.08 + shaped * (0.98 + centerImpact * 0.22));
  if (isVintage) brightness = clamp01(globalFloor * 0.30 + shaped * 0.72);

  // Avoid muddy middle: push bright cores toward cp2, dim petals toward cp1.
  var core = clamp01((stage - 0.44) * 1.85);
  var blendV = clamp01(mixv * 0.42 + core * 0.58);

  var r = (pr1 + (pr2 - pr1) * blendV) * brightness;
  var g = (pg1 + (pg2 - pg1) * blendV) * brightness;
  var b = (pb1 + (pb2 - pb1) * blendV) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
