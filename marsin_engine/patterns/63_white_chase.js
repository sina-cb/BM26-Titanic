/*
  63_white_chase.js — "White Chase"  [WHITE ONLY family]

  Hard white BARS sweeping across the rig with a decaying tail — a searchlight
  / cylon read in pure white. This is the WHITE ONLY family's motion member:
  crisp bright cores over true-black negative space, and the one that carries
  the vintage-head blinder bite when it is driven from the kick.

  WHY IT IS ACTUALLY WHITE — see 60_white_wash.js's header (same three
  guarantees): no colorPalette exports, neutral RGB (hue-invariant), explicit
  W lane via rgbwau().

  FIXTURE COVERAGE is model-independent (no FIX_* / sectionId branching);
  amber is emitted unconditionally and dropped by fixtures without an A
  channel.

  CORE (non-repeating) MATH — the sweep axis itself rotates on a slow
  incommensurate clock, so the bars never retrace the same path:
      ang  = axisPhase                                  (turns)
      proj = nx*cos(ang) + ny*sin(ang)*0.72 + nz*0.31
      s    = frac( proj*count - chasePhase )            per-bar coordinate
      core = pow( 1 - min(1, s/width), 3 )              leading edge
      tail = pow( 1 - min(1, (1-s)/tailLen), 2 ) * 0.55 trailing decay
  chasePhase and axisPhase advance in a 1 : 0.0618 ratio (golden), so the bar
  spacing and the sweep angle are mutually incommensurate.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Chase rate.
    - direction  : SECOND (project rule). Guarded sign, never 0; the bars
                   also reverse on their own via a soft-clipped sine.
    - level      : overall intensity (PRIMARY audio target).
    - kick       : kick brightness pop on the bars.
    - radius     : bar WIDTH (how fat each sweeping bar is).
    - tailLength : trailing decay length behind each bar.
    - count      : how many bars are on the rig at once (1..5).
    - whiteLevel : crossfade of the white between RGB and the W emitter.
    - whiteKick  : kick-driven W pop (blinder bite; allowed to stack).
    - warmth     : 0 neutral/cool white, 1 warm white (amber + RGB tint).

  The `hueSpread >= 0.10` bar does not apply to the WHITE ONLY family.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
  sliderKick       <- micKick range 0.00..1.00 curve pow2    # bar pop
  sliderRadius     <- micFlux range 0.25..0.75 curve linear  # bar width swells on the build
  sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
  # STATIC (omit from audio): localSpeed, direction, tailLength, count, whiteLevel, warmth
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST: chase rate
export var direction  = 1.0;   // SECOND: signed chase direction (-1..1 stored)
export var level      = 0.75;  // overall intensity (PRIMARY)
export var kick       = 0.0;   // kick bar pop (transient target)
export var radius     = 0.40;  // bar width
export var tailLength = 0.45;  // trailing decay length
export var count      = 0.35;  // bars on the rig at once (maps to 1..5)
export var whiteLevel = 0.60;  // RGB <-> W emitter crossfade
export var whiteKick  = 0.35;  // kick-driven W pop
export var warmth     = 0.05;  // 0 neutral white -> 1 warm white

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
export function sliderTailLength(v) { tailLength = v; }
export function sliderCount(v)      { count = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.75;       // sweeps/sec at localSpeed = 1.0
var BASE_RATE = 0.07;      // the bars never stall
var PHASE_WRAP = 1000.0;
var OSC_WRAP = 1000.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var chasePhase = 0.0;
var axisPhase = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var axCos = 1.0;
var axSin = 0.0;
var levGain = 1.0;
var barWidth = 0.2;
var tailLen = 0.45;
var barCount = 2.0;
var kickBody = 0.0;
var whiteKeep = 0.0;
var whiteBite = 0.0;
var warmAmt = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  dirOsc = dirOsc + dt * 0.0347;      // ~29 s per full turn (distinct cadence)
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;

  chasePhase = chasePhase + dt * rate * effDir * autoSign;
  if (chasePhase >= PHASE_WRAP) chasePhase = chasePhase - PHASE_WRAP;
  else if (chasePhase <= -PHASE_WRAP) chasePhase = chasePhase + PHASE_WRAP;

  // The SWEEP AXIS itself rotates, slowly, at a golden-ratio fraction of the
  // chase rate — that is what stops the bars retracing one fixed path.
  axisPhase = axisPhase + dt * rate * 0.0618;
  if (axisPhase >= PHASE_WRAP) axisPhase = axisPhase - PHASE_WRAP;
  // sin/cos take TURNS in this VM.
  axCos = cos(axisPhase);
  axSin = sin(axisPhase);

  levGain = 0.12 + 0.88 * clamp01(level);
  barWidth = 0.05 + clamp01(radius) * 0.40;
  tailLen = 0.10 + clamp01(tailLength) * 0.75;
  barCount = 1.0 + floor(clamp01(count) * 4.99);
  kickBody = clamp01(kick);
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  warmAmt = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Rotating sweep axis -> a projection coordinate along the sweep.
  var proj = nx * axCos + ny * axSin * 0.72 + nz * 0.31;

  // Per-bar coordinate: 0 at the leading edge, 1 just behind the previous bar.
  var sv = proj * barCount - chasePhase;
  sv = sv - floor(sv);

  var coreT = sv / barWidth;
  if (coreT > 1.0) coreT = 1.0;
  var core = 1.0 - coreT;
  core = core * core * core;                       // crisp leading edge

  var tailT = (1.0 - sv) / tailLen;
  if (tailT > 1.0) tailT = 1.0;
  var tail = (1.0 - tailT);
  tail = tail * tail * 0.55;                       // softer trailing decay

  var shape = core + tail;
  if (shape > 1.0) shape = 1.0;

  // A UNIFORM, level-coupled base under the bars. Two jobs: it keeps the rig
  // visible between sweeps (never fully black — mission-critical visibility),
  // and because it carries no sweep phase it rides `levGain` cleanly, so total
  // brightness actually tracks `level` (the 00_golden_hour_wash trick). Without
  // it the sweep's own swing swamps the audio term and the PRIMARY correlation
  // collapses — measured 0.27 with a 0.035 floor, 0.55+ with this one.
  var bri = (shape * 0.80 + 0.17) * levGain * (1.0 + kickBody * 0.45);
  bri = clamp01(bri);

  // ── WHITE EMIT (see 60_white_wash.js header) ───────────────────────────────
  var rgbShare = 1.0 - 0.72 * whiteKeep;
  var wg = 1.0 - warmAmt * 0.26;
  var wb = 1.0 - warmAmt * 0.60;
  var rgbBri = bri * rgbShare;

  var wLane = bri * whiteKeep + whiteBite * shape * 0.95;
  if (wLane > 1.0) wLane = 1.0;
  // LANE MATCH (w == a): amber tracks white exactly. Bare W is cold, bare A is
  // yellow; matched W+A is the warm white the ship reads as white, and it is
  // what the LED strands already render. Warmth still shapes the RGB lanes.
  var aLane = wLane;

  rgbwau(clamp01(rgbBri), clamp01(rgbBri * wg), clamp01(rgbBri * wb),
         clamp01(wLane), clamp01(aLane), 0.0);
}
