/*
  02_moon_breath.js — "Moon Breath"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/12_breathing.js. Skeleton kept: one shared
  asymmetric breath envelope (short inhale, held crest, longer exhale)
  drives the whole rig; a static ribcage structure brightens with the same
  breath; a five-axis quasicrystal field (halo/core/node layers) is
  multiplicatively revealed only as the ship exhales.
  IDENTITY (50 ft): the whole ship inhales and exhales moonlight, bloom
  cresting to crisp white at full breath.

  TEXTURE: the exhale trough rests at a 0.08 shadow; the shared breath body
  and ribcage carry the 0.28-0.50 mid body; the full-inhale crest and the
  quasicrystal core/node layer carry 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  breath (inhale+exhale) ~= 8 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the breath clock at
  0.296 x 8 = 2.37 cycles/s, well below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.296 x 2.0 = 0.059 against PHASE_WRAP 4096 — wraps safe
  by 4+ orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — breath rate;
  breathDepth — luminance swing of the inhale/exhale; ribbing — static
  ribcage structure strength; fieldDetail — quasicrystal complexity; level —
  overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var breathDepth = 0.55;
export var ribbing = 0.45;
export var fieldDetail = 0.65;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderRibbing(v) { ribbing = v; }
export function sliderFieldDetail(v) { fieldDetail = v; }
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
var BREATH_BASE = 0.296;
var FIELD_BASE = 0.059;

var breathPhase = 0.0;
var fieldPhase = 0.0;

var liveDepth = 0.55;
var liveRibbing = 0.45;
var liveDetail = 0.65;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  liveDepth += (clamp01(breathDepth) - liveDepth) * lightFollow;
  liveRibbing += (clamp01(ribbing) - liveRibbing) * lightFollow;
  liveDetail += (clamp01(fieldDetail) - liveDetail) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full breath ~= 8 s at the reference point: 1/(0.296 x 0.4225) ~= 8.0 s.
  breathPhase += dt * BREATH_BASE * speedScale;
  fieldPhase += dt * FIELD_BASE * speedScale;
  if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP;
  if (fieldPhase >= PHASE_WRAP) fieldPhase -= PHASE_WRAP;
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

  // One frame-global asymmetric envelope: short inhale, held crest, longer
  // exhale. Coordinates never enter this phase.
  var p = breathPhase - floor(breathPhase);
  var q = 0.0;
  var rawBreath = 0.0;
  if (p < 0.40) {
    q = p / 0.40;
    rawBreath = q * q * (3.0 - 2.0 * q);
  } else {
    q = (p - 0.40) / 0.60;
    q = q * q * (3.0 - 2.0 * q);
    rawBreath = 1.0 - q;
  }
  var shapedBreath = pow(rawBreath, 0.95);
  var depth = liveDepth;
  var breathBody = (1.0 - depth) + depth * (0.08 + shapedBreath * 0.92);
  var breathCrest = pow(shapedBreath, 3.2);

  // Static symmetric ribcage structure; it brightens/dims with the exact
  // same global breath and never travels.
  var centerX = abs(nx - 0.5);
  var ribWave = wave(centerX * 9.0 + ny * 2.0 + nz * 3.0);
  var ribCore = pow(ribWave, 2.0 + liveRibbing * 7.0);
  var ribs = ribCore * liveRibbing;

  // Five incommensurate axes form a 3D quasicrystal beneath the breath.
  var detail = liveDetail;
  var fieldFreq = 2.4 + detail * 5.6;
  var q0 = wave((nx + ny * 0.19 + nz * 0.31) * fieldFreq + fieldPhase);
  var q1 = wave((nx * 0.309 + ny * 0.951 - nz * 0.47) * fieldFreq
    - fieldPhase * 0.618);
  var q2 = wave((nx * -0.809 + ny * 0.588 + nz * 0.73) * fieldFreq
    + fieldPhase * 0.414);
  var q3 = wave((nx * -0.809 - ny * 0.588 - nz * 0.27) * fieldFreq
    - fieldPhase * 0.732);
  var q4 = wave((nx * 0.309 - ny * 0.951 + nz * 0.61) * fieldFreq
    + fieldPhase * 0.271);
  var quasiAcc = q0;
  quasiAcc = quasiAcc + q1;
  quasiAcc = quasiAcc + q2;
  quasiAcc = quasiAcc + q3;
  quasiAcc = quasiAcc + q4;
  var quasi = quasiAcc * 0.20;

  var ridgeHalo = 1.0 - clamp01(abs(quasi - 0.50) * (3.0 + detail * 5.0));
  var ridgeCore = pow(ridgeHalo, 1.7 + detail * 3.0);
  var crossHalo = 1.0 - clamp01(abs(q0 - q3) * (1.9 + detail * 3.7));
  var crossCore = pow(crossHalo, 1.8 + detail * 2.8);
  var cellSeed = pow(clamp01(q1 * q2 * 1.28), 1.15 + detail * 2.0);
  var intersection = clamp01(ridgeCore * crossCore * 2.0);
  var fieldNode = pow(clamp01(intersection * 0.95 + cellSeed * 0.55 - 0.17),
    1.15 + detail * 1.6);
  var fieldHaloAcc = ridgeHalo * 0.58;
  fieldHaloAcc = fieldHaloAcc + crossHalo * 0.36;
  fieldHaloAcc = fieldHaloAcc + cellSeed * 0.28 - 0.24;
  var fieldHalo = clamp01(fieldHaloAcc);
  var fieldCoreAcc = ridgeCore * 0.82;
  fieldCoreAcc = fieldCoreAcc + crossCore * 0.45;
  fieldCoreAcc = fieldCoreAcc + intersection * 0.48 - 0.34;
  var fieldCore = clamp01(fieldCoreAcc);

  // A slow broad gate chooses where the quasicrystal is allowed to live, and
  // only reveals it as the ship exhales, so the field never washes the whole
  // model flat during inhale.
  var regionWave = wave(nx * 1.37 - ny * 2.11 + nz * 1.73 + fieldPhase * 0.37);
  var regionGate = clamp01((regionWave - 0.23) * 1.85);
  fieldHalo = fieldHalo * regionGate;
  fieldCore = fieldCore * regionGate;
  fieldNode = fieldNode * regionGate;
  var exhaleWeight = pow(1.0 - shapedBreath, 1.20);

  var shadow = 0.08;
  var midAcc = breathBody * (0.28 + ribs * 0.22);
  midAcc = midAcc + fieldHalo * exhaleWeight * 0.18;
  var peakAcc = breathCrest * 0.95;
  peakAcc = peakAcc + fieldCore * exhaleWeight * 0.90;
  peakAcc = peakAcc + fieldNode * exhaleWeight * 0.85;

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.16 + breathCrest * 0.60 + fieldNode * 0.45;

  if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: crisp pulsing "lungs" — a decisive white kick synced to the
    // shared breath, with a strong native-white share.
    var lungAcc = 0.06 + shapedBreath * 0.68;
    lungAcc = lungAcc + breathCrest * 0.65;
    lvl = lungAcc;
    nativeShare = 0.35 + breathCrest * 0.60;
  } else if (isSign) {
    // Identity: three smooth XYZ contours interfere into moving ribbons and
    // nodes over a firm readable floor; the shared inhale/exhale remains the
    // dominant luminance arc.
    var signAxisA = wave(nx * 1.61803 + ny * 2.39996 + nz * 1.41421
      + pixelLocalIndex * 0.013 + fieldPhase * 2.0);
    var signAxisB = wave(nx * 2.39996 - ny * 1.41421 + nz * 1.73205
      - pixelLocalIndex * 0.008 - fieldPhase * 3.0);
    var signRibbon = 1.0 - clamp01(abs(signAxisA - signAxisB) * 2.35);
    signRibbon = signRibbon * signRibbon * (3.0 - 2.0 * signRibbon);
    var signAcc = 0.30;
    signAcc = signAcc + shapedBreath * 0.30;
    signAcc = signAcc + signRibbon * 0.22;
    lvl = signAcc;
    nativeShare = 0.20 + breathCrest * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
