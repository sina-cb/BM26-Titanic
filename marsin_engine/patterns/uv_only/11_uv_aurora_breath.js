/*
  11_uv_aurora_breath.js — "UV Aurora Breath"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/33_aurora_breath.js. Skeleton kept: two curved
  signed-distance sheets cross the full XYZ volume on a rotating heading,
  their independent folds ride separate travel clocks, and an autonomous
  breath clock swells/ebbs the sail separation and overall gain.
  IDENTITY (50 ft): violet aurora curtains drift high on the hull walls,
  breathing brighter and dimmer in slow waves.

  TEXTURE: the un-swept hull rests at a 0.16-0.22 violet keep; the curtain
  body carries a 0.35-0.60 mid field as it swells; fold intersections and
  the breath crest peak at 0.90-1.0, sparingly. PARs pulse as independent
  violet roots, out of phase with the wall curtain.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  heading rotation (drift) ~= 30 s at the reference point; the autonomous
  breath (breathRate = 0.5) ~= 9 s per swell/ebb, independent of localSpeed.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): the
  breath clock is independent of localSpeed and is the fastest at
  breathRate=1.0: 0.2626 x 4.0 = 1.05 cycles/s — far below the 10/s alias
  bar. Max per-frame clock jump 0.1 x 1.05 = 0.105 against PHASE_WRAP 4096 —
  wraps safe by four orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — heading/fold
  travel rate; direction — signed heading rotation; ribbons — fold count
  inside both sails; breathRate — autonomous breath cadence; breathDepth —
  sail separation and breathing width; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBreathDepth <- micFlux range 0.25..0.90 curve linear # builds widen the autonomous breath
    # STATIC (omit from audio): localSpeed, direction, ribbons, breathRate
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var ribbons = 0.55;
export var breathRate = 0.50;
export var breathDepth = 0.60;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  primaryDirection = dv;
}
export function sliderRibbons(v) { ribbons = v; }
export function sliderBreathRate(v) { breathRate = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
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

var driftPhase = 0.0;
var weavePhase = 0.35;
var breathPhase = 0.10;
var primaryDirection = 0.50;

var liveRibbons = 0.55;
var liveBreathDepth = 0.60;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveRibbons += (clamp01(ribbons) - liveRibbons) * shapeFollow;
  liveBreathDepth += (clamp01(breathDepth) - liveBreathDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One heading rotation ~= 30 s at the reference point: 1/(30 x 0.4225) = 0.0789.
  driftPhase += dt * 0.0789 * speedScale * primaryDirection;
  if (driftPhase >= PHASE_WRAP) driftPhase -= PHASE_WRAP;
  if (driftPhase < 0.0) driftPhase += PHASE_WRAP;
  // Independent fold-travel clock (sqrt2 detune) — never a scaled copy.
  weavePhase += dt * 0.1116 * speedScale;
  if (weavePhase >= PHASE_WRAP) weavePhase -= PHASE_WRAP;

  // Autonomous breath, independent of localSpeed: ~9 s per swell/ebb at
  // breathRate = 0.5 (exponential fader so the knob feels even).
  var breathMult = pow(2.0, (clamp01(breathRate) - 0.5) * 4.0);
  breathPhase += dt * 0.2626 * breathMult;
  if (breathPhase >= PHASE_WRAP) breathPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var swell = breathPhase - floor(breathPhase);
  swell = 1.0 - abs(swell - 0.5) * 2.0;
  swell = smooth01(swell);

  var cx = nx - 0.5;
  var cz = nz - 0.5;
  var heading = driftPhase * PI2;
  var hc = cos(heading);
  var hs = sin(heading);
  var sailX = cx * hc - cz * hs;
  var sailZ = cx * hs + cz * hc;
  var open = (swell - 0.5) * liveBreathDepth * 0.30;

  var ribCount = 2.0 + liveRibbons * 5.0;
  var foldA = wave(ny * ribCount + sailZ * (1.30 + liveRibbons * 1.60) - weavePhase * 3.0);
  var bendA = (foldA - 0.5) * (0.05 + liveBreathDepth * 0.07);
  var distA = abs(sailX - bendA - open);

  var foldB = wave(ny * ribCount * 1.618 - sailX * (1.10 + liveRibbons * 1.45) + driftPhase * 2.0);
  var bendB = (foldB - 0.5) * (0.05 + liveBreathDepth * 0.06);
  var distB = abs(sailZ - bendB + open);

  var sheetWidth = 0.055 + liveRibbons * 0.03;
  var sheetA = 1.0 - smooth01(distA / sheetWidth);
  var sheetB = 1.0 - smooth01(distB / sheetWidth);
  var curtain = clamp01(sheetA * (0.30 + foldA * 0.70) + sheetB * (0.30 + foldB * 0.70) * 0.90);

  // Aurora curtains drift high on the walls: bias by height.
  var heightWeight = smooth01((ny - 0.22) / 0.62);
  var body = curtain * heightWeight;
  var breathGain = 0.55 + swell * (0.25 + liveBreathDepth * 0.45);

  var keep = 0.16 + ny * 0.06;
  var lvl = keep;
  lvl = lvl + body * breathGain * 1.05;

  if (fixtureType == FIX_PAR) {
    // Organs: independent violet roots, out of phase with the wall curtain.
    var rootPhase = fixtureId * 0.61803;
    var rootPulse = wave(breathPhase * 1.30 + rootPhase);
    rootPulse = pow(rootPulse, 3.0);
    lvl = keep * 0.90;
    lvl = lvl + rootPulse * (0.55 + liveBreathDepth * 0.55);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
