/*
  62_white_shimmer.js — "White Shimmer"  [WHITE ONLY family]

  Champagne / frost SHIMMER in pure white. A dim white bed with sharp white
  sparkles firing all over the rig on their own per-pixel clocks, so the
  surface glitters rather than pulses. This is the WHITE ONLY family's
  high-detail member — it supplies the true-black negative space the wash and
  the breathe deliberately do not have.

  WHY IT IS ACTUALLY WHITE — see 60_white_wash.js's header (same three
  guarantees): no colorPalette exports, neutral RGB (hue-invariant), explicit
  W lane via rgbwau().

  FIXTURE COVERAGE is model-independent (no FIX_* / sectionId branching);
  amber is emitted unconditionally and dropped by fixtures without an A
  channel.

  CORE (non-repeating) MATH — each pixel gets a fixed pseudo-random phase from
  a hash of its coordinates, and twinkles on its own clock:
      seed  = frac( sin(nx*17.31 + ny*29.77 + nz*11.13) * 43758.5453 )
      tw    = wave( shimPhase * (0.6 + seed*1.4) + seed )
      spark = pow( tw, 3 + sharpness*22 )
  The per-pixel RATE is itself a function of the seed, so the pixels are on
  mutually incommensurate clocks and the field never re-locks. A second slow
  drifting bed (bedPhase, golden-ratio offset) keeps the rig alive underneath.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Twinkle rate.
    - direction  : SECOND (project rule). Guarded sign; steers the bed drift.
    - level      : overall intensity (PRIMARY audio target).
    - kick       : kick brightness pop across the sparkles.
    - radius     : bed feature scale.
    - density    : what fraction of the rig can sparkle at once.
    - sharpness  : sparkle crispness — soft glitter to hard pinpricks.
    - whiteLevel : crossfade of the white between RGB and the W emitter.
    - whiteKick  : kick-driven W pop (blinder bite; allowed to stack).
    - warmth     : 0 neutral/cool white, 1 warm white (amber + RGB tint).

  The `hueSpread >= 0.10` bar does not apply to the WHITE ONLY family.

AUDIO_MODULATION_V1:
  sliderLevel     <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
  sliderKick      <- micKick range 0.00..1.00 curve pow2    # sparkle pop
  sliderDensity   <- micHigh range 0.25..0.95 curve linear  # how much of the rig glitters
  sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
  # STATIC (omit from audio): localSpeed, direction, radius, sharpness, whiteLevel, warmth
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.55;  // FIRST: twinkle rate
export var direction  = 1.0;   // SECOND: signed bed-drift direction
export var level      = 0.70;  // overall intensity (PRIMARY)
export var kick       = 0.0;   // kick sparkle pop (transient target)
export var radius     = 0.5;   // bed feature scale
export var density    = 0.55;  // fraction of the rig that can sparkle
export var sharpness  = 0.55;  // sparkle crispness
export var whiteLevel = 0.60;  // RGB <-> W emitter crossfade
export var whiteKick  = 0.30;  // kick-driven W pop
export var warmth     = 0.10;  // 0 neutral white -> 1 warm white

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v)      { level = v; }
export function sliderKick(v)       { kick = v; }
export function sliderRadius(v)     { radius = v; }
export function sliderDensity(v)    { density = v; }
export function sliderSharpness(v)  { sharpness = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.95;       // twinkle turns/sec at localSpeed = 1.0
var BASE_RATE = 0.10;      // the glitter never freezes
var PHASE_WRAP = 1000.0;
var OSC_WRAP = 1000.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var shimPhase = 0.0;
var bedPhase = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var levGain = 1.0;
var radScale = 0.5;
var kickBody = 0.0;
var densAmt = 0.55;
var sparkPow = 15.0;
var whiteKeep = 0.0;
var whiteBite = 0.0;
var warmAmt = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  dirOsc = dirOsc + dt * 0.0271;      // ~37 s per full turn (distinct from 60/61)
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;

  // Twinkle always advances forward (a sparkle does not run backwards); the
  // BED takes the heading so the rig's underlying glow drifts both ways.
  shimPhase = shimPhase + dt * rate;
  if (shimPhase >= PHASE_WRAP) shimPhase = shimPhase - PHASE_WRAP;
  bedPhase = bedPhase + dt * rate * 0.16180 * effDir * autoSign;
  if (bedPhase >= PHASE_WRAP) bedPhase = bedPhase - PHASE_WRAP;
  else if (bedPhase <= -PHASE_WRAP) bedPhase = bedPhase + PHASE_WRAP;

  levGain = 0.12 + 0.88 * clamp01(level);
  radScale = 0.35 + clamp01(radius) * 1.35;
  kickBody = clamp01(kick);
  densAmt = clamp01(density);
  sparkPow = 3.0 + clamp01(sharpness) * 22.0;
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  warmAmt = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Stable per-pixel hash -> phase AND rate offset, so every pixel runs its
  // own incommensurate clock.
  var hsh = sin(nx * 17.31 + ny * 29.77 + nz * 11.13) * 43758.5453;
  var seed = hsh - floor(hsh);

  var tw = wave(shimPhase * (0.6 + seed * 1.4) + seed);
  var spark = pow(tw, sparkPow);

  // density gates which pixels are allowed to sparkle at all (a second,
  // independent slice of the hash so it is uncorrelated with the phase).
  var hsh2 = sin(nx * 41.19 + ny * 7.53 + nz * 23.87) * 21313.7331;
  var gate = hsh2 - floor(hsh2);
  if (gate > densAmt) spark = spark * 0.10;

  // Slow drifting bed so the rig is never black and the shimmer sits on
  // something.
  var bed = wave(nx * 1.7 * radScale + ny * 1.1 * radScale - nz * 0.9 * radScale + bedPhase);
  bed = bed * bed * 0.22;

  var bri = (bed + spark * 0.95) * levGain * (1.0 + kickBody * 0.55);
  bri = clamp01(bri);

  // ── WHITE EMIT (see 60_white_wash.js header) ───────────────────────────────
  var rgbShare = 1.0 - 0.72 * whiteKeep;
  var wg = 1.0 - warmAmt * 0.26;
  var wb = 1.0 - warmAmt * 0.60;
  var rgbBri = bri * rgbShare;

  var wLane = bri * whiteKeep + whiteBite * spark * 0.95;
  if (wLane > 1.0) wLane = 1.0;
  // LANE MATCH (w == a): amber tracks white exactly. Bare W is cold, bare A is
  // yellow; matched W+A is the warm white the ship reads as white, and it is
  // what the LED strands already render. Warmth still shapes the RGB lanes.
  var aLane = wLane;

  rgbwau(clamp01(rgbBri), clamp01(rgbBri * wg), clamp01(rgbBri * wb),
         clamp01(wLane), clamp01(aLane), 0.0);
}
