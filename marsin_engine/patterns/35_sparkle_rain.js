/*
  35_sparkle_rain.js — SPARKLE RAIN (high-def, audio-reactive).

  Amalgamates 13_sparkle (crisp deterministic per-pixel glints), 07_shimmer
  (faint living base) and 24_chromatic_murmuration (strict cp1<->cp2 RGB blend).

  Dense, fine, crisp glints fall — they DRIFT DOWNWARD in y over time — on a
  near-black field. Each glint is a deterministic single-pixel threshold test
  (like 13_sparkle): the sparkle "field" is sampled at a y-coordinate that
  scrolls upward with time, so the lit cells appear to rain DOWN the rig. No
  blur, no smoothing — glints stay crisp single points.

  Glint DENSITY and BRIGHTNESS scale with `density` (driven by micHigh): a
  hat/cymbal hit makes the rain shimmer dense and bright; calm = a few slow
  faint drops. A minimal time-based base keeps the rig readable when silent
  (mission-critical visibility) without ever going fully black.

  Palette: cp1 = cool white/blue glint, cp2 = pale gold glint; sparkles blend
  cp1<->cp2 per pixel. Crisp white core is emitted on the W channel via rgbwau.

  CONTROLS (UI order = declaration order)
    - localSpeed : overall animation rate (sparkle churn + fall).
    - density    : how many glints are lit (highs → more). Modulatable.
    - fall       : downward fall speed of the rain.
    - intensity  : glint brightness.
    - base       : faint base floor (never fully black).
    - colorPalette1/2 : cp1 cool white/blue, cp2 pale gold.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderDensity (density) <- micHigh
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // overall animation rate
export var density = 0.4;      // glint count 0..1 (highs -> more). Modulatable.
export var fall = 0.5;         // downward fall speed
export var intensity = 0.85;   // glint brightness
export var base = 0.12;        // faint base floor (never fully black)

export var cp1H = 0.58, cp1S = 0.35, cp1V = 1.0; // cool white / blue glint
export var cp2H = 0.12, cp2S = 0.45, cp2V = 1.0; // pale gold glint
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = v; }       // micHigh maps here
export function sliderFall(v) { fall = v; }
export function sliderIntensity(v) { intensity = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var FALL_MAX = 0.9;   // y-cells per second of scroll at fall = 1.0
var CHURN_MAX = 0.6;  // sparkle re-roll rate at localSpeed = 1.0
var GRID_Y = 16.0;    // vertical quantisation of the falling rain field

// ── Palette RGB cache (strict cp1<->cp2 blending) ───────────────────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var fallPhase = 0.0;  // accumulated downward scroll (cells); the rain falls
var tChurn = 0.0;     // sparkle re-roll time term
var tBase = 0.0;      // slow base breathing time term

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Rain scrolls so cells appear to move DOWN (y decreasing) over time.
  fallPhase = fallPhase + dt * (0.15 + fall * FALL_MAX) * localSpeed;
  if (fallPhase > 100000.0) fallPhase = fallPhase - 100000.0; // bound growth

  tChurn = time(0.05 / (0.25 + localSpeed * CHURN_MAX));
  tBase = time(0.4);
}

export function render3D(index, x, y, z) {
  // Quantise into a falling vertical grid cell. Adding fallPhase to the y
  // sample point scrolls the field upward, so lit cells drift DOWNWARD.
  var cellF = y * GRID_Y + fallPhase;
  var cellY = floor(cellF);

  // Deterministic per-cell, per-pixel-column sparkle hash (crisp, single pixel).
  // Mix in index + z so neighbouring pixels do not all light together, and a
  // churn term so glints twinkle/re-roll over time.
  var seed = index * 12.9898 + cellY * 78.233 + z * 37.719 + tChurn * 53.41;
  var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
  spk = spk * spk;                 // 0..1, biased low → sparse
  spk = spk * spk;                 // sharpen → crisp glints

  // Density (driven by micHigh) lowers the threshold → more cells light, and
  // also lifts brightness so highs make the whole field shimmer brighter.
  var threshold = 0.92 - density * 0.66;

  var glint = 0.0;
  if (spk > threshold) {
    var amt = (spk - threshold) / (1.0 - threshold + 0.0001);
    amt = clamp01(amt);
    glint = amt * (0.4 + intensity * 0.6) * (0.3 + density * 0.7);
    glint = clamp01(glint);
  }

  // Faint living base so the rig never reads fully black (mission-critical).
  // COORD-DRIVEN (y only) so EVERY pixel on ANY rig lights from coordinates
  // alone — sectionId is an OPTIONAL ADDITIVE accent on top, never a gate (it
  // is 0 on titanic/dome/logsville so the base must stand on its own there).
  // Floor lifted enough to clear the LIT threshold across the whole rig.
  var baseV = base * (0.55 + 0.45 * wave(tBase + y * 0.3)) * 0.55;
  // Section accent: a faint per-section tint shift, ADDITIVE (test_bench only —
  // sectionId is 0 elsewhere so this contributes 0 there, base still lights all).
  if (sectionId > 0) {
    baseV = baseV + base * 0.10 * (0.5 + 0.5 * wave(tBase + sectionId * 0.13));
  }

  // Per-pixel palette blend: a second deterministic draw biases each glint
  // toward cp1 (cool white) or cp2 (pale gold).
  var tColRaw = sin(seed * 0.531 + index * 0.27);
  var tCol = clamp01(tColRaw * 0.5 + 0.5);

  var v = baseV;
  if (glint > v) v = glint;

  var rr = (pr1 + (pr2 - pr1) * tCol) * v;
  var gg = (pg1 + (pg2 - pg1) * tCol) * v;
  var bb = (pb1 + (pb2 - pb1) * tCol) * v;

  // Crisp white core on the W channel for the glints only (not the base).
  var ww = glint * 0.6;

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), 0.0, 0.0);
}
