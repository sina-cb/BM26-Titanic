/*
  07_ivory_wake.js — "Ivory Wake"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/121_spiral_wake.js. Skeleton kept: two broad,
  counter-curving spiral crests (helixA/helixB) travel through normalized
  XYZ using atan2 azimuth and radius from the ship's vertical axis; a crown
  term fires where both crests coincide; identity gets a denser two-axis
  crossing on the same clocks.
  IDENTITY (50 ft): a spiral wake of white foam lines winds around the ship
  over satin gray water.

  TEXTURE: the water between wake lines rests at a 0.10 shadow; the broad
  pre-crush falloff of each helix carries the 0.28-0.48 mid body (satin
  water); the crushed crest and crown carry 0.85-1.0 crisp foam peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the
  primary wake helix completes one full turn ~= 17 s on the rig at the
  reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the wake clock at
  0.139 x 8 = 1.11 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.139 x 2.0 = 0.028 against PHASE_WRAP 4096 — wraps safe
  by 5 orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — wake travel
  rate; spiralWidth — crest width; wakeContrast — crest crush power; level —
  overall intensity with a visible floor; pulse — crown emphasis where both
  crests coincide.
*/

export var localSpeed = 0.30;
export var spiralWidth = 0.50;
export var wakeContrast = 0.32;
export var level = 0.75;
export var pulse = 0.30;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSpiralWidth(v) { spiralWidth = v; }
export function sliderWakeContrast(v) { wakeContrast = v; }
export function sliderLevel(v) { level = v; }
export function sliderPulse(v) { pulse = v; }

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
var WAKE_BASE = 0.139;
var ECHO_BASE = 0.0985;
var TURN_COUNT_FIXED = 2.33;

var wakePhase = 0.0;
var echoPhase = 0.37;

var liveWidth = 0.50;
var liveContrast = 0.58;
var liveLevel = 0.75;
var livePulse = 0.30;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  liveWidth += (clamp01(spiralWidth) - liveWidth) * lightFollow;
  liveContrast += (clamp01(wakeContrast) - liveContrast) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  livePulse += (clamp01(pulse) - livePulse) * lightFollow;

  // The primary wake helix completes one full turn ~= 17 s at the reference
  // point: 1/(0.139 x 0.4225) ~= 17.0 s.
  wakePhase += dt * WAKE_BASE * speedScale;
  echoPhase += dt * ECHO_BASE * speedScale;
  if (wakePhase >= PHASE_WRAP) wakePhase -= PHASE_WRAP;
  if (echoPhase >= PHASE_WRAP) echoPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.44 + nx * 0.12;
  }

  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var angle = atan2(dz, dx) / PI2;
  var radius = sqrt(dx * dx + dz * dz);
  var wakeWidth = 0.13 + liveWidth * 0.34;

  var helixA = wave(angle * TURN_COUNT_FIXED + ny * 0.92
    + radius * 0.55 - wakePhase);
  var helixB = wave(-angle * (TURN_COUNT_FIXED * 0.62 + 0.38) + ny * 0.67
    - radius * 0.81 + echoPhase);
  // Linear (pre-crush) falloff gives a broad satin body; the powered
  // version crushes it to a crisp foam crest.
  var crestALin = clamp01(1.0 - abs(helixA - 0.5) * 2.0 / wakeWidth);
  var crestBLin = clamp01(1.0 - abs(helixB - 0.5) * 2.0 / (wakeWidth * 1.28));
  var exponent = 1.15 + liveContrast * 3.2;
  var crestAPk = pow(crestALin, exponent);
  var crestBPk = pow(crestBLin, exponent * 0.78);
  var crestPk = max(crestAPk, crestBPk * 0.68);
  var crownPk = max(crestAPk * crestBPk, crestPk * clamp01(livePulse));
  var midRaw = max(crestALin, crestBLin * 0.72);

  var shadow = 0.10;
  var midAcc = midRaw * (0.22 + midRaw * 0.16);
  var peakAcc = crestPk * (1.10 + liveLevel * 0.55);
  peakAcc = peakAcc + crownPk * (0.55 + livePulse * 0.45);

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.15 + crestPk * 0.60 + crownPk * 0.30;

  if (isSign) {
    // Identity: a denser two-axis crossing on the same clocks, over a firm
    // readable floor.
    var signPath = pixelLocalIndex * 0.01351351351;
    var signA = wave(angle * 2.0 + ny * 1.37 + signPath * 0.31
      - wakePhase * 3.0);
    var signB = wave(-angle * 3.0 + ny * 0.83 - signPath * 0.23
      + echoPhase * 5.0);
    var crossing = pow(clamp01(1.0 - abs(signA - signB)), 3.0);
    var signAcc = 0.30;
    signAcc = signAcc + signA * 0.06;
    signAcc = signAcc + signB * 0.06;
    signAcc = signAcc + crossing * (0.32 + livePulse * 0.22);
    lvl = signAcc;
    nativeShare = 0.18 + crossing * 0.55;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
