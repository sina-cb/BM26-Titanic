/*
  23_prismatic_strange_attractors.js
  Strange moving gravity wells in strict cp1<->cp2 palette (RGB-space).
  White-core / UV-ghost surfaced as named sliders (default 0).
*/

export var localSpeed = 0.5;
export var chaos = 4.5;
export var orbitReach = 0.42;
export var contrast = 3.0;
export var darkFloor = 0.04;
export var whiteCore = 0.5;
export var uvGhost = 0.35;
export var colorSpread = 1.0;

export var cp1H = 0.58, cp1S = 0.92, cp1V = 1.0;
export var cp2H = 0.86, cp2S = 0.92, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderChaos(v) { chaos = 1.0 + v * 10.0; }
export function sliderOrbitReach(v) { orbitReach = 0.12 + v * 0.55; }
export function sliderContrast(v) { contrast = 1.0 + v * 7.0; }
export function sliderDarkFloor(v) { darkFloor = v * 0.18; }
export function sliderWhiteCore(v) { whiteCore = v; }
export function sliderUvGhost(v) { uvGhost = v; }
export function sliderColorSpread(v) { colorSpread = 0.2 + v * 1.4; }

// ── Continuity: each attractor harmonic needs its own time() base so the
//   wave/sin argument is time(s)*TAU with NO fractional multiplier on the
//   wrapping phase. Without this, sin(phaseA*1.37 + ...) jumps every period
//   by sin(2π*1.37+c)→sin(c). See pattern 20 for the same fix.
var phaseA = 0.0;
var phaseB = 0.0;
var phaseC = 0.0;
var phaseA137 = 0.0, phaseB171 = 0.0, phaseA063 = 0.0;
var phaseC193 = 0.0, phaseA03 = 0.0, phaseB07 = 0.0;
var currentScale = 0.16;

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
  currentScale = 0.16 / localMultiplier;
  phaseA = time(currentScale) * 6.2831853;
  phaseB = time(currentScale * 0.47) * 6.2831853;
  phaseC = time(currentScale * 0.29) * 6.2831853;
  // Per-harmonic time() bases: scale s/k gives a k× rate phase that wraps
  // cleanly. Old code did phaseA*1.37 etc. → fractional-multiple-of-2π jumps
  // at every wrap, visible as periodic flicker on the attractor positions.
  phaseA137 = time(currentScale / 1.37) * 6.2831853;
  phaseB171 = time(currentScale * 0.47 / 1.71) * 6.2831853;
  phaseA063 = time(currentScale / 0.63) * 6.2831853;
  phaseC193 = time(currentScale * 0.29 / 1.93) * 6.2831853;
  phaseA03  = time(currentScale / 0.3) * 6.2831853;
  phaseB07  = time(currentScale * 0.47 / 0.7) * 6.2831853;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  var nz = (z + 0.35) / 1.2;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));
  nz = max(0.0, min(1.0, nz));

  var ax = 0.5 + orbitReach * sin(phaseA + sin(phaseB) * 0.8) * 0.9;
  var ay = 0.5 + orbitReach * sin(phaseA137 + phaseC) * 0.68;
  var bx = 0.5 + orbitReach * sin(phaseB171 - 1.4) * 0.8;
  var by = 0.5 + orbitReach * cos(phaseA063 + phaseB) * 0.62;
  var cx = 0.5 + orbitReach * cos(phaseC193 + phaseA03) * 0.74;
  var cy = 0.5 + orbitReach * sin(phaseC - phaseB07) * 0.7;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);
  var nearest = min(dA, min(dB, dC));

  var curl = sin((dA - dB + dC) * chaos * 6.2831853 + phaseA);
  curl += sin((nx * ny + nz * 0.5) * chaos * 3.1 - phaseB);
  curl += sin((nx - ny + nz) * chaos * 2.2 + phaseC);
  curl = abs(curl * 0.333);

  var glow = pow(max(0.0, 1.0 - nearest * (2.0 + contrast)), 1.8);
  var filament = pow(curl, contrast);
  var intensity = min(1.0, darkFloor + glow * 0.75 + filament * 0.55);

  // Use curl + glow to blend along cp1<->cp2 (still 0..1, clamp-safe).
  var colorPhase = curl * colorSpread + glow * 0.6;
  colorPhase = colorPhase - floor(colorPhase);
  // Bounce 0..1..0..1 so we sweep back and forth instead of wrapping
  // (which would otherwise jump back to cp1 with a visible discontinuity).
  if (colorPhase > 0.5) colorPhase = 1.0 - (colorPhase - 0.5) * 2.0;
  else                  colorPhase = colorPhase * 2.0;

  var r = (pr1 + (pr2 - pr1) * colorPhase) * intensity;
  var g = (pg1 + (pg2 - pg1) * colorPhase) * intensity;
  var b = (pb1 + (pb2 - pb1) * colorPhase) * intensity;

  var white = min(1.0, pow(glow, 2.4) * whiteCore);
  var uv = min(1.0, (filament * 0.35 + (1.0 - ny) * curl * 0.35) * uvGhost);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
