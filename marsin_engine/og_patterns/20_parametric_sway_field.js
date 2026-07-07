/*
  20_parametric_sway_field.js
  RGB-only parametric field with dancing attractors. Strict cp1<->cp2 in
  RGB-space (previously used hsv() which could traverse non-palette hues).
*/

export var localSpeed = 0.5;
export var reach = 0.42;
export var focus = 3.0;
export var trailBlend = 0.55;

export var cp1H = 0.58, cp1S = 0.88, cp1V = 1.0;
export var cp2H = 0.78, cp2S = 0.88, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderReach(v) { reach = 0.18 + v * 0.55; }
export function sliderFocus(v) { focus = 1.2 + v * 5.5; }
export function sliderTrailBlend(v) { trailBlend = v; }

// ── Continuity: each attractor harmonic gets its own time() base, scaled at
//   call time, so the angle is always time(s)*TAU with NO further fractional
//   multiplier on the wrapping phase. sin(time(s)*TAU) is C0-continuous across
//   the 1→0 wrap because sin(0)=sin(TAU). The previous form (p = time*TAU then
//   sin(p*1.37+0.8), etc.) jumped every period: sin(2π*1.37+0.8)→sin(0.8).
var pA = 0.0, pB = 0.0, pC = 0.0, pD = 0.0, pE = 0.0, pF = 0.0;
var qA = 0.0, qB = 0.0, qC = 0.0, qD = 0.0, qE = 0.0;
var currentScale = 0.15;

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
  currentScale = 0.15 / localMultiplier;
  // Each harmonic uses its own time() base scaled here, so the per-harmonic
  // angle is exactly time(s_k)*TAU — wraps cleanly with no fractional jump.
  // Scale for k× a base time(s0) is s0/k (smaller scale = faster wrap).
  // Bases: p0 = time(currentScale), q0 = time(currentScale * 0.53).
  pA = time(currentScale) * 6.2831853;              // was sin(p)         — k=1
  pB = time(currentScale / 1.37) * 6.2831853;       // was sin(p*1.37+..) — k=1.37
  pC = time(currentScale / 0.73) * 6.2831853;       // was sin(p*0.73+..) — k=0.73
  pD = time(currentScale / 1.91) * 6.2831853;       // was sin(p*1.91-..) — k=1.91
  pE = time(currentScale / 1.21) * 6.2831853;       // was sin(p*1.21-..) — k=1.21
  pF = time(currentScale / 0.61) * 6.2831853;       // was sin(p*0.61+..) — k=0.61
  qA = time(currentScale * 0.53) * 6.2831853;       // base q             — k=1
  qB = time(currentScale * 0.53 / 0.7) * 6.2831853; // was cos(q*0.7)     — k=0.7
  qC = time(currentScale * 0.53 / 1.9) * 6.2831853; // was sin(q*1.9)     — k=1.9
  qD = time(currentScale * 0.53 / 0.5) * 6.2831853; // was cos(q*0.5)     — k=0.5
  qE = time(currentScale * 0.53 / 0.4) * 6.2831853; // was q*0.4 in mix
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ax = 0.5 + reach * sin(pA) * cos(qB);
  var ay = 0.5 + reach * sin(pB + 0.8) * 0.62 + sin(qC) * 0.09;

  var bx = 0.5 + reach * sin(pC + 2.1) * 0.75;
  var by = 0.5 + reach * sin(pD - qE) * 0.55;

  var cx = 0.5 + reach * sin(pE - 1.4) * cos(qD) * 0.8;
  var cy = 0.5 + reach * sin(pF + qA + 1.2) * 0.58;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var nearest = min(dA, min(dB, dC));
  var glow = pow(max(0.0, 1.0 - nearest * focus), 2.0);

  var trail = wave((dA - dB + dC) * 3.0 + time(currentScale * 0.67));
  var v = min(1.0, glow + trail * trailBlend * 0.22);

  var mixVal = wave((dB - dA) * 2.2 + nx * 0.5 + time(currentScale * 0.29));

  // Strict RGB lerp — no hsv() interpolation, no hue drift past cp1/cp2.
  var r = (pr1 + (pr2 - pr1) * mixVal) * v;
  var g = (pg1 + (pg2 - pg1) * mixVal) * v;
  var b = (pb1 + (pb2 - pb1) * mixVal) * v;

  rgb(r, g, b);
}
