/*
  16_ghost_tide_uv.js
  Slow tidal sweep with foam/UV undertow. White & UV are surfaced as
  explicit named sliders (default 0). Palette is strict cp1<->cp2.
*/

export var localSpeed = 0.5;
export var tideWidth = 0.38;
// Pattern is named "ghost_tide_UV" — UV/white are the whole point.
// Defaults restored so the personality survives a fresh load; turn the
// named sliders down (or to 0) if you want strict RGB-only output.
export var whiteLevel = 0.85;
export var uvLevel = 0.7;

export var cp1H = 0.62, cp1S = 1.0, cp1V = 1.0; // Mist colour
export var cp2H = 0.50, cp2S = 1.0, cp2V = 1.0; // Undertow colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderTideWidth(v) { tideWidth = 0.15 + v * 0.55; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderUvLevel(v) { uvLevel = v; }

var tide = 0.0;
var undertow = 0.0;

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
  tide = time(0.025 / localMultiplier);
  undertow = time(0.014 / localMultiplier);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var sweep = (nx * 0.75 + ny * 0.55 + tide) % 1.0;
  var edge = abs(sweep - 0.5) * 2.0;
  var foam = max(0.0, 1.0 - edge / tideWidth);
  foam = pow(foam, 2.4);

  var lowRoll = wave((ny * 2.2) - (nx * 0.8) + undertow);
  var mist = pow(lowRoll, 2.0) * (0.25 + foam * 0.45);

  var tColour = lowRoll;
  var r = (pr1 + (pr2 - pr1) * tColour) * mist;
  var g = (pg1 + (pg2 - pg1) * tColour) * mist;
  var b = (pb1 + (pb2 - pb1) * tColour) * mist;

  var white = foam * whiteLevel;
  var uv = ((1.0 - ny) * lowRoll * 0.45 + foam * 0.55) * uvLevel;

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b),
         min(1.0, white), 0.0, min(1.0, uv));
}
