// DRAFT — pending operator review
/*
  26_drawbridge.js — DRAWBRIDGE

  CONCEPT
    Two immense luminous deck planes share a fixed centerline hinge and lift
    upward like a drawbridge, revealing a warm palette chamber beneath them.
    The image is a true three-dimensional hinge, not a pair of sliding gates.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad finite deck faces and the below-deck reveal.
    FIX_RAW_LED    — the stationary hinge and moving outer deck outlines.
    FIX_VINTAGE_6  — palette-RGB hinge pins, with no native-white override.
    FIX_PAR        — paired counterweight lanterns moving against the decks.
    FIX_TE_SIGN    — identical miniature section diagrams on both TE signs.

  MOTION / MATH
    Each half is inverse-rotated in the X/Y plane around the fixed world-space
    axis x=0.5, y=0.46. Finite rectangle distances define each deck face, so
    the outer edges rise while the hinge remains stationary. The authored
    Bridge Angle spans 70 degrees; a slow twenty-degree living sweep makes the
    rigid-body lift readable from camp distance without hiding that geometry.
    A second irrational phase drifts the chamber grain.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — cadence of the gentle lift and under-deck motion.
    bridgeAngle   — opening angle across a measured seventy-degree range.
    deckWidth     — transverse reach and visible thickness of both planes.
    hingeGlow     — prominence of the fixed hinge axis and Jewelry pins.
    counterweight — strength and travel of the opposing Organ weights.
    level         — expressive light carried by the moving structure.
    safetyFloor   — protected whole-rig palette visibility underneath it.

  AUDIO_MODULATION_V1:
    sliderBridgeAngle  <- micFlux range 0.20..0.62 curve ease   # flux lifts the paired deck planes
    sliderCounterweight <- micLow range 0.18..0.48 curve linear # lows load the opposing counterweights
  Static (unmapped) params: localSpeed, deckWidth, hingeGlow, level,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. Jewelry pins are palette RGB,
    not native white. W=A=0 and UV=0 on every fixture. The safety floor keeps
    the complete ship readable in silence and at the darkest hinge pose.
*/

export var cp1H = 0.575, cp1S = 0.78, cp1V = 0.88;
export var cp2H = 0.085, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var bridgeAngle = 0.44;
export var deckWidth = 0.56;
export var hingeGlow = 0.42;
export var counterweight = 0.30;
export var level = 0.72;
export var safetyFloor = 0.30;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderBridgeAngle(value) { bridgeAngle = value; }
export function sliderDeckWidth(value) { deckWidth = value; }
export function sliderHingeGlow(value) { hingeGlow = value; }
export function sliderCounterweight(value) { counterweight = value; }
export function sliderLevel(value) { level = value; }
export function sliderSafetyFloor(value) { safetyFloor = value; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;
var HINGE_Y = 0.46;

var liftPhase = 0.13;
var grainPhase = 0.37;
var liveBridgeAngle = 0.44;
var liveDeckWidth = 0.56;
var liveHingeGlow = 0.42;
var liveCounterweight = 0.30;
var liveLevel = 0.72;
var liveSafetyFloor = 0.30;
var angleRadians = 0.0;
var angleSin = 0.0;
var angleCos = 1.0;
var liftEnvelope = 0.0;

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
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Geometry and brightness controls are slewed independently so live edits
  // remain fluid while an audio modulation can still articulate the hinge.
  var geometryFollow = min(1.0, dt * 5.2);
  var lightFollow = min(1.0, dt * 8.0);
  liveBridgeAngle += (clamp01(bridgeAngle) - liveBridgeAngle) * geometryFollow;
  liveDeckWidth += (clamp01(deckWidth) - liveDeckWidth) * geometryFollow;
  liveHingeGlow += (clamp01(hingeGlow) - liveHingeGlow) * lightFollow;
  liveCounterweight += (clamp01(counterweight) - liveCounterweight) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var liftRate = 0.018 + localMultiplier * 0.060;
  liftPhase += dt * liftRate;
  grainPhase += dt * liftRate * SQRT2;
  if (liftPhase >= PHASE_WRAP) liftPhase -= PHASE_WRAP;
  if (grainPhase >= PHASE_WRAP) grainPhase -= PHASE_WRAP;

  // The authored angle contributes 4..74 degrees: a truthful seventy-degree
  // span. Autonomous motion adds a calm twenty-degree sweep so the deck edges
  // visibly rise and fall at the playlist's saved ambient speed.
  liftEnvelope = 0.5 + 0.5 * sin(liftPhase * PI2);
  var authoredDegrees = 4.0 + liveBridgeAngle * 70.0;
  var livingDegrees = (liftEnvelope - 0.5) * 20.0;
  var displayedDegrees = max(2.0, authoredDegrees + livingDegrees);
  angleRadians = displayedDegrees * PI / 180.0;
  angleSin = sin(angleRadians);
  angleCos = cos(angleRadians);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var modelX = clamp01(x);
  var modelY = clamp01(y);
  var modelZ = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  // Each sign is patched as 40 + 34 pixels. Fold the global index into one
  // complete row-major 10x8/74-pixel section so the lower fixture continues
  // the bridge drawing and both complete signs remain byte-identical.
  if (isSign) {
    var signIndex = index % 74.0;
    modelX = (signIndex % 10.0) / 9.0;
    modelY = floor(signIndex / 10.0) / 7.0;
    modelZ = 0.50;
  }

  var centeredX = modelX - 0.50;
  var outwardDistance = abs(centeredX);
  var verticalDistance = modelY - HINGE_Y;

  // Inverse rotation around the fixed centerline hinge. localAcross measures
  // along either deck and localNormal measures signed distance through it.
  // At localAcross=0 both transforms meet exactly at x=.5,y=HINGE_Y for every
  // angle, so the hinge cannot wander as the bridge opens.
  var localAcross = outwardDistance * angleCos + verticalDistance * angleSin;
  var localNormal = verticalDistance * angleCos - outwardDistance * angleSin;
  // A large vertical lift plane travels with the bridge ceremony. It gives
  // the sparse real topology a clear top-to-bottom read while the two
  // incommensurate grain axes preserve detailed material behind that plane.
  var liftCenterY = 0.18 + 0.64 * wave(liftPhase * 0.37);
  var liftPlane = 1.0 - smoothstep(0.10, 0.44,
                                  abs(modelY - liftCenterY));
  var liftField = wave(modelX * 0.61 + modelZ * 0.37
                      + grainPhase * 0.31)
                * wave(modelY * 0.53 - modelX * 0.27
                      - grainPhase * 0.23);

  var deckReach = 0.31 + liveDeckWidth * 0.27;
  var deckThickness = 0.018 + liveDeckWidth * 0.047;
  var acrossInside = smoothstep(-0.025, 0.025, localAcross)
                   * (1.0 - smoothstep(deckReach - 0.035,
                                      deckReach + 0.035, localAcross));
  var lengthInside = smoothstep(0.025, 0.090, modelZ)
                   * (1.0 - smoothstep(0.910, 0.975, modelZ));
  var faceDistance = abs(localNormal);
  var deckFace = (1.0 - smoothstep(deckThickness,
                                   deckThickness * 2.7, faceDistance))
               * acrossInside * lengthInside;

  // A broader diagrammatic rail follows the same rigid-body transform as the
  // deck face. It is intentionally wide enough for the sparse Silhouette and
  // sign grids, making the changing angle legible without turning the motion
  // into a lateral wipe.
  var risingRail = (1.0 - smoothstep(deckThickness * 1.4,
                                    deckThickness * 6.8, faceDistance))
                 * acrossInside;

  // Crisp finite rectangle borders keep the planes legible at a distance.
  var outerEdge = (1.0 - smoothstep(0.018, 0.064,
                                   abs(localAcross - deckReach)))
                * (1.0 - smoothstep(deckThickness * 1.2,
                                    deckThickness * 4.2, faceDistance))
                * lengthInside;
  var endEdgeDistance = min(abs(modelZ - 0.075), abs(modelZ - 0.925));
  var endEdge = (1.0 - smoothstep(0.012, 0.052, endEdgeDistance))
              * (1.0 - smoothstep(deckThickness * 1.2,
                                  deckThickness * 4.2, faceDistance))
              * acrossInside;

  // This axis is intentionally world-space, never transformed: a control or
  // phase change cannot shift the hinge center by even one coordinate unit.
  var hingeRadius = 0.018 + liveHingeGlow * 0.055;
  var hingeDistanceSquared = centeredX * centeredX
                           + verticalDistance * verticalDistance;
  var hingeOuterRadius = hingeRadius + 0.055;
  var hingeLine = 1.0 - smoothstep(hingeRadius * hingeRadius,
                                  hingeOuterRadius * hingeOuterRadius,
                                  hingeDistanceSquared);
  var hingeDetail = 0.72 + 0.28
                  * wave(modelZ * (5.0 + liveDeckWidth * 5.0)
                       + grainPhase * 0.31);
  hingeLine *= hingeDetail;

  // Warm palette light is revealed below and between the lifted planes. It
  // remains a finite chamber rather than flooding the entire bounding box.
  // Only Hull Canvas and Identity render the below-deck chamber. Avoid its
  // two-frequency material field on the other 456 fixtures, where it would
  // be calculated and then discarded by their authored role overrides.
  var chamber = 0.0;
  if (fixtureType == FIX_BAR_18 || isSign) {
    var chamberWidth = 0.09 + angleSin * 0.31;
    var chamberAcross = 1.0 - smoothstep(chamberWidth,
                                        chamberWidth + 0.16,
                                        outwardDistance);
    var chamberBelow = 1.0 - smoothstep(HINGE_Y - 0.015,
                                       HINGE_Y + 0.17, modelY);
    var chamberLength = smoothstep(0.04, 0.16, modelZ)
                      * (1.0 - smoothstep(0.84, 0.96, modelZ));
    var chamberGrain = 0.58 + 0.24
                     * sin((modelZ * SQRT3 + modelX * PHI
                           + grainPhase * 0.19) * PI2)
                     + 0.18
                     * sin((modelZ * 3.0 - modelY * SQRT2
                           - grainPhase * 0.31) * PI2);
    chamber = chamberAcross * chamberBelow * chamberLength
            * clamp01(chamberGrain) * (0.35 + angleSin * 0.65);
  }

  var floorLevel = 0.055 + liveSafetyFloor * 0.205;
  var structure = deckFace * 0.68 + outerEdge * 0.58 + endEdge * 0.46;
  var brightness = floorLevel + liveLevel
                 * (structure + hingeLine * (0.12 + liveHingeGlow * 0.56)
                  + chamber * 0.72);
  var paletteMix = clamp01(0.10 + deckFace * 0.30
                         + outerEdge * 0.18 + chamber * 0.62
                         + modelZ * 0.08);

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette carries the stationary center axis plus the two rising deck
    // rims. The safety component ensures the ship outline never disappears.
    brightness = floorLevel * 1.22 + 0.075
               + liveLevel * (risingRail * 0.78
                 + outerEdge * 0.72 + endEdge * 0.36
                 + hingeLine * (0.24 + liveHingeGlow * 0.64)
                 + deckFace * 0.18);
    paletteMix = clamp01(0.04 + risingRail * 0.56
                       + outerEdge * 0.28 + hingeLine * 0.30
                       + modelZ * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Six finite palette-RGB pins per rail. Their positions remain locked to
    // the hinge while their specular sweep follows the lifting ceremony.
    var pinDistance = abs((pixelLocalIndex % 6.0) - 2.5);
    var pinBody = 1.0 - smoothstep(0.45, 1.35, pinDistance);
    var pinSweep = pow(0.5 + 0.5
                     * cos(pixelLocalIndex * GOLDEN_ANGLE
                         + grainPhase * PI2), 8.0);
    brightness = floorLevel * 0.86 + 0.085
               + liveLevel * liveHingeGlow
               * (pinBody * 0.58 + pinSweep * 0.34);
    paletteMix = clamp01(0.58 + pinBody * 0.30 + pinSweep * 0.10);
  } else if (fixtureType == FIX_PAR) {
    // Counterweights travel down as the bridge rises. Alternating local heads
    // make two large, balanced lantern groups rather than a noisy PAR chase.
    var organSide = fixtureId % 2.0;
    var weightCenter = 0.73 - angleSin * (0.25 + liveCounterweight * 0.23);
    var weightDistance = abs(modelY - weightCenter);
    var weightBody = 1.0 - smoothstep(0.055, 0.22, weightDistance);
    var weightPulse = 0.72 + 0.28
                    * wave(grainPhase * 0.43 + organSide * 0.5);
    brightness = floorLevel * 1.18 + 0.09
               + liveLevel * (weightBody * (0.20 + liveCounterweight * 0.70)
                 * weightPulse + hingeLine * liveHingeGlow * 0.28);
    paletteMix = clamp01(0.45 + weightBody * 0.45
                       + organSide * 0.07);
  } else if (isSign) {
    // Paired section diagrams: fixed hinge, two rising rails, and a warm
    // triangular chamber. The same local index math keeps both TE signs exact.
    var signPlane = deckFace;
    var signRim = max(outerEdge, endEdge);
    var signDiagram = max(hingeLine, max(risingRail,
                                        max(signPlane, signRim)));
    brightness = max(0.23, floorLevel * 1.30 + 0.075
                   + liveLevel * (signDiagram * 0.70 + chamber * 0.46)
                   + liftPlane * (0.16 + liftField * 0.24));
    paletteMix = clamp01(0.10 + signPlane * 0.34
                       + signRim * 0.24 + chamber * 0.58
                       + liftField * 0.16 + liftPlane * 0.10);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference three-dimensional section above.
    brightness = max(floorLevel, brightness);
  }

  // A luminous hinge also throws a restrained stationary aura across the
  // complete construction. This makes Hinge Glow a perceptible brightness
  // control even on sparse models whose pixels do not sit directly on the
  // mathematical axis; the spatial peak remains fixed at the axis itself.
  brightness += liveLevel * liveHingeGlow
              * (0.18 + hingeLine * 0.34);
  if (!isSign) {
    brightness += liftPlane * (0.045 + liftField * 0.075);
    paletteMix += liftField * 0.07;
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outputR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outputG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outputB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outputR), clamp01(outputG), clamp01(outputB), 0.0, 0.0, 0.0);
}
