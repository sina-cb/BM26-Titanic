/*
  17_violet_mantas.js — "Violet Mantas"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/21_pelagic_manta_rays.js. Skeleton kept: two
  swept-wing manta silhouettes (rounded nose, concave trailing edge,
  tapering wake) glide bow-and-stern on independent irrationally related
  forward clocks, with a slow flapping wing clock layered on top.
  IDENTITY (50 ft): violet manta wings glide the length of the ship,
  flapping in slow motion.

  TEXTURE: the un-swept hull rests at a 0.15-0.20 violet keep with a faint
  current shimmer; manta wing bodies and wakes carry a 0.35-0.58 mid field;
  wing cores at full flap peak at 0.90-1.0, sparingly. PARs carry quiet
  violet current markers.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  bow-to-stern glide (swimA) ~= 35 s at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is wingPhase at 0.0960 x 2.0 = 0.192 cycles/s — far below
  the 10/s alias bar. Max per-frame clock jump 0.1 x 0.192 = 0.0192 against
  PHASE_WRAP 4096 — wraps safe by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — glide/flap
  rate; direction — signed glide direction; wingSpan — manta length and
  wing span; flap — wing flap amplitude; glide — wake trail strength;
  level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderFlap  <- micKick range 0.20..1.00 curve pow2   # kick deepens the wing flap
    # STATIC (omit from audio): localSpeed, direction, wingSpan, glide
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var wingSpan = 0.55;
export var flap = 0.50;
export var glide = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderWingSpan(v) { wingSpan = v; }
export function sliderFlap(v) { flap = v; }
export function sliderGlide(v) { glide = v; }
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

var swimA = 0.08;
var swimB = 0.57;
var wingPhase = 0.0;
var primaryDirection = 0.50;

var liveWingSpan = 0.55;
var liveFlap = 0.50;
var liveGlide = 0.55;
var liveLevel = 0.70;

function wrappedDelta(v, center) {
  var d = v - center;
  if (d > 0.5) d = d - 1.0;
  if (d < -0.5) d = d + 1.0;
  return d;
}
function softCore(distance, width) {
  var qv = 1.0 - clamp01(distance / max(0.001, width));
  return qv * qv * (3.0 - 2.0 * qv);
}
function mantaBody(forward, lateral, bodyLength, wingSpanV, flapAmt) {
  var side = lateral / max(0.001, wingSpanV);
  var sideAbs = abs(side);
  if (sideAbs >= 1.0) return 0.0;
  var lifted = side - flapAmt * sin(side * PI) * 0.72;
  sideAbs = abs(lifted);
  if (sideAbs >= 1.0) return 0.0;
  var along = forward / max(0.001, bodyLength);
  var rear = -0.22 - pow(sideAbs, 1.36) * 0.55;
  var front = 0.55 - pow(sideAbs, 1.70) * 0.22;
  if (along <= rear) return 0.0;
  if (along >= front) return 0.0;
  var rearFade = clamp01((along - rear) / 0.16);
  var frontFade = clamp01((front - along) / 0.15);
  var tipFade = clamp01((1.0 - sideAbs) / 0.12);
  var core = rearFade * frontFade * tipFade;
  return core * core * (3.0 - 2.0 * core);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveWingSpan += (clamp01(wingSpan) - liveWingSpan) * shapeFollow;
  liveFlap += (clamp01(flap) - liveFlap) * shapeFollow;
  liveGlide += (clamp01(glide) - liveGlide) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One bow-to-stern glide (swimA) ~= 35 s at the reference point: 1/(35 x 0.4225) = 0.0676.
  swimA += dt * 0.0676 * speedScale * primaryDirection;
  if (swimA >= PHASE_WRAP) swimA -= PHASE_WRAP;
  if (swimA < 0.0) swimA += PHASE_WRAP;
  swimB += dt * 0.0478 * speedScale * primaryDirection;
  if (swimB >= PHASE_WRAP) swimB -= PHASE_WRAP;
  if (swimB < 0.0) swimB += PHASE_WRAP;
  // Wing flap clock — independent, not signed by direction.
  wingPhase += dt * 0.0960 * speedScale;
  if (wingPhase >= PHASE_WRAP) wingPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var centerAX = swimA - floor(swimA);
  var centerBX = 1.0 - (swimB - floor(swimB));
  var centerAY = 0.62 + sin(swimB * PI2 * 0.7071) * 0.05;
  var centerBY = 0.34 + sin(swimA * PI2 * 0.5774 + 1.9) * 0.045;
  var bodyLength = 0.14 + liveWingSpan * 0.22;
  var wingSpanV = 0.10 + liveWingSpan * 0.20;
  var flapA = sin(wingPhase * PI2) * (0.030 + liveFlap * 0.050);
  var flapB = sin(wingPhase * PI2 * 0.7071 + 2.2) * (0.026 + liveFlap * 0.045);

  var forwardA = wrappedDelta(nx, centerAX);
  var forwardB = -wrappedDelta(nx, centerBX);
  var lateralA = ny - centerAY;
  var lateralB = ny - centerBY;
  var bodyA = mantaBody(forwardA, lateralA, bodyLength, wingSpanV, flapA);
  var bodyB = mantaBody(forwardB, lateralB, bodyLength * 0.85, wingSpanV * 0.80, flapB);

  var wakeA = 0.0;
  if (forwardA < -bodyLength * 0.10 && forwardA > -bodyLength * 1.60) {
    wakeA = softCore(abs(lateralA), wingSpanV * 0.55) * clamp01(1.0 + forwardA / (bodyLength * 1.60));
  }
  var wakeB = 0.0;
  if (forwardB < -bodyLength * 0.09 && forwardB > -bodyLength * 1.40) {
    wakeB = softCore(abs(lateralB), wingSpanV * 0.50) * clamp01(1.0 + forwardB / (bodyLength * 1.40));
  }

  var body = max(bodyA, bodyB);
  var wakes = wakeA * 0.60 + wakeB * 0.50;
  var currentShimmer = wave(nx * 0.80 - ny * 1.30 + nz * 0.60 + wingPhase * 0.05) * 0.05;

  var keep = 0.16 + (1.0 - abs(ny - 0.5)) * 0.04;
  var lvl = keep;
  lvl = lvl + currentShimmer;
  lvl = lvl + body * 0.80;
  lvl = lvl + wakes * liveGlide * 0.70;

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.5774;
    var parCurrent = wave(wingPhase * 0.40 + parSeed);
    lvl = keep * 0.90;
    lvl = lvl + parCurrent * (0.30 + liveGlide * 0.40);
    lvl = lvl + body * 0.30;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
