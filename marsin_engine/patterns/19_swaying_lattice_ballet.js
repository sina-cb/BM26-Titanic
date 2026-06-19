/*
  19_swaying_lattice_ballet.js
  A regular grid of glowing lattice nodes that sways in counter-phase along two
  axes — like a corps de ballet bowing left while the row behind bows right. Two
  decorrelated lattice fields interleave; a slow Lissajous pivot walks the sway
  center so the pattern never visibly repeats.

  IDENTITY (preserved): the counter-phase "ballet bow" of two interleaved lattice
  fields, the wandering Lissajous pivot, teal->violet palette. Upgrades: 0..1
  coords used directly (no re-normalize), identity-slider convention, audio
  reactivity, guarded direction with smooth autonomous reversal.

  NON-REPEATING MATH
    Two sway phases accumulate by delta at an irrational ratio (1 : 1.382) so the
    lattices never re-align; the Lissajous pivot uses two more incommensurate
    rates (0.27 : 0.31). All phases accumulate continuously and wrap at a large
    multiple of TAU (PHASE_WRAP) far from any in-frame use, so no seam (skill 12
    §7). The sway/pivot are read as sin/cos of these phases (C0 across wrap).
    Autonomous direction: a smooth rate sway (0.4 + 0.6*cos(slowClock))*dirSign
    eases the sway through reversals on a slow incommensurate clock — never a hard
    sign flip — so the bow is not one-way and never seams.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick       <- micKick range 0.00..1.00 curve linear # beat pop on the nodes
    sliderRadius     <- micFlux range 0.40..0.90 curve linear # sway radius / bow travel
    sliderDetail     <- micHigh range 0.30..0.90 curve linear # node sharpness / sparkle
    sliderWhiteLevel <- micLow  range 0.30..1.00 curve linear # white keep on crests (bass)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve linear # white accent pop (beat)
  # Static (not audio-mapped): localSpeed, direction, latticeScale, counterPhase,
  # floorLevel, whiteSpread, colorPalette1/2 — operator-set, not modulated.
  White is ADDITIVE on the lattice nodes: a controllable white ACCENT lights the
  brightest node cores as the corps reaches each sway CREST (peak |sway|), so the
  bow tips flash white at the apex. whiteSpread biases the accent toward the
  vintage heads (sectionId==2) vs. the whole rig. White never washes the rig.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;     // sway rate (0 still creeps, 1 ~4x faster)
export var direction = 0.5;      // 0.5 balanced; <0.5 reverse, >0.5 forward (guarded)
export var level = 0.5;          // PRIMARY audio: overall brightness (micLow); mid = calm-but-lit
export var kick = 0.0;           // audio: kick brightness pop (micKick); 0 = no pop until beat
export var radius = 0.5;         // audio: sway radius / how far the corps bows (micFlux)
export var detail = 0.5;         // audio: node sharpness / sparkle (micHigh)
export var latticeScale = 0.5;   // grid density (0..1; scaled in render)
export var counterPhase = 0.5;   // how strongly field B opposes field A (0..1)
export var floorLevel = 0.5;     // base glow floor (0..1; scaled in render)
export var whiteLevel = 0.5;     // WHITE: overall white amount on crest accents (audio: micLow)
export var whiteKick = 0.0;      // WHITE: white accent pop on the sway crests (audio: micKick)
export var whiteSpread = 0.5;    // WHITE: bias toward vintage heads (0) vs. whole rig (1)

export var cp1H = 0.55, cp1S = 0.92, cp1V = 1.0; // base lattice (teal/blue)
export var cp2H = 0.84, cp2S = 0.92, cp2V = 1.0; // accent (violet/magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderLatticeScale(v) { latticeScale = v; }
export function sliderCounterPhase(v) { counterPhase = v; }
export function sliderFloorLevel(v) { floorLevel = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderWhiteSpread(v) { whiteSpread = v; }

var phaseA = 0.0;        // sway phase A (radians, accumulated)
var phaseB = 0.0;        // sway phase B
var pivotA = 0.0;        // Lissajous pivot phase A
var pivotB = 0.0;        // Lissajous pivot phase B
var breathPhase = 0.0;   // slow vertical breath
var autoClock = 0.0;     // slow clock for autonomous reversal
var dirSign = 1.0;
var swayX = 0.0;
var swayY = 0.0;
var pivotX = 0.0;
var pivotY = 0.0;
var liveScale = 6.0;
var liveSoft = 2.4;
var liveSway = 0.35;
var crestEnv = 0.0;    // 0..1 envelope: how close the sway is to a CREST (peak |sway|)
var PHASE_WRAP = 62831.853; // 10000*TAU

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
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  dirSign = direction;
  if (dirSign >= 0.0 && dirSign < 0.06) dirSign = 0.06;
  else if (dirSign < 0.0 && dirSign > -0.06) dirSign = -0.06;

  // Autonomous reversal: smooth rate sway easing through zero (no hard flip).
  autoClock = autoClock + dt * 0.057 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var rate = (0.4 + 0.6 * cos(autoClock)) * dirSign * localMultiplier;

  // Two sway phases at an irrational ratio so lattices never re-align.
  phaseA = phaseA + dt * 0.69 * rate;       if (phaseA >= PHASE_WRAP) phaseA -= PHASE_WRAP; else if (phaseA <= -PHASE_WRAP) phaseA += PHASE_WRAP;
  phaseB = phaseB + dt * 0.69 * 1.382 * rate; if (phaseB >= PHASE_WRAP) phaseB -= PHASE_WRAP; else if (phaseB <= -PHASE_WRAP) phaseB += PHASE_WRAP;
  // Lissajous pivot walks the sway center on its own incommensurate rates.
  pivotA = pivotA + dt * 0.69 * 0.27 * rate; if (pivotA >= PHASE_WRAP) pivotA -= PHASE_WRAP; else if (pivotA <= -PHASE_WRAP) pivotA += PHASE_WRAP;
  pivotB = pivotB + dt * 0.69 * 0.31 * rate; if (pivotB >= PHASE_WRAP) pivotB -= PHASE_WRAP; else if (pivotB <= -PHASE_WRAP) pivotB += PHASE_WRAP;
  breathPhase = breathPhase + dt * 0.34 * localMultiplier * dirSign; if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP; else if (breathPhase <= -PHASE_WRAP) breathPhase += PHASE_WRAP;

  liveScale = 2.5 + latticeScale * 11.0;       // 0..1 -> 2.5..13.5
  liveSoft = 1.2 + detail * 4.5;               // node crispness from micHigh
  liveSway = (0.10 + radius * 0.6);            // sway radius from micFlux

  // Ballet bow oscillations.
  swayX = sin(phaseA) * liveSway;
  swayY = sin(phaseB * 0.83) * liveSway * 0.65;
  pivotX = sin(pivotA) * 0.12;
  pivotY = cos(pivotB) * 0.10;

  // Sway CREST envelope: peaks when the bow reaches its turning point (|sin| ~ 1
  // on phaseA). sin^2 of the phase gives a smooth 0..1 that is high at each crest
  // of the swing and low at mid-swing — the white accents ride this.
  var sA = sin(phaseA);
  crestEnv = sA * sA;        // 0..1, peaks at every sway extreme

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamped). No re-normalize.
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // Lattice A — sways left/right with phaseA, walks with pivot.
  var uxA = (nx - 0.5 - pivotX) * liveScale + swayX;
  var uyA = (ny - 0.5 - pivotY) * liveScale * 0.78 - swayY;
  var nodeA = wave(uxA) * wave(uyA);

  // Lattice B — counter-phase (offset by half-cell), sways opposite.
  var uxB = (nx - 0.5 + pivotX) * liveScale - swayX * counterPhase;
  var uyB = (ny - 0.5 + pivotY) * liveScale * 0.78 + swayY * counterPhase;
  var nodeB = wave(uxB + 0.5) * wave(uyB + 0.5);

  // Sharpen nodes so the grid reads as dots, not a wash.
  nodeA = pow(max(0.0, nodeA), liveSoft);
  nodeB = pow(max(0.0, nodeB), liveSoft);

  // Counter-phase interleave: pixels favour A vs B by alternating cell parity —
  // the "two rows bowing opposite" feel.
  var bowMask = wave((nx + ny) * liveScale * 0.5);
  var lattice = nodeA * bowMask + nodeB * (1.0 - bowMask);

  // Slow vertical breath so the corps de ballet breathes as one.
  var breath = 0.85 + sin(breathPhase + ny * 1.8) * 0.15;

  // Base floor keeps silence calm-but-visible; nodes sit on top. Kept small so
  // the negative space between nodes reads near-black (high-def contrast).
  var floorK = floorLevel * 0.14;
  var bri = floorK + lattice * 1.05 * breath;

  // PRIMARY: overall brightness from micLow. level^2 makes the bass the dominant
  // brightness driver (corr>=0.5); the lattice shapes WHERE, the bass HOW BRIGHT.
  // level^2 keeps micLow the dominant brightness driver (PRIMARY corr) while the
  // lifted curve makes the mid default read well-lit: 0 -> dim, 0.5 -> bright, 1 -> full.
  var levelGain = 0.45 + level * (1.9 + level * 1.7); // 0:0.45 0.5:1.83 1:4.05
  var pop = kick * 0.55 * lattice;     // kick pop only on lit nodes
  bri = min(1.0, (bri + pop) * levelGain);

  // Palette mix follows which lattice dominates — A is cp1, B is cp2.
  var total = nodeA + nodeB + 0.0001;
  var tVal = nodeB / total;
  tVal = max(0.0, min(1.0, tVal));

  var r = (pr1 + (pr2 - pr1) * tVal) * bri;
  var g = (pg1 + (pg2 - pg1) * tVal) * bri;
  var b = (pb1 + (pb2 - pb1) * tVal) * bri;

  // WHITE ACCENT on the sway CREST — additive over the cp1/cp2 lattice. Only the
  // brightest node CORES whiten, and only as the corps reaches a crest (crestEnv
  // peaks at each swing extreme). whiteKick pops it on the beat; whiteLevel sets
  // the amount; whiteSpread biases toward the vintage heads (sectionId==2) vs.
  // the whole rig. Gated by lattice so negative space never whitens (no wash).
  var nodeCore = max(0.0, min(1.0, lattice));
  var wAmt = max(0.0, min(1.0, whiteLevel));
  var wKick = max(0.0, min(1.0, whiteKick));
  var crest = 0.35 + 0.65 * crestEnv;                // crest-weighted (always some)
  var sect = 0.7 + 0.5 * whiteSpread;                // whole-rig reach grows w/ spread
  if (sectionId == 2) sect = sect + 0.5 * (1.0 - whiteSpread); // vintage emphasis
  var white = nodeCore * crest * (0.4 + 1.0 * wAmt) * (0.5 + wKick * 1.0) * sect * (0.5 + level);
  white = max(0.0, min(1.0, white));

  rgbwau(max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)), white, 0.0, 0.0);
}
