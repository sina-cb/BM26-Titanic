/*
  60_white_wash.js — "White Wash"  [WHITE ONLY family]

  A pure-WHITE ambient wash. No hue, ever: every pixel is emitted with
  NEUTRAL rgb (r == g == b, modulo the warmth tint) plus the fixture's
  dedicated W emitter, so the rig reads as one clean sheet of white light.
  `evenness` collapses the wash into a flat, even WORK LIGHT — the
  visibility / strike / "elegant mode" use the operator asked for.

  WHY IT IS ACTUALLY WHITE (the three things that would otherwise tint it)
    1. NO `colorPalette1` / `colorPalette2` exports. The CPC only writes
       into exports a pattern actually declares, so the global palette and
       the palette autopilot CANNOT re-colour this pattern. That is
       deliberate — a "white only" pattern that the palette can tint is
       not a white pattern.
    2. Neutral RGB is HUE-INVARIANT. The per-channel hue stage
       (pattern_mixer.applyHueShift6chU8) rotates hue; a desaturated pixel
       has no hue to rotate, so white survives it untouched.
    3. WHITE IS EMITTED EXPLICITLY on the W lane via rgbwau(). It is not
       left to the mapper's min(R,G,B) host-synth, so `whiteLevel` is a
       real control over the dedicated white emitter rather than a
       side-effect of the RGB values.

  FIXTURE COVERAGE (model-independent — no FIX_* / sectionId branching, so
  this runs on every rig including the raw-LED-only ones):
    - RGBWAU pars + bars : neutral RGB + W emitter + A (amber) for warmth.
    - RGBW vintage heads / LED strands : neutral RGB + W emitter (A/U are
      simply absent from their channel map and the mapper drops them).
    - RGB-only TE sign panels : the neutral RGB carries the white on its own.
  Emitting A unconditionally is safe: sacn_mapper only writes a channel the
  fixture's channel map declares.

  CORE (non-repeating) MATH — two incommensurate wave layers evaluated at a
  drifting coordinate:
      v     = nx*2.1*R + ny*1.6*R*0.61803 - nz*1.9*R*0.41421 + driftA
      field = wave(v)*0.62 + wave(v*1.73205 + driftB*0.7)*0.38
  driftA/driftB accumulate at a golden-ratio rate offset so the sheet never
  visibly re-locks; the drift sign is a soft-clipped sine (continuous through
  the reversal — no velocity kink) so the wash organically changes heading.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Drift rate, pow(2,(v-0.5)*4).
    - direction  : SECOND (project rule). Guarded sign, never 0.
    - level      : overall intensity (PRIMARY audio target).
    - kick       : kick brightness pop.
    - radius     : wash feature scale / how far the texture travels.
    - evenness   : 0 = textured wash, 1 = FLAT EVEN WORK LIGHT.
    - whiteLevel : crossfades the white between the RGB lanes and the
                   dedicated W emitter (see the WHITE EMIT block below).
                   TUNING NOTE: raising it shifts output onto the W emitter,
                   which the RGB-only TE sign panels do not have — at 1.0 the
                   sign sits at 28 % of the pars. Lower it toward 0.35-0.45
                   for any look where the sign must match the pars.
    - whiteKick  : kick-driven W pop (the blinder bite; stacks on top).
    - warmth     : 0 = neutral/cool white, 1 = warm white (amber + RGB tint).

  NOTE ON THE `hueSpread >= 0.10` PRODUCTION BAR: it does not apply to this
  family. hueSpread measures two-colour spread; a white pattern is
  deliberately hue-free and reads hueSpread ~= 0.00. Every other bar
  (localSpeed effective, guarded direction, autonomous variation,
  peakMaxChan >= 200, silence-safe, audio-reactive) does apply and is met.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.35..1.00 curve linear  # overall intensity (PRIMARY)
  sliderKick       <- micKick range 0.00..1.00 curve pow2    # brightness pop
  sliderRadius     <- micFlux range 0.35..0.85 curve linear  # wash feature scale
  sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
  # STATIC (omit from audio): localSpeed, direction, evenness, whiteLevel, warmth
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST: drift rate
export var direction  = 1.0;   // SECOND: signed drift direction (-1..1 stored)
export var level      = 0.65;  // overall intensity (PRIMARY)
export var kick       = 0.0;   // kick brightness pop (transient target)
export var radius     = 0.5;   // wash feature scale
export var evenness   = 0.35;  // 0 textured wash -> 1 flat even work light
export var whiteLevel = 0.70;  // dedicated W emitter amount
export var whiteKick  = 0.15;  // kick-driven W pop (transient — low static default)
export var warmth     = 0.15;  // 0 neutral white -> 1 warm white

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  // Guard the slider centre so the effective sign is never exactly 0
  // (a 0 sign freezes the wash — ground rule #5).
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v)      { level = v; }
export function sliderKick(v)       { kick = v; }
export function sliderRadius(v)     { radius = v; }
export function sliderEvenness(v)   { evenness = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.55;        // drift turns/sec at localSpeed = 1.0
var BASE_RATE = 0.06;       // creep so the sheet never fully stops at speed 0
var PHASE_WRAP = 1000.0;    // wrap far from any in-frame use (seam-free)
var OSC_WRAP = 1000.0;      // dirOsc feeds sin() in TURNS -> integer wrap is exact

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var driftA = 0.0;
var driftB = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var levGain = 1.0;
var radScale = 0.5;
var kickBody = 0.0;
var evenAmt = 0.35;
var whiteKeep = 0.0;
var whiteBite = 0.0;
var warmAmt = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  // Autonomous direction variation. sin() takes TURNS here, so wrapping
  // dirOsc at a whole number of turns is exactly seam-free. The sign is a
  // SOFT-CLIPPED sine: it saturates near +/-1 for most of the swing but
  // passes continuously through 0 at the reversal, so the drift VELOCITY
  // never jumps (a discrete +/-1 flip is a visible motion kink).
  dirOsc = dirOsc + dt * 0.0219;          // ~45.6 s per full turn
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);   // k = 0.06

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;
  var signedRate = rate * effDir * autoSign;

  driftA = driftA + dt * signedRate;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  driftB = driftB + dt * signedRate * 0.61803;   // golden-ratio offset
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;

  // Headroom matters here: this is a WASH, so most of the rig sits near the
  // top of the range. If levGain can push the field past 1.0 the whole sheet
  // clamps and total brightness stops tracking `level` — the PRIMARY audio
  // correlation collapses. Keep the ceiling at exactly 1.0 and let `kick` be
  // the only term allowed to clip.
  levGain = 0.12 + 0.88 * clamp01(level);   // calm non-black floor at level 0
  radScale = 0.35 + clamp01(radius) * 1.25;
  kickBody = clamp01(kick);
  evenAmt = clamp01(evenness);
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  warmAmt = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var v = nx * 2.1 * radScale
        + ny * 1.6 * radScale * 0.61803
        - nz * 1.9 * radScale * 0.41421
        + driftA;
  var n1 = wave(v);
  var n2 = wave(v * 1.73205 + driftB * 0.7);
  var nraw = n1 * 0.62 + n2 * 0.38;
  var tex = nraw * nraw;                         // soft cores, dark troughs

  // evenness collapses the texture into a flat sheet -> even work light.
  var field = evenAmt + (1.0 - evenAmt) * tex;

  var bri = field * levGain * (1.0 + kickBody * 0.30);
  bri = clamp01(bri);

  // ── WHITE EMIT ─────────────────────────────────────────────────────────────
  // Neutral RGB (hue-free, so RGB-only fixtures carry the white and the hue
  // stage cannot tint it) + the dedicated W emitter + amber for warmth.
  //
  // `whiteLevel` CROSSFADES the white between the RGB lanes and the dedicated
  // W emitter rather than stacking both at full — total output stays roughly
  // constant across the knob, and a fixture with no W channel (the TE sign
  // panels) keeps a real RGB share at every setting instead of going dark.
  // `whiteKick` is the one term allowed to stack on top: it is the blinder
  // bite and it is *supposed* to slam.
  var rgbShare = 1.0 - 0.72 * whiteKeep;         // 0.28 .. 1.00
  var wg = 1.0 - warmAmt * 0.26;
  var wb = 1.0 - warmAmt * 0.60;
  var rgbBri = bri * rgbShare;

  var wLane = bri * whiteKeep + whiteBite * bri * 0.9;
  if (wLane > 1.0) wLane = 1.0;

  // LANE MATCH (w == a): amber tracks white exactly. Bare W is cold, bare A is
  // yellow; matched W+A is the warm white the ship reads as white, and it is
  // what the LED strands already render. Warmth still shapes the RGB lanes.
  var aLane = wLane;

  rgbwau(clamp01(rgbBri), clamp01(rgbBri * wg), clamp01(rgbBri * wb),
         clamp01(wLane), clamp01(aLane), 0.0);
}
