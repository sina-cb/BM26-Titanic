/*
  21_pelagic_manta_rays.js
  Smooth oceanic manta-ray shadows. Strict cp1<->cp2 in RGB-space.
  White-foam / UV-undertow are surfaced as named sliders, default 0.
*/

export var localSpeed = 0.5;
export var raySpan = 0.32;
export var depthFocus = 2.4;
export var whiteFoam = 0.55;
export var uvUndertow = 0.45;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Sea
export var cp2H = 0.44, cp2S = 1.0, cp2V = 1.0; // Reef
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRaySpan(v) { raySpan = 0.14 + v * 0.46; }
export function sliderDepthFocus(v) { depthFocus = 1.0 + v * 4.0; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

var swimA = 0.0;
var swimB = 0.0;
var currentScale = 0.18;

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
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  currentScale = 0.18 / localMultiplier;
  swimA = time(currentScale) * 6.2831853;
  swimB = time(currentScale * 0.47) * 6.2831853;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var mantaY = 0.48 + sin(swimA + nx * 3.6) * 0.18 + sin(swimB - nx * 5.0) * 0.09;
  var wing = abs(ny - mantaY);
  var body = max(0.0, 1.0 - wing / raySpan);
  body = pow(body, depthFocus);

  var wingRipple = wave(nx * 3.2 + sin(swimB + ny * 4.0) * 0.35);
  var rollingLight = wave(ny * 2.0 - nx * 0.7 + time(currentScale * 0.62));
  var ocean = 0.08 + rollingLight * 0.28 + body * (0.45 + wingRipple * 0.25);

  var colorMix = wave(nx * 0.8 + ny * 1.2 + time(currentScale * 0.31));
  var r = (pr1 + (pr2 - pr1) * colorMix) * ocean;
  var g = (pg1 + (pg2 - pg1) * colorMix) * ocean;
  var b = (pb1 + (pb2 - pb1) * colorMix) * ocean;

  var foamLine = pow(max(0.0, 1.0 - abs(ny - 0.88) * 7.0), 2.0);
  var white = min(1.0, (foamLine * rollingLight + body * 0.22) * whiteFoam);
  var uv = min(1.0, ((1.0 - ny) * rollingLight * 0.5 + body * 0.25) * uvUndertow);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
