/*
  132_tide_pools.js — "Tide Pools"

  The slow INTERIOR piece, and the one composition that uses the Seg1/Seg2 seam
  as a FEATURE rather than hiding it. Water gathers in the upstream half, the
  pool climbs, spills over the seam as a bright cp2 fall, then the downstream
  half drains away. One full cycle is about twenty seconds.

  Every module runs the same cycle at a different phase (`stagger`), so the room
  always has one module filling while another spills — the boiler room never goes
  quiet all at once. Neither segment ever empties completely: a residual pool
  keeps both halves of every line readable.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x, SEAM = the Seg1/Seg2 boundary (world x = 0.5 -> u ~ 0.545),
    lineId from z as in 131_river_run (floor(nz * 6), one id per module). There
    is no direction control: water only ever runs downstream.

AUDIO_MODULATION_V1:
  sliderSpillGain <- micKick range 0.30..1.00 curve pow2 # the kick dumps the pool over the lip
  # STATIC: localSpeed, fill, stagger, whiteFoam, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first. This
// composition has no direction control (single downstream sense).
export var localSpeed = 0.34;
export var fill = 0.62;
export var spillGain = 0.30;
export var stagger = 0.70;
export var whiteFoam = 0.28;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue standing water
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white fall
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFill(v) { fill = v; }
export function sliderSpillGain(v) { spillGain = v; }
export function sliderStagger(v) { stagger = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }

var SEAM = 0.5454545;
var PHASE_WRAP = 10000.0;
var CYCLE_SEC = 20.0;      // one fill/spill/drain cycle at localSpeed 0.5
var LINE_OFFSET = 0.1854;  // per-line phase step — deliberately not 1/6
var FILL_END = 0.62;       // cycle fraction where Seg1 finishes filling
var SPILL_END = 0.78;      // cycle fraction where Seg2 finishes filling
var RESIDUAL1 = 0.14;      // Seg1 never drains to nothing
var RESIDUAL2 = 0.12;      // nor does Seg2

var cyclePhase = 0.0;

var pr1 = 0.0, pg1 = 0.6, pb1 = 0.9;
var pr2 = 1.0, pg2 = 0.8, pb2 = 0.5;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smoothUnit(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

// Line identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the line — floor(nz * 6) clamped to 0..5.
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
// Cheap floor math, no fixture metadata; on a model whose pixels share one z
// this collapses to a single line and the composition still runs.
function lineIdOf(zz) {
  var lid = floor(clamp01(zz) * 6.0);
  if (lid > 5.0) lid = 5.0;
  return lid;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  cyclePhase = cyclePhase + dt * localGain / CYCLE_SEC;
  if (cyclePhase >= PHASE_WRAP) cyclePhase = cyclePhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var lid = lineIdOf(z);

  var p = cyclePhase + lid * LINE_OFFSET * clamp01(stagger);
  p = p - floor(p);

  // Seg1 fills, then dumps over the lip. Seg2 receives, then drains downstream.
  var w1 = RESIDUAL1;
  var w2 = RESIDUAL2;
  if (p < FILL_END) {
    w1 = RESIDUAL1 + (1.0 - RESIDUAL1) * (p / FILL_END);
  } else if (p < SPILL_END) {
    w1 = RESIDUAL1 + (1.0 - RESIDUAL1) * (1.0 - (p - FILL_END) / (SPILL_END - FILL_END));
    w2 = RESIDUAL2 + (1.0 - RESIDUAL2) * ((p - FILL_END) / (SPILL_END - FILL_END));
  } else {
    w2 = RESIDUAL2 + (1.0 - RESIDUAL2) * (1.0 - (p - SPILL_END) / (1.0 - SPILL_END));
  }

  // `fill` is pool depth: how far up the line the water climbs, and how much
  // of the palette's value the standing water carries.
  var depth = 0.34 + clamp01(fill) * 0.66;

  var water = 0.0;
  var edge = 0.0;
  if (u < SEAM) {
    edge = SEAM * depth * w1;
  } else {
    edge = SEAM + (1.0 - SEAM) * depth * w2;
  }
  water = smoothUnit((edge - u) / 0.06);

  // The fall at the lip: a narrow band on the seam, alive only through the
  // spill window of the cycle.
  var lipW = 0.030 + 0.045 * clamp01(spillGain);
  var lipShape = smoothUnit(1.0 - abs(u - SEAM) / lipW);
  var spillWindow = smoothUnit(1.0 - abs(p - 0.70) / 0.14);
  var spill = lipShape * spillWindow * (0.10 + clamp01(spillGain) * 1.10);

  // Drained line is still WET, not dark: a shallow standing sheen keeps every
  // pixel of both segments readable while the pool is somewhere else. Without
  // it the un-pooled stretch drops to the bare strand and reads as a dead tube.
  var wet = 0.065 + 0.045 * wave(u * 1.1180339 + p * 0.70 + lid * 0.3819660);
  var bri = clamp01(wet + water * (0.14 + clamp01(fill) * 0.56) + spill * 0.80);

  // Body stays deep cp1; only the fall carries cp2.
  var mix = clamp01(spill * 1.20);

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  // whiteFoam lives ONLY at the spill lip — nowhere else on the line.
  var foam = clamp01(spill * 2.20) * clamp01(whiteFoam) * 0.90;
  if (foam > 0.0) {
    var mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
    r = r + (mx - r) * foam;
    g = g + (mx - g) * foam;
    b = b + (mx - b) * foam;
  }

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
