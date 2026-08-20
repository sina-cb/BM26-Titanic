// DRAFT — pending operator review
/*
  43_leaf_turn.js — LEAF TURN

  CONCEPT
    Two to five broad rigid leaves turn slowly in place. Each leaf is a true
    pointed lens with one midrib and two to five finite vein pairs. The leaves
    reveal opposite palette faces as they flip, but their centroids never move:
    these are botanical panels turning in air, not swimming wings.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad palette faces and their cosine flip shading.
    FIX_RAW_LED    — crisp lens edges and stationary midribs at distance.
    FIX_VINTAGE_6  — sparse native-white dew, always matched W=A.
    FIX_PAR        — warm stem anchors at the fixed leaf centroids.
    FIX_TE_SIGN    — paired full-surface leaf seals across both sign axes.

  MOTION / MATH
    Each pointed leaf is the intersection SDF of two equal circles whose
    centers sit on opposite sides of its midrib. Analytic rotation places that
    rigid lens in local coordinates. A cosine per leaf changes face shade and
    palette side while the SDF, midrib, finite veins, and centroid stay fixed.
    Irrational turn-rate ratios prevent the independent leaves from re-locking.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the independent in-place leaf turns.
    leafCount   — selects exactly two, three, four, or five leaves.
    leafSize    — length and breadth of every pointed lens.
    faceTurn   — depth of the in-place face shading and palette reversal.
    veinGlow    — strength of the stationary midribs and finite veins.
    jewelryDew — prominence of sparse Vintage-only corner dew.
    safetyFloor — protected whole-vessel visibility beneath the leaves.

  AUDIO_MODULATION_V1:
    sliderFaceTurn   <- micFlux range 0.22..0.58 curve ease # flux turns the palette faces
    sliderJewelryDew <- micHigh range 0.03..0.25 curve pow2 # highs catch sparse leaf dew
  Static (unmapped) params: localSpeed, leafCount, leafSize, veinGlow,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the straight cp1-to-cp2 segment. Only Vintage
    fixtures emit native white, with exact W=A. UV is always zero. A complete
    animated composition and nonblack whole-ship safety floor survive silence.
*/

export var cp1H = 0.355, cp1S = 0.76, cp1V = 0.88;
export var cp2H = 0.095, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var leafCount = 0.44;
export var leafSize = 0.48;
export var faceTurn = 0.38;
export var veinGlow = 0.56;
export var jewelryDew = 0.16;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLeafCount(v) { leafCount = v; }
export function sliderLeafSize(v) { leafSize = v; }
export function sliderFaceTurn(v) { faceTurn = v; }
export function sliderVeinGlow(v) { veinGlow = v; }
export function sliderJewelryDew(v) { jewelryDew = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var turnPhase = 0.119;
var turnCos0 = 1.0, turnCos1 = 1.0, turnCos2 = 1.0;
var turnCos3 = 1.0, turnCos4 = 1.0;
var worldReflectionX = 0.50;
var worldCanopyY = -0.18;
var activeLeafCount = 3.0;
var liveLeafLength = 0.175;
var liveLeafWidth = 0.082;
var liveLensOffset = 0.145;
var liveLensRadius = 0.227;
var liveLensRadiusSquared = 0.052;
var liveEdgeWidth = 0.018;
var liveVeinWidth = 0.007;
var liveLeafCount = 0.44;
var liveLeafSize = 0.48;
var liveFlip = 0.38;
var liveVeinGlow = 0.56;
var liveJewelryDew = 0.16;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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

  // Geometry and light controls converge so live edits do not teleport leaf
  // edges. The fixed leaf centers are constants in render3D and never follow.
  var follow = min(1.0, dt * 5.0);
  liveLeafCount += (leafCount - liveLeafCount) * follow;
  liveLeafSize += (leafSize - liveLeafSize) * follow;
  liveFlip += (faceTurn - liveFlip) * follow;
  liveVeinGlow += (veinGlow - liveVeinGlow) * follow;
  liveJewelryDew += (jewelryDew - liveJewelryDew) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  // Geometry shared by every leaf is frame-uniform and therefore belongs
  // here, not in the 964-pixel render path.
  activeLeafCount = floor(2.0 + clamp01(liveLeafCount) * 3.999);
  liveLeafLength = 0.125 + clamp01(liveLeafSize) * 0.105;
  liveLeafWidth = liveLeafLength * 0.47;
  liveLensOffset = (liveLeafLength * liveLeafLength
                   - liveLeafWidth * liveLeafWidth)
                 / (2.0 * liveLeafWidth);
  liveLensRadius = liveLensOffset + liveLeafWidth;
  liveLensRadiusSquared = liveLensRadius * liveLensRadius;
  liveEdgeWidth = 0.010 + liveLeafLength * 0.045;
  liveVeinWidth = 0.0036 + clamp01(liveVeinGlow) * 0.0064;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var signedFlip = clamp01(liveFlip) * 2.0 - 1.0;
  if (signedFlip >= 0.0 && signedFlip < 0.08) signedFlip = 0.08;
  else if (signedFlip < 0.0 && signedFlip > -0.08) signedFlip = -0.08;
  turnPhase += dt * (0.025 + localMultiplier * 0.100) * signedFlip;
  if (turnPhase >= PHASE_WRAP) turnPhase -= PHASE_WRAP;
  if (turnPhase < 0.0) turnPhase += PHASE_WRAP;
  // The rigid leaves stay fixed while one face reflection traverses them in
  // world X. It starts/ends beyond the model, making its sawtooth wrap dark
  // at both boundaries instead of jumping across lit pixels.
  worldReflectionX = -0.15 + 1.30 * (turnPhase - floor(turnPhase));
  worldCanopyY = -0.18 + 1.36 * (turnPhase - floor(turnPhase));

  // Turn cosines are frame-uniform. Compute them once here rather than once
  // per pixel for each leaf; their irrational rates still stay independent.
  turnCos0 = cos(turnPhase * PI2 * 0.540000 + 0.000000 + 0.37);
  turnCos1 = cos(turnPhase * PI2 * 0.735066 + 1.414214 + 0.37);
  turnCos2 = cos(turnPhase * PI2 * 0.750131 + 2.828427 + 0.37);
  turnCos3 = cos(turnPhase * PI2 * 0.945197 + 4.242641 + 0.37);
  turnCos4 = cos(turnPhase * PI2 * 0.960262 + 5.656854 + 0.37);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.86 + z * 0.14);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign is physically split into 40 + 34 fixtures. Fold the complete
    // model index so the lower fixture continues one 10x8 leaf-seal surface
    // and both 74-pixel diagrams remain byte-identical and animated.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  var leafFieldA = wave(px * 1.618 + py * 1.414 + turnPhase * 0.73);
  var leafFieldB = wave(px * 2.236 - py * 1.732 - turnPhase * 0.41);
  var leafField = leafFieldA * leafFieldB;
  var canopySweep = 1.0
    - smoothstep(0.0, 0.24, abs(py - worldCanopyY));

  var count = activeLeafCount;
  var leafLength = liveLeafLength;
  var leafWidth = liveLeafWidth;
  var lensCenterOffset = liveLensOffset;
  var lensRadius = liveLensRadius;
  var radiusSquared = liveLensRadiusSquared;
  var edgeWidth = liveEdgeWidth;
  var veinWidth = liveVeinWidth;
  var signedFlipAmount = clamp01(liveFlip) * 2.0 - 1.0;
  var flipAmount = 0.30 + abs(signedFlipAmount) * 0.70;

  var allFaces = 0.0;
  var allEdges = 0.0;
  var allMidribs = 0.0;
  var allVeins = 0.0;
  var allStems = 0.0;
  var allDew = 0.0;
  var allTurnHighlights = 0.0;
  var facePalette = 0.0;
  var faceWeight = 0.0;

  // The broad fixed leaves occupy disjoint spatial cells. Select the nearest
  // active cell rather than evaluating all five SDFs for every ship pixel;
  // every two-to-five leaf layout remains present and no centroid moves.
  var leafIndex = 0.0;
  if (count < 2.5) {
    if (px + py >= 1.0) leafIndex = 1.0;
  } else if (count < 3.5) {
    if (px < 0.50 && py >= 0.50) leafIndex = 2.0;
    else if (px + py >= 1.0) leafIndex = 1.0;
  } else {
    if (px < 0.50 && py >= 0.50) leafIndex = 2.0;
    else if (px >= 0.50 && py < 0.50) leafIndex = 3.0;
    else if (px >= 0.50 && py >= 0.50) leafIndex = 1.0;
    if (count >= 4.5 && abs(px - 0.50) + abs(py - 0.50) < 0.25) {
      leafIndex = 4.0;
    }
  }
  if (leafIndex < count) {
      var centerX = 0.50;
      var centerY = 0.50;
      var angleCos = -0.855166;
      var angleSin = 0.518354;
      var turnCosine = turnCos4;
      if (leafIndex == 0.0) {
        centerX = 0.24; centerY = 0.31;
        angleCos = 0.751806; angleSin = -0.659385; turnCosine = turnCos0;
      } else if (leafIndex == 1.0) {
        centerX = 0.73; centerY = 0.68;
        angleCos = -0.108950; angleSin = 0.994047; turnCosine = turnCos1;
      } else if (leafIndex == 2.0) {
        centerX = 0.27; centerY = 0.73;
        angleCos = -0.591133; angleSin = -0.806574; turnCosine = turnCos2;
      } else if (leafIndex == 3.0) {
        centerX = 0.72; centerY = 0.28;
        angleCos = 0.980716; angleSin = 0.195438; turnCosine = turnCos3;
      }
      var dx = px - centerX;
      var dy = py - centerY;
      var leafX = dx * angleCos + dy * angleSin;
      var leafY = -dx * angleSin + dy * angleCos;

      // Exact intersection of equal circles centered at ±offset on the local
      // Y axis. Its zero contour is a broad pointed lens with half-length
      // leafLength and half-width leafWidth.
      // Dividing the squared-circle residual by 2r is the local signed-distance
      // linearization at the contour. It preserves the same exact zero set as
      // the two square roots while keeping the 40 fps pixel path inexpensive.
      // max((y-c)^2, (y+c)^2) expands to y²+c²+2c|y|, so the
      // circle-intersection SDF needs only one residual evaluation.
      var lensSdf = (leafX * leafX + leafY * leafY
                    + lensCenterOffset * lensCenterOffset
                    + 2.0 * lensCenterOffset * abs(leafY) - radiusSquared)
                   / (2.0 * lensRadius);
      var insideLeaf = 1.0 - smoothstep(-edgeWidth, edgeWidth, lensSdf);
      var leafEdge = 1.0 - smoothstep(edgeWidth * 0.30,
                                     edgeWidth * 1.85, abs(lensSdf));

      var turnedFace = (1.0 - flipAmount) + flipAmount * turnCosine;
      var faceShade = 0.20 + 0.80 * abs(turnedFace);
      var paletteSide = 0.5 + 0.5 * turnedFace;
      var face = insideLeaf * faceShade;
      // A narrow face reflection crosses the fixed lens as it turns. Reversing
      // Flip reverses this light motion while the geometric centroid stays put.
      var turnHighlight = insideLeaf
        * clamp01(1.0 - abs(px - worldReflectionX) / 0.115);

      var midrib = 0.0;
      var leafVeins = 0.0;
      if (fixtureType == FIX_RAW_LED || isSign) {
        var midribGate = 1.0 - smoothstep(leafLength * 0.78,
                                         leafLength * 0.98, abs(leafX));
        midrib = (1.0 - smoothstep(veinWidth, veinWidth * 2.8,
                                  abs(leafY)))
               * midribGate * insideLeaf;

        // Each leaf carries 2–5 finite paired veins. A leaf-local cell selects
        // the one finite segment relevant to this pixel; reflecting local Y
        // evaluates both halves without an inner per-pixel vein loop.
        var veinCount = 2.0 + (leafIndex % 4.0);
        var normalizedLeafX = clamp01(leafX / (leafLength * 1.16) + 0.50);
        var veinIndex = floor(normalizedLeafX * veinCount);
        if (veinIndex >= veinCount) veinIndex = veinCount - 1.0;
        var veinFraction = (veinIndex + 1.0) / (veinCount + 1.0);
        var veinRootX = -leafLength * 0.58
                      + veinFraction * leafLength * 1.16;
        var veinVectorX = leafLength * (0.20 + veinFraction * 0.08);
        var veinVectorY = leafWidth
                        * (0.58 - abs(veinFraction - 0.5) * 0.28);
        var veinFromX = leafX - veinRootX;
        var veinFromY = abs(leafY);
        var veinLength2 = veinVectorX * veinVectorX
                        + veinVectorY * veinVectorY;
        var veinT = clamp01((veinFromX * veinVectorX
                           + veinFromY * veinVectorY) / veinLength2);
        var nearestX = veinRootX + veinT * veinVectorX;
        var nearestY = veinT * veinVectorY;
        var veinDeltaX = leafX - nearestX;
        var veinDeltaY = abs(leafY) - nearestY;
        var veinDistance2 = veinDeltaX * veinDeltaX
                          + veinDeltaY * veinDeltaY;
        leafVeins = (1.0 - smoothstep(veinWidth * veinWidth,
                                      veinWidth * veinWidth * 8.0,
                                      veinDistance2))
                   * insideLeaf;
      }

      var stem = 0.0;
      if (fixtureType == FIX_PAR) {
        var stemLength = leafLength * 0.34;
        var stemX = leafX + leafLength + stemLength * 0.50;
        stem = (1.0 - smoothstep(veinWidth * 1.2,
                                 veinWidth * 3.4, abs(leafY)))
             * (1.0 - smoothstep(stemLength * 0.48,
                                  stemLength * 0.56, abs(stemX)));
      }

      var dew = 0.0;
      if (fixtureType == FIX_VINTAGE_6) {
        var dewHash = 0.5 + 0.5
          * sin(pixelLocalIndex * GOLDEN_ANGLE + leafIndex * SQRT3 * 3.7);
        var dewGate = pow(dewHash, 12.0);
        dew = dewGate * leafEdge
            * (0.66 + 0.34 * abs(turnCosine));
      }

      allFaces = max(allFaces, face);
      allEdges = max(allEdges, leafEdge);
      allMidribs = max(allMidribs, midrib);
      allVeins = max(allVeins, leafVeins);
      allStems = max(allStems, stem);
      allDew = max(allDew, dew);
      allTurnHighlights = max(allTurnHighlights, turnHighlight);
      facePalette += face * paletteSide;
      faceWeight += face;
  }

  allFaces = clamp01(allFaces);
  allEdges = clamp01(allEdges);
  allMidribs = clamp01(allMidribs);
  allVeins = clamp01(allVeins);
  allStems = clamp01(allStems);
  allDew = clamp01(allDew);
  allTurnHighlights = clamp01(allTurnHighlights);
  var paletteFace = faceWeight > 0.0001
                  ? clamp01(facePalette / faceWeight) : 0.16;
  var veinFeature = max(allMidribs, allVeins);

  var floorLevel = 0.050 + clamp01(liveSafetyFloor) * 0.245;
  var veinAmount = clamp01(liveVeinGlow);
  var brightness = floorLevel + allFaces * 0.36
                 + allEdges * 0.32
                 + allTurnHighlights * 0.30
                 + allFaces * veinAmount * 0.30
                 + veinFeature * veinAmount * 0.72;
  var paletteMix = clamp01(0.10 + paletteFace * 0.76
                          + veinFeature * 0.10);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas carries broad, readable faces with clear front/back color.
    brightness = floorLevel + allFaces * (0.38 + veinAmount * 0.56)
               + allEdges * 0.28
               + allTurnHighlights * 0.36
               + veinFeature * veinAmount * 0.44;
    paletteMix = clamp01(0.06 + paletteFace * 0.82
                       + veinFeature * 0.08);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette privileges the rigid lens edges and stationary midrib network.
    brightness = floorLevel + 0.05 + allFaces * 0.10
               + allEdges * 0.68
               + allTurnHighlights * 0.42
               + allFaces * veinAmount * 0.42
               + veinFeature * veinAmount * 0.96;
    paletteMix = clamp01(0.10 + paletteFace * 0.62
                       + veinFeature * 0.22);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Dew is sparse and native white is exclusive to Vintage, with W=A.
    var dewLevel = allDew * clamp01(liveJewelryDew);
    brightness = floorLevel * 0.78 + 0.06
               + allFaces * 0.16 + allEdges * 0.18
               + dewLevel * 0.78;
    paletteMix = clamp01(0.14 + paletteFace * 0.66 + dewLevel * 0.16);
    nativeWhite = dewLevel * 0.58;
  } else if (fixtureType == FIX_PAR) {
    // Organs are the finite stems anchoring the otherwise broad face field.
    brightness = floorLevel + 0.11 + allStems * 0.66
               + allTurnHighlights * 0.30
               + allMidribs * veinAmount * 0.60
               + allFaces * 0.12;
    paletteMix = clamp01(0.10 + paletteFace * 0.58
                       + allStems * 0.26);
  } else if (isSign) {
    // Both Identity surfaces show the full local leaf-seal field above a firm
    // sign floor, including changing face, edge, midrib, and finite veins.
    brightness = max(0.32, floorLevel + 0.15
                   + allFaces * (0.24 + veinAmount * 0.52)
                   + allEdges * 0.40
                   + allTurnHighlights * 0.44
                   + veinFeature * veinAmount * 0.92);
    paletteMix = clamp01(0.08 + paletteFace * 0.74
                       + veinFeature * 0.16);
  }


  if (isSign) {
    brightness = max(0.22, brightness
      * (0.46 + leafField * 0.20 + canopySweep * 1.02));
    paletteMix = clamp01(paletteMix + leafField * 0.12
                        - canopySweep * 0.28);
  } else {
    brightness = max(floorLevel, brightness
      * (0.56 + leafField * 0.16 + canopySweep * 0.78));
    paletteMix = clamp01(paletteMix + leafField * 0.10
                        - canopySweep * 0.22);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
