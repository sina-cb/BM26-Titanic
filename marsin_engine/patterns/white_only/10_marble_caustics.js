/*
  10_marble_caustics.js — "Marble Caustics"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/32_caustic_shimmer.js. Skeleton kept: three
  independent delta-accumulated flow clocks compose an interference field
  raised to a depth-controlled power for caustic veins; a wandering ring
  source launches expanding ripple highlights; a gated glint field adds
  crisp moving scintillation. TE signs receive the same folded triple-
  refraction glass-cell math.
  IDENTITY (50 ft): rippling water caustics play across the ship as veins
  of bright white in gray marble.

  TEXTURE: the quiet water floor rests at a 0.08-0.14 shadow; the caustic
  interference field carries the 0.30-0.55 mid body; the sharpened caustic
  crests, ripple crossings and glint scintillation carry the 0.85-1.0 crisp
  peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the
  primary caustic flow (rate 0.071) completes one full drift ~= 33 s on the
  rig at the reference point (1/(0.071 x 0.4225) = 33.4 s).
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the glint churn
  clock at 0.59 x 8 = 4.72 cycles/s, below the 10/s alias bar. Max
  per-frame clock jump 0.1 x 0.59 x 2.0 = 0.118 against PHASE_WRAP 4096 —
  wraps safe by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — flow, glint-
  churn and ripple-travel rate; shimmer — density/brightness of crisp
  moving white glints; ripple — strength of expanding ring highlights;
  depth — caustic vein contrast/sharpness; level — overall intensity with
  a visible floor.
*/

export var localSpeed = 0.30;
export var shimmer = 0.50;
export var ripple = 0.35;
export var depth = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderRipple(v) { ripple = v; }
export function sliderDepth(v) { depth = v; }
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
var CAUSTIC_DENSITY = 3.2;
var GLINT_DENSITY = 30.0;
var SQRT2 = 1.41421;
var PHI = 1.61803;

var flowA = 0.0;
var flowB = 0.0;
var flowC = 0.0;
var glintA = 0.0;
var glintB = 0.0;
var ripplePhase = 0.0;
var rippleLevel = 0.0;

var liveShimmer = 0.50;
var liveRipple = 0.35;
var liveDepth = 0.55;
var liveLevel = 0.65;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var paramFollow = clamp01(dt * 6.0);
  liveShimmer += (clamp01(shimmer) - liveShimmer) * paramFollow;
  liveRipple += (clamp01(ripple) - liveRipple) * paramFollow;
  liveDepth += (clamp01(depth) - liveDepth) * paramFollow;
  liveLevel += (clamp01(level) - liveLevel) * paramFollow;

  flowA += dt * 0.071 * speedScale;
  flowB += dt * 0.043 * speedScale;
  flowC += dt * 0.097 * speedScale;
  glintA += dt * 0.37 * speedScale;
  glintB += dt * 0.59 * speedScale;
  ripplePhase += dt * 0.24 * speedScale;

  if (flowA >= PHASE_WRAP) flowA -= PHASE_WRAP;
  if (flowB >= PHASE_WRAP) flowB -= PHASE_WRAP;
  if (flowC >= PHASE_WRAP) flowC -= PHASE_WRAP;
  if (glintA >= PHASE_WRAP) glintA -= PHASE_WRAP;
  if (glintB >= PHASE_WRAP) glintB -= PHASE_WRAP;
  if (ripplePhase >= PHASE_WRAP) ripplePhase -= PHASE_WRAP;

  // Fast attack, soft release: a ripple pulse reads immediately and settles
  // gently, without a discontinuous single-frame jump.
  var response = 5.0;
  if (liveRipple > rippleLevel) response = 18.0;
  rippleLevel += (liveRipple - rippleLevel) * min(1.0, dt * response);
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

  // Three independent clocks produce a continuously evolving interference
  // field; irrationality comes from the rates, never from multiplying a
  // wrapped phase at its use site.
  var w1 = wave(ux * CAUSTIC_DENSITY + uy * 0.70 - flowA);
  var w2 = wave(uy * CAUSTIC_DENSITY * SQRT2 * 0.50 - ux * 0.50 + flowB);
  var w3 = wave((ux + uy) * CAUSTIC_DENSITY * PHI * 0.30 + flowC);
  var field = w1 * 0.40;
  field = field + w2 * 0.35;
  field = field + w3 * 0.25;
  var sharp = 1.5 + liveDepth * 4.2;
  var caustic = pow(field, sharp);

  var floorPulse = 0.38 + 0.62 * wave(uy * 0.63 + flowB);

  // Expanding rings travel from a slowly wandering source.
  var centerX = 0.50 + sin(flowA * PI2) * 0.15;
  var centerY = 0.48 + sin(flowB * PI2) * 0.10;
  var ringDist = hypot(ux - centerX, uy - centerY);
  var ring = pow(wave(ringDist * 3.4 - ripplePhase), 9.0);
  var ringLift = ring * rippleLevel * (0.45 + 0.90 * caustic);

  var shadow = 0.08 + floorPulse * 0.06;
  var midBody = caustic * 0.42;
  var peakAcc = pow(caustic, 1.3) * 1.35;
  peakAcc = peakAcc + ringLift * 0.60;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.20 + caustic * 0.40;

  // Shimmer controls a distinct, crisp scintillation layer. Density rises
  // by lowering the gate; brightness rises independently.
  var glintField = wave(ux * GLINT_DENSITY + uy * 17.3 + glintA)
                 * wave(uy * GLINT_DENSITY * 0.91 - ux * 13.7 - glintB);
  var gate = 0.91 - liveShimmer * 0.60;
  var glint = 0.0;
  if (liveShimmer > 0.0 && glintField > gate) {
    var glintCore = (glintField - gate) / (1.0 - gate);
    glint = pow(clamp01(glintCore), 2.0) * liveShimmer * (0.35 + caustic * 0.65);
  }
  var sheen = pow(caustic, 2.4) * wave(ux * 8.7 - uy * 5.3 + glintB)
            * liveShimmer * liveShimmer * 0.42;
  glint = glint + sheen;
  if (fixtureType == FIX_VINTAGE_6) glint = glint * 1.35;
  glint = clamp01(glint);
  lvl = lvl + glint * 1.3;
  nativeShare = nativeShare + glint * 0.60;

  if (isSign) {
    // Identity is a pane of slowly deforming caustic glass. Three oblique
    // XYZ refractions fold across each 74-pixel letter path; pairwise
    // near-equality makes a changing cellular wall network.
    var signPath = pixelLocalIndex * 0.01351351351;
    var glassA = wave((ux * 0.61 + uy * 1.13 + uz * 0.47) * 3.7 + signPath * 0.73 + flowA * 4.0);
    var glassB = wave((ux * 1.31 - uy * 0.43 + uz * 0.89) * 3.1 - signPath * 0.37 - flowB * 5.0);
    var glassC = wave((ux * -0.77 + uy * 0.83 + uz * 1.21) * 2.9 + signPath * 0.51 + flowC * 3.0);
    var foldAB = 1.0 - clamp01(abs(glassA - glassB) * 2.45);
    var foldBC = 1.0 - clamp01(abs(glassB - glassC) * 2.45);
    var foldCA = 1.0 - clamp01(abs(glassC - glassA) * 2.45);
    var maxFold = max(foldAB, max(foldBC, foldCA));
    var cellWall = pow(maxFold, 2.15);
    var lensSeed = wave(signPath * PHI + ux * 0.73 + uy * 0.51 + uz * 0.31 + flowC * 4.0);
    var cellLens = pow(clamp01((1.0 - cellWall) * 0.42 + lensSeed * 0.58), 2.1);
    var focusNode = pow(clamp01(foldAB * foldBC * foldCA * 5.0), 0.78);
    var wallEnergy = cellWall * 0.75;
    var lensEnergy = cellLens * 0.80;

    var signMid = wallEnergy * 0.20;
    signMid = signMid + lensEnergy * 0.18;
    var signPeak = focusNode * 0.55;
    signPeak = signPeak + cellWall * 0.30;
    lvl = 0.25 + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.20 + focusNode * 0.65;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
