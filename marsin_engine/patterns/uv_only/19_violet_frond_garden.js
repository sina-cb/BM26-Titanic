/*
  19_violet_frond_garden.js — "Violet Frond Garden"  [UV ONLY family — wave
  _313]

  DERIVED FROM: patterns/46_abyssal_fronds.js. Skeleton kept: vertical
  fronds bend in a slow shared current (a golden-angle-perturbed wave
  field), stalks hold a body glow while a height-gated tip band carries a
  brighter flicker layer — the "phosphorescent crown" identity.
  IDENTITY (50 ft): a garden of violet fronds sways along the hull, tips
  glowing brightest.

  TEXTURE: the un-swept hull rests at a 0.16-0.20 violet keep; frond stalks
  carry a 0.35-0.58 mid field; tip glow and flicker peaks reach 0.90-1.0,
  sparingly, concentrated in the upper tip band. PARs carry compact
  twinkling crowns.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  current sway cycle (currentA) ~= 19 s at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is flickerPhase at 0.2016 x 2.0 = 0.403 cycles/s — far
  below the 10/s alias bar. Max per-frame clock jump 0.1 x 0.403 = 0.0403
  against PHASE_WRAP 4096 — wraps safe by four orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — current/
  flicker rate; direction — signed current-sway direction; frondDensity —
  stalk count across the field; swayDepth — bend amplitude; tipGlow — tip
  brightness and flicker strength; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderTipGlow <- micHigh range 0.20..1.00 curve pow2   # highs ignite the tip phosphor
    # STATIC (omit from audio): localSpeed, direction, frondDensity, swayDepth
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var frondDensity = 0.55;
export var swayDepth = 0.50;
export var tipGlow = 0.60;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderFrondDensity(v) { frondDensity = v; }
export function sliderSwayDepth(v) { swayDepth = v; }
export function sliderTipGlow(v) { tipGlow = v; }
export function sliderLevel(v) { level = v; }

// ── UV AUTHORITY (uv_only family block — byte-identical across
//    patterns/uv_only/*; hash-gated by uv_only_contract.test.js) ──
// The family renders UV ONLY: violet-intensity art on the fixtures that
// physically carry a U emitter — the Hull Canvas ShehdsBars (FIX_BAR_18)
// and the Organ UkingPars (FIX_PAR). Silhouette strands, Jewelry rails and
// the TE signs have NO violet die, so those pixels are held at exact zero
// and the sim, the gallery and the playa all tell the same truth (house
// convention from patterns/65_uv_only.js). R = G = B = W = A = 0 on every
// pixel of every frame, and NO colorPalette exports — untintable by design.
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitUv(uvLevel) {
  var uLane = clamp01(uvLevel);
  if (fixtureType != FIX_BAR_18 && fixtureType != FIX_PAR) uLane = 0.0;
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, uLane);
}
// ── end UV AUTHORITY ──

var PHASE_WRAP = 4096.0;

var currentA = 0.0;
var flickerPhase = 0.20;
var primaryDirection = 0.50;

var liveFrondDensity = 0.55;
var liveSwayDepth = 0.50;
var liveTipGlow = 0.60;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveFrondDensity += (clamp01(frondDensity) - liveFrondDensity) * shapeFollow;
  liveSwayDepth += (clamp01(swayDepth) - liveSwayDepth) * shapeFollow;
  liveTipGlow += (clamp01(tipGlow) - liveTipGlow) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One current sway cycle ~= 19 s at the reference point: 1/(19 x 0.4225) = 0.1246.
  currentA += dt * 0.1246 * speedScale * primaryDirection;
  if (currentA >= PHASE_WRAP) currentA -= PHASE_WRAP;
  if (currentA < 0.0) currentA += PHASE_WRAP;
  // Tip-phosphor flicker — its own accumulator, not signed by direction.
  flickerPhase += dt * 0.2016 * speedScale;
  if (flickerPhase >= PHASE_WRAP) flickerPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var hw = clamp01(y);

  var hwRole = hw;
  if (fixtureType == FIX_PAR) hwRole = 0.70;

  var density = 4.0 + liveFrondDensity * 9.0;
  var swayAmp = 0.06 + liveSwayDepth * 0.16;

  var bend = sin(currentA * PI2 + nx * 1.618 * 7.0) * swayAmp * hwRole * hwRole;
  var swayedX = nx + bend;

  var frondPhase = swayedX * density + sin(swayedX * 11.09) * 0.13;
  var frondRaw = wave(frondPhase);
  var frond = pow(frondRaw, 2.8);

  var heightWeight = pow(hwRole, 1.15);
  var stalk = frond * 0.80 + pow(frondRaw, 2.2) * 0.18 + 0.03;
  var body = stalk * (0.25 + 0.75 * heightWeight);

  var tipBand = clamp01((hwRole - 0.40) / 0.60);
  tipBand = tipBand * tipBand;
  var flick = wave(flickerPhase + swayedX * 7.0 + hwRole * 2.0);
  flick = pow(flick, 3.0);
  var tipCore = tipBand * pow(frond, 0.70);
  var tipGlowV = tipCore * (0.05 + liveTipGlow * 1.40) * (0.65 + 0.35 * flick);

  var keep = 0.16;
  var lvl = keep;
  lvl = lvl + body * 0.55;
  lvl = lvl + tipGlowV * 0.90;

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.381966;
    var parFlick = wave(flickerPhase * 1.30 + parSeed);
    parFlick = pow(parFlick, 3.0);
    lvl = keep * 0.90;
    lvl = lvl + body * 0.40;
    lvl = lvl + parFlick * (0.30 + liveTipGlow * 0.60);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
