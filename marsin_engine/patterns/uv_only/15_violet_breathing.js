/*
  15_violet_breathing.js — "Violet Breathing"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/12_breathing.js. Skeleton kept: one shared
  asymmetric breath envelope (shorter inhale, held crest, longer exhale)
  drives the whole ship's luminance from a radial center, while a static
  ribcage wave reveals structural ribbing in sync with the same breath.
  IDENTITY (50 ft): the whole ship inhales and exhales violet from its
  center, ribbed like bellows.

  TEXTURE: the un-swept hull rests at a 0.16-0.21 violet keep; the breath
  body and rib structure carry a 0.35-0.60 mid field at the inhale crest;
  the held crest near the center peaks at 0.90-1.0, sparingly. PARs breathe
  on a staggered per-fixture offset.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  inhale/exhale breath cycle ~= 16 s at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  fastest clock is breathPhase at 0.1479 x 2.0 = 0.296 cycles/s — far below
  the 10/s alias bar. Max per-frame clock jump 0.1 x 0.296 = 0.0296 against
  PHASE_WRAP 4096 — wraps safe by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — breath rate;
  direction — signed rib-texture drift; breathDepth — luminance swing;
  breathShape — broad meditation to a tight held inhale; ribbing —
  structural rib strength; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBreathDepth <- micFlux range 0.25..0.90 curve linear # builds widen the breath swing
    # STATIC (omit from audio): localSpeed, direction, breathShape, ribbing
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var breathDepth = 0.60;
export var breathShape = 0.45;
export var ribbing = 0.50;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderBreathShape(v) { breathShape = v; }
export function sliderRibbing(v) { ribbing = v; }
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
var ribPhase = 0.20;
var primaryDirection = 0.50;

var liveBreathDepth = 0.60;
var liveBreathShape = 0.45;
var liveRibbing = 0.50;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveBreathDepth += (clamp01(breathDepth) - liveBreathDepth) * shapeFollow;
  liveBreathShape += (clamp01(breathShape) - liveBreathShape) * shapeFollow;
  liveRibbing += (clamp01(ribbing) - liveRibbing) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One inhale/exhale cycle ~= 16 s at the reference point: 1/(16 x 0.4225) = 0.1479.
  breathPhase += dt * 0.1479 * speedScale;
  if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP;
  // Rib texture drift — its own accumulator, signed by direction.
  ribPhase += dt * 0.1035 * speedScale * primaryDirection;
  if (ribPhase >= PHASE_WRAP) ribPhase -= PHASE_WRAP;
  if (ribPhase < 0.0) ribPhase += PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var p = breathPhase - floor(breathPhase);
  var q = 0.0;
  var rawBreath = 0.0;
  if (p < 0.40) {
    q = p / 0.40;
    rawBreath = smooth01(q);
  } else {
    q = (p - 0.40) / 0.60;
    q = smooth01(q);
    rawBreath = 1.0 - q;
  }
  var shapedBreath = pow(rawBreath, 0.65 + liveBreathShape * 3.0);
  var depth = liveBreathDepth;
  var body = (1.0 - depth) + depth * (0.10 + shapedBreath * 0.90);

  var dxc = nx - 0.5;
  var dyc = ny - 0.5;
  var dzc = nz - 0.5;
  var centerDist = sqrt(dxc * dxc + dyc * dyc * 0.60 + dzc * dzc * 0.60);
  var radial = clamp01(1.0 - centerDist * 1.6);

  var ribWave = wave(abs(nx - 0.5) * 9.0 + ny * 2.0 + nz * 3.0 + ribPhase * 0.40);
  var ribCore = pow(ribWave, 2.0 + liveRibbing * 6.0);
  var ribs = ribCore * liveRibbing;

  var keep = 0.16 + radial * 0.05;
  var lvl = keep;
  lvl = lvl + body * 0.55;
  lvl = lvl + ribs * 0.35;
  lvl = lvl + body * radial * 0.30;

  if (fixtureType == FIX_PAR) {
    var parSeed = fixtureId * 0.618034;
    var pPhase = breathPhase + parSeed * 0.30;
    var pp = pPhase - floor(pPhase);
    var parBreath = clamp01(1.0 - abs(pp - 0.25) * 2.2);
    lvl = keep * 0.90;
    lvl = lvl + parBreath * (0.55 + liveBreathDepth * 0.55);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
