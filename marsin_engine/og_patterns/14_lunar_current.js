/*
  14_lunar_current.js
  Wide, smooth moonlit currents. Strict cp1<->cp2 palette in RGB-space.
  White/UV emitters are gated behind named sliders (default 0) so the
  palette stays pure unless explicitly opted into.
*/

export var localSpeed = 0.5;
export var density = 2.8;
export var whiteLift = 0.5;
export var uvLift = 0.5;

export var cp1H = 0.58, cp1S = 0.85, cp1V = 1.0; // Current colour
export var cp2H = 0.50, cp2S = 1.00, cp2V = 1.0; // Caustic accent colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function sliderWhiteLift(v) { whiteLift = v; }
export function sliderUvLift(v) { uvLift = v; }

var driftA = 0.0;
var driftB = 0.0;

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
  driftA = time(0.035 / localMultiplier);
  driftB = time(0.015 / localMultiplier);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var longWave = wave((nx * density) + (ny * 0.8) - driftA);
  var crossWave = wave((ny * density * 0.7) - (nx * 0.6) + driftB);
  var current = (longWave * 0.65) + (crossWave * 0.35);
  current = pow(current, 1.8);

  var crown = pow(max(0.0, ny), 1.6);
  var v = current * (0.6 + 0.4 * crown);

  // Strict cp1<->cp2 RGB lerp driven by crossWave.
  var tColour = crossWave;
  var r = (pr1 + (pr2 - pr1) * tColour) * v;
  var g = (pg1 + (pg2 - pg1) * tColour) * v;
  var b = (pb1 + (pb2 - pb1) * tColour) * v;

  // Optional white / UV crown — defaults to 0 so the palette stays pure.
  var w = current * crown * whiteLift;
  var u = (0.2 + crossWave * 0.8) * crown * uvLift;

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b),
         min(1.0, w), 0.0, min(1.0, u));
}
