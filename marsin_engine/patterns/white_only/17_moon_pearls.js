/*
  17_moon_pearls.js — "Moon Pearls"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/03_pearl_chain.js. Skeleton kept: one
  world-space necklace parameter joins Silhouette strands and Vintage rails;
  finite analytic bead slots (3-7) carry pearl cores while a slow focus rolls
  along the chain; the Hull stays a low folded-velvet field.
  IDENTITY (50 ft): a necklace of brilliant white pearls rings the ship, a
  slow moonbeam rolling bead to bead over gray velvet.

  TEXTURE: hull velvet rests at 0.14-0.30 low body; the connective thread and
  pearl halos carry the 0.35-0.55 mid; pearl cores under the focus reach
  0.9-1.0 with a heavy native-white share.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the focus
  crosses the necklace in ~14 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the focus at
  0.170 x 8 = 1.36 cycles/s — far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.170 x 2.0 = 0.034 against PHASE_WRAP 4096 — wraps safe.
  CONTROLS (declaration order = MFT knob order): localSpeed — focus and
  velvet pace; direction — signed focus travel direction; pearlCount — three
  to seven beads; pearlSize — bead core width; linkGlow — connective thread
  brightness; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var pearlCount = 0.48;
export var pearlSize = 0.36;
export var linkGlow = 0.45;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  focusDirection = dv;
}
export function sliderPearlCount(v) { pearlCount = v; }
export function sliderPearlSize(v) { pearlSize = v; }
export function sliderLinkGlow(v) { linkGlow = v; }
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
var focusPhase = 0.0;
var velvetPhase = 0.0;
var focusDirection = 0.50;

var liveCount = 6.0;
var liveSize = 0.045;
var liveLink = 0.45;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  // Focus crosses the necklace in ~14 s at the reference point:
  // 1/(14 x 0.4225) ~= 0.170.
  focusPhase += dt * 0.170 * speedScale * focusDirection;
  velvetPhase += dt * 0.074 * 1.41421356 * speedScale;
  if (focusPhase >= PHASE_WRAP) focusPhase -= PHASE_WRAP;
  if (focusPhase < 0.0) focusPhase += PHASE_WRAP;
  if (velvetPhase >= PHASE_WRAP) velvetPhase -= PHASE_WRAP;

  var editFollow = min(1.0, dt * 5.0);
  liveCount = 3.0 + floor(clamp01(pearlCount) * 4.999);
  var targetSize = 0.022 + clamp01(pearlSize) * clamp01(pearlSize) * 0.180;
  liveSize += (targetSize - liveSize) * editFollow;
  liveLink += (clamp01(linkGlow) - liveLink) * editFollow;
  liveLevel += (clamp01(level) - liveLevel) * editFollow;
}

export function render3D(index, x, y, z) {
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isBar = fixtureType == FIX_BAR_18;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  // One world-space parameter joins every strand and rail into one necklace
  // (source skeleton). Signs fold both fixtures onto one authored map.
  var localU = clamp01(x * 0.54 + z * 0.31 + y * 0.15);
  var signY = 0.0;
  if (isSign) {
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    signY = floor(signIndex / 10.0) / 7.0;
    localU = clamp01(signX * 0.78 + signY * 0.22);
  }
  var focusPos = wave(focusPhase);
  var focusSweep = smooth01(1.0 - abs(localU - focusPos) / 0.22);

  // Nearest finite bead, analytic — 3..7 ordered centers, no loop.
  var beadCoordinate = localU * liveCount;
  var beadSlot = floor(beadCoordinate);
  if (beadSlot >= liveCount) beadSlot = liveCount - 1.0;
  var beadCenter = (beadSlot + 0.5) / liveCount;
  var beadDistance = abs(localU - beadCenter);
  var beadShape = smooth01(1.0 - beadDistance / liveSize);
  var beadHalo = smooth01(1.0 - beadDistance / (liveSize * 2.40 + 0.012));
  var focusDistance = abs(beadCenter - focusPos);
  var focusWindow = smooth01(1.0 - focusDistance / 0.34);
  var focusGain = 0.42 + focusWindow * 0.78;
  var pearlCore = beadShape * focusGain;
  var pearlHalo = beadHalo * (0.42 + focusGain * 0.58);

  // The connective thread: continuous, dimmer than the cores by design.
  var textureZ = z;
  if (isSign) textureZ = signY;
  var threadTexture = 0.68 + 0.32 * wave(localU * liveCount * 0.61803399
                                         - focusPhase * 0.53
                                         + textureZ * 0.17);
  var thread = liveLink * (0.12 + threadTexture * 0.30);

  var lvl = 0.10;
  var nativeShare = 0.18;

  if (isRaw) {
    // Silhouette carries the necklace whole: thread, halos and cores.
    lvl = 0.16 + thread;
    lvl = lvl + pearlHalo * 0.22;
    lvl = lvl + pearlCore * 0.62;
    nativeShare = 0.20 + pearlCore * 0.60;
  } else if (isVintage) {
    // Jewelry is the hero: brilliant native-white pearl cores on the rails.
    lvl = 0.12 + thread * 0.5;
    lvl = lvl + pearlHalo * 0.20;
    lvl = lvl + pearlCore * 0.75;
    nativeShare = 0.30 + pearlCore * 0.70;
  } else if (isSign) {
    // Identity: broad pearl-chain window over a firm letterform floor.
    var signField = wave(localU * 1.618 + signY * 1.414 + velvetPhase * 0.73)
                  * wave(localU * 2.236 - signY * 1.732 - velvetPhase * 0.41);
    lvl = 0.28 + thread * 0.4;
    lvl = lvl + signField * 0.10;
    lvl = lvl + pearlHalo * 0.12;
    lvl = lvl + pearlCore * 0.30;
    lvl = lvl + focusSweep * 0.16;
    nativeShare = 0.22 + pearlCore * 0.45;
  } else if (isBar) {
    // Hull velvet: three incommensurate folds, low gray body, focus-lifted.
    var foldA = wave(x * 1.31 + y * 0.73 + velvetPhase);
    var foldB = wave(z * 1.73 - x * 0.41 - velvetPhase * 0.61803399);
    var foldC = wave((x + z) * 0.57 + y * 1.19 + velvetPhase * 1.41421356);
    var velvet = foldA * foldB * 0.62 + foldC * 0.38;
    lvl = 0.13 + velvet * 0.17;
    lvl = lvl + focusSweep * 0.28;
    nativeShare = 0.14 + focusSweep * 0.20;
  } else if (isPar) {
    // Organs breathe quietly under the chain.
    var organBreath = wave(velvetPhase * 0.61803399 + x * 0.19 + z * 0.23);
    lvl = 0.14 + organBreath * 0.16;
    lvl = lvl + focusSweep * 0.30;
    nativeShare = 0.16 + focusSweep * 0.25;
  } else {
    lvl = 0.14 + thread;
    lvl = lvl + pearlCore * 0.55;
    nativeShare = 0.18 + pearlCore * 0.50;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
