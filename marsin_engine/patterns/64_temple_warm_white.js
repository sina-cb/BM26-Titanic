/*
  64_temple_warm_white.js — "Temple Warm White"  [WHITE ONLY family]

  The reverent one. A DIM, slow, candle-warm white that drifts across the rig
  like light through dust. Built for Temple night: no strobe, no snap, no
  colour, a hard operator-set brightness `ceiling`, and an audio response that
  is deliberately shallow — this pattern must not react like a party.

  It is also the family's "first class / vintage" white: at high `warmth` the
  amber emitter carries most of the body, which is what makes the pars and
  bars read tungsten rather than LED-white.

  WHY IT IS ACTUALLY WHITE — see 60_white_wash.js's header (same three
  guarantees): no colorPalette exports, neutral RGB scaled by a warm tint
  (still hue-stable and never a saturated colour), explicit W lane via
  rgbwau(). At warmth = 1 the RGB lanes sit at R:1.00 G:0.68 B:0.32 — a
  tungsten white, not an orange.

  FIXTURE COVERAGE is model-independent (no FIX_* / sectionId branching).
  Amber is emitted unconditionally; RGBW and RGB-only fixtures drop it and get
  their warmth from the RGB tint instead, so the whole rig stays one colour
  temperature.

  CORE (non-repeating) MATH — three very slow incommensurate drifts summed
  into one soft field:
      v     = nx*1.15*R + ny*0.80*R*0.61803 - nz*0.95*R*0.41421 + driftA
      field = wave(v)*0.55 + wave(v*1.41421 + driftB)*0.30 + wave(driftC)*0.15
  driftA : driftB : driftC advance at 1 : 0.61803 : 0.28347, so the light
  never settles into a repeating cycle. Everything is slow by construction:
  MAX_RATE is a fifth of the wash pattern's.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Drift rate (slow even at 1.0).
    - direction  : SECOND (project rule). Guarded sign, never 0.
    - level      : overall intensity (PRIMARY audio target, shallow range).
    - kick       : kick lift — SMALL by design; a temple does not thump.
    - radius     : drift feature scale.
    - ceiling    : HARD brightness cap (0..1). The reverence knob — set it low
                   and nothing downstream in this pattern can exceed it.
    - warmth     : colour temperature. Default HIGH (candle warm).
    - whiteLevel : crossfade of the white between RGB and the W emitter.
    - whiteKick  : kick-driven W lift. Default LOW; there is no blinder here.

  The `hueSpread >= 0.10` bar does not apply to the WHITE ONLY family. The
  "peakMaxChan >= 200" bar is also deliberately NOT met at the shipped
  defaults — `ceiling` exists precisely to keep this pattern dim. Raise
  `ceiling` to 1.0 and it clears the bar; that is the operator's call.

AUDIO_MODULATION_V1:
  sliderLevel <- micLow  range 0.35..0.80 curve linear  # shallow intensity (PRIMARY)
  sliderKick  <- micKick range 0.00..0.45 curve pow2    # gentle lift only
  # STATIC (omit from audio): localSpeed, direction, radius, ceiling, warmth,
  #                           whiteLevel, whiteKick
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.25;  // FIRST: drift rate (slow)
export var direction  = 1.0;   // SECOND: signed drift direction (-1..1 stored)
export var level      = 0.55;  // overall intensity (PRIMARY)
export var kick       = 0.0;   // gentle kick lift (transient target)
export var radius     = 0.45;  // drift feature scale
export var ceiling    = 0.45;  // HARD brightness cap — the reverence knob
export var warmth     = 0.85;  // colour temperature: candle warm
export var whiteLevel = 0.70;  // RGB <-> W emitter crossfade
export var whiteKick  = 0.06;  // kick-driven W lift (deliberately tiny)

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
export function sliderCeiling(v)    { ceiling = v; }
export function sliderWarmth(v)     { warmth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.11;       // drift turns/sec at localSpeed = 1.0 (a fifth of 60's)
var BASE_RATE = 0.015;     // still breathing at localSpeed = 0
var PHASE_WRAP = 1000.0;
var OSC_WRAP = 1000.0;
var MIN_CEILING = 0.06;    // even at ceiling 0 the temple is not black

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var driftA = 0.0;
var driftB = 0.0;
var driftC = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var slowLift = 0.0;      // the third, whole-rig drift term (resolved per frame)
var levGain = 1.0;
var radScale = 0.45;
var capAmt = 0.45;
var kickBody = 0.0;
var whiteKeep = 0.0;
var whiteBite = 0.0;
var warmAmt = 0.85;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  dirOsc = dirOsc + dt * 0.0089;      // ~112 s per full turn — the slowest of the family
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;
  var signedRate = rate * effDir * autoSign;

  driftA = driftA + dt * signedRate;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  driftB = driftB + dt * signedRate * 0.61803;
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;
  driftC = driftC + dt * rate * 0.28347;          // always forward, whole-rig swell
  if (driftC >= PHASE_WRAP) driftC = driftC - PHASE_WRAP;
  slowLift = wave(driftC);

  levGain = 0.25 + 0.75 * clamp01(level);
  radScale = 0.25 + clamp01(radius) * 0.95;
  capAmt = MIN_CEILING + (1.0 - MIN_CEILING) * clamp01(ceiling);
  kickBody = clamp01(kick);
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  warmAmt = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var v = nx * 1.15 * radScale
        + ny * 0.80 * radScale * 0.61803
        - nz * 0.95 * radScale * 0.41421
        + driftA;
  var field = wave(v) * 0.55
            + wave(v * 1.41421 + driftB) * 0.30
            + slowLift * 0.15;

  // Soft, never harsh: a gentle curve plus a warm floor so the rig glows
  // rather than pulsing.
  var shaped = 0.32 + 0.68 * (field * field);

  var bri = shaped * levGain * (1.0 + kickBody * 0.18);
  // HARD CAP — nothing above this leaves the pattern.
  bri = clamp01(bri) * capAmt;

  // ── WHITE EMIT (see 60_white_wash.js header) ───────────────────────────────
  var rgbShare = 1.0 - 0.72 * whiteKeep;
  var wg = 1.0 - warmAmt * 0.32;      // deeper warm tint than the cool members
  var wb = 1.0 - warmAmt * 0.68;
  var rgbBri = bri * rgbShare;

  var wLane = bri * whiteKeep + whiteBite * bri * 0.5;
  if (wLane > capAmt) wLane = capAmt;   // the ceiling binds the W emitter too
  // LANE MATCH (w == a): amber tracks white exactly. Bare W is cold, bare A is
  // yellow; matched W+A is the warm white the ship reads as white, and it is
  // what the LED strands already render. Warmth still shapes the RGB lanes.
  var aLane = wLane;

  rgbwau(clamp01(rgbBri), clamp01(rgbBri * wg), clamp01(rgbBri * wb),
         clamp01(wLane), clamp01(aLane), 0.0);
}
