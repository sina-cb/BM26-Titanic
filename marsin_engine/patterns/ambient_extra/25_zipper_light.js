// DRAFT — pending operator review
/*
  25_zipper_light.js — ZIPPER LIGHT

  CONCEPT
    Two illuminated fabric edges approach the ship's center seam. A single
    zipper head joins alternating finite teeth one by one, holds the closure,
    then releases them in reverse. This is discrete topology, not a traveling
    wave or an interference field.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad palette fabric, paired seam edges, finite teeth.
    FIX_RAW_LED    — two bright zipper tapes tracing the Silhouette.
    FIX_VINTAGE_6  — warm matched W=A tooth sparks on the Jewelry rails.
    FIX_PAR        — the concentrated zipper-head halo in the Organs.
    FIX_TE_SIGN    — identical paired miniature closure bars on both signs.

  MOTION / MATH
    A delta-accumulated phase drives a finite close / hold / reopen envelope.
    A monotonic head coordinate crosses a signed longitudinal axis. An
    analytic seam SDF moves each edge inward only after its individual tooth
    is passed; parity alternates the finite teeth between the two sides.
    Direction continuously reverses the longitudinal axis and never freezes.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the complete close / hold / reopen ceremony.
    direction   — which longitudinal end the zipper head approaches first.
    seamWidth   — distance between the two open zipper tapes.
    toothCount  — number and compactness of the discrete joining teeth.
    closure     — manual bias of the zipper head toward open or closed.
    spark       — Jewelry white glint and zipper-head highlight strength.
    safetyFloor — protected whole-rig palette light beneath the mechanism.

  AUDIO_MODULATION_V1:
    sliderClosure <- micFlux range 0.20..0.75 curve ease # flux advances the closure head
    sliderSpark   <- micHigh range 0.03..0.28 curve pow2 # highs polish the joined teeth
  Static (unmapped) params: localSpeed, direction, seamWidth, toothCount,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB is strictly interpolated on the cp1-to-cp2 line. Only Jewelry emits
    native warm white, with byte-identical W=A; all UV is zero. Silence is a
    complete, animated look with a whole-rig visibility floor.
*/

export var cp1H = 0.58, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.095, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var direction = 0.72;
export var seamWidth = 0.46;
export var toothCount = 0.50;
export var closure = 0.50;
export var spark = 0.20;
export var safetyFloor = 0.34;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) {
  direction = value;
  signedDirection = value * 2.0 - 1.0;
  if (signedDirection >= 0.0 && signedDirection < 0.06) signedDirection = 0.06;
  else if (signedDirection < 0.0 && signedDirection > -0.06) signedDirection = -0.06;
}
export function sliderSeamWidth(value) { seamWidth = value; }
export function sliderToothCount(value) { toothCount = value; }
export function sliderClosure(value) { closure = value; }
export function sliderSpark(value) { spark = value; }
export function sliderSafetyFloor(value) { safetyFloor = value; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

// Begin inside the rising close stroke rather than at its zero-slope endpoint.
// That makes a newly loaded cue immediately communicate its chosen direction.
var ceremonyPhase = 0.16;
var fabricPhase = 0.173;
var signedDirection = 0.44;
var liveDirection = 0.44;
var liveSeamWidth = 0.46;
var liveToothCount = 0.50;
var liveClosure = 0.50;
var liveSpark = 0.20;
var liveSafetyFloor = 0.34;
var headCoordinate = 0.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(inputValue) {
  if (inputValue < 0.0) return 0.0;
  if (inputValue > 1.0) return 1.0;
  return inputValue;
}

function smooth01(inputValue) {
  var boundedValue = clamp01(inputValue);
  return boundedValue * boundedValue * (3.0 - 2.0 * boundedValue);
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
  var frameSeconds = delta / 1000.0;
  if (frameSeconds < 0.0) frameSeconds = 0.0;
  if (frameSeconds > 0.1) frameSeconds = 0.1;

  var geometryFollow = min(1.0, frameSeconds * 5.0);
  var lightFollow = min(1.0, frameSeconds * 9.0);
  // Direction is a selector for the physical end of travel. Apply it directly
  // so a live reversal actually swaps the approaching end instead of spending
  // several frames in a spatially compressed near-zero axis.
  liveDirection = signedDirection;
  liveSeamWidth += (clamp01(seamWidth) - liveSeamWidth) * geometryFollow;
  liveToothCount += (clamp01(toothCount) - liveToothCount) * geometryFollow;
  liveClosure += (clamp01(closure) - liveClosure) * lightFollow;
  liveSpark += (clamp01(spark) - liveSpark) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var ceremonyRate = 0.020 + localMultiplier * 0.055;
  ceremonyPhase += frameSeconds * ceremonyRate;
  fabricPhase += frameSeconds * ceremonyRate * SQRT2;
  if (ceremonyPhase >= PHASE_WRAP) ceremonyPhase -= PHASE_WRAP;
  if (fabricPhase >= PHASE_WRAP) fabricPhase -= PHASE_WRAP;

  var cyclePosition = ceremonyPhase - floor(ceremonyPhase);
  var automaticClosure = 0.0;
  if (cyclePosition < 0.36) {
    automaticClosure = smooth01(cyclePosition / 0.36);
  } else if (cyclePosition < 0.62) {
    automaticClosure = 1.0;
  } else {
    automaticClosure = 1.0 - smooth01((cyclePosition - 0.62) / 0.38);
  }
  // Closure is a truthful manual bias around the complete autonomous cycle:
  // its center preserves full travel; endpoints decisively favor either pose.
  headCoordinate = clamp01(automaticClosure + (liveClosure - 0.50) * 1.10);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var coordX = clamp01(x);
  var coordY = clamp01(y);
  var coordZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;

  // Each sign is patched as 40 + 34 pixels. Global-index folding continues
  // one full row-major 10x8/74-pixel zipper across both physical fixtures,
  // while the modulo makes the two complete signs byte-identical.
  if (isIdentity) {
    var signIndex = index % 74.0;
    coordX = (signIndex % 10.0) / 9.0;
    coordY = floor(signIndex / 10.0) / 7.0;
    coordZ = coordY;
  }

  // Signed axis projection reverses smoothly when Direction crosses center.
  // At the protected +/-0.06 center value it still travels and never freezes.
  var longitudinal = clamp01(0.50 + (coordZ - 0.50) * liveDirection);
  var teeth = 5.0 + floor(liveToothCount * 8.999);
  var toothCoordinate = longitudinal * teeth;
  var toothIndex = floor(toothCoordinate);
  var toothLocal = toothCoordinate - toothIndex;
  var toothCenter = (toothIndex + 0.50) / teeth;
  var parity = toothIndex % 2.0;

  // Each tooth closes only after the monotonic head passes its own center.
  // The narrow smooth region avoids temporal aliasing without turning the
  // discrete topology into a generic gradient.
  var headSoftness = 0.16 / teeth;
  var joined = smoothstep(toothCenter - headSoftness,
                          toothCenter + headSoftness, headCoordinate);

  var openHalfGap = 0.035 + liveSeamWidth * 0.205;
  var currentHalfGap = openHalfGap * (1.0 - joined);
  var seamDistance = abs(coordX - 0.50);
  var tapeDistance = abs(seamDistance - currentHalfGap);
  var tape = 1.0 - smoothstep(0.012, 0.044, tapeDistance);

  // Alternating finite teeth reach from only one side of the tape on each
  // longitudinal cell. A rounded tooth cap keeps it graphic on sparse pixels.
  var toothEnvelope = 1.0 - smoothstep(0.22, 0.47, abs(toothLocal - 0.50));
  var sidePolarity = -1.0;
  if (parity > 0.5) sidePolarity = 1.0;
  var toothTarget = 0.50 + sidePolarity
                  * (currentHalfGap * 0.52 + 0.018);
  var toothDistance = abs(coordX - toothTarget);
  var toothWidth = 0.026 + liveSeamWidth * 0.018;
  var toothShape = toothEnvelope
                 * (1.0 - smoothstep(toothWidth,
                                     toothWidth * 2.8, toothDistance));
  toothShape *= 0.38 + joined * 0.62;
  // Bright registration notches run along both tapes before closure. They
  // make the discrete tooth count readable even on sparse Titanic strands,
  // while the side-specific toothShape below still owns the actual joining.
  var tapeNotches = toothEnvelope * tape;
  var registrationRhythm = pow(wave(longitudinal * teeth), 8.0);
  var registrationBand = registrationRhythm
                       * (1.0 - smoothstep(0.16, 0.40, seamDistance));

  var headDistance = abs(longitudinal - headCoordinate);
  // The broad outer halo makes the head's net travel readable across the
  // sparse real topology; the compact body below remains the sharp focal point.
  var headHalo = 1.0 - smoothstep(0.018, 0.175, headDistance);
  var headBody = headHalo
               * (1.0 - smoothstep(0.020 + liveSeamWidth * 0.020,
                                   0.100 + liveSeamWidth * 0.045,
                                   seamDistance));

  // A low-contrast folded textile stays subordinate to the finite mechanism.
  var fabricFold = 0.5 + 0.5 * sin((coordX * 1.7 + coordY * SQRT2
                                  + coordZ * PHI + fabricPhase) * PI2);
  var crossFold = 0.5 + 0.5 * sin((coordX * PHI - coordY * 0.73
                                 + coordZ * SQRT2 - fabricPhase * 0.61803399)
                                * PI2);
  var floorLevel = 0.060 + liveSafetyFloor * 0.180;
  var brightness = floorLevel + (1.0 - floorLevel)
                 * (0.10 + fabricFold * 0.07 + crossFold * 0.04
                  + tape * 0.56 + tapeNotches * 0.30
                  + registrationBand * 0.24
                  + toothShape * 0.72 + headBody * 0.84
                  + headHalo * 0.20);
  // The fabric stays blue through the ceremony. Gold belongs to the finite
  // mechanism—tapes, persistent joined teeth, and the moving head—so closure
  // cannot collapse into a whole-ship palette wipe.
  var paletteMix = clamp01(0.07 + (fabricFold - 0.50) * 0.08
                         + tape * 0.14 + tapeNotches * 0.22
                         + registrationBand * 0.18
                         + toothShape * 0.66
                         + headBody * 0.78 + joined * 0.05
                         + parity * toothShape * 0.08);
  var whiteLevel = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the pair of continuous zipper tapes, clearly legible at
    // distance even between tooth events.
    brightness = floorLevel + (1.0 - floorLevel)
               * (0.12 + tape * 0.70 + tapeNotches * 0.38
                + registrationRhythm * 0.22
                + toothShape * 0.82
                + headHalo * 0.58);
    paletteMix = clamp01(0.06 + tape * 0.14 + tapeNotches * 0.28
                       + registrationRhythm * 0.16
                       + toothShape * 0.70
                       + headHalo * 0.76 + parity * toothShape * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Each six-head rail is a finite tooth row. Warm native-white polish is
    // sparse, bounded by Spark, and strictly W=A.
    var jewelryPosition = (pixelLocalIndex + 0.50) / 6.0;
    var jewelryParity = floor(jewelryPosition * teeth) % 2.0;
    var jewelryPulse = pow(0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                        + fabricPhase * PI2), 8.0);
    var jewelryJoin = smoothstep(jewelryPosition - 0.035,
                                 jewelryPosition + 0.035, headCoordinate);
    brightness = floorLevel * 0.82 + 0.12
               + jewelryJoin * 0.30 + jewelryPulse * liveSpark * 0.44;
    paletteMix = clamp01(0.20 + jewelryJoin * 0.64
                       + jewelryParity * 0.08);
    whiteLevel = clamp01(liveSpark * jewelryJoin
                       * (0.08 + jewelryPulse * 0.62));
  } else if (fixtureType == FIX_PAR) {
    // Organs are the single large zipper head, with a restrained afterglow.
    brightness = floorLevel + (1.0 - floorLevel)
               * (0.18 + headHalo * (0.46 + liveSpark * 0.35)
                + joined * 0.14 + fabricFold * 0.07);
    paletteMix = clamp01(0.22 + headHalo * 0.64 + joined * 0.10);
  } else if (isIdentity) {
    // Paired closure bars travel vertically through the two identical signs.
    // A firm floor keeps the TE letterforms readable throughout the ceremony.
    var signBar = 1.0 - smoothstep(0.025, 0.110,
                                 abs(coordY - headCoordinate));
    var signSeam = 1.0 - smoothstep(0.035, 0.120,
                                  abs(coordX - 0.50));
    var signTeeth = toothEnvelope
                  * (1.0 - smoothstep(0.055, 0.175,
                                     abs(coordX - toothTarget)));
    brightness = max(0.24, floorLevel + 0.10 + signBar * 0.24
                   + signSeam * (0.10 + joined * 0.18)
                   + signTeeth * 0.16);
    paletteMix = clamp01(0.14 + joined * 0.68
                       + signBar * 0.12 - signTeeth * 0.08);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference fabric and seam composition above.
    brightness = max(floorLevel, brightness);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outputR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outputG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outputB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outputR), clamp01(outputG), clamp01(outputB),
         whiteLevel, whiteLevel, 0.0);
}
