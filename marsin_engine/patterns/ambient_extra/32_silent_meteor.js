// DRAFT — pending operator review
/*
  32_silent_meteor.js — SILENT METEOR

  CONCEPT
    One connected diagonal meteor crosses the ship, then leaves nineteen to
    thirty-one seconds of composed night before it returns. It is a rare
    cinematic event with a refined Jewelry memory, never rain or a particle
    field.

  INSTRUMENT STAGING
    FIX_BAR_18     — faint dimensional sky and the primary connected stroke.
    FIX_RAW_LED    — protected Silhouette outline with a restrained crossing.
    FIX_VINTAGE_6  — sparse matched W+A afterglow on selected rail heads.
    FIX_PAR        — one short impact echo when the meteor enters.
    FIX_TE_SIGN    — paired fixture-local diagonal passes on both TE signs.

  MOTION / MATH
    The meteor is the signed distance to one finite 3D line segment. Its head
    travels between opposite off-model endpoints while its analytic tail
    follows on the same segment, so it cannot fragment into droplets. A scalar
    event clock schedules one crossing every 19..31 engine-clock seconds and
    two scalar decay envelopes hold the Jewelry memory and Organ echo. A boot
    preview is intentionally outside that recurring cadence. The quiet sky
    uses two broad irrational spatial harmonics at very low speed.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed       — traversal speed plus the quiet sky's matching drift.
    direction        — genuine meteor travel and matching sky-drift direction.
    interval         — time between meteor starts, from 19 to 31 seconds.
    stroke           — scale and prominence of the one connected stroke.
    tail             — length and persistence of the connected tail segment.
    jewelryAfterglow — strength and decay time of sparse Vintage W+A memory.
    safetyFloor      — minimum palette-derived visibility during stillness.

  AUDIO_MODULATION_V1:
    sliderJewelryAfterglow <- micKick range 0.00..0.35 curve pow2 # kicks reveal a restrained golden memory after the rare crossing
    sliderTail             <- micFlux range 0.20..0.52 curve ease # spectral change lengthens the connected meteor trail
  Static (unmapped) params: localSpeed, direction, interval, stroke,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the selected cp1-to-cp2 line. Only Vintage rails emit
    native white, always with byte-identical W and A; UV remains zero. Silence
    is a complete, attractive, full-rig composition with no blackout.
*/

export var cp1H = 0.625, cp1S = 0.86, cp1V = 0.88;
export var cp2H = 0.085, cp2S = 0.56, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.32;
export var direction = 0.78;
export var interval = 0.50;
export var stroke = 0.36;
export var tail = 0.62;
export var jewelryAfterglow = 0.42;
export var safetyFloor = 0.30;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderInterval(v) { interval = v; }
export function sliderStroke(v) { stroke = v; }
export function sliderTail(v) { tail = v; }
export function sliderJewelryAfterglow(v) { jewelryAfterglow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var CLOCK_WRAP = 10000.0;

// Begin with one preview crossing so a short offline/operator review shows the
// hero event. The recurring clock is already seventeen seconds into its first
// wait; after that first scheduled crossing, every start is exactly 19..31
// engine-clock seconds apart.
var eventClock = 17.0;
var meteorAge = 0.0;
var meteorActive = 1.0;
var skyClock = 0.0;
// The boot preview begins with only a faint Jewelry memory; the full afterglow
// and Organ echo are armed by the scheduled crossing eight seconds later. This
// keeps the control perceptible without masking the traversal's direction.
var jewelryEnvelope = 0.22;
var organEnvelope = 0.0;

var liveDirection = 0.56;
var liveInterval = 0.50;
var liveStroke = 0.36;
var liveTail = 0.62;
var liveJewelry = 0.42;
var liveFloor = 0.30;
var meteorDuration = 2.30;
var meteorProgress = 0.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var smoothValue = clamp01(value);
  return smoothValue * smoothValue * (3.0 - 2.0 * smoothValue);
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

  // Geometry controls ease under live edits. Direction remains signed and
  // cannot freeze at center; crossing the center visibly reverses the stroke.
  var geometryFollow = min(1.0, dt * 4.0);
  var lightFollow = min(1.0, dt * 7.0);
  var directionTarget = clamp01(direction) * 2.0 - 1.0;
  if (directionTarget >= 0.0 && directionTarget < 0.06) {
    directionTarget = 0.06;
  } else if (directionTarget < 0.0 && directionTarget > -0.06) {
    directionTarget = -0.06;
  }
  // Direction is a categorical reversal. Applying its sign immediately keeps
  // a live change honest: the next rendered frame travels the chosen way.
  liveDirection = directionTarget;
  liveInterval += (clamp01(interval) - liveInterval) * geometryFollow;
  liveStroke += (clamp01(stroke) - liveStroke) * geometryFollow;
  liveTail += (clamp01(tail) - liveTail) * geometryFollow;
  liveJewelry += (clamp01(jewelryAfterglow) - liveJewelry) * lightFollow;
  liveFloor += (clamp01(safetyFloor) - liveFloor) * lightFollow;

  // Global 0.30 is the authored Ambient clock. This calibration keeps rare
  // events and their envelopes at the intended wall-clock cadence there.
  var calibratedDt = dt * 3.267;
  eventClock += calibratedDt;
  var intervalSeconds = 19.0 + liveInterval * 12.0;
  if (eventClock >= intervalSeconds) {
    eventClock -= intervalSeconds;
    meteorAge = 0.0;
    meteorActive = 1.0;
    jewelryEnvelope = 1.0;
    organEnvelope = 1.0;
  }

  // Tail adds genuine persistence as well as spatial extent. The event stays
  // rare, but now occupies enough real frames to be readable from the playa
  // and in a seekable review instead of flashing between sampled frames.
  var speedAmount = 1.0
                  - pow(1.0 - clamp01(localSpeed), 5.32);
  meteorDuration = 1.05 - speedAmount * 0.45
                  + liveTail * 2.35;
  if (meteorActive > 0.5) {
    meteorAge += calibratedDt;
    if (meteorAge >= meteorDuration) {
      meteorAge = meteorDuration;
      meteorActive = 0.0;
    }
  }
  meteorProgress = smooth01(meteorAge / meteorDuration);

  var jewelryDecaySeconds = 1.20 + liveJewelry * 8.80;
  jewelryEnvelope -= calibratedDt / jewelryDecaySeconds;
  if (jewelryEnvelope < 0.0) jewelryEnvelope = 0.0;
  organEnvelope -= calibratedDt / 1.30;
  if (organEnvelope < 0.0) organEnvelope = 0.0;

  var skyRate = 0.004 + speedAmount * speedAmount * 0.850;
  skyClock += calibratedDt * skyRate * SQRT2;
  if (skyClock >= CLOCK_WRAP) skyClock -= CLOCK_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  // Both signs receive identical local coordinates, preserving balance while
  // the tiny diagonal pass remains readable as deliberate Identity motion.
  var signX = 0.0;
  var signY = 0.0;
  if (isSign) {
    // A sign is physically split into 40- and 34-pixel fixtures. Fold the
    // complete authored surface so its lower half extends the first fixture.
    var signIndex = index % 74.0;
    signX = (signIndex % 10.0) / 9.0;
    signY = floor(signIndex / 10.0) / 7.0;
  }

  // A quiet, broad two-harmonic sky makes the long waiting period attractive
  // without introducing points that could be mistaken for secondary meteors.
  var skyDirection = 1.0;
  if (liveDirection < 0.0) skyDirection = -1.0;
  var skyA = wave(ux * 0.73 + uy * 0.31 + uz * 1.07
                + skyClock * skyDirection);
  var skyB = wave(ux * 1.11 - uy * 0.47 + uz * 0.59
                - skyClock * PHI * skyDirection);
  var skyField = 0.58 * skyA + 0.42 * skyB;
  var floorLevel = 0.045 + liveFloor * 0.180;
  var brightness = floorLevel + skyField * 0.075;
  var paletteMix = clamp01(0.08 + skyA * 0.28 + skyB * 0.13);
  var outW = 0.0;

  // Head path: (-0.10, 0.98, 0.04) to (1.10, 0.20, 0.96). The tail endpoint
  // stays on this same line. Distance to the finite segment produces exactly
  // one connected stroke with a brighter head and no allocated particles.
  var directionSign = 1.0;
  if (liveDirection < 0.0) directionSign = -1.0;
  var travel = meteorProgress;
  if (directionSign < 0.0) travel = 1.0 - travel;
  var headX = -0.10 + travel * 1.20;
  var headY = 0.98 - travel * 0.78;
  var headZ = 0.04 + travel * 0.92;
  var tailLength = 0.03 + liveTail * 1.35;
  var tailX = headX - directionSign * 1.20 * tailLength;
  var tailY = headY + directionSign * 0.78 * tailLength;
  var tailZ = headZ - directionSign * 0.92 * tailLength;
  var segmentX = headX - tailX;
  var segmentY = headY - tailY;
  var segmentZ = headZ - tailZ;
  var pointX = ux - tailX;
  var pointY = uy - tailY;
  var pointZ = uz - tailZ;
  var segmentLengthSquared = segmentX * segmentX
                           + segmentY * segmentY
                           + segmentZ * segmentZ;
  var segmentPosition = clamp01((pointX * segmentX + pointY * segmentY
                               + pointZ * segmentZ)
                              / segmentLengthSquared);
  var nearestX = tailX + segmentX * segmentPosition;
  var nearestY = tailY + segmentY * segmentPosition;
  var nearestZ = tailZ + segmentZ * segmentPosition;
  // The ship is far deeper than a flat screen. Compressing depth in the
  // distance metric lets one stroke read coherently from both broad sides
  // while it remains one finite 3D segment rather than duplicated particles.
  var depthDistance = (uz - nearestZ) * 0.34;
  var lineDistance = hypot3(ux - nearestX, uy - nearestY, depthDistance);
  var lineWidth = 0.008 + liveStroke * 0.260;
  var tailWidth = lineWidth * (0.52 + liveTail * 0.82);
  var segmentStroke = 1.0 - smoothstep(tailWidth,
                                       tailWidth * 2.35, lineDistance);
  // The head is the final portion of the same finite segment, so it can be
  // derived without a second 3D distance evaluation.
  var headCore = segmentStroke * smoothstep(0.78, 0.98, segmentPosition);
  var tailFade = 0.01 + segmentPosition
               * (0.10 + liveTail * 0.89);
  // A shallow longitudinal articulation keeps the tail visually connected
  // while making longer trails readable on low-pixel-count portable rigs.
  var tailArticulation = 0.56 + 0.44
                       * wave(segmentPosition * (0.55 + liveTail * 3.10));
  var meteor = meteorActive * max(headCore,
                                  segmentStroke * tailFade
                                  * tailArticulation);
  // A broad, low-energy projection of the same head keeps its shipwise travel
  // legible on sparse physical topology; the diagonal gate ties it to the
  // finite segment instead of creating a second sweep or particle field.
  var shipwiseHead = 1.0 - smoothstep(0.025, 0.095,
                                      abs(ux - travel));
  var diagonalGate = 1.0 - smoothstep(0.12, 0.30,
    abs(uy - (0.92 - ux * 0.64)));
  var meteorProjection = meteorActive * shipwiseHead
                       * (0.28 + diagonalGate * 0.72);
  meteor = max(meteor, meteorProjection * 0.86);

  // A broad 2D projection of that same finite segment makes the one stroke
  // continuous on the sparse ropes and bars. It is not a second meteor: the
  // longitudinal gate is bounded by this head and this analytic tail.
  var diagonalDistance = abs(uy - (0.92 - ux * 0.64));
  var projectedWidth = 0.020 + liveStroke * 0.105;
  var projectedDiagonal = 1.0 - smoothstep(projectedWidth,
                                            projectedWidth * 2.10,
                                            diagonalDistance);
  var behindHead = (travel - ux) * directionSign;
  var aheadHead = max(0.0, -behindHead);
  var behindTail = max(0.0, behindHead);
  var projectedTailLength = 0.10 + liveTail * 0.82;
  var projectedLongitudinal = (1.0 - smoothstep(0.025, 0.095, aheadHead))
                            * (1.0 - smoothstep(projectedTailLength * 0.72,
                                               projectedTailLength,
                                               behindTail));
  var projectedFade = 1.0 - behindTail / (projectedTailLength + 0.0001);
  var connectedProjection = meteorActive * projectedDiagonal
                          * projectedLongitudinal
                          * (0.38 + clamp01(projectedFade) * 0.62);
  meteor = max(meteor, connectedProjection);

  if (fixtureType == FIX_BAR_18) {
    brightness = floorLevel + skyField * 0.080 + meteor * 1.24;
    paletteMix = clamp01(0.06 + skyB * 0.18 + meteor * 0.76);
  } else if (fixtureType == FIX_RAW_LED) {
    // The far-field outline stays legible throughout the long stillness.
    var outlineDetail = wave(pixelLocalIndex * 0.061803
                           + skyClock * SQRT3 * skyDirection);
    brightness = floorLevel + 0.085 + outlineDetail * 0.060
               + meteor * 1.08;
    paletteMix = clamp01(0.08 + outlineDetail * 0.16 + meteor * 0.70);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Two heads per six-head rail remember the passage. The selection is fixed
    // and sparse, and the scalar envelope yields one continuous afterglow.
    var railHead = pixelLocalIndex % 6.0;
    var sparseHead = 0.0;
    if (railHead == 1.0 || railHead == 4.0) sparseHead = 1.0;
    // A very low persistent ember keeps the Afterglow handle measurable even
    // late in the long quiet chapter; the event envelope remains the hero.
    var afterglow = (0.10 + jewelryEnvelope * jewelryEnvelope) * sparseHead;
    brightness = floorLevel * 0.68 + 0.025 + skyField * 0.030
               + meteor * 0.62 + afterglow * liveJewelry * 0.28;
    paletteMix = clamp01(0.62 + skyB * 0.08 + meteor * 0.30);
    outW = clamp01(afterglow * liveJewelry * 0.82);
  } else if (fixtureType == FIX_PAR) {
    // One scalar impact echo expands and clears once per meteor entry.
    var impactShape = organEnvelope * organEnvelope;
    brightness = floorLevel + 0.075 + skyField * 0.045
               + impactShape * 0.62 + meteor * 0.42;
    paletteMix = clamp01(0.38 + impactShape * 0.38 + meteor * 0.18);
  } else if (isSign) {
    var signDiagonalDistance = abs(signY - (0.88 - signX * 0.76));
    var signDiagonal = 1.0 - smoothstep(0.045, 0.15,
                                        signDiagonalDistance);
    var signAxis = clamp01((signX + (1.0 - signY)) * 0.50);
    var signHeadDistance = abs(signAxis - travel);
    var signTrailDistance = signAxis - travel;
    if (directionSign > 0.0) signTrailDistance = -signTrailDistance;
    var signTail = 1.0 - smoothstep(0.0, 0.28 + liveTail * 0.24,
                                    max(0.0, signTrailDistance));
    var signPass = meteorActive * signDiagonal
                 * max(1.0 - smoothstep(0.025, 0.12, signHeadDistance),
                       signTail * 0.55);
    var signBed = wave(signX * SQRT2 + signY * PHI
                     + skyClock * 0.61 * skyDirection);
    brightness = max(0.25, floorLevel + 0.12 + signBed * 0.075
                   + signPass * 0.78);
    paletteMix = clamp01(0.18 + signBed * 0.22 + signPass * 0.55);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
