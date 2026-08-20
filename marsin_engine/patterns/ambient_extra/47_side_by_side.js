// DRAFT — pending operator review
/*
  47_side_by_side.js — SIDE BY SIDE

  CONCEPT
    The vessel's two lateral halves hold opposite palette materials. They
    exchange those materials, pass through equality, and separate again while
    total emitted energy stays constant. This is a whole-half material change,
    not a pair of bright walls traveling over a dark ship.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad split Hull Canvas with a softly moving boundary.
    FIX_RAW_LED    — crisp two-material Silhouette around the vessel.
    FIX_VINTAGE_6  — palette-RGB midpoint seam and matched rail punctuation.
    FIX_PAR        — balanced, stationary Organ anchors on both halves.
    FIX_TE_SIGN    — matched full-surface miniature splits and synchronized swap.

  MOTION / MATH
    Normalized model X provides a portable lateral axis. A centered smooth
    boundary drifts only slightly while complementary weights exchange the two
    palette materials. The interpolated palette vector is normalized before
    brightness is applied, making RGB channel energy independent of material
    mix. A fixed RGB-sum energy budget then makes every material state equally
    bright, so even the fully equalized midpoint cannot swell total output.
    Integer clock wrapping is seam-safe.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — pace of the stately material exchange.
    boundary     — resting lateral location and softness of the central seam.
    exchange     — depth of the opposing left/right material swap.
    contrast     — separation between the two palette materials.
    sideGlow     — steady outer-half definition without changing exchange.
    organBalance — strength of mirrored Organ anchor pairs.
    safetyFloor  — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderExchange <- micFlux range 0.22..0.60 curve ease # PRIMARY: spectral change deepens the material exchange
    sliderContrast <- micLow range 0.28..0.58 curve linear # lows separate the two palette materials
  Static (unmapped) params: localSpeed, boundary, sideGlow, organBalance,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB is derived only from the selected cp1↔cp2 line. Native W, A, and UV
    stay zero, satisfying W=A exactly. Every fixture retains a complete
    nonblack bed and both halves remain visible throughout silence.
*/

export var cp1H = 0.565, cp1S = 0.78, cp1V = 0.94;
export var cp2H = 0.085, cp2S = 0.80, cp2V = 0.94;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var boundary = 0.50;
export var exchange = 0.56;
export var contrast = 0.58;
export var sideGlow = 0.34;
export var organBalance = 0.44;
export var safetyFloor = 0.25;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBoundary(v) { boundary = v; }
export function sliderExchange(v) { exchange = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSideGlow(v) { sideGlow = v; }
export function sliderOrganBalance(v) { organBalance = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;

var exchangeClock = 0.11;
var boundaryClock = 0.37;
var exchangeFrontX = -0.18;
var swapWeight = 0.5;
var boundaryPosition = 0.5;

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

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  exchangeClock += dt * (0.012 + localMultiplier * 0.032);
  boundaryClock += dt * (0.008 + localMultiplier * 0.019);
  if (exchangeClock >= PHASE_WRAP) exchangeClock -= PHASE_WRAP;
  if (boundaryClock >= PHASE_WRAP) boundaryClock -= PHASE_WRAP;

  var exchangePhase = 0.5 + 0.5 * sin(exchangeClock * PI2);
  var exchangeDepth = 0.12 + clamp01(exchange) * 0.88;
  swapWeight = 0.5 + (exchangePhase - 0.5) * exchangeDepth;

  var restingBoundary = 0.34 + clamp01(boundary) * 0.32;
  var boundaryMotion = sin(boundaryClock * PI2) * 0.035;
  boundaryPosition = restingBoundary + boundaryMotion;
  exchangeFrontX = -0.18 + 1.36 * (exchangeClock - floor(exchangeClock));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.72 + z * 0.28);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign spans 40- and 34-pixel fixtures whose local counters restart.
    // Fold model index into one complete 10x8 miniature split; both physical
    // signs then show the same coordinated material exchange byte-for-byte.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  var fieldA = wave(px * 1.618 + py * 1.414 + boundaryClock * 0.71);
  var fieldB = wave(px * 2.236 - py * 1.732 - boundaryClock * 0.43);
  var exchangeField = fieldA * fieldB;
  var exchangeBand = smooth01(1.0
    - abs(px - exchangeFrontX) / 0.25);

  var distanceFromBoundary = px - boundaryPosition;
  var blendWidth = 0.035 + (1.0 - clamp01(boundary)) * 0.055;
  var sideWeight = smooth01(distanceFromBoundary / blendWidth + 0.5);
  var materialMix = swapWeight + sideWeight * (1.0 - 2.0 * swapWeight);

  // Contrast pulls both complementary materials away from equality without
  // changing their sum. The exchange therefore still crosses exact balance.
  var contrastDepth = 0.18 + clamp01(contrast) * 0.82;
  materialMix = 0.5 + (materialMix - 0.5) * contrastDepth;

  var floorLevel = 0.10 + clamp01(safetyFloor) * 0.18;
  var outerSide = smooth01(abs(px - 0.5) * 2.0);
  var steadySideGlow = clamp01(sideGlow) * outerSide;
  var brightness = floorLevel + 0.42 + steadySideGlow * 0.36;

  if (isBar) {
    // Hull Canvas reads as two full, bright materials rather than two pulses.
    brightness = floorLevel + 0.54 + steadySideGlow * 0.60;
  } else if (isRaw) {
    // Silhouette receives a more defined two-color outline at constant energy.
    var outline = 0.5 + 0.5 * wave(py * 2.0 + px * PHI);
    brightness = floorLevel + 0.56 + outline * 0.10
               + steadySideGlow * 0.52;
  } else if (isVintage) {
    // Jewelry marks the chromatic midpoint seam; brightness remains rail-wide
    // and steady, while seam proximity controls only palette material.
    var seam = smooth01(1.0 - abs(distanceFromBoundary) / 0.16);
    materialMix = clamp01(materialMix + (0.5 - materialMix) * seam * 0.72);
    brightness = floorLevel + 0.58 + clamp01(sideGlow) * 0.28
               + seam * (0.04 + clamp01(boundary) * 0.08);
  } else if (isPar) {
    // Mirrored Organ anchors balance both sides and never chase the boundary.
    var anchorLeft = smooth01(1.0 - abs(px - 0.27) / 0.20);
    var anchorRight = smooth01(1.0 - abs(px - 0.73) / 0.20);
    var anchorPair = max(anchorLeft, anchorRight);
    brightness = floorLevel + 0.48
               + anchorPair * (0.12 + clamp01(organBalance) * 0.28)
               + steadySideGlow * 0.35;
    materialMix = clamp01(materialMix + (0.5 - materialMix)
                         * clamp01(organBalance) * 0.32);
  } else if (isSign) {
    // Each complete sign coordinates both materials around one local boundary;
    // the pair is matched while the whole-half exchange concept stays intact.
    var signSide = smooth01((px - 0.50) / 0.10 + 0.50);
    materialMix = swapWeight + signSide * (1.0 - 2.0 * swapWeight);
    materialMix = 0.5 + (materialMix - 0.5) * contrastDepth;
    var signRelief = wave(px * PHI + py * SQRT2 + boundaryClock * 0.17);
    brightness = max(0.24, (floorLevel + 0.34 + signRelief * 0.12)
      * (0.48 + exchangeField * 0.20 + exchangeBand * 0.92));
    materialMix = clamp01(materialMix + exchangeField * 0.12
                         - exchangeBand * 0.30);
  }

  // A restrained complementary energy exchange makes the two ship halves
  // visibly trade emphasis. Equal and opposite multipliers conserve their
  // combined light; signs are excluded so paired Identity totals stay equal.
  if (!isSign) {
    var sidePolarity = px < 0.5 ? -1.0 : 1.0;
    var balanceMotion = (swapWeight - 0.5) * 2.0;
    var balanceDepth = 0.04 + clamp01(contrast) * 0.12
                     + clamp01(sideGlow) * 0.06;
    brightness *= 1.0 + sidePolarity * balanceMotion * balanceDepth;
    brightness = max(floorLevel, brightness
      * (0.52 + exchangeField * 0.16 + exchangeBand * 0.76));
    materialMix = clamp01(materialMix + exchangeField * 0.10
                         - exchangeBand * 0.24);
  }

  brightness = clamp01(brightness);
  materialMix = clamp01(materialMix);
  var paletteR = pr1 + (pr2 - pr1) * materialMix;
  var paletteG = pg1 + (pg2 - pg1) * materialMix;
  var paletteB = pb1 + (pb2 - pb1) * materialMix;

  // Constant-sum normalization. Rich two-material palettes receive the full
  // display energy budget; monochrome endpoints taper that budget before any
  // channel can clip and destroy control truth.
  var paletteEnergy = max(0.0001, paletteR + paletteG + paletteB);
  var paletteRichness = smooth01((paletteEnergy - 1.0) / 0.58);
  var energyBudget = 0.95 + paletteRichness * 1.15;
  var energyScale = brightness * energyBudget / paletteEnergy;
  rgbwau(clamp01(paletteR * energyScale),
         clamp01(paletteG * energyScale),
         clamp01(paletteB * energyScale), 0.0, 0.0, 0.0);
}
