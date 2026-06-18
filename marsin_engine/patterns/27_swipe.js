/*
  27_swipe.js — ONE unified swipe for the whole rig.

  A single sharp, high-contrast pixel sweeps every fixture group along the axis
  that fits it, all driven by one position. Per pixel we pick the fixture's own
  PHYSICAL-ordinal lane:
    - Pars   (fId 1..4) : X axis, ordinal 0..3   (ord = 4 - fId; fId4 left … fId1 right)
    - Vintage(fId 5..6) : Y axis, ordinal 0..5   (ord = (fId5?9:15) - index; bottom→top, strips mirror)
    - Bars   (fId 7..8) : X axis, ordinal 0..35  (ord = (fId7?33:69) - index; both bars, left→right)
  Any other fixtureId renders black (P0 self-filter).

  Ordinals are the PHYSICAL rank (sorted by nx for X, ny for Y — verified
  monotonic against the model), NOT the LED wiring index. `swipePos` 0..1 maps
  onto each group's own 0..(n-1) range so the swipe stays coherent across the
  rig (left pars + left bar LEDs + bottom vintage heads all light at pos 0).

  CONTRAST: BASE_FLOOR = 0 — un-swept LEDs are TRUE BLACK. Only the swept core
  (+ optional blur / trail) lights, so the rig is high-contrast / high-def. The
  core is always lit, so the fixture is never fully dark.

  CONTROLS
    - localSpeed : auto-animate rate (0 = freeze, position purely by swipePos).
    - swipePos   : 0..1 swipe position (X for pars/bars, Y for vintage). Modulatable.
    - swipeDir   : <0.5 = forward (left→right / bottom→top), >=0.5 = reverse.
    - blur       : soft halo onto neighbour LEDs (0 = hard single pixel = max def).
    - trail      : pixelated fading tail behind the swipe (0 = none).
    - shift      : CALIBRATION. Rotates the swipe start so param-0 lands on the
                   true physical first pixel (per-fixture wrap). 0 = no shift.
    - colorPalette1/2 : strict cp1<->cp2 palette; colour blends along swipePos.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwipePos (swipePos) <- micLow
      MODULATE sliderTrail    (trail)    <- micDomEnergy1
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // auto-animate rate (0 = freeze, drive by swipePos)
export var swipePos = 0.0;     // 0..1 swipe position (X pars/bars, Y vintage)
export var swipeDir = 0.0;     // <0.5 = forward, >=0.5 = reverse
export var blur = 0.0;         // 0 = hard single pixel (max definition)
export var trail = 0.3;        // pixelated fading tail behind the swipe
export var shift = 0.0;        // calibration: rotate swipe start to physical pixel 0

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 (start / cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 (end / amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwipePos(v) { swipePos = v; }
export function sliderSwipeDir(v) { swipeDir = v; }
export function sliderBlur(v) { blur = v; }
export function sliderTrail(v) { trail = v; }
export function sliderShift(v) { shift = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RATE = 0.6;     // sweeps per second at localSpeed = 1.0
var TRAIL_N = 14;       // trail history length (frames) — pixelated tail

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ────────────
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
var phase = 0.0;            // internal auto-animation phase, 0..1
var swipeBase = 0.0;        // resolved 0..1 swipe position this frame (pre-shift)
var posHist = array(14);    // ring buffer of past swipe positions (trail)
var histHead = 0;
var histInit = 0;

// Apply the calibration shift and wrap into [0,1]. Wrap only when the sum runs
// PAST 1.0 (shift>0 rotates the start) so an unshifted pos=1.0 stays the last
// pixel instead of folding back to 0.
function shifted(posv) {
  var pp = posv + shift;
  if (pp > 1.0) pp = pp - 1.0;
  return pp;
}

// Core ordinal for a given swipe position and lane length.
function coreOrdOf(posv, nPix) {
  return floor(shifted(posv) * (nPix - 1.0) + 0.5);
}

// Pixelated fading trail at ordinal `ordv` for a lane of `nPix` LEDs.
function trailAt(ordv, nPix) {
  if (trail <= 0.0) return 0.0;
  var acc = 0.0;
  for (var kk = 1; kk < TRAIL_N; kk++) {
    var idx = histHead - 1 - kk;
    if (idx < 0) idx = idx + TRAIL_N;
    if (coreOrdOf(posHist[idx], nPix) == ordv) {
      var fdamt = trail * (1.0 - kk / TRAIL_N);
      if (fdamt > acc) acc = fdamt;
    }
  }
  return acc;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  phase = phase + dt * localSpeed * MAX_RATE;
  phase = phase - floor(phase);

  var pp = phase + swipePos;
  if (pp > 1.0) pp = pp - floor(pp);
  if (swipeDir >= 0.5) pp = 1.0 - pp;
  swipeBase = pp;

  if (histInit == 0) {
    for (var kk = 0; kk < TRAIL_N; kk++) posHist[kk] = swipeBase;
    histInit = 1;
  }
  posHist[histHead] = swipeBase;
  histHead = histHead + 1;
  if (histHead >= TRAIL_N) histHead = 0;
}

export function render3D(index, x, y, z) {
  // ── Pick this fixture's physical-ordinal lane (axis + length) ───────────
  var nPix = 0;
  var ord = 0;
  if (fixtureId >= 1 && fixtureId <= 4) {
    nPix = 4;  ord = 4 - fixtureId;                       // pars — X
  } else if (fixtureId >= 5 && fixtureId <= 6) {
    nPix = 6;  ord = (fixtureId == 5 ? 9 : 15) - index;   // vintage — Y
  } else if (fixtureId >= 7 && fixtureId <= 8) {
    nPix = 36; ord = (fixtureId == 7 ? 33 : 69) - index;  // bars — X
  } else {
    rgb(0, 0, 0); return;                                 // P0 self-filter
  }

  var centerOrd = shifted(swipeBase) * (nPix - 1.0);
  var coreOrd = floor(centerOrd + 0.5);

  // Sharp single-pixel core (BASE_FLOOR = 0 → un-swept LEDs are true black).
  var bri = 0.0;
  if (ord == coreOrd) bri = 1.0;

  // Blur: soft halo onto neighbour LEDs, radius scaled to the lane length.
  if (blur > 0.0) {
    var bmax = (nPix - 1.0) * 0.18;
    if (bmax < 1.2) bmax = 1.2;
    var radius = blur * bmax;
    var dd = abs(ord - centerOrd);
    if (dd < radius) {
      var bv = 0.5 + 0.5 * cos(dd / radius * PI);
      if (bv > bri) bri = bv;
    }
  }

  // Pixelated trail behind the swipe.
  var tr = trailAt(ord, nPix);
  if (tr > bri) bri = tr;

  // Colour blends cp1->cp2 along the swipe position (shared across the rig).
  var tcol = clamp01(shifted(swipeBase));
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
