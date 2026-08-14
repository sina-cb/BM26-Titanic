// DRAFT — pending operator review
/*
  133_baby_reveal_burst.js — "The Answer"

  MANUAL REVEAL
    This pattern is pushed only after 132_baby_tease has reached its indefinite
    blackout. It begins at black, sends a spherical shock front and twelve
    petal-rays through the entire model, then settles into a slow photo-safe
    rose and silk field in exactly one selected baby colour family.

  FINAL COLOR
    sliderFinalColor = 0 is baby pink; 1 is baby blue. Pixels never interpolate
    through a third hue. Normalized XYZ carries every model. Identity receives
    a readable moving emblem; Vintage Jewelry alone emits matched W+A diamonds.
    UV is always 0. Any sliderRestartReveal call restarts the explosion at 0.

  GLOBAL PALETTE OPT-OUT
    The exported palette setters are accepted only so this reveal can lead a
    pink- or blue-tuned playlist. Their values are intentionally ignored: the
    answer must remain the authored family even if the deck palette is wrong.
*/

var FIX_VINTAGE_6 = 3;
var FIX_TE_SIGN = 7;
var ignoredPalette1H = 0.0;
var ignoredPalette1S = 0.0;
var ignoredPalette1V = 0.0;
var ignoredPalette2H = 0.0;
var ignoredPalette2S = 0.0;
var ignoredPalette2V = 0.0;

export function colorPalette1(h, s, v) {
  ignoredPalette1H = h;
  ignoredPalette1S = s;
  ignoredPalette1V = v;
}
export function colorPalette2(h, s, v) {
  ignoredPalette2H = h;
  ignoredPalette2S = s;
  ignoredPalette2V = v;
}

export var localSpeed = 0.32;
export var finalColor = 0.0;
export var level = 0.90;
export var spatialDepth = 0.72;
export var sparkle = 0.58;
export var restartReveal = 0.0;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFinalColor(v) { finalColor = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderRestartReveal(v) {
  restartReveal = v;
  revealClock = 0.0;
  photoA = 0.0;
  photoB = 0.0;
}

var PHASE_WRAP = 10000.0;
var revealClock = 0.0;
var photoA = 0.0;
var photoB = 0.0;
var liveFinal = 0.0;
var liveLevel = 0.90;
var liveDepth = 0.72;
var liveSparkle = 0.58;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function wrapPhase(v) {
  if (v >= PHASE_WRAP) return v - PHASE_WRAP;
  return v;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.32) * 2.4);
  revealClock += dt;
  photoA = wrapPhase(photoA + dt * 0.04142135624 * localMultiplier);
  photoB = wrapPhase(photoB + dt * 0.02732050808 * localMultiplier);
  liveFinal = clamp01(finalColor);
  liveLevel = clamp01(level);
  liveDepth = clamp01(spatialDepth);
  liveSparkle = clamp01(sparkle);
}

export function render3D(index, x, y, z) {
  if (revealClock < 0.08) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var cx = nx - 0.5;
  var cy = ny - 0.5;
  var cz = nz - 0.5;
  var radial = sqrt(cx * cx + cz * cz);
  var volumeRadius = sqrt(cx * cx + cy * cy + cz * cz);
  var path = pixelLocalIndex * 0.01351351351;
  var angle = atan2(cz, cx) / PI2;
  var burstClock = revealClock - 0.08;
  var arrival = smooth01(burstClock / 0.18);
  var flashTail = 1.0 - smooth01((burstClock - 0.04) / 1.85);

  var petalRadius = 0.25 + 0.065 * wave(angle * 6.0 - photoA * 0.83);
  var rose = 1.0 - clamp01(abs(radial - petalRadius)
                          / (0.075 + liveDepth * 0.045));
  rose = pow(rose, 1.35 + liveDepth * 1.2);
  var ribbonA = wave(nx * 0.73 + ny * 0.31 - nz * 0.47 - photoA);
  var ribbonB = wave(-nx * 0.41 + ny * 0.67 + nz * 0.37 + photoB);
  var silk = pow(1.0 - abs(ribbonA - ribbonB), 2.4 + liveDepth * 2.8);
  var halo = wave(volumeRadius * 1.9 - photoA * 0.61);
  var photoField = max(rose * (0.65 + halo * 0.35), silk * 0.78);

  var blastRadius = burstClock * 0.58;
  var blastFront = 1.0 - clamp01(abs(volumeRadius - blastRadius)
                               / (0.055 + liveDepth * 0.045));
  var blastLife = 1.0 - smooth01((burstClock - 0.35) / 1.65);
  var blastRays = pow(wave(angle * 12.0 + cy * 1.7 - photoA * 0.35), 5.2)
                * blastLife;
  photoField = max(photoField, blastFront * blastLife);
  photoField = max(photoField, blastRays * 0.88);

  var seed = nx * 17.17 + ny * 31.73 + nz * 47.11 + path * 7.0;
  var diamond = pow(wave(seed + photoB * 2.0),
                    9.0 + (1.0 - liveSparkle) * 12.0) * liveSparkle;
  if (fixtureType == FIX_TE_SIGN) {
    var signA = wave(path * 1.8 + nx * 0.43 - ny * 0.31
                    + nz * 0.27 - photoA * 1.35);
    var signB = wave(path * 2.7 - nx * 0.29 + ny * 0.37 + photoB * 1.73);
    photoField = max(photoField,
      0.42 + pow(1.0 - abs(signA - signB), 2.0) * 0.48);
  }

  var bri = clamp01((0.22 + photoField * (0.55 + liveDepth * 0.30)
                   + diamond * 0.22 + flashTail * 0.42) * liveLevel) * arrival;
  var shade = clamp01(0.20 + photoField * 0.70 + diamond * 0.28);
  var outWhite = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    outWhite = clamp01((diamond * 0.48 + flashTail * 0.56)
                     * liveSparkle * liveLevel) * arrival;
  }

  var r;
  var g;
  var b;
  if (liveFinal >= 0.5) {
    r = (0.008 + shade * 0.030) * bri;
    g = (0.15 + shade * 0.34) * bri;
    b = (0.58 + shade * 0.42) * bri;
  } else {
    r = (0.60 + shade * 0.40) * bri;
    g = (0.008 + shade * 0.030) * bri;
    b = (0.16 + shade * 0.20) * bri;
  }
  rgbwau(clamp01(r), clamp01(g), clamp01(b), outWhite, outWhite, 0.0);
}
