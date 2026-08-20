// DRAFT — pending operator review
/*
  04_mechanical_aperture.js - MECHANICAL APERTURE

  Seven true overlapping convex blades form a giant iris. A continuous cam
  carries the mechanism through centered, elliptical, offset, dual-aperture,
  and rejoined states, then advances exactly one symmetric lock segment before
  the seamless loop boundary. No topology branch or floor resets ownership.

  FIX_BAR_18     - complete overlapping blade material and exposed chamber.
  FIX_RAW_LED    - blade tips, overlap seams, and chamber edge.
  FIX_VINTAGE_6  - at most two restrained latch pins during a cam advance.
  FIX_PAR        - sparse hub-load anchors spatially tied to blade edges.
  FIX_TE_SIGN    - complete local-74 counter-chiral paired iris diagrams.

  AUDIO_MODULATION_V1:
    sliderApertureSize <- micLow range 0.24..0.72 curve ease # bass opens the iris
    sliderBladeWarp <- micHigh range 0.08..0.32 curve linear # highs deform blade geometry
    sliderLockPhase <- micKick range 0.00..0.85 curve pow2 # kicks bias the next lock
    sliderOpeningBoost <- micFlux range 0.00..0.60 curve ease # flux expands exposed chamber space
  Static (unmapped) params: localSpeed, apertureOffset, colorPalette1/2.
*/

export var cp1H = 0.985, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.505, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var apertureSize = 0.42;
export var apertureOffset = 0.12;
export var bladeWarp = 0.16;
export var lockPhase = 0.00;
export var openingBoost = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderApertureSize(value) { apertureSize = value; }
export function sliderApertureOffset(value) { apertureOffset = value; }
export function sliderBladeWarp(value) { bladeWarp = value; }
export function sliderLockPhase(value) { lockPhase = value; }
export function sliderOpeningBoost(value) { openingBoost = value; }

var PI2_VALUE = 6.28318530718;
var BLADE_COUNT = 7;
var SECTOR_ANGLE = PI2_VALUE / 7.0;
var GOLDEN_FRACTION = 0.61803399;

var primaryCos = array(7);
var primarySin = array(7);
var secondaryCos = array(7);
var secondarySin = array(7);
var bladeBias = array(7);
var secondaryBias = array(7);

var storyPhase = 0.0;
var liveOpening = 0.42;
var liveOffset = 0.12;
var liveBladeShape = 0.16;
var liveLock = 0.00;
var liveBoost = 0.00;

var mechanismRotation = 0.0;
var ellipseEnvelope = 0.0;
var offsetEnvelope = 0.0;
var dualEnvelope = 0.0;
var clickEnvelope = 0.0;
var openingEnvelope = 0.0;
var resolvedOpening = 0.18;
var primaryCenterX = 0.5, primaryCenterZ = 0.5;
var secondaryCenterX = 0.5, secondaryCenterZ = 0.5;
var ellipseX = 1.0, ellipseZ = 1.0;
var bladeWidth = 0.20;
var bladeLean = 0.30;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smoother(lowValue, highValue, value) {
  var amount = clamp01((value - lowValue) / (highValue - lowValue));
  return amount * amount * amount * (amount * (amount * 6.0 - 15.0) + 10.0);
}

function windowEnvelope(value, riseStart, riseEnd, fallStart, fallEnd) {
  return smoother(riseStart, riseEnd, value)
       * (1.0 - smoother(fallStart, fallEnd, value));
}

function _hsv2rgb1() {
  var hueValue = cp1H - floor(cp1H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp1V * (1.0 - cp1S);
  var downValue = cp1V * (1.0 - fractionValue * cp1S);
  var upValue = cp1V * (1.0 - (1.0 - fractionValue) * cp1S);
  if      (sectorValue == 0.0) { pr1 = cp1V; pg1 = upValue;   pb1 = lowValue;  }
  else if (sectorValue == 1.0) { pr1 = downValue; pg1 = cp1V; pb1 = lowValue;  }
  else if (sectorValue == 2.0) { pr1 = lowValue; pg1 = cp1V; pb1 = upValue;    }
  else if (sectorValue == 3.0) { pr1 = lowValue; pg1 = downValue; pb1 = cp1V;  }
  else if (sectorValue == 4.0) { pr1 = upValue; pg1 = lowValue; pb1 = cp1V;    }
  else                          { pr1 = cp1V; pg1 = lowValue; pb1 = downValue;  }
}

function _hsv2rgb2() {
  var hueValue = cp2H - floor(cp2H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp2V * (1.0 - cp2S);
  var downValue = cp2V * (1.0 - fractionValue * cp2S);
  var upValue = cp2V * (1.0 - (1.0 - fractionValue) * cp2S);
  if      (sectorValue == 0.0) { pr2 = cp2V; pg2 = upValue;   pb2 = lowValue;  }
  else if (sectorValue == 1.0) { pr2 = downValue; pg2 = cp2V; pb2 = lowValue;  }
  else if (sectorValue == 2.0) { pr2 = lowValue; pg2 = cp2V; pb2 = upValue;    }
  else if (sectorValue == 3.0) { pr2 = lowValue; pg2 = downValue; pb2 = cp2V;  }
  else if (sectorValue == 4.0) { pr2 = upValue; pg2 = lowValue; pb2 = cp2V;    }
  else                          { pr2 = cp2V; pg2 = lowValue; pb2 = downValue;  }
}

export function beforeRender(delta) {
  var deltaSeconds = clamp(delta / 1000.0, 0.0, 0.1);
  var followAmount = min(1.0, deltaSeconds * 7.0);
  liveOpening += (clamp01(apertureSize) - liveOpening) * followAmount;
  liveOffset += (clamp01(apertureOffset) - liveOffset) * followAmount;
  liveBladeShape += (clamp01(bladeWarp) - liveBladeShape) * followAmount;
  liveLock += (clamp01(lockPhase) - liveLock) * followAmount;
  liveBoost += (clamp01(openingBoost) - liveBoost) * followAmount;

  var speedMultiplier = min(1.5,
    pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0));
  var highSpeedSlew = 1.0 - smoother(0.55, 1.0, localSpeed) * 0.80;
  storyPhase += deltaSeconds * (0.27 + speedMultiplier * 0.15) * highSpeedSlew;
  if (storyPhase >= 1.0) storyPhase -= 1.0;

  ellipseEnvelope = windowEnvelope(storyPhase, 0.05, 0.35, 0.42, 0.68);
  offsetEnvelope = windowEnvelope(storyPhase, 0.30, 0.44, 0.73, 0.88);
  dualEnvelope = windowEnvelope(storyPhase, 0.40, 0.62, 0.66, 0.78);
  clickEnvelope = windowEnvelope(storyPhase, 0.78, 0.84, 0.90, 0.94);
  var highSpeedGeometry = 0.35 + highSpeedSlew * 0.65;
  ellipseEnvelope *= highSpeedGeometry;
  offsetEnvelope *= highSpeedGeometry;
  dualEnvelope *= highSpeedGeometry;

  // Lock only after the dual apertures have rejoined. One complete sector is
  // geometrically identical at the loop boundary, and the zero-slope cam
  // removes the former sparse-pixel ownership pop.
  var camProgress = smoother(0.78, 0.94, storyPhase);
  mechanismRotation = (camProgress + liveLock * 0.42) * SECTOR_ANGLE;
  openingEnvelope = windowEnvelope(storyPhase, 0.06, 0.24, 0.70, 0.91);
  resolvedOpening = 0.070 + liveOpening * 0.170
                  + openingEnvelope * 0.090 * highSpeedGeometry
                  + liveBoost * 0.120;

  var centerTravel = offsetEnvelope * (liveOffset - 0.5) * 0.16;
  var splitDistance = dualEnvelope * (0.08 + liveOffset * 0.16);
  primaryCenterX = 0.5 + centerTravel - splitDistance;
  secondaryCenterX = 0.5 + centerTravel + splitDistance;
  primaryCenterZ = 0.5 + offsetEnvelope * 0.055;
  secondaryCenterZ = 0.5 - offsetEnvelope * 0.055;

  ellipseX = 1.0 + ellipseEnvelope * (0.18 + liveBladeShape * 0.18);
  ellipseZ = 1.0 - ellipseEnvelope * (0.08 + liveBladeShape * 0.06);
  bladeWidth = 0.175 + liveBladeShape * 0.075;
  bladeLean = 0.22 + liveBladeShape * 0.34;

  var bladeIndex = 0.0;
  for (bladeIndex = 0.0; bladeIndex < BLADE_COUNT; bladeIndex = bladeIndex + 1.0) {
    var bladeAngle = bladeIndex * SECTOR_ANGLE + mechanismRotation;
    var reverseAngle = bladeIndex * SECTOR_ANGLE - mechanismRotation;
    primaryCos[bladeIndex] = cos(bladeAngle);
    primarySin[bladeIndex] = sin(bladeAngle);
    secondaryCos[bladeIndex] = cos(reverseAngle);
    secondarySin[bladeIndex] = sin(reverseAngle);
    // Identical blade tips are what make a one-sector cam advance exactly
    // periodic for both counter-rotating mechanisms. Shape still acts through
    // bladeWidth and bladeLean; no blade identity survives the loop boundary.
    bladeBias[bladeIndex] = 0.0;
    secondaryBias[bladeIndex] = 0.0;
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geometryX = clamp01(x);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  var signPair = 0.0;

  if (isIdentity) {
    var localAddress = index % 74.0;
    signPair = floor(index / 74.0) % 2.0;
    geometryX = (localAddress % 10.0) / 9.0;
    geometryZ = floor(localAddress / 10.0) / 7.0;
    if (signPair) geometryX = 1.0 - geometryX;
  }

  var localPrimaryX = isIdentity ? 0.5 - dualEnvelope * 0.11 : primaryCenterX;
  var localPrimaryZ = isIdentity ? 0.5 + offsetEnvelope * 0.035 : primaryCenterZ;
  var localSecondaryX = isIdentity ? 0.5 + dualEnvelope * 0.11 : secondaryCenterX;
  var localSecondaryZ = isIdentity ? 0.5 - offsetEnvelope * 0.035 : secondaryCenterZ;

  var deltaPrimaryX = (geometryX - localPrimaryX) * ellipseX;
  var deltaPrimaryZ = (geometryZ - localPrimaryZ) * ellipseZ;
  var deltaSecondaryX = (geometryX - localSecondaryX) * ellipseX;
  var deltaSecondaryZ = (geometryZ - localSecondaryZ) * ellipseZ;

  var bestPrimary = 10.0;
  var secondPrimary = 10.0;
  var bestSecondary = 10.0;
  var secondSecondary = 10.0;
  var bladeIndex = 0.0;

  for (bladeIndex = 0.0; bladeIndex < BLADE_COUNT; bladeIndex = bladeIndex + 1.0) {
    var primaryCosine = signPair ? secondaryCos[bladeIndex] : primaryCos[bladeIndex];
    var primarySine = signPair ? -secondarySin[bladeIndex] : primarySin[bladeIndex];
    var secondaryCosine = signPair ? primaryCos[bladeIndex] : secondaryCos[bladeIndex];
    var secondarySine = signPair ? -primarySin[bladeIndex] : secondarySin[bladeIndex];

    var axialPrimary = deltaPrimaryX * primaryCosine
                     + deltaPrimaryZ * primarySine;
    var lateralPrimary = -deltaPrimaryX * primarySine
                       + deltaPrimaryZ * primaryCosine;
    var primaryTip = resolvedOpening + bladeBias[bladeIndex]
                   - (axialPrimary + lateralPrimary * bladeLean);
    var primarySide = abs(lateralPrimary - axialPrimary * 0.14)
                    - bladeWidth * (1.0 - axialPrimary * 0.16);
    var primaryCap = axialPrimary - 0.74;
    var primaryDistance = max(primaryTip, max(primarySide, primaryCap));
    if (primaryDistance < bestPrimary) {
      secondPrimary = bestPrimary;
      bestPrimary = primaryDistance;
    } else if (primaryDistance < secondPrimary) {
      secondPrimary = primaryDistance;
    }

    var axialSecondary = deltaSecondaryX * secondaryCosine
                       + deltaSecondaryZ * secondarySine;
    var lateralSecondary = -deltaSecondaryX * secondarySine
                         + deltaSecondaryZ * secondaryCosine;
    var secondaryTip = resolvedOpening - secondaryBias[bladeIndex]
                     - (axialSecondary - lateralSecondary * bladeLean);
    var secondarySide = abs(lateralSecondary + axialSecondary * 0.14)
                      - bladeWidth * (1.0 - axialSecondary * 0.16);
    var secondaryCap = axialSecondary - 0.74;
    var secondaryDistance = max(secondaryTip, max(secondarySide, secondaryCap));
    if (secondaryDistance < bestSecondary) {
      secondSecondary = bestSecondary;
      bestSecondary = secondaryDistance;
    } else if (secondaryDistance < secondSecondary) {
      secondSecondary = secondaryDistance;
    }
  }

  var dualDistance = max(bestPrimary, bestSecondary);
  var combinedDistance = mix(bestPrimary, dualDistance, dualEnvelope);
  var bladeMaterial = combinedDistance < 0.0;
  var useColor2 = !bladeMaterial;
  if (isIdentity && signPair) useColor2 = !useColor2;

  var edgeWidth = isIdentity ? 0.036 : 0.012;
  var edgeEnergy = 1.0 - smoothstep(edgeWidth, edgeWidth * 3.0,
    abs(combinedDistance));
  var overlapDifference = min(secondPrimary - bestPrimary,
                              secondSecondary - bestSecondary);
  var seamEnergy = bladeMaterial
    * (1.0 - smoothstep(0.008, 0.038, overlapDifference));

  var brightness = bladeMaterial ? 0.72 : 0.54;
  if (abs(combinedDistance) > 0.18) brightness = bladeMaterial ? 0.42 : 0.30;
  brightness = max(brightness, edgeEnergy * 0.88);
  var fixedCutWidth = isIdentity ? 0.040 : 0.022;
  var fixedMechanicalCut = abs((geometryX - 0.5) - (geometryZ - 0.5))
                         < fixedCutWidth
                         || abs((geometryX - 0.5) + (geometryZ - 0.5))
                         < fixedCutWidth;
  if (fixedMechanicalCut || edgeEnergy > 0.80 || seamEnergy > 0.80) {
    brightness = 0.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    brightness = max(0.018, max(edgeEnergy * 0.92, seamEnergy * 0.68));
    // Raw is the mechanism's dedicated Color-1 metal edge. Keeping that
    // endpoint stable prevents an edge crossing from also becoming a full
    // A/B ownership flip at high transport speed.
    useColor2 = 0.0;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var latchHead = floor((storyPhase * 2.0
                         + fixtureId * GOLDEN_FRACTION) % 6.0);
    var latchMate = (latchHead + 3.0) % 6.0;
    var latchGate = pixelLocalIndex == latchHead;
    var mateGate = pixelLocalIndex == latchMate;
    var spatialLatch = max(edgeEnergy, seamEnergy);
    brightness = latchGate * spatialLatch * 0.38
               + mateGate * spatialLatch * clickEnvelope * 0.34;
    useColor2 = 0.0;
  } else if (fixtureType == FIX_PAR) {
    var anchorGate = frac(fixtureId * GOLDEN_FRACTION) < 0.36;
    brightness = anchorGate * edgeEnergy * (0.28 + openingEnvelope * 0.20);
    useColor2 = 0.0;
  } else if (isIdentity) {
    brightness = max(brightness, seamEnergy * 0.70);
    // Each local-74 sign keeps its complete counterposed endpoint while the
    // iris drawing itself animates in brightness and black-space geometry.
    useColor2 = signPair;
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
