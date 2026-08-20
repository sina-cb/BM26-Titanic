// DRAFT — pending operator review
/*
  09_pressure_chamber.js — PRESSURE CHAMBER

  Four asymmetric sealed cells form one connected hydraulic circuit. A
  conserved pressure wave inflates one cell, bows its membranes, and drives a
  bright valve into the next cell while the opposite side decompresses. Dark
  gaskets keep the cells mechanically separate; low internal glass and two
  pressure ribs make the volume legible without a full-rig territory fill.

  FIXTURE STAGING
    FIX_BAR_18     — chamber glass, bowed seals, internal ribs, and pipes.
    FIX_RAW_LED    — outer seals, active pipe, and traveling valve only.
    FIX_VINTAGE_6  — one moving gauge head plus one restrained tail head.
    FIX_PAR        — sparse active-valve punctuation; no steady baseline.
    FIX_TE_SIGN    — two complete local-74 reservoir diagrams with opposite
                     phase and chirality.

  COLOR / MATERIAL
    Every lit pixel is a scalar multiple of exactly one palette endpoint.
    Endpoint ownership never blends. Material tiers are dark glass, internal
    neon, and a hard seal/valve core; all unused space is black. W=A=U=0.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed     — continuous conserved-pressure circulation rate.
    pressure       — chamber expansion and membrane bow.
    gasketWidth    — protected black separation around every cell.
    topologySpread — asymmetry and travel of the connected cell layout.
    pressurePulse  — extra valve displacement and active-pipe energy.

  AUDIO_MODULATION_V1:
    sliderPressure <- micLow range 0.30..0.86 curve ease # bass transfers volume between connected cells
    sliderPressurePulse <- micKick range 0.00..1.00 curve pow2 # kicks drive the traveling valve farther into its pipe
    sliderTopologySpread <- micFlux range 0.12..0.58 curve linear # flux enlarges the asymmetric chamber travel
  Static (unmapped) params: localSpeed, gasketWidth, colorPalette1/2.
*/

export var cp1H = 0.040, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.520, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var pressure = 0.58;
export var gasketWidth = 0.22;
export var topologySpread = 0.36;
export var pressurePulse = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderPressure(value) { pressure = value; }
export function sliderGasketWidth(value) { gasketWidth = value; }
export function sliderTopologySpread(value) { topologySpread = value; }
export function sliderPressurePulse(value) { pressurePulse = value; }

var CHAMBER_COUNT = 4;
var PHASE_WRAP = 10000.0;

var chamberX = array(4);
var chamberY = array(4);
var chamberZ = array(4);
var chamberRadiusX = array(4);
var chamberRadiusY = array(4);
var chamberRadiusZ = array(4);
var chamberPressure = array(4);

var pressurePhase = 0.08;
var liveLocalSpeed = 0.30;
var livePressure = 0.58;
var liveGasketWidth = 0.22;
var liveTopologySpread = 0.36;
var livePressurePulse = 0.00;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function materialTier(coverage) {
  if (coverage > 0.76) return 0.78;
  if (coverage > 0.28) return 0.34;
  if (coverage > 0.035) return 0.11;
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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = clamp(delta / 1000.0, 0.0, 0.1);
  var follow = min(1.0, dt * 8.0);
  liveLocalSpeed += (clamp01(localSpeed) - liveLocalSpeed) * follow;
  livePressure += (clamp01(pressure) - livePressure) * follow;
  liveGasketWidth += (clamp01(gasketWidth) - liveGasketWidth) * follow;
  liveTopologySpread += (clamp01(topologySpread) - liveTopologySpread) * follow;
  livePressurePulse += (clamp01(pressurePulse) - livePressurePulse) * follow;

  var phaseRate = 0.24 + liveLocalSpeed * 0.38;
  pressurePhase += dt * phaseRate;
  if (pressurePhase >= PHASE_WRAP) pressurePhase -= PHASE_WRAP;

  var layoutAmount = 0.025 + liveTopologySpread * 0.075;
  var bowAmount = 0.035 + livePressure * 0.070;
  var layoutAngle = pressurePhase * PI2 * 0.5;

  chamberX[0] = 0.20 + layoutAmount * sin(layoutAngle + 0.20);
  chamberY[0] = 0.34 + layoutAmount * 0.35 * cos(layoutAngle + 0.80);
  chamberZ[0] = 0.23 + layoutAmount * 0.55 * cos(layoutAngle + 0.10);
  chamberX[1] = 0.70 + layoutAmount * 0.45 * cos(layoutAngle + 1.40);
  chamberY[1] = 0.27 + layoutAmount * 0.40 * sin(layoutAngle + 0.55);
  chamberZ[1] = 0.34 + layoutAmount * sin(layoutAngle + 0.95);
  chamberX[2] = 0.64 + layoutAmount * 0.70 * sin(layoutAngle + 2.20);
  chamberY[2] = 0.70 + layoutAmount * 0.35 * cos(layoutAngle + 1.75);
  chamberZ[2] = 0.72 + layoutAmount * 0.45 * cos(layoutAngle + 2.55);
  chamberX[3] = 0.27 + layoutAmount * cos(layoutAngle + 2.90);
  chamberY[3] = 0.63 + layoutAmount * 0.30 * sin(layoutAngle + 2.10);
  chamberZ[3] = 0.79 + layoutAmount * 0.60 * sin(layoutAngle + 3.25);

  var chamberIndex = 0.0;
  for (chamberIndex = 0.0; chamberIndex < CHAMBER_COUNT;
       chamberIndex = chamberIndex + 1.0) {
    var pressureValue = 0.5 + 0.5 * cos(
      (pressurePhase - chamberIndex * 0.25) * PI2);
    chamberPressure[chamberIndex] = pressureValue;
    var expansion = (pressureValue - 0.5) * bowAmount;
    chamberRadiusX[chamberIndex] = 0.290 + expansion;
    chamberRadiusY[chamberIndex] = 0.380 + expansion * 0.42;
    chamberRadiusZ[chamberIndex] = 0.270 + expansion * 0.76;
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geometryX = clamp01(x);
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  var signSide = floor(index / 74.0) % 2.0;

  if (isIdentity) {
    var signIndex = index % 74.0;
    geometryX = (signIndex % 10.0) / 9.0;
    geometryY = 0.5;
    geometryZ = floor(signIndex / 10.0) / 7.0;
    if (signSide > 0.5) geometryX = 1.0 - geometryX;
  }

  var bestBody = 0.0;
  var bestRib = 0.0;
  var bestSeal = 0.0;
  var bodyOwner = 0.0;
  var ribOwner = 0.0;
  var sealOwner = 0.0;
  var chamberIndex = 0.0;
  var signPhaseOffset = signSide * 0.5;

  for (chamberIndex = 0.0; chamberIndex < CHAMBER_COUNT;
       chamberIndex = chamberIndex + 1.0) {
    var centerX = chamberX[chamberIndex];
    var centerY = chamberY[chamberIndex];
    var centerZ = chamberZ[chamberIndex];
    var radiusX = chamberRadiusX[chamberIndex];
    var radiusY = chamberRadiusY[chamberIndex];
    var radiusZ = chamberRadiusZ[chamberIndex];
    var pressureValue = chamberPressure[chamberIndex];

    if (isIdentity) {
      var signAngle = (pressurePhase + signPhaseOffset
        - chamberIndex * 0.25) * PI2;
      pressureValue = 0.5 + 0.5 * cos(signAngle);
      centerX = chamberIndex == 0.0 ? 0.24 : (chamberIndex == 1.0 ? 0.72
        : (chamberIndex == 2.0 ? 0.67 : 0.27));
      centerZ = chamberIndex == 0.0 ? 0.25 : (chamberIndex == 1.0 ? 0.34
        : (chamberIndex == 2.0 ? 0.73 : 0.78));
      centerY = 0.5;
      radiusX = 0.24 + (pressureValue - 0.5) * 0.055;
      radiusY = 1.0;
      radiusZ = 0.22 + (pressureValue - 0.5) * 0.045;
    }

    var chamberDx = geometryX - centerX;
    var chamberDy = geometryY - centerY;
    var chamberDz = geometryZ - centerZ;
    var bowSign = chamberIndex % 2.0 == 0.0 ? 1.0 : -1.0;
    chamberDx += bowSign * (chamberDz * chamberDz - 0.018)
      * (0.55 + livePressure * 0.75);
    var localX = chamberDx / radiusX;
    var localY = chamberDy / radiusY;
    var localZ = chamberDz / radiusZ;
    var radial = sqrt(localX * localX + localY * localY + localZ * localZ);

    var bodyCoverage = radial < 0.64 ? 1.0 : 0.0;
    var bodyEnergy = bodyCoverage * 0.11;
    if (bodyEnergy > bestBody) {
      bestBody = bodyEnergy;
      bodyOwner = chamberIndex % 2.0;
    }

    var ribCoordinate = localX * (chamberIndex % 2.0 == 0.0 ? 0.76 : -0.48)
      + localZ * (0.36 + chamberIndex * 0.11)
      + 0.12 * sin((localZ + pressurePhase + chamberIndex * 0.19) * PI2);
    var ribDistance = abs(abs(ribCoordinate) - (0.18 + pressureValue * 0.13));
    var ribWidth = 0.026 + livePressure * 0.025;
    if (isIdentity) ribWidth *= 2.15;
    var ribCoverage = (1.0 - smoothstep(ribWidth * 0.45,
      ribWidth * 1.30, ribDistance)) * (radial < 0.66);
    var ribEnergy = materialTier(ribCoverage);
    if (ribEnergy > bestRib) {
      bestRib = ribEnergy;
      ribOwner = chamberIndex % 2.0;
    }

    var sealCenter = 0.82 + liveGasketWidth * 0.055;
    var sealWidth = 0.018 + liveGasketWidth * 0.025;
    if (isIdentity) sealWidth *= 2.20;
    var sealCoverage = 1.0 - smoothstep(sealWidth * 0.40,
      sealWidth * 1.25, abs(radial - sealCenter));
    var sealEnergy = materialTier(sealCoverage);
    if (sealEnergy > bestSeal) {
      bestSeal = sealEnergy;
      sealOwner = chamberIndex % 2.0;
    }
  }

  var cycle = pressurePhase - floor(pressurePhase);
  var activePipe = floor(cycle * 4.0);
  var transfer = cycle * 4.0 - activePipe;
  var nextPipe = activePipe + 1.0;
  if (nextPipe >= CHAMBER_COUNT) nextPipe = 0.0;
  var pipeStartX = chamberX[activePipe];
  var pipeStartY = chamberY[activePipe];
  var pipeStartZ = chamberZ[activePipe];
  var pipeEndX = chamberX[nextPipe];
  var pipeEndY = chamberY[nextPipe];
  var pipeEndZ = chamberZ[nextPipe];
  var pipeX = pipeStartX + (pipeEndX - pipeStartX) * transfer;
  var pipeY = pipeStartY + (pipeEndY - pipeStartY) * transfer;
  var pipeZ = pipeStartZ + (pipeEndZ - pipeStartZ) * transfer;

  if (isIdentity) {
    var signCycle = pressurePhase + signPhaseOffset;
    signCycle -= floor(signCycle);
    activePipe = floor(signCycle * 4.0);
    transfer = signCycle * 4.0 - activePipe;
    nextPipe = activePipe + 1.0;
    if (nextPipe >= CHAMBER_COUNT) nextPipe = 0.0;
    var signCenterX0 = activePipe == 0.0 ? 0.24 : (activePipe == 1.0 ? 0.72
      : (activePipe == 2.0 ? 0.67 : 0.27));
    var signCenterZ0 = activePipe == 0.0 ? 0.25 : (activePipe == 1.0 ? 0.34
      : (activePipe == 2.0 ? 0.73 : 0.78));
    var signCenterX1 = nextPipe == 0.0 ? 0.24 : (nextPipe == 1.0 ? 0.72
      : (nextPipe == 2.0 ? 0.67 : 0.27));
    var signCenterZ1 = nextPipe == 0.0 ? 0.25 : (nextPipe == 1.0 ? 0.34
      : (nextPipe == 2.0 ? 0.73 : 0.78));
    pipeX = signCenterX0 + (signCenterX1 - signCenterX0) * transfer;
    pipeY = 0.5;
    pipeZ = signCenterZ0 + (signCenterZ1 - signCenterZ0) * transfer;
    pipeStartX = signCenterX0;
    pipeStartY = 0.5;
    pipeStartZ = signCenterZ0;
    pipeEndX = signCenterX1;
    pipeEndY = 0.5;
    pipeEndZ = signCenterZ1;
  }

  var segmentX = pipeEndX - pipeStartX;
  var segmentY = pipeEndY - pipeStartY;
  var segmentZ = pipeEndZ - pipeStartZ;
  var segmentLengthSq = segmentX * segmentX + segmentY * segmentY
    + segmentZ * segmentZ;
  var pointX = geometryX - pipeStartX;
  var pointY = geometryY - pipeStartY;
  var pointZ = geometryZ - pipeStartZ;
  var pipeProjection = clamp((pointX * segmentX + pointY * segmentY
    + pointZ * segmentZ) / max(0.001, segmentLengthSq), 0.0, 1.0);
  var pipeNearX = pipeStartX + segmentX * pipeProjection;
  var pipeNearY = pipeStartY + segmentY * pipeProjection;
  var pipeNearZ = pipeStartZ + segmentZ * pipeProjection;
  var pipeDx = geometryX - pipeNearX;
  var pipeDy = geometryY - pipeNearY;
  var pipeDz = geometryZ - pipeNearZ;
  var pipeDistance = sqrt(pipeDx * pipeDx + pipeDy * pipeDy
    + pipeDz * pipeDz);
  var pipeRadius = 0.014 + livePressurePulse * 0.070;
  if (isIdentity) pipeRadius = 0.030 + livePressurePulse * 0.075;
  var pipeCoverage = 1.0 - smoothstep(pipeRadius * 0.42,
    pipeRadius * 1.28, pipeDistance);
  var pipeEnergy = materialTier(pipeCoverage);

  var valveDx = geometryX - pipeX;
  var valveDy = geometryY - pipeY;
  var valveDz = geometryZ - pipeZ;
  var valveDistance = sqrt(valveDx * valveDx + valveDy * valveDy
    + valveDz * valveDz);
  var valveRadius = 0.035 + livePressurePulse * 0.160;
  if (isIdentity) valveRadius = 0.065 + livePressurePulse * 0.120;
  var valveCoverage = 1.0 - smoothstep(valveRadius * 0.45,
    valveRadius * 1.25, valveDistance);
  var valveEnergy = materialTier(valveCoverage);

  var brightness = bestBody;
  var useColor2 = bodyOwner;
  if (bestRib > brightness) { brightness = bestRib; useColor2 = ribOwner; }
  if (bestSeal > brightness) { brightness = bestSeal; useColor2 = sealOwner; }
  if (pipeEnergy > brightness) {
    brightness = pipeEnergy;
    useColor2 = activePipe % 2.0;
  }
  if (valveEnergy > brightness) {
    brightness = valveEnergy;
    useColor2 = activePipe % 2.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    brightness = bestSeal * 0.82;
    useColor2 = sealOwner;
    if (pipeEnergy > brightness) {
      brightness = pipeEnergy;
      useColor2 = activePipe % 2.0;
    }
    if (valveEnergy > brightness) {
      brightness = valveEnergy;
      useColor2 = activePipe % 2.0;
    }
  } else if (fixtureType == FIX_VINTAGE_6) {
    var gaugePhase = cycle * 6.0 + fixtureId * 0.173;
    var gaugeHead = floor((gaugePhase - floor(gaugePhase)) * 6.0);
    var gaugeTail = gaugeHead - 1.0;
    if (gaugeTail < 0.0) gaugeTail = 5.0;
    brightness = pixelLocalIndex == gaugeHead ? 0.50
      : (pixelLocalIndex == gaugeTail ? 0.18 : 0.0);
    useColor2 = activePipe % 2.0;
  } else if (fixtureType == FIX_PAR) {
    var valveGate = floor(fixtureId) % 4.0 == activePipe;
    var valvePulse = 1.0 - abs(transfer * 2.0 - 1.0);
    brightness = valveGate * (0.22 + valvePulse * 0.28);
    useColor2 = activePipe % 2.0;
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
