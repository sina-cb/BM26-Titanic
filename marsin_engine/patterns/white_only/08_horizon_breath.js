/*
  08_horizon_breath.js — "Horizon Breath"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/122_breathing_horizon.js. Skeleton kept: one delta-
  accumulated breath phase drives a sine-eased horizontal plane up and down
  through normalized Y; a narrow crisp core marks the plane while a symmetric
  afterglow spreads above and below it. TE signs receive a mirrored horizon
  reflection.
  IDENTITY (50 ft): a luminous horizon band breathes up and down the ship,
  its rim a crisp white line.

  TEXTURE: the open field above/below the band rests at a 0.09 shadow; the
  afterglow spread carries the 0.30-0.55 mid body; the horizon core line
  itself carries the 0.85-1.0 crisp peak.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  breath cycle ~= 9 s on the rig at the reference point (1/(9 x 0.4225) =
  0.263).
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the breath clock at
  0.263 x 8 = 2.10 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.263 x 2.0 = 0.053 against PHASE_WRAP 4096 — wraps safe
  by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — breath rate;
  horizonWidth — core line thickness; breathDepth — vertical travel range;
  afterglow — spread of the mid-body glow; level — overall intensity with a
  visible floor.
*/

export var localSpeed = 0.30;
export var horizonWidth = 0.42;
export var breathDepth = 0.55;
export var afterglow = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderHorizonWidth(v) { horizonWidth = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderAfterglow(v) { afterglow = v; }
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

var PHASE_WRAP = 4096.0;

var breathClock = 0.0;
var liveHorizonWidth = 0.42;
var liveBreathDepth = 0.55;
var liveAfterglow = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveHorizonWidth += (clamp01(horizonWidth) - liveHorizonWidth) * shapeFollow;
  liveBreathDepth += (clamp01(breathDepth) - liveBreathDepth) * shapeFollow;
  liveAfterglow += (clamp01(afterglow) - liveAfterglow) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full breath ~= 9 s at the reference point: 1/(9 x 0.4225) = 0.263.
  var breathRate = 0.263 * speedScale;
  breathClock += dt * breathRate;
  if (breathClock >= PHASE_WRAP) breathClock -= PHASE_WRAP;
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

  // Sine breath has zero velocity at the top and bottom of travel, keeping
  // both reversals elegant. BreathDepth owns only the vertical travel range.
  var breath = sin(breathClock * PI2);
  var travel = liveBreathDepth * 0.38;
  var horizonY = 0.50 + breath * travel;

  // The line stays unmistakably horizontal; a small Z/X bow gives depth.
  var planeY = horizonY + (uz - 0.5) * 0.025 + (ux - 0.5) * 0.008;
  var width = 0.045 + liveHorizonWidth * 0.235;
  var verticalDistance = abs(uy - planeY);
  var core = smooth01(1.0 - verticalDistance / width);
  core = pow(core, 1.15);

  // Afterglow spreads symmetrically above and below the crisp core.
  var tailStart = width * 0.42;
  var tailDistance = max(0.0, verticalDistance - tailStart);
  var tailReach = width * (1.20 + liveAfterglow * 3.80);
  var tail = smooth01(1.0 - tailDistance / tailReach) * liveAfterglow
           * (1.0 - core);

  var shadow = 0.11;
  var midBody = tail * 0.50;
  var peakAcc = core * 2.60;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.15 + core * 0.65;

  if (isSign) {
    // Identity carries the direct horizon plus a softer skyline reflection.
    // Its elevated floor preserves the letters during top/bottom reversals.
    var reflectedY = 1.0 - planeY;
    var reflectedDistance = abs(uy - reflectedY);
    var reflection = smooth01(1.0 - reflectedDistance / (width * 1.25));
    reflection = pow(reflection, 1.85) * 0.55;
    var identityPeak = max(core, reflection) * 1.10;
    var signShadow = 0.25;
    var signMid = tail * 0.30;
    lvl = signShadow + signMid;
    lvl = lvl + identityPeak;
    nativeShare = 0.20 + max(core, reflection) * 0.60;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
