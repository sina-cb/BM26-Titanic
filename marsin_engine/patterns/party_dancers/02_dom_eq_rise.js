// DRAFT - pending operator review
/*
  02_dom_eq_rise.js - SPINNING BOTTOM-UP DOM EQ

  Two dominant-frequency lanes become paired, antipodal EQ columns around the
  ship. Frequency is log-normalized over the analyzer's useful 30..8000 Hz
  range and sets the height of each column. Its matching dominant energy sets
  strength, vertical head thickness, and azimuthal brush width. The filled
  tail stays below the luminous head, so changes read as bottom-to-top EQ
  movement from a long distance rather than as small floating particles.

  Spin advances one shared global azimuth. Every fixture sees the same phase;
  each lane is repeated exactly opposite itself, keeping port/starboard and
  front/back exposure fair while the emphasis travels around the hull. Spin at
  zero freezes the orientation. The TE signs use the same phase on measured
  glyph-local coordinates so both 74-pixel surfaces remain balanced and alive.

  Bars carry the broad columns, strands sharpen the rising edge, Vintage pixels
  become sparse jewels, and PAR Organs add spatial LOW breath plus a restrained
  KICK heartbeat only where a column is present. A low two-palette mathematical
  field covers every pixel in silence. White, amber, and UV remain zero.

  AUDIO_MODULATION_V1:
    # DOM signals are authoritative playlist routes; V1 suggestion syntax
    # accepts only the processed five-signal family.
    sliderOrganEnergy <- micLow range 0.00..0.84 curve ease
    sliderOrganKick <- micKick range 0.00..0.78 curve pow2
  # STATIC: localSpeed, level, bandWidth, backgroundLevel, identityLevel,
  # spin, palettes.
*/

export var localSpeed = 0.24;
export var level = 0.58;
export var bandWidth = 0.48;
export var backgroundLevel = 0.30;
export var organEnergy = 0.34;
export var organKick = 0.10;
export var identityLevel = 0.52;
export var spin = 0.32;
export var domFreq1 = 0.007256;
export var domEnergy1 = 0.54;
export var domFreq2 = 0.079819;
export var domEnergy2 = 0.54;

export var cp1H = 0.55, cp1S = 0.95, cp1V = 1.0;
export var cp2H = 0.92, cp2S = 0.92, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBandWidth(v) { bandWidth = v; }
export function sliderBackgroundLevel(v) { backgroundLevel = v; }
export function sliderOrganEnergy(v) { organEnergy = v; }
export function sliderOrganKick(v) { organKick = v; }
export function sliderIdentityLevel(v) { identityLevel = v; }
export function sliderSpin(v) { spin = v; }
export function sliderDomFreq1(v) { domFreq1 = v; }
export function sliderDomEnergy1(v) { domEnergy1 = v; }
export function sliderDomFreq2(v) { domFreq2 = v; }
export function sliderDomEnergy2(v) { domEnergy2 = v; }

var DOM_MIN_HZ = 30.0;
var DOM_MAX_HZ = 8000.0;
var DOM_REGISTRY_MAX_HZ = 22050.0;
var FULL_TURN = 6.28318530718;
var SIDE_SPLIT_X = 0.5253936432;
var PHASE_WRAP = 10000.0;

var fieldPhase = 0.0;
var spinPhase = 0.0;
var liveLevel = 0.58;
var liveBandWidth = 0.48;
var liveBackground = 0.30;
var liveOrganEnergy = 0.34;
var liveOrganKick = 0.10;
var liveIdentityLevel = 0.52;
var liveSpin = 0.32;
var liveDomFreq1 = 0.007256;
var liveDomEnergy1 = 0.54;
var liveDomFreq2 = 0.079819;
var liveDomEnergy2 = 0.54;
var liveHeight1 = 0.32;
var liveHeight2 = 0.68;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) { return min(1.0, max(0.0, v)); }
function wrap01(v) { return v - floor(v); }

function smoothValue(current, target, attack, release, dt) {
  var rate = release;
  if (target > current) rate = attack;
  return current + (target - current) * min(1.0, dt * rate);
}

function smoothStep01(v) {
  var stepAmount = clamp01(v);
  return stepAmount * stepAmount * (3.0 - 2.0 * stepAmount);
}

function frequencyHeight(normalizedRegistryValue, parkedHeight) {
  var hz = clamp01(normalizedRegistryValue) * DOM_REGISTRY_MAX_HZ;
  var livePresence = smoothStep01(hz / DOM_MIN_HZ);
  var usefulHz = max(DOM_MIN_HZ, min(DOM_MAX_HZ, hz));
  var logPosition = (log(usefulHz) - log(DOM_MIN_HZ))
    / (log(DOM_MAX_HZ) - log(DOM_MIN_HZ));
  var audioHeight = 0.10 + clamp01(logPosition) * 0.80;
  return parkedHeight + (audioHeight - parkedHeight) * livePresence;
}

function circularDistance(a, b) {
  return abs(wrap01(a - b + 0.5) - 0.5);
}

function pairedLobes(azimuth, center, width) {
  var distanceA = circularDistance(azimuth, center);
  var distanceB = circularDistance(azimuth, wrap01(center + 0.5));
  var distance = min(distanceA, distanceB) / max(0.018, width);
  return exp(-0.5 * distance * distance);
}

function verticalColumn(modelY, center, headWidth, energy) {
  var headDistance = (modelY - center) / max(0.018, headWidth);
  var head = exp(-0.5 * headDistance * headDistance);
  var cutoff = smoothStep01((center + headWidth - modelY) / max(0.018, headWidth * 2.0));
  var tailTexture = 0.72 + 0.28 * wave(modelY * 1.73205080757 - fieldPhase * 0.31);
  return max(head, cutoff * (0.28 + energy * 0.58) * tailTexture);
}

function isTestBenchPixel() {
  if (controllerId == 1 && sectionId >= 1 && sectionId <= 4) return 1;
  if (controllerId == 2 && (sectionId == 5 || sectionId == 6)) return 1;
  if (controllerId == 0 && sectionId == 3 && fixtureType == FIX_TE_SIGN) return 1;
  return 0;
}

function identityLongitudinalU(modelX, modelZ, benchPixel) {
  if (benchPixel == 1) return modelX;
  if (modelX < SIDE_SPLIT_X) {
    return clamp01(26.751572327 * modelZ - 21.396855346);
  }
  return clamp01(34.162087014 * modelX + 22.171335999 * modelZ
    - 35.347564959);
}

function identityVertical(modelX, modelY, benchPixel) {
  if (benchPixel == 1) return modelY;
  if (modelX < SIDE_SPLIT_X) return clamp01((modelY - 0.5159) / 0.1468);
  return clamp01((modelY - 0.5246) / 0.1478);
}

function _hsv2rgb1() {
  var hv = wrap01(cp1H) * 6.0, iv = floor(hv), fv = hv - iv;
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function _hsv2rgb2() {
  var hv = wrap01(cp2H) * 6.0, iv = floor(hv), fv = hv - iv;
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; }
  else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; }
  else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; }
  else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; }
  else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
}

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var cadence = pow(2.0, (clamp01(localSpeed) - 0.5) * 3.0);

  liveLevel = smoothValue(liveLevel, clamp01(level), 9.0, 5.0, dt);
  liveBandWidth = smoothValue(liveBandWidth, clamp01(bandWidth), 7.0, 5.0, dt);
  liveBackground = smoothValue(liveBackground, clamp01(backgroundLevel), 6.0, 4.0, dt);
  liveOrganEnergy = smoothValue(liveOrganEnergy, clamp01(organEnergy), 9.0, 3.5, dt);
  liveOrganKick = smoothValue(liveOrganKick, clamp01(organKick), 16.0, 4.0, dt);
  liveIdentityLevel = smoothValue(liveIdentityLevel, clamp01(identityLevel), 7.0, 4.0, dt);
  // A rate edit cannot teleport the field; direct assignment makes zero an
  // immediate hold without an invisible coast-down interval.
  liveSpin = clamp01(spin);
  liveDomFreq1 = smoothValue(liveDomFreq1, clamp01(domFreq1), 5.0, 3.0, dt);
  liveDomEnergy1 = smoothValue(liveDomEnergy1, clamp01(domEnergy1), 13.0, 3.5, dt);
  liveDomFreq2 = smoothValue(liveDomFreq2, clamp01(domFreq2), 5.0, 3.0, dt);
  liveDomEnergy2 = smoothValue(liveDomEnergy2, clamp01(domEnergy2), 13.0, 3.5, dt);

  var targetHeight1 = frequencyHeight(liveDomFreq1, 0.30);
  var targetHeight2 = frequencyHeight(liveDomFreq2, 0.70);
  liveHeight1 = smoothValue(liveHeight1, targetHeight1, 6.0 * cadence, 3.5 * cadence, dt);
  liveHeight2 = smoothValue(liveHeight2, targetHeight2, 6.0 * cadence, 3.5 * cadence, dt);

  fieldPhase = fieldPhase + dt * (0.035 + 0.090 * cadence);
  if (fieldPhase >= PHASE_WRAP) fieldPhase = fieldPhase - PHASE_WRAP;
  spinPhase = spinPhase + dt * liveSpin * 0.12 * cadence;
  if (spinPhase >= 1.0) spinPhase = spinPhase - 1.0;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var modelX = clamp01(x), modelY = clamp01(y), modelZ = clamp01(z);
  var benchPixel = isTestBenchPixel();
  var azimuth = wrap01(atan2(modelZ - 0.5, modelX - 0.5) / FULL_TURN);
  var width1 = 0.038 + liveBandWidth * 0.050 + liveDomEnergy1 * 0.060;
  var width2 = 0.038 + liveBandWidth * 0.050 + liveDomEnergy2 * 0.060;
  var headWidth1 = 0.020 + liveBandWidth * 0.030 + liveDomEnergy1 * 0.044;
  var headWidth2 = 0.020 + liveBandWidth * 0.030 + liveDomEnergy2 * 0.044;
  var orbit1 = pairedLobes(azimuth, spinPhase, width1);
  var orbit2 = pairedLobes(azimuth, wrap01(spinPhase + 0.25), width2);
  var column1 = verticalColumn(modelY, liveHeight1, headWidth1, liveDomEnergy1);
  var column2 = verticalColumn(modelY, liveHeight2, headWidth2, liveDomEnergy2);
  var prominence1 = orbit1 * column1 * (0.10 + liveDomEnergy1 * 0.90);
  var prominence2 = orbit2 * column2 * (0.10 + liveDomEnergy2 * 0.90);

  var field1 = wave(azimuth * 1.61803398875 + modelY * 0.71 + fieldPhase);
  var field2 = wave(azimuth * 2.41421356237 - modelY * 0.43 - fieldPhase * 0.73);
  var safetyFloor = 0.026 + liveBackground * 0.045;
  var backgroundAmount = liveBackground * (0.020 + 0.112
    * (0.46 + field1 * 0.31 + field2 * 0.23));
  var lane1Amount = prominence1;
  var lane2Amount = prominence2;

  if (fixtureType == FIX_BAR_18) {
    lane1Amount = prominence1 * 1.12;
    lane2Amount = prominence2 * 1.12;
  } else if (fixtureType == FIX_RAW_LED) {
    var edge1 = exp(-0.5 * ((modelY - liveHeight1) / max(0.014, headWidth1 * 0.58))
      * ((modelY - liveHeight1) / max(0.014, headWidth1 * 0.58)));
    var edge2 = exp(-0.5 * ((modelY - liveHeight2) / max(0.014, headWidth2 * 0.58))
      * ((modelY - liveHeight2) / max(0.014, headWidth2 * 0.58)));
    lane1Amount = orbit1 * (column1 * 0.40 + edge1 * 0.60)
      * (0.10 + liveDomEnergy1 * 0.82);
    lane2Amount = orbit2 * (column2 * 0.40 + edge2 * 0.60)
      * (0.10 + liveDomEnergy2 * 0.82);
    backgroundAmount = backgroundAmount * 0.74;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var jewel = pow(wave(pixelLocalIndex * 0.38196601125 + fieldPhase * 0.19), 8.0);
    lane1Amount = prominence1 * (0.28 + jewel * 0.72) * 0.82;
    lane2Amount = prominence2 * (0.28 + jewel * 0.72) * 0.82;
    backgroundAmount = backgroundAmount * 0.60;
  } else if (fixtureType == FIX_PAR) {
    var breath = liveOrganEnergy * (0.20 + 1.42 * wave(fieldPhase * 0.29 + modelY * 0.37));
    var heartbeat = liveOrganKick * 1.42;
    lane1Amount = prominence1 * (0.24 + breath + heartbeat) * 0.78;
    lane2Amount = prominence2 * (0.24 + breath + heartbeat) * 0.78;
    backgroundAmount = backgroundAmount * 0.66;
  } else if (fixtureType == FIX_TE_SIGN) {
    var signU = identityLongitudinalU(modelX, modelZ, benchPixel);
    var signY = identityVertical(modelX, modelY, benchPixel);
    var signOrbit1 = pairedLobes(signU, spinPhase, width1 * 1.10);
    var signOrbit2 = pairedLobes(signU, wrap01(spinPhase + 0.25), width2 * 1.10);
    var signColumn1 = verticalColumn(signY, liveHeight1, headWidth1 * 1.12, liveDomEnergy1);
    var signColumn2 = verticalColumn(signY, liveHeight2, headWidth2 * 1.12, liveDomEnergy2);
    var identityGain = 0.04 + liveIdentityLevel * 2.35;
    safetyFloor = max(safetyFloor, 0.074);
    lane1Amount = (0.022 + signOrbit1 * signColumn1
      * (0.14 + liveDomEnergy1 * 0.86)) * identityGain;
    lane2Amount = (0.022 + signOrbit2 * signColumn2
      * (0.14 + liveDomEnergy2 * 0.86)) * identityGain;
    backgroundAmount = backgroundAmount * 0.54;
  }

  var finalGain = liveLevel * 2.30;
  var base1 = safetyFloor * (0.58 + field1 * 0.22) + backgroundAmount * 0.56;
  var base2 = safetyFloor * (0.58 + field2 * 0.22) + backgroundAmount * 0.56;
  var amount1 = clamp01(base1 + lane1Amount * finalGain);
  var amount2 = clamp01(base2 + lane2Amount * finalGain);
  var outR = 1.0 - (1.0 - pr1 * amount1) * (1.0 - pr2 * amount2);
  var outG = 1.0 - (1.0 - pg1 * amount1) * (1.0 - pg2 * amount2);
  var outB = 1.0 - (1.0 - pb1 * amount1) * (1.0 - pb2 * amount2);
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
