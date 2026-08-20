/*
  12_uv_rain.js — "UV Rain"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/35_sparkle_rain.js. Skeleton kept: a deterministic
  sin-hashed droplet grid travels down the normalized Y axis in crisp cells,
  each falling row crossfades into the next, and a soft waterline glow
  responds near the bottom of the hull.
  IDENTITY (50 ft): violet droplets streak down the hull walls and burst
  softly at the waterline.

  TEXTURE: the un-swept hull rests at a 0.16-0.21 violet keep; the falling
  wash and droplet halos carry a 0.35-0.58 mid field; droplet heads and the
  waterline burst peak at 0.90-1.0, sparingly. PARs echo the shower as
  slower, per-fixture drip pulses.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  droplet-row fall cycle ~= 16 s at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is churnPhase at 0.2393 x 2.0 = 0.479 cycles/s — far below
  the 10/s alias bar. Max per-frame clock jump 0.1 x 0.479 = 0.0479 against
  PHASE_WRAP 4096 — wraps safe by four orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — fall/churn
  rate; direction — signed fall direction; density — droplet activation
  count; fall — downward travel speed weighting; burst — waterline burst
  strength; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBurst <- micKick range 0.20..1.00 curve pow2   # beat launches a bright waterline burst
    # STATIC (omit from audio): localSpeed, direction, density, fall
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var density = 0.55;
export var fall = 0.60;
export var burst = 0.50;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderDensity(v) { density = v; }
export function sliderFall(v) { fall = v; }
export function sliderBurst(v) { burst = v; }
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

var fallPhase = 0.0;
var churnPhase = 0.30;
var primaryDirection = 0.50;

var liveDensity = 0.55;
var liveFall = 0.60;
var liveBurst = 0.50;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveDensity += (clamp01(density) - liveDensity) * shapeFollow;
  liveFall += (clamp01(fall) - liveFall) * shapeFollow;
  liveBurst += (clamp01(burst) - liveBurst) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One droplet-row fall cycle ~= 16 s at the reference point: 1/(16 x 0.4225) = 0.1479.
  // Fall trims the travel rate around that reference without changing period order.
  var fallMult = 0.65 + liveFall * 0.75;
  fallPhase += dt * 0.1479 * fallMult * speedScale * primaryDirection;
  if (fallPhase >= PHASE_WRAP) fallPhase -= PHASE_WRAP;
  if (fallPhase < 0.0) fallPhase += PHASE_WRAP;
  // Independent churn clock (golden-ratio detune) drives the hash wobble.
  churnPhase += dt * 0.2393 * speedScale;
  if (churnPhase >= PHASE_WRAP) churnPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var cellTravel = (ny + fallPhase) * 21.0;
  var row = floor(cellTravel);
  var cellFrac = cellTravel - row;
  var rowBlend = smooth01(cellFrac);
  var col = floor(nx * 19.0 + nz * 7.0);
  var seed = index * 12.9898 + row * 78.233 + col * 37.719;
  var seedNext = seed + 78.233;

  var hashNow = sin(seed) * sin(seed * 1.713 + 1.3) * sin(seed * 3.117 + 2.1);
  hashNow = hashNow * hashNow;
  var hashNext = sin(seedNext) * sin(seedNext * 1.713 + 1.3) * sin(seedNext * 3.117 + 2.1);
  hashNext = hashNext * hashNext;
  var candidate = hashNow + (hashNext - hashNow) * rowBlend;

  var threshold = 0.965 - liveDensity * 0.55;
  var glint = 0.0;
  if (candidate > threshold) {
    var amt = (candidate - threshold) / (1.0 - threshold + 0.0001);
    glint = pow(clamp01(amt), 0.42) * 0.85;
  }
  var dropHead = wave(cellTravel);
  dropHead = dropHead * dropHead;
  glint = glint * (0.35 + dropHead * 0.65);

  var wash = 0.5 + 0.5 * wave(nx * 1.7 + ny * 0.63 + nz * 0.41 + churnPhase * 0.20);
  var keep = 0.16 + ny * 0.04;

  var waterline = 1.0 - smooth01(ny / 0.20);
  var burstGlow = waterline * liveBurst * (0.40 + wave(fallPhase * 3.0 + nx * 5.0 + nz * 3.0) * 0.60);

  var lvl = keep;
  lvl = lvl + wash * keep * 0.55;
  lvl = lvl + glint * 0.85;
  lvl = lvl + burstGlow * 0.55;

  if (fixtureType == FIX_PAR) {
    var parPhase = fixtureId * 0.437;
    var parDrop = wave(fallPhase * 1.30 + parPhase);
    parDrop = pow(parDrop, 6.0);
    lvl = keep * 0.90;
    lvl = lvl + parDrop * (0.55 + liveDensity * 0.55);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
