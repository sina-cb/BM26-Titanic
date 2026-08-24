/*
  133_counter_current.js — "Counter Current"

  Six modules that ignore each other. Odd lineIds flow against the even ones,
  the two controller halves of the room hold different hues and different speeds
  (ratio PHI), and comet-like bright DRIFTS ride each current with a soft tail
  behind them. Nothing lines up, which is the point: the boiler room reads as a
  tangle of separate streams rather than one shared sweep.

  `cohesion` is the escape hatch — turn it up and every line converges on one
  direction, one speed and one colour.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x, lineId = floor(nz * 6) clamped to 0..5 (one id per module, the six
    lines being parallel and evenly spread along z). wall = lineId >= 3, i.e.
    0 = BoilderRoom-A (modules 1-3), 1 = BoilderRoom-B (modules 4-6). Drift spawn
    phases are a deterministic irrational hash of lineId and drift ordinal —
    never random, so every model and every boot shows the same river.

AUDIO_MODULATION_V1:
  sliderDensity <- micHigh range 0.30..0.90 curve linear # the high band adds drifts to every line
  # STATIC: localSpeed, direction, tail, cohesion, whiteFoam, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed first, Direction second.
export var localSpeed = 0.46;
export var direction = 0.72;
export var density = 0.45;
export var tail = 0.55;
export var cohesion = 0.30;
export var whiteFoam = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // modules 1-3 — deep teal-blue
export var cp2H = 0.85, cp2S = 1.00, cp2V = 1.00; // modules 4-6 — magenta
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderDensity(v) { density = v; }
export function sliderTail(v) { tail = v; }
export function sliderCohesion(v) { cohesion = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }

var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660;
var PHASE_WRAP = 10000.0;
var BASE_RATE = 0.1149;    // drift laps/sec on the slow wall at localSpeed 0.5
var MIN_DRIFTS = 3;
var MAX_DRIFTS = 5;
var HEAD_W = 0.014;        // drift core half-width in u
var COH_UNISON = 0.62;     // cohesion above which every line takes one heading

var driftPhase = 0.0;

var pr1 = 0.0, pg1 = 0.6, pb1 = 0.9;
var pr2 = 1.0, pg2 = 0.0, pb2 = 0.8;

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
  driftPhase = driftPhase + dt * BASE_RATE * localGain;
  if (driftPhase >= PHASE_WRAP) driftPhase = driftPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var lid = lineIdOf(z);
  // Wall = which controller owns the module: 0 = BoilderRoom-A (modules 1-3),
  // 1 = BoilderRoom-B (modules 4-6). Same split the lineId already encodes.
  var wall = 0.0;
  if (lid >= 3.0) wall = 1.0;

  var coh = clamp01(cohesion);

  // The unison heading the whole rig converges on at high cohesion; direction is
  // a genuine reversal of it, and it flips the odd/even assignment with it.
  // The heading SNAPS rather than blending: a blended heading would cross zero
  // mid-range and leave the odd lines stalled, which is not a river.
  var base = 1.0;
  if (clamp01(direction) < 0.5) base = -1.0;
  var odd = lid - floor(lid / 2.0) * 2.0;
  var sgn = base;
  if (odd > 0.5 && coh < COH_UNISON) sgn = 0.0 - base;

  // Walls run at a PHI speed ratio until cohesion pulls them together.
  var spd = 1.0;
  if (wall > 0.5) spd = PHI;
  spd = spd + (1.0 - spd) * coh;

  // Modules 1-3 wear cp1, modules 4-6 cp2; cohesion collapses both onto cp1.
  var hueMix = wall * (1.0 - coh);

  var n = MIN_DRIFTS + floor(clamp01(density) * (MAX_DRIFTS - MIN_DRIFTS + 0.999));
  var tailLen = 0.055 + clamp01(tail) * 0.300;

  // Comet drifts: the brightest one wins this pixel. Deterministic irrational
  // spawn phases keep every drift at a fixed offset on its own line forever.
  var best = 0.0;
  for (var k = 0; k < n; k++) {
    var seed = lid * GOLDEN_ANGLE + k * (SQRT2 - 1.0);
    var pos = driftPhase * spd * sgn + seed;
    pos = pos - floor(pos);
    var behind = (pos - u) * sgn;
    behind = behind - floor(behind);
    var e = 0.0;
    if (behind < tailLen) {
      e = 1.0 - behind / tailLen;
      e = e * e;
    }
    if (behind < HEAD_W) e = 1.0;
    if (e > best) best = e;
  }

  // Floor current so the line never goes dark between drifts.
  var floorWave = wave(u * 2.2360679 - driftPhase * spd * sgn * 0.62
                     + lid * GOLDEN_ANGLE * (1.0 - coh));
  var bri = clamp01(0.025 + floorWave * 0.10 + best * 0.84);

  var mix = clamp01(hueMix);

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  // whiteFoam brightens only the drift cores toward white.
  var foam = clamp01((best - 0.74) / 0.26) * clamp01(whiteFoam) * 0.90;
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
