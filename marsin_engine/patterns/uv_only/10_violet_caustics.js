/*
  10_violet_caustics.js — "Violet Caustics"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/32_caustic_shimmer.js. Skeleton kept: three
  independent delta-accumulated flow phases building one interference
  field of moving caustic veins, a travelling ripple ring launched from a
  slowly wandering source, and a distinct crisp scintillation layer built
  from two crossed high-frequency fields gated to stay pointillist.
  IDENTITY (50 ft): rippling pool caustics play across the hull as crisp
  violet filaments over a deep glow.

  TEXTURE: the un-lit hull rests at a 0.15-0.20 violet keep; the caustic
  veins and ripple rings carry a 0.36-0.58 mid field; the shimmer filaments
  peak at 0.88-1.00, sparing in area.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full primary flow cycle ~= 28 s on the rig at the
  reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base):
  fastest clock is the unidirectional glint-B texture at 0.0845 x 8.31 x
  2.0 = 1.4045 cycles/s — still far below the 10/s alias bar. Max
  per-frame clock jump 0.1 x 1.4045 = 0.14045 against PHASE_WRAP 4096 —
  wraps safe by roughly four orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — flow and
  shimmer-churn rate; direction — signed primary flow direction; shimmer —
  density and brightness of the crisp violet filaments; ripple — strength
  of the expanding ring highlight; depth — caustic vein contrast; level —
  overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderShimmer <- micHigh range 0.10..1.00 curve pow2   # hats/highs create visible scintillation
    # STATIC (omit from audio): localSpeed, direction, ripple, depth
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var shimmer = 0.50;
export var ripple = 0.35;
export var depth = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  flowDirection = dv;
}
export function sliderShimmer(v) { shimmer = v; }
export function sliderRipple(v) { ripple = v; }
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

var flowA = 0.0;
var flowB = 0.0;
var flowC = 0.0;
var tiltPhase = 0.0;
var glintA = 0.0;
var glintB = 0.0;
var ripplePhase = 0.0;
var rippleLevel = 0.0;
var flowDirection = 0.50;

var liveShimmer = 0.50;
var liveRipple = 0.35;
var liveDepth = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveShimmer += (clamp01(shimmer) - liveShimmer) * lightFollow;
  liveRipple += (clamp01(ripple) - liveRipple) * shapeFollow;
  liveDepth += (clamp01(depth) - liveDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One primary flow cycle ~= 28 s at the reference point: 1/(28 x 0.4225) = 0.0845.
  flowA += dt * 0.0845 * speedScale * flowDirection;
  if (flowA >= PHASE_WRAP) flowA -= PHASE_WRAP;
  if (flowA < 0.0) flowA += PHASE_WRAP;
  // Independent unidirectional flow/texture phases; never reverse.
  flowB += dt * 0.0512 * speedScale;
  flowC += dt * 0.1154 * speedScale;
  tiltPhase += dt * 0.0155 * speedScale;
  glintA += dt * 0.4402 * speedScale;
  glintB += dt * 0.7022 * speedScale;
  ripplePhase += dt * 0.2857 * speedScale;
  if (flowB >= PHASE_WRAP) flowB -= PHASE_WRAP;
  if (flowC >= PHASE_WRAP) flowC -= PHASE_WRAP;
  if (tiltPhase >= PHASE_WRAP) tiltPhase -= PHASE_WRAP;
  if (glintA >= PHASE_WRAP) glintA -= PHASE_WRAP;
  if (glintB >= PHASE_WRAP) glintB -= PHASE_WRAP;
  if (ripplePhase >= PHASE_WRAP) ripplePhase -= PHASE_WRAP;

  var response = 5.0;
  if (liveRipple > rippleLevel) response = 18.0;
  rippleLevel = rippleLevel + (liveRipple - rippleLevel) * min(1.0, dt * response);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var w1 = wave(nx * 3.2 + ny * 0.70 - flowA);
  var w2 = wave(ny * 3.2 * 1.41421 * 0.50 - nx * 0.50 + flowB);
  var w3 = wave((nx + ny) * 3.2 * 1.61803 * 0.30 + flowC + nz * 0.31);
  var field = w1 * 0.40 + w2 * 0.35 + w3 * 0.25;
  var sharp = 1.5 + liveDepth * 4.2;
  var caustic = pow(field, sharp);

  var keep = 0.15 + 0.05 * wave(ny * 0.63 + flowB);

  var centerX = 0.50 + sin(flowA * PI2) * 0.15;
  var centerY = 0.48 + sin(flowB * PI2) * 0.10;
  var ringDist = hypot(nx - centerX, ny - centerY);
  var ring = pow(wave(ringDist * 3.4 - ripplePhase), 9.0);
  var ringLift = ring * rippleLevel * (0.45 + 0.90 * caustic);

  var tiltLF = wave(nx * 1.73205 * 0.55 + ny * 0.45 + tiltPhase);

  var glintField = wave(nx * 30.0 + ny * 17.3 + glintA)
                 * wave(ny * 30.0 * 0.91 - nx * 13.7 - glintB);
  var gate = 0.91 - liveShimmer * 0.60;
  var glint = 0.0;
  if (liveShimmer > 0.0 && glintField > gate) {
    var glintCore = (glintField - gate) / (1.0 - gate);
    glint = pow(clamp01(glintCore), 2.0) * liveShimmer * 1.65 * (0.35 + caustic * 0.65);
  }
  var sheen = pow(clamp01(caustic), 2.4) * wave(nx * 8.7 - ny * 5.3 + glintB)
            * liveShimmer * liveShimmer * 0.42;
  glint = glint + sheen;

  var lvl = keep;
  lvl = lvl + caustic * (0.34 + 0.30 * caustic) * (0.75 + tiltLF * 0.25);
  lvl = lvl + ringLift * 0.30;
  lvl = lvl + glint * 0.55;

  if (fixtureType == FIX_PAR) {
    // Organs: a steadier deep glow with a restrained, per-fixture-phased
    // glint instead of the pointillist wall shimmer (a single pixel
    // sparkling on/off would read as noise, not scintillation).
    var idPhase = fixtureId * 0.02703;
    var parGlint = smooth01(wave(idPhase + glintB * 1.3 - flowC * 0.4));
    lvl = keep * 0.90;
    lvl = lvl + caustic * (0.40 + 0.30 * caustic);
    lvl = lvl + ringLift * 0.24;
    lvl = lvl + parGlint * 0.30 * liveShimmer;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
