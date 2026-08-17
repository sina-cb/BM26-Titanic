// DRAFT — pending operator review
/*
  06_folded_flags.js — FOLDED FLAGS

  CONCEPT
    Four broad, flat signal panels hold a calm graphic pose, then fold into
    the next of four predetermined states through a brief, smooth crossfade.
    This is finite theatrical geometry rather than interference: each panel
    has a face, hinge, border, and crease, with no noise or wave lattice.

  INSTRUMENT STAGING
    FIX_BAR_18     — the broad Hull panels and their folded faces.
    FIX_RAW_LED    — the bright outer flag frame and narrow crease traces.
    FIX_VINTAGE_6  — sparse palette-derived RGB stitch points; no white.
    FIX_PAR        — four steady state corners with a restrained pose change.
    FIX_TE_SIGN    — an exact paired 10x8 miniature signal map. Both signs use
                     the same fixture-local coordinates and remain readable.

  MOTION / MATH
    A delta-accumulated clock advances through four fixed plane normals. Each
    state occupies a golden-ratio dwell (0.618 of its step); the remainder is
    a cubic crossfade to the next normal. The phase wraps at 10000 complete
    four-state cycles, so the wrap returns to the identical state and pose.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the four-state signal sequence.
    panelCount  — smoothly scales the number and width of broad panels.
    foldDepth   — difference between the two flat faces around each hinge.
    hinge       — horizontal location of the fold inside each panel.
    edgeGlow    — brightness of borders and hinge creases.
    contrast    — graphic separation between alternating palette faces.
    safetyFloor — minimum whole-rig visibility in every held pose.

  AUDIO_MODULATION_V1:
    sliderFoldDepth <- micMid  range 0.25..0.60 curve linear # mids deepen the panel folds
    sliderHinge     <- micFlux range 0.20..0.58 curve ease   # flux moves the hinge through each panel
  Static (unmapped) params: localSpeed, panelCount, edgeGlow, contrast,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    All output lies strictly on the cp1-to-cp2 RGB line. This pattern emits no
    native white and no UV, so W=A=U=0. Silence is a complete stable look.
*/

export var localSpeed = 0.30;
export var panelCount = 0.50;
export var foldDepth = 0.42;
export var hinge = 0.39;
export var edgeGlow = 0.48;
export var contrast = 0.68;
export var safetyFloor = 0.26;

export var cp1H = 0.57, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.095, cp2S = 0.86, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPanelCount(v) { panelCount = v; }
export function sliderFoldDepth(v) { foldDepth = v; }
export function sliderHinge(v) { hinge = v; }
export function sliderEdgeGlow(v) { edgeGlow = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_DWELL = 0.61803399;
var PHASE_WRAP = 40000.0;

var poseClock = 0.0;
var poseX = 0.82;
var poseY = 0.18;
var poseZ = 0.54;
var poseStateIndex = 0.0;
var poseNextIndex = 1.0;
var poseBlend = 0.0;

var livePanelCount = 0.50;
var liveFoldDepth = 0.42;
var liveHinge = 0.39;
var liveEdgeGlow = 0.48;
var liveContrast = 0.68;
var liveSafetyFloor = 0.26;
var liveVisibleCount = 4.0;
var liveHingePosition = 0.43;
var liveBorderWidth = 0.024;
var liveCreaseWidth = 0.030;
var liveFoldAmount = 0.49;
var liveGraphicContrast = 0.68;
var liveFloorLevel = 0.069;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}

function signalMark(state, u, v) {
  // Four literal maritime flag glyphs. They crossfade with the panel normal,
  // so a state change reads as a deliberate signal rather than generic fold
  // shading: diagonal pennant, cross, divided field, then central diamond.
  var stroke = 0.115;
  if (state == 0.0) {
    if (abs(v - u) < stroke) return 1.0;
    return 0.0;
  }
  if (state == 1.0) {
    if (abs(v - 0.50) < stroke || abs(u - 0.50) < stroke) return 1.0;
    return 0.0;
  }
  if (state == 2.0) {
    if (v > 0.50) return 1.0;
    return 0.0;
  }
  var diamondDistance = abs(u - 0.50) + abs(v - 0.50);
  if (abs(diamondDistance - 0.27) < 0.11) return 1.0;
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
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Live edits slew into the graphic instead of teleporting its geometry.
  var follow = min(1.0, dt * 5.0);
  livePanelCount += (panelCount - livePanelCount) * follow;
  liveFoldDepth += (foldDepth - liveFoldDepth) * follow;
  liveHinge += (hinge - liveHinge) * follow;
  liveEdgeGlow += (edgeGlow - liveEdgeGlow) * follow;
  liveContrast += (contrast - liveContrast) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;
  liveVisibleCount = 2.0 + floor(clamp01(livePanelCount) * 4.999);
  liveHingePosition = 0.18 + clamp01(liveHinge) * 0.64;
  liveBorderWidth = 0.012 + clamp01(liveEdgeGlow) * 0.024;
  liveCreaseWidth = 0.012 + clamp01(liveEdgeGlow) * 0.038;
  liveFoldAmount = 0.12 + clamp01(liveFoldDepth) * 0.88;
  liveGraphicContrast = 0.12 + clamp01(liveContrast) * 0.82;
  liveFloorLevel = 0.030 + clamp01(liveSafetyFloor) * 0.150;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  // At the saved ambient speed, a 40-second review now reveals three held
  // signals and two folds while every state still receives a long calm dwell.
  poseClock += dt * 0.092 * localMultiplier;
  if (poseClock >= PHASE_WRAP) poseClock -= PHASE_WRAP;

  var poseStep = floor(poseClock);
  var poseState = poseStep % 4.0;
  var nextState = (poseState + 1.0) % 4.0;
  var stepPhase = poseClock - poseStep;
  var blendPose = 0.0;
  if (stepPhase > GOLDEN_DWELL) {
    blendPose = smooth01((stepPhase - GOLDEN_DWELL)
                       / (1.0 - GOLDEN_DWELL));
  }
  poseStateIndex = poseState;
  poseNextIndex = nextState;
  poseBlend = blendPose;

  // Four predetermined plane normals: broad, unmistakably different poses.
  var ax = 0.82, ay = 0.18, az = 0.54;
  if (poseState == 1.0) { ax = 0.28; ay = 0.91; az = -0.31; }
  else if (poseState == 2.0) { ax = -0.64; ay = 0.33; az = 0.70; }
  else if (poseState == 3.0) { ax = 0.19; ay = -0.77; az = 0.61; }

  var bx = 0.82, by = 0.18, bz = 0.54;
  if (nextState == 1.0) { bx = 0.28; by = 0.91; bz = -0.31; }
  else if (nextState == 2.0) { bx = -0.64; by = 0.33; bz = 0.70; }
  else if (nextState == 3.0) { bx = 0.19; by = -0.77; bz = 0.61; }

  poseX = ax + (bx - ax) * blendPose;
  poseY = ay + (by - ay) * blendPose;
  poseZ = az + (bz - az) * blendPose;
  var normalLength = sqrt(poseX * poseX + poseY * poseY
                        + poseZ * poseZ) + 0.0001;
  poseX /= normalLength;
  poseY /= normalLength;
  poseZ /= normalLength;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // render3D coordinates are already normalized by the engine.
  var ux = x;
  var uy = y;
  var uz = z;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The paired fixtures are contiguous 74-pixel surfaces. index % 74 gives
    // both signs the exact same full-face semaphore rack across their reset.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50 + (uy - 0.50) * 0.16;
  }

  // A fixed two-column by three-row semaphore rack gives the signal literal
  // finite objects. panelCount reveals two through six whole rectangles; its
  // saved midpoint reveals exactly four, arranged as a balanced 2x2 block.
  // This is intentionally not a repeated plane or a ship-wide material field.
  var rackU = ux;
  var rackV = uy;
  var rawColumn = rackU * 2.0;
  var rawRow = rackV * 3.0;
  var column = min(1.0, floor(rawColumn));
  var row = min(2.0, floor(rawRow));
  var panelU = rawColumn - floor(rawColumn);
  var panelV = rawRow - floor(rawRow);
  var panelIndex = column + row * 2.0;
  var activeFlag = 0.0;
  if (panelIndex < liveVisibleCount) activeFlag = 1.0;

  // Wide dark gutters separate all four saved-pose flags. Each object owns a
  // complete rectangular border, a held maritime glyph, and one local hinge.
  var sideEdge = min(panelU, 1.0 - panelU);
  var endEdge = min(panelV, 1.0 - panelV);
  var edgeDistance = min(sideEdge, endEdge);
  var flagBody = 0.0;
  if (edgeDistance > 0.075) flagBody = activeFlag;
  var borderDistance = abs(edgeDistance - 0.095);
  var border = 0.0;
  if (borderDistance < liveBorderWidth) border = activeFlag;

  var hingeDistance = abs(panelU - liveHingePosition);
  var crease = 0.0;
  if (hingeDistance < liveCreaseWidth) crease = flagBody;

  var foldSide = -1.0;
  if (panelU >= liveHingePosition) foldSide = 1.0;
  var foldAmount = liveFoldAmount;
  var planeLight = 0.5 + foldSide * poseX * foldAmount * 0.34
                 + (panelV - 0.50) * poseY * foldAmount * 0.22;
  planeLight = clamp01(0.50 + (planeLight - 0.50) * foldAmount * 1.55);

  // All four saved flags are simultaneously different. The held pose advances
  // the rack as a finite semaphore alphabet rather than repainting every
  // surface with the same glyph.
  var displayState = poseStateIndex;
  // The glyph changes at the edge-on midpoint of the fold, when its face is
  // least visible, avoiding both a costly double glyph render and a flash.
  if (poseBlend >= 0.50) displayState = poseNextIndex;
  var currentFlagState = (displayState + panelIndex) % 4.0;
  var signalInk = signalMark(currentFlagState, panelU, panelV) * flagBody;

  var alternate = panelIndex % 2.0;
  var graphicContrast = liveGraphicContrast;
  var paletteMix = 0.50 + (alternate * 2.0 - 1.0)
                 * graphicContrast * 0.46;
  paletteMix += (signalInk - 0.50) * graphicContrast * 0.48;
  // Plane light remains close-up material detail, not the dominant grammar.
  paletteMix += (planeLight - 0.50) * foldAmount * 0.08;

  var floorLevel = liveFloorLevel;
  // Contrast changes both chroma separation and the literal luminance gap
  // between alternating faces. It therefore stays truthful even when the
  // global palette temporarily supplies two equal-luminance endpoints.
  var contrastShade = 1.0 - graphicContrast * 0.52
                    + alternate * graphicContrast * 0.52;
  var faceEnergy = flagBody * (0.30 + signalInk * 0.28
                   + planeLight * (0.15 + foldAmount * 0.15))
                 * contrastShade;
  var edgeEnergy = max(border, crease)
                 * (0.14 + clamp01(liveEdgeGlow) * 0.64);
  edgeEnergy += signalInk * (0.035 + liveEdgeGlow * 0.10);
  var brightness = floorLevel + (1.0 - floorLevel)
                 * clamp01(faceEnergy + edgeEnergy);

  if (fixtureType == FIX_RAW_LED) {
    // The Silhouette is the outer signal frame: bright borders and creases,
    // with a lit bed between them so the vessel outline never disappears.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01(flagBody * 0.10 + border * 0.78 + crease * 0.50
                        + signalInk * 0.26 + planeLight * flagBody * 0.05);
    paletteMix = clamp01(paletteMix + border * 0.10 - crease * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse palette-derived RGB stitch points. The analytic needle shape is
    // independent of the panel field and never emits native white.
    var stitchPhase = 0.5 + 0.5 * cos(pixelLocalIndex * 2.39996323
                                    + panelIndex * PHI
                                    + poseClock * 0.37);
    var stitch = pow(stitchPhase, 10.0);
    brightness = clamp01(floorLevel * 0.72 + flagBody * 0.05
                       + stitch * flagBody
                       * (0.40 + liveEdgeGlow * 0.44));
    paletteMix = clamp01(0.70 + alternate * 0.22);
  } else if (fixtureType == FIX_PAR) {
    // Point fixtures become the four state corners, indexed by world-space
    // quadrant and held steady through each golden-ratio dwell.
    var corner = 0.0;
    if (ux >= 0.50) corner += 1.0;
    if (uz >= 0.50) corner += 2.0;
    var activeState = floor(poseClock) % 4.0;
    var stateDistance = abs(corner - activeState);
    stateDistance = min(stateDistance, 4.0 - stateDistance);
    var cornerLift = 1.0 - clamp01(stateDistance);
    brightness = clamp01(floorLevel + 0.22 + cornerLift * 0.46
                       + crease * liveEdgeGlow * 0.12);
    paletteMix = clamp01(0.18 + corner * 0.21);
  } else if (isSign) {
    // Identity carries the exact paired miniature signal. A firm letterform
    // floor plus flat faces, border, and hinge make the signs read at distance.
    var bannerCenter = 0.50 + 0.42 * sin(poseClock * 0.73);
    var bannerSweep = 1.0 - smoothstep(0.11, 0.48,
                                      abs(ux - bannerCenter));
    var bannerField = wave(ux * 0.71 + uy * 0.37 - poseClock * 0.61)
                    * wave(uy * 0.59 - ux * 0.29
                          + poseClock * 1.41421356);
    brightness = clamp01(floorLevel + 0.08 + flagBody * 0.13
                       + faceEnergy * 0.36 + border * 0.42
                       + crease * 0.34 + signalInk * 0.28
                       + bannerSweep * (0.15 + bannerField * 0.22));
    paletteMix = clamp01(paletteMix + (uy - 0.50) * 0.10
                       + bannerField * 0.16 + bannerSweep * 0.08);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
