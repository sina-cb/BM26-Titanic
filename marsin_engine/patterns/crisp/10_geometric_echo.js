// DRAFT — pending operator review
/*
  10_geometric_echo.js — GEOMETRIC ECHO

  An off-center faceted event is born near the stern, travels diagonally toward
  the bow, and leaves five finite black-spaced architectural copies behind.
  The newest chevron/octahedron owns Color 1; every older generation owns
  Color 2, widens, and simplifies into a cleaner L1 shell. There is no field,
  wash, ring, random trail, or cyan safety bed.

  At Global 0.30 / Local 0.30, a new event is born about every 1.8 wall-clock
  seconds, so the ten-second review contains five to six readable births.

  FIXTURE STAGING
    FIX_BAR_18     — complete finite faceted history with black gaps.
    FIX_RAW_LED    — leading corners and old architectural facets only.
    FIX_VINTAGE_6  — one advancing marker plus one dim tail head.
    FIX_PAR        — sparse birth punctuation; no steady anchors.
    FIX_TE_SIGN    — complete local-74 nested chevrons; the two signs use
                     complementary half-event phase and opposite chirality.

  COLOR / MATERIAL
    Every lit pixel is a scalar multiple of one exact endpoint. Shells have a
    dim edge, a visible shoulder, and a hard neon core. Overlaps select one
    winner and never cross-blend. Black is the default. W=A=U=0.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed       — continuous birth and travel cadence.
    echoSpacing      — event interval and generation separation.
    shellWidth       — physical shell and shoulder width.
    originSpread     — off-center origin spread and diagonal travel distance.
    deformationAmount — chevron fold retained by the youngest generations.
    echoPulse        — extra push and scale on the newest event.

  AUDIO_MODULATION_V1:
    sliderEchoPulse <- micKick range 0.00..1.00 curve pow2 # kicks push the newest faceted birth forward
    sliderShellWidth <- micLow range 0.20..0.58 curve ease # bass gives the finite shells architectural weight
    sliderDeformationAmount <- micFlux range 0.08..0.48 curve linear # flux folds only the youngest chevrons
  Static (unmapped) params: localSpeed, echoSpacing, originSpread,
    colorPalette1/2.
*/

export var cp1H = 0.040, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.520, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var echoSpacing = 0.52;
export var shellWidth = 0.30;
export var originSpread = 0.40;
export var deformationAmount = 0.36;
export var echoPulse = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderEchoSpacing(value) { echoSpacing = value; }
export function sliderShellWidth(value) { shellWidth = value; }
export function sliderOriginSpread(value) { originSpread = value; }
export function sliderDeformationAmount(value) { deformationAmount = value; }
export function sliderEchoPulse(value) { echoPulse = value; }

var ECHO_COUNT = 6;
var PHASE_WRAP = 100.0;

var echoAge = array(6);
var echoRoute = array(6);
var echoX = array(6);
var echoY = array(6);
var echoZ = array(6);
var echoRadius = array(6);
var echoWidth = array(6);
var echoDeform = array(6);

var initialized = 0.0;
var liveLocalSpeed = 0.30;
var echoCursor = 0.0;
var birthSerial = 0.0;
var birthClock = 0.0;
var markerPhase = 0.17;
var liveSpacing = 0.52;
var liveShellWidth = 0.30;
var liveOriginSpread = 0.40;
var liveDeformationAmount = 0.36;
var liveEchoPulse = 0.00;
var authoredSpacing = 0.52;
var authoredShellWidth = 0.30;
var authoredOriginSpread = 0.40;
var authoredDeformation = 0.36;
var authoredEchoPulse = 0.00;
var eventPeriod = 0.554;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function shellTier(coverage) {
  if (coverage > 0.74) return 0.92;
  if (coverage > 0.27) return 0.40;
  if (coverage > 0.035) return 0.14;
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
  liveSpacing += (clamp01(echoSpacing) - liveSpacing) * follow;
  liveShellWidth += (clamp01(shellWidth) - liveShellWidth) * follow;
  liveOriginSpread += (clamp01(originSpread) - liveOriginSpread) * follow;
  liveDeformationAmount += (clamp01(deformationAmount)
    - liveDeformationAmount) * follow;
  liveEchoPulse += (clamp01(echoPulse) - liveEchoPulse) * follow;

  authoredSpacing = clamp01(0.52 + (liveSpacing - 0.52) * 1.80);
  authoredShellWidth = clamp01(0.30 + (liveShellWidth - 0.30) * 1.65);
  authoredOriginSpread = clamp01(0.40 + (liveOriginSpread - 0.40) * 1.80);
  authoredDeformation = clamp01(0.36
    + (liveDeformationAmount - 0.36) * 1.90);
  authoredEchoPulse = clamp01(liveEchoPulse * 2.00);

  eventPeriod = 0.3564 + authoredSpacing * 0.38;
  var speedScale = 0.72 + liveLocalSpeed * 0.93;
  var ageStep = dt * speedScale;
  markerPhase += dt * (0.38 + liveLocalSpeed * 0.58);
  if (markerPhase >= PHASE_WRAP) markerPhase -= PHASE_WRAP;

  var slotIndex = 0.0;
  if (initialized == 0.0) {
    for (slotIndex = 0.0; slotIndex < ECHO_COUNT;
         slotIndex = slotIndex + 1.0) {
      echoAge[slotIndex] = slotIndex * eventPeriod;
      echoRoute[slotIndex] = slotIndex % 4.0;
    }
    initialized = 1.0;
  }

  birthClock += ageStep;
  for (slotIndex = 0.0; slotIndex < ECHO_COUNT;
       slotIndex = slotIndex + 1.0) {
    echoAge[slotIndex] += ageStep;
  }

  if (birthClock >= eventPeriod) {
    birthClock -= eventPeriod;
    echoCursor -= 1.0;
    if (echoCursor < 0.0) echoCursor += ECHO_COUNT;
    birthSerial += 1.0;
    echoAge[echoCursor] = 0.0;
    echoRoute[echoCursor] = birthSerial % 4.0;
  }

  var lifetime = eventPeriod * ECHO_COUNT;
  for (slotIndex = 0.0; slotIndex < ECHO_COUNT;
       slotIndex = slotIndex + 1.0) {
    var ageAmount = clamp01(echoAge[slotIndex] / lifetime);
    var route = echoRoute[slotIndex];
    var routeOffsetX = route == 0.0 ? -1.0 : (route == 1.0 ? 0.35
      : (route == 2.0 ? 1.0 : -0.25));
    var routeOffsetY = route == 0.0 ? -0.35 : (route == 1.0 ? 0.55
      : (route == 2.0 ? -0.65 : 0.30));
    var routeOffsetZ = route == 0.0 ? 0.45 : (route == 1.0 ? -0.35
      : (route == 2.0 ? 0.15 : -0.55));
    var spread = 0.025 + authoredOriginSpread * 0.075;
    var travel = 0.58 + authoredOriginSpread * 0.18;

    var analyticDrift = 0.040 * sin((markerPhase
      + slotIndex * 0.173) * PI2);
    echoX[slotIndex] = 0.13 + routeOffsetX * spread
      + ageAmount * travel + analyticDrift;
    echoY[slotIndex] = 0.30 + routeOffsetY * spread * 0.65
      + ageAmount * 0.35;
    echoZ[slotIndex] = 0.80 + routeOffsetZ * spread
      - ageAmount * (0.55 + authoredOriginSpread * 0.12)
      - analyticDrift * 0.72;
    echoRadius[slotIndex] = 0.045 + ageAmount * 0.44
      + 0.020 * sin((markerPhase + slotIndex * 0.211) * PI2)
      + (slotIndex == echoCursor) * authoredEchoPulse * 0.11;
    echoWidth[slotIndex] = 0.030 + authoredShellWidth * 0.058
      + ageAmount * 0.028;
    echoDeform[slotIndex] = authoredDeformation
      * max(0.0, 1.0 - ageAmount * 1.42)
      + (slotIndex == echoCursor) * authoredEchoPulse * 0.16;
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

  var winnerEnergy = 0.0;
  var winnerSlot = echoCursor;
  var winnerFacet = 0.0;
  var lifetime = eventPeriod * ECHO_COUNT;
  var slotIndex = 0.0;

  for (slotIndex = 0.0; slotIndex < ECHO_COUNT;
       slotIndex = slotIndex + 1.0) {
    var centerX = echoX[slotIndex];
    var centerY = echoY[slotIndex];
    var centerZ = echoZ[slotIndex];
    var radiusValue = echoRadius[slotIndex];
    var widthValue = echoWidth[slotIndex];
    var deformValue = echoDeform[slotIndex];

    if (isIdentity) {
      var localAge = echoAge[slotIndex] + signSide * eventPeriod * 0.5;
      var signAge = clamp01(localAge / lifetime);
      centerX = 0.08 + signAge * 0.84;
      centerY = 0.5;
      centerZ = 0.78 - signAge * 0.56;
      radiusValue = 0.035 + signAge * 0.40
        + (slotIndex == echoCursor) * authoredEchoPulse * 0.08;
      widthValue = 0.022 + authoredShellWidth * 0.037 + signAge * 0.018;
      widthValue *= 1.45;
      deformValue = authoredDeformation * max(0.0, 1.0 - signAge * 1.45);
    }
    if (fixtureType == FIX_RAW_LED) widthValue *= 1.48;

    var shellDx = geometryX - centerX;
    var shellDy = geometryY - centerY;
    var shellDz = geometryZ - centerZ;
    var foldedZ = shellDz + abs(shellDx) * deformValue * 0.72;
    var shellDistance = abs(shellDx) * (1.03 + deformValue * 0.80)
      + abs(shellDy) * (0.72 - deformValue * 0.10)
      + abs(foldedZ) * (0.94 + deformValue * 0.42);
    var edgeDistance = abs(shellDistance - radiusValue);
    var coverage = 1.0 - smoothstep(widthValue * 0.34,
      widthValue * 1.22, edgeDistance);
    var shellEnergy = shellTier(coverage);
    if (shellDistance < radiusValue) {
      var archivePhase = frac((radiusValue - shellDistance)
                            / (widthValue * 2.8)
                            - echoAge[slotIndex] / eventPeriod * 0.25);
      var archiveDistance = abs(archivePhase - 0.5);
      var archiveContour = 1.0 - smoothstep(0.055, 0.160, archiveDistance);
      shellEnergy = max(shellEnergy, archiveContour * 0.34);
    }
    if (shellEnergy > winnerEnergy) {
      winnerEnergy = shellEnergy;
      winnerSlot = slotIndex;
      winnerFacet = 1.0 - smoothstep(0.025, 0.145,
        abs(abs(shellDx) - abs(foldedZ)));
    }
  }

  var brightness = winnerEnergy;
  var useColor2 = winnerSlot != echoCursor;

  if (fixtureType == FIX_BAR_18) {
    var hullFacetCoordinate = frac(82.0 + pixelLocalIndex / 18.0
      - markerPhase * 0.82 + fixtureId * 0.097);
    var hullFacetDistance = abs(hullFacetCoordinate - 0.5);
    var hullFacet = 1.0 - smoothstep(0.028, 0.098,
      hullFacetDistance);
    brightness = max(brightness, hullFacet
      * (0.18 + authoredEchoPulse * 0.24));
    if (hullFacetCoordinate > 0.5) useColor2 = 1.0;
  }

  if (fixtureType == FIX_RAW_LED) {
    var strandFacetCoordinate = frac(pixelLocalIndex / 40.0
      + markerPhase * 0.74 + fixtureId * 0.131);
    var strandFacetDistance = abs(strandFacetCoordinate - 0.5);
    var strandFacet = 1.0 - smoothstep(0.025, 0.085,
      strandFacetDistance);
    brightness = max(strandFacet * 0.58, useColor2
      ? winnerEnergy * (0.42 + winnerFacet * 0.58)
      : winnerEnergy * winnerFacet * 0.86);
  } else if (fixtureType == FIX_VINTAGE_6) {
    var markerCycle = markerPhase + fixtureId * 0.113;
    markerCycle -= floor(markerCycle);
    var markerHead = floor(markerCycle * 6.0);
    var markerTail = markerHead - 1.0;
    if (markerTail < 0.0) markerTail = 5.0;
    brightness = pixelLocalIndex == markerHead ? 0.50
      : (pixelLocalIndex == markerTail ? 0.17 : 0.0);
    useColor2 = markerCycle < 0.5;
  } else if (fixtureType == FIX_PAR) {
    var newestAge = echoAge[echoCursor];
    var birthEnvelope = 1.0 - smoothstep(0.035, 0.155, newestAge);
    var birthGate = floor(fixtureId) % 6.0 == birthSerial % 6.0;
    brightness = birthGate * birthEnvelope * 0.48;
    useColor2 = 0.0;
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
