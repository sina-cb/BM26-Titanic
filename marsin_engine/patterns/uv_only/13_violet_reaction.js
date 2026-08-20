/*
  13_violet_reaction.js — "Violet Reaction"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/41_reaction_diffusion.js. Skeleton kept: two
  counter-evolving analytic wave fields stand in for the substrate/catalyst
  pair, their proximity forms a moving cellular membrane (Gray-Scott's
  crawling spots/worms without a per-cell buffer), and periodic golden-angle
  nucleus events bloom and fade like a fresh catalyst injection.
  IDENTITY (50 ft): living reaction-diffusion cells bloom and merge across
  the hull, rimmed in bright violet.

  TEXTURE: the un-swept hull rests at a 0.15-0.22 violet keep; cell bodies
  carry a 0.35-0.58 mid field; membrane rims and bloom nuclei peak at
  0.90-1.0, sparingly. PARs pulse as independent violet catalyst points.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  membrane crawl cycle (chemPhaseA) ~= 25 s at the reference point; bloom
  cadence (seed = 0.70) ~= 13 s per nucleus.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is chemPhaseA at 0.0946 x 2.0 = 0.189 cycles/s — far below
  the 10/s alias bar. Max per-frame clock jump 0.1 x 0.189 = 0.0189 against
  PHASE_WRAP 4096 — wraps safe by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — membrane
  crawl rate; direction — signed crawl direction; feed — cell frequency and
  membrane sharpness; seed — nucleus bloom cadence; rim — membrane rim
  brightness; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderSeed  <- micKick range 0.20..1.00 curve pow2   # kick drops a fresh catalyst nucleus
    # STATIC (omit from audio): localSpeed, direction, feed, rim
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var feed = 0.50;
export var seed = 0.70;
export var rim = 0.60;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderFeed(v) { feed = v; }
export function sliderSeed(v) { seed = v; }
export function sliderRim(v) { rim = v; }
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

var chemPhaseA = 0.0;
var chemPhaseB = 0.35;
var bloomPhase = 0.05;
var primaryDirection = 0.50;

var liveFeed = 0.50;
var liveRim = 0.60;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveFeed += (clamp01(feed) - liveFeed) * shapeFollow;
  liveRim += (clamp01(rim) - liveRim) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One membrane crawl cycle ~= 25 s at the reference point: 1/(25 x 0.4225) = 0.0946.
  chemPhaseA += dt * 0.0946 * speedScale * primaryDirection;
  if (chemPhaseA >= PHASE_WRAP) chemPhaseA -= PHASE_WRAP;
  if (chemPhaseA < 0.0) chemPhaseA += PHASE_WRAP;
  // Golden-ratio detuned counter-phase — its own accumulator, never scaled.
  chemPhaseB += dt * 0.0585 * speedScale;
  if (chemPhaseB >= PHASE_WRAP) chemPhaseB -= PHASE_WRAP;

  // Bloom cadence is independent of localSpeed, like the source's kick-driven
  // seed event: seed alone sets how often a fresh nucleus appears.
  var bloomMult = 0.40 + clamp01(seed) * 1.60;
  bloomPhase += dt * 0.08 * bloomMult;
  if (bloomPhase >= PHASE_WRAP) bloomPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var freq = 2.2 + liveFeed * 3.2;
  var chemA = wave(nx * freq * 1.13 + ny * freq * 0.91 - nz * freq * 0.67 + chemPhaseA);
  var chemB = wave(nz * freq * 0.53 - nx * freq * 0.79 + ny * freq * 1.31 - chemPhaseB);
  var membrane = smooth01(1.0 - abs(chemA - chemB) * (2.2 + liveFeed * 3.0));
  var cellCore = pow(membrane, 2.0 + liveFeed * 2.0);
  var rimEdge = clamp01(1.0 - abs(membrane - 0.72) * 7.0);
  rimEdge = rimEdge * rimEdge;

  var bloomCycle = bloomPhase - floor(bloomPhase);
  var bloomIndex = floor(bloomPhase);
  var ga = bloomIndex * 2.39996;
  var siteX = wave(ga);
  var siteY = wave(ga * 1.61803 + 0.37);
  var siteZ = wave(ga * 0.73205 + 0.61);
  var dxs = nx - siteX;
  var dys = ny - siteY;
  var dzs = nz - siteZ;
  var distSite = sqrt(dxs * dxs + dys * dys * 0.70 + dzs * dzs * 0.70);
  var attack = smooth01(bloomCycle * 14.0);
  var decay = pow(clamp01(1.0 - bloomCycle), 2.0 + clamp01(seed) * 3.0);
  var bloomShape = attack * decay;
  var nucleusGlow = bloomShape * clamp01(1.0 - distSite * 3.2);
  nucleusGlow = nucleusGlow * nucleusGlow;

  var keepFloor = 0.15 + ny * 0.05;
  var lvl = keepFloor;
  lvl = lvl + membrane * 0.22;
  lvl = lvl + cellCore * 0.48;
  lvl = lvl + rimEdge * (0.45 + liveRim * 0.65);
  lvl = lvl + nucleusGlow * 0.95;

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.61803;
    var parPulse = wave(chemPhaseA * 0.60 + parSeed);
    parPulse = pow(parPulse, 4.0);
    lvl = keepFloor * 0.90;
    lvl = lvl + parPulse * (0.40 + liveRim * 0.60);
    lvl = lvl + nucleusGlow * 0.60;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
