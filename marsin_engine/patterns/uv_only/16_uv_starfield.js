/*
  16_uv_starfield.js — "UV Starfield"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/13_sparkle.js. Skeleton kept: stable per-pixel star
  identities (index-hashed seeds) each run an independent three-act
  lifecycle — smoothstep ignition, diamond-power bloom, power-curve
  afterglow decay — over a low, ever-lit dusky field.
  IDENTITY (50 ft): violet stars twinkle in slow chorus over a dusky
  ever-lit field.

  TEXTURE: the dusky field rests at a 0.20-0.26 violet keep (never a black
  sky); active star bodies carry a 0.35-0.60 mid field through their decay;
  diamond star cores peak at 0.90-1.0, sparingly. PARs carry rarer, brighter
  single pulses.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  starPhase lifecycle-clock turn ~= 20 s at the reference point (individual
  star lifecycles run faster, scaled by their own hashed rate).
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is starPhase at 0.1183 x 2.0 = 0.237 cycles/s, and the
  fastest per-star lifecycle rate multiplier is ~1.4x that — 0.331 cycles/s,
  still far below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.331 = 0.0331 against PHASE_WRAP 4096 — wraps safe by five orders
  of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — twinkle rate;
  direction — signed twinkle-clock direction; starCount — activation
  density; brilliance — diamond-core power; afterglow — decay tail length;
  level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBrilliance <- micHigh range 0.20..1.00 curve pow2   # highs sharpen the diamond cores
    # STATIC (omit from audio): localSpeed, direction, starCount, afterglow
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var starCount = 0.50;
export var brilliance = 0.65;
export var afterglow = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderStarCount(v) { starCount = v; }
export function sliderBrilliance(v) { brilliance = v; }
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

var starPhase = 0.0;
var primaryDirection = 0.50;

var liveStarCount = 0.50;
var liveBrilliance = 0.65;
var liveAfterglow = 0.55;
var liveLevel = 0.70;

function starEnv(life, tail) {
  var attackWidth = 0.05;
  if (life < attackWidth) return smooth01(life / attackWidth);
  var decayT = 1.0 - (life - attackWidth) / (1.0 - attackWidth);
  decayT = smooth01(decayT);
  var power = 4.5 - tail * 3.8;
  return pow(decayT, power);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveStarCount += (clamp01(starCount) - liveStarCount) * shapeFollow;
  liveAfterglow += (clamp01(afterglow) - liveAfterglow) * shapeFollow;
  liveBrilliance += (clamp01(brilliance) - liveBrilliance) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One starPhase turn ~= 20 s at the reference point: 1/(20 x 0.4225) = 0.1183.
  starPhase += dt * 0.1183 * speedScale * primaryDirection;
  if (starPhase >= PHASE_WRAP) starPhase -= PHASE_WRAP;
  if (starPhase < 0.0) starPhase += PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var seedA = wave(index * 0.618034 + nx * 3.17 + ny * 5.31 + nz * 7.13);
  var seedB = wave(index * 0.414214 + nx * 7.19 - ny * 2.71 + nz * 5.17);
  var seedC = wave(index * 0.732051 - nx * 4.11 + ny * 6.23 + nz * 3.07);

  var threshold = clamp01(0.02 + liveStarCount * liveStarCount * 0.30);
  var selectedA = 0.0;
  if (seedA < threshold) selectedA = 1.0;
  var selectedB = 0.0;
  if (seedB < threshold * 0.50) selectedB = 1.0;

  var rateA = 0.55 + seedB * 0.85;
  var lifeA = starPhase * rateA + seedC;
  lifeA = lifeA - floor(lifeA);
  var rateB = 0.40 + seedC * 0.65;
  var lifeB = starPhase * rateB + seedA * 0.70;
  lifeB = lifeB - floor(lifeB);

  var envA = starEnv(lifeA, liveAfterglow) * selectedA;
  var envB = starEnv(lifeB, liveAfterglow * 0.85) * selectedB;
  var diamondA = pow(envA, 1.0 + liveBrilliance * 4.0);
  var diamondB = pow(envB, 1.3 + liveBrilliance * 3.2);
  var stars = max(envA * 0.40 + diamondA * 0.70, envB * 0.30 + diamondB * 0.55);

  var field = 0.20 + 0.06 * wave(nx * 0.40 + ny * 0.30 + nz * 0.20 + starPhase * 0.05);

  var lvl = field;
  lvl = lvl + stars * (0.55 + liveBrilliance * 0.55);

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.381966;
    var parLife = starPhase * (0.60 + parSeed * 0.30) + parSeed;
    parLife = parLife - floor(parLife);
    var parEnv = starEnv(parLife, liveAfterglow);
    var parStar = pow(parEnv, 1.2 + liveBrilliance * 3.0);
    lvl = field * 0.90;
    lvl = lvl + parStar * (0.60 + liveBrilliance * 0.60);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
