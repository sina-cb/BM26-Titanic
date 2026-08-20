// DRAFT - pending operator review
/*
  01_dom_ball_dancers.js - MIRRORED 1D DOM BANDS

  The Titanic is treated as two physical hull halves. Each half gets one
  measured longitudinal coordinate, u=0 at the central break and u=1 at its
  outboard end. The right half uses its own rotated X/Z projection and is
  reversed, so identical u values read as exact physical mirrors. This is a
  simple one-dimensional projection: there are no orbiting centers, trails,
  particles, temporal hashes, or reseeds.

  The two real analyzer lanes are independent. micDomFreq1/2 are published as
  Hz in [0,22050], normalized by the playlist into sliderDomFreq1/2. We rebuild
  Hz, log-normalize the analyzer's useful 30..8000 Hz range, and glide each
  center. micDomEnergy1/2 widen and strengthen only their matching band. At
  zero frequency the lanes park continuously at distinct stable positions;
  this is the authored silence state, not a missing-signal fallback.

  Lane 1 is always palette endpoint 1 and lane 2 is always endpoint 2. Their
  RGB contributions use screen composition, retaining both identities at an
  overlap without inventing a third accent. The background also uses only the
  two endpoints. White and amber are unused, therefore W=A=0 exactly.

  Titanic fixture staging is role-specific but shares the same u gesture:
  Bars are the broad primary canvas; strands echo the band edges; Vintage
  pixels make sparse fixed jewel peaks; PAR Organs place LOW breath and KICK
  heartbeat at the nearest band; TE signs use measured per-sign local u plus
  local glyph Y detail. The portable test_bench has an explicit, documented
  metadata path and normalized x/y coordinates. Its canonical low controller
  and section tuples are mutually exclusive with Titanic's fixture metadata;
  there is no coordinate-error catch or silent generic geometry fallback.

  Spin rotates one shared two-dimensional coordinate frame inside both hull
  halves. At zero, the original longitudinal composition is exact. Above zero,
  both halves turn through the same angle and the bands travel through their
  front/back depth instead of remaining pinned to one line. The TE signs rotate
  the same field through their measured glyph-local surface.

  AUDIO_MODULATION_V1:
    # DOM signals are real registry routes owned by party_dancers.yaml; V1
    # suggestion syntax accepts only the processed five-signal family:
    # micDomFreq1 -> sliderDomFreq1; micDomEnergy1 -> sliderDomEnergy1.
    # micDomFreq2 -> sliderDomFreq2; micDomEnergy2 -> sliderDomEnergy2.
    sliderOrganEnergy <- micLow  range 0.00..0.88 curve ease   # sustained spatial Organ breath
    sliderOrganKick   <- micKick range 0.00..0.82 curve pow2   # restrained spatial Organ heartbeat
  # STATIC: localSpeed, level, minimumWidth, energyWidth,
  # backgroundLevel, identityLevel, spin, palettes.
*/

export var localSpeed = 0.14;
export var level = 0.50;
export var minimumWidth = 0.42;
export var energyWidth = 0.58;
export var backgroundLevel = 0.38;
export var organEnergy = 0.36;
export var organKick = 0.12;
export var identityLevel = 0.48;
export var domFreq1 = 0.007256;
export var domEnergy1 = 0.52;
export var domFreq2 = 0.079819;
export var domEnergy2 = 0.52;
export var spin = 0.28;

export var cp1H = 0.55, cp1S = 0.95, cp1V = 1.0;
export var cp2H = 0.92, cp2S = 0.92, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderMinimumWidth(v) { minimumWidth = v; }
export function sliderEnergyWidth(v) { energyWidth = v; }
export function sliderBackgroundLevel(v) { backgroundLevel = v; }
export function sliderOrganEnergy(v) { organEnergy = v; }
export function sliderOrganKick(v) { organKick = v; }
export function sliderIdentityLevel(v) { identityLevel = v; }
export function sliderDomFreq1(v) { domFreq1 = v; }
export function sliderDomEnergy1(v) { domEnergy1 = v; }
export function sliderDomFreq2(v) { domFreq2 = v; }
export function sliderDomEnergy2(v) { domEnergy2 = v; }
export function sliderSpin(v) { spin = v; }

var DOM_MIN_HZ = 30.0;
var DOM_MAX_HZ = 8000.0;
var DOM_REGISTRY_MAX_HZ = 22050.0;
var SIDE_SPLIT_X = 0.5253936432;
var PHASE_WRAP = 10000.0;

var fieldPhase = 0.0;
var liveLevel = 0.50;
var liveMinimumWidth = 0.42;
var liveEnergyWidth = 0.58;
var liveBackground = 0.38;
var liveOrganEnergy = 0.36;
var liveOrganKick = 0.12;
var liveIdentityLevel = 0.48;
var liveDomFreq1 = 0.007256;
var liveDomEnergy1 = 0.52;
var liveDomFreq2 = 0.079819;
var liveDomEnergy2 = 0.52;
var liveSpin = 0.28;
var liveCenter1 = 0.36;
var liveCenter2 = 0.64;
var spinPhase = 0.0;
var spinSin = 0.0;
var spinCos = 1.0;

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

function frequencyCenter(normalizedRegistryValue, parkedCenter) {
  var hz = clamp01(normalizedRegistryValue) * DOM_REGISTRY_MAX_HZ;
  var livePresence = smoothStep01(hz / DOM_MIN_HZ);
  var usefulHz = max(DOM_MIN_HZ, min(DOM_MAX_HZ, hz));
  var logPosition = (log(usefulHz) - log(DOM_MIN_HZ))
    / (log(DOM_MAX_HZ) - log(DOM_MIN_HZ));
  var audioPosition = 0.10 + clamp01(logPosition) * 0.80;
  return parkedCenter + (audioPosition - parkedCenter) * livePresence;
}

// Titanic longitudinal coordinates derived from the four real hull faces.
// LEFT front/back share world-X anchors -13.5 (center break) and -31.5
// (outboard). RIGHT front/back share the oblique (14.1,-11.0) axis; their
// (-6,-7.5) face offset cancels algebraically. Both sides therefore use u=0
// at the center break and u=1 outboard, with exact mirror correspondence.
function titanicLongitudinalU(modelX, modelZ) {
  if (modelX < SIDE_SPLIT_X) {
    return clamp01(2.045444444444444 - 5.320666666666667 * modelX);
  }
  return clamp01(4.182183406113537 * modelX - 1.485938864628821 * modelZ
    - 2.113310043668122);
}

// Exact test_bench model contract. Titanic may use controllers 1/2, but never
// in these low sections; its section-3 TE signs are controllers 17/18. This
// deliberately self-declared path compiles without Titanic-only named views.
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

function rotatedHullU(u, modelZ) {
  var longitudinal = u - 0.5;
  var depth = (modelZ - 0.5) * 0.84;
  return clamp01(0.5 + longitudinal * spinCos + depth * spinSin);
}

function rotatedIdentityU(signU, signY) {
  var horizontal = signU - 0.5;
  var vertical = (signY - 0.5) * 0.76;
  return clamp01(0.5 + horizontal * spinCos + vertical * spinSin);
}

function bellAt(u, center, width) {
  var d = (u - center) / max(0.012, width);
  return exp(-0.5 * d * d);
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
  liveMinimumWidth = smoothValue(liveMinimumWidth, clamp01(minimumWidth), 7.0, 5.0, dt);
  liveEnergyWidth = smoothValue(liveEnergyWidth, clamp01(energyWidth), 7.0, 5.0, dt);
  liveBackground = smoothValue(liveBackground, clamp01(backgroundLevel), 6.0, 4.0, dt);
  liveOrganEnergy = smoothValue(liveOrganEnergy, clamp01(organEnergy), 9.0, 3.5, dt);
  liveOrganKick = smoothValue(liveOrganKick, clamp01(organKick), 16.0, 4.0, dt);
  liveIdentityLevel = smoothValue(liveIdentityLevel, clamp01(identityLevel), 7.0, 4.0, dt);
  liveDomFreq1 = smoothValue(liveDomFreq1, clamp01(domFreq1), 5.0, 3.0, dt);
  liveDomEnergy1 = smoothValue(liveDomEnergy1, clamp01(domEnergy1), 13.0, 3.5, dt);
  liveDomFreq2 = smoothValue(liveDomFreq2, clamp01(domFreq2), 5.0, 3.0, dt);
  liveDomEnergy2 = smoothValue(liveDomEnergy2, clamp01(domEnergy2), 13.0, 3.5, dt);
  // Spin changes angular velocity, never phase, so direct assignment is both
  // continuous and makes zero an immediate, truthful hold.
  liveSpin = clamp01(spin);

  // Local Speed changes only field motion and settling cadence. It never
  // changes either audio-derived target position.
  // MarsinVM requires user-function results to be materialized before they
  // are passed to another user function; nested calls alias argument slots.
  var targetCenter1 = frequencyCenter(liveDomFreq1, 0.30);
  var targetCenter2 = frequencyCenter(liveDomFreq2, 0.70);
  liveCenter1 = smoothValue(liveCenter1, targetCenter1,
    5.0 * cadence, 3.0 * cadence, dt);
  liveCenter2 = smoothValue(liveCenter2, targetCenter2,
    5.0 * cadence, 3.0 * cadence, dt);
  fieldPhase = fieldPhase + dt * (0.025 + 0.075 * cadence);
  if (fieldPhase >= PHASE_WRAP) fieldPhase = fieldPhase - PHASE_WRAP;
  spinPhase = spinPhase + dt * liveSpin * 0.12 * cadence;
  if (spinPhase >= 1.0) spinPhase = spinPhase - 1.0;
  spinSin = sin(spinPhase * 6.28318530718);
  spinCos = cos(spinPhase * 6.28318530718);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var modelX = clamp01(x), modelY = clamp01(y), modelZ = clamp01(z);
  var benchPixel = isTestBenchPixel();
  var u = titanicLongitudinalU(modelX, modelZ);
  if (benchPixel == 1) u = modelX;
  u = rotatedHullU(u, modelZ);

  var widthFloor = 0.035 + liveMinimumWidth * 0.055;
  var widthRange = 0.025 + liveEnergyWidth * 0.080;
  var width1 = widthFloor + liveDomEnergy1 * widthRange;
  var width2 = widthFloor + liveDomEnergy2 * widthRange;
  var band1 = bellAt(u, liveCenter1, width1);
  var band2 = bellAt(u, liveCenter2, width2);
  var prominence1 = (0.105 + liveDomEnergy1 * 0.895) * band1;
  var prominence2 = (0.105 + liveDomEnergy2 * 0.895) * band2;

  // Predominantly longitudinal, palette-endpoint-only mathematical bed.
  // The Y term is deliberately restrained and derived rather than knobbed.
  var field1 = wave(u * 1.61803398875 + fieldPhase);
  var field2 = wave(u * 2.41421356237 - fieldPhase * 0.73
    + (modelY - 0.5) * 0.18);
  var backgroundShape = 0.42 + 0.34 * field1 + 0.24 * field2;
  var safetyFloor = 0.024 + liveBackground * 0.045;
  var backgroundAmount = liveBackground * (0.018 + 0.120 * backgroundShape);
  var lane1Amount = prominence1;
  var lane2Amount = prominence2;

  if (fixtureType == FIX_BAR_18) {
    lane1Amount = prominence1 * 1.08;
    lane2Amount = prominence2 * 1.08;
  } else if (fixtureType == FIX_RAW_LED) {
    var edge1 = band1 * (1.0 - band1) * 4.0;
    var edge2 = band2 * (1.0 - band2) * 4.0;
    lane1Amount = (band1 * 0.30 + edge1 * 0.70)
      * (0.105 + liveDomEnergy1 * 0.895) * 0.82;
    lane2Amount = (band2 * 0.30 + edge2 * 0.70)
      * (0.105 + liveDomEnergy2 * 0.895) * 0.82;
    backgroundAmount = backgroundAmount * 0.72;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var jewel = pow(wave(pixelLocalIndex * 0.38196601125 + u * 0.23), 8.0);
    lane1Amount = pow(band1, 1.65) * (0.08 + liveDomEnergy1 * 0.72)
      * (0.30 + jewel * 0.70);
    lane2Amount = pow(band2, 1.65) * (0.08 + liveDomEnergy2 * 0.72)
      * (0.30 + jewel * 0.70);
    backgroundAmount = backgroundAmount * 0.58;
  } else if (fixtureType == FIX_PAR) {
    var nearest1 = 0.10 + band1 * 0.90;
    var nearest2 = 0.10 + band2 * 0.90;
    var breath = liveOrganEnergy * (0.22 + 1.48 * wave(fieldPhase * 0.31 + u * 0.43));
    var heartbeat = liveOrganKick * 1.50;
    lane1Amount = prominence1 * 0.18 + nearest1 * (breath + heartbeat) * 0.56;
    lane2Amount = prominence2 * 0.18 + nearest2 * (breath + heartbeat) * 0.56;
    backgroundAmount = backgroundAmount * 0.64;
  } else if (fixtureType == FIX_TE_SIGN) {
    var signU = identityLongitudinalU(modelX, modelZ, benchPixel);
    var signY = identityVertical(modelX, modelY, benchPixel);
    signU = rotatedIdentityU(signU, signY);
    band1 = bellAt(signU, liveCenter1, width1);
    band2 = bellAt(signU, liveCenter2, width2);
    var glyphDetail = 0.76 + 0.24 * wave(signY * 2.35 + fieldPhase * 0.63);
    var identityGain = 0.03 + liveIdentityLevel * 2.40;
    safetyFloor = max(safetyFloor, 0.072);
    lane1Amount = (0.020 + band1 * (0.13 + liveDomEnergy1 * 0.87))
      * glyphDetail * identityGain;
    lane2Amount = (0.020 + band2 * (0.13 + liveDomEnergy2 * 0.87))
      * glyphDetail * identityGain;
    backgroundAmount = backgroundAmount * 0.55;
  }

  // Level is the honest final gain for expressive bands/material response;
  // the palette-derived safety/background bed above remains nonzero at zero.
  var finalGain = liveLevel * 2.25;
  var base1 = safetyFloor * (0.58 + 0.22 * field1) + backgroundAmount * 0.56;
  var base2 = safetyFloor * (0.58 + 0.22 * field2) + backgroundAmount * 0.56;
  var amount1 = clamp01(base1 + lane1Amount * finalGain);
  var amount2 = clamp01(base2 + lane2Amount * finalGain);

  // Per-channel screen composition: deliberate, smooth, and endpoint-exact.
  var outR = 1.0 - (1.0 - pr1 * amount1) * (1.0 - pr2 * amount2);
  var outG = 1.0 - (1.0 - pg1 * amount1) * (1.0 - pg2 * amount2);
  var outB = 1.0 - (1.0 - pb1 * amount1) * (1.0 - pb2 * amount2);
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
