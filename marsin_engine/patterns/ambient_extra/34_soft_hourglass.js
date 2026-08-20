// DRAFT — pending operator review
/*
  34_soft_hourglass.js — SOFT HOURGLASS

  CONCEPT
    One monumental glass hourglass turns slowly through the ship. Five finite,
    mirrored pairs of luminous grains descend through a permanently bright
    central waist, preserving equal visual weight above and below the transfer.

  INSTRUMENT STAGING
    FIX_BAR_18     — the broad translucent double-cone glass volume.
    FIX_RAW_LED    — a crisp cone outline and persistent waist crossing.
    FIX_VINTAGE_6  — finite palette-RGB grains, with no native-white sparkle.
    FIX_PAR        — the concentrated waist core inside the ship's Organs.
    FIX_TE_SIGN    — paired miniature hourglass glyphs using both sign axes.

  MOTION / MATH
    A rotated elliptical radial distance is compared with a radius that grows
    linearly from abs(y - 0.5), producing one double cone rather than a vortex.
    Five independent irrational-rate grain clocks create ten mirrored points;
    every point crosses the same central waist without random regeneration.
    Rotation and parameter edits are delta-driven and slewed, so no live edit
    teleports the composition or produces a phase seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the slow glass turn and grain transfer.
    waist       — width and brightness of the persistent central throat.
    coneWidth   — breadth of both conical glass chambers.
    grain       — size and prominence of the finite falling grains.
    turn        — angular speed and depth of the rotating glass volume.
    organCore   — strength of the Organs' central waist core.
    safetyFloor — minimum whole-ship visibility beneath the hourglass.

  AUDIO_MODULATION_V1:
    sliderWaist <- micFlux range 0.20..0.52 curve ease # PRIMARY: flux opens the luminous waist
    sliderGrain <- micHigh range 0.08..0.35 curve pow2 # highs reveal the finite falling grains
  Static (unmapped) params: localSpeed, coneWidth, turn, organCore,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the straight line between cp1 and cp2. This pattern
    emits no native white and no UV: W=A=U=0 exactly. Its quiet field and
    mirrored grain pairs keep the complete ship readable in silence.
*/

export var localSpeed = 0.30;
export var waist = 0.34;
export var coneWidth = 0.55;
export var grain = 0.22;
export var turn = 0.36;
export var organCore = 0.48;
export var safetyFloor = 0.28;

export var cp1H = 0.57, cp1S = 0.76, cp1V = 0.90;
export var cp2H = 0.105, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderWaist(v) { waist = v; }
export function sliderConeWidth(v) { coneWidth = v; }
export function sliderGrain(v) { grain = v; }
export function sliderTurn(v) { turn = v; }
export function sliderOrganCore(v) { organCore = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;

var turnAngle = 0.41;
var grainClock1 = 0.07;
var grainClock2 = 0.23;
var grainClock3 = 0.41;
var grainClock4 = 0.62;
var grainClock5 = 0.84;

var liveWaist = 0.34;
var liveConeWidth = 0.55;
var liveGrain = 0.22;
var liveTurn = 0.36;
var liveOrganCore = 0.48;
var liveSafetyFloor = 0.28;

var grain1x = 0.44, grain1y = 0.82, grain1z = 0.49;
var grain2x = 0.58, grain2y = 0.66, grain2z = 0.45;
var grain3x = 0.48, grain3y = 0.52, grain3z = 0.57;
var grain4x = 0.54, grain4y = 0.35, grain4z = 0.53;
var grain5x = 0.42, grain5y = 0.19, grain5z = 0.46;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 4.0);
  liveWaist += (waist - liveWaist) * follow;
  liveConeWidth += (coneWidth - liveConeWidth) * follow;
  liveGrain += (grain - liveGrain) * follow;
  liveTurn += (turn - liveTurn) * follow;
  liveOrganCore += (organCore - liveOrganCore) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  turnAngle += dt * (0.018 + liveTurn * 0.086) * localMultiplier * PI2;
  if (turnAngle >= PHASE_WRAP * PI2) turnAngle -= PHASE_WRAP * PI2;

  grainClock1 += dt * 0.033 * localMultiplier;
  grainClock2 += dt * 0.033 * SQRT2 * localMultiplier;
  grainClock3 += dt * 0.029 * SQRT3 * localMultiplier;
  grainClock4 += dt * 0.025 * PHI * localMultiplier;
  grainClock5 += dt * 0.041 * GOLDEN_FRACTION * localMultiplier;
  if (grainClock1 >= PHASE_WRAP) grainClock1 -= PHASE_WRAP;
  if (grainClock2 >= PHASE_WRAP) grainClock2 -= PHASE_WRAP;
  if (grainClock3 >= PHASE_WRAP) grainClock3 -= PHASE_WRAP;
  if (grainClock4 >= PHASE_WRAP) grainClock4 -= PHASE_WRAP;
  if (grainClock5 >= PHASE_WRAP) grainClock5 -= PHASE_WRAP;

  // Each seed descends through one chamber. Its mirrored partner is evaluated
  // in render3D at 1-y, so the two chambers retain equal energy at all times.
  var phase1 = grainClock1 - floor(grainClock1);
  var phase2 = grainClock2 - floor(grainClock2);
  var phase3 = grainClock3 - floor(grainClock3);
  var phase4 = grainClock4 - floor(grainClock4);
  var phase5 = grainClock5 - floor(grainClock5);
  // A seamless triangle trajectory carries each mirrored pair from the wide
  // chamber rim through the throat and back. The phase endpoints meet at the
  // rim, so wrapping never teleports a grain across the glass.
  var grainTravel1 = abs(phase1 * 2.0 - 1.0);
  var grainTravel2 = abs(phase2 * 2.0 - 1.0);
  var grainTravel3 = abs(phase3 * 2.0 - 1.0);
  var grainTravel4 = abs(phase4 * 2.0 - 1.0);
  var grainTravel5 = abs(phase5 * 2.0 - 1.0);
  grain1y = 0.50 + grainTravel1 * 0.42;
  grain2y = 0.50 + grainTravel2 * 0.42;
  grain3y = 0.50 + grainTravel3 * 0.42;
  grain4y = 0.50 + grainTravel4 * 0.42;
  grain5y = 0.50 + grainTravel5 * 0.42;

  var grainCone1 = 0.024 + grainTravel1 * (0.17 + liveConeWidth * 0.13);
  var grainCone2 = 0.024 + grainTravel2 * (0.17 + liveConeWidth * 0.13);
  var grainCone3 = 0.024 + grainTravel3 * (0.17 + liveConeWidth * 0.13);
  var grainCone4 = 0.024 + grainTravel4 * (0.17 + liveConeWidth * 0.13);
  var grainCone5 = 0.024 + grainTravel5 * (0.17 + liveConeWidth * 0.13);
  grain1x = 0.50 + grainCone1 * 0.67 * sin(turnAngle + 0.0 * GOLDEN_ANGLE);
  grain1z = 0.50 + grainCone1 * 0.36 * cos(turnAngle + 0.0 * GOLDEN_ANGLE);
  grain2x = 0.50 + grainCone2 * 0.67 * sin(turnAngle + 1.0 * GOLDEN_ANGLE);
  grain2z = 0.50 + grainCone2 * 0.36 * cos(turnAngle + 1.0 * GOLDEN_ANGLE);
  grain3x = 0.50 + grainCone3 * 0.67 * sin(turnAngle + 2.0 * GOLDEN_ANGLE);
  grain3z = 0.50 + grainCone3 * 0.36 * cos(turnAngle + 2.0 * GOLDEN_ANGLE);
  grain4x = 0.50 + grainCone4 * 0.67 * sin(turnAngle + 3.0 * GOLDEN_ANGLE);
  grain4z = 0.50 + grainCone4 * 0.36 * cos(turnAngle + 3.0 * GOLDEN_ANGLE);
  grain5x = 0.50 + grainCone5 * 0.67 * sin(turnAngle + 4.0 * GOLDEN_ANGLE);
  grain5z = 0.50 + grainCone5 * 0.36 * cos(turnAngle + 4.0 * GOLDEN_ANGLE);

  _hsv2rgb1();
  _hsv2rgb2();
}

function pairedGrainDistance(px, py, pz, gx, gy, gz) {
  var dx = px - gx;
  var dz = (pz - gz) * 0.22;
  var dyTop = py - gy;
  var dyBottom = py - (1.0 - gy);
  var topDistance = sqrt(dx * dx + dyTop * dyTop + dz * dz);
  var bottomDistance = sqrt(dx * dx + dyBottom * dyBottom + dz * dz);
  return min(topDistance, bottomDistance);
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign is split across 40- and 34-pixel fixtures. Fold the complete
    // 74-pixel surface so the bottom chamber continues instead of repeating.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50;
  }

  // The ellipse makes rotation visible. Its radial SDF is compared with a
  // radius linear in |y-.5|: one clear double cone and one persistent waist.
  var cosineTurn = cos(turnAngle);
  var sineTurn = sin(turnAngle);
  var centeredX = px - 0.50;
  var centeredZ = pz - 0.50;
  var rotatedX = centeredX * cosineTurn - centeredZ * sineTurn;
  var rotatedZ = centeredX * sineTurn + centeredZ * cosineTurn;
  var ellipseDepth = 0.45 + clamp01(liveTurn) * 0.25;
  var radialDistance = sqrt(rotatedX * rotatedX
                          + (rotatedZ / ellipseDepth)
                          * (rotatedZ / ellipseDepth));
  var axialDistance = abs(py - 0.50);
  var waistRadius = 0.028 + clamp01(liveWaist) * 0.090;
  var coneSlope = 0.46 + clamp01(liveConeWidth) * 0.62;
  var coneRadius = waistRadius + axialDistance * coneSlope;
  var coneDistance = radialDistance - coneRadius;
  var coneBody = 1.0 - smoothstep(-0.012, 0.026, coneDistance);
  var glassEdge = 1.0 - smoothstep(0.010, 0.047,
                                  abs(coneDistance));
  var endGate = 1.0 - smoothstep(0.43, 0.49, axialDistance);
  coneBody *= endGate;
  glassEdge *= endGate;

  // A projected edge preserves the double-cone icon on sparse ropes and the
  // signs while the full radial field continues to author the Hull in XYZ.
  // Preserve an authoritative front silhouette even as the 3D ellipse turns
  // end-on. Depth adds a restrained rigid turn without erasing either cone.
  var iconX = centeredX * (0.88 + abs(cosineTurn) * 0.12)
            - centeredZ * sineTurn * 0.18;
  var projectedConeDistance = abs(abs(iconX) - coneRadius);
  var projectedGlassEdge = (1.0 - smoothstep(0.020, 0.095,
                                              projectedConeDistance))
                         * endGate;
  var projectedChamber = (1.0 - smoothstep(coneRadius * 0.68,
                                            coneRadius * 1.02,
                                            abs(iconX))) * endGate;
  var capBand = 1.0 - smoothstep(0.025, 0.070,
                                 abs(axialDistance - 0.42));
  var endCap = capBand * (1.0 - smoothstep(coneRadius * 0.76,
                                           coneRadius * 1.08,
                                           abs(iconX)));
  var hourglassOutline = max(projectedGlassEdge, endCap);

  var waistHeight = 0.025 + clamp01(liveWaist) * 0.075;
  var waistBand = 1.0 - smoothstep(waistHeight,
                                   waistHeight * 2.10, axialDistance);
  var waistRingDistance = abs(radialDistance - waistRadius);
  var waistRing = (1.0 - smoothstep(0.012, 0.050,
                                    waistRingDistance)) * waistBand;
  var waistCore = (1.0 - smoothstep(0.0, waistRadius * 1.30,
                                    radialDistance)) * waistBand;
  var projectedWaist = (1.0 - smoothstep(0.016, 0.086,
                                          abs(abs(iconX) - waistRadius)))
                     * waistBand;

  // Ten finite grains: five analytic points plus their exact Y mirrors. The
  // mirrored pairs guarantee equal chamber energy away from the transfer.
  // Spatial grain SDFs are evaluated only where grains are authored: the
  // Silhouette and paired signs. Jewelry has its fixture-local finite register;
  // Hull and Organs remain glass and throat, respectively.
  var nearestGrain = 2.0;
  if (fixtureType == FIX_RAW_LED || isSign) {
    nearestGrain = pairedGrainDistance(px, py, pz,
                                       grain1x, grain1y, grain1z);
    nearestGrain = min(nearestGrain,
                       pairedGrainDistance(px, py, pz,
                                           grain2x, grain2y, grain2z));
    nearestGrain = min(nearestGrain,
                       pairedGrainDistance(px, py, pz,
                                           grain3x, grain3y, grain3z));
    nearestGrain = min(nearestGrain,
                       pairedGrainDistance(px, py, pz,
                                           grain4x, grain4y, grain4z));
    nearestGrain = min(nearestGrain,
                       pairedGrainDistance(px, py, pz,
                                           grain5x, grain5y, grain5z));
  }
  var grainRadius = 0.020 + clamp01(liveGrain) * 0.075;
  var grainCore = 1.0 - smoothstep(grainRadius * 0.30,
                                   grainRadius, nearestGrain);
  var grainHalo = 1.0 - smoothstep(grainRadius,
                                   grainRadius * 2.45, nearestGrain);
  var grainPresence = 0.16 + clamp01(liveGrain) * 0.84;
  grainCore *= grainPresence;
  grainHalo *= grainPresence;

  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.205;
  var brightness = floorLevel + coneBody * 0.10 + glassEdge * 0.20
                 + waistRing * 0.22 + grainHalo * 0.12
                 + grainCore * 0.40;
  var paletteMix = clamp01(0.12 + axialDistance * 0.78
                          + glassEdge * 0.10 + grainCore * 0.44);

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the translucent glass body: broad panes, a fine rim,
    // and a deliberately darker outside field for distance-scale definition.
    var glassRefraction = wave(rotatedX * 1.37 - rotatedZ * SQRT2
                              + axialDistance * PHI + turnAngle / PI2 * 0.13);
    brightness = floorLevel + coneBody * (0.08 + glassRefraction * 0.10)
               + projectedChamber * 0.08
               + max(glassEdge, hourglassOutline) * 0.64
               + waistRing * (0.28 + liveWaist * 0.34)
               + grainHalo * 0.12 + grainCore * 0.34;
    paletteMix = clamp01(0.08 + axialDistance * 0.66
                       + glassRefraction * 0.12 + grainCore * 0.45);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette draws the cone and throat as a far-field icon.
    brightness = floorLevel + 0.07
               + max(glassEdge, hourglassOutline) * 1.18
               + projectedChamber * 0.045
               + max(waistRing, projectedWaist)
               * (0.44 + liveWaist * 0.44)
               + grainHalo * 0.18 + grainCore * 0.58;
    paletteMix = clamp01(0.06 + axialDistance * 0.72
                       + waistRing * 0.12 + grainCore * 0.52);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry is the finite grain instrument. It stays on palette RGB and
    // intentionally emits no native white, keeping the grains chromatic.
    var railSeed = 0.5 + 0.5
                 * sin(index * GOLDEN_ANGLE + turnAngle * GOLDEN_FRACTION);
    var railGrain = max(grainCore, pow(railSeed, 11.0) * grainPresence);
    brightness = floorLevel * 0.70 + 0.045 + grainHalo * 0.28
               + railGrain * (0.44 + liveGrain * 0.66)
               + waistBand * 0.08;
    paletteMix = clamp01(0.28 + railGrain * 0.64
                       + axialDistance * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs hold the central transfer point. OrganCore is isolated here so
    // its entire range remains visibly and semantically truthful.
    var organPulse = wave(turnAngle / PI2 * SQRT3
                        + pixelLocalIndex * GOLDEN_FRACTION);
    var organPool = pow(organPulse,
                        8.0 - clamp01(liveOrganCore) * 6.0);
    brightness = floorLevel + 0.12 + coneBody * 0.10
               + waistBand * (0.72 + organPulse * 0.28)
               * (0.18 + clamp01(liveOrganCore) * 0.66)
               + organPool * (0.04 + clamp01(liveOrganCore) * 0.72)
               + grainCore * 0.24;
    paletteMix = clamp01(0.60 + waistBand * 0.24
                       + organPool * 0.10 + grainCore * 0.08);
  } else if (isSign) {
    // Paired signs show the complete hourglass glyph at a protected reading
    // floor. Both pseudo-map axes drive the cone, waist, and finite grains.
    var sandSheen = wave(px * 0.67 + py * 0.43
                        - turnAngle / PI2 * 0.83)
                   * wave(py * 0.59 - px * 0.29
                        + grainClock1 * 1.41421356);
    brightness = max(0.28, floorLevel + 0.12
                   + coneBody * 0.10
                   + max(glassEdge, hourglassOutline) * 1.02
                   + projectedChamber * 0.055
                   + max(waistRing, projectedWaist)
                   * (0.34 + liveWaist * 0.40)
                   + grainHalo * 0.22 + grainCore * 0.56
                   + sandSheen * 0.22);
    paletteMix = clamp01(0.10 + axialDistance * 0.70
                       + waistRing * 0.12 + grainCore * 0.52
                       + sandSheen * 0.16);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
