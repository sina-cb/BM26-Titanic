/*
  14_uv_lattice_drift.js — "UV Lattice Drift"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/18_deep_space_lattice.js. Skeleton kept: two
  crossed wave grids plus a diagonal weave, each on its own incommensurate
  delta-accumulated clock, PRODUCT-composed (not summed) so crisp lattice
  intersections light over a near-black void — that high contrast is what
  reads as drift.
  IDENTITY (50 ft): a softly glowing violet lattice drifts through the ship
  in three dimensions.

  TEXTURE: the un-swept hull rests at a 0.15-0.20 violet keep; single-grid
  lines carry a 0.35-0.55 mid field; crossed-grid intersections and detail
  micro-nodes peak at 0.90-1.0, sparingly. PARs pulse only at lattice nodes.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  primary grid drift (phaseA) ~= 24 s at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is the diagonal weave (phaseAd) at 0.1408 x 2.0 = 0.282
  cycles/s — far below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.282 = 0.0282 against PHASE_WRAP 4096 — wraps safe by five orders
  of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — grid/weave
  drift rate; direction — signed primary-grid drift; latticeScale — grid
  density; lineSoftness — line width/crispness; detail — micro-node/star
  layer strength; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderDetail <- micHigh range 0.20..0.90 curve linear # highs sharpen the micro-node layer
    # STATIC (omit from audio): localSpeed, direction, latticeScale, lineSoftness
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var latticeScale = 0.50;
export var lineSoftness = 0.45;
export var detail = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderLatticeScale(v) { latticeScale = v; }
export function sliderLineSoftness(v) { lineSoftness = v; }
export function sliderDetail(v) { detail = v; }
export function sliderLevel(v) { level = v; }

// ── UV AUTHORITY (uv_only family block — byte-identical across
//    patterns/uv_only/*; hash-gated by uv_only_contract.test.js) ──
// The family renders UV ONLY: violet-intensity art on the fixtures that
// physically carry a U emitter — the Hull Canvas ShehdsBars (FIX_BAR_18)
// and the Organ UkingPars (FIX_PAR). Silhouette strands, Jewelry rails and
// the TE signs have NO violet die, so those pixels are held at exact zero
// and the sim, the gallery and the playa all tell the same truth (house
// convention from patterns/65_uv_only.js). R = G = B = W = A = 0 on every
// pixel of every frame, and NO colorPalette exports — untintable by design.
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitUv(uvLevel) {
  var uLane = clamp01(uvLevel);
  if (fixtureType != FIX_BAR_18 && fixtureType != FIX_PAR) uLane = 0.0;
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, uLane);
}
// ── end UV AUTHORITY ──

var PHASE_WRAP = 4096.0;

var phaseA = 0.0;
var phaseB = 0.30;
var phaseAd = 0.60;
var primaryDirection = 0.50;

var liveLatticeScale = 0.50;
var liveLineSoftness = 0.45;
var liveDetail = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveLatticeScale += (clamp01(latticeScale) - liveLatticeScale) * shapeFollow;
  liveLineSoftness += (clamp01(lineSoftness) - liveLineSoftness) * shapeFollow;
  liveDetail += (clamp01(detail) - liveDetail) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One primary grid drift ~= 24 s at the reference point: 1/(24 x 0.4225) = 0.0985.
  phaseA += dt * 0.0985 * speedScale * primaryDirection;
  if (phaseA >= PHASE_WRAP) phaseA -= PHASE_WRAP;
  if (phaseA < 0.0) phaseA += PHASE_WRAP;
  // Incommensurate secondary grid and diagonal weave, each its own accumulator.
  phaseB += dt * 0.0388 * speedScale;
  if (phaseB >= PHASE_WRAP) phaseB -= PHASE_WRAP;
  phaseAd += dt * 0.1408 * speedScale;
  if (phaseAd >= PHASE_WRAP) phaseAd -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var liveScale = 2.0 + liveLatticeScale * 10.0;
  var liveSoft = 4.5 - liveLineSoftness * 3.3;

  var gridX = wave(nx * liveScale + phaseA);
  var gridY = wave(ny * liveScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny) * liveScale * 0.38 + nz * 0.21 + phaseAd);

  var lattice = max(gridX * gridY, diagonal * 0.65);
  lattice = pow(lattice, liveSoft);

  var starSeed = wave(index * 0.618034 + phaseAd * 0.173 + nx * 2.31 - ny * 1.73);
  var microStar = pow(starSeed, 14.0 - liveDetail * 9.0) * liveDetail;
  var nodeMicro = pow(gridX * gridY, 2.4) * liveDetail;

  var keep = 0.15 + nz * 0.05;
  var lvl = keep;
  lvl = lvl + lattice * 0.75;
  lvl = lvl + microStar * 0.50;

  if (fixtureType == FIX_PAR) {
    var parPhase = fixtureId * 0.437;
    var nodePulse = nodeMicro * (0.40 + wave(phaseAd * 0.382 + parPhase) * 0.60);
    lvl = keep * 0.85;
    lvl = lvl + nodePulse * (0.55 + liveDetail * 0.55);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
