/*
  03_silver_current.js — "Silver Current"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/14_lunar_current.js. Skeleton kept: one coherent
  curved river centerline (two incommensurate bends) meanders through the
  model with dark banks framing it; a separately phased caustic lace
  interferes only inside the river; a slow tide envelope breathes the
  overall body.
  IDENTITY (50 ft): a broad silver current flows down the hull with bright
  shimmer crests over a gray tide.

  TEXTURE: the banks outside the river rest at a 0.10 shadow; the river body
  and its bank rim carry the 0.30-0.50 mid body (gray tide); the caustic
  lace core inside the river carries 0.85-1.0 crisp shimmer peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  river bend cycle ~= 20 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the current clock at
  0.118 x 8 = 0.94 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.118 x 2.0 = 0.024 against PHASE_WRAP 4096 — wraps safe
  by 5 orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — current travel
  rate; currentWidth — width of the river band; shimmer — caustic lace
  strength; detail — lace spatial frequency; level — overall intensity with
  a visible floor.
*/

export var localSpeed = 0.30;
export var currentWidth = 0.50;
export var shimmer = 0.75;
export var detail = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCurrentWidth(v) { currentWidth = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderDetail(v) { detail = v; }
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
var CURRENT_BASE = 0.118;
var LACE_BASE = 0.0263;
var TIDE_BASE = 0.0473;
var FLOW_DIRECTION = 1.0;

var currentPhase = 0.0;
var lacePhase = 0.0;
var tidePhase = 0.0;

var liveWidth = 0.50;
var liveShimmer = 0.55;
var liveDetail = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  liveWidth += (clamp01(currentWidth) - liveWidth) * lightFollow;
  liveShimmer += (clamp01(shimmer) - liveShimmer) * lightFollow;
  liveDetail += (clamp01(detail) - liveDetail) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full river bend cycle ~= 20 s at the reference point:
  // 1/(0.118 x 0.4225) ~= 20.0 s.
  currentPhase += dt * CURRENT_BASE * speedScale * FLOW_DIRECTION;
  lacePhase += dt * LACE_BASE * speedScale;
  tidePhase += dt * TIDE_BASE * speedScale;
  if (currentPhase >= PHASE_WRAP) currentPhase -= PHASE_WRAP;
  if (lacePhase >= PHASE_WRAP) lacePhase -= PHASE_WRAP;
  if (tidePhase >= PHASE_WRAP) tidePhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.44 + nx * 0.12;
  }

  // A single curved river centerline. Two incommensurate bends keep the
  // path organic without tiling the whole model.
  var bendA = wave(nx * 1.13 - currentPhase + nz * 0.23) - 0.5;
  var bendB = wave(nx * 1.87 + currentPhase * 0.618 - nz * 0.41) - 0.5;
  var centerY = 0.50 + bendA * 0.38 + bendB * 0.14;
  var riverWidth = 0.055 + liveWidth * 0.32;
  var riverDistance = abs(ny - centerY);
  var river = smooth01(1.0 - riverDistance / riverWidth);

  var bankDistance = abs(riverDistance - riverWidth * 0.78);
  var bank = smooth01(1.0 - bankDistance / (0.025 + riverWidth * 0.16));

  // Caustic lace: two oblique coordinate fields interfere only inside the
  // river. Detail changes bounded spatial frequency; Shimmer changes
  // amplitude/sharpness without touching any accumulated phase.
  var laceFreq = 0.20 + liveDetail * 6.02;
  var laceA = wave((nx * 0.83 + ny * 1.31 + nz * 0.47) * laceFreq + lacePhase);
  var laceB = wave((nx * -1.17 + ny * 0.71 + nz * 0.93) * laceFreq
    - lacePhase * 0.618);
  var filament = 1.0 - clamp01(abs(laceA - laceB) * (1.5 + liveDetail * 3.0));
  filament = smooth01(filament);
  var node = pow(clamp01(laceA * laceB * 1.28), 0.60 + liveDetail * 0.7);
  var laceAcc = filament * 0.72;
  laceAcc = laceAcc + node * 0.48 + 0.16;
  var laceShape = clamp01(laceAcc) * river;
  var lace = laceShape * liveShimmer;
  var laceCore = pow(laceShape, 1.0) * liveShimmer;

  var tide = 0.78 + wave(tidePhase + nx * 0.09 + nz * 0.07) * 0.22;
  // A broad, slow silver sheen covers the whole hull (the "gray tide" body)
  // independent of the tight river band, so mid-body coverage does not
  // depend entirely on the narrow current.
  var broadWash = 0.5 + 0.5 * wave(nx * 0.72 + nz * 0.53 + tidePhase * 0.31);

  var shadow = 0.14;
  var midAcc = broadWash * 0.26;
  midAcc = midAcc + river * (0.20 + river * 0.16);
  midAcc = midAcc + bank * 0.12;
  var peakAcc = laceCore * (2.40 + liveShimmer * 0.85);
  peakAcc = peakAcc + lace * 0.50;
  peakAcc = peakAcc + node * river * 0.65;

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  lvl = lvl * tide;
  var nativeShare = 0.16 + laceCore * 0.68 + river * 0.16;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette: crisp tracing on banks and caustic cores.
    var traceAcc = river * 0.18;
    traceAcc = traceAcc + bank * 0.30;
    traceAcc = traceAcc + laceCore * 0.72;
    lvl = shadow * 0.95 + traceAcc;
    nativeShare = 0.22 + laceCore * 0.72;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: sparse crisp reflections with honest matched native white.
    var fleckSeed = wave(pixelLocalIndex * 0.371 + nx * 1.73 + ny * 0.83
      + lacePhase * 0.19);
    var fleck = pow(fleckSeed, 5.5 + liveDetail * 3.5)
      * clamp01(bank * 0.42 + laceCore * 0.88);
    lvl = 0.10 + river * 0.06 + fleck * 0.82;
    nativeShare = 0.35 + fleck * 0.60;
  } else if (fixtureType == FIX_PAR) {
    // Organs: restrained pools below the current.
    var pool = clamp01(river * 0.24 + bank * 0.12);
    lvl = shadow * 0.95 + pool * 0.50 + laceCore * 0.18;
    nativeShare = 0.18 + pool * 0.35;
  } else if (isSign) {
    // Identity: the physical pixels already draw the letters, so preserve
    // that silhouette with a firm moonlit floor and one broad current front.
    var signFlowCoord = nx * 0.37 + ny * 0.91 - nz * 0.67;
    signFlowCoord = signFlowCoord + pixelLocalIndex * 0.003;
    var signCurrent = wave(signFlowCoord - currentPhase * 0.75);
    var signBody = smooth01(signCurrent);
    var signCrest = smooth01(1.0 - abs(signCurrent - 0.78) / 0.34);
    var signAcc = 0.30;
    signAcc = signAcc + signBody * 0.14;
    signAcc = signAcc + signCrest * 0.30;
    lvl = signAcc;
    nativeShare = 0.20 + signCrest * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
