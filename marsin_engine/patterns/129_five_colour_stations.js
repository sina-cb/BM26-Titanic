/*
  129_five_colour_stations.js — "Five Colour Stations"

  IDENTITY: the ship is read as FIVE NAMED STATIONS — bow, stern, smokestacks,
  decks and the TE sign — and EVERY station carries ALL FIVE operator-chosen
  colours at the same time, split into blocks along its strands. The blocks
  march along each station on their own clock, so all five colours flow through
  every part of the ship instead of one colour owning one area.

  HOW IT DIFFERS FROM 128_five_colour_prism: 128 gives each zone ONE colour and
  rotates the five colours between zones, so a given area is a single colour at
  any instant. This pattern subdivides each station so all five are present
  INSIDE it — five colours per location rather than five locations per colour.

  STATIONS ARE PHYSICAL, NOT SPATIAL SLICES. The Titanic's named areas do not
  separate on any single axis — measured from models/titanic.js, the front and
  back walls overlap almost completely in nx, and several groups (Left Front
  Wall, Left Back Wall, both rails) are FLAT in nz. So a station is chosen by
  `sectionId`, which is exact, per the skill's rule to branch on sectionId and
  never on raw coordinate thresholds.

  Titanic section ids per station (measured, 964 px, all accounted for):
    0 BOW    401,408 walls · 403,410 rails · 18,21,24,25 hull   (388 px)
    1 STERN  406,407 walls · 411,412 rails · 19,20,22,23 hull   (388 px)
    2 STACKS 402,409 stacks · 413,414 small stacks              ( 24 px)
    3 DECKS  404,405 auditorium                                 ( 16 px)
    4 SIGN   3 TE Sign + TE Sign 2                              (148 px)
  Any OTHER model's sections map by `sectionId % 5` — a defined, deterministic
  rule so the pattern is rig-agnostic (it still runs on test_bench, where the
  station NAMES simply do not apply). This is not a fallback hiding an error:
  every pixel has a station, and nothing is silently skipped.

  THE SPLIT: sub = (floor(index / blockPx) + station*2 + rotStep) mod 5. Blocks
  are counted in PIXELS along the strand, so a station shows all five colours
  regardless of its shape. `blockPx` is operator-set (1..12, default 3) because
  the smallest station is the 16 px auditorium pair — at 3 px per block it still
  fits 5 blocks and shows the whole set. The two 4 px small smokestacks cannot
  show five colours at once; four LEDs cannot hold five hues, and the marching
  rotation is what carries the rest through them over time.

  STRICT PALETTE COMPLIANCE (§7): all five colours are converted HSV->RGB once
  per frame and a pixel is painted with ONE of those five RGB triples. The
  pattern NEVER interpolates between two hues, so a pixel can only ever show a
  colour the operator actually picked. Brightness varies, hue does not.

  MOTION (clock-driven; never static, never dead-black):
    - localSpeed scales the crest rate via pow(2,(localSpeed-0.5)*4) (§0 rule 1),
      over a non-zero BASE_RATE so it still creeps at localSpeed = 0.
    - DIRECTION is a guarded user sign (never 0, §0 rule 5) times an AUTONOMOUS
      drifting sign from two incommensurate sinusoids (SQRT3 and PHI, different
      constants from 128 so the two patterns never flip in lockstep) (§0 rule 2).
    - The block MARCH advances on its own slow clock, so the colours keep
      travelling through each station even when the crest is slow.

  WHY THE HARNESS REPORTS "LOW-VARIATION" AT SILENCE (do not "fix" this). The
  crest travels along the strand and is periodic in `index`, so the same
  FRACTION of the rig is lit at every phase and TOTAL brightness stays flat when
  no audio is mapped. That flatness is the whole point: total brightness is the
  budget AUDIO owns, and the pattern no longer spends it on its own motion.
  The rig is NOT static — measured at silence, per-pixel change per frame is
  0.13 at localSpeed 0 and 1.36 at localSpeed 1 (a 10.7x range). With the audio
  map wired, TOTAL_BRI swings 74k..181k and reads ANIMATING. Restoring an nx
  sweep to make the silence metric move would put all four modulators back
  under corr 0.4 (measured).

AUDIO_MODULATION_V1:
  sliderLevel  <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick   <- micKick range 0.00..1.00 curve pow2    # brightness pop on the crest
  sliderRadius <- micFlux range 0.30..0.90 curve linear  # crest width / travel extent
  sliderGlow   <- micHigh range 0.15..0.70 curve linear  # background keep between crests
  # STATIC (omit from audio): localSpeed, direction, split, hue3, hue4, hue5, val3, val4, val5, colorPalette1/2
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST control (§0 rule 1) — scales crest rate
export var level = 1.0;        // overall brightness gain (PRIMARY audio target).
                               // Defaults FULL so the un-modulated pattern hits a
                               // true 255 peak; audio drives it DOWN in quiet
                               // passages and back up, which is what makes
                               // brightness actually correlate with the mix.
export var kick = 0.0;         // kick pop. Defaults 0 so it is pure audio headroom.
export var radius = 0.5;       // crest width / travel extent
export var glow = 0.35;        // background keep so silence is still visible
export var split = 0.17;       // colour block size; 0.17 -> 3 px per block, small
                               // enough that the 16 px deck pair shows all five
export var hue3 = 0.33;        // COLOUR 3 hue (this pattern's own palette entry)
export var hue4 = 0.55;        // COLOUR 4 hue
export var hue5 = 0.80;        // COLOUR 5 hue
export var val3 = 1.0;         // COLOUR 3 brightness (its own, not colour 1's)
export var val4 = 1.0;         // COLOUR 4 brightness
export var val5 = 1.0;         // COLOUR 5 brightness
export var direction = 0.5;    // guarded travel direction (never freezes)

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderGlow(v) { glow = v; }
export function sliderSplit(v) { split = v; }
export function sliderHue3(v) { hue3 = v; }
export function sliderHue4(v) { hue4 = v; }
export function sliderHue5(v) { hue5 = v; }
// Colours 1-2 carry full HSV through the engine's own pickers, so their
// brightness always arrives. Colours 3-5 are this pattern's local palette, and
// a hue alone cannot say "the same colour, dimmer" — which is exactly what the
// operator's HUE scheme asks for. These three carry that missing half.
export function sliderVal3(v) { val3 = v; }
export function sliderVal4(v) { val4 = v; }
export function sliderVal5(v) { val5 = v; }
export function sliderDirection(v) {
  // Guard the slider-centre dead-zone so the ship changes heading, never stalls.
  var dv = (v * 2.0) - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  direction = dv;
}

// ── Global palette pickers (§3.1) ────────────────────────────────────────────
export var cp1H = 0.00, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.16, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

// ── Constants ────────────────────────────────────────────────────────────────
var BASE_RATE  = 0.045;    // creep rate at localSpeed = 0 (never dead-static)
var SPAN_RATE  = 0.32;     // additional rate at localSpeed = 1
var MARCH_RATE = 0.115;    // block-march steps per second (own clock)
var AUTO_RATE  = 0.027;    // autonomous direction-drift clock
var PHASE_WRAP = 1024.0;   // wrap phases at a LARGE multiple so no fractional jump
var WAVE_PERIOD_PX = 96.0; // pixels per travelling-crest cycle along the strand.
                           // A CONSTANT, never pixelCount (which compiles to a
                           // literal 144) — this must not depend on the rig.
var PHI   = 1.6180339887;
var SQRT3 = 1.7320508076;

var crestPhase = 0.0;
var marchPhase = 0.0;
var autoT      = 0.0;
var marchStep  = 0.0;
var blockPx    = 3.0;

// ── Palette RGB cache — FIVE entries (§7.2 idiom, extended) ──────────────────
// Locals use the *v suffix because MarsinScript reserves single letters
// (h/i/f/p/q/t/r/g/b) for built-in slots — see §7.3.
var pr0 = 1, pg0 = 0, pb0 = 0;
var pr1 = 0, pg1 = 1, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
var pr3 = 1, pg3 = 1, pb3 = 0;
var pr4 = 1, pg4 = 0, pb4 = 1;

// Scratch outputs for the converter (MarsinScript has no multi-return).
var cr = 0, cg = 0, cb = 0;
function _hsv2rgb(hIn, sIn, vIn) {
  var hv = hIn - floor(hIn); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = vIn * (1 - sIn);
  var qv = vIn * (1 - fv * sIn);
  var tv = vIn * (1 - (1 - fv) * sIn);
  if      (iv == 0) { cr = vIn; cg = tv;  cb = pv;  }
  else if (iv == 1) { cr = qv;  cg = vIn; cb = pv;  }
  else if (iv == 2) { cr = pv;  cg = vIn; cb = tv;  }
  else if (iv == 3) { cr = pv;  cg = qv;  cb = vIn; }
  else if (iv == 4) { cr = tv;  cg = pv;  cb = vIn; }
  else              { cr = vIn; cg = pv;  cb = qv;  }
}

// Which STATION does this section belong to? Exact for the Titanic (ids read
// off models/titanic.js); any other rig maps deterministically by sid % 5.
function _stationOf(sid) {
  if (sid == 401 || sid == 408 || sid == 403 || sid == 410 ||
      sid == 18  || sid == 21  || sid == 24  || sid == 25) return 0.0;   // BOW
  if (sid == 406 || sid == 407 || sid == 411 || sid == 412 ||
      sid == 19  || sid == 20  || sid == 22  || sid == 23) return 1.0;   // STERN
  if (sid == 402 || sid == 409 || sid == 413 || sid == 414) return 2.0;  // STACKS
  if (sid == 404 || sid == 405) return 3.0;                              // DECKS
  if (sid == 3) return 4.0;                                              // SIGN
  var mv = sid % 5;
  if (mv < 0) mv = mv + 5;
  return mv;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;   // clamp a stalled frame so nothing jumps

  // Convert all FIVE palette entries once per frame. Colours 3-5 take the
  // SATURATION of cp1 (so the set reads as one family) but carry their OWN
  // brightness via val3/4/5, so "the same colour at five brightnesses" is
  // actually renderable — with a shared value it would collapse to one colour.
  _hsv2rgb(cp1H, cp1S, cp1V);      pr0 = cr; pg0 = cg; pb0 = cb;
  _hsv2rgb(cp2H, cp2S, cp2V);      pr1 = cr; pg1 = cg; pb1 = cb;
  _hsv2rgb(hue3, cp1S, clamp(val3, 0.0, 1.0));  pr2 = cr; pg2 = cg; pb2 = cb;
  _hsv2rgb(hue4, cp1S, clamp(val4, 0.0, 1.0));  pr3 = cr; pg3 = cg; pb3 = cb;
  _hsv2rgb(hue5, cp1S, clamp(val5, 0.0, 1.0));  pr4 = cr; pg4 = cg; pb4 = cb;

  // Colour block size in PIXELS along the strand: 1..12.
  blockPx = 1.0 + floor(clamp(split, 0.0, 1.0) * 11.999);

  // Autonomous drifting direction sign — two incommensurate sinusoids so the
  // ship reverses organically and never re-locks (§0 rule 2). Different
  // constants from 128 so the two patterns never flip together.
  autoT = autoT + dt * AUTO_RATE;
  if (autoT >= PHASE_WRAP) autoT = autoT - PHASE_WRAP;
  var wv = 0.58 + 0.50 * sin(autoT * 6.2831853 * SQRT3)
                + 0.21 * sin(autoT * 6.2831853 * PHI);
  var autoSign = 1.0;
  if (wv < 0.0) autoSign = -1.0;

  var userSign = direction;
  if (userSign >= 0.0 && userSign < 0.06) userSign = 0.06;
  else if (userSign < 0.0 && userSign > -0.06) userSign = -0.06;
  var effDir = userSign * autoSign;   // never exactly 0 -> never freezes

  // Travelling brightness crest. BASE_RATE keeps it creeping at localSpeed = 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + SPAN_RATE * localMultiplier;
  crestPhase = crestPhase + dt * rate * effDir;
  if (crestPhase >= PHASE_WRAP) crestPhase = crestPhase - PHASE_WRAP;
  if (crestPhase < 0.0) crestPhase = crestPhase + PHASE_WRAP;

  // The block march walks the five colours along every station on its own
  // clock, so the colours keep flowing even when the crest is slow.
  marchPhase = marchPhase + dt * MARCH_RATE;
  if (marchPhase >= PHASE_WRAP) marchPhase = marchPhase - PHASE_WRAP;
  marchStep = floor(marchPhase);
}

export function render3D(index, xIn, yIn, zIn) {

  // ── Which of the five colours does this pixel wear? ──────────────────────
  // Blocks of `blockPx` pixels along the strand each take the next colour, so
  // EVERY station carries all five at once. The station offset staggers where
  // each area starts, and marchStep walks the whole set along over time.
  var station = _stationOf(sectionId);
  var blockv = floor(index / blockPx);
  var subv = (blockv + station * 2.0 + marchStep) % 5;
  if (subv < 0) subv = subv + 5;

  // ── Brightness: a travelling crest over a keep-alive background ──────────
  // The crest travels along the STRAND (index), NOT along nx.
  //
  // WHY THIS MATTERS — measured, not assumed. On the Titanic the pixels are not
  // spread evenly along x: models/titanic.js has ZERO pixels between nx 0.40
  // and 0.65, a quarter of the sweep. A crest swept across nx therefore lights
  // between 0 and 154 pixels depending only on WHERE IT IS, and that
  // position-driven swing in total brightness competes with the audio signal
  // that is supposed to own brightness. Measured on 96 frames of full_track,
  // micLow -> sliderLevel scored only corr 0.30 with an nx sweep.
  //
  // Along the strand the wave is periodic in index, so the same FRACTION of the
  // rig is lit at every phase and total brightness stops moving for non-audio
  // reasons. It also matches this pattern's identity better: the crest now
  // travels through the marching colour blocks in every station at once,
  // instead of crossing the ship geographically.
  var ph = index / WAVE_PERIOD_PX + crestPhase;
  var crest = wave(ph);                    // builtin, smooth 0..1, no seam
  var sharpPow = 1.6 + (1.0 - clamp(radius, 0.0, 1.0)) * 6.0;
  crest = pow(crest, sharpPow);            // crisp core (§0 rule 3)
  // Never dead-black: a small keep so the ship stays visible in silence
  // (§0 rule 4 — and the mission: the ship must read at night). Kept LOW so
  // audio retains real headroom to move total brightness; a high floor is what
  // made 128's secondary modulators measure weak before it was lowered.
  var keep = 0.02 + clamp(glow, 0.0, 1.0) * 0.22;
  var bri = keep + crest * (1.0 - keep);

  // Level multiplies the output DIRECTLY (no offset) and never exceeds 1.0, so
  // nothing is clamped — clamping is what destroys audio correlation.
  var gain = clamp(level, 0.0, 1.0);
  bri = bri * gain;

  // Kick punches the WHOLE ship, with extra emphasis on the crest — musically a
  // kick should hit everything, and a crest-only pop moves too few pixels to
  // correlate. Bounded by remaining headroom, so it can never saturate.
  var kickAmt = clamp(kick, 0.0, 1.0);
  bri = bri + (0.40 + 0.60 * crest) * kickAmt * (1.0 - bri) * 0.85;

  // ── Paint ONE chosen colour — never a blend of two ───────────────────────
  var orr = 0.0, ogg = 0.0, obb = 0.0;
  if      (subv == 0) { orr = pr0; ogg = pg0; obb = pb0; }
  else if (subv == 1) { orr = pr1; ogg = pg1; obb = pb1; }
  else if (subv == 2) { orr = pr2; ogg = pg2; obb = pb2; }
  else if (subv == 3) { orr = pr3; ogg = pg3; obb = pb3; }
  else                { orr = pr4; ogg = pg4; obb = pb4; }

  rgb(orr * bri, ogg * bri, obb * bri);
}
