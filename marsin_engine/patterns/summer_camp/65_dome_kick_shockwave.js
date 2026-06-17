/*
  65_dome_kick_shockwave.js — optimized
  D9 — "APEX shockwave, but with fewer and stronger controls."

  Design goals:
  - No fake audio_* sliders.
  - Smaller parameter list.
  - Every slider makes an obvious visual change.
  - More negative space by default.
  - Big APEX ignition -> expanding ring -> perimeter echo.

  Core controls:
  - ShockSpeed: how often/how fast waves fire.
  - RingWidth: needle-thin laser ring -> wide blast wave.
  - Impact: dim ripple -> violent white-hot shove.
  - Echoes: one clean ring -> layered ghost rings.
  - VoidDepth: glowing atmosphere -> mostly black negative space.
*/

export var localSpeed = 0.5;
export var shockSpeed = 0.58;
export var ringWidth = 0.34;
export var impact = 0.84;
export var echoes = 0.42;
export var voidDepth = 0.72;

export var cp1H = 0.63, cp1S = 0.95, cp1V = 0.58;  // deep electric blue base
export var cp2H = 0.045, cp2S = 1.00, cp2V = 1.00; // hot orange shockwave
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShockSpeed(v) { shockSpeed = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderImpact(v) { impact = v; }
export function sliderEchoes(v) { echoes = v; }
export function sliderVoidDepth(v) { voidDepth = v; }

var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 0.2, pb2 = 0;

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

var tShock = 0.0;
var tGlow = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1000.0) * localMult;

  // ShockSpeed is intentionally dramatic: low = slow cannon blast, high = rapid pulse train.
  tShock = tShock + dt * (0.075 + shockSpeed * 1.22);
  tGlow  = tGlow  + dt * (0.045 + shockSpeed * 0.12);
  tSpark = tSpark + dt * (0.90 + impact * 1.75 + shockSpeed * 0.65);

  _hsv2rgb1();
  _hsv2rgb2();
}

function ringPos(k) {
  return wrap01(tShock - k * (0.10 + GOLDEN * 0.22));
}

function ringLife(k) {
  return ringPos(k);
}

function ringAmp(k) {
  if (k == 0) return 1.0;
  // Echoes slider is very obvious: 0 = almost no ghosts, 1 = strong layered trails.
  return echoes * (1.04 - k * 0.21);
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  // RingWidth has a huge range: sharp tracer -> broad blast.
  var width = 0.018 + ringWidth * 0.190;
  var impactPow = 0.55 + impact * 1.95;
  var globalFloor = (1.0 - voidDepth) * 0.050;

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

    var shock = 0.0;
    var lead = 0.0;

    // Three intentionally visible echoes. No hidden weak fourth ring.
    for (var k = 0; k < 3; k = k + 1) {
      var rp = wrap01(ringPos(k) + ph * 0.10);
      var life = ringLife(k);
      var decay = pow(1.0 - life, 0.72 + impact * 1.20);
      var hit = softPulse(abs(edgeT - rp), width);
      var amp = ringAmp(k);
      shock = shock + hit * decay * amp;
      if (k == 0) lead = hit * decay;
    }

    // Black valleys between the travelling fronts.
    var voidGate = 1.0 - voidDepth * pow(wave(edgeT * 3.0 + ph - tGlow), 3.0);
    shock = shock * clamp01(voidGate);

    // APEX ignition is strong and unmistakable.
    var apexIgnition = softPulse(edgeT, 0.13 + ringWidth * 0.08)
                     * pow(1.0 - ringLife(0), 1.15)
                     * (0.45 + impact * 0.85);

    stage = clamp01(apexIgnition + shock * (0.55 + impact * 1.12));
    white = clamp01(apexIgnition * 0.42 + lead * (0.35 + impact * 0.62));
    uv = clamp01(apexIgnition * 0.22 + lead * (1.0 - edgeT) * 0.26);
    mixv = clamp01(0.12 + ph * 0.25 + stage * 0.78);

  } else if (isTrianglePar) {
    var parId = index - 54;
    if (parId < 0 || parId > 2) parId = index % 3;

    var parOff = PH0;
    if (parId == 1) parOff = PH1;
    if (parId == 2) parOff = PH2;

    // The cap is the explosion source. Impact should be painfully obvious here.
    var birth = pow(1.0 - ringLife(0), 0.65 + (1.0 - impact) * 1.10);
    var corona = pow(wave(tShock * SQRT2 + parOff), 1.65);
    var stutter = softPulse(circDist(ringPos(0), parOff), 0.20);

    stage = clamp01(0.045
                  + birth * (0.36 + impact * 0.78)
                  + corona * (0.10 + impact * 0.25)
                  + stutter * echoes * 0.26);

    white = clamp01(birth * (0.32 + impact * 0.68) + stutter * 0.30);
    amber = clamp01(birth * 0.22 + corona * 0.16);
    uv = clamp01(stutter * 0.22 + corona * 0.12);
    mixv = clamp01(0.42 + parOff * 0.32 + birth * 0.30);

  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var theta = wrap01((atan2(z, x) / PI2) + 0.5);

    // Use the actual bar as a giant radial pixel segment.
    // pos mixes azimuth and pixel position enough that the wave rolls through the perimeter.
    var pos = wrap01(theta * 0.58 + barT * 0.20 + barIndex * 0.043);

    var shock2 = 0.0;
    var lead2 = 0.0;
    for (var k2 = 0; k2 < 3; k2 = k2 + 1) {
      var rp2 = ringPos(k2);
      var d2 = circDist(pos, rp2);
      var life2 = ringLife(k2);
      var decay2 = pow(1.0 - life2, 0.70 + impact * 1.05);
      var hit2 = softPulse(d2, width * (0.90 + k2 * 0.18));
      var amp2 = ringAmp(k2);
      shock2 = shock2 + hit2 * decay2 * amp2;
      if (k2 == 0) lead2 = hit2 * decay2;
    }

    // Perimeter shadow bands make the shockwave look like it is cutting through darkness.
    var shadow = pow(wave(theta * 5.0 - tGlow * 0.7 + barIndex * 0.11), 2.6 + voidDepth * 3.0);
    var atmosphere = (1.0 - voidDepth) * (0.035 + 0.045 * wave(barT * 3.0 + tGlow));
    shock2 = shock2 * (1.0 - shadow * voidDepth * 0.82);

    stage = clamp01(atmosphere + shock2 * (0.58 + impact * 1.25));
    white = clamp01(lead2 * (0.28 + impact * 0.62));
    uv = clamp01(lead2 * 0.18 + shock2 * 0.08);
    mixv = clamp01(0.12 + theta * 0.30 + stage * 0.82);

  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    // Sparse heat after the blast. Keep this subtle so it does not flatten the scene.
    var aftershock = pow(1.0 - ringLife(0), 2.4) * impact;
    var ember = pow(wave(tGlow * 0.75 + fixtureNo * 0.271 + lampNo * 0.083), 3.0);
    var randomSpark = pow(hash01(fixtureNo * 17.3 + lampNo * 3.1 + floor(tSpark * 2.0)), 10.0);

    amber = clamp01((ember * 0.22 + aftershock * 0.18 + randomSpark * 0.10) * (0.35 + impact * 0.45));
    stage = clamp01(amber * 0.32 + aftershock * 0.025);
    white = clamp01(randomSpark * 0.045 * impact);
    mixv = wrap01(fixtureNo * 0.19 + ember * 0.18 + tGlow * 0.04);
  }

  // A few white-hot fragments at high impact only. This keeps the slider obvious.
  if (impact > 0.55) {
    var sparkSeed = hash01(index * 19.37 + floor(tSpark * 8.0));
    if (sparkSeed > 0.94) {
      var spark = (sparkSeed - 0.94) * 16.0 * impact;
      stage = clamp01(stage + spark * 0.24);
      white = clamp01(white + spark * 0.42);
    }
  }

  // Strong contrast curve. VoidDepth actually makes darkness darker.
  var shaped = pow(clamp01(stage), 1.18 - impact * 0.35);
  var brightness = clamp01(globalFloor + shaped * (0.72 + impact * 0.52));

  if (isTrianglePar) brightness = clamp01(0.045 + shaped * (0.82 + impact * 0.46));
  if (isVintage) brightness = clamp01(globalFloor * 0.25 + shaped * 0.72);

  // Dim atmosphere stays cp1. Shock cores go cp2 + white.
  var core = clamp01((stage - 0.28) * impactPow);
  var blendV = clamp01(mixv * 0.22 + core * 0.82);

  var r = (pr1 + (pr2 - pr1) * blendV) * brightness;
  var g = (pg1 + (pg2 - pg1) * blendV) * brightness;
  var b = (pb1 + (pb2 - pb1) * blendV) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
