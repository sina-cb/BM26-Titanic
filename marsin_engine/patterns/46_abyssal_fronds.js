/*
  46_abyssal_fronds.js — a breathing garden of crisp abyssal kelp, with
  phosphorescent crowns moving through dark teal water.

  IDENTITY
    Vertical fronds bend in a slow current. Their stalks carry the first palette
    endpoint, their tips bloom toward the second, and fine tip glints ride the
    highs. The whole garden opens and closes on an autonomous tide breath even
    in silence. This preserves the original dark-water / bright-tip character.
    TE signs become one readable abyssal crown: a stable root field holds the
    letterform while slow XYZ forks and phosphorescent local-index tips live
    above it. This is a rooted emblem, not Pattern 22's garden field or Pattern
    44's model-wide swell.

  PORTABLE FIXTURE AUTHORSHIP
    World x/y coordinates create the garden on every model. Fixture capability
    refines the role without raw model-specific section ids:
      FIX_VINTAGE_6 — six local pixels become a full-height Jewelry frond;
                      phosphor tips use explicit matched W+A and warm RGB.
      FIX_PAR       — compact warm crowns rather than saturated blue wash.
      FIX_BAR_18    — broad mid-water stalks.
    Other fixture roles use their normalized world height directly. Unknown or
    missing metadata is not guessed at; the loaded model must supply the FIX_*
    roles referenced by this production pattern.

  SEAM-FREE CLOCKS
    Current A, current B, tip flicker, and breath each own an independent
    delta-accumulated phase in turns. They wrap only at PHASE_WRAP=10000, an
    integer number of turns. No wrapped phase is multiplied by SQRT2/PHI at the
    use site, removing the former tCur*SQRT2 jump every short 0..1 wrap.

  CONTROLS (physical MIDI order preserved)
    localSpeed  — current and phosphor-flicker rate.
    level       — overall garden brightness; primary low-band handle.
    glints      — phosphorescent tip and Jewelry-white activity.
    breathRate  — autonomous tide-breath rate.
    breathDepth — how widely the fronds open and close.
    frondDensity— number of stalks across the field.
    baseGlow    — meaningful dark-water visibility floor.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve linear  # PRIMARY: bass raises the garden body
    sliderGlints <- micHigh range 0.00..1.00 curve pow2    # highs: tip phosphor and Jewelry-white sparkle
  Static (unmapped) params: localSpeed, breathRate, breathDepth, frondDensity,
  baseGlow, colorPalette1/2.
*/

// Optional accent role: self-declare the append-only canonical registry id so
// scenes without TE signs compile without changing their output.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;
export var level = 0.5;
export var glints = 0.5;
export var breathRate = 0.5;
export var breathDepth = 0.5;
export var frondDensity = 0.5;
export var baseGlow = 0.4;

export var cp1H = 0.58, cp1S = 1.00, cp1V = 1.0;
export var cp2H = 0.33, cp2S = 0.95, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderGlints(v) { glints = v; }
export function sliderBreathRate(v) { breathRate = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderFrondDensity(v) { frondDensity = v; }
export function sliderBaseGlow(v) { baseGlow = v; }

var PHI = 1.6180339887;
var SQRT2 = 1.4142135624;
var SQRT3 = 1.7320508076;
var GOLDEN = 11.0905;
var PHASE_WRAP = 10000.0;

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var currentA = 0.0;
var currentB = 0.0;
var flickerPhase = 0.0;
var breathPhase = 0.0;
var swayAmp = 0.0;
var briGain = 0.0;
var waterFloor = 0.0;
var breathLift = 1.0;
var density = 7.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  // Wide exponential span: low end is a long abyssal inhale, high end a clearly
  // faster tide. The range is deliberately broader than Local Speed so the
  // dedicated Breath Rate remains observable over independent current/flicker.
  var breathMultiplier = pow(2.0, (breathRate - 0.5) * 5.0);

  currentA = currentA + dt * 0.030 * localMultiplier;
  currentB = currentB + dt * 0.030 * SQRT2 * localMultiplier;
  flickerPhase = flickerPhase + dt * 0.14 * PHI * localMultiplier;
  breathPhase = breathPhase + dt * 0.135 * breathMultiplier;

  if (currentA >= PHASE_WRAP) currentA = currentA - PHASE_WRAP;
  if (currentB >= PHASE_WRAP) currentB = currentB - PHASE_WRAP;
  if (flickerPhase >= PHASE_WRAP) flickerPhase = flickerPhase - PHASE_WRAP;
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;

  var swell = wave(breathPhase);
  var depth = 0.26 + breathDepth * 0.50;
  swayAmp = 0.08 + (0.10 + 0.14 * swell) * depth;
  // The autonomous breath also gives the upper garden a restrained luminance
  // inhale/exhale. This makes Breath Rate visibly and measurably control the
  // named cycle instead of being buried under the faster current motion.
  breathLift = 0.30 + 0.70 * swell;

  // A curved gain gives the low-band handle clear visual travel while keeping
  // the unmapped midpoint near the established ambient brightness.
  briGain = 0.16 + level * level * 3.40;

  // baseGlow now spans no added floor at 0 to a clearly visible breathing
  // water bed at 1. The frond body remains independent and visible at zero.
  waterFloor = baseGlow * 0.115 * (0.62 + 0.38 * swell);
  density = 4.3 + frondDensity * 9.7;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var hw = clamp01(y);
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  // Capability-aware height roles replace the old test-bench section numbers.
  // Vintage local index zero is the crown and index five the root; the scene's
  // pixel-order calibration keeps this spatial/physical association truthful.
  if (isVintage) {
    hw = 1.0 - clamp01(pixelLocalIndex / 5.0);
  } else if (isPar) {
    hw = 0.74;
  } else if (fixtureType == FIX_BAR_18) {
    hw = 0.38 + clamp01(y) * 0.30;
  }

  var bend = sin(currentA * PI2 + nx * PHI * 7.0)
           * swayAmp * hw * hw;
  var bendSlow = sin(currentB * PI2 + nx * SQRT3 * 4.0)
                * swayAmp * hw * 0.5;
  var swayedX = nx + bend + bendSlow;

  var frondPhase = swayedX * density + sin(swayedX * GOLDEN) * 0.13;
  var frondRaw = wave(frondPhase);
  var frond = pow(frondRaw, 2.8);

  var heightWeight = pow(hw, 1.15);
  var stalk = frond * 0.80 + pow(frondRaw, 2.2) * 0.18 + 0.035;
  var body = stalk * (0.28 + 0.72 * heightWeight);

  var tipBand = clamp01((hw - 0.40) / 0.60);
  tipBand = tipBand * tipBand;
  var flick = wave(flickerPhase + swayedX * 7.3 + hw * 2.1);
  flick = pow(flick, 3.0);
  var glintThreshold = 0.82 - glints * 0.58;
  var glint = 0.0;
  if (flick > glintThreshold) {
    glint = (flick - glintThreshold) / (1.0 - glintThreshold + 0.0001);
  }

  var tipCore = tipBand * pow(frond, 0.72);
  var tipGlow = tipCore * (0.03 + glints * 1.55)
              * (0.68 + 0.32 * flick);
  tipGlow = tipGlow + tipCore * glint * glints * 0.85;
  // A broader phosphor sheath makes high-band motion readable on low-pixel
  // models while remaining localized to upper frond bodies rather than acting
  // as a whole-frame brightness gain.
  var phosphorSheen = tipBand * pow(frondRaw, 1.55) * glints * glints
                    * (0.42 + 0.58 * flick) * 1.60;
  tipGlow = tipGlow + phosphorSheen;

  var upperBreath = 0.32 + breathLift * (0.50 + 0.30 * tipBand);
  // The bulk stalk inhales/exhales; phosphor rides above that envelope so the
  // high-band Glints handle remains an independent visual dimension.
  var bri = body * 0.95 * briGain * upperBreath
          + tipGlow * briGain + waterFloor;
  bri = clamp01(bri);

  var tcol = clamp01(frond * 0.62 + tipBand * 0.54 + tipGlow * 0.95);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Warm capability treatment: Vintage Jewelry becomes gold/white rather than
  // deep blue; pars receive a smaller warm bias so wash fixtures do not paint
  // yellow-stained structure with saturated blue.
  if (isSign) {
    // Identity grows three tall rooted organisms through each sign. Physical Y
    // supplies their height while local index separates stable stalk lanes;
    // sway increases upward, leaving every root anchored to the letterform.
    var signHeight = clamp01((y - 0.50) * 6.25);
    var signPath = pixelLocalIndex * 0.01351351351;
    var signSway = sin((currentA * 20.0 + signPath * 0.31
      + z * 0.17) * PI2) * signHeight * signHeight
      * (0.12 + breathDepth * 0.30);
    var signStemCoord = signPath * 3.0 + signSway;
    var signStem = pow(wave(signStemCoord), 4.6 - frondDensity * 1.2);

    // Above mid-height, each stem splits into an opening two-prong crown. The
    // second current changes fork separation, not the rooted trunk position.
    var signCrownBand = clamp01((signHeight - 0.42) / 0.58);
    signCrownBand = signCrownBand * signCrownBand;
    var signForkOpen = signCrownBand * (0.18 + breathDepth * 0.24)
      * (0.68 + wave(currentB * 18.0 + signPath * 0.23) * 0.32);
    var signForkA = pow(wave(signStemCoord + signForkOpen),
      4.0 - frondDensity * 0.85);
    var signForkB = pow(wave(signStemCoord - signForkOpen),
      4.0 - frondDensity * 0.85);
    var signForks = max(signForkA, signForkB);
    var signFrond = signStem * (1.0 - signCrownBand * 0.62)
                  + signForks * signCrownBand;

    // Two counter-current tendril fields weave between the rooted forks. Their
    // interference continually opens new crown windows while the trunk remains
    // anchored, giving the sign a recognizably abyssal organism—not a flat
    // wave pasted onto the letters.
    var signCurlA = wave(signPath * 4.13 + signHeight * 2.17
                       + nx * 0.71 - z * 0.43 + currentA * 13.0);
    var signCurlB = wave(-signPath * 3.37 + signHeight * 3.11
                       - nx * 0.53 + z * 0.89 - currentB * 17.0);
    var signTendril = pow(clamp01(1.0 - abs(signCurlA - signCurlB)), 3.4)
                    * (0.25 + signCrownBand * 0.75);
    signFrond = clamp01(signFrond + signTendril * 0.32);

    // The autonomous tide travels from root to crown, so the organisms breathe
    // upward instead of pulsing the whole sign. Sparse fixed tip addresses carry
    // a smooth phosphorescent lifecycle—never frame-random flicker.
    var signBreath = wave(breathPhase - signHeight * 0.16
      + signPath * 0.025);
    var signTipSeed = wave(pixelLocalIndex * 0.381966 + nx * 1.17
      + y * 2.31 + z * 1.73);
    var signTipSelected = (signTipSeed < 0.18 + glints * 0.08) ? 1.0 : 0.0;
    var signTip = wave(flickerPhase * (2.20 + signTipSeed * 0.50)
      + signTipSeed * 0.73);
    signTip = pow(signTip, 4.2) * signTipSelected;
    var signTipBand = signCrownBand * signHeight;
    var signRoot = 1.0 - signHeight;
    var signFloor = 0.27 + baseGlow * 0.12 + level * 0.22;
    var signBreathSheath = signBreath * (0.045 + signHeight * 0.055);
    var signV = signFloor + signRoot * 0.09 + signBreathSheath
      + signFrond * (0.26 + signHeight * 0.25)
        * (0.68 + signBreath * 0.32)
      + signTendril * 0.12
      + signTip * signTipBand * glints * 0.68;
    signV = clamp01(signV);
    var signMix = clamp01(0.06 + signHeight * 0.34
      + signForks * signCrownBand * 0.18
      + signTendril * 0.24
      + signTip * signTipBand * glints * 0.46);
    r = (pr1 + (pr2 - pr1) * signMix) * signV;
    g = (pg1 + (pg2 - pg1) * signMix) * signV;
    b = (pb1 + (pb2 - pb1) * signMix) * signV;
  } else if (isVintage) {
    var warm = bri * (0.45 + tipBand * 0.55);
    r = r * 0.35 + warm * 0.65;
    g = g * 0.45 + warm * 0.34;
    b = b * 0.28 + warm * 0.06;
  } else if (isPar) {
    r = r * 0.72 + bri * 0.18;
    g = g * 0.80 + bri * 0.10;
    b = b * 0.58;
  }

  // Jewelry phosphor is explicit white. W and A are byte-identical even though
  // Vintage hardware has no amber destination; the authored logical white
  // therefore remains compatible with the RGBWAU fixtures and project policy.
  var w = 0.0;
  if (isVintage) {
    w = clamp01(tipCore * (0.06 + glints * 1.15)
              * (0.62 + 0.38 * flick) * (0.45 + level * 0.75));
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
