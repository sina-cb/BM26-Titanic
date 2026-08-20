/*
  11_pale_garden.js — "Pale Garden"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/22_abyssal_sway_garden.js. Skeleton kept: a soft-
  clamped delta-accumulated current phase bends vertical fronds through a
  cantilevered sway (ny^2), a sharpened wave() field crisps each stalk into
  a spine over darker troughs, and a top-band tip-flicker layer (beads +
  cross-grain + flash) sits above it. TE signs keep the rooted botanical
  emblem with forking stems and phosphorescent crown nodes.
  IDENTITY (50 ft): a garden of pale fronds sways gently, tips glowing
  crisp white against gray stems.

  TEXTURE: the inter-frond troughs and open field rest at a 0.09-0.15
  shadow/floor; the frond bodies and cross-grain carry the 0.30-0.55 mid
  body; the phosphorescent tip flicker and tip aura carry the 0.85-1.0
  crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225); the
  current step is soft-clamped so its rate never exceeds the anti-alias
  budget regardless of speedScale.
  RUNAWAY (g=4.0, local 1.0 = 8x base): the soft limiter caps the flicker
  step at MAX_FLICKER_STEP=0.009 turns/call (<= 0.36 tip cycles/s at 40 fps)
  and the current step at MAX_CURRENT_STEP=0.00275 (<= 0.11 turns/s),
  regardless of speedScale — both remain far below the 10/s alias bar by
  construction, not by budget arithmetic. PHASE_WRAP 4096 wraps are
  therefore always reached by many thousands of frames.
  CONTROLS (declaration order = MFT knob order): localSpeed — current and
  flicker rate; radius — sway amplitude/travel; detail — tip sparkle
  density; frondDensity — stalk count; level — overall intensity with a
  visible floor.
*/

export var localSpeed = 0.30;
export var radius = 0.50;
export var detail = 0.50;
export var frondDensity = 0.50;
export var level = 0.72;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderFrondDensity(v) { frondDensity = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var CURRENT_RATE = 0.16;
var MAX_CURRENT_STEP = 0.00275;
var MAX_FLICKER_STEP = 0.00900;
var PHASE_WRAP = 4096.0;

var current = 0.0;
var flicker = 0.0;
var tide = 0.0;
var tCurrent = 0.0;
var tFlicker = 0.0;
var tTide = 0.0;
var swayAmp = 0.35;

var liveRadius = 0.50;
var liveDetail = 0.50;
var liveDensity = 0.50;
var liveLevel = 0.65;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var paramFollow = clamp01(dt * 6.0);
  liveRadius += (clamp01(radius) - liveRadius) * paramFollow;
  liveDetail += (clamp01(detail) - liveDetail) * paramFollow;
  liveDensity += (clamp01(frondDensity) - liveDensity) * paramFollow;
  liveLevel += (clamp01(level) - liveLevel) * paramFollow;

  swayAmp = 0.10 + liveRadius * 0.62;

  var rawCurrentStep = dt * speedScale * CURRENT_RATE;
  var currentRatio = rawCurrentStep / MAX_CURRENT_STEP;
  var currentStep = rawCurrentStep / sqrt(1.0 + currentRatio * currentRatio);
  current += currentStep;
  if (current >= PHASE_WRAP) current -= PHASE_WRAP;
  var rawFlickerStep = currentStep * 5.3;
  var flickerRatio = rawFlickerStep / MAX_FLICKER_STEP;
  var flickerStep = rawFlickerStep / sqrt(1.0 + flickerRatio * flickerRatio);
  flicker += flickerStep;
  if (flicker >= PHASE_WRAP) flicker -= PHASE_WRAP;
  tide += currentStep * 0.073;
  if (tide >= PHASE_WRAP) tide -= PHASE_WRAP;

  tCurrent = current * PI2;
  tFlicker = flicker * PI2;
  tTide = tide;
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.44 + ux * 0.12;
  }

  var tall = 0.0;
  if (fixtureType == FIX_VINTAGE_6) tall = 1.0;
  var uyEff = clamp01(uy + tall * 0.22);

  // Per-frond lateral sway: higher fronds bend more (cantilever ny^2).
  var travel = tCurrent;
  var bend = sin(travel + ux * 4.0) * swayAmp * uyEff * uyEff;
  var bendSlow = sin(travel * 0.41 + ux * 2.3) * swayAmp * uyEff * 0.5;
  var swayedX = ux + bend;
  swayedX = swayedX + bendSlow;

  // Sharpened wave() field crisps each stalk into a spine over darker
  // troughs — the HD contrast that carries the frond identity.
  var resolvedDensity = 3.0 + liveDensity * 14.0;
  var frondPhase = swayedX * resolvedDensity + sin(swayedX * 11.7) * 0.13;
  var frond = wave(frondPhase);
  frond = pow(frond, 2.6);
  frond = frond * (0.55 + frond * 0.45);

  var heightWeight = 0.3 + pow(uyEff, 1.35) * 0.7;
  var body = frond * heightWeight;

  // Phosphorescent tip flicker: top band only, jittered per frond.
  var tipBand = pow(max(0.0, uyEff - 0.42) / 0.58, 1.1);
  var beadScale = 4.0 + liveDetail * 22.0;
  var beads = wave(swayedX * beadScale + uyEff * (3.0 + liveDetail * 9.0) - tFlicker * 0.17);
  beads = pow(beads, 3.0 + liveDetail * 4.0);
  var crossGrain = wave(ux * (5.0 + liveDetail * 38.0) + uyEff * (3.0 + liveDetail * 31.0) - tFlicker * 0.09);
  crossGrain = pow(crossGrain, 2.0 + liveDetail * 5.0);
  var flick = wave(tFlicker + swayedX * 7.3 + uyEff * 2.1);
  flick = pow(flick, 4.0);
  var tipFlicker = tipBand * (0.20 + flick * 0.80) * frond;
  tipFlicker = tipFlicker * (0.28 + beads * (0.45 + liveDetail * 1.35));

  var tideBreath = 0.8 + sin(tTide * PI2) * 0.2;
  var glowFloor = 0.10 * (0.55 + 0.45 * heightWeight);
  body = body + crossGrain * liveDetail * 0.30 * heightWeight;
  var tipAura = tipBand * frond * (0.20 + 0.40 * heightWeight);

  var shadow = 0.09;
  var midBody = body * 0.42;
  var peakAcc = tipFlicker * 2.60;
  peakAcc = peakAcc + tipAura * 1.10;

  var lvl = shadow + midBody;
  lvl = lvl * tideBreath;
  lvl = lvl + glowFloor;
  lvl = lvl + peakAcc;
  var nativeShare = 0.18 + tipFlicker * 0.65;
  if (fixtureType == FIX_VINTAGE_6) nativeShare = nativeShare + 0.20;

  if (isSign) {
    // Identity: a rooted botanical emblem rather than a crop of the field.
    var emblemHeight = clamp01((uy - 0.50) * 6.2);
    var root = pow(1.0 - emblemHeight, 1.7);
    var signPath = pixelLocalIndex * 0.01351351351;

    var currentNear = wave(current * 4.0 + signPath * 0.37 + uy * 0.31 + uz * 0.19);
    var currentFar = wave(-current * 7.0 + signPath * 0.61 - uy * 0.43 + ux * 0.23 + uz * 0.11);
    var currentVeil = pow(currentNear * 0.56 + currentFar * 0.44, 2.1);

    var stemAnchor = signPath * (2.8 + liveDensity * 3.6);
    stemAnchor = stemAnchor + ux * 0.83 + uy * 0.31 + uz * 1.27;
    var swayNear = sin((current * 4.0 + signPath + uz * 0.37) * PI2) * 0.67;
    swayNear = swayNear + sin((-current * 7.0 + signPath * 0.63 + uy * 0.29) * PI2) * 0.33;
    swayNear = swayNear * swayAmp * emblemHeight * emblemHeight * 0.72;
    var stem = pow(wave(stemAnchor + swayNear), 2.4 + liveDensity * 1.8);

    // Each foreground stalk forks above mid-height.
    var crownRegion = smoothstep(0.36, 0.86, emblemHeight);
    var forkSpread = crownRegion * (0.09 + liveRadius * 0.22)
                    * (0.72 + currentNear * 0.28);
    var forkA = pow(wave(stemAnchor + swayNear + forkSpread),
                    2.6 + liveDensity * 1.2);
    var forkB = pow(wave(stemAnchor + swayNear - forkSpread),
                    2.6 + liveDensity * 1.2);
    var forks = max(forkA, forkB);
    stem = stem * (1.0 - crownRegion * 0.58) + forks * crownRegion;
    stem = stem * (0.28 + emblemHeight * 0.72);

    // Fixed crown nodes carry a smooth phosphorescent lifecycle.
    var tipNodes = wave(signPath * (8.0 + liveDetail * 9.0) + ux * 1.17 + uy * 2.31 + uz * 1.73);
    tipNodes = pow(tipNodes, 5.5 + liveDetail * 3.5);
    var tipMotion = wave(flicker + signPath * 0.43 - emblemHeight * 0.31 + currentFar * 0.09);
    tipMotion = tipMotion * tipMotion * (3.0 - 2.0 * tipMotion);
    var emblemTip = pow(tipMotion, 2.0 + liveDetail * 1.8) * crownRegion;
    emblemTip = emblemTip * (0.20 + forks * 0.52 + tipNodes * 0.58);

    var signShadow = 0.20 + root * 0.06;
    var signMid = currentVeil * (0.14 + emblemHeight * 0.16);
    signMid = signMid + stem * 0.30;
    var signPeak = emblemTip * 0.85;
    lvl = signShadow + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.22 + emblemTip * 0.68;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
