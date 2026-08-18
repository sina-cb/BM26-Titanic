/*
  15_ivory_louvers.js — "Ivory Louvers"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/09_shadow_slats.js. Skeleton kept: one
  delta-accumulated pivot angle rotates a plane normal through X/Z, a fixed
  tilt pitches it into diagonal louvers, and a fract-cell mask carves the ship
  into parallel slabs with grazing edges, a hinge rail and pivot pins.
  IDENTITY (50 ft): giant ivory louvers pivot slowly across a satin-gray ship,
  each blade edged in a crisp white line.

  TEXTURE: slab interiors rest at a 0.09 shadow; the open satin field carries
  the 0.32-0.55 mid body; grazing edges, hinge rail and pins carry 0.85-1.0
  crisp peaks with a high native-white share.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  louver pivot ~= 34 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the broad-field drift
  at 0.070 x 8 = 0.56 cycles/s; the pivot runs 0.28 turns/s — both far below
  the 10/s alias bar. Max per-frame clock jump 0.1 x 0.070 x 2.0 = 0.014
  against PHASE_WRAP 4096 — wraps safe by 5 orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — pivot rate;
  direction — signed pivot direction; slatCount — three to seven blades;
  open — width of the luminous openings; edgeGlow — strength of the white
  edge drawing; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var slatCount = 0.48;
export var open = 0.50;
export var edgeGlow = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  pivotDirection = dv;
}
export function sliderSlatCount(v) { slatCount = v; }
export function sliderOpen(v) { open = v; }
export function sliderEdgeGlow(v) { edgeGlow = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var PHASE_WRAP = 4096.0;
var GOLDEN_ANGLE = 2.39996323;

var pivotClock = 0.071;
var driftClock = 0.0;
var pivotDirection = 0.50;
var normalX = 1.0;
var normalZ = 0.0;

var liveSlatCount = 4.92;
var liveOpen = 0.50;
var liveEdgeGlow = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  var targetCount = 3.0 + clamp01(slatCount) * 4.0;
  liveSlatCount += (targetCount - liveSlatCount) * shapeFollow;
  liveOpen += (clamp01(open) - liveOpen) * shapeFollow;
  liveEdgeGlow += (clamp01(edgeGlow) - liveEdgeGlow) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One louver pivot ~= 34 s at the reference point: 1/(34 x 0.4225) = 0.070.
  var pivotRate = 0.070 * speedScale;
  pivotClock += dt * pivotRate * pivotDirection;
  if (pivotClock >= PHASE_WRAP) pivotClock -= PHASE_WRAP;
  if (pivotClock < 0.0) pivotClock += PHASE_WRAP;
  driftClock += dt * 0.070 * speedScale;
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;

  var pivotAngle = pivotClock * PI2;
  normalX = cos(pivotAngle);
  normalZ = sin(pivotAngle);
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.44 + ux * 0.12;
  }

  var qx = ux - 0.50;
  var qy = uy - 0.50;
  var qz = uz - 0.50;

  // Rotating X/Z normal supplies pivot; a fixed Y pitch keeps the louvers
  // diagonal (the source's tilt control, frozen at its sweet spot).
  var pitch = 0.38;
  var projected = qx * normalX + qz * normalZ + qy * pitch;
  var perpendicular = -qx * normalZ + qz * normalX;
  var slatAxis = 0.50 + projected * 0.52;
  var slatCoordinate = slatAxis * liveSlatCount;
  var slatCell = slatCoordinate - floor(slatCoordinate);
  var centerDistance = abs(slatCell - 0.50);

  // Slab core is SHADOW (not black); the opening is the satin mid body; the
  // grazing edge is a widened crisp white line so the peaks carry real area.
  var slabHalf = 0.40 - liveOpen * 0.26;
  var edgeSoftness = 0.022 + 0.006 / liveSlatCount;
  var opening = smoothstep(slabHalf, slabHalf + edgeSoftness, centerDistance);
  var edgeDistance = abs(centerDistance - slabHalf);
  var grazingEdge = 1.0 - smoothstep(edgeSoftness * 0.6,
                                     edgeSoftness * 6.5, edgeDistance);

  // Hinge rail and one pin per slab keep the mechanical reading.
  var hingeRail = 1.0 - smoothstep(0.026, 0.072,
                                   abs(perpendicular + qy * 0.10));
  var pinAcross = 1.0 - smoothstep(0.050, 0.13, centerDistance);
  var pivotPin = hingeRail * pinAcross;

  // A broad non-periodic satin drift keeps the openings from reading flat.
  var driftField = 0.50;
  driftField = driftField + 0.24 * sin((qx * 1.41421356 + qz * 1.73205081)
                                       * PI2 + driftClock * PI2 * 0.37);
  driftField = driftField + 0.16 * cos((qy * 1.61803399 - qx * 0.73) * PI2);
  driftField = clamp01(driftField);

  var shadow = 0.09;
  var midBody = opening * (0.26 + driftField * 0.26);
  var peakAcc = grazingEdge * (0.75 + liveEdgeGlow * 0.85);
  peakAcc = peakAcc + pivotPin * (0.40 + liveEdgeGlow * 0.55);

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.18 + grazingEdge * 0.55;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette never inherits the slab shadow: the ship outline stays whole,
    // embossed by the passing edges.
    lvl = 0.20 + driftField * 0.14;
    lvl = lvl + grazingEdge * (0.70 + liveEdgeGlow * 0.75);
    lvl = lvl + hingeRail * 0.10;
    nativeShare = 0.15 + grazingEdge * 0.60;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: sparse brilliant catches where an edge crosses a head.
    var grazePhase = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                     + slatCoordinate * 1.61803399);
    var graze = max(grazingEdge, pivotPin) * pow(grazePhase, 5.0);
    lvl = 0.12 + opening * 0.14;
    lvl = lvl + graze * (0.90 + liveEdgeGlow * 0.60);
    nativeShare = 0.25 + graze * 0.75;
  } else if (fixtureType == FIX_PAR) {
    // Organs: soft light leaking through the openings, edge-kissed.
    var leak = smooth01(opening) * (0.30 + driftField * 0.26);
    lvl = 0.11 + leak;
    lvl = lvl + grazingEdge * (0.30 + liveEdgeGlow * 0.60);
    nativeShare = 0.20 + grazingEdge * 0.40;
  } else if (isSign) {
    // Identity: quiet slat cross-section over a firm readable floor.
    var engrave = grazingEdge * (0.55 + liveEdgeGlow * 0.55);
    lvl = 0.30 + opening * (0.14 + driftField * 0.12);
    lvl = lvl + engrave;
    lvl = lvl + pivotPin * 0.14;
    nativeShare = 0.22 + grazingEdge * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
