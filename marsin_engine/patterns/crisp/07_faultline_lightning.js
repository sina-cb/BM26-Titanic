// DRAFT — pending operator review
/*
  07_faultline_lightning.js — FAULTLINE LIGHTNING

  Dim contour territories flank one dominant black fault. One directed strike
  grows along that fault, forks into two tangent-continuous paths, decays from
  a trailing tail, and leaves a long dark recharge. There is no random flicker,
  prepared-branch ghost, or full-field territorial wash.

  FIX_BAR_18     — sparse territory contours, black fault, and hero strike.
  FIX_RAW_LED    — moving head, short tail, and fork intersections only.
  FIX_VINTAGE_6  — at most two separated junction lamps during passage.
  FIX_PAR        — sparse origin/fork anchors only; no baseline.
  FIX_TE_SIGN    — two complete 74-pixel fault maps with opposite chirality.

  AUDIO_MODULATION_V1:
    sliderFaultWarp <- micLow range 0.12..0.68 curve ease # bass stores tension by bowing the main fault
    sliderBranchAmount <- micFlux range 0.14..0.86 curve ease # flux separates the mandatory fork arms
    sliderBranchWidth <- micHigh range 0.12..0.44 curve linear # highs reveal the branch core without brightening the territories
    sliderStrikePhase <- micKick range 0.00..1.00 curve pow2 # kicks feed a smooth strike extension envelope
  Static (unmapped) params: localSpeed, persistence, colorPalette1/2.

  Every lit RGB pixel is a scalar multiple of one exact endpoint. Fault and
  branch moats are black. W=A=U=0.
*/

export var cp1H = 0.035, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.535, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var faultBend = 0.52;
export var branchComplexity = 0.46;
export var branchWidth = 0.34;
export var persistence = 0.42;
export var strike = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderFaultWarp(value) { faultBend = value; }
export function sliderBranchAmount(value) { branchComplexity = value; }
export function sliderBranchWidth(value) { branchWidth = value; }
export function sliderPersistence(value) { persistence = value; }
export function sliderStrikePhase(value) { strike = value; }

var PHASE_WRAP = 10000.0;
var storyPhase = 0.0;

var liveBend = 0.52;
var liveComplexity = 0.46;
var liveWidth = 0.34;
var livePersistence = 0.42;
var liveStrike = 0.00;
var strikeEnvelope = 0.0;
var branchHead = 0.0;
var branchTail = 0.0;
var branchLife = 0.0;
var sourceAlong = 0.10;
var forkAlong = 0.43;

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
  if (deltaSeconds > 0.0125) deltaSeconds = 0.0125;

  var followRate = min(1.0, deltaSeconds * 8.0);
  liveBend += (clamp01(faultBend) - liveBend) * followRate;
  liveComplexity += (clamp01(branchComplexity) - liveComplexity) * followRate;
  liveWidth += (clamp01(branchWidth) - liveWidth) * followRate;
  livePersistence += (clamp01(persistence) - livePersistence) * followRate;
  liveStrike += (clamp01(strike) - liveStrike) * followRate;

  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  storyPhase += deltaSeconds * localMultiplier * 0.58;
  if (storyPhase >= PHASE_WRAP) storyPhase -= PHASE_WRAP;

  var strikeFollow = liveStrike > strikeEnvelope ? 12.0 : 2.4;
  strikeEnvelope += (liveStrike - strikeEnvelope)
                  * min(1.0, deltaSeconds * strikeFollow);

  var cycleStage = storyPhase - floor(storyPhase);
  var rise = smoothstep(0.06, 0.15, cycleStage);
  var fall = 1.0 - smoothstep(0.72, 0.84, cycleStage);
  branchLife = rise * fall;
  var autonomousHead = smoothstep(0.10, 0.62, cycleStage);
  var autonomousTail = smoothstep(0.24 + livePersistence * 0.12,
                                   0.76 + livePersistence * 0.10,
                                   cycleStage);
  branchHead = clamp01(autonomousHead + strikeEnvelope * 0.22);
  branchTail = clamp01(autonomousTail * (0.72 - livePersistence * 0.34));
  sourceAlong = 0.08 + 0.05 * wave(storyPhase);
  forkAlong = 0.40 + 0.05 * wave(storyPhase + 0.2);

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

    var signAngle = storyPhase * PI2 + signSide * 0.76;
    var signCenteredZ = signZ - 0.5;
    var signFaultCenter = 0.48 + liveBend * 0.28
      * (signCenteredZ * signCenteredZ * signCenteredZ * 3.2
       - signCenteredZ * 0.38)
      + 0.04 * sin(signAngle);
    var signNormal = signX - signFaultCenter;
    var signDistance = abs(signNormal);
    var signBrightness = 0.0;
    var signUseColor2 = signNormal > 0.0;
    var signContour1 = 1.0 - smoothstep(0.018, 0.052,
      abs(signDistance - 0.18));
    var signContour2 = 1.0 - smoothstep(0.018, 0.052,
      abs(signDistance - 0.34));
    signBrightness = max(signContour1 * 0.24, signContour2 * 0.15);

    var signCycle = storyPhase + signSide * 0.12;
    signCycle -= floor(signCycle);
    var signLife = smoothstep(0.06, 0.15, signCycle)
      * (1.0 - smoothstep(0.72, 0.84, signCycle));
    var signHead = smoothstep(0.10, 0.62, signCycle);
    var signTail = smoothstep(0.28, 0.78, signCycle) * 0.45;
    var signProgress = clamp01((signZ - 0.08) / 0.84);
    var signTravel = smoothstep(signTail - 0.05, signTail + 0.02, signProgress)
      * (1.0 - smoothstep(signHead - 0.02, signHead + 0.06, signProgress))
      * signLife;
    var signForkGate = smoothstep(0.40, 0.49, signZ);
    var signForkDelta = max(0.0, signZ - 0.44);
    var signTrunkTarget = -0.02 - signZ * 0.10;
    var signUpperTarget = -0.06 - signForkDelta * (0.55 + liveComplexity * 0.42);
    var signLowerTarget = -0.06 + signForkDelta * (0.32 + liveComplexity * 0.36);
    var signBranchDistance = abs(signNormal - signTrunkTarget) + signForkGate;
    signBranchDistance = min(signBranchDistance,
      abs(signNormal - signUpperTarget) + (1.0 - signForkGate));
    signBranchDistance = min(signBranchDistance,
      abs(signNormal - signLowerTarget) + (1.0 - signForkGate));
    var signCoreWidth = 0.035 + liveWidth * 0.055;
    var signMoat = 1.0 - smoothstep(signCoreWidth * 1.8,
      signCoreWidth * 2.8, signBranchDistance);
    var signCore = 1.0 - smoothstep(signCoreWidth,
      signCoreWidth + 0.045, signBranchDistance);
    signMoat *= signTravel;
    signCore *= signTravel;
    signBrightness *= 1.0 - signMoat;
    if (signCore > signBrightness) {
      signBrightness = signCore * 0.86;
      signUseColor2 = 1.0;
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

  var storyAngle = storyPhase * PI2;
  var centeredZ = geometryZ - 0.5;
  var bendShape = centeredZ * centeredZ * centeredZ * 3.2
                - centeredZ * 0.38;
  var faultCenter = 0.46 + liveBend * 0.30 * bendShape
                  + 0.045 * sin(storyAngle)
                  + (geometryY - 0.5) * 0.07;
  var faultNormal = geometryX - faultCenter;
  var faultDistance = abs(faultNormal);
  var faultGap = 0.045 + liveWidth * 0.025;

  var contour1 = 1.0 - smoothstep(0.012, 0.034,
    abs(faultDistance - faultGap - 0.12));
  var contour2 = 1.0 - smoothstep(0.012, 0.034,
    abs(faultDistance - faultGap - 0.27));
  var brightness = max(contour1 * 0.22, contour2 * 0.13);
  var useColor2 = faultNormal > 0.0;
  if (faultDistance < faultGap) brightness = 0.0;

  var branchSpan = max(0.20, 0.92 - sourceAlong);
  var pathProgress = clamp01((geometryZ - sourceAlong) / branchSpan);
  var travelGate = smoothstep(branchTail - 0.05,
                              branchTail + 0.02, pathProgress)
                 * (1.0 - smoothstep(branchHead - 0.02,
                                    branchHead + 0.06, pathProgress))
                 * branchLife;
  var sourceGate = smoothstep(sourceAlong - 0.025,
                              sourceAlong + 0.030, geometryZ);
  travelGate *= sourceGate;

  var forkDelta = max(0.0, geometryZ - forkAlong);
  var forkGate = smoothstep(forkAlong - 0.035,
                            forkAlong + 0.050, geometryZ);
  var trunkTarget = -0.018 - (geometryZ - sourceAlong)
                  * (0.08 + liveBend * 0.08);
  var upperTarget = -0.055 - forkDelta
                  * (0.38 + liveComplexity * 0.70);
  var lowerTarget = -0.055 + forkDelta
                  * (0.18 + liveComplexity * 0.58);
  var trunkDistance = abs(faultNormal - trunkTarget) + forkGate * 2.0;
  var upperDistance = abs(faultNormal - upperTarget)
                    + (1.0 - forkGate) * 2.0;
  var lowerDistance = abs(faultNormal - lowerTarget)
                    + (1.0 - forkGate) * 2.0;
  var branchDistance = min(trunkDistance, min(upperDistance, lowerDistance));

  var coreWidth = 0.018 + liveWidth * 0.050;
  var branchMoat = 1.0 - smoothstep(coreWidth * 1.8,
                                    coreWidth * 2.9,
                                    branchDistance);
  var branchCore = 1.0 - smoothstep(coreWidth,
                                    coreWidth + 0.014,
                                    branchDistance);
  branchMoat *= travelGate;
  branchCore *= travelGate;
  brightness *= 1.0 - branchMoat;
  if (branchCore > brightness) {
    brightness = branchCore * 0.90;
    useColor2 = 1.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    var headWindow = 1.0 - smoothstep(0.02, 0.10,
      abs(pathProgress - branchHead));
    brightness = max(branchCore * 0.78, headWindow * travelGate * 0.92);
    useColor2 = 1.0;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var junctionPair = pixelLocalIndex == 1.0 || pixelLocalIndex == 4.0;
    var strikeHeadZ = sourceAlong + branchHead * branchSpan;
    var junctionNear = 1.0 - smoothstep(0.025, 0.10,
      abs(geometryZ - strikeHeadZ));
    var junctionRecharge = 0.12 + branchLife * 0.88;
    brightness = junctionPair * max(junctionNear, branchCore * 0.34)
               * junctionRecharge * 0.50;
    useColor2 = 1.0;
  } else if (fixtureType == FIX_PAR) {
    var originDistance = abs(geometryZ - sourceAlong);
    var forkDistance = abs(geometryZ - forkAlong);
    var headDistance = abs(geometryZ - (sourceAlong + branchHead * branchSpan));
    var originAnchor = (1.0 - smoothstep(0.020, 0.065, originDistance))
      * (1.0 - branchHead);
    var forkAnchor = (1.0 - smoothstep(0.020, 0.065, forkDistance))
      * smoothstep(0.28, 0.62, branchHead);
    var headAnchor = 1.0 - smoothstep(0.020, 0.070, headDistance);
    var anchor = max(headAnchor, max(originAnchor, forkAnchor));
    brightness = anchor * branchLife * (0.30 + strikeEnvelope * 0.26);
    useColor2 = forkDistance < originDistance;
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
