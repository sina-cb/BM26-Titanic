/*
  04_frost_lattice.js — "Frost Lattice"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/18_deep_space_lattice.js. Skeleton kept: two
  crossed wave grids PRODUCT (not summed) plus a diagonal weave, each on its
  own delta-accumulated incommensurate phase, drift across the rig; a
  separate detail-driven star/node microstructure layer; a rare three-axis
  conjunction is the crisp white counterpoint where every axis agrees.
  IDENTITY (50 ft): a slow 3D lattice of frost lines hangs in the ship,
  nodes sparking white.

  TEXTURE: the near-black void between lines rests at a 0.07 shadow; a
  broadened soft version of the crossed-grid product carries the 0.28-0.50
  mid body; the crisp lattice lines, stars and three-axis conjunction carry
  0.85-1.0 peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the
  primary grid drifts one full cycle ~= 11 s on the rig at the reference
  point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the diagonal weave's
  own accumulator at 0.279 x 8 = 2.23 cycles/s, well below the 10/s alias
  bar. Max per-frame clock jump 0.1 x 0.279 x 2.0 = 0.056 against
  PHASE_WRAP 4096 — wraps safe by 4+ orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — drift rate;
  latticeScale — grid density; detail — star/node microstructure and
  conjunction rarity; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var latticeScale = 0.50;
export var detail = 0.55;
export var level = 0.72;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLatticeScale(v) { latticeScale = v; }
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
var PHASE_A_BASE = 0.2153;
var PHASE_B_BASE = 0.0845;
var PHASE_AD_BASE = 0.2788;
var PHASE_DEPTH_BASE = 0.0493;
var RADIUS_FIXED = 0.55;

var phaseA = 0.0;
var phaseB = 0.0;
var phaseAd = 0.0;
var phaseDepth = 0.0;

var liveScale = 6.0;
var liveSoft = 3.0;
var liveDetail = 0.55;
var liveLevel = 0.72;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  var targetScale = 2.0 + clamp01(latticeScale) * 12.0;
  liveScale += (targetScale - liveScale) * lightFollow;
  liveDetail += (clamp01(detail) - liveDetail) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveSoft = 3.2 - liveDetail * 1.2;

  // The primary grid drifts one full cycle ~= 11 s at the reference point:
  // 1/(0.2153 x 0.4225) ~= 11.0 s. The diagonal weave gets its OWN
  // accumulator (not a scaled share of phaseA) so a wrap never seams.
  phaseA += dt * PHASE_A_BASE * speedScale;
  phaseB += dt * PHASE_B_BASE * speedScale;
  phaseAd += dt * PHASE_AD_BASE * speedScale;
  phaseDepth += dt * PHASE_DEPTH_BASE * speedScale;
  if (phaseA >= PHASE_WRAP) phaseA -= PHASE_WRAP;
  if (phaseB >= PHASE_WRAP) phaseB -= PHASE_WRAP;
  if (phaseAd >= PHASE_WRAP) phaseAd -= PHASE_WRAP;
  if (phaseDepth >= PHASE_WRAP) phaseDepth -= PHASE_WRAP;
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

  // Radius is frozen at a fixed sweet-spot excursion (the source's audio
  // handle); the moving warp keeps grid lines from reading perfectly flat.
  var warpX = (wave(ny * 1.37 + phaseB * 0.21) - 0.5) * RADIUS_FIXED * 0.34;
  var warpY = (wave(nx * 1.91 - phaseA * 0.17) - 0.5) * RADIUS_FIXED * 0.34;
  var gridX = wave((nx + warpX) * liveScale + phaseA);
  var gridY = wave((ny + warpY) * liveScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny + warpX - warpY) * liveScale * 0.38 + phaseAd);

  // Crossed grids as a PRODUCT (not a sum): crisp lattice intersections over
  // a near-black void is what makes the drift read as motion.
  var latticeRaw = max(gridX * gridY, diagonal * 0.65);
  var lattice = pow(latticeRaw, liveSoft);
  // A much softer/broader version of the same product gives the frost field
  // a real satin mid body instead of an empty void between crisp lines.
  var latticeGlow = pow(latticeRaw, liveSoft * 0.32);

  var starSeed = wave(index * 0.618034 + phaseAd * 0.173
    + nx * 2.31 - ny * 1.73);
  var microStar = pow(starSeed, 14.0 - liveDetail * 9.0) * liveDetail;
  var nodeMicro = pow(gridX * gridY, 2.4) * liveDetail;
  var conjunction = pow(gridX * gridY * diagonal, 3.2 - liveDetail * 1.2)
    * liveDetail;

  var shadow = 0.07;
  var midAcc = latticeGlow * 0.34;
  var peakAcc = lattice * 1.30;
  peakAcc = peakAcc + conjunction * 0.90;
  peakAcc = peakAcc + microStar * 0.55;
  peakAcc = peakAcc + nodeMicro * 0.40;

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.14 + conjunction * 0.75 + lattice * 0.28;

  if (fixtureType == FIX_RAW_LED) {
    // Opposing X/Y edge travel lets strands trace the lattice perimeter.
    var opposingEdges = max(pow(gridX, liveSoft * 0.78),
      pow(gridY, liveSoft * 0.78));
    var edgeAcc = opposingEdges * 0.62;
    edgeAcc = edgeAcc + microStar * 0.22;
    lvl = shadow * 0.7 + edgeAcc;
    nativeShare = 0.16 + opposingEdges * 0.55;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry catches the rare multi-axis conjunctions with a strong
    // native-white kick; the less-structured index stars stay dimmer.
    var jewelAcc = lattice * 0.18;
    jewelAcc = jewelAcc + microStar * 0.30;
    jewelAcc = jewelAcc + conjunction * 0.70;
    lvl = 0.08 + jewelAcc;
    nativeShare = 0.35 + conjunction * 0.60;
  } else if (fixtureType == FIX_PAR) {
    // Pars pulse warmly (here: crisply) only at lattice nodes.
    var nodePulse = nodeMicro * (0.34 + wave(phaseDepth * 0.381966) * 0.66);
    lvl = shadow * 0.9 + latticeGlow * 0.28 + nodePulse * 0.58;
    nativeShare = 0.18 + nodePulse * 0.45;
  } else if (isSign) {
    // Identity is a rigid cosmic instrument: two straight lattice axes move
    // in opposition while a diagonal weave crosses them, XYZ-fixed to the
    // ship (no organic warp). A firm floor keeps both letterforms readable.
    var signGridX = wave(nx * 3.70 + ny * 0.31 + nz * 0.17 + phaseA * 0.66);
    var signGridY = wave(ny * 3.10 - nx * 0.29 + nz * 0.23 - phaseB * 2.58);
    var signCross = pow(signGridX * signGridY, 2.15);
    var signDiagonal = pow(wave((nx - ny) * 2.80 + nz * 0.37
      + phaseAd * 0.37), 4.2);
    var signLattice = max(signCross, signDiagonal * 0.62);

    var signStarSeed = wave(pixelLocalIndex * 0.381966
      + nx * 1.17 + ny * 0.69 + nz * 0.43);
    var signStarSelected = (signStarSeed < 0.12 + liveDetail * 0.10) ? 1.0 : 0.0;
    var signStarLife = wave(phaseAd * (0.39 + signStarSeed * 0.165)
      + signStarSeed * 0.73 + nx * 0.07 - ny * 0.05);
    var signStars = pow(signStarLife, 3.7 + liveDetail * 2.3)
      * signStarSelected;

    var signAcc = 0.30;
    signAcc = signAcc + signLattice * 0.24;
    signAcc = signAcc + signStars * 0.30;
    lvl = signAcc;
    nativeShare = 0.18 + signLattice * 0.35 + signStars * 0.35;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
