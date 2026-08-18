/*
  05_breathing_violet_horizon.js — "Breathing Violet Horizon"  [UV ONLY
  family — wave _313]

  DERIVED FROM: patterns/122_breathing_horizon.js. Skeleton kept: one
  delta-accumulated breath phase drives a broad horizontal plane rising and
  settling through normalized Y with zero velocity at both reversals, a
  small Z/X perspective bow keeps the plane readable in 3D, and a symmetric
  afterglow spreads above and below the luminous core.
  IDENTITY (50 ft): a breathing violet horizon band rises and settles
  across the ship, exhaling afterglow with every breath.

  TEXTURE: the un-lit hull rests at a 0.15-0.21 violet keep; the afterglow
  spread carries a 0.35-0.58 mid field; the horizon core peaks at
  0.88-1.00. The reversal points never dip toward black.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full breath cycle ~= 16 s on the rig at the reference
  point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the breath at 0.1479 x 2.0 x
  1.0 = 0.2958 cycles/s — far below the 10/s alias bar. Max per-frame clock
  jump 0.1 x 0.2958 = 0.02958 against PHASE_WRAP 4096 — wraps safe by five
  orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — breath rate;
  direction — signed breath direction; horizonWidth — thickness of the
  luminous core; breathDepth — vertical travel distance; afterglow — reach
  and energy of the symmetric spread; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBreathDepth <- micFlux range 0.20..0.88 curve linear # builds enlarge vertical travel
    # STATIC (omit from audio): localSpeed, direction, horizonWidth, afterglow
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var horizonWidth = 0.50;
export var breathDepth = 0.50;
export var afterglow = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  breathDirection = dv;
}
export function sliderHorizonWidth(v) { horizonWidth = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderAfterglow(v) { afterglow = v; }
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

var breathPhase = 0.0;
var breathDirection = 0.50;

var liveHorizonWidth = 0.50;
var liveBreathDepth = 0.50;
var liveAfterglow = 0.55;
var liveLevel = 0.70;

var resolvedTravel = 0.19;
var resolvedWidth = 0.16;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveHorizonWidth += (clamp01(horizonWidth) - liveHorizonWidth) * shapeFollow;
  liveBreathDepth += (clamp01(breathDepth) - liveBreathDepth) * shapeFollow;
  liveAfterglow += (clamp01(afterglow) - liveAfterglow) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full breath ~= 16 s at the reference point: 1/(16 x 0.4225) = 0.1479.
  breathPhase += dt * 0.1479 * speedScale * breathDirection;
  if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP;
  if (breathPhase < 0.0) breathPhase += PHASE_WRAP;

  resolvedTravel = liveBreathDepth * 0.38;
  resolvedWidth = 0.045 + liveHorizonWidth * 0.235;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var breath = sin(breathPhase * PI2);
  var horizonY = 0.50 + breath * resolvedTravel;
  var planeY = horizonY + (nz - 0.5) * 0.025 + (nx - 0.5) * 0.008;
  var verticalDistance = abs(ny - planeY);
  var core = smooth01(1.0 - verticalDistance / resolvedWidth);
  core = pow(core, 1.55);

  var tailStart = resolvedWidth * 0.42;
  var tailDistance = max(0.0, verticalDistance - tailStart);
  var tailReach = resolvedWidth * (1.20 + liveAfterglow * 3.80);
  var tail = smooth01(1.0 - tailDistance / tailReach) * liveAfterglow * (1.0 - core) * 0.62;

  var keep = 0.15 + 0.05 * wave(nx * 0.37 + nz * 0.23);
  var lvl = keep;
  lvl = lvl + core * (0.40 + 0.34 * core);
  lvl = lvl + tail * 0.30;

  if (fixtureType == FIX_PAR) {
    // Organs: each par exhales on its own slightly offset breath, so the
    // procession of point sources never locks to the wall horizon.
    var parPhase = breathPhase + fixtureId * 0.0131;
    var parBreath = sin(parPhase * PI2);
    var parY = 0.50 + parBreath * resolvedTravel;
    var parDist = abs(ny - parY);
    var parCore = smooth01(1.0 - parDist / (resolvedWidth * 1.35));
    parCore = pow(parCore, 1.4);
    lvl = keep * 0.88;
    lvl = lvl + parCore * (0.42 + 0.36 * parCore);
    lvl = lvl + tail * 0.18;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
