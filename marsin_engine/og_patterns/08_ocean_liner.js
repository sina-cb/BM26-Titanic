/*
  08_ocean_liner.js
  Ocean Liner Nocturne — quiet "water" wash with bright "porthole" pops.
  Strict palette: water uses cp1, portholes use cp2 (both pre-converted
  to RGB so no rainbow synthesis leaks third hues).
*/

export var localSpeed = 0.5;
export var windowCount = 8.0;
export var windowFocus = 6.0;
export var contrastAmount = 1.0;

export var cp1H = 0.6,  cp1S = 1.0, cp1V = 1.0; // Water colour
export var cp2H = 0.08, cp2S = 0.9, cp2V = 1.0; // Porthole colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderContrast(v) { contrastAmount = 1.0 + v * 4.0; }
export function sliderWindowCount(v) { windowCount = 1.0 + v * 20.0; }
export function sliderWindowFocus(v) { windowFocus = 1.0 + v * 15.0; }

var t1, t2;

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
  var scale = 0.15 / localMultiplier;
  t1 = time(scale * 0.5);
  t2 = time(scale * 2.0);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  var shimmer = 0.88 + 0.12 * wave(t2 + pct * 2.0);
  var pulse = 0.75 + 0.25 * wave(t1);
  var baseV = pulse * shimmer;
  baseV = pow(baseV, contrastAmount);

  var wPhase = (pct * windowCount + t2) % 1.0;
  var wSharp = triangle(wPhase);
  var wTrigger = 0.80;
  var windows = wSharp > wTrigger ? (wSharp - wTrigger) * windowFocus : 0.0;
  windows = min(1.0, windows);

  // Water layer (cp1) + porthole layer (cp2), summed channel-wise.
  var r = baseV * pr1 + windows * pr2;
  var g = baseV * pg1 + windows * pg2;
  var b = baseV * pb1 + windows * pb2;

  rgb(min(1.0, r), min(1.0, g), min(1.0, b));
}
