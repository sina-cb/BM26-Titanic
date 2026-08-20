// DRAFT — pending operator review
/*
  50_last_lantern.js — LAST LANTERN

  CONCEPT
    One local head cohort on every six-head Vintage rail is the final lantern.
    It holds for most of each step, then hands its light gently to the next
    cohort. The full vessel remains quietly outlined: this is one held Jewelry
    lantern repeated per rail, never distributed shimmer or stars.

  INSTRUMENT STAGING
    FIX_BAR_18     — low, warm, static palette resonance on the Hull Canvas.
    FIX_RAW_LED    — temporally constant cool Silhouette outline.
    FIX_VINTAGE_6  — the single hero cohort with matched native W=A.
    FIX_PAR        — steady warm hearth tones across the Organs.
    FIX_TE_SIGN    — calm paired local nameplates with exact buffer parity.

  MOTION / MATH
    A six-position fixture-local selector advances at a long cycle. Each slot
    spends over 70% of its default interval in an exact one-cohort hold, then a
    bounded smooth crossfade hands off to its neighbor. Circular local-index
    distance adds a palette-only halo without creating a second white hero.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed       — cadence of the six-position lantern journey.
    lanternHold      — fraction of each slot spent on the exact hero cohort.
    handoff          — softness and overlap character of the eased transfer.
    lanternSize      — breadth of the palette halo around the white hero head.
    jewelryWhite     — strength of the Vintage-only native-white lantern.
    silhouetteLevel — steady level of the cool vessel outline.
    safetyFloor      — protected whole-vessel visibility beneath the tableau.

  AUDIO_MODULATION_V1:
    sliderJewelryWhite <- micHigh range 0.18..0.42 curve ease # highs brighten the one Vintage lantern cohort
    sliderHandoff      <- micFlux range 0.08..0.30 curve linear # flux softens the finite lantern transfer
  Static (unmapped) params: localSpeed, lanternHold, lanternSize,
    silhouetteLevel, safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 segment. Native white exists only on
    Vintage and always W=A; UV is always zero. Silence yields a complete final
    tableau with unhurried handoffs and no blackout or full-rig flicker.
*/

export var cp1H = 0.075, cp1S = 0.82, cp1V = 1.00;
export var cp2H = 0.585, cp2S = 0.72, cp2V = 0.92;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var lanternHold = 0.72;
export var handoff = 0.18;
export var lanternSize = 0.48;
export var jewelryWhite = 0.34;
export var silhouetteLevel = 0.54;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLanternHold(v) { lanternHold = v; }
export function sliderHandoff(v) { handoff = v; }
export function sliderLanternSize(v) { lanternSize = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }
export function sliderSilhouetteLevel(v) { silhouetteLevel = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var lanternPhase = 0.141;
var lanternSweepX = -0.18;
var currentCohort = 0.0;
var nextCohort = 1.0;
var currentWeight = 1.0;
var nextWeight = 0.0;
var lanternFlame = 1.0;

var liveLanternHold = 0.72;
var liveHandoff = 0.18;
var liveLanternSize = 0.48;
var liveJewelryWhite = 0.34;
var liveSilhouetteLevel = 0.54;
var liveSafetyFloor = 0.28;

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 5.0);
  liveLanternHold += (lanternHold - liveLanternHold) * follow;
  liveHandoff += (handoff - liveHandoff) * follow;
  liveLanternSize += (lanternSize - liveLanternSize) * follow;
  liveJewelryWhite += (jewelryWhite - liveJewelryWhite) * follow;
  liveSilhouetteLevel += (silhouetteLevel - liveSilhouetteLevel) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  lanternPhase += dt * (0.009 + localMultiplier * 0.026);
  if (lanternPhase >= PHASE_WRAP) lanternPhase -= PHASE_WRAP;
  lanternSweepX = -0.18 + 1.36 * (lanternPhase - floor(lanternPhase));

  var sixPosition = (lanternPhase - floor(lanternPhase)) * 6.0;
  currentCohort = floor(sixPosition);
  nextCohort = (currentCohort + 1.0) % 6.0;
  var slotPhase = sixPosition - currentCohort;

  // Default transition width is below 30% of a slot, leaving one exact hero
  // cohort for over 70% of every full cycle. Hold owns duration; Handoff owns
  // the crossfade shape and overlap, so the two controls remain independent.
  var transitionWidth = 0.040 + (1.0 - clamp01(liveLanternHold)) * 0.55;
  var transitionStart = 1.0 - transitionWidth;
  if (slotPhase <= transitionStart) {
    currentWeight = 1.0;
    nextWeight = 0.0;
  } else {
    var transition = smooth01((slotPhase - transitionStart) / transitionWidth);
    var handoffPower = 0.62 + clamp01(liveHandoff) * 2.10;
    currentWeight = pow(1.0 - transition, handoffPower);
    nextWeight = pow(transition, handoffPower);
  }
  // One very gentle inner flame remains inside the selected cohort. It makes
  // Local Speed observable during the long exact hold without moving another
  // head or introducing a distributed Jewelry shimmer.
  lanternFlame = 0.70 + 0.30
               * (0.5 + 0.5 * sin(lanternPhase * PI2 * 13.0));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The 74-pixel nameplate spans two fixtures whose local counters reset.
    // Folding the model index gives both Titanic signs one complete, matched
    // surface throughout every Jewelry handoff.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50;
  }

  var lanternFieldA = wave(px * 1.618 + py * 1.414
                         + lanternPhase * 0.73);
  var lanternFieldB = wave(px * 2.236 - py * 1.732 + pz * 0.618
                         - lanternPhase * 0.41);
  var lanternField = lanternFieldA * lanternFieldB;
  var travellingLantern = smooth01(1.0
    - abs(px - lanternSweepX) / 0.24);

  var floorLevel = 0.050 + clamp01(liveSafetyFloor) * 0.245;
  var brightness = floorLevel;
  var paletteMix = 0.18;
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Low warm resonance is spatial but intentionally time-invariant.
    var warmFacet = 0.5 + 0.5
      * sin((px * SQRT2 + py * GOLDEN_FRACTION + pz * 0.19) * PI2);
    brightness = floorLevel + 0.055 + warmFacet * 0.095;
    paletteMix = clamp01(0.04 + warmFacet * 0.22);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette is exactly constant over time; only its operator level and
    // fixed local-index contour affect output, keeping temporal CV near zero.
    var outlineContour = 0.82 + (pixelLocalIndex % 5.0) * 0.035;
    brightness = floorLevel + outlineContour
               * (0.035 + clamp01(liveSilhouetteLevel) * 0.64);
    paletteMix = 0.91;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var localHead = pixelLocalIndex % 6.0;
    var hero = 0.0;
    if (localHead == currentCohort) hero = currentWeight;
    else if (localHead == nextCohort) hero = nextWeight;

    var distanceCurrent = abs(localHead - currentCohort);
    distanceCurrent = min(distanceCurrent, 6.0 - distanceCurrent);
    var distanceNext = abs(localHead - nextCohort);
    distanceNext = min(distanceNext, 6.0 - distanceNext);
    var haloRadius = 0.45 + clamp01(liveLanternSize) * 2.25;
    var currentHalo = clamp01(1.0 - distanceCurrent / haloRadius)
                    * currentWeight;
    var nextHalo = clamp01(1.0 - distanceNext / haloRadius) * nextWeight;
    var halo = max(currentHalo, nextHalo);

    // The halo is palette RGB. Only the selected cohort receives native white,
    // so adjacent heads never become competing white lanterns.
    brightness = floorLevel * 0.78 + 0.055
               + clamp01(liveLanternHold) * 0.12
               + halo * (0.02 + liveLanternSize * 0.50)
               + halo * clamp01(liveHandoff) * 0.07
               + hero * lanternFlame
               * (0.30 + liveJewelryWhite * 0.58);
    paletteMix = clamp01(0.08 + halo * 0.34 + hero * 0.34);
    nativeWhite = hero * lanternFlame
                * (0.08 + clamp01(liveJewelryWhite) * 0.62);
  } else if (fixtureType == FIX_PAR) {
    // Organs are a steady four-tone hearth, structurally present but never
    // competing with the final Jewelry lantern.
    var hearthCohort = pixelLocalIndex % 4.0;
    brightness = floorLevel + 0.14 + hearthCohort / 3.0 * 0.12;
    paletteMix = clamp01(0.05 + hearthCohort / 3.0 * 0.20);
  } else if (isSign) {
    // Identity remains calm and paired: a fixed centered nameplate, not a copy
    // of the moving lantern selector.
    var nameplateDistance = abs(px - 0.50) + abs(py - 0.50);
    var nameplate = 1.0 - smoothstep(0.08, 0.52, nameplateDistance);
    brightness = max(0.22, (floorLevel + 0.10 + nameplate * 0.24)
      * (0.52 + lanternField * 0.20 + travellingLantern * 1.05));
    paletteMix = clamp01(0.14 + nameplate * 0.28
                        + lanternField * 0.12 - travellingLantern * 0.26);
  }


  if (!isSign && fixtureType != FIX_VINTAGE_6) {
    brightness = max(floorLevel, brightness
      * (0.58 + lanternField * 0.16 + travellingLantern * 0.72));
    paletteMix = clamp01(paletteMix + lanternField * 0.10
                        - travellingLantern * 0.20);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
