// DRAFT — pending operator review
/*
  11_event_horizon.js — EVENT HORIZON

  A dominant black ellipsoid travels diagonally through the ship. Three rails
  are straight and widely separated in the far field, then bend, bunch, and
  break around the horizon. A restrained Color 2 inner lens reveals the far
  side without filling the void. One autonomous cycle completes a clear
  single -> binary -> single story inside the ten-second Global 0.30 / Local
  0.30 review window. There is no vortex, orbit ring, or bright territory fill.

  FIXTURE STAGING
    FIX_BAR_18     — three bent rails, dim glass shoulders, inner lens ribs,
                     and a protected black horizon.
    FIX_RAW_LED    — sparse rail/horizon crossing points only.
    FIX_VINTAGE_6  — one lens tracer plus one dim tail head, only in-band.
    FIX_PAR        — sparse compression punctuation; no steady baseline.
    FIX_TE_SIGN    — two complete local-74 ellipse-and-chord diagrams with
                     complementary half-cycle phase and opposite chirality.

  COLOR / MATERIAL
    Color 1 owns far-field rails. Color 2 owns the restrained inner lens.
    Each is emitted only as an exact endpoint ray at dark-glass, shoulder, or
    neon-core intensity. The horizon and all unused space are black. W=A=U=0.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed        — continuous travel and binary-cycle cadence.
    horizonSize       — dominant void radius.
    gravityStrength   — rail bending and compression near the horizon.
    axisSpread        — ellipsoid flattening and rail separation.
    binarySpread      — maximum two-lobe separation.
    compressionAmount — extra collapse and near-field rail bunching.

  AUDIO_MODULATION_V1:
    sliderGravityStrength <- micLow range 0.30..0.88 curve ease # bass bends the three reference rails around the void
    sliderAxisSpread <- micFlux range 0.28..0.72 curve linear # flux stretches the horizon axes and rail spacing
    sliderCompressionAmount <- micKick range 0.00..0.90 curve pow2 # kicks compress the near field without stopping travel
  Static (unmapped) params: localSpeed, horizonSize, binarySpread,
    colorPalette1/2.
*/

export var cp1H = 0.040, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.520, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var horizonSize = 0.58;
export var gravityStrength = 0.62;
export var axisSpread = 0.42;
export var binarySpread = 0.20;
export var compressionAmount = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderHorizonSize(value) { horizonSize = value; }
export function sliderGravityStrength(value) { gravityStrength = value; }
export function sliderAxisSpread(value) { axisSpread = value; }
export function sliderBinarySpread(value) { binarySpread = value; }
export function sliderCompressionAmount(value) { compressionAmount = value; }

var PHASE_WRAP = 10000.0;

var horizonPhase = 0.02;
var liveLocalSpeed = 0.30;
var liveHorizonSize = 0.58;
var liveGravityStrength = 0.62;
var liveAxisSpread = 0.42;
var liveBinarySpread = 0.20;
var liveCompressionAmount = 0.00;

var centerX1 = 0.5, centerY1 = 0.5, centerZ1 = 0.5;
var centerX2 = 0.5, centerY2 = 0.5, centerZ2 = 0.5;
var axisX = 0.3, axisY = 0.3, axisZ = 0.3;
var liveSplitDistance = 0.0;
var binaryEnvelope = 0.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function railTier(coverage) {
  if (coverage > 0.74) return 0.80;
  if (coverage > 0.27) return 0.30;
  if (coverage > 0.035) return 0.09;
  return 0.0;
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
  var dt = clamp(delta / 1000.0, 0.0, 0.1);
  var follow = min(1.0, dt * 8.0);
  liveLocalSpeed += (clamp01(localSpeed) - liveLocalSpeed) * follow;
  liveHorizonSize += (clamp01(horizonSize) - liveHorizonSize) * follow;
  liveGravityStrength += (clamp01(gravityStrength)
    - liveGravityStrength) * follow;
  liveAxisSpread += (clamp01(axisSpread) - liveAxisSpread) * follow;
  liveBinarySpread += (clamp01(binarySpread) - liveBinarySpread) * follow;
  liveCompressionAmount += (clamp01(compressionAmount)
    - liveCompressionAmount) * follow;

  var phaseRate = 0.28 + liveLocalSpeed * 0.20;
  horizonPhase += dt * phaseRate;
  if (horizonPhase >= PHASE_WRAP) horizonPhase -= PHASE_WRAP;

  var cycle = horizonPhase - floor(horizonPhase);
  var angle = cycle * PI2;
  var baseCenterX = 0.5 + 0.29 * sin(angle - PI * 0.5);
  var baseCenterY = 0.5 + 0.10 * sin(angle * 2.0 + 0.35);
  var baseCenterZ = 0.5 + 0.24 * sin(angle + 0.42);

  var splitWave = wave(cycle - 0.25);
  binaryEnvelope = smoothstep(0.24, 0.78, splitWave);
  liveSplitDistance = liveBinarySpread * binaryEnvelope * 0.82;
  var splitAngle = angle * 0.37 + 0.65;
  var splitX = cos(splitAngle) * liveSplitDistance;
  var splitY = sin(splitAngle * 1.41) * liveSplitDistance * 0.35;
  var splitZ = sin(splitAngle) * liveSplitDistance;
  centerX1 = baseCenterX - splitX;
  centerY1 = baseCenterY - splitY;
  centerZ1 = baseCenterZ - splitZ;
  centerX2 = baseCenterX + splitX;
  centerY2 = baseCenterY + splitY;
  centerZ2 = baseCenterZ + splitZ;

  var baseRadius = (0.20 + liveHorizonSize * 0.22)
    * (1.0 - liveCompressionAmount * 0.30);
  axisX = baseRadius * (0.78 + liveAxisSpread * 0.72);
  axisY = baseRadius * (1.12 - liveAxisSpread * 0.34);
  axisZ = baseRadius * (0.82 + liveAxisSpread * 0.38);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geometryX = clamp01(x);
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  var signSide = floor(index / 74.0) % 2.0;

  var localCenterX1 = centerX1;
  var localCenterY1 = centerY1;
  var localCenterZ1 = centerZ1;
  var localCenterX2 = centerX2;
  var localCenterY2 = centerY2;
  var localCenterZ2 = centerZ2;
  var localAxisX = axisX;
  var localAxisY = axisY;
  var localAxisZ = axisZ;

  if (isIdentity) {
    var signIndex = index % 74.0;
    geometryX = (signIndex % 10.0) / 9.0;
    geometryY = 0.5;
    geometryZ = floor(signIndex / 10.0) / 7.0;
    if (signSide > 0.5) geometryX = 1.0 - geometryX;

    var signCycle = horizonPhase + signSide * 0.5;
    signCycle -= floor(signCycle);
    var signAngle = signCycle * PI2;
    var signBaseX = 0.5 + 0.24 * sin(signAngle - PI * 0.5);
    var signBaseZ = 0.5 + 0.20 * sin(signAngle + 0.42);
    var signBinary = smoothstep(0.24, 0.78, wave(signCycle - 0.25));
    var signSplit = liveBinarySpread * signBinary * 0.70;
    localCenterX1 = signBaseX - signSplit;
    localCenterY1 = 0.5;
    localCenterZ1 = signBaseZ - signSplit * 0.42;
    localCenterX2 = signBaseX + signSplit;
    localCenterY2 = 0.5;
    localCenterZ2 = signBaseZ + signSplit * 0.42;
    localAxisX = 0.20 + liveHorizonSize * 0.11
      + liveAxisSpread * 0.055;
    localAxisY = 1.0;
    localAxisZ = 0.23 + liveHorizonSize * 0.09
      - liveAxisSpread * 0.035;
  }

  var horizonDx1 = (geometryX - localCenterX1) / localAxisX;
  var horizonDy1 = (geometryY - localCenterY1) / localAxisY;
  var horizonDz1 = (geometryZ - localCenterZ1) / localAxisZ;
  var radius1 = sqrt(horizonDx1 * horizonDx1 + horizonDy1 * horizonDy1
    + horizonDz1 * horizonDz1);
  var horizonDx2 = (geometryX - localCenterX2) / localAxisX;
  var horizonDy2 = (geometryY - localCenterY2) / localAxisY;
  var horizonDz2 = (geometryZ - localCenterZ2) / localAxisZ;
  var radius2 = sqrt(horizonDx2 * horizonDx2 + horizonDy2 * horizonDy2
    + horizonDz2 * horizonDz2);

  var radiusValue = radius1;
  var nearestCenterX = localCenterX1;
  var nearestCenterY = localCenterY1;
  var nearestCenterZ = localCenterZ1;
  if (radius2 < radius1) {
    radiusValue = radius2;
    nearestCenterX = localCenterX2;
    nearestCenterY = localCenterY2;
    nearestCenterZ = localCenterZ2;
  }

  var boundaryDistance = abs(radiusValue - 1.0);
  var lensBand = 1.0 - smoothstep(0.05, 0.72, boundaryDistance);
  var lensStrength = lensBand * (0.24 + liveGravityStrength * 0.78
    + liveCompressionAmount * 0.38) / max(0.28, radiusValue + 0.12);
  var lensDx = geometryX - nearestCenterX;
  var lensDy = geometryY - nearestCenterY;
  var lensDz = geometryZ - nearestCenterZ;
  var warpedX = geometryX + lensDx * lensStrength;
  var warpedY = geometryY + lensDy * lensStrength * 0.38;
  var warpedZ = geometryZ + lensDz * lensStrength * 0.72;

  var railSpread = 0.20 + liveAxisSpread * 0.075;
  var railDistance1 = abs(warpedX - (0.5 - railSpread));
  var railDistance2 = abs(warpedX - 0.5);
  var railDistance3 = abs(warpedX - (0.5 + railSpread));
  var railDistance = min(railDistance1, min(railDistance2, railDistance3));
  var railWidth = 0.022 + liveAxisSpread * 0.018;
  if (isIdentity) railWidth *= 2.00;
  var railCoverage = 1.0 - smoothstep(railWidth * 0.38,
    railWidth * 1.45, railDistance);
  var railEnergy = railTier(railCoverage);

  var innerRimDistance = abs(radiusValue - 0.76);
  var innerRimWidth = 0.050 + liveCompressionAmount * 0.022;
  if (isIdentity) innerRimWidth *= 1.70;
  var innerRimCoverage = 1.0 - smoothstep(innerRimWidth * 0.38,
    innerRimWidth * 1.35, innerRimDistance);
  var innerRimEnergy = railTier(innerRimCoverage) * 0.78;

  var protectedVoid = radiusValue < 0.66 || boundaryDistance < 0.115;
  var brightness = railEnergy;
  var useColor2 = 0.0;
  if (innerRimEnergy > brightness) {
    brightness = innerRimEnergy;
    useColor2 = 1.0;
  }
  if (protectedVoid) brightness = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    var crossingBand = 1.0 - smoothstep(0.085, 0.22,
      abs(boundaryDistance - 0.16));
    brightness = railEnergy * crossingBand;
    if (brightness > 0.0) brightness = min(0.70, brightness);
    useColor2 = radiusValue < 1.0;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var tracerCycle = horizonPhase * 3.0 + fixtureId * 0.127;
    tracerCycle -= floor(tracerCycle);
    var tracerHead = floor(tracerCycle * 6.0);
    var tracerTail = tracerHead - 1.0;
    if (tracerTail < 0.0) tracerTail = 5.0;
    var tracerGate = smoothstep(0.06, 0.32, lensBand);
    brightness = tracerGate * (pixelLocalIndex == tracerHead ? 0.50
      : (pixelLocalIndex == tracerTail ? 0.16 : 0.0));
    useColor2 = radiusValue < 1.0;
  } else if (fixtureType == FIX_PAR) {
    var cycle = horizonPhase - floor(horizonPhase);
    var compressionWave = 1.0 - abs(cycle * 2.0 - 1.0);
    var compressionGate = floor(fixtureId) % 10.0 == floor(cycle * 10.0);
    brightness = compressionGate * compressionWave
      * (0.34 + liveCompressionAmount * 0.21);
    useColor2 = cycle > 0.5;
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
