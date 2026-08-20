/*
  18_uv_ink_plumes.js — "UV Ink Plumes"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/57_ink_diffuse.js. Skeleton kept: independent
  soft-edged analytic clouds wander in normalized space, each on its own
  delta-accumulated phase; here each cloud's vertical center rises
  continuously (wrap = respawn at the waterline) instead of orbiting in
  place, so the clouds read as billowing plumes rather than static blobs.
  IDENTITY (50 ft): plumes of violet ink billow up through the hull and
  slowly diffuse away.

  TEXTURE: the un-swept hull rests at a 0.15-0.19 violet keep with a faint
  water shimmer; plume bodies carry a 0.35-0.58 mid field as they rise;
  fresh plume cores near the waterline peak at 0.90-1.0, sparingly, fading
  as they climb and diffuse. PARs carry slow low-band stirring pulses.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  plume rise-and-respawn cycle (riseC, the fastest of the three) ~= 19.4 s
  at the reference point (flow = 0.5 stir baseline).
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, flow=1.0
  stir=1.4x): the fastest clock is riseC at 0.1216 x 2.0 x 1.4 = 0.340
  cycles/s — far below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.340 = 0.0340 against PHASE_WRAP 4096 — wraps safe by five orders
  of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — rise/drift
  rate; direction — signed rise direction; ink — plume core strength;
  flow — stirring speed and base water lift; diffuse — plume radius and
  edge softness; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderInk   <- micHigh range 0.20..1.00 curve linear # highs release fresh violet ink
    # STATIC (omit from audio): localSpeed, direction, flow, diffuse
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var ink = 0.60;
export var flow = 0.50;
export var diffuse = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderInk(v) { ink = v; }
export function sliderFlow(v) { flow = v; }
export function sliderDiffuse(v) { diffuse = v; }
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

var riseA = 0.0;
var riseB = 0.33;
var riseC = 0.66;
var driftPhase = 0.10;
var primaryDirection = 0.50;

var liveInk = 0.60;
var liveFlow = 0.50;
var liveDiffuse = 0.55;
var liveLevel = 0.70;

function cloudAt(px, py, pz, cx, cy, cz, rad, edgePow) {
  var dx = px - cx;
  var dy = (py - cy) * 0.80;
  var dz = pz - cz;
  var d2 = dx * dx + dy * dy + dz * dz;
  var qv = clamp01(1.0 - d2 / max(0.0001, rad * rad));
  return pow(qv, edgePow);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var stir = 0.60 + liveFlow * 0.80;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveInk += (clamp01(ink) - liveInk) * lightFollow;
  liveFlow += (clamp01(flow) - liveFlow) * shapeFollow;
  liveDiffuse += (clamp01(diffuse) - liveDiffuse) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One plume rise-and-respawn cycle ~= 22 s (riseA) at the reference point:
  // 1/(22 x 0.4225) = 0.1076. riseB and riseC carry irrational rate ratios.
  riseA += dt * 0.1076 * speedScale * primaryDirection * stir;
  if (riseA >= PHASE_WRAP) riseA -= PHASE_WRAP;
  if (riseA < 0.0) riseA += PHASE_WRAP;
  riseB += dt * 0.0936 * speedScale * primaryDirection * stir;
  if (riseB >= PHASE_WRAP) riseB -= PHASE_WRAP;
  if (riseB < 0.0) riseB += PHASE_WRAP;
  riseC += dt * 0.1216 * speedScale * primaryDirection * stir;
  if (riseC >= PHASE_WRAP) riseC -= PHASE_WRAP;
  if (riseC < 0.0) riseC += PHASE_WRAP;
  // Lateral sway — independent, not signed by direction, not stir-scaled.
  driftPhase += dt * 0.0538 * speedScale;
  if (driftPhase >= PHASE_WRAP) driftPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var cyA = riseA - floor(riseA);
  var cyB = riseB - floor(riseB);
  var cyC = riseC - floor(riseC);
  var cxA = 0.28 + 0.10 * wave(driftPhase * 0.70 + 0.10);
  var czA = 0.5 + 0.12 * wave(driftPhase * 0.50 + 0.40);
  var cxB = 0.55 + 0.10 * wave(driftPhase * 0.90 + 1.70);
  var czB = 0.5 + 0.12 * wave(driftPhase * 0.60 + 2.30);
  var cxC = 0.74 + 0.10 * wave(driftPhase * 1.10 + 3.10);
  var czC = 0.5 + 0.12 * wave(driftPhase * 0.40 + 0.90);

  var radiusBase = 0.16 + liveDiffuse * 0.30;
  var edgePow = 2.6 - liveDiffuse * 1.55;
  var radA = radiusBase * (0.55 + cyA * 0.85);
  var radB = radiusBase * (0.55 + cyB * 0.85);
  var radC = radiusBase * (0.55 + cyC * 0.85);

  var cloudA = cloudAt(nx, ny, nz, cxA, cyA, czA, radA, edgePow);
  var cloudB = cloudAt(nx, ny, nz, cxB, cyB, czB, radB, edgePow);
  var cloudC = cloudAt(nx, ny, nz, cxC, cyC, czC, radC, edgePow);

  var fadeA = clamp01(1.0 - cyA * 0.60);
  var fadeB = clamp01(1.0 - cyB * 0.60);
  var fadeC = clamp01(1.0 - cyC * 0.60);
  var cloud = cloudA * fadeA;
  cloud = cloud + cloudB * fadeB * 0.90;
  cloud = cloud + cloudC * fadeC * 0.85;
  var density = clamp01(cloud * liveInk * 3.40);

  var water = wave(nx * 0.30 + nz * 0.25 + driftPhase * 0.10) * 0.04;
  var waterLift = liveFlow * liveFlow * 0.12;
  var keep = 0.15 + water;

  var lvl = keep;
  lvl = lvl + waterLift;
  lvl = lvl + density * (0.46 + liveInk * 1.55);

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.437;
    var lowStir = wave(driftPhase * 0.60 + parSeed);
    lvl = keep * 0.90;
    lvl = lvl + liveFlow * (0.15 + lowStir * 0.35);
    lvl = lvl + density * 0.35;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
