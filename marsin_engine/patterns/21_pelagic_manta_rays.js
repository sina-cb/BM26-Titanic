/*
  21_pelagic_manta_rays.js
  Smooth oceanic manta-ray shadows with white foam glints and a low UV undertow.
*/

export var speedTrim = 0.5;
export var raySpan = 0.32;
export var depthFocus = 2.4;
export var whiteFoam = 0.55;
export var uvUndertow = 0.45;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Sea Color (Teal default)
export var cp2H = 0.44, cp2S = 1.0, cp2V = 1.0; // Reef Color (Green default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderRaySpan(v) { raySpan = 0.14 + v * 0.46; }
export function sliderDepthFocus(v) { depthFocus = 1.0 + v * 4.0; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

var swimA = 0.0;
var swimB = 0.0;
var currentScale = 0.18;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  currentScale = 0.18 / localMultiplier;
  swimA = time(currentScale) * 6.2831853;
  swimB = time(currentScale * 0.47) * 6.2831853;
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
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * colorMix;
  var sat = cp1S + (cp2S - cp1S) * colorMix;
  var maxVal = cp1V + (cp2V - cp1V) * colorMix;

  var foamLine = pow(max(0.0, 1.0 - abs(ny - 0.88) * 7.0), 2.0);
  var white = min(1.0, (foamLine * rollingLight + body * 0.22) * whiteFoam * (1.0 - sat));
  var uv = min(1.0, ((1.0 - ny) * rollingLight * 0.5 + body * 0.25) * uvUndertow);

  var val = ocean * maxVal;
  var r = val * wave(hue + 0.000);
  var g = val * wave(hue + 0.333);
  var b = val * wave(hue + 0.666);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
