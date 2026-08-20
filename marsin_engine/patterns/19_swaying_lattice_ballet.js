/*
  19_swaying_lattice_ballet.js
  A regular grid of glowing lattice nodes that sways in counter-phase along two
  axes — like a corps de ballet bowing left while the row behind bows right. Two
  decorrelated lattice fields interleave; a slow Lissajous pivot walks the sway
  center so the pattern never visibly repeats.

  IDENTITY (preserved): the counter-phase "ballet bow" of two interleaved lattice
  fields, the wandering Lissajous pivot, teal->violet palette. Upgrades: 0..1
  coords used directly (no re-normalize), identity-slider convention, audio
  reactivity, and a fixed forward ambient drift.

  IDENTITY INSTRUMENT
    TE signs remain legible on a firm RGB floor while two letter-path cohorts
    bow in counter-phase around the same wandering pivot as the wider ballet.
    XYZ gives the bow spatial depth and pixelLocalIndex follows each sign's
    letter choreography; this is living lattice motion, not a flat sign wash.

  NON-REPEATING MATH
    Two sway phases accumulate by delta at an irrational ratio (1 : 1.382) so the
    lattices never re-align; the Lissajous pivot uses two more incommensurate
    rates (0.27 : 0.31). All phases accumulate continuously and wrap at a large
    multiple of TAU (PHASE_WRAP) far from any in-frame use, so no seam (skill 12
    §7). The sway/pivot are read as sin/cos of these phases (C0 across wrap).
    Autonomous sway: a smooth rate envelope (0.6 + 0.4*cos(slowClock)) on a slow
    incommensurate clock eases the bow between a slow and a faster swing. The
    envelope keeps a positive floor so the bow never freezes mid-swing (an
    earlier zero-crossing envelope stalled the whole corps for ~3s per cycle).

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick       <- micKick range 0.00..1.00 curve linear # beat pop on the nodes
    sliderRadius     <- micFlux range 0.40..0.90 curve linear # sway radius / bow travel
    sliderDetail     <- micHigh range 0.30..0.90 curve linear # node sharpness / sparkle
    sliderWhiteLevel <- micLow  range 0.30..1.00 curve linear # white keep on crests (bass)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve linear # white accent pop (beat)
  # Static (not audio-mapped): localSpeed, latticeScale, counterPhase,
  # floorLevel, whiteSpread, colorPalette1/2 — operator-set, not modulated.
  White is ADDITIVE on the lattice nodes: a controllable white ACCENT lights the
  brightest node cores as the corps reaches each sway CREST (peak |sway|), so the
  bow tips flash white at the apex. whiteSpread expands the accent from
  portable Vintage/Jewelry capability toward the whole rig.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
// Optional accent role. Self-declaring its canonical append-only id keeps the
// pattern compiling unchanged on scenes with no TE signs.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;     // sway rate (0 still creeps, 1 ~4x faster)
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

export var cp1H = 0.58, cp1S = 0.92, cp1V = 1.0; // base lattice (teal/blue)
export var cp2H = 0.84, cp2S = 0.92, cp2V = 1.0; // accent (violet/magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
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
var autoClock = 0.0;     // slow clock for the cadence envelope
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

  // Autonomous sway: a smooth rate envelope on a slow incommensurate clock eases
  // the bow between a slow and a faster swing. The envelope keeps a positive
  // floor (0.20..1.00) so the bow NEVER freezes mid-swing — an earlier
  // (0.4 + 0.6*cos) envelope reached zero at cos=-0.667 and stalled every sway/
  // pivot phase (all multiply by `rate`) for ~3s on each cycle, which the
  // discontinuity detector flagged (a long stall plus breath-only residual pops).
  autoClock = autoClock + dt * 0.057 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  // Fixed forward (+1) motion keeps localSpeed as the sole rate control. The 4.77522
  // coefficient preserves the current Titanic ambient cadence (0.76 * TAU).
  var rate = (0.6 + 0.4 * cos(autoClock)) * localMultiplier * 4.77522;

  // Two sway phases at an irrational ratio so lattices never re-align.
  phaseA = phaseA + dt * 0.69 * rate;       if (phaseA >= PHASE_WRAP) phaseA -= PHASE_WRAP; else if (phaseA <= -PHASE_WRAP) phaseA += PHASE_WRAP;
  phaseB = phaseB + dt * 0.69 * 1.382 * rate; if (phaseB >= PHASE_WRAP) phaseB -= PHASE_WRAP; else if (phaseB <= -PHASE_WRAP) phaseB += PHASE_WRAP;
  // Lissajous pivot walks the sway center on its own incommensurate rates.
  pivotA = pivotA + dt * 0.69 * 0.27 * rate; if (pivotA >= PHASE_WRAP) pivotA -= PHASE_WRAP; else if (pivotA <= -PHASE_WRAP) pivotA += PHASE_WRAP;
  pivotB = pivotB + dt * 0.69 * 0.31 * rate; if (pivotB >= PHASE_WRAP) pivotB -= PHASE_WRAP; else if (pivotB <= -PHASE_WRAP) pivotB += PHASE_WRAP;
  breathPhase = breathPhase + dt * 0.34 * localMultiplier * 6.2831853;
  if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP;

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
  var nz = max(0.0, min(1.0, z));

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
  var floorK = floorLevel * 0.05;
  var bri = floorK + lattice * 1.05 * breath;
  var signPalette = 0.0;

  if (fixtureType == FIX_TE_SIGN) {
    // Two woven lattice families bow in counterphase through the XYZ letters.
    // Each family is the product of two oblique threads; their intersections
    // form dancing nodes while the wandering pivot shifts which corps leads.
    // Continuous phase/coordinate math keeps the choreography smooth.
    var signPath = pixelLocalIndex * 0.01351351351;
    var signSpace = nx * 0.41 + ny * 0.37 + nz * 0.22;
    var bowA = sin(phaseA + signPath * PI2) * liveSway * 0.46;
    var bowB = sin(phaseB * 0.83 - signPath * PI2) * liveSway * 0.46;
    var weaveAU = wave(signPath * 3.1 + signSpace * 1.7
                     + bowA + pivotX * 1.8);
    var weaveAV = wave(signSpace * 4.3 - signPath * 1.2
                     - bowA * 0.73 + pivotY * 2.1);
    var weaveBU = wave((1.0 - signPath) * 3.1 - signSpace * 1.5
                     + bowB - pivotX * 1.8 + 0.5);
    var weaveBV = wave(signSpace * 4.3 + signPath * 1.4
                     - bowB * 0.73 - pivotY * 2.1 + 0.5);
    var signSoft = 1.35 + detail * 2.2;
    var corpsA = pow(weaveAU * weaveAV, signSoft);
    var corpsB = pow(weaveBU * weaveBV, signSoft);
    var cohort = wave(signPath * 1.7 + nx * 0.17 + nz * 0.13
                    + pivotX - pivotY);
    var signBow = corpsA * cohort + corpsB * (1.0 - cohort);
    var intersection = pow(max(0.0, min(1.0,
      corpsA * corpsB * 3.2)), 0.72);
    signBow = max(0.0, min(1.0, signBow * 0.84 + intersection * 0.34));
    lattice = signBow;
    bri = 0.32 + signBow * 0.34 + intersection * 0.10
        + breath * 0.03;
    signPalette = max(0.0, min(1.0,
      0.14 + signSpace * 0.46 + (corpsB - corpsA) * 0.31
      + intersection * 0.16));
  }

  // PRIMARY: overall brightness from micLow. level^2 makes the bass the dominant
  // brightness driver (corr>=0.5); the lattice shapes WHERE, the bass HOW BRIGHT.
  // The static term is kept low so the default look matches the og (no static
  // wash): at level=0.5 the gain is ~1.0 (og parity), bass still drives the punch.
  var levelGain = 0.16 + level * (1.0 + level * 1.7); // 0:0.16 0.5:1.09 1:2.86
  var pop = kick * 0.55 * lattice;     // kick pop only on lit nodes
  bri = min(1.0, (bri + pop) * levelGain);

  // Palette mix follows which lattice dominates — A is cp1, B is cp2.
  var total = nodeA + nodeB + 0.0001;
  var tVal = nodeB / total;
  tVal = max(0.0, min(1.0, tVal));
  if (fixtureType == FIX_TE_SIGN) tVal = signPalette;

  var r = (pr1 + (pr2 - pr1) * tVal) * bri;
  var g = (pg1 + (pg2 - pg1) * tVal) * bri;
  var b = (pb1 + (pb2 - pb1) * tVal) * bri;

  // WHITE ACCENT on the sway CREST — additive over the cp1/cp2 lattice. Only the
  // brightest node CORES whiten, and only as the corps reaches a crest (crestEnv
  // peaks at each swing extreme). whiteKick pops it on the beat; whiteLevel sets
  // the amount; whiteSpread biases toward the Vintage rails vs.
  // the whole rig. Gated by lattice so negative space never whitens (no wash).
  var nodeCore = max(0.0, min(1.0, lattice));
  var wAmt = max(0.0, min(1.0, whiteLevel));
  var wKick = max(0.0, min(1.0, whiteKick));
  var crest = 0.35 + 0.65 * crestEnv;                // crest-weighted (always some)
  var sect = 0.7 + 0.5 * whiteSpread;                // whole-rig reach grows w/ spread
  if (fixtureType == FIX_TE_SIGN) sect = 0.10 + 0.20 * whiteSpread;
  else if (fixtureType == FIX_VINTAGE_6) sect = sect + 0.5 * (1.0 - whiteSpread);
  var white = nodeCore * crest * (0.4 + 1.0 * wAmt) * (0.5 + wKick * 1.0) * sect * (0.5 + level);
  white = max(0.0, min(1.0, white));

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)), white, white, 0.0);
}
