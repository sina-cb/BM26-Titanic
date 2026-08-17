// DRAFT — pending operator review
/*
  49_all_together.js — ALL TOGETHER

  CONCEPT
    Five independent instrument phrases gradually align into one serene
    whole-ship chord, hold there, then separate. The convergence is temporal:
    each instrument retains its own spatial motif instead of collapsing into a
    shared-brightness breath.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad diagonal facet phrase across the Hull Canvas.
    FIX_RAW_LED    — ordered traveling cadence along the Silhouette.
    FIX_VINTAGE_6  — crisp chord studs with restrained native W=A.
    FIX_PAR        — four structural tone cohorts across the Organs.
    FIX_TE_SIGN    — paired local center motifs on both Identity surfaces.

  MOTION / MATH
    Five irrational-rate role phases orbit independently. A bounded long-cycle
    gather envelope pulls their shortest wrapped phase deltas toward one common
    phase, holds exact convergence, then releases continuously. Before gather,
    default phase dispersion exceeds 0.25 turns; on the gather plateau every
    role is within 0.03 turns of the common chord.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the complete separate/gather/hold/release cycle.
    gather      — depth of phase convergence toward the common chord.
    hold        — duration of the fully gathered plateau.
    separation  — spread of the five independent role phases between chords.
    detail      — spatial resolution inside each instrument's distinct motif.
    level       — expressive intensity of all five phrases.
    safetyFloor — protected whole-vessel visibility beneath the phrases.

  AUDIO_MODULATION_V1:
    sliderGather <- micFlux range 0.22..0.58 curve ease # flux draws the instrument phrases together
    sliderLevel  <- micLow range 0.36..0.70 curve linear # lows lift the whole five-part chord
  Static (unmapped) params: localSpeed, hold, separation, detail, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB lies strictly on the cp1-to-cp2 segment. Only Vintage fixtures emit
    native white and always W=A. UV is always zero. Silence autonomously
    completes the long convergence cycle over a full nonblack safety floor.
*/

export var cp1H = 0.585, cp1S = 0.78, cp1V = 0.92;
export var cp2H = 0.105, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var gather = 0.56;
export var hold = 0.48;
export var separation = 0.68;
export var detail = 0.52;
export var level = 0.72;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderGather(v) { gather = v; }
export function sliderHold(v) { hold = v; }
export function sliderSeparation(v) { separation = v; }
export function sliderDetail(v) { detail = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var cyclePhase = 0.300;
var gatherEnvelope = 0.0;
var effectiveGather = 0.0;
var commonPhase = 0.0;
var hullPhase = 0.0;
var silhouettePhase = 0.0;
var jewelryPhase = 0.0;
var organPhase = 0.0;
var identityPhase = 0.0;

var liveGather = 0.56;
var liveHold = 0.48;
var liveSeparation = 0.68;
var liveDetail = 0.52;
var liveLevel = 0.72;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function wrapPhase(v) {
  v = v - floor(v);
  if (v < 0.0) v += 1.0;
  return v;
}

function gatherPhase(independentPhase) {
  var delta = independentPhase - commonPhase;
  delta -= floor(delta + 0.50);
  return wrapPhase(commonPhase + delta * (1.0 - effectiveGather));
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 5.0);
  liveGather += (gather - liveGather) * follow;
  liveHold += (hold - liveHold) * follow;
  liveSeparation += (separation - liveSeparation) * follow;
  liveDetail += (detail - liveDetail) * follow;
  liveLevel += (level - liveLevel) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  cyclePhase += dt * (0.008 + localMultiplier * 0.026);
  if (cyclePhase >= PHASE_WRAP) cyclePhase -= PHASE_WRAP;

  var cycle = cyclePhase - floor(cyclePhase);
  var holdEnd = 0.36 + clamp01(liveHold) * 0.28;
  if (cycle < 0.16) gatherEnvelope = 0.0;
  else if (cycle < 0.28) gatherEnvelope = smooth01((cycle - 0.16) / 0.12);
  else if (cycle < holdEnd) gatherEnvelope = 1.0;
  else gatherEnvelope = 1.0 - smooth01((cycle - holdEnd) / (1.0 - holdEnd));

  // Gather always reaches a truthful chord at the plateau while the control
  // changes how tightly the approach and release bind the five phrases.
  effectiveGather = gatherEnvelope * (0.88 + clamp01(liveGather) * 0.12);
  commonPhase = wrapPhase(cyclePhase * 0.73 + 0.117);

  var spread = 0.35 + clamp01(liveSeparation) * 0.65;
  hullPhase = gatherPhase(wrapPhase(cyclePhase * SQRT2));
  silhouettePhase = gatherPhase(wrapPhase(cyclePhase * SQRT3
                                         + 0.19 * spread));
  jewelryPhase = gatherPhase(wrapPhase(cyclePhase / GOLDEN_FRACTION
                                      + 0.43 * spread));
  organPhase = gatherPhase(wrapPhase(cyclePhase * 1.271828
                                    + 0.68 * spread));
  identityPhase = gatherPhase(wrapPhase(cyclePhase * 1.324718
                                       + 0.86 * spread));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each 74-pixel sign spans two fixtures whose local counters reset. Fold
    // the model index across the complete sign so both Titanic center fields
    // remain byte-identical without collapsing their lower rows.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50;
  }

  var detailCount = 2.0 + clamp01(liveDetail) * 5.0;
  var floorLevel = 0.050 + clamp01(liveSafetyFloor) * 0.245;
  var levelAmount = 0.12 + clamp01(liveLevel) * 0.88;
  var motif = 0.0;
  var paletteMix = 0.20;
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull phrase: broad diagonal facets whose phase advances through depth.
    var hullCoordinate = px * 0.58 + py * 0.27 + pz * 0.15;
    var hullWave = 0.5 + 0.5
      * cos((hullCoordinate * detailCount - hullPhase) * PI2);
    var facet = 1.0 - abs(hullWave * 2.0 - 1.0);
    motif = 0.18 + smooth01(facet) * 0.82;
    paletteMix = clamp01(0.08 + hullWave * 0.80);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette phrase: ordered cadence beads along each local strand.
    var cadence = 0.5 + 0.5
      * cos((pixelLocalIndex / 40.0 * detailCount - silhouettePhase) * PI2);
    motif = 0.16 + pow(cadence, 5.0) * 0.84;
    paletteMix = clamp01(0.12 + cadence * 0.76);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry phrase: crisp finite studs; native white peaks at convergence.
    var stud = 0.5 + 0.5
      * cos((pixelLocalIndex / 6.0 * detailCount - jewelryPhase) * PI2);
    var crispStud = pow(stud, 9.0);
    motif = 0.20 + crispStud * 0.80;
    paletteMix = clamp01(0.14 + stud * 0.78);
    nativeWhite = crispStud * gatherEnvelope * levelAmount * 0.34;
  } else if (fixtureType == FIX_PAR) {
    // Organ phrase: four structural tone cohorts, not a continuous wash.
    var toneCohort = pixelLocalIndex % 4.0;
    var tone = 0.5 + 0.5
      * cos((toneCohort / 4.0 + organPhase) * PI2);
    motif = 0.24 + tone * 0.76;
    paletteMix = clamp01(0.10 + toneCohort / 3.0 * 0.70
                       + tone * 0.12);
  } else if (isSign) {
    // Identity phrase: paired center diamonds which retain their own geometry
    // while their temporal phase joins the other four instruments.
    var centerDistance = abs(px - 0.50) + abs(py - 0.50);
    var centerBands = 0.5 + 0.5
      * cos((centerDistance * detailCount * 1.6 - identityPhase) * PI2);
    var twinCenter = 1.0 - smoothstep(0.06, 0.46, centerDistance);
    motif = 0.24 + centerBands * 0.50 + twinCenter * 0.26;
    paletteMix = clamp01(0.10 + centerBands * 0.66
                       + twinCenter * 0.20);
  }

  // At the held convergence all five still retain their own geometry, but
  // their palette material visibly resolves to one shared gold chord. This is
  // a temporal role-convergence cue, not a common brightness breath.
  var chordMaterial = 0.76;
  var chordMix = gatherEnvelope * 0.78;
  paletteMix += (chordMaterial - paletteMix) * chordMix;

  // Each motif owns its brightness structure. Convergence changes phase only;
  // there is no shared gather-envelope brightness multiplier.
  var brightness = floorLevel + motif * (0.08 + levelAmount * 0.76);
  if (isSign) brightness = max(0.31, brightness + 0.08);
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
