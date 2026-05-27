/*
  13_sparkle.js
  Distributed Section Sparkle — strict cp1<->cp2 palette in RGB-space.
  Background dim wash uses a smooth x-gradient (cp1 on the left, cp2 on
  the right). Sparkles burst between the two palette colours — never
  desaturating to white, never injecting a third hue.
*/

export var localSpeed = 0.5;
export var sparkleSpeedTrim = 0.5;
export var sparkleDensity = 0.4;
export var sparkleIntensity = 0.85;
export var sparkleSize = 0.35;
export var backgroundLevel = 0.18;
export var whiteGlint = 0.42;
export var amberGlint = 0.18;
export var uvGlint = 0.12;
export var backgroundMotion = 0.45;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Left / "A" colour
export var cp2H = 0.5, cp2S = 1.0, cp2V = 1.0; // Right / "B" colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSparkleSpeedTrim(v) { sparkleSpeedTrim = v; }
export function sliderSparkleDensity(v) { sparkleDensity = 0.1 + v * 0.8; }
export function sliderSparkleIntensity(v) { sparkleIntensity = v; }
export function sliderSparkleSize(v) { sparkleSize = v; }
export function sliderBackgroundLevel(v) { backgroundLevel = v; }
export function sliderWhiteGlint(v) { whiteGlint = v; }
export function sliderAmberGlint(v) { amberGlint = v; }
export function sliderUvGlint(v) { uvGlint = v; }
export function sliderBackgroundMotion(v) { backgroundMotion = v; }

var tFade;
var tSparkle;

// ── Palette RGB cache ─────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var localSparkleMultiplier = pow(2.0, (sparkleSpeedTrim - 0.5) * 4.0);
  tFade = time(0.02 / localMultiplier);
  tSparkle = time(0.01 / localSparkleMultiplier);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Smooth left->right blend factor (continuous; previously this was a
  // 3-way sectionId switch that produced 3 distinct colours).
  var nx = (x + 0.4) / 2.02;
  if (nx < 0.0) nx = 0.0;
  if (nx > 1.0) nx = 1.0;

  var theta = (atan2(z, x) / PI2) + 0.5;
  theta = theta - floor(theta);
  var bgFieldA = wave(nx * 1.7 + y * 0.061 - tFade * (0.45 + backgroundMotion));
  var bgFieldB = wave(theta * 2.3 + z * 0.037 + tFade * (0.22 + backgroundMotion * 0.70));
  var bgFieldC = wave((nx - theta) * 1.9 + sectionId * 0.17 + tFade * 0.31);
  var bgBlend = max(0.0, min(1.0, bgFieldA * 0.42 + bgFieldB * 0.38 + bgFieldC * 0.20));
  var bgAlpha = wave(tFade + (sectionId * 0.2) + bgBlend * backgroundMotion * 0.35);

  // Per-pixel sparkle decision (cheap deterministic hash on index + time).
  var seed = index * 73.137 + tSparkle * 1000.0;
  var sparkle = sin(seed) * sin(seed * 3.7) * sin(seed * 7.3);
  sparkle = sparkle * sparkle * sparkle * sparkle;
  var bloom = sin(seed * 0.071 + x * 0.37 + y * 0.19 + z * 0.11);
  bloom = bloom * bloom;
  var threshold = 0.96 - sparkleDensity * 0.62;

  // Blend factor along the cp1<->cp2 line. Sparkles always favour cp2
  // (the "spark" colour) so they read as a bright accent over the wash.
  var tColour = bgBlend;
  var v = bgAlpha * backgroundLevel;
  var sparkV = 0.0;

  if (sparkle > threshold) {
     var intensity = min(1.0, (sparkle - threshold) / (1.0 - threshold + 0.0001));
     sparkV = pow(intensity, 1.0 + (1.0 - sparkleSize) * 4.0);
     sparkV = min(1.0, sparkV * (0.55 + sparkleIntensity * 1.45) + bloom * sparkleSize * sparkleIntensity * 0.35);
     tColour = min(1.0, bgBlend * 0.28 + 0.68 + bloom * 0.18); // sparkle leans cp2 but keeps palette context
     v = max(v, sparkV);
  }

  var r = (pr1 + (pr2 - pr1) * tColour) * v;
  var g = (pg1 + (pg2 - pg1) * tColour) * v;
  var b = (pb1 + (pb2 - pb1) * tColour) * v;
  var w = sparkV * whiteGlint;
  var a = sparkV * amberGlint;
  var u = sparkV * uvGlint;
  rgbwau(r, g, b, w, a, u);
}
