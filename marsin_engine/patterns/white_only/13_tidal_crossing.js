/*
  13_tidal_crossing.js — "Tidal Crossing"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/119_bow_stern_tidal_push.js. Skeleton kept: two
  circular-distance compression fronts (bow-to-stern and stern-to-bow) each
  bowed by their own cross-section terms, each trailing a broad recoil
  shelf, meet and cross across the ship. TE signs receive the same
  matched-topology bow/return score. Heading stays fixed, as in the source.
  IDENTITY (50 ft): two white tidal fronts push from bow and stern, meeting
  in a bright crossing crest.

  TEXTURE: the open water between fronts rests at a 0.09 shadow; the
  trailing recoil shelves carry the 0.30-0.55 mid body; the compression
  fronts and their crossing crest carry the 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225); all five
  clocks keep the source's incommensurate rate ratios (0.096, 0.061803,
  0.039191, 0.055425, 0.024222) scaled by the same speedScale.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the travel clock at
  0.096 x 8 = 0.77 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.096 x 2.0 = 0.019 against PHASE_WRAP 4096 — wraps safe
  by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — front travel
  rate; waveWidth — front thickness; recoil — strength of the trailing
  shelf; contrast — front edge sharpness; level — overall intensity with a
  visible floor.
*/

export var localSpeed = 0.30;
export var waveWidth = 0.56;
export var recoil = 0.48;
export var contrast = 0.58;
export var level = 0.62;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderWaveWidth(v) { waveWidth = v; }
export function sliderRecoil(v) { recoil = v; }
export function sliderContrast(v) { contrast = v; }
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

var travelPhase = 0.0;
var returnPhase = 0.37;
var crossPhase = 0.13;
var lowerPhase = 0.183847;
var shelfPhase = 0.080344;

var liveWidth = 0.56;
var liveRecoil = 0.48;
var liveContrast = 0.58;
var liveLevel = 0.62;

function circularDistance(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var paramFollow = clamp01(dt * 6.0);
  liveWidth += (clamp01(waveWidth) - liveWidth) * paramFollow;
  liveRecoil += (clamp01(recoil) - liveRecoil) * paramFollow;
  liveContrast += (clamp01(contrast) - liveContrast) * paramFollow;
  liveLevel += (clamp01(level) - liveLevel) * paramFollow;

  travelPhase += dt * 0.096 * speedScale;
  returnPhase += dt * 0.061803 * speedScale;
  crossPhase += dt * 0.039191 * speedScale;
  lowerPhase += dt * 0.055425 * speedScale;
  shelfPhase += dt * 0.024222 * speedScale;
  if (travelPhase >= PHASE_WRAP) travelPhase -= PHASE_WRAP;
  if (returnPhase >= PHASE_WRAP) returnPhase -= PHASE_WRAP;
  if (crossPhase >= PHASE_WRAP) crossPhase -= PHASE_WRAP;
  if (lowerPhase >= PHASE_WRAP) lowerPhase -= PHASE_WRAP;
  if (shelfPhase >= PHASE_WRAP) shelfPhase -= PHASE_WRAP;
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

  var front = travelPhase - floor(travelPhase);
  var returnFront = 1.0 - (returnPhase - floor(returnPhase));
  if (returnFront >= 1.0) returnFront -= 1.0;
  var cross = crossPhase;
  var width = 0.10 + liveWidth * 0.24;

  // Two slowly changing cross-section bends give each tidal face its own
  // three-dimensional pressure contour.
  var upperBend = wave(uy * 0.71 + uz * 0.37 + cross) - 0.5;
  var lowerBend = wave(uy * 0.29 - uz * 0.63 - lowerPhase) - 0.5;
  var bowedFront = front + (uy - 0.5) * 0.052;
  bowedFront = bowedFront + (uz - 0.5) * 0.034;
  bowedFront = bowedFront + upperBend * 0.032;
  bowedFront = bowedFront - floor(bowedFront);
  var compressionDistance = circularDistance(ux, bowedFront);
  var compression = smooth01(1.0 - compressionDistance / width);
  compression = pow(compression, 0.72 + liveContrast * 2.65);

  var bowedReturn = returnFront - (uy - 0.5) * 0.043;
  bowedReturn = bowedReturn + (uz - 0.5) * 0.028;
  bowedReturn = bowedReturn + lowerBend * 0.029;
  bowedReturn = bowedReturn - floor(bowedReturn);
  var returnDistance = circularDistance(ux, bowedReturn);
  var returnCompression = smooth01(1.0 - returnDistance / (width * 0.90));
  returnCompression = pow(returnCompression, 0.84 + liveContrast * 2.25);

  // Each front leaves its own broad pressure shelf trailing the direction
  // it came from.
  var recoilCenter = bowedFront - (0.11 + width * 0.55);
  recoilCenter = recoilCenter - floor(recoilCenter);
  var recoilDistance = circularDistance(ux, recoilCenter);
  var recoilWave = smooth01(1.0 - recoilDistance / (width * 1.38));
  recoilWave = pow(recoilWave, 0.88 + liveContrast * 1.35);

  var returnRecoilCenter = bowedReturn + (0.09 + width * 0.47);
  returnRecoilCenter = returnRecoilCenter - floor(returnRecoilCenter);
  var returnRecoilDistance = circularDistance(ux, returnRecoilCenter);
  var returnRecoil = smooth01(1.0 - returnRecoilDistance / (width * 1.52));
  returnRecoil = pow(returnRecoil, 0.96 + liveContrast * 1.18);

  var recoilGain = liveRecoil;
  recoilWave = recoilWave * recoilGain;
  returnRecoil = returnRecoil * recoilGain;

  var sectionRelief = 0.74 + upperBend * 0.15 + lowerBend * 0.11;
  compression = compression * (0.91 + sectionRelief * 0.09);
  returnCompression = returnCompression * (0.82 + sectionRelief * 0.18);

  var crossCrest = compression * returnCompression;

  var shadow = 0.09;
  var midBody = returnCompression * 0.28;
  midBody = midBody + recoilWave * 0.14;
  midBody = midBody + returnRecoil * 0.12;
  var peakAcc = compression * 0.75;
  peakAcc = peakAcc + crossCrest * 0.55;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.18 + compression * 0.55;
  nativeShare = nativeShare + crossCrest * 0.30;

  if (isSign) {
    // Both TE signs are the same 74-pixel instrument; authoring from their
    // matched local topology keeps the two fronts exactly balanced.
    var signPosition = clamp01(pixelLocalIndex / 73.0);
    var signWidth = 0.15 + liveWidth * 0.17;
    var signBowDistance = circularDistance(signPosition, front);
    var signBow = smooth01(1.0 - signBowDistance / signWidth);
    signBow = pow(signBow, 0.82 + liveContrast * 1.68);
    var signReturnDistance = circularDistance(signPosition, returnFront);
    var signReturn = smooth01(1.0 - signReturnDistance / signWidth);
    signReturn = pow(signReturn, 0.94 + liveContrast * 1.42);
    var signUndertow = wave(signPosition * 0.82 - shelfPhase);

    var signMid = signReturn * 0.26;
    signMid = signMid + signUndertow * 0.10;
    var signPeak = signBow * 0.65;
    lvl = 0.25 + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.22 + signBow * 0.60;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
