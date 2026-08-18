// DRAFT — pending operator review
/*
  01_orbiting_circle.js - ORBITING CIRCLE

  Two aspect-corrected planetary discs and one satellite travel around a
  common focus. Filled endpoint-color bodies carry moving nested cartographic
  contours; black moats, analytic rims, and deterministic eclipse seams keep
  the circles legible on Titanic's sparse physical map.

  FIX_BAR_18     - filled planetary bodies, moats, and eclipses.
  FIX_RAW_LED    - circle rims and eclipse seams only.
  FIX_VINTAGE_6  - at most two dim conjunction markers per rail.
  FIX_PAR        - sparse mass anchors only when a body is present.
  FIX_TE_SIGN    - two complete complementary local-74 orbit diagrams.

  Every lit RGB pixel is a scalar multiple of exactly one palette endpoint.
  Black is structural; W=A=U=0. There is no random/noise or render allocation.

  AUDIO_MODULATION_V1:
    sliderBodyRadius <- micLow range 0.38..0.72 curve ease # bass increases planetary mass
    sliderSpacing <- micMid range 0.30..0.78 curve linear # mids open orbital eccentricity
    sliderTrail <- micFlux range 0.18..0.62 curve ease # flux widens the black eclipse moat
    sliderCount <- micKick range 0.00..1.00 curve pow2 # kicks introduce the satellite
  Static (unmapped) params: localSpeed, safetyFloor, colorPalette1/2.
*/

export var cp1H = 0.040, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.520, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var bodyRadius = 0.56;
export var count = 0.50;
export var spacing = 0.58;
export var trail = 0.46;
export var safetyFloor = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderBodyRadius(value) { bodyRadius = value; }
export function sliderCount(value) { count = value; }
export function sliderSpacing(value) { spacing = value; }
export function sliderTrail(value) { trail = value; }
export function sliderSafetyFloor(value) { safetyFloor = value; }

var PI2_VALUE = 6.28318530718;
var GOLDEN_FRACTION = 0.61803399;
var BODY_COUNT = 3;
var ASPECT_X = 1.72;

var bodyX = array(3);
var bodyZ = array(3);
var bodySize = array(3);

var storyPhase = 0.0;
var detailPhase = 0.0;
var liveRadius = 0.56;
var liveCount = 0.50;
var liveSpacing = 0.58;
var authoredSpacing = 0.58;
var liveMoat = 0.46;
var liveSilhouette = 0.00;
var activeBodies = 3.0;
var eclipseEnvelope = 0.0;

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
  liveRadius += (clamp01(bodyRadius) - liveRadius) * followAmount;
  liveCount += (clamp01(count) - liveCount) * followAmount;
  liveSpacing += (clamp01(spacing) - liveSpacing) * followAmount;
  liveMoat += (clamp01(trail) - liveMoat) * followAmount;
  liveSilhouette += (clamp01(safetyFloor) - liveSilhouette) * followAmount;
  authoredSpacing = clamp01(0.58 + (liveSpacing - 0.58) * 1.65);

  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var phaseStep = deltaSeconds * (0.28 + speedMultiplier * 0.14);
  storyPhase += phaseStep;
  if (storyPhase >= 1.0) storyPhase -= 1.0;
  detailPhase += phaseStep;
  if (detailPhase >= 10.0) detailPhase -= 10.0;

  // Count is literal: low selects one primary, middle adds its peer, and the
  // upper range introduces the satellite. The saved .50 composition remains
  // the complete two-disc-plus-satellite hierarchy.
  if (liveCount < 0.18) activeBodies = 1.0;
  else if (liveCount < 0.44) activeBodies = 2.0;
  else activeBodies = 3.0;
  eclipseEnvelope = windowEnvelope(storyPhase, 0.25, 0.38, 0.62, 0.78);

  var orbitAngle = storyPhase * PI2_VALUE;
  var orbitSpread = 0.15 + authoredSpacing * 0.12;
  var approach = eclipseEnvelope * (0.08 + authoredSpacing * 0.05);
  var focusX = 0.5 + 0.025 * sin(orbitAngle * 2.0);
  var focusZ = 0.5 + 0.035 * cos(orbitAngle);

  bodyX[0] = focusX + (orbitSpread - approach) * cos(orbitAngle);
  bodyZ[0] = focusZ + (0.11 + authoredSpacing * 0.055 - approach * 0.45)
    * sin(orbitAngle);
  bodyX[1] = focusX + (orbitSpread * 0.92 - approach) * cos(orbitAngle + PI);
  bodyZ[1] = focusZ + (0.10 + authoredSpacing * 0.050 - approach * 0.40)
    * sin(orbitAngle + PI);

  var satelliteAngle = orbitAngle * 2.0 + PI * 0.35;
  bodyX[2] = bodyX[0] + (0.085 + authoredSpacing * 0.035) * cos(satelliteAngle);
  bodyZ[2] = bodyZ[0] + (0.095 + authoredSpacing * 0.030) * sin(satelliteAngle);

  bodySize[0] = 0.145 + liveRadius * 0.115;
  bodySize[1] = 0.132 + liveRadius * 0.108;
  bodySize[2] = 0.072 + liveRadius * 0.064;

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
  }

  var moatWidth = 0.018 + liveMoat * 0.040;
  var edgeWidth = isIdentity ? 0.035 : 0.012;
  var bestNormalized = 100.0;
  var secondNormalized = 100.0;
  var bestBody = 0.0;
  var bestDistance = 100.0;
  var bestRadius = 0.1;
  var bestDeltaX = 0.0;
  var bestDeltaZ = 0.0;
  var bodyIndex = 0.0;

  for (bodyIndex = 0.0; bodyIndex < BODY_COUNT; bodyIndex = bodyIndex + 1.0) {
    if (bodyIndex < activeBodies) {
      var centerX = bodyX[bodyIndex];
      var centerZ = bodyZ[bodyIndex];
      var radiusValue = bodySize[bodyIndex];
      if (isIdentity) {
        var signDirection = signPair ? -1.0 : 1.0;
        var signAngle = storyPhase * PI2_VALUE * signDirection
                      + signPair * PI;
        var signOrbit = bodyIndex < 2.0 ? 0.22 : 0.12;
        var signPhase = signAngle + bodyIndex * PI * 0.92;
        centerX = 0.5 + signOrbit * cos(signPhase);
        centerZ = 0.5 + signOrbit * 0.82 * sin(signPhase);
        radiusValue = bodyIndex < 2.0
          ? 0.145 + liveRadius * 0.045
          : 0.085 + liveRadius * 0.025;
      }

      var deltaX = (geometryX - centerX) * (isIdentity ? 1.0 : ASPECT_X);
      var deltaZ = geometryZ - centerZ;
      var distanceValue = sqrt(deltaX * deltaX + deltaZ * deltaZ);
      var normalizedDistance = distanceValue / radiusValue;
      if (normalizedDistance < bestNormalized) {
        secondNormalized = bestNormalized;
        bestNormalized = normalizedDistance;
        bestBody = bodyIndex;
        bestDistance = distanceValue;
        bestRadius = radiusValue;
        bestDeltaX = deltaX;
        bestDeltaZ = deltaZ;
      } else if (normalizedDistance < secondNormalized) {
        secondNormalized = normalizedDistance;
      }
    }
  }

  var brightness = 0.0;
  var useColor2 = bestBody == 1.0;
  var insideBody = bestDistance < bestRadius;
  var insideMoat = bestDistance < bestRadius + moatWidth;
  var bodyEdge = 1.0 - smoothstep(edgeWidth, edgeWidth * 2.8,
    abs(bestDistance - bestRadius));
  var moatEdge = 1.0 - smoothstep(edgeWidth * 0.7, edgeWidth * 2.2,
    abs(bestDistance - bestRadius - moatWidth));

  if (insideBody) {
    var contourTurn = atan2(bestDeltaZ, bestDeltaX) / PI2_VALUE;
    // Spacing opens both the orbital centers and the longitude packing inside
    // each body. The saved .58 look remains exactly 4.2 bands.
    var contourDensity = 4.2 + (authoredSpacing - 0.58) * 6.0;
    var contourPhase = frac(2.0 + bestNormalized * contourDensity
                          + contourTurn * 0.70
                          - storyPhase * 2.0);
    var contourDistance = abs(contourPhase - 0.5);
    var contourRidge = 1.0 - smoothstep(0.045, 0.145, contourDistance);
    brightness = bestNormalized < 0.34 ? 0.72 : 0.34;
    brightness = max(brightness, contourRidge * 0.94);
    if (contourDistance < 0.060 && bestNormalized > 0.34) brightness = 0.0;
    brightness = max(brightness, bodyEdge * 0.86);
  } else if (!insideMoat) {
    brightness = moatEdge * 0.34;
  }

  var eclipseSeam = insideBody
    * (1.0 - smoothstep(0.025, 0.085, abs(bestNormalized - secondNormalized)))
    * eclipseEnvelope;
  if (eclipseSeam > 0.18) brightness = 0.0;

  // Every physical 18-pixel hull bar receives the same orbit-energy intent.
  // This fixture-local moving meridian is deliberately subordinate to the
  // world-space bodies: it prevents a side from disappearing when a sparse
  // wall happens to sit outside both analytic discs, without becoming a wash.
  if (fixtureType == FIX_BAR_18) {
    var barOrbitCoordinate = frac(pixelLocalIndex / 18.0
      + detailPhase * 1.30 + fixtureId * GOLDEN_FRACTION);
    var barOrbitDistance = abs(barOrbitCoordinate - 0.5);
    var barOrbitExtent = 0.105 + (0.58 - authoredSpacing) * 0.160;
    var barOrbitMeridian = 1.0 - smoothstep(0.030, barOrbitExtent,
      barOrbitDistance);
    brightness = max(brightness, barOrbitMeridian
      * (0.26 + eclipseEnvelope * 0.20));
    if (barOrbitCoordinate > 0.5) useColor2 = 1.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    var strandOrbitCoordinate = frac(11.0 + pixelLocalIndex / 40.0
      - detailPhase * 1.10 + fixtureId * 0.137);
    var strandOrbitDistance = abs(strandOrbitCoordinate - 0.5);
    var strandOrbitExtent = 0.085 + (0.58 - authoredSpacing) * 0.140;
    var strandMeridian = 1.0 - smoothstep(0.025, strandOrbitExtent,
      strandOrbitDistance);
    brightness = max(strandMeridian * 0.68,
      max(bodyEdge * 0.84, moatEdge * 0.38));
    if (eclipseSeam > 0.18) brightness = eclipseSeam * 0.72;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var markerHead = floor((storyPhase * 6.0
                          + fixtureId * GOLDEN_FRACTION) % 6.0);
    var secondHead = (markerHead + 3.0) % 6.0;
    var markerGate = pixelLocalIndex == markerHead;
    var secondGate = pixelLocalIndex == secondHead;
    var spatialGate = max(bodyEdge, eclipseSeam);
    var conjunctionPulse = 0.20 + 0.14
      * wave(detailPhase * 1.70 + fixtureId * 0.071);
    brightness = markerGate * max(spatialGate * 0.34, conjunctionPulse)
               + secondGate * eclipseSeam * 0.28;
  } else if (fixtureType == FIX_PAR) {
    var anchorCohort = floor(fixtureId + floor(storyPhase * 8.0)) % 4.0;
    var anchorGate = anchorCohort == 0.0;
    var anchorPressure = insideBody
      * (bestNormalized < 0.62 ? 0.48 : 0.24);
    brightness = anchorGate * max(0.24, anchorPressure);
  } else if (isIdentity) {
    brightness = max(brightness, bodyEdge * 0.66);
  }

  if (fixtureType == FIX_RAW_LED && brightness < liveSilhouette * 0.16) {
    brightness = liveSilhouette * 0.16;
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
