// DRAFT — pending operator review
/*
  05_continental_drift.js — CONTINENTAL DRIFT

  One asymmetric cubic fault divides two unequal plates. A wide black rift,
  nested coastlines, and an inland void make the territories read as material
  rather than a binary wash. One island detaches, crosses the rift, joins the
  opposing plate, then returns through the same seamless tectonic cycle.

  FIX_BAR_18     — complete plate, rift, coastline, void, and island story.
  FIX_RAW_LED    — fault lips and island shoreline only; most rope stays black.
  FIX_VINTAGE_6  — at most two separated fault-survey lamps per six-head rail.
  FIX_PAR        — sparse pressure anchors near the moving rift; no baseline.
  FIX_TE_SIGN    — two complete 74-pixel tectonic maps with opposite chirality.

  AUDIO_MODULATION_V1:
    sliderPlatePressure <- micLow range 0.18..0.72 curve ease # bass compresses the wide black rift
    sliderFaultWarp <- micFlux range 0.08..0.52 curve ease # flux bends the cubic coastline
    sliderShearAmount <- micMid range 0.10..0.58 curve linear # mids slide the plates along the fault
    sliderFaultImpact <- micKick range 0.00..1.00 curve pow2 # kicks add a smooth tectonic slip envelope
  Static (unmapped) params: localSpeed, islandSize, colorPalette1/2.

  Every lit RGB pixel is a scalar multiple of exactly one palette endpoint.
  The rift and internal cuts are black. W=A=U=0.
*/

export var cp1H = 0.055, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.515, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var platePressure = 0.44;
export var faultWarp = 0.32;
export var shearAmount = 0.30;
export var islandSize = 0.52;
export var faultImpact = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderPlatePressure(value) { platePressure = value; }
export function sliderFaultWarp(value) { faultWarp = value; }
export function sliderShearAmount(value) { shearAmount = value; }
export function sliderIslandSize(value) { islandSize = value; }
export function sliderFaultImpact(value) { faultImpact = value; }

var PHASE_WRAP = 10000.0;
var storyPhase = 0.0;

var livePressure = 0.44;
var liveFaultWarp = 0.32;
var liveShear = 0.30;
var liveIslandSize = 0.52;
var liveFaultImpact = 0.00;
var impactEnvelope = 0.0;

var control0 = 0.30, control1 = 0.58, control2 = 0.31, control3 = 0.63;
var riftWidth = 0.070;
var islandTravel = 0.0;
var islandCenterX = 0.5, islandCenterZ = 0.58;
var islandRadiusX = 0.10, islandRadiusZ = 0.16;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function cubicFault(faultCoord, point0, point1, point2, point3) {
  var inverseCoord = 1.0 - faultCoord;
  var inverseSquared = inverseCoord * inverseCoord;
  var coordSquared = faultCoord * faultCoord;
  return point0 * inverseSquared * inverseCoord
       + point1 * 3.0 * inverseSquared * faultCoord
       + point2 * 3.0 * inverseCoord * coordSquared
       + point3 * coordSquared * faultCoord;
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

  var followRate = min(1.0, deltaSeconds * 6.0);
  livePressure += (clamp01(platePressure) - livePressure) * followRate;
  liveFaultWarp += (clamp01(faultWarp) - liveFaultWarp) * followRate;
  liveShear += (clamp01(shearAmount) - liveShear) * followRate;
  liveIslandSize += (clamp01(islandSize) - liveIslandSize) * followRate;
  liveFaultImpact += (clamp01(faultImpact) - liveFaultImpact) * followRate;

  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  storyPhase += deltaSeconds * localMultiplier * 0.58;
  if (storyPhase >= PHASE_WRAP) storyPhase -= PHASE_WRAP;

  var impactFollow = liveFaultImpact > impactEnvelope ? 10.0 : 2.2;
  impactEnvelope += (liveFaultImpact - impactEnvelope)
                  * min(1.0, deltaSeconds * impactFollow);

  var storyAngle = storyPhase * PI2;
  var bendAmount = 0.10 + liveFaultWarp * 0.25;
  var pressureShift = (livePressure - 0.45) * 0.08;
  var slipShift = impactEnvelope * 0.10 * sin(storyAngle + 0.8);
  control0 = 0.27 + bendAmount * 0.18 * sin(storyAngle) + pressureShift;
  control1 = 0.61 + bendAmount * 0.48 * cos(storyAngle + 0.7) + slipShift;
  control2 = 0.29 + bendAmount * 0.42 * sin(storyAngle + 2.1) - slipShift;
  control3 = 0.66 + bendAmount * 0.16 * cos(storyAngle + 1.4) - pressureShift;
  riftWidth = 0.065 + (1.0 - livePressure) * 0.095;

  islandTravel = sin(storyAngle);
  var islandProgress = abs(islandTravel);
  var islandZ = 0.60 + 0.13 * cos(storyAngle + 0.4);
  var boundaryAtIsland = cubicFault(islandZ, control0, control1, control2, control3);
  islandCenterX = boundaryAtIsland
                + islandTravel * (0.16 + liveShear * 0.18)
                + impactEnvelope * 0.07 * sin(storyAngle * 2.0);
  islandCenterZ = islandZ + liveShear * 0.09 * sin(storyAngle + 1.2);
  islandRadiusX = 0.050 + liveIslandSize * 0.085 + islandProgress * 0.030;
  islandRadiusZ = 0.080 + liveIslandSize * 0.120 + islandProgress * 0.025;

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
    var signControl0 = 0.24 + 0.08 * sin(signAngle);
    var signControl1 = 0.67 + 0.11 * cos(signAngle + 0.5);
    var signControl2 = 0.32 + 0.10 * sin(signAngle + 2.0);
    var signControl3 = 0.70 + 0.07 * cos(signAngle + 1.1);
    var signBoundary = cubicFault(signZ,
      signControl0, signControl1, signControl2, signControl3);
    var signField = signX - signBoundary;
    var signDistance = abs(signField);
    var signRift = 0.105 + (1.0 - livePressure) * 0.045;
    var signBrightness = 0.0;
    var signUseColor2 = signField > 0.0;
    if (signDistance > signRift) {
      signBrightness = 0.24;
      var signCoast = 1.0 - smoothstep(signRift,
        signRift + 0.075, signDistance);
      signBrightness = max(signBrightness, signCoast * 0.72);
      var signCutCenter = signRift + 0.19;
      var signCutDistance = abs(signDistance - signCutCenter);
      var signInlandCut = 1.0 - smoothstep(0.020, 0.052,
        signCutDistance);
      signBrightness *= 1.0 - signInlandCut;
      var signContour = 1.0 - smoothstep(0.010, 0.030,
        abs(signCutDistance - 0.060));
      signBrightness = max(signBrightness, signContour * 0.38);
    }

    var signIslandTravel = sin(signAngle);
    var signIslandX = signBoundary + signIslandTravel * 0.29;
    var signIslandZ = 0.61 + 0.12 * cos(signAngle + 0.4);
    var signIslandDx = signX - signIslandX;
    var signIslandDz = signZ - signIslandZ;
    var signIslandMetric = signIslandDx * signIslandDx / 0.020
                         + signIslandDz * signIslandDz / 0.050;
    var signIslandEdge = abs(signIslandMetric - 1.0);
    if (signIslandMetric < 1.0) {
      signUseColor2 = signIslandTravel > 0.0 ? 0.0 : 1.0;
      signBrightness = max(signBrightness, 0.44);
    }
    var signIslandRim = 1.0 - smoothstep(0.0, 0.30, signIslandEdge);
    signBrightness = max(signBrightness, signIslandRim * 0.76);

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
  var preliminaryBoundary = cubicFault(geometryZ,
    control0, control1, control2, control3);
  var preliminarySide = geometryX > preliminaryBoundary ? 1.0 : -1.0;
  var shearOffset = preliminarySide * liveShear * 0.16 * sin(storyAngle + 0.5);
  var shearedZ = clamp01(geometryZ + shearOffset);
  var boundary = cubicFault(shearedZ, control0, control1, control2, control3);
  boundary += (geometryY - 0.5) * (0.03 + livePressure * 0.09);
  boundary += preliminarySide * liveShear * 0.07 * cos(storyAngle);
  boundary += impactEnvelope * 0.09 * sin(storyAngle + geometryZ * PI2);

  var signedField = geometryX - boundary;
  var fieldDistance = abs(signedField);
  var useColor2 = signedField > 0.0;
  var materialMotion = 0.5 + 0.5
    * cos((geometryZ * 0.62 + storyPhase) * PI2);
  var brightness = 0.0;

  var coastLip = 1.0 - smoothstep(riftWidth,
    riftWidth + 0.038, fieldDistance);
  var nestedCutCenter = riftWidth + 0.145;
  var nestedCutDistance = abs(fieldDistance - nestedCutCenter);
  var nestedCut = 1.0 - smoothstep(0.018, 0.046, nestedCutDistance);
  var nestedCoast = 1.0 - smoothstep(0.008, 0.024,
    abs(nestedCutDistance - 0.055));
  if (fieldDistance > riftWidth) {
    brightness = 0.18 + materialMotion * 0.12;
    brightness = max(brightness, coastLip * 0.72);
    brightness *= 1.0 - nestedCut;
    brightness = max(brightness, nestedCoast * 0.38);
  }

  var inlandCenterX = 0.18 + 0.035 * sin(storyAngle + 0.3);
  var inlandCenterZ = 0.69 + 0.055 * cos(storyAngle + 0.9);
  var inlandDx = geometryX - inlandCenterX;
  var inlandDz = geometryZ - inlandCenterZ;
  var inlandMetric = inlandDx * inlandDx / 0.010
                   + inlandDz * inlandDz / 0.030;
  if (!useColor2 && inlandMetric < 1.0) brightness = 0.0;
  var inlandRim = 1.0 - smoothstep(0.0, 0.24, abs(inlandMetric - 1.0));
  if (!useColor2) brightness = max(brightness, inlandRim * 0.48);

  var islandDx = geometryX - islandCenterX;
  var islandDz = geometryZ - islandCenterZ;
  var islandMetric = islandDx * islandDx / (islandRadiusX * islandRadiusX)
                   + islandDz * islandDz / (islandRadiusZ * islandRadiusZ);
  var islandSeparation = abs(islandTravel);
  var islandMoat = 1.0 - smoothstep(0.0, 0.34, abs(islandMetric - 1.34));
  var islandRim = 1.0 - smoothstep(0.0, 0.28, abs(islandMetric - 1.0));
  if (islandSeparation > 0.08 && islandMetric < 1.34 && islandMetric > 1.0) {
    brightness *= 1.0 - islandMoat;
  }
  if (islandMetric < 1.0) {
    useColor2 = islandTravel < 0.0;
    brightness = max(brightness, 0.42);
  }
  brightness = max(brightness, islandRim * islandSeparation * 0.78);

  if (fixtureType == FIX_RAW_LED) {
    brightness = max(coastLip * 0.68, nestedCoast * 0.24);
    brightness = max(brightness, inlandRim * 0.34);
    brightness = max(brightness, islandRim * islandSeparation * 0.72);
  } else if (fixtureType == FIX_VINTAGE_6) {
    var surveyPosition = 0.08 + 0.84 * wave(storyPhase + 0.10);
    var surveyNear = 1.0 - smoothstep(0.030, 0.105,
      abs(geometryZ - surveyPosition));
    surveyNear *= 0.30 + 0.70
      * (1.0 - smoothstep(0.08, 0.24, fieldDistance));
    var surveyGate = pixelLocalIndex == 0.0 || pixelLocalIndex == 3.0;
    brightness = surveyGate * surveyNear
               * (0.25 + livePressure * 0.22);
  } else if (fixtureType == FIX_PAR) {
    var pressurePosition = 0.08 + 0.84 * wave(storyPhase + 0.25);
    var pressureFront = 1.0 - smoothstep(0.025, 0.085,
      abs(geometryZ - pressurePosition));
    var pressureAnchor = 0.35 + 0.65
      * (1.0 - smoothstep(0.055, 0.20, fieldDistance));
    brightness = pressureFront * pressureAnchor
               * (0.28 + livePressure * 0.25);
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
