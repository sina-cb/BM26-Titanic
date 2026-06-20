/*
  63_note_color.js — PLAY THE NOTES AS COLOUR.

  Round-2 audio identity: the engine tracks the dominant musical note and maps
  its pitch class to a hue (audioNoteHue, 0..1 = C..B around the colour wheel),
  and fires a pulse (audioSwitchColor) at musically-sensible moments to CHANGE
  colour. This pattern paints the melody: the whole rig glows the note's colour,
  smoothly gliding as the melody moves, and on each switch-colour pulse it PUNCHES
  a palette flip — a deliberate, on-the-music recolour (this also visually
  validates the Round-2 note→colour signal fix).

  Behaviour:
    HUE     — the rig's colour eases toward audioNoteHue (the live note), so a
              chord progression literally walks the rig through the colour wheel.
              The ease is gentle so colour GLIDES between notes, never strobes.
    SWITCH  — audioSwitchColor fires a bright FLASH and snaps a palette ROTATION
              (a fixed hue offset toggles), so the punch reads as a decisive
              colour change layered on top of the note hue. Each pulse advances a
              persistent rotation so successive switches keep recolouring.
    SHIMMER — a beat-locked sparkle (audioBeat) glints across the rig so it
              pulses with the groove; a calm base keeps it alive + readable in
              silence (mission-critical), never fully dark.

  COORDINATE-DRIVEN (x gradient + per-pixel sparkle seed) so it ports test_bench
  -> titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : shimmer/glide cadence (0 = freeze).
    - noteHue    : NOTE hue 0..1 (audio audioNoteHue) -> rig colour.
    - switch     : SWITCH-COLOUR pulse (audio audioSwitchColor) -> flash + rotate.
    - beat       : BEAT pulse (audio audioBeat) -> shimmer glints.
    - level      : overall brightness floor.
    - (no colorPalette exports — colour is NOTE-DRIVEN, not operator-set.)

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderNoteHue <- audioNoteHue    range 0.00..1.00 curve linear  # HEADLINE: the live note's pitch class -> rig hue (melody as colour)
    sliderSwitch  <- audioSwitchColor range 0.00..1.00 curve linear  # on-the-music colour CHANGE: flash + palette rotation
    sliderBeat    <- audioBeat       range 0.00..1.00 curve linear  # beat-locked shimmer glints (groove pulse)
  STATIC (operator handles, not audio-mapped): localSpeed, level.
  HUE pattern: validate on --synth chord_progression / bassline (audioNoteHue
  walks the wheel as the bass changes note). The reactivity is a HUE shift with
  the melody (meanHue moves across the clip) + beat shimmer brightness pulse.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // shimmer/glide cadence
export var noteHue = 0.0;      // NOTE hue 0..1 (audio audioNoteHue) -> rig colour
export var switch_ = 0.0;      // SWITCH-COLOUR pulse (audio audioSwitchColor)
export var beat = 0.0;         // BEAT pulse (audio audioBeat) -> shimmer
export var level = 0.6;        // overall brightness floor

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderNoteHue(v) { noteHue = v; }
export function sliderSwitch(v) { switch_ = v; }
export function sliderBeat(v) { beat = v; }
export function sliderLevel(v) { level = 0.30 + v * 0.70; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var SW_ARM   = 0.4;      // switch-colour level that arms a flip (rising edge)
var SW_REARM = 0.2;      // hysteresis re-arm
var ROT_STEP = 0.2083333; // hue rotation per switch = 5/24 turn (irrational-ish; ~75°)
var FLASH_FALL = 3.2;    // switch-flash decay per sec
var HUE_TAU  = 5.0;      // note-hue glide rate toward the live note (per sec)
var BASE_FLOOR = 0.10;   // always-on floor so the rig never goes fully dark (P0)
var SAT      = 0.95;     // colour saturation (rich, two-emitter friendly)

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

var rr = 0, gg = 0, bb = 0;
function hsv2rgb(h, s, vv) {
  var hv = h - floor(h); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = vv * (1 - s);
  var qv = vv * (1 - fv * s);
  var tv = vv * (1 - (1 - fv) * s);
  if      (iv == 0) { rr = vv; gg = tv; bb = pv; }
  else if (iv == 1) { rr = qv; gg = vv; bb = pv; }
  else if (iv == 2) { rr = pv; gg = vv; bb = tv; }
  else if (iv == 3) { rr = pv; gg = qv; bb = vv; }
  else if (iv == 4) { rr = tv; gg = pv; bb = vv; }
  else              { rr = vv; gg = pv; bb = qv; }
}

// shortest-path hue glide: ease `cur` toward `target` around the 0..1 wheel.
function hueGlide(cur, target, a) {
  var d = target - cur;
  if (d > 0.5) d -= 1.0;
  if (d < -0.5) d += 1.0;
  cur = cur + d * a;
  cur = cur - floor(cur);
  return cur;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var hueCur = 0.0;    // glided rig hue (eases toward the live note)
var rot = 0.0;       // accumulated palette rotation (advanced by switches)
var flash = 0.0;     // switch-colour flash envelope
var armed = 1;       // rising-edge arm for the switch
var tShim = 0.0;     // shimmer phase

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  tShim = time(0.03 / rate);

  // glide the rig hue toward the live note (gentle so colour glides, no strobe).
  hueCur = hueGlide(hueCur, clamp01(noteHue), clamp01(dt * HUE_TAU));

  // switch-colour rising edge -> flash + advance the palette rotation.
  if (armed == 1 && switch_ >= SW_ARM) { flash = 1.0; rot = rot + ROT_STEP; rot = rot - floor(rot); armed = 0; }
  if (switch_ < SW_REARM) armed = 1;
  flash = flash - dt * FLASH_FALL;
  if (flash < 0.0) flash = 0.0;
}

export function render3D(index, x, y, z) {
  // Two-tone wash: the rig hue + its rotation, with a SMALL per-pixel hue spread
  // across X so BOTH a base and an accent colour read on every rig WITHOUT
  // washing out the note signal (a tight ±0.06 spread keeps the frame mean-hue
  // locked to the live note, so the melody clearly drives the colour).
  var baseHue = hueCur + rot;
  var grad = wave(tShim * 0.6 + clamp01(x) * 1.0);            // -1..1
  var h = baseHue + 0.06 * grad;                              // tight accent spread

  // beat-locked shimmer: crisp deterministic glints whose density rises on a beat.
  var seed = index * 89.7 + floor(tShim * 200.0) * 0.131;
  var spark = sin(seed) * sin(seed * 3.1) * sin(seed * 7.9);
  spark = spark * spark; spark = spark * spark;
  var thr = 0.9 - clamp01(beat) * 0.5;
  var glint = 0.0;
  if (spark > thr) glint = (spark - thr) / (1.0 - thr + 0.0001);

  // brightness: always-on floor (P0) + level body + beat shimmer + switch flash.
  var breath = 0.6 + 0.4 * wave(tShim * 0.7 + clamp01(y) * 1.3);
  var bri = BASE_FLOOR + level * 0.7 * breath;
  bri = bri + glint * 0.5 * (0.4 + 0.6 * clamp01(beat));   // shimmer
  bri = bri + flash * 0.55;                                 // switch flash lifts the rig
  bri = clamp01(bri);

  // the switch flash also whitens (desaturates) the colour momentarily so the
  // change reads as a bright punch, not just a hue jump.
  var s = SAT * (1.0 - 0.5 * flash);

  hsv2rgb(h, s, bri);
  // white-channel pop on the switch flash for a clean bright change.
  var ww = flash * 0.45;
  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), 0.0, 0.0);
}
