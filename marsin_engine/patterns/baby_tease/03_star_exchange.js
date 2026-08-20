/*
  Star Exchange (design doc 72, keeper K12).

  A dim interlocked country of pink and blue patches drifts across the whole
  ship, and inside every patch a scatter of bright stars burns in the OTHER
  family: pink stars glitter inside blue country, blue stars inside pink
  country. A star never owns itself — its family is read from the patch it
  stands in, so when the country drifts under a star the star changes family
  with the ground it sits on. That counter-color law is what keeps the two
  families braided at every scale instead of split into halves.

  Local Speed is the safe first control. Level sets output. Star Density sets
  how thickly the sky is seeded. Black is designed: every patch border is exact
  black, so the country reads as separate territories with dark coastlines
  between them, and no star ever lands on a coastline.

  World geometry uses the all-smokestack ship frame only; raw coordinates appear
  once each to build it. The patch field mixes hull length, height and ship
  width so neither rig's degenerate axis can flatten the country. Vintage
  fixtures carry the alternating country with two counter-color star heads and
  one rotating black separator head. Both TE signs carry the same country plus
  counter-color stars, byte-identical by address.
*/

var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;
var PINK_TRIM = 0.97;
var PINK_BAR_TRIM = 0.80;
var FLOOR_I = 0.14;

export var localSpeed = 0.40;
export var level = 0.88;
export var starDensity = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderStarDensity(value) { starDensity = value; }

var patchClock = 0.0;
var twinkleClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.88;
var liveDensity = 0.5;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function emitBlue(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel;
  rgbwau(BABY_BLUE_R * k, BABY_BLUE_G * k, BABY_BLUE_B * k, 0.0, 0.0, 0.0);
}

function emitPink(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel * PINK_TRIM;
  if (fixtureType == FIX_BAR_18) k = k * PINK_BAR_TRIM;
  rgbwau(BABY_PINK_R * k, BABY_PINK_G * k, BABY_PINK_B * k, 0.0, 0.0, 0.0);
}

function emitBlack() {
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.10, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  // SPEED RETUNE (report _305). Base rates below are ×10.5 (exact equivalence 9.978, biased slightly fast per the operator's
  // "almost right" reading).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor moves
  // the look the operator approved at global SPEED 80 / sliderLocalSpeed 0.90
  // onto that reference point. Saved playlist defaults are UNCHANGED — the
  // retune lives here, in the pattern's own base rate.
  patchClock = patchClock + dt * 0.5775 * speedScale;
  twinkleClock = twinkleClock + dt * 5.775 * speedScale;
  shimmerClock = shimmerClock + dt * 1.68 * speedScale;
  if (patchClock >= 10.0) patchClock = patchClock - 10.0;
  if (twinkleClock >= 100.0) twinkleClock = twinkleClock - 100.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveDensity = clamp01(starDensity);
}

export function render3D(index, x, y, z) {
  var starGate = 0.88 - liveDensity * 0.16;

  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(twinkleClock * 0.9) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headParity = (head + floor(patchClock * 1.5 + 6.0)) % 2.0;
    var headStarEven = (floor(twinkleClock * 0.5) % 3.0) * 2.0;
    var headStarOdd = (floor(twinkleClock * 0.5 + 1.0) % 3.0) * 2.0 + 1.0;
    var headIsStar = 0.0;
    if (head == headStarEven) headIsStar = 1.0;
    if (head == headStarOdd) headIsStar = 1.0;
    var headLevel = 0.20 + wave(shimmerClock * 0.45 + head * 0.31) * 0.05;
    if (headIsStar > 0.5) {
      headParity = (headParity + 1.0) % 2.0;
      headLevel = 0.74 + wave(twinkleClock * 0.7 + head * 0.23) * 0.24;
    }
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signPatch = sin((signX * 2.20 + signY * 1.40 + patchClock * 0.30 + 0.66) * PI2)
                  + sin((signY * 1.80 - signX * 1.10 - patchClock * 0.20 + 0.50) * PI2);
    if (abs(signPatch) < 0.30) {
      emitBlack();
      return;
    }
    var signSeed = sin(signAddress * 12.9898) * 437.585;
    var signHash = signSeed - floor(signSeed);
    var signBlue = 0.0;
    if (signPatch > 0.0) signBlue = 1.0;
    if (signHash > starGate) {
      var signTwinkle = pow(wave(signHash * 37.0 + twinkleClock) * 0.65
                          + wave(signHash * 11.0 + twinkleClock * 0.61) * 0.35, 3.0);
      var signStarLevel = 0.74 + signTwinkle * 0.24;
      if (signBlue > 0.5) emitPink(signStarLevel);
      else emitBlue(signStarLevel);
      return;
    }
    var signCountry = 0.215 + wave(abs(signPatch) * 0.30 + shimmerClock * 0.40) * 0.045;
    if (signBlue > 0.5) emitBlue(signCountry);
    else emitPink(signCountry);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var patch = sin((shipLong * 5.50 + y * 3.00 + patchClock * 0.30 + 0.30) * PI2)
            + sin((shipWide * 6.00 - y * 2.40 - patchClock * 0.20 + 0.10) * PI2);
  if (abs(patch) < 0.30) {
    emitBlack();
    return;
  }
  var starSeed = sin(index * 12.9898) * 437.585;
  var starHash = starSeed - floor(starSeed);
  var patchBlue = 0.0;
  if (patch > 0.0) patchBlue = 1.0;
  if (starHash > starGate) {
    var twinkle = pow(wave(starHash * 37.0 + twinkleClock) * 0.65
                    + wave(starHash * 11.0 + twinkleClock * 0.61) * 0.35, 3.0);
    var starLevel = 0.74 + twinkle * 0.24;
    if (patchBlue > 0.5) emitPink(starLevel);
    else emitBlue(starLevel);
    return;
  }
  var countryLevel = 0.215 + wave(abs(patch) * 0.30 + shimmerClock * 0.40) * 0.045;
  if (patchBlue > 0.5) emitBlue(countryLevel);
  else emitPink(countryLevel);
}
