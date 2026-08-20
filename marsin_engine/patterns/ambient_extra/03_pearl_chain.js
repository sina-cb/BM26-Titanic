/*
  03_pearl_chain.js — connected pearl strings carrying a traveling focus.

  CONCEPT
    Finite pearl centers share one world-space ordering across Silhouette and
    Vintage rails. A slow focus rolls along the connected necklace while the
    Hull Canvas remains deep, softly folded velvet. This is an ordered strand
    composition, not randomized sparkle: bead count, bead size, link glow and
    focus travel each control one visibly independent part of the object.

  INSTRUMENTS AND MOTION
    Raw LED strands and Vintage rails carry the pearl chains. Bars carry a
    restrained three-axis velvet field, pars hold the structure, and each TE
    sign repeats the same fixture-local chain so both identities stay balanced
    and readable. Independent phases use irrational rate ratios and wrap only
    after 10000 turns, avoiding short re-locks and wrap discontinuities.

  CONTROLS (physical MIDI order)
    localSpeed    — pace of traveling focus and velvet drift.
    pearlCount    — number of finite bead centers along each string.
    pearlSize     — spatial width of every pearl core.
    linkGlow      — brightness of the connective thread between pearls.
    focusTravel   — depth of the moving spotlight that rolls over the beads.
    jewelryWhite — matched native W+A in the Vintage pearl cores only.
    safetyFloor   — minimum palette-derived visibility across the full rig.

  AUDIO_MODULATION_V1:
    sliderPearlSize <- micHigh range 0.18..0.48 curve ease  # highs widen the pearl cores
    sliderLinkGlow  <- micFlux range 0.10..0.50 curve linear  # builds illuminate the connecting thread
  Static (unmapped) params: localSpeed, pearlCount, focusTravel,
    jewelryWhite, safetyFloor, colorPalette1/2.
*/

export var cp1H = 0.60, cp1S = 0.76, cp1V = 0.72;
export var cp2H = 0.10, cp2S = 0.38, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.34;
export var pearlCount = 0.48;
export var pearlSize = 0.32;
export var linkGlow = 0.24;
export var focusTravel = 0.72;
export var jewelryWhite = 0.76;
export var safetyFloor = 0.24;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPearlCount(v) { pearlCount = v; }
export function sliderPearlSize(v) { pearlSize = v; }
export function sliderLinkGlow(v) { linkGlow = v; }
export function sliderFocusTravel(v) { focusTravel = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var focusPhase = 0.0;
var velvetPhase = 0.0;
var organPhase = 0.0;

var liveCount = 6.0;
var liveSize = 0.04;
var liveFloor = 0.08;
var liveLink = 0.24;
var liveFocus = 0.72;
var liveWhite = 0.76;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var sv = clamp01(value);
  return sv * sv * (3.0 - 2.0 * sv);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  focusPhase = focusPhase + dt * 0.072 * localMult;
  velvetPhase = velvetPhase + dt * 0.031 * 1.41421356 * localMult;
  organPhase = organPhase + dt * 0.019 * 1.73205081 * localMult;

  if (focusPhase >= PHASE_WRAP) focusPhase = focusPhase - PHASE_WRAP;
  if (velvetPhase >= PHASE_WRAP) velvetPhase = velvetPhase - PHASE_WRAP;
  if (organPhase >= PHASE_WRAP) organPhase = organPhase - PHASE_WRAP;

  liveCount = 3.0 + floor(clamp01(pearlCount) * 4.999);
  liveSize = 0.020 + clamp01(pearlSize) * clamp01(pearlSize) * 0.180;
  liveFloor = 0.035 + clamp01(safetyFloor) * 0.205;
  liveLink = clamp01(linkGlow);
  liveFocus = clamp01(focusTravel);
  liveWhite = clamp01(jewelryWhite);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isBar = fixtureType == FIX_BAR_18;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  // One world-space parameter joins every Silhouette strand and Jewelry rail
  // into a single necklace. The signs use the same local map on both fixtures
  // so their TE treatment remains dynamically matched.
  var localU = clamp01(x * 0.54 + z * 0.31 + y * 0.15);
  if (isSign) {
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    var signY = floor(signIndex / 10.0) / 7.0;
    localU = clamp01(signX * 0.78 + signY * 0.22);
  }
  var focusPos = wave(focusPhase);
  var focusSweep = smooth01(1.0 - abs(localU - focusPos) / 0.22);

  var pearlCore = 0.0;
  var pearlHalo = 0.0;
  var pearlColor = 0.5;
  // The nearest finite bead is analytic: scaling U by the integer count makes
  // each unit interval one bead slot. This preserves exactly three-to-seven
  // ordered centers without a seven-iteration loop in every pixel at 40 fps.
  var beadCoordinate = localU * liveCount;
  var beadSlot = floor(beadCoordinate);
  if (beadSlot >= liveCount) beadSlot = liveCount - 1.0;
  var beadCenter = (beadSlot + 0.5) / liveCount;
  var beadDistance = abs(localU - beadCenter);
  var beadShape = smooth01(1.0 - beadDistance / liveSize);
  var beadHalo = smooth01(1.0 - beadDistance / (liveSize * 2.40 + 0.012));
  var focusDistance = abs(beadCenter - focusPos);
  var focusWindow = smooth01(1.0 - focusDistance / 0.34);
  var focusGain = 1.0 - liveFocus * 0.62
                + liveFocus * (0.30 + focusWindow * 1.18);
  pearlCore = beadShape * focusGain;
  pearlHalo = beadHalo * (0.42 + focusGain * 0.58);
  pearlColor = beadCenter;

  // A continuous, low-output thread connects the finite pearl centers. It is
  // intentionally smoother and dimmer than the cores, so increasing Link Glow
  // reveals continuity rather than creating more sparkle points.
  var textureZ = z;
  if (isSign) textureZ = signY;
  var threadTexture = 0.68 + 0.32
                    * wave(localU * liveCount * 0.61803399
                         - focusPhase * 0.53 + textureZ * 0.17);
  var thread = liveLink * (0.15 + threadTexture * 0.38);
  var chainEnergy = liveFloor + thread + pearlHalo * 0.18 + pearlCore * 0.78;
  var paletteMix = clamp01(0.16 + pearlColor * 0.72
                         + threadTexture * 0.12);

  var brightness = liveFloor;
  var outW = 0.0;

  if (isRaw) {
    brightness = clamp01(chainEnergy * 0.96);
  } else if (isVintage) {
    // Vintage rails are the hero: palette RGB supports a matched W+A pearl
    // core, while the thread remains restrained incandescent filigree.
    brightness = clamp01(liveFloor * 0.75 + thread * 0.44
                       + pearlHalo * 0.12 + pearlCore * 0.58);
    paletteMix = clamp01(0.63 + pearlColor * 0.30);
    outW = clamp01((pearlCore * 0.88 + pearlHalo * 0.16)
                 * liveWhite);
  } else if (isSign) {
    // Both signs carry the same broad pearl-chain window. A firm bed preserves
    // letter legibility while focus motion gives the identity measured life.
    var signField = wave(localU * 1.618 + signY * 1.414
                       + velvetPhase * 0.73)
                  * wave(localU * 2.236 - signY * 1.732
                       - velvetPhase * 0.41);
    brightness = clamp01(max(0.22,
      (0.20 + thread * 0.24 + pearlHalo * 0.16 + pearlCore * 0.34)
      * (0.50 + signField * 0.20 + focusSweep * 1.00)));
    paletteMix = clamp01(0.28 + pearlColor * 0.46
                        + signField * 0.12 - focusSweep * 0.24);
  } else if (isBar) {
    // Deep velvet: three incommensurate folds produce material detail without
    // competing with the chain carried by the direct-view instruments.
    var foldA = wave(x * 1.31 + y * 0.73 + velvetPhase);
    var foldB = wave(z * 1.73 - x * 0.41 - velvetPhase * 0.61803399);
    var foldC = wave((x + z) * 0.57 + y * 1.19
                   + velvetPhase * 1.41421356);
    var velvet = foldA * foldB * 0.62 + foldC * 0.38;
    brightness = clamp01(liveFloor * 0.74 + velvet * 0.075);
    paletteMix = clamp01(0.06 + foldC * 0.34);
  } else if (isPar) {
    var organBreath = wave(organPhase + x * 0.19 + z * 0.23);
    brightness = clamp01(liveFloor * 0.90 + 0.035 + organBreath * 0.055);
    paletteMix = clamp01(0.68 + organBreath * 0.18);
  } else {
    brightness = liveFloor;
    paletteMix = 0.5;
  }


  if (!isSign) {
    var worldField = wave(localU * 1.618 + textureZ * 1.414
                        + velvetPhase * 0.73)
                   * wave(localU * 2.236 - textureZ * 1.732
                        - velvetPhase * 0.41);
    brightness = max(liveFloor, brightness
      * (0.58 + worldField * 0.14 + focusSweep * 0.68));
    paletteMix = clamp01(paletteMix + worldField * 0.10
                        - focusSweep * 0.20);
  }

  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
