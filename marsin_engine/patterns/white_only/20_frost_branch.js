/*
  20_frost_branch.js — "Frost Branch"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/17_frost_branch.js. Skeleton kept: one
  monumental sixfold ice crystal grows, holds and melts; three analytic axis
  distances fold the X/Z plane into a 60-degree sector (no per-pixel atan2);
  a finite centre arm plus the nearest of five branch tiers is evaluated in
  the folded sector; each generation reseeds rotation and proportions.
  IDENTITY (50 ft): a giant white frost crystal grows over the ship, holds
  its six-armed emblem, then melts back to a glowing nucleus.

  TEXTURE: a subdued faceted bed carries the 0.14-0.34 low-mid body between
  the arms; the crystal body sits in the 0.5-0.7 mid; arms, tips and nucleus
  reach 0.9-1.0 crisp peaks with a heavy native-white share at the tips.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  grow/hold/melt cycle ~30 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): cycle clock 0.079 x 8 = 0.63
  cycles/s; the ice sheen term (x8.0) reaches 5.1/s — the fastest term in
  the file, still below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.079 x 2.0 = 0.016 against PHASE_WRAP 4096 — wraps safe.
  CONTROLS (declaration order = MFT knob order): localSpeed — grow/hold/melt
  cadence; branchCount — recruits branch pairs; growth — maximum crystal
  reach; hold — duration of the grown pose; melt — thaw duration/softness;
  level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var branchCount = 0.52;
export var growth = 0.58;
export var hold = 0.46;
export var melt = 0.34;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBranchCount(v) { branchCount = v; }
export function sliderGrowth(v) { growth = v; }
export function sliderHold(v) { hold = v; }
export function sliderMelt(v) { melt = v; }
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

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var PHASE_WRAP = 4096.0;

var cycleClock = 0.31;
var cycleStage = 0.72;
var crystalReach = 0.72;
var thawSoftness = 0.10;
var crystalGeneration = -1.0;
var crystalCos = 1.0;
var crystalSin = 0.0;
var branchLengthScale = 1.0;
var tierOffset = 0.0;

var liveBranchCount = 0.52;
var liveGrowth = 0.58;
var liveHold = 0.46;
var liveMelt = 0.34;
var liveLevel = 0.70;

function hash11(v) {
  var h = sin(v * 12.9898 + 78.233) * 43758.5453;
  return h - floor(h);
}

function segmentDistance2(spx, spy, sax, say, sbx, sby) {
  var sdx = sbx - sax;
  var sdy = sby - say;
  var sl2 = sdx * sdx + sdy * sdy + 0.000001;
  var spr = ((spx - sax) * sdx + (spy - say) * sdy) / sl2;
  spr = clamp01(spr);
  var scx = sax + sdx * spr;
  var scy = say + sdy * spr;
  var sex = spx - scx;
  var sey = spy - scy;
  return sex * sex + sey * sey;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var follow = min(1.0, dt * 5.0);
  liveBranchCount += (clamp01(branchCount) - liveBranchCount) * follow;
  liveGrowth += (clamp01(growth) - liveGrowth) * follow;
  liveHold += (clamp01(hold) - liveHold) * follow;
  liveMelt += (clamp01(melt) - liveMelt) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  // One grow/hold/melt cycle ~30 s at the reference point:
  // 1/(30 x 0.4225) ~= 0.079.
  cycleClock += dt * 0.079 * speedScale;
  if (cycleClock >= PHASE_WRAP) cycleClock -= PHASE_WRAP;

  // Reseed a deterministic crystal only when a growth cycle changes, while
  // the previous crystal is melted to its nucleus (source skeleton).
  var nextGeneration = floor(cycleClock);
  if (nextGeneration != crystalGeneration) {
    crystalGeneration = nextGeneration;
    var seedA = hash11(nextGeneration + 0.37);
    var seedB = hash11(nextGeneration * 1.61803399 + 4.21);
    var seedC = hash11(nextGeneration * 2.23606798 + 9.17);
    var crystalAngle = seedA * PI2;
    crystalCos = cos(crystalAngle);
    crystalSin = sin(crystalAngle);
    branchLengthScale = 0.82 + seedB * 0.36;
    tierOffset = (seedC - 0.5) * 0.065;
  }

  var cyclePhase = cycleClock - floor(cycleClock);
  var holdPart = 0.08 + clamp01(liveHold) * 0.30;
  var meltPart = 0.13 + clamp01(liveMelt) * 0.27;
  var growPart = 1.0 - holdPart - meltPart;

  if (cyclePhase < growPart) {
    cycleStage = smooth01(cyclePhase / growPart);
  } else if (cyclePhase < growPart + holdPart) {
    cycleStage = 1.0;
  } else {
    var meltProgress = (cyclePhase - growPart - holdPart) / meltPart;
    var meltCurve = smooth01(meltProgress);
    cycleStage = 1.0 - meltCurve;
  }

  // Collapse the last numerical sliver smoothly and keep a finite nucleus
  // arm at the turnaround (ill-conditioned zero-length segment, see source).
  cycleStage = smooth01((cycleStage - 0.02) / 0.98);
  crystalReach = (0.56 + clamp01(liveGrowth) * 0.54)
               * (0.08 + cycleStage * 0.92);
  thawSoftness = clamp01(liveMelt)
               * (0.14 + 0.86 * (1.0 - cycleStage));
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold the 40 + 34 physical patch into one complete 74-pixel snow seal.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uz = floor(signIndex / 10.0) / 7.0;
    uy = 0.50;
  }

  var baseX = (ux - 0.50) * 1.50;
  var baseZ = (uz - 0.50) * 1.50;
  var qx = baseX * crystalCos - baseZ * crystalSin;
  var qz = baseX * crystalSin + baseZ * crystalCos;
  var qy = uy - 0.50;
  var radial = sqrt(qx * qx + qz * qz);

  // Six exact radial arms via nearest-of-three undirected axes (source).
  var armAcross = abs(qz);
  var armAlong = abs(qx);
  var sectorCenter = 0.0;
  var axisDistance = abs(-0.86602540 * qx + 0.5 * qz);
  if (axisDistance < armAcross) {
    armAcross = axisDistance;
    armAlong = abs(0.5 * qx + 0.86602540 * qz);
    sectorCenter = 1.0;
  }
  axisDistance = abs(0.86602540 * qx + 0.5 * qz);
  if (axisDistance < armAcross) {
    armAcross = axisDistance;
    armAlong = abs(0.5 * qx - 0.86602540 * qz);
    sectorCenter = 2.0;
  }

  var meltBend = sin((armAlong * 2.70 + qy * SQRT2) * PI2
                     + cycleClock * 0.17) * thawSoftness * 0.022;
  armAcross = abs(armAcross + meltBend);

  var lineWidth = 0.045 + thawSoftness * 0.055;
  var lineWidth2 = lineWidth * lineWidth;
  var lineOuter2 = lineWidth2 * 7.0225;
  var mainOverrun = max(0.0, armAlong - crystalReach);
  var mainDistance = mainOverrun * mainOverrun + armAcross * armAcross;
  var mainArm = 1.0 - smoothstep(lineWidth2, lineOuter2, mainDistance);

  // Nearest branch tier only, in the folded sector (source skeleton).
  var branchDensity = 2.0 + clamp01(liveBranchCount) * 3.0;
  var branchCos = 0.75836188;
  var branchSin = 0.65183377;
  var tierIndex = floor((armAlong - 0.115) / 0.155);
  if (tierIndex < 0.0) tierIndex = 0.0;
  if (tierIndex > 4.0) tierIndex = 4.0;
  var tierJoin = 0.19 + tierOffset + tierIndex * 0.155;
  var tierLength = (0.19 + tierIndex * 0.006) * branchLengthScale;
  var tierGate = smooth01((crystalReach - tierJoin + 0.050) / 0.10);
  var tierActive = smooth01(branchDensity - tierIndex);
  var tierDistance = segmentDistance2(armAlong, armAcross, tierJoin, 0.0,
                       tierJoin + tierLength * branchCos,
                       tierLength * branchSin);
  var branchField = (1.0 - smoothstep(lineWidth2,
                    lineWidth2 * 6.5025, tierDistance))
                  * tierGate * tierActive;

  var nucleus = 1.0 - smoothstep(0.035 + thawSoftness * 0.025,
                                 0.19 + thawSoftness * 0.09, radial);
  var crystalAcc = mainArm * 1.12;
  crystalAcc = crystalAcc + branchField * 1.08;
  crystalAcc = crystalAcc + nucleus * 0.70;
  var crystal = clamp01(crystalAcc);
  // Restrained ice sheen travelling the arms keeps the held pose alive.
  var armSheen = wave(armAlong * 1.15 - cycleClock * 8.0);

  // Subdued faceted bed: the low-mid gray body between the arms.
  var facetPhase = frac(qx * 0.37 - qz * 0.29
                        + qy * PHI + cycleClock * 0.0175);
  var facet = 1.0 - abs(facetPhase - 0.5) * 2.0;
  facet = smooth01(facet);

  var lvl = 0.13 + facet * 0.16;
  lvl = lvl + crystal * 0.78;
  lvl = lvl + crystal * armSheen * 0.14;
  var nativeShare = 0.16 + crystal * 0.40;

  if (fixtureType == FIX_RAW_LED) {
    // Direct-view outline carries a firm arm trace at playa distance.
    lvl = 0.20 + facet * 0.08;
    lvl = lvl + mainArm * 0.62;
    lvl = lvl + branchField * 0.52;
    lvl = lvl + nucleus * 0.24;
    nativeShare = 0.18 + mainArm * 0.55;
  } else if (fixtureType == FIX_PAR) {
    // Organs are the quiet luminous nucleus.
    lvl = 0.18 + facet * 0.10;
    lvl = lvl + nucleus * 0.52;
    lvl = lvl + crystal * 0.14;
    nativeShare = 0.20 + nucleus * 0.45;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: brilliant ice tips at the crystal's reach.
    var tipDistance = abs(radial - crystalReach);
    var iceTip = 1.0 - smoothstep(0.025, 0.11, tipDistance);
    var sparseTip = pow(0.5 + 0.5 * cos(pixelLocalIndex * 2.39996323
                                        + sectorCenter * PHI
                                        + cycleClock * 0.13), 8.0);
    var tipAcc = iceTip * 0.70;
    tipAcc = tipAcc + branchField * sparseTip * 0.44;
    var tipPresence = clamp01(0.06 + tipAcc);
    lvl = 0.14 + facet * 0.10;
    lvl = lvl + crystal * 0.36;
    lvl = lvl + tipPresence * 0.42;
    nativeShare = 0.25 + tipPresence * 0.75;
  } else if (isSign) {
    // Exact paired miniature seals over a readable floor.
    var iceSheen = wave(ux * 0.69 + uz * 0.41 - cycleClock * 0.79)
                 * wave(uz * 0.61 - ux * 0.27 + cycleClock * 1.41421356);
    lvl = 0.30 + facet * 0.08;
    lvl = lvl + crystal * 0.48;
    lvl = lvl + iceSheen * 0.14;
    nativeShare = 0.20 + crystal * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
