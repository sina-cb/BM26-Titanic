// DRAFT — pending operator review
/*
  17_frost_branch.js — FROST BRANCH

  CONCEPT
    One monumental sixfold ice crystal grows across the ship, holds as a
    complete emblem, then gently melts back toward its nucleus. It is a finite
    branching object—not a frond, noise wash, or endlessly repeating lattice.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad crystal body and beveled ice faces.
    FIX_RAW_LED    — bright six-arm outline that keeps the ship readable.
    FIX_VINTAGE_6  — sparse matched W+A ice tips over palette-derived RGB.
    FIX_PAR        — the calm luminous nucleus.
    FIX_TE_SIGN    — identical paired miniature snow seals, one per sign.

  MOTION / MATH
    Three analytic axis distances fold the X/Z plane into one 60-degree
    sector without per-pixel polar trigonometry. A finite center-arm segment
    and five finite angled branch pairs are evaluated in that folded sector,
    then unfolded by symmetry into one sixfold crystal. A piecewise
    grow/hold/melt envelope advances monotonically in each stage. The clock
    wraps only after 10000 identical cycles, so the wrap has no visible seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — complete grow/hold/melt cadence.
    branchCount — smoothly adds branch pairs from the nucleus toward the tips.
    growth      — maximum radial reach of the crystal.
    hold        — duration of the fully grown pose.
    melt        — duration and softness of the thawing retreat.
    jewelryIce  — matched native-white ice glints on Vintage fixtures only.
    safetyFloor — minimum whole-rig palette light between the crystal arms.

  AUDIO_MODULATION_V1:
    sliderGrowth     <- micFlux range 0.25..0.68 curve ease # flux expands the crystal reach
    sliderJewelryIce <- micHigh range 0.04..0.30 curve pow2 # highs brighten sparse ice tips
  Static (unmapped) params: localSpeed, branchCount, hold, melt, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB output lies strictly on the cp1-to-cp2 line. Only Vintage fixtures
    receive native white, always with W=A. UV is always zero. Silence retains
    a complete animated crystal and a whole-rig visibility floor.
*/

export var localSpeed = 0.30;
export var branchCount = 0.52;
export var growth = 0.58;
export var hold = 0.46;
export var melt = 0.34;
export var jewelryIce = 0.18;
export var safetyFloor = 0.24;

export var cp1H = 0.53, cp1S = 0.78, cp1V = 0.92;
export var cp2H = 0.69, cp2S = 0.56, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBranchCount(v) { branchCount = v; }
export function sliderGrowth(v) { growth = v; }
export function sliderHold(v) { hold = v; }
export function sliderMelt(v) { melt = v; }
export function sliderJewelryIce(v) { jewelryIce = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var PHASE_WRAP = 10000.0;

var cycleClock = 0.31;
var cycleStage = 0.72;
var crystalReach = 0.72;
var thawSoftness = 0.10;

var liveBranchCount = 0.52;
var liveGrowth = 0.58;
var liveHold = 0.46;
var liveMelt = 0.34;
var liveJewelryIce = 0.18;
var liveSafetyFloor = 0.24;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 5.0);
  liveBranchCount += (branchCount - liveBranchCount) * follow;
  liveGrowth += (growth - liveGrowth) * follow;
  liveHold += (hold - liveHold) * follow;
  liveMelt += (melt - liveMelt) * follow;
  liveJewelryIce += (jewelryIce - liveJewelryIce) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  cycleClock += dt * 0.030 * localMultiplier;
  if (cycleClock >= PHASE_WRAP) cycleClock -= PHASE_WRAP;

  var cyclePhase = cycleClock - floor(cycleClock);
  var holdPart = 0.08 + clamp01(liveHold) * 0.30;
  var meltPart = 0.13 + clamp01(liveMelt) * 0.27;
  var growPart = 1.0 - holdPart - meltPart;

  if (cyclePhase < growPart) {
    // Strictly monotonic outward growth.
    cycleStage = smooth01(cyclePhase / growPart);
  } else if (cyclePhase < growPart + holdPart) {
    cycleStage = 1.0;
  } else {
    // Strictly monotonic retreat during the thaw.
    var meltProgress = (cyclePhase - growPart - holdPart) / meltPart;
    var meltCurve = smooth01(meltProgress);
    cycleStage = 1.0 - meltCurve;
  }

  // Collapse the last numerical sliver of a zero-length segment smoothly.
  // Without this remap, the segment projection becomes ill-conditioned a few
  // ten-thousandths before the cycle boundary and can flash at the wrap.
  cycleStage = smooth01((cycleStage - 0.02) / 0.98);

  // Retain a tiny finite nucleus-arm at the turnaround. A mathematically
  // zero-length segment is ill-conditioned in the VM's projection math and
  // can jump for one frame; this 8% seed reads as the crystal's nucleus.
  crystalReach = (0.56 + clamp01(liveGrowth) * 0.54)
               * (0.08 + cycleStage * 0.92);
  thawSoftness = clamp01(liveMelt)
               * (0.14 + 0.86 * (1.0 - cycleStage));

  _hsv2rgb1();
  _hsv2rgb2();
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

  var qx = (ux - 0.50) * 1.50;
  var qz = (uz - 0.50) * 1.50;
  var qy = uy - 0.50;
  var radial = sqrt(qx * qx + qz * qz);

  // Distance to the nearest of three undirected axes gives six exact radial
  // arms. Selecting its signed projection is equivalent to polar sector
  // folding but avoids atan2/cos/sin for every Titanic pixel.
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

  // Melt makes the finite branch silhouette sag and soften without changing
  // its sixfold topology or causing a live-edit jump.
  var meltBend = sin((armAlong * 2.70 + qy * SQRT2) * PI2
                    + cycleClock * 0.17) * thawSoftness * 0.022;
  armAcross = abs(armAcross + meltBend);

  // Titanic's sparse physical points need a broad analytic stroke for the
  // six-arm emblem to survive playa distance. The inner core remains crisp;
  // thaw alone broadens the outer shoulder.
  var lineWidth = 0.045 + thawSoftness * 0.055;
  var lineWidth2 = lineWidth * lineWidth;
  var lineOuter2 = lineWidth2 * 7.0225;
  var mainOverrun = max(0.0, armAlong - crystalReach);
  var mainDistance = mainOverrun * mainOverrun + armAcross * armAcross;
  var mainArm = 1.0 - smoothstep(lineWidth2, lineOuter2,
                                mainDistance);

  // Five finite, paired branch tiers. Only the nearest tier can contribute to
  // a point in this folded sector, so evaluate that one segment instead of
  // five identical distance projections per pixel. This preserves the exact
  // topology while keeping the 40 fps Titanic budget comfortable.
  var branchDensity = 2.0 + clamp01(liveBranchCount) * 3.0;
  // cos(0.71) / sin(0.71), precomputed so every pixel does not pay for two
  // invariant trigonometric calls.
  var branchCos = 0.75836188;
  var branchSin = 0.65183377;
  var tierIndex = floor((armAlong - 0.115) / 0.155);
  if (tierIndex < 0.0) tierIndex = 0.0;
  if (tierIndex > 4.0) tierIndex = 4.0;
  var tierJoin = 0.19 + tierIndex * 0.155;
  var tierLength = 0.19 + tierIndex * 0.006;
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
  var crystal = clamp01(mainArm * 1.12 + branchField * 1.08
                       + nucleus * 0.70);
  // A restrained ice sheen keeps the held crystal visibly alive. It travels
  // along the existing six arms, so Local Speed has a monotonic temporal read
  // without changing the grow/hold/melt silhouette.
  var armSheen = wave(armAlong * 1.15 - cycleClock * 12.0);

  // A subdued faceted bed is subordinate to the one finite crystal. It keeps
  // every fixture visible without turning into a second lattice.
  var facetPhase = frac(qx * 0.37 - qz * 0.29
                       + qy * PHI + cycleClock * 0.0175);
  var facet = 1.0 - abs(facetPhase - 0.5) * 2.0;
  facet = smooth01(facet);
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.225;
  var brightness = floorLevel * (0.48 + facet * 0.12)
                 + (1.0 - floorLevel) * crystal * 1.08;
  var paletteMix = clamp01(0.16 + radial * 0.52
                          + branchField * 0.20 + facet * 0.08);

  if (fixtureType == FIX_RAW_LED) {
    // The direct-view outline carries a firm arm trace at playa distance.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01(0.06 + mainArm * 1.08 + branchField * 0.98
                        + nucleus * 0.40);
    paletteMix = clamp01(0.12 + radial * 0.66 + branchField * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the quiet core, never a flash or a generic full-rig punch.
    brightness = clamp01(floorLevel + 0.20 + nucleus * 0.62
                       + crystal * 0.16);
    paletteMix = clamp01(0.18 + radial * 0.26);
  } else if (isSign) {
    // Exact paired miniature seals: readable base plus six arms and branches.
    var iceSheen = wave(ux * 0.69 + uz * 0.41 - cycleClock * 0.79)
                 * wave(uz * 0.61 - ux * 0.27
                       + cycleClock * 1.41421356);
    brightness = clamp01(max(0.33, floorLevel + 0.14
                       + crystal * 0.82 + nucleus * 0.26
                       + iceSheen * 0.24));
    paletteMix = clamp01(0.10 + radial * 0.62 + branchField * 0.15
                       + iceSheen * 0.18);
  }

  var nativeWhite = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var tipDistance = abs(radial - crystalReach);
    var iceTip = 1.0 - smoothstep(0.025, 0.11, tipDistance);
    var sparseTip = pow(0.5 + 0.5 * cos(pixelLocalIndex * 2.39996323
                                      + sectorCenter * PHI
                                      + cycleClock * 0.13), 8.0);
    var tipPresence = clamp01(0.06 + iceTip * 0.70
                            + branchField * sparseTip * 0.44);
    brightness = clamp01(floorLevel * 0.78 + 0.10
                       + crystal * 0.48 + tipPresence * 0.18);
    paletteMix = clamp01(0.58 + radial * 0.28);
    nativeWhite = clamp01(liveJewelryIce * tipPresence
                        * (0.44 + cycleStage * 0.56));
  }

  brightness += crystal * armSheen * 0.18;
  paletteMix += (armSheen - 0.50) * crystal * 0.10;
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
