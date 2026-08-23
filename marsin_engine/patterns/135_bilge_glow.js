/*
  135_bilge_glow.js — "Bilge Glow"

  Water at rest in a dark hold. Two slow wave() products on irrational ratios
  beat against each other to give a caustic shimmer in deep cp1, with rare warm
  cp2 glints crossing it. There is almost no directional motion — this is the
  "lights on, nobody dancing" look, and the filler the shuffle drops into when
  the room needs to breathe.

  Per-line variation is a phase offset and nothing else: all six modules share
  one temperature, one depth and one pace.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x, lineId from z as in 131_river_run (floor(nz * 6), one id per
    module). No seam feature, no direction: the seam is invisible here, which
    is correct for still water.

AUDIO_MODULATION_V1:
  sliderLevel <- micLow range 0.25..0.50 curve ease # the room breathes with the low band, nothing more
  # STATIC: localSpeed, shimmer, glintRate, whiteFoam, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first. This
// composition has no direction control (still water).
export var localSpeed = 0.28;
export var level = 0.35;
export var shimmer = 0.55;
export var glintRate = 0.30;
export var whiteFoam = 0.22;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue hold water
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white glint
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderGlintRate(v) { glintRate = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }

var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660;
var PHASE_WRAP = 10000.0;
var BASE_RATE = 0.0500;    // caustic drift cycles/sec at localSpeed 0.5

var shimPhase = 0.0;

var pr1 = 0.0, pg1 = 0.6, pb1 = 0.9;
var pr2 = 1.0, pg2 = 0.8, pb2 = 0.5;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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
  shimPhase = shimPhase + dt * BASE_RATE * localGain;
  if (shimPhase >= PHASE_WRAP) shimPhase = shimPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var lid = lineIdOf(z);
  var ph = lid * GOLDEN_ANGLE;

  var sh = clamp01(shimmer);

  // Two counter-drifting waves on irrational spatial ratios; their PRODUCT is
  // the caustic — bright where both crest, dark almost everywhere else.
  var c1 = wave(u * (1.2360679 + sh * 2.40) + shimPhase + ph);
  var c2 = wave(u * (0.7861513 + sh * 1.60) - shimPhase * SQRT2 * 0.6180339 + ph * PHI);
  var caustic = pow(clamp01(c1 * c2), 1.0 + sh * 1.40);

  var bri = 0.03 + clamp01(level) * (0.10 + caustic * 0.62);

  // Glints: a much finer wave product, thresholded high so it fires rarely.
  // glintRate raises both how often and how fast they cross.
  var gr = clamp01(glintRate);
  var g1 = wave(u * 9.4247780 + shimPhase * 3.70 * (0.30 + gr) + ph * 2.0);
  var g2 = wave(u * 6.8541020 - shimPhase * 2.30 * (0.30 + gr) + ph * SQRT2);
  var thr = 0.960 - gr * 0.22;
  var glint = clamp01((g1 * g2 - thr) / (1.0 - thr));
  glint = glint * glint;

  bri = clamp01(bri + glint * 0.55);

  var mix = clamp01(glint * 1.20 + caustic * 0.10);

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  // whiteFoam rides the glints only — still water carries no crest.
  var foam = clamp01(glint * 2.40) * clamp01(whiteFoam) * 0.90;
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
