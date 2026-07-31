/*
  65_uv_only.js — "UV Only"  [EXPERIMENTAL SPIKE — in NO program]

  ⚠ EXPERIMENTAL. This pattern exists so the operator can stand in front of
  the real rig and decide whether the UV/violet lane is worth using at all.
  It belongs to exactly one playlist (`uv_test`) and must not be added to
  ambient / party / any themed program until Sina says go.

  ── WHAT "UV" ACTUALLY IS ON THIS RIG (read this before judging the look) ────
  There is NO true blacklight emitter anywhere in the inventory. The `u` lane
  of rgbwau() lands on:
    · UkingPar   — DMX ch 7, which the manufacturer's manual calls "Purple".
                   The fixture is sold as RGBWAU but the sixth emitter is a
                   deep VIOLET/purple LED, not a 365-395 nm UV die.
    · ShehdsBar  — the 6th sub-channel of each pixel. The fixture is RGBWA-V
                   and the manual's pixel order is
                   [Red, Green, Blue, White, Amber, Violet].
  Every other fixture has NO u channel at all — VintageLed is RGBW, the
  TE Sign V3 panels and the raw LED strands are RGB/RGBW. sacn_mapper only
  writes a channel the fixture's map declares, so on those fixtures the `u`
  argument is silently (and correctly) dropped.

  CONSEQUENCE: at the shipped defaults this pattern lights ONLY the pars and
  the bars. The vintage heads, the sign and the strands stay dark. That is not
  a bug — it is the honest answer to "what does UV-only look like here", and
  it is the single most important thing for the operator to see. `rgbViolet`
  (default 0) opts the RGB-only fixtures into a deep-violet RGB approximation
  if he wants the whole rig involved; it is OFF by default so the first look
  is the truthful one.

  Because the rig cannot go UV-only across all fixtures, the family's usual
  "never fully black" rule is scoped here: the U lane never reaches zero on
  the fixtures that HAVE it, and the pattern always animates. Fixtures without
  a violet emitter are dark by physical necessity, not by a silent fallback.

  NO colorPalette exports — the global palette cannot tint this, same as the
  WHITE ONLY family. The violet lives on its own lane; the per-channel hue
  stage does not touch W/A/U at all.

  CORE (non-repeating) MATH — a rising undertow crossed with a slow bloom:
      under = wave( ny*1.35*R - nx*0.45*R + tidePhase )
      bloom = wave( hypot3(nx-0.5, ny-0.5, nz-0.5)*2.1*R - bloomPhase )
      u     = pow( under*0.62 + bloom*0.38, 1 + sharpness*3 )
  tidePhase : bloomPhase advance at 1 : 0.41421 (sqrt2 - 1), so the undertow
  and the bloom never re-align.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Undertow rate.
    - direction  : SECOND (project rule). Guarded sign, never 0.
    - level      : overall UV intensity (PRIMARY audio target).
    - kick       : kick-driven violet slam.
    - radius     : feature scale of the undertow / bloom.
    - sharpness  : soft glow (0) to defined lobes (1).
    - uvFloor    : always-on violet keep, so the lane never goes black.
    - rgbViolet  : 0 = TRUE UV-lane-only (default). >0 fills a deep-violet RGB
                   approximation on fixtures that have no violet emitter.

AUDIO_MODULATION_V1:
  sliderLevel <- micHigh range 0.30..1.00 curve linear  # UV intensity (PRIMARY)
  sliderKick  <- micKick range 0.00..1.00 curve pow2    # violet slam
  # STATIC (omit from audio): localSpeed, direction, radius, sharpness,
  #                           uvFloor, rgbViolet
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.40;  // FIRST: undertow rate
export var direction  = 1.0;   // SECOND: signed undertow direction (-1..1 stored)
export var level      = 0.80;  // overall UV intensity (PRIMARY)
export var kick       = 0.0;   // kick violet slam (transient target)
export var radius     = 0.5;   // feature scale
export var sharpness  = 0.35;  // soft glow -> defined lobes
export var uvFloor    = 0.12;  // always-on violet keep
export var rgbViolet  = 0.0;   // 0 = TRUE UV-lane-only (see header)

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v)     { level = v; }
export function sliderKick(v)      { kick = v; }
export function sliderRadius(v)    { radius = v; }
export function sliderSharpness(v) { sharpness = v; }
export function sliderUvFloor(v)   { uvFloor = v; }
export function sliderRgbViolet(v) { rgbViolet = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.45;
var BASE_RATE = 0.05;
var PHASE_WRAP = 1000.0;
var OSC_WRAP = 1000.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var tidePhase = 0.0;
var bloomPhase = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var levGain = 1.0;
var radScale = 0.5;
var sharpPow = 2.0;
var kickBody = 0.0;
var floorAmt = 0.12;
var rgbAmt = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  dirOsc = dirOsc + dt * 0.0193;      // ~52 s per full turn
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;
  var signedRate = rate * effDir * autoSign;

  tidePhase = tidePhase + dt * signedRate;
  if (tidePhase >= PHASE_WRAP) tidePhase = tidePhase - PHASE_WRAP;
  else if (tidePhase <= -PHASE_WRAP) tidePhase = tidePhase + PHASE_WRAP;
  bloomPhase = bloomPhase + dt * signedRate * 0.41421;   // sqrt(2) - 1
  if (bloomPhase >= PHASE_WRAP) bloomPhase = bloomPhase - PHASE_WRAP;
  else if (bloomPhase <= -PHASE_WRAP) bloomPhase = bloomPhase + PHASE_WRAP;

  levGain = 0.15 + 0.85 * clamp01(level);
  radScale = 0.35 + clamp01(radius) * 1.30;
  sharpPow = 1.0 + clamp01(sharpness) * 3.0;
  kickBody = clamp01(kick);
  floorAmt = clamp01(uvFloor);
  rgbAmt = clamp01(rgbViolet);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var under = wave(ny * 1.35 * radScale - nx * 0.45 * radScale + tidePhase);
  var dv = hypot3(nx - 0.5, ny - 0.5, nz - 0.5);
  var bloom = wave(dv * 2.1 * radScale - bloomPhase);

  var fieldv = under * 0.62 + bloom * 0.38;
  var shaped = pow(fieldv, sharpPow);

  var uLane = (floorAmt + (1.0 - floorAmt) * shaped) * levGain * (1.0 + kickBody * 0.60);
  uLane = clamp01(uLane);

  // Deep-violet RGB approximation for the fixtures that have no violet
  // emitter. OFF by default (rgbViolet = 0) so the default look is the
  // truthful "only the pars and bars can do this" answer.
  var vr = uLane * rgbAmt * 0.42;
  var vb = uLane * rgbAmt * 0.95;

  rgbwau(clamp01(vr), 0.0, clamp01(vb), 0.0, 0.0, uLane);
}
