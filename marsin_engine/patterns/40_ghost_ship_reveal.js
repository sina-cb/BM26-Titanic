/*
  ghost_ship_reveal
  Pattern matching technical and artistic specifications.
*/

export var localSpeed = 0.5;
export var uvReveal = 1.0;
export var lanternGlow = 0.3;
export var spectralSparkle = 0.2;

export var cp1H = 0.62, cp1S = 0.9, cp1V = 0.35;
export var cp2H = 0.72, cp2S = 0.8, cp2V = 0.25;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderUVReveal(v) { uvReveal = v; }
export function sliderLanternGlow(v) { lanternGlow = v; }
export function sliderSpectralSparkle(v) { spectralSparkle = v; }

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

var tPhase = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isApex = (viewMask & 3) != 0;
  var isVintage = (viewMask & 8) != 0;

  // Spatial UV reveal crawling across physical pixels
  var crawl = wave(tPhase * 0.7 + x * 0.08 + y * 0.23 + z * 0.11);
  var structuralMask = isApex ? 1.0 : 0.7;

  // Subtle cp1/cp2 ghost color field
  var colorMix = wave(tPhase * 0.35 + x * 0.04 + z * 0.06);
  var baseBrightness = 0.04 + 0.10 * crawl;

  var r = (pr1 + (pr2 - pr1) * colorMix) * baseBrightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * baseBrightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * baseBrightness;

  // UV structure reveal
  var u = uvReveal * structuralMask * crawl;

  // Amber lantern flicker on vintage lamps
  var lanternFlicker =
    0.35 +
    0.45 * wave(tPhase * 4.0 + index * 0.071) +
    0.20 * wave(tPhase * 9.0 + index * 0.137);

  var a = isVintage ? lanternGlow * lanternFlicker : 0.0;

  // Rare white spectral glints on apex
  var sparkle = random(1) < 0.025 ? 1.0 : 0.0;
  var w = isApex ? spectralSparkle * sparkle : 0.0;

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}
