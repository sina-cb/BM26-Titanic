/*
  03_violet_maelstrom.js — "Violet Maelstrom"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/127_grand_maelstrom.js. Skeleton kept: one
  continuous polar flow field in normalized XZ, two/three broad filled arms
  curling radially and climbing through Y, a wandering calm eye that tours
  the vessel instead of pinning to a fixed center, and a smooth blend
  between arm counts so live edits never jump.
  IDENTITY (50 ft): spiral violet arms wind around the ship and pull inward
  like a slow whirlpool, the calm eye drifting through the hull.

  TEXTURE: the un-swept water rests at a 0.15-0.23 violet keep; the arm
  bodies carry a 0.36-0.58 mid field; the eye core and arm crests peak at
  0.86-1.00. The un-arm'd water between arms stays present, never black.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full vortex rotation ~= 32 s on the rig at the reference
  point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the vortex at 0.07396 x 2.0 x
  1.0 = 0.1479 cycles/s — far below the 10/s alias bar. Max per-frame clock
  jump 0.1 x 0.1479 = 0.01479 against PHASE_WRAP 4096 — wraps safe by five
  orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — vortex rate;
  direction — signed vortex spin direction; armWidth — filled angular area
  of each arm; armCount — smooth blend between two and three arms; depth —
  radial curl, vertical climb and eye pull strength; level — overall UV
  intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderDepth <- micFlux range 0.20..0.88 curve linear # builds deepen the pull and climb
    # STATIC (omit from audio): localSpeed, direction, armWidth, armCount
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var armWidth = 0.55;
export var armCount = 0.35;
export var depth = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  vortexDirection = dv;
}
export function sliderArmWidth(v) { armWidth = v; }
export function sliderArmCount(v) { armCount = v; }
export function sliderDepth(v) { depth = v; }
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

var vortexPhase = 0.0;
var undertowPhase = 0.0;
var vortexDirection = 0.50;

var liveArmWidth = 0.55;
var liveArmCount = 0.35;
var liveDepth = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveArmWidth += (clamp01(armWidth) - liveArmWidth) * shapeFollow;
  liveArmCount += (clamp01(armCount) - liveArmCount) * shapeFollow;
  liveDepth += (clamp01(depth) - liveDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One vortex turn ~= 32 s at the reference point: 1/(32 x 0.4225) = 0.07396.
  vortexPhase += dt * 0.07396 * speedScale * vortexDirection;
  if (vortexPhase >= PHASE_WRAP) vortexPhase -= PHASE_WRAP;
  if (vortexPhase < 0.0) vortexPhase += PHASE_WRAP;
  // Independent unidirectional eye-wander phase; never reverses with
  // direction so the calm eye keeps touring even at full reverse spin.
  undertowPhase += dt * 0.04570 * speedScale;
  if (undertowPhase >= PHASE_WRAP) undertowPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var centerX = 0.5 + sin(undertowPhase * PI2 * 1.41421356) * 0.14;
  var centerZ = 0.5 + cos(undertowPhase * PI2 * 1.73205081) * 0.12;
  var dx = nx - centerX;
  var dz = nz - centerZ;
  var radius = sqrt(dx * dx + dz * dz);
  var angle = atan2(dz, dx) / PI2;

  var depthAmount = liveDepth;
  var radialCurl2 = radius * (1.30 + depthAmount * 1.35);
  var radialCurl3 = radius * (1.65 + depthAmount * 1.55);
  var verticalClimb2 = ny * (0.34 + depthAmount * 0.92);
  var verticalClimb3 = ny * (0.48 + depthAmount * 1.12);
  var phase2 = angle * 2.0 - radialCurl2 + verticalClimb2 - vortexPhase;
  var phase3 = angle * 3.0 - radialCurl3 + verticalClimb3 - vortexPhase;
  var armTwo = wave(phase2);
  var armThree = wave(phase3);
  var countMix = smooth01(liveArmCount);
  var armField = armTwo + (armThree - armTwo) * countMix;

  var width = 0.32 + liveArmWidth * 0.60;
  var arm = smooth01((armField - (1.0 - width)) / width);
  arm = pow(arm, 0.60 + (1.0 - liveArmWidth) * 0.85);

  var eyeRadius = 0.085 + depthAmount * 0.085;
  var eye = smooth01(1.0 - radius / eyeRadius);
  var eyePull = eye * (0.40 + arm * 0.55);

  var radiusFall = smooth01(radius / 0.60);
  var keep = 0.15 + (1.0 - radiusFall) * 0.06;
  var lvl = keep;
  lvl = lvl + arm * (0.34 + 0.28 * arm);
  lvl = lvl + eyePull * (0.36 + depthAmount * 0.34);

  if (fixtureType == FIX_PAR) {
    // Organs: a slower fixed-phase echo of the arm sweep, distinct from the
    // wall wash and never quite in lockstep with it.
    var station = fixtureId * 0.05827 - floor(fixtureId * 0.05827);
    var echo = wave(station * 3.0 - vortexPhase * 0.83 + verticalClimb2 * 0.4);
    echo = smooth01(echo);
    lvl = keep * 0.88;
    lvl = lvl + echo * (0.30 + arm * 0.30) + eyePull * 0.20;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
