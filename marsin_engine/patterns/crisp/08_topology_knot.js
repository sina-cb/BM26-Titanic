// DRAFT — pending operator review
/*
  08_topology_knot.js — TOPOLOGY KNOT

  Two broad swept ribbon surfaces cross directly on the ship's lit skin. A
  cubic crossing polynomial creates three explicit crossings; alternating
  black undercuts establish front/back order. The knot tightens, releases into
  open bands, and returns continuously without a torus hidden in empty space.

  FIX_BAR_18     — both wide ribbons, three crossings, and black undercuts.
  FIX_RAW_LED    — ribbon edges and underpass cuts only.
  FIX_VINTAGE_6  — at most two separated crossing beads per six-head rail.
  FIX_PAR        — sparse anchors at physical crossings; no baseline.
  FIX_TE_SIGN    — two complete 74-pixel knots with opposite chirality/order.

  AUDIO_MODULATION_V1:
    sliderRibbonWidth <- micLow range 0.20..0.52 curve ease # bass widens the two physical bands
    sliderTwistAmount <- micFlux range 0.16..0.84 curve ease # flux increases crossing separation and roll
    sliderDepthOrder <- micMid range 0.20..0.72 curve linear # mids deepen the black underpass cuts
  Static (unmapped) params: localSpeed, knotTightness, release,
    colorPalette1/2.

  Every lit RGB pixel is one exact endpoint at a dark body, core, or edge
  intensity. Undercuts and the field outside both ribbons are black. W=A=U=0.
*/

export var cp1H = 0.035, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.535, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var ribbonWidth = 0.40;
export var knotTightness = 0.62;
export var twist = 0.48;
export var depthOrder = 0.60;
export var release = 0.16;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderRibbonWidth(value) { ribbonWidth = value; }
export function sliderTightnessAmount(value) { knotTightness = value; }
export function sliderTwistAmount(value) { twist = value; }
export function sliderDepthOrder(value) { depthOrder = value; }
export function sliderRelease(value) { release = value; }

var PHASE_WRAP = 60.0;
var storyPhase = 0.0;

var liveWidth = 0.40;
var liveTightness = 0.62;
var liveTwist = 0.48;
var liveDepthOrder = 0.60;
var liveRelease = 0.16;
var authoredWidth = 0.40;
var authoredTightness = 0.62;
var authoredTwist = 0.48;
var authoredDepthOrder = 0.60;
var authoredRelease = 0.16;
var effectiveTightness = 0.62;
var effectiveRelease = 0.16;
var crossing1 = 0.24, crossing2 = 0.50, crossing3 = 0.76;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function _hsv2rgb1() {
  var hueValue = cp1H - floor(cp1H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp1V * (1.0 - cp1S);
  var downValue = cp1V * (1.0 - fractionValue * cp1S);
  var upValue = cp1V * (1.0 - (1.0 - fractionValue) * cp1S);
  if      (sectorValue == 0.0) { pr1 = cp1V; pg1 = upValue; pb1 = lowValue; }
  else if (sectorValue == 1.0) { pr1 = downValue; pg1 = cp1V; pb1 = lowValue; }
  else if (sectorValue == 2.0) { pr1 = lowValue; pg1 = cp1V; pb1 = upValue; }
  else if (sectorValue == 3.0) { pr1 = lowValue; pg1 = downValue; pb1 = cp1V; }
  else if (sectorValue == 4.0) { pr1 = upValue; pg1 = lowValue; pb1 = cp1V; }
  else                          { pr1 = cp1V; pg1 = lowValue; pb1 = downValue; }
}

function _hsv2rgb2() {
  var hueValue = cp2H - floor(cp2H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp2V * (1.0 - cp2S);
  var downValue = cp2V * (1.0 - fractionValue * cp2S);
  var upValue = cp2V * (1.0 - (1.0 - fractionValue) * cp2S);
  if      (sectorValue == 0.0) { pr2 = cp2V; pg2 = upValue; pb2 = lowValue; }
  else if (sectorValue == 1.0) { pr2 = downValue; pg2 = cp2V; pb2 = lowValue; }
  else if (sectorValue == 2.0) { pr2 = lowValue; pg2 = cp2V; pb2 = upValue; }
  else if (sectorValue == 3.0) { pr2 = lowValue; pg2 = downValue; pb2 = cp2V; }
  else if (sectorValue == 4.0) { pr2 = upValue; pg2 = lowValue; pb2 = cp2V; }
  else                          { pr2 = cp2V; pg2 = lowValue; pb2 = downValue; }
}

export function beforeRender(delta) {
  var deltaSeconds = delta / 1000.0;
  if (deltaSeconds < 0.0) deltaSeconds = 0.0;
  if (deltaSeconds > 0.1) deltaSeconds = 0.1;

  var followRate = min(1.0, deltaSeconds * 7.0);
  liveWidth += (clamp01(ribbonWidth) - liveWidth) * followRate;
  liveTightness += (clamp01(knotTightness) - liveTightness) * followRate;
  liveTwist += (clamp01(twist) - liveTwist) * followRate;
  liveDepthOrder += (clamp01(depthOrder) - liveDepthOrder) * followRate;
  liveRelease += (clamp01(release) - liveRelease) * followRate;

  authoredWidth = clamp01(0.40 + (liveWidth - 0.40) * 1.60);
  authoredTightness = clamp01(0.62 + (liveTightness - 0.62) * 1.65);
  authoredTwist = clamp01(0.48 + (liveTwist - 0.48) * 1.55);
  authoredDepthOrder = clamp01(0.60 + (liveDepthOrder - 0.60) * 1.75);
  authoredRelease = clamp01(0.16 + (liveRelease - 0.16) * 2.10);

  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  storyPhase += deltaSeconds * (0.06 + localMultiplier * 0.22);
  if (storyPhase >= PHASE_WRAP) storyPhase -= PHASE_WRAP;

  var autonomousTightness = wave(storyPhase + 0.25);
  effectiveTightness = clamp01(authoredTightness * 0.58
                             + autonomousTightness * 0.58);
  effectiveRelease = clamp01(authoredRelease * 0.48
                           + (1.0 - autonomousTightness) * 0.72);
  crossing1 = 0.17 + effectiveTightness * 0.13;
  crossing2 = 0.50 + 0.035 * sin(storyPhase * PI2);
  crossing3 = 0.83 - effectiveTightness * 0.13;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var worldX = clamp01(x);
  var geometryX = worldX;
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var signSide = worldX < 0.5 ? -1.0 : 1.0;
  var isIdentity = fixtureType == FIX_TE_SIGN;

  if (isIdentity) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signZ = floor(signAddress / 10.0) / 7.0;
    if (signSide > 0.0) signX = 1.0 - signX;

    var signAngle = storyPhase * PI2 + signSide * 0.72;
    var signTightness = clamp01(effectiveTightness
      + 0.12 * sin(signAngle));
    var signCross1 = 0.17 + signTightness * 0.13;
    var signCross2 = 0.50 + 0.035 * sin(signAngle);
    var signCross3 = 0.83 - signTightness * 0.13;
    var signPolynomial = (signZ - signCross1)
                       * (signZ - signCross2)
                       * (signZ - signCross3);
    var signBase = 0.50 + 0.055 * sin(signAngle + signZ * PI2);
    var signSeparation = (3.0 + authoredTwist * 1.4) * signPolynomial
                       + signSide * effectiveRelease * 0.07;
    var signCenterA = signBase + signSeparation;
    var signCenterB = signBase - signSeparation;
    var signHalfWidth = 0.055 + authoredWidth * 0.095;
    var signDistanceA = abs(signX - signCenterA);
    var signDistanceB = abs(signX - signCenterB);
    var signBandA = 1.0 - smoothstep(signHalfWidth,
      signHalfWidth + 0.045, signDistanceA);
    var signBandB = 1.0 - smoothstep(signHalfWidth,
      signHalfWidth + 0.045, signDistanceB);
    var signCrossingSpan = 0.075 + authoredDepthOrder * 0.120;
    var signWindow1 = 1.0 - smoothstep(0.035, signCrossingSpan,
      abs(signZ - signCross1));
    var signWindow2 = 1.0 - smoothstep(0.035, signCrossingSpan,
      abs(signZ - signCross2));
    var signWindow3 = 1.0 - smoothstep(0.035, signCrossingSpan,
      abs(signZ - signCross3));
    var signFrontA = signSide > 0.0
      ? signWindow2 : max(signWindow1, signWindow3);
    var signFrontB = signSide > 0.0
      ? max(signWindow1, signWindow3) : signWindow2;
    signBandA *= 1.0 - signFrontB * authoredDepthOrder;
    signBandB *= 1.0 - signFrontA * authoredDepthOrder;
    var signBrightness = 0.0;
    var signUseColor2 = 0.0;
    if (signBandB > signBandA) {
      signBrightness = signBandB * 0.76;
      signUseColor2 = 1.0;
    } else {
      signBrightness = signBandA * 0.76;
    }
    signBrightness = clamp01(signBrightness);
    if (signUseColor2) {
      rgbwau(pr2 * signBrightness, pg2 * signBrightness,
             pb2 * signBrightness, 0.0, 0.0, 0.0);
    } else {
      rgbwau(pr1 * signBrightness, pg1 * signBrightness,
             pb1 * signBrightness, 0.0, 0.0, 0.0);
    }
    return;
  }

  // The hull halves are rotated relative to one another. Fold lateral space
  // and project each side onto its own measured back-to-front axis so the same
  // knot is genuinely mirrored across port/starboard instead of accidentally
  // favoring the nearly constant-Z port walls. Coefficients are derived from
  // docs/TITANIC_MODEL.md §2.3 and guarded by the Titanic census test.
  if (worldX < 0.5) {
    geometryX = clamp01(worldX * 2.0);
    geometryZ = clamp01(-1.79700894 - worldX * 0.11474992
      + geometryZ * 2.83326358);
  } else {
    geometryX = clamp01((1.0 - worldX) * 2.0);
    geometryZ = clamp01(-3.43690226 + worldX * 3.91460429
      + geometryZ * 2.23087587);
  }

  var storyAngle = storyPhase * PI2;
  var surfaceTilt = (geometryY - 0.5)
                  * (0.08 + authoredTwist * 0.18);
  var projectedX = geometryX + surfaceTilt * cos(storyAngle + geometryZ * PI2);
  var baseCenter = 0.50 + 0.055
    * sin(storyAngle + geometryZ * PI2 * 0.72);
  var crossingPolynomial = (geometryZ - crossing1)
                         * (geometryZ - crossing2)
                         * (geometryZ - crossing3);
  var separationScale = 3.1 + authoredTwist * 1.8;
  var releaseBias = effectiveRelease * 0.10 * sin(storyAngle + 0.6);
  var pathSeparation = crossingPolynomial * separationScale + releaseBias;
  var centerA = baseCenter + pathSeparation;
  var centerB = baseCenter - pathSeparation;

  var halfWidth = 0.075 + authoredWidth * 0.160;
  var edgeWidth = 0.016;
  var distanceA = abs(projectedX - centerA);
  var distanceB = abs(projectedX - centerB);
  var bandA = 1.0 - smoothstep(halfWidth,
    halfWidth + edgeWidth, distanceA);
  var bandB = 1.0 - smoothstep(halfWidth,
    halfWidth + edgeWidth, distanceB);
  var edgeA = 1.0 - smoothstep(0.004, 0.026,
    abs(distanceA - halfWidth));
  var edgeB = 1.0 - smoothstep(0.004, 0.026,
    abs(distanceB - halfWidth));

  var crossingSpan = 0.075 + authoredDepthOrder * 0.140;
  var crossingWindow1 = 1.0 - smoothstep(0.030, crossingSpan,
    abs(geometryZ - crossing1));
  var crossingWindow2 = 1.0 - smoothstep(0.030, crossingSpan,
    abs(geometryZ - crossing2));
  var crossingWindow3 = 1.0 - smoothstep(0.030, crossingSpan,
    abs(geometryZ - crossing3));
  var frontAWindow = max(crossingWindow1, crossingWindow3);
  var frontBWindow = crossingWindow2;
  var undercutDepth = 0.15 + authoredDepthOrder * 0.85;
  var visibleA = bandA * (1.0 - frontBWindow * undercutDepth);
  var visibleB = bandB * (1.0 - frontAWindow * undercutDepth);
  var visibleEdgeA = edgeA * (1.0 - frontBWindow * undercutDepth);
  var visibleEdgeB = edgeB * (1.0 - frontAWindow * undercutDepth);
  var coreA = (1.0 - smoothstep(0.0, halfWidth * 0.28, distanceA))
            * (1.0 - frontBWindow * undercutDepth);
  var coreB = (1.0 - smoothstep(0.0, halfWidth * 0.28, distanceB))
            * (1.0 - frontAWindow * undercutDepth);
  var weaveDistance = abs(frac(geometryZ * 3.0
                             + storyPhase * 0.5) - 0.5);
  var weaveCut = 1.0 - smoothstep(0.040, 0.105, weaveDistance);

  var brightness = 0.0;
  var useColor2 = 0.0;
  if (visibleB > visibleA) {
    brightness = visibleB * 0.34 * (1.0 - weaveCut * 0.76);
    brightness = max(brightness, max(visibleEdgeB * 0.90, coreB * 0.72));
    useColor2 = 1.0;
  } else {
    brightness = visibleA * 0.34 * (1.0 - weaveCut * 0.76);
    brightness = max(brightness, max(visibleEdgeA * 0.90, coreA * 0.72));
  }

  if (fixtureType == FIX_BAR_18) {
    var hullBraidCoordinate = frac(pixelLocalIndex / 18.0
      + storyPhase * 1.70 + fixtureId * 0.071);
    var hullBraidDistance = abs(hullBraidCoordinate - 0.5);
    var hullBraidNode = 1.0 - smoothstep(0.030, 0.100,
      hullBraidDistance);
    brightness = max(brightness, hullBraidNode
      * (0.20 + effectiveTightness * 0.24));
    if (hullBraidCoordinate > 0.5) useColor2 = 1.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    var strandBraidCoordinate = frac(87.0 + pixelLocalIndex / 40.0
      - storyPhase * 1.45 + fixtureId * 0.127);
    var strandBraidDistance = abs(strandBraidCoordinate - 0.5);
    var strandBraidNode = 1.0 - smoothstep(0.025, 0.082,
      strandBraidDistance);
    if (visibleEdgeB > visibleEdgeA) {
      brightness = max(visibleEdgeB * 0.72, strandBraidNode * 0.60);
      useColor2 = 1.0;
    } else {
      brightness = max(visibleEdgeA * 0.72, strandBraidNode * 0.60);
      useColor2 = 0.0;
    }
  } else if (fixtureType == FIX_VINTAGE_6) {
    var localCrossingPulse = pow(wave(storyPhase
      + geometryZ * 0.48), 3.0);
    var beadHead = floor((storyPhase * 4.0
                       + fixtureId * 0.61803399) % 6.0);
    var beadOpposite = (beadHead + 3.0) % 6.0;
    var beadPair = pixelLocalIndex == beadHead
                || pixelLocalIndex == beadOpposite;
    var frontIsB = frontBWindow > frontAWindow;
    brightness = beadPair * localCrossingPulse * 0.46;
    useColor2 = frontIsB;
  } else if (fixtureType == FIX_PAR) {
    var centerDistance = min(distanceA, distanceB);
    var crossingNear = max(crossingWindow1,
      max(crossingWindow2, crossingWindow3));
    var anchor = (1.0 - smoothstep(0.03, 0.13, centerDistance))
               * crossingNear;
    var passagePosition = crossing1
      + (crossing3 - crossing1) * wave(storyPhase + 0.12);
    var passageWindow = 1.0 - smoothstep(0.025, 0.080,
      abs(geometryZ - passagePosition));
    var parCohort = floor(fixtureId + floor(storyPhase * 8.0)) % 4.0;
    var parGate = parCohort == 0.0;
    brightness = parGate * max(0.18,
      max(anchor * 0.22, passageWindow * 0.42))
               * (0.62 + authoredDepthOrder * 0.34);
    useColor2 = distanceB < distanceA;
  }

  brightness = clamp01(brightness);
  if (useColor2) {
    rgbwau(pr2 * brightness, pg2 * brightness, pb2 * brightness,
           0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * brightness, pg1 * brightness, pb1 * brightness,
           0.0, 0.0, 0.0);
  }
}
