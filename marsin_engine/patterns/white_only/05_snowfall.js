/*
  05_snowfall.js — "Snowfall"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/35_sparkle_rain.js. Skeleton kept: crisp
  deterministic falling droplet cells (two adjacent rows crossfaded so
  turnover never jumps the whole rig), a density-owned activation threshold,
  a broad descending curtain for far-distance legibility, and per-fixture
  staging (bars carry the shower, strands carry vertical traces, jewelry
  gets sparse flecks, pars punctuate).
  IDENTITY (50 ft): dense white snow falls through a dim gray field, each
  flake a crisp spark.

  TEXTURE: the dim field between flakes rests at a 0.09 shadow; the broad
  wash/curtain carries the 0.28-0.50 mid body; falling glints and their
  crest carry 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one
  falling row cycle ~= 3.5 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the fall clock at
  0.676 x 8 = 5.41 cycles/s, below the 10/s alias bar. Max per-frame clock
  jump 0.1 x 0.676 x 2.0 = 0.135 against PHASE_WRAP 4096 — wraps safe by 4+
  orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — fall/churn/
  trace pace; density — spatial count of active flakes; intensity — peak
  brightness of each glint; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var density = 0.68;
export var intensity = 0.95;
export var level = 0.72;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = v; }
export function sliderIntensity(v) { intensity = v; }
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
var FALL_BASE = 0.676;
var CHURN_BASE = 0.1316;
var TRACE_BASE = 0.0947;
var FALL_ROWS = 21.0;

var fallPhase = 0.0;
var churnPhase = 0.0;
var tracePhase = 0.0;

var liveDensity = 0.55;
var liveIntensity = 0.85;
var liveLevel = 0.72;

function sparkleSample(seed) {
  var hash = sin(seed) * sin(seed * 1.713 + 1.3) * sin(seed * 3.117 + 2.1);
  hash = hash * hash;
  hash = hash * hash;
  // Churn is a seam-safe probability modulation, not a discontinuous reseed.
  var churn = wave(churnPhase + sin(seed * 0.071) * 0.43);
  return hash * (0.66 + churn * 0.34);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  liveDensity += (clamp01(density) - liveDensity) * lightFollow;
  liveIntensity += (clamp01(intensity) - liveIntensity) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One falling row cycle ~= 3.5 s at the reference point:
  // 1/(0.676 x 0.4225) ~= 3.5 s.
  fallPhase += dt * FALL_BASE * speedScale;
  churnPhase += dt * CHURN_BASE * speedScale;
  tracePhase += dt * TRACE_BASE * speedScale;
  if (fallPhase >= PHASE_WRAP) fallPhase -= PHASE_WRAP;
  if (churnPhase >= PHASE_WRAP) churnPhase -= PHASE_WRAP;
  if (tracePhase >= PHASE_WRAP) tracePhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.44 + nx * 0.12;
  }

  // Crisp deterministic cell identity. Two adjacent falling rows crossfade
  // so cell turnover never produces a whole-rig frame jump.
  var cellTravel = (ny + fallPhase) * FALL_ROWS;
  var row = floor(cellTravel);
  var cellFrac = cellTravel - row;
  var rowBlend = cellFrac * cellFrac * (3.0 - 2.0 * cellFrac);
  var col = floor(nx * 19.0 + nz * 7.0);
  var seed = index * 12.9898 + row * 78.233 + col * 37.719;
  var seedNext = seed + 78.233;
  var sampleNow = sparkleSample(seed);
  var sampleNext = sparkleSample(seedNext);
  var candidate = sampleNow + (sampleNext - sampleNow) * rowBlend;

  var d = liveDensity;
  var threshold = 0.945 - d * 0.62;
  if (isVintage) threshold = threshold + 0.04;
  if (isPar) threshold = threshold + 0.16;

  var glint = 0.0;
  if (candidate > threshold) {
    var amt = (candidate - threshold) / (1.0 - threshold + 0.0001);
    amt = clamp01(amt);
    glint = pow(amt, 0.35) * (0.10 + liveIntensity * liveIntensity * 2.4);
  }
  var halo = 0.0;
  var haloThreshold = threshold - 0.19;
  if (candidate > haloThreshold) {
    halo = (candidate - haloThreshold) / 0.19;
    halo = clamp01(halo) * liveIntensity * liveIntensity * 0.40;
  }
  glint = glint + halo;
  // A slow, spatially-fixed hot-spot field (churnPhase moves far slower than
  // the fast per-row glint hash) so crisp peaks are not exclusively tied to
  // the brief single-row glint window — the crest reads reliably over time.
  var peakField = wave(churnPhase * 0.43 + nx * 7.1 + ny * 11.3 + nz * 3.7);
  peakField = pow(peakField, 2.4);
  var intensityPeak = peakField * liveIntensity * liveIntensity * 1.45;

  var dropHead = wave(cellTravel);
  dropHead = dropHead * dropHead;
  glint = glint * (0.36 + dropHead * 0.64);

  var fieldWave = wave(ny * 2.6 + fallPhase * 0.34 + nx * 0.31);
  var wash = 0.22 + 0.78 * wave(nx * 1.7 + ny * 0.63 + nz * 0.41);
  var baseV = 0.16 * (0.42 + wash * 0.58) * (0.74 + fieldWave * 0.26);
  var curtainColumn = pow(wave(nx * 5.2 + nz * 2.3 + churnPhase * 0.17), 3.0);
  var curtainFall = pow(wave((ny + fallPhase) * 4.2 + nx * 0.23 - nz * 0.11),
    1.65);
  var rainCurtain = curtainColumn * curtainFall * (0.05 + d * 0.10);
  var trace = 0.0;
  if (isBar) {
    baseV = baseV * 1.18 + rainCurtain * 1.25;
    glint = glint * 1.14;
  } else if (isRaw) {
    var traceShape = triangle(ny * 3.2 + fallPhase * 0.72 + tracePhase
      + nx * 0.37);
    trace = pow(traceShape, 4.2) * (0.10 + d * 0.22) + rainCurtain * 0.92;
    baseV = baseV * 0.72;
    glint = glint * 0.92;
  } else if (isVintage) {
    baseV = baseV * 0.55;
    glint = glint * 1.35;
    intensityPeak = intensityPeak * 0.75;
  } else if (isPar) {
    baseV = baseV * 0.62;
    glint = glint * 0.55;
    intensityPeak = intensityPeak * 0.30;
  }
  if (isSign) intensityPeak = 0.0;

  var shadow = 0.09;
  var midAcc = baseV * 1.35;
  midAcc = midAcc + rainCurtain * 0.30;
  var peakAcc = glint * 1.45;
  peakAcc = peakAcc + intensityPeak * 1.95;
  peakAcc = peakAcc + trace * 0.70;

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.16 + glint * 0.68 + intensityPeak * 0.55;

  if (isVintage) {
    // Jewelry: sparse crisp flecks with honest matched native white, floored
    // well clear of black (Right Front Rails must never latch dark between
    // flakes) and visited by flakes far more often than the source's sparse
    // audio-driven jewelry threshold allowed.
    var jewelAcc = 0.15 + baseV * 0.45;
    jewelAcc = jewelAcc + glint * 1.10;
    jewelAcc = jewelAcc + intensityPeak * 0.95;
    lvl = jewelAcc;
    nativeShare = 0.36 + glint * 0.55 + intensityPeak * 0.55;
  } else if (isPar) {
    // Organs: restrained punctuation, never a full flood.
    var parAcc = shadow * 0.85 + baseV * 0.30;
    parAcc = parAcc + glint * 0.30;
    lvl = parAcc;
    nativeShare = 0.16 + glint * 0.40;
  } else if (isSign) {
    // Identity: two broad analytic droplet fronts descend through XYZ and
    // the traced letter path, so it reads as falling snow rather than a
    // fixed chandelier.
    var signPath = pixelLocalIndex * 0.01351351351;
    var rainCoordA = ny * 7.5 + nz * 0.65 + nx * 0.31 + signPath * 0.08
      + fallPhase * 2.50;
    var rainCoordB = ny * 4.3 + nz * 1.20 - nx * 0.60 + signPath * 0.21
      + fallPhase * 1.50 + 0.37;
    var dropA = pow(wave(rainCoordA), 1.55);
    var dropB = pow(wave(rainCoordB), 1.95);
    var rainColumn = 0.55 + 0.45
      * wave(signPath * (1.5 + d * 3.5) + nx * 0.73 + nz * 0.41);
    var signRainAcc = dropA * 0.48;
    signRainAcc = signRainAcc + dropB * 0.30;
    var signRain = signRainAcc * rainColumn;
    var signAcc = 0.32;
    signAcc = signAcc + signRain * 0.30;
    lvl = signAcc;
    nativeShare = 0.18 + signRain * 0.35;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
