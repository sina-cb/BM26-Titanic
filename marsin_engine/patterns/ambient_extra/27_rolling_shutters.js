// DRAFT — pending operator review
/*
  27_rolling_shutters.js — ROLLING SHUTTERS

  CONCEPT
    Three to eight broad mechanical shutters open one after another across the
    ship, hold, close in reverse order, then hold again. Each panel is a finite
    object with its own face, aperture, casing, and illuminated moving edge.

  INSTRUMENT STAGING
    FIX_BAR_18     — the primary shutter bank: flat faces and opening chambers.
    FIX_RAW_LED    — bright structural casing around the moving panels.
    FIX_VINTAGE_6  — sparse palette-RGB catches on panel edges; no white.
    FIX_PAR        — mechanical stops that settle at fully open/closed states.
    FIX_TE_SIGN    — an exact paired miniature shutter sequence on both signs.

  MOTION / MATH
    A delta-accumulated cycle has four explicit stages: closed hold, ordered
    opening cascade, open hold, and reverse-order closing cascade. Panel order
    comes from a finite longitudinal index, and each panel receives a delayed cubic
    smoothstep. Adjacent panel progress therefore stays monotonic throughout
    every cascade. Direction reverses the ordering without freezing at center.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — cadence of the complete open/hold/close/hold ceremony.
    direction    — which side receives the first opening shutter.
    shutterCount — three to eight broad finite panels.
    opening      — maximum aperture revealed by each fully open shutter.
    feather      — softness of the moving aperture and panel casing.
    edgeGlow     — energy carried by moving edges and structural casing.
    safetyFloor  — dependable whole-rig visibility beneath every held state.

  AUDIO_MODULATION_V1:
    sliderOpening  <- micFlux range 0.24..0.62 curve ease   # flux opens the shutter chambers
    sliderEdgeGlow <- micHigh range 0.04..0.26 curve linear # highs polish the moving edges
  Static (unmapped) params: localSpeed, direction, shutterCount, feather,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every emitted RGB value lies strictly on the cp1-to-cp2 line. This pattern
    emits no native white and no UV, so W=A=U=0 exactly. Silence remains a
    complete, calmly moving look with no blackout stage.
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var shutterCount = 0.48;
export var opening = 0.46;
export var feather = 0.34;
export var edgeGlow = 0.20;
export var safetyFloor = 0.32;

export var cp1H = 0.60, cp1S = 0.86, cp1V = 0.90;
export var cp2H = 0.105, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  heading = v * 2.0 - 1.0;
  if (heading >= 0.0 && heading < 0.06) heading = 0.06;
  else if (heading < 0.0 && heading > -0.06) heading = -0.06;
}
export function sliderShutterCount(v) { shutterCount = v; }
export function sliderOpening(v) { opening = v; }
export function sliderFeather(v) { feather = v; }
export function sliderEdgeGlow(v) { edgeGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.39996323;

// Begin inside the first cascade so short offline/operator previews encounter
// real aperture geometry immediately; the full cycle still includes both
// deliberately held states.
var cycleClock = 0.24;
var bearingClock = 0.17;
var heading = 0.50;
var liveShutterCount = 0.48;
var liveOpening = 0.46;
var liveFeather = 0.34;
var liveEdgeGlow = 0.20;
var liveSafetyFloor = 0.32;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
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

  // Geometry and intensity controls slew continuously so live audio and hand
  // edits reshape the shutters without flashing or reseeding their topology.
  var geometryFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 8.0);
  liveShutterCount += (clamp01(shutterCount) - liveShutterCount)
                    * geometryFollow;
  liveOpening += (clamp01(opening) - liveOpening) * geometryFollow;
  liveFeather += (clamp01(feather) - liveFeather) * geometryFollow;
  liveEdgeGlow += (clamp01(edgeGlow) - liveEdgeGlow) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  cycleClock += dt * 0.055 * speedMultiplier;
  bearingClock += dt * (0.10 + speedMultiplier * 0.72);
  if (cycleClock >= PHASE_WRAP) cycleClock -= PHASE_WRAP;
  if (bearingClock >= PHASE_WRAP) bearingClock -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign is patched as 40 + 34 pixels. Fold one complete row-major
    // 10x8/74-pixel shutter bank so pixels 40..73 continue the drawing and
    // the two complete signs remain byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // Titanic's continuously sampled longitudinal axis is Z. Using it for the
  // ship bank avoids the broad X dead zone that collapsed the old version
  // into a whole-rig state change. Identity uses its authored local X axis.
  var panelAxis = uz;
  if (isSign) panelAxis = ux;
  var count = floor(3.0 + clamp01(liveShutterCount) * 5.999);
  var rawPanel = min(0.999999, panelAxis) * count;
  var panelIndex = floor(rawPanel);
  var panelU = rawPanel - panelIndex;
  var order = panelIndex / max(1.0, count - 1.0);
  if (heading < 0.0) order = 1.0 - order;

  // Four explicit stages with genuine holds. A panel consumes 32% of each
  // cascade while starts are spread across 68%, so several neighboring
  // apertures remain visibly different instead of dissolving into one fade.
  var cycle = cycleClock - floor(cycleClock);
  var openCascade = clamp01((cycle - 0.12) / 0.30);
  var closeCascade = clamp01((cycle - 0.60) / 0.30);
  var openingProgress = smooth01((openCascade - order * 0.68) / 0.32);
  var closingProgress = smooth01((closeCascade
                                - (1.0 - order) * 0.68) / 0.32);
  var panelOpen = openingProgress * (1.0 - closingProgress);

  // Each object is a rolling shutter: a dark slatted face retracts upward and
  // reveals a bounded warm chamber below one moving bottom edge. Casing stays
  // present in every state, so open panels never merge into a global wash.
  var apertureHeight = panelOpen * (0.24 + liveOpening * 0.68);
  var apertureFeather = 0.006 + liveFeather * 0.140;
  var aperture = 1.0 - smoothstep(apertureHeight,
                                 apertureHeight + apertureFeather, uy);
  aperture *= smooth01(panelOpen * 4.0);
  var sideDistance = min(panelU, 1.0 - panelU);
  var casingWidth = 0.010 + liveFeather * 0.075;
  var casing = 1.0 - smoothstep(casingWidth,
                                casingWidth * 2.3, sideDistance);
  var horizontalCasing = max(1.0 - smoothstep(0.025, 0.085, uy),
                             smoothstep(0.915, 0.975, uy));
  casing = max(casing, horizontalCasing);
  var movingEdge = 1.0 - smoothstep(apertureFeather * 0.45,
                                    apertureFeather * 1.45,
                                    abs(uy - apertureHeight));
  movingEdge *= smooth01(panelOpen * 5.0);

  // Six broad horizontal slats remain attached to the closed portion of each
  // finite panel. Alternating face values distinguish adjacent objects even
  // during the fully closed hold.
  var alternate = panelIndex % 2.0;
  var slatPhase = uy * 6.0;
  var slatLocal = abs((slatPhase - floor(slatPhase)) - 0.50);
  var slatSeam = smoothstep(0.35, 0.48, slatLocal) * (1.0 - aperture);
  var bearingGlint = wave(bearingClock + panelAxis * 1.70
                        + panelIndex * 0.173205 + uy * 0.11);
  var faceMix = 0.025 + alternate * 0.085 + panelU * 0.025;
  var chamberContour = 0.78 + (1.0 - uy) * 0.15
                     + alternate * 0.07;
  var colorMix = faceMix + aperture * (0.78 - faceMix)
               + movingEdge * 0.18 + casing * 0.32 + slatSeam * 0.16;

  var floorLevel = 0.065 + liveSafetyFloor * 0.205;
  var closedFace = 0.065 + alternate * 0.045
                 + slatSeam * (0.13 + liveEdgeGlow * 0.18)
                 + bearingGlint * (1.0 - aperture) * 0.18;
  var chamber = aperture * chamberContour * (0.28 + liveOpening * 0.72);
  var edgeEnergy = casing * (0.22 + liveEdgeGlow * 0.58)
                 + movingEdge * (0.34 + liveEdgeGlow * 0.86)
                 + bearingGlint * (casing * 0.12 + slatSeam * 0.05);
  var brightness = floorLevel + (1.0 - floorLevel)
                 * clamp01(closedFace * (1.0 - aperture)
                          + chamber + edgeEnergy);

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette is a panel blueprint: persistent dividers, horizontal slats,
    // and the individually delayed rolling edges, never a chamber fill.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01(0.08 + casing * (0.46 + liveEdgeGlow * 0.48)
                        + slatSeam * 0.28
                        + movingEdge * (0.54 + liveEdgeGlow * 0.62)
                        + bearingGlint * (casing * 0.16
                                        + slatSeam * 0.11));
    colorMix = clamp01(0.04 + alternate * 0.07
                     + casing * 0.50 + slatSeam * 0.22
                     + movingEdge * 0.36);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry supplies sparse palette-RGB catches only. The catches share the
    // current shutter edge and never introduce native white or a third hue.
    var catchSeed = wave(pixelLocalIndex * 0.381966
                       + panelIndex * 0.173205 + cycleClock * 0.043);
    var catchSquared = catchSeed * catchSeed;
    var panelCatch = catchSquared * catchSquared * catchSquared * catchSeed
                   * clamp01(casing * 0.36 + movingEdge * 1.00
                            + slatSeam * 0.18);
    brightness = clamp01(floorLevel * 0.72 + 0.045
                       + panelCatch * (0.32 + liveEdgeGlow * 0.58));
    colorMix = clamp01(0.62 + alternate * 0.16 + panelCatch * 0.18);
  } else if (fixtureType == FIX_PAR) {
    // Organs mark mechanical stops: settled open and closed states are
    // brighter than the moving midpoint, with no sudden transient flash.
    var stop = smooth01(abs(panelOpen - 0.50) * 2.0);
    brightness = clamp01(floorLevel + 0.10 + stop * 0.28
                       + panelOpen * 0.16
                       + movingEdge * liveEdgeGlow * 0.28);
    colorMix = clamp01(0.10 + panelOpen * 0.70 + stop * 0.10);
  } else if (isSign) {
    // The same complete 74-pixel panel diagram appears on both signs. Dark
    // slatted faces, gold chambers, and moving edges remain high-contrast.
    brightness = clamp01(max(0.22, floorLevel + 0.08
                       + closedFace * 0.42 + aperture * 0.48
                       + movingEdge * (0.30 + liveEdgeGlow * 0.38)
                       + casing * 0.30));
    colorMix = clamp01(faceMix + aperture * 0.72
                     + movingEdge * 0.22 + casing * 0.26);
  }

  brightness = clamp01(brightness);
  colorMix = clamp01(colorMix);
  var outR = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
