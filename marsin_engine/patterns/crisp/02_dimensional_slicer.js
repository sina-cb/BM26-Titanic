// DRAFT — pending operator review
/*
  02_dimensional_slicer.js - DIMENSIONAL SLICER

  A sparse stack of one to three immense parallel cutting slabs traverses the
  ship. Each slab has two exposed endpoint-color faces, a razor-black kerf,
  luminous outer bevels, and moving architectural engraving. The stack rotates,
  shears its halves apart, and changes obliqueness without ever becoming a
  circle, orbit, wipe, full-field parity split, or flat two-color wall.

  FIX_BAR_18     - moving section lines across sparse engraved slab faces.
  FIX_RAW_LED    - razor bevels plus a traveling linear section mark.
  FIX_VINTAGE_6  - one smoothly circulating survey head per rail.
  FIX_PAR        - crossfaded cohorts at exposed slab edges.
  FIX_TE_SIGN    - complete complementary local-74 sectional drawings.

  AUDIO_MODULATION_V1:
    sliderSliceGap <- micLow range 0.08..0.50 curve ease # bass opens the master kerf
    sliderRotationPhase <- micMid range 0.05..0.42 curve linear # mids turn the slab stack
    sliderKickOffset <- micKick range 0.00..0.72 curve pow2 # kicks separate the cut faces
    sliderAxisWarp <- micFlux range 0.08..0.52 curve ease # flux folds and tilts the slab stack
  Static (unmapped) params: localSpeed, sliceCount, colorPalette1/2.
*/

export var cp1H = 0.035, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.545, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var sliceCount = 0.78;
export var rotationPhase = 0.12;
export var sliceGap = 0.12;
export var kickOffset = 0.00;
export var axisWarp = 0.22;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderSliceCount(value) { sliceCount = value; }
export function sliderRotationPhase(value) { rotationPhase = value; }
export function sliderSliceGap(value) { sliceGap = value; }
export function sliderKickOffset(value) { kickOffset = value; }
export function sliderAxisWarp(value) { axisWarp = value; }

var PI2_VALUE = 6.28318530718;
var GOLDEN_FRACTION = 0.61803399;

var PHASE_WRAP = 60.0;
var storyPhase = 0.0;
var cyclePhase = 0.0;
var livePlaneAmount = 0.78;
var liveRotation = 0.12;
var liveGap = 0.12;
var liveKick = 0.00;
var liveAxisWarp = 0.22;

var planeX = 0.72896863, planeY = 0.10126745, planeZ = 0.67691822;
var tangentX = -0.68092205, tangentZ = 0.73235587;
var scanOffset = 0.0;
var separationEnvelope = 0.0;
var secondaryWeight = 0.0;
var tertiaryWeight = 0.0;
var kerfWidth = 0.020;
var slabHalfWidth = 0.145;

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
  var followAmount = min(1.0, deltaSeconds * 6.5);
  livePlaneAmount += (clamp01(sliceCount) - livePlaneAmount) * followAmount;
  liveRotation += (clamp01(rotationPhase) - liveRotation) * followAmount;
  liveGap += (clamp01(sliceGap) - liveGap) * followAmount;
  liveKick += (clamp01(kickOffset) - liveKick) * followAmount;
  liveAxisWarp += (clamp01(axisWarp) - liveAxisWarp) * followAmount;

  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  storyPhase += deltaSeconds * (0.04 + speedMultiplier * 0.08);
  if (storyPhase >= PHASE_WRAP) storyPhase -= PHASE_WRAP;
  cyclePhase = frac(storyPhase);

  separationEnvelope = 0.35 + 0.65
    * pow(wave(storyPhase * 0.5 + 0.18), 3.0);
  secondaryWeight = smoother(0.16, 0.46, livePlaneAmount);
  tertiaryWeight = smoother(0.58, 0.90, livePlaneAmount);

  // Reduce every long-running angle to its exact local cycle before trig.
  // This avoids f32 range-reduction error becoming visible at razor edges.
  var planeAngle = liveRotation * PI2_VALUE
                 + frac(storyPhase * 0.20) * PI2_VALUE;
  planeX = cos(planeAngle);
  planeY = sin(liveRotation * PI2_VALUE * 1.5
    + frac(storyPhase * 0.30) * PI2_VALUE)
    * (0.035 + liveAxisWarp * 0.34);
  planeZ = sin(planeAngle);
  var planeNorm = sqrt(planeX * planeX + planeY * planeY + planeZ * planeZ);
  planeX /= planeNorm; planeY /= planeNorm; planeZ /= planeNorm;
  tangentX = -planeZ;
  tangentZ = planeX;
  scanOffset = 0.11 * sin(frac(storyPhase * 0.30) * PI2_VALUE);
  kerfWidth = 0.010 + liveGap * 0.085;
  slabHalfWidth = 0.065 + (1.0 - liveGap) * 0.045;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var slicerX = clamp01(x);
  var slicerY = clamp01(y);
  var slicerZ = clamp01(z);
  var slicerIdentity = fixtureType == FIX_TE_SIGN;
  var slicerSignPair = 0.0;
  if (slicerIdentity) {
    var slicerAddress = index % 74.0;
    slicerSignPair = floor(index / 74.0) % 2.0;
    slicerX = (slicerAddress % 10.0) / 9.0;
    slicerY = 0.5;
    slicerZ = floor(slicerAddress / 10.0) / 7.0;
    if (slicerSignPair) slicerX = 1.0 - slicerX;
  }

  var slicerCenteredX = slicerX - 0.5;
  var slicerCenteredY = slicerY - 0.5;
  var slicerCenteredZ = slicerZ - 0.5;
  var slicerSigned = slicerCenteredX * planeX
                   + slicerCenteredY * planeY
                   + slicerCenteredZ * planeZ;
  var slicerTangent = slicerCenteredX * tangentX
                    + slicerCenteredZ * tangentZ;
  var foldPhase = slicerTangent * PI2_VALUE
                + frac(storyPhase * 0.40) * PI2_VALUE;
  var foldedPlane = slicerSigned + slicerCenteredY
    * sin(foldPhase) * liveAxisWarp * 0.18;

  var winnerEnergy = 0.0;
  var winnerEdge = 0.0;
  var winnerColor2 = 0.0;
  var slabIndex = 0.0;
  for (slabIndex = 0.0; slabIndex < 3.0; slabIndex = slabIndex + 1.0) {
    var slabAuthority = slabIndex == 0.0 ? 1.0
      : (slabIndex == 1.0 ? secondaryWeight : tertiaryWeight);
    var lane = slabIndex - 1.0;
    var laneSpacing = 0.17 + liveAxisWarp * 0.09;
    var laneDrift = slabIndex == 0.0 ? scanOffset
      : -scanOffset * (0.38 + slabIndex * 0.17);
    var planeCoordinate = foldedPlane - lane * laneSpacing - laneDrift;
    var separatedDistance = abs(planeCoordinate)
      - liveKick * separationEnvelope * (0.045 + slabIndex * 0.018);
    var faceDistance = abs(separatedDistance);
    var localKerf = kerfWidth * (slicerIdentity ? 1.35 : 1.0);
    var localHalfWidth = slabHalfWidth * (1.0 - slabIndex * 0.10);
    var faceMask = smoothstep(localKerf, localKerf + 0.014, faceDistance)
      * (1.0 - smoothstep(localHalfWidth,
        localHalfWidth + (slicerIdentity ? 0.050 : 0.018), faceDistance));
    var innerBevel = 1.0 - smoothstep(0.004, 0.024,
      abs(faceDistance - localKerf));
    var outerBevel = 1.0 - smoothstep(0.005, 0.030,
      abs(faceDistance - localHalfWidth));

    var engravingCoordinate = 54.0
      + slicerTangent * (3.0 + slabIndex * 1.5)
      + slicerCenteredY * (2.0 + liveAxisWarp * 4.0)
      + storyPhase * (slabIndex == 1.0 ? -0.90 : 0.70)
      + slabIndex * 0.23;
    var engravingDistance = abs(frac(engravingCoordinate) - 0.5);
    var engravingRidge = 1.0 - smoothstep(0.035, 0.125,
      engravingDistance);
    var slabEnergy = faceMask * (0.20 + engravingRidge * 0.48);
    if (engravingDistance < 0.052 && faceDistance > localKerf + 0.025) {
      slabEnergy = 0.0;
    }
    slabEnergy = max(slabEnergy,
      max(innerBevel * 0.92, outerBevel * 0.78));
    slabEnergy *= slabAuthority;
    if (slabEnergy > winnerEnergy) {
      winnerEnergy = slabEnergy;
      winnerEdge = max(innerBevel, outerBevel) * slabAuthority;
      // Keep each physical slab on one endpoint ray. Switching colors on the
      // signed side of its moving centerline could flip a bright face in one
      // frame; the black kerf now separates stable alternating materials.
      winnerColor2 = slabIndex == 1.0;
    }
  }

  var slicerBrightness = winnerEnergy;
  var slicerUseColor2 = winnerColor2;
  if (fixtureType == FIX_BAR_18) {
    var barSection = frac(pixelLocalIndex / 18.0
      + storyPhase * 2.0 + fixtureId * 0.091);
    var barSectionLine = 1.0 - smoothstep(0.025, 0.085,
      abs(barSection - 0.5));
    slicerBrightness = max(slicerBrightness, barSectionLine * 0.24);
  } else if (fixtureType == FIX_RAW_LED) {
    var strandSection = frac(90.0 + pixelLocalIndex / 40.0
      - storyPhase * 1.5 + fixtureId * 0.113);
    var strandSectionLine = 1.0 - smoothstep(0.025, 0.080,
      abs(strandSection - 0.5));
    slicerBrightness = max(winnerEdge * 0.88, strandSectionLine * 0.44);
  } else if (fixtureType == FIX_VINTAGE_6) {
    var surveyPosition = frac(storyPhase * 0.50
      + fixtureId * GOLDEN_FRACTION / 6.0) * 6.0;
    var surveyDistance = abs(pixelLocalIndex - surveyPosition);
    surveyDistance = min(surveyDistance, 6.0 - surveyDistance);
    var surveyHead = 1.0 - smoothstep(0.16, 0.92, surveyDistance);
    slicerBrightness = surveyHead
      * (0.24 + separationEnvelope * liveKick * 0.12);
  } else if (fixtureType == FIX_PAR) {
    var parPosition = frac(storyPhase * 3.0) * 4.0;
    var parCohort = floor(fixtureId) % 4.0;
    var parDistance = abs(parCohort - parPosition);
    parDistance = min(parDistance, 4.0 - parDistance);
    var parGate = 1.0 - smoothstep(0.05, 0.46, parDistance);
    slicerBrightness = parGate * max(0.18, winnerEdge * 0.46);
  } else if (slicerIdentity) {
    var signKerf = frac(60.0 + slicerAddress / 74.0
      + storyPhase * (slicerSignPair ? -1.0 : 1.0)
      + slicerSignPair * 0.23);
    slicerBrightness *= smoothstep(0.030, 0.105, abs(signKerf - 0.5));
    if (slicerSignPair && slicerBrightness > 0.0) {
      slicerUseColor2 = !slicerUseColor2;
    }
  }

  slicerBrightness = clamp01(slicerBrightness);
  // A larger kerf removes emissive material as well as widening the black
  // interval. Default-centering preserves the saved .12 composition exactly.
  var gapRemoval = clamp01(max(0.0, liveGap - 0.12) / 0.88);
  var remainingMaterial = 0.12
    + 0.88 * (1.0 - gapRemoval) * (1.0 - gapRemoval);
  slicerBrightness *= remainingMaterial;
  if (slicerUseColor2) {
    rgbwau(pr2 * slicerBrightness, pg2 * slicerBrightness,
      pb2 * slicerBrightness, 0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * slicerBrightness, pg1 * slicerBrightness,
      pb1 * slicerBrightness, 0.0, 0.0, 0.0);
  }

  /* RETIRED PRE-REVIEW MATERIAL-PARITY IMPLEMENTATION
  var geometryX = clamp01(x);
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  var signPair = 0.0;

  if (isIdentity) {
    var localAddress = index % 74.0;
    signPair = floor(index / 74.0) % 2.0;
    geometryX = (localAddress % 10.0) / 9.0;
    geometryY = 0.5;
    geometryZ = floor(localAddress / 10.0) / 7.0;
    if (signPair) geometryX = 1.0 - geometryX;
  }

  var centeredX = geometryX - 0.5;
  var centeredY = geometryY - 0.5;
  var centeredZ = geometryZ - 0.5;
  var localOffset = isIdentity ? masterOffset * 0.35 : masterOffset;
  var localKerf = kerfWidth * (isIdentity ? 1.65 : 1.0);
  var resolvedKerfEdge = localKerf + liveGap * (isIdentity ? 0.12 : 0.08);
  var masterDistance = centeredX * masterX + centeredY * masterY
                     + centeredZ * masterZ - localOffset;
  var useColor2 = masterDistance < 0.0;
  var absoluteMaster = abs(masterDistance);
  var edgeWidth = isIdentity ? 0.036 : 0.011;
  var brightness = absoluteMaster < resolvedKerfEdge ? 0.0 : 0.78;
  if (absoluteMaster > resolvedKerfEdge + 0.16) brightness = 0.48;

  var cutX = geometryX - voidCenterX;
  var cutY = geometryY - voidCenterY;
  var cutZ = geometryZ - voidCenterZ;
  var boundMetric = cutX * cutX / 0.105
                  + cutY * cutY / 0.160
                  + cutZ * cutZ / 0.078;
  var insideBound = boundMetric < 1.0;
  var secondaryDistance = cutX * secondaryX + cutY * secondaryY
                        + cutZ * secondaryZ;
  var voidHalfWidth = secondaryWeight * (0.022 + liveVoidDepth * 0.085);
  var interiorFace = 1.0 - smoothstep(edgeWidth, edgeWidth * 3.2,
    abs(abs(secondaryDistance) - voidHalfWidth));

  if (insideBound && secondaryWeight > 0.0) {
    if (abs(secondaryDistance) < voidHalfWidth) {
      brightness = 0.0;
    } else if (interiorFace > 0.04) {
      brightness = max(brightness, interiorFace * 0.88);
      useColor2 = !useColor2;
    }
  }

  var tertiaryDistance = cutX * tertiaryX + cutY * tertiaryY
                       + cutZ * tertiaryZ;
  var interferenceCut = tertiaryWeight
    * (1.0 - smoothstep(0.006, 0.022, abs(tertiaryDistance)))
    * (1.0 - smoothstep(0.62, 0.98, boundMetric));
  if (interferenceCut > 0.22) brightness = 0.0;

  var contourCoordinate = absoluteMaster
                        * (3.0 + liveVoidDepth * 4.0 + livePlaneAmount * 10.0)
                        + abs(secondaryDistance) * (2.0 + tertiaryWeight * 2.0)
                        - storyPhase;
  var contourDistance = abs(frac(contourCoordinate) - 0.5);
  var contourBand = 1.0 - smoothstep(0.045, 0.145, contourDistance);
  var blackEngraving = contourDistance < (0.090 + secondaryWeight * 0.018);
  if (brightness > 0.0 && blackEngraving) {
    brightness = 0.0;
  } else if (brightness > 0.0 && contourBand > 0.08) {
    brightness = min(brightness, 0.20 + contourBand * 0.16);
  }

  var masterRim = 1.0 - smoothstep(edgeWidth * 0.6, edgeWidth * 2.4,
    abs(absoluteMaster - resolvedKerfEdge));
  var boundedRim = insideBound * secondaryWeight * interiorFace;

  if (fixtureType == FIX_BAR_18) {
    var barSurveyCoordinate = frac(pixelLocalIndex / 18.0
      + storyPhase * 7.0 + fixtureId * 0.091);
    var barSurveyDistance = abs(barSurveyCoordinate - 0.5);
    var barSurveyHead = 1.0 - smoothstep(0.025, 0.095,
      barSurveyDistance);
    brightness = max(brightness, barSurveyHead * 0.20);
  }

  if (fixtureType == FIX_RAW_LED) {
    var strandSurveyCoordinate = frac(pixelLocalIndex / 40.0
      - storyPhase * 6.0 + fixtureId * 0.113);
    var strandSurveyDistance = abs(strandSurveyCoordinate - 0.5);
    var strandSurveyHead = 1.0 - smoothstep(0.025, 0.080,
      strandSurveyDistance);
    brightness = max(strandSurveyHead * 0.20,
      max(masterRim * 0.92, boundedRim * 0.72));
    useColor2 = 0.0;
    if (interferenceCut > 0.22) brightness = 0.0;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var surveyHead = floor((storyPhase * 3.0
                          + fixtureId * GOLDEN_FRACTION) % 6.0);
    var surveyOpposite = (surveyHead + 3.0) % 6.0;
    var surveyGate = pixelLocalIndex == surveyHead;
    var oppositeGate = pixelLocalIndex == surveyOpposite;
    var spatialEdge = max(masterRim, boundedRim);
    var surveyPulse = 0.22 + 0.16
      * wave(storyPhase * 4.0 + fixtureId * 0.057);
    brightness = surveyGate * max(spatialEdge * 0.40, surveyPulse)
               + oppositeGate * boundedRim * separationEnvelope * 0.34;
  } else if (fixtureType == FIX_PAR) {
    var anchorCohort = floor(fixtureId + floor(storyPhase * 24.0)) % 4.0;
    var anchorGate = anchorCohort == 0.0;
    var planePressure = 1.0 - smoothstep(0.10, 0.52, absoluteMaster);
    var anchorEvent = pow(sin(cyclePhase * PI), 2.0);
    brightness = anchorGate * (0.18 + anchorEvent * 0.20)
               * (0.72 + planePressure * 0.24 + separationEnvelope * 0.08);
  } else if (isIdentity) {
    brightness = max(brightness, max(masterRim * 0.66, boundedRim * 0.58));
    // Each sign is a complete local-74 sectional drawing. A finite engraved
    // kerf travels through the whole drawing; the paired sign runs with the
    // opposite chirality and an offset phase, rather than serving as a static
    // obverse/reverse plaque or half of a split diagram.
    var signDirection = signPair ? -1.0 : 1.0;
    var signKerfPhase = frac(localAddress / 74.0
                           + storyPhase * signDirection
                           + signPair * 0.23);
    var signKerfDistance = abs(signKerfPhase - 0.5);
    brightness *= smoothstep(0.035, 0.105, signKerfDistance);
  }

  if (isIdentity && signPair && brightness > 0.0) useColor2 = !useColor2;

  // A wider physical gap must reduce total material on every fixture family;
  // this keeps sliderSliceGap truthful even on raw-edge-heavy small models.
  brightness *= 1.0 - liveGap * 0.45;
  brightness = clamp01(brightness);
  if (useColor2) {
    rgbwau(pr2 * brightness, pg2 * brightness, pb2 * brightness,
           0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * brightness, pg1 * brightness, pb1 * brightness,
           0.0, 0.0, 0.0);
  }
  */
}
