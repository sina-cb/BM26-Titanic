// DRAFT — pending operator review
/*
  03_magnetic_field_collision.js - MAGNETIC FIELD COLLISION

  Two invisible poles generate curved bipolar lobe cages, a protected black
  saddle, and a few discrete Cassini-like flux arches. The poles approach,
  compress, and recoil once during the saved-speed cycle. Bars are
  never a full field; negative space remains the dominant third material.

  FIX_BAR_18     - curved lobe cores and discrete flux cages.
  FIX_RAW_LED    - separatrix, cage edges, and compressed neck.
  FIX_VINTAGE_6  - at most two very dim saddle probes per six-head rail.
  FIX_PAR        - sparse pole-pressure anchors only inside a lobe core.
  FIX_TE_SIGN    - complete complementary local-74 bipolar diagrams.

  AUDIO_MODULATION_V1:
    sliderAttractionStrength <- micLow range 0.34..0.82 curve ease # bass tightens lobe cages
    sliderFieldWarp <- micFlux range 0.08..0.56 curve ease # flux bends the saddle topology
    sliderCollisionKick <- micKick range 0.00..0.82 curve pow2 # kicks compress the pole gap
    sliderTensionStrength <- micMid range 0.00..0.58 curve ease # mids sustain the narrow neck
  Static (unmapped) params: localSpeed, poleSpacing, colorPalette1/2.
*/

export var cp1H = 0.020, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.565, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.20;
export var attractionStrength = 0.56;
export var poleSpacing = 0.62;
export var fieldWarp = 0.30;
export var collisionKick = 0.00;
export var tensionStrength = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderAttractionStrength(value) { attractionStrength = value; }
export function sliderPoleSpacing(value) { poleSpacing = value; }
export function sliderFieldWarp(value) { fieldWarp = value; }
export function sliderCollisionKick(value) { collisionKick = value; }
export function sliderTensionStrength(value) { tensionStrength = value; }

var PI2_VALUE = 6.28318530718;
var GOLDEN_FRACTION = 0.61803399;

var storyPhase = 0.0;
var liveStrength = 0.56;
var livePoleSpacing = 0.62;
var liveWarp = 0.30;
var liveKick = 0.00;
var liveTension = 0.00;

var poleAX = 0.30, poleAY = 0.50, poleAZ = 0.50;
var poleBX = 0.70, poleBY = 0.50, poleBZ = 0.50;
var axisX = 1.0, axisZ = 0.0;
var resolvedGap = 0.24;
var collisionEnvelope = 0.0;
var recoilEnvelope = 0.0;
var neckWidth = 0.04;

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
  liveStrength += (clamp01(attractionStrength) - liveStrength) * followAmount;
  livePoleSpacing += (clamp01(poleSpacing) - livePoleSpacing) * followAmount;
  liveWarp += (clamp01(fieldWarp) - liveWarp) * followAmount;
  liveKick += (clamp01(collisionKick) - liveKick) * followAmount;
  liveTension += (clamp01(tensionStrength) - liveTension) * followAmount;

  var speedControl = clamp01(localSpeed);
  storyPhase += deltaSeconds * (0.014 + speedControl * 0.020);
  if (storyPhase >= 1.0) storyPhase -= 1.0;

  collisionEnvelope = windowEnvelope(storyPhase, 0.20, 0.38, 0.56, 0.72);
  recoilEnvelope = windowEnvelope(storyPhase, 0.62, 0.72, 0.82, 0.94);
  var axisAngle = storyPhase * PI2_VALUE;
  axisX = cos(axisAngle);
  axisZ = sin(axisAngle);

  var farGap = 0.12 + livePoleSpacing * 0.25;
  var compression = max(collisionEnvelope, liveKick * 0.88);
  compression = max(compression, liveTension * 0.62);
  resolvedGap = farGap * (1.0 - compression * 0.52)
              + recoilEnvelope * 0.045;
  resolvedGap = max(0.045, resolvedGap);

  var midpointX = 0.5 + 0.045 * cos(axisAngle * 2.0);
  var midpointZ = 0.5 + 0.040 * sin(axisAngle * 2.0);
  var verticalBend = 0.035 + liveWarp * 0.070;
  poleAX = midpointX - axisX * resolvedGap;
  poleAZ = midpointZ - axisZ * resolvedGap;
  poleAY = 0.5 + verticalBend * sin(axisAngle);
  poleBX = midpointX + axisX * resolvedGap;
  poleBZ = midpointZ + axisZ * resolvedGap;
  poleBY = 0.5 - verticalBend * sin(axisAngle);
  neckWidth = 0.022 + (1.0 - liveStrength) * 0.032
            + compression * 0.045;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geometryX = clamp01(x);
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  var signPair = 0.0;
  var localPoleAX = poleAX, localPoleAY = poleAY, localPoleAZ = poleAZ;
  var localPoleBX = poleBX, localPoleBY = poleBY, localPoleBZ = poleBZ;

  if (isIdentity) {
    var localAddress = index % 74.0;
    signPair = floor(index / 74.0) % 2.0;
    geometryX = (localAddress % 10.0) / 9.0;
    geometryY = 0.5;
    geometryZ = floor(localAddress / 10.0) / 7.0;
    if (signPair) geometryX = 1.0 - geometryX;
    var signDirection = signPair ? -1.0 : 1.0;
    var signAngle = storyPhase * PI2_VALUE * signDirection;
    var signAxisX = cos(signAngle);
    var signAxisZ = sin(signAngle);
    var signGap = 0.11 + resolvedGap * 0.38;
    localPoleAX = 0.5 - signAxisX * signGap;
    localPoleAZ = 0.5 - signAxisZ * signGap;
    localPoleAY = 0.5;
    localPoleBX = 0.5 + signAxisX * signGap;
    localPoleBZ = 0.5 + signAxisZ * signGap;
    localPoleBY = 0.5;
  }

  var deltaAX = geometryX - localPoleAX;
  var deltaAY = geometryY - localPoleAY;
  var deltaAZ = geometryZ - localPoleAZ;
  var deltaBX = geometryX - localPoleBX;
  var deltaBY = geometryY - localPoleBY;
  var deltaBZ = geometryZ - localPoleBZ;
  var distanceA2 = 0.004 + deltaAX * deltaAX + deltaAZ * deltaAZ
                 + deltaAY * deltaAY * 0.58;
  var distanceB2 = 0.004 + deltaBX * deltaBX + deltaBZ * deltaBZ
                 + deltaBY * deltaBY * 0.58;
  var distanceA = sqrt(distanceA2);
  var distanceB = sqrt(distanceB2);

  var crossField = deltaAX * deltaBZ - deltaAZ * deltaBX;
  var verticalField = (geometryY - 0.5) * (deltaAX - deltaBX);
  var signedField = (distanceB2 - distanceA2)
                  + crossField * liveWarp * 1.85
                  + verticalField * liveWarp * 1.25;
  var useColor2 = signedField < 0.0;

  var productDistance = distanceA * distanceB;
  var cageLevel1 = 0.060 + resolvedGap * 0.28;
  var cageLevel2 = 0.105 + resolvedGap * 0.40;
  var cageLevel3 = 0.155 + resolvedGap * 0.50;
  var cageWidth = isIdentity ? 0.020 : 0.009;
  var cageOne = 1.0 - smoothstep(cageWidth, cageWidth * 3.2,
    abs(productDistance - cageLevel1));
  var cageTwo = 1.0 - smoothstep(cageWidth, cageWidth * 3.0,
    abs(productDistance - cageLevel2));
  var cageThree = 1.0 - smoothstep(cageWidth, cageWidth * 2.8,
    abs(productDistance - cageLevel3));

  var poleCoreRadius = 0.075 + liveStrength * 0.075;
  var nearestDistance = min(distanceA, distanceB);
  var coreBody = 1.0 - smoothstep(poleCoreRadius * 0.55,
                                  poleCoreRadius, nearestDistance);
  var saddleScale = isIdentity ? 0.14 : 0.10;
  var saddle = 1.0 - smoothstep(neckWidth, neckWidth + saddleScale,
    abs(signedField));
  var archGate = 1.0 - smoothstep(0.18 + liveWarp * 0.10,
                                  0.32 + liveWarp * 0.14,
                                  abs(crossField));
  var fluxArch = max(cageOne, max(cageTwo * 0.76, cageThree * 0.52))
               * archGate;
  var portraitCoordinate = abs(signedField) * (5.0 + liveStrength * 5.0)
                         + productDistance * (3.0 + liveWarp * 4.0)
                         - storyPhase;
  var portraitDistance = abs(frac(portraitCoordinate) - 0.5);
  var portraitLane = (1.0 - smoothstep(0.040, 0.120, portraitDistance))
                   * archGate * (1.0 - saddle);

  var brightness = max(coreBody * 0.42,
    max(fluxArch * 0.88, portraitLane * 0.24));
  if (cageTwo > 0.12 && brightness < 0.42) brightness = cageTwo * 0.42;
  if (saddle > 0.44) brightness = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    var saddleRim = 1.0 - smoothstep(0.012, 0.040,
      abs(abs(signedField) - neckWidth - 0.035));
    brightness = max(saddleRim * 0.82, fluxArch * 0.56);
    if (saddle > 0.72) brightness = 0.0;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var probeHead = floor((storyPhase * 2.0
                         + fixtureId * GOLDEN_FRACTION) % 6.0);
    var oppositeHead = (probeHead + 3.0) % 6.0;
    var probeGate = pixelLocalIndex == probeHead;
    var oppositeGate = pixelLocalIndex == oppositeHead;
    var spatialProbe = max(fluxArch, saddle * 0.55);
    var probePressure = 0.16 + 0.10
      * wave(storyPhase * 1.80 + fixtureId * 0.083);
    brightness = probeGate * max(spatialProbe * 0.24, probePressure)
               + oppositeGate * spatialProbe * collisionEnvelope * 0.20;
  } else if (fixtureType == FIX_PAR) {
    var anchorCohort = floor(fixtureId + floor(storyPhase * 8.0)) % 4.0;
    var anchorGate = anchorCohort == 0.0;
    var pressureEvent = pow(sin(storyPhase * PI), 2.0);
    brightness = anchorGate * (0.18 + pressureEvent * 0.32)
               * (0.68 + liveStrength * 0.30);
    useColor2 = distanceB2 < distanceA2;
  } else if (isIdentity) {
    brightness = max(brightness, fluxArch * 0.70);
  }


  if (isIdentity && signPair && brightness > 0.0) useColor2 = !useColor2;

  brightness = clamp01(brightness);
  if (useColor2) {
    rgbwau(pr2 * brightness, pg2 * brightness, pb2 * brightness,
           0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * brightness, pg1 * brightness, pb1 * brightness,
           0.0, 0.0, 0.0);
  }
}
