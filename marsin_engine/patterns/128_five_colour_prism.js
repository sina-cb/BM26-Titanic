/*
  128_five_colour_prism.js — "Five Colour Prism"

  IDENTITY: the rig is divided into FIVE colour zones that each hold a DIFFERENT
  operator-chosen colour at the same time, and those five colours slowly ROTATE
  between the zones so every colour visits every part of the ship. A travelling
  brightness wave keeps the whole thing moving, so nothing is ever static.

  WHY THIS PATTERN EXISTS: the standard palette contract (§3.1) gives a pattern
  TWO colours — cp1 and cp2 — and every stock pattern blends between them. An
  operator who wants five distinct colours on the ship at once has nowhere to
  put the other three. This pattern adds them as LOCAL sliders (§3.2), so the
  five live entirely inside this pattern with NO engine change and no other
  pattern touched. Colours 1-2 are the global pickers (so the deck/CaptainPad
  colour controls still drive them); colours 3-5 are `sliderHue3/4/5`.

  STRICT PALETTE COMPLIANCE (§7): every colour is converted HSV->RGB ONCE per
  frame and a pixel is painted with ONE of those five RGB triples — the pattern
  NEVER interpolates between two different hues. That is deliberate: §7.1
  documents that interpolating cp1H->cp2H "walks around the colour wheel …
  none of which the operator picked". Here a pixel can only ever show a colour
  the operator actually chose. Brightness is what varies, not hue.

  MOTION (clock-driven; never static, never dead-black):
    - localSpeed scales the wave rate via pow(2,(localSpeed-0.5)*4) (§0 rule 1),
      with a non-zero BASE_RATE so it still creeps at localSpeed = 0.
    - DIRECTION is a guarded user sign (never 0, §0 rule 5) multiplied by an
      AUTONOMOUS drifting sign built from two incommensurate sinusoids (PHI and
      SQRT2), so the ship occasionally reverses on its own and never re-locks
      to a fixed period (§0 rule 2).
    - The zone ROTATION advances on its own slow clock, so the colour-to-zone
      assignment keeps changing even when the wave is slow.

  ZONING: zone = (sectionId + floor(nx * 5) + rotStep) mod 5. Position gives the
  five bands along the ship, `sectionId` offsets them so different fixture
  sections do not sit in lockstep stripes, and `rotStep` walks the colours
  around over time. The rig therefore shows all five colours simultaneously.

AUDIO_MODULATION_V1:
  sliderLevel  <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick   <- micKick range 0.00..1.00 curve pow2    # brightness pop on the wave crest
  sliderRadius <- micFlux range 0.30..0.90 curve linear  # crest width / travel extent
  sliderGlow   <- micHigh range 0.15..0.70 curve linear  # background keep between crests
  # STATIC (omit from audio): localSpeed, direction, hue3, hue4, hue5, val3, val4, val5, colorPalette1/2
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST control (§0 rule 1) — scales wave rate
export var level = 1.0;        // overall brightness gain (PRIMARY audio target).
                               // Defaults FULL so the un-modulated pattern hits a
                               // true 255 peak; audio drives it DOWN in quiet
                               // passages and back up on level, which is what
                               // makes brightness actually correlate with the mix.
export var kick = 0.0;         // kick pop. Defaults 0 so it is pure audio headroom
                               // — a non-zero default would sit inside the clamp
                               // and the kick would have nothing left to add.
export var radius = 0.5;       // crest width / travel extent
export var glow = 0.35;        // background keep so silence is still visible
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
  // Guard the slider-centre dead-zone so the rig changes heading, never stalls.
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
var BASE_RATE = 0.045;    // creep rate at localSpeed = 0 (never dead-static)
var SPAN_RATE = 0.32;     // additional rate at localSpeed = 1
var ROT_RATE  = 0.085;    // zone-rotation steps per second (slow, independent)
var AUTO_RATE = 0.031;    // autonomous direction-drift clock
var PHASE_WRAP = 1024.0;  // wrap phases at a LARGE multiple so no fractional jump
var WAVE_PERIOD_PX = 110.0; // pixels per brightness-wave cycle along the strand.
                            // A CONSTANT, never pixelCount (compiles to 144).
var PHI  = 1.6180339887;
var SQRT2 = 1.4142135624;

var wavePhase = 0.0;
var rotPhase  = 0.0;
var autoT     = 0.0;
var rotStep   = 0.0;

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

  // Autonomous drifting direction sign — two incommensurate sinusoids so the
  // ship reverses organically and never re-locks (§0 rule 2).
  autoT = autoT + dt * AUTO_RATE;
  if (autoT >= PHASE_WRAP) autoT = autoT - PHASE_WRAP;
  var wv = 0.62 + 0.50 * sin(autoT * 6.2831853 * PHI)
                + 0.18 * sin(autoT * 6.2831853 * SQRT2);
  var autoSign = 1.0;
  if (wv < 0.0) autoSign = -1.0;

  var userSign = direction;
  if (userSign >= 0.0 && userSign < 0.06) userSign = 0.06;
  else if (userSign < 0.0 && userSign > -0.06) userSign = -0.06;
  var effDir = userSign * autoSign;   // never exactly 0 -> never freezes

  // Travelling brightness wave. BASE_RATE keeps it creeping at localSpeed = 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + SPAN_RATE * localMultiplier;
  wavePhase = wavePhase + dt * rate * effDir;
  if (wavePhase >= PHASE_WRAP) wavePhase = wavePhase - PHASE_WRAP;
  if (wavePhase < 0.0) wavePhase = wavePhase + PHASE_WRAP;

  // Zone rotation walks the five colours around the ship on its own clock, so
  // the assignment keeps changing even when the wave is slow.
  rotPhase = rotPhase + dt * ROT_RATE;
  if (rotPhase >= PHASE_WRAP) rotPhase = rotPhase - PHASE_WRAP;
  rotStep = floor(rotPhase);
}

export function render3D(index, x, y, z) {
  var nx = clamp(x, 0.0, 1.0);

  // ── Which of the five colours does this pixel wear? ──────────────────────
  // Position gives five bands along the ship; sectionId offsets them so
  // different fixture sections are not in lockstep; rotStep walks the colours
  // around over time. All five are therefore on the rig simultaneously.
  var band = floor(nx * 5.0);
  if (band > 4) band = 4;
  var zone = (band + sectionId + rotStep) % 5;
  if (zone < 0) zone = zone + 5;

  // ── Brightness: a travelling crest over a keep-alive background ──────────
  // Crisp, fairly narrow core over dark negative space (§0 rule 3). Wide range
  // because radius is an AUDIO target and needs real travel to register.
  // The wave travels along the STRAND (index), NOT across nx. MEASURED reason:
  // models/titanic.js has ZERO pixels between nx 0.40 and 0.65 — a quarter of
  // the sweep is empty — so an nx crest lit anywhere from 0 to 154 pixels
  // depending only on WHERE IT WAS. That position-driven swing in total
  // brightness competed with the audio that is supposed to own brightness, and
  // held every modulator down (micLow 0.37, micKick -0.04, micHigh 0.17).
  // Periodic in index, the same FRACTION of the rig is lit at every phase.
  // ZONING still uses nx (the five bands along the ship) — only the brightness
  // wave moved, so the identity is unchanged.
  var ph = index / WAVE_PERIOD_PX + wavePhase;
  var crest = wave(ph);                    // builtin, smooth 0..1, no seam
  var sharpPow = 1.6 + (1.0 - clamp(radius, 0.0, 1.0)) * 6.0;
  crest = pow(crest, sharpPow);            // crisp core (§0 rule 3)
  // Never dead-black: a small keep so the rig stays visible in silence
  // (§0 rule 4 — and the mission: the ship must read at night).
  // TRUE-BLACK-ISH NEGATIVE SPACE (§0 rule 3). This was the single biggest
  // defect found by the harness: a high keep floor lit ~78% of the rig
  // (brightFrac 0.78), leaving audio almost no headroom to change total
  // brightness — which is why every secondary modulator measured "weak". The
  // reference pattern 01_cylon_sweep runs brightFrac 0.28 and scores all four
  // REACTIVE. The floor is kept NON-ZERO so all five colours stay readable at
  // night (the mission) — just dim, with the crest carrying the punch.
  var keep = 0.02 + clamp(glow, 0.0, 1.0) * 0.22;
  var bri = keep + crest * (1.0 - keep);

  // Level gain never exceeds 1.0, so nothing is CLAMPED — clamping is what
  // destroys audio correlation (measured: with a saturating curve the harness
  // reported corr 0.32/-0.02/0.32/0.16, all "weak", because brightness was
  // already pinned at max and louder audio could not move it). With the default
  // level of 1.0 the crest still peaks at a true 255.
  // Level multiplies the output DIRECTLY (no offset). An offset compresses the
  // usable range and the audio signal then competes with the pattern's own
  // brightness variance — colour luminance differs per zone and the sweeping
  // crest clips at the rig edges, both of which are non-audio swing. Measured:
  // with a 0.15 offset the primary scored 0.27 in isolation against the
  // reference pattern's 0.70.
  var gain = clamp(level, 0.0, 1.0);
  bri = bri * gain;

  // Kick punches the WHOLE RIG, with extra emphasis on the crest. A
  // crest-ONLY pop moves too few pixels to correlate with the mix (measured
  // corr -0.10) — and musically a kick should hit the whole ship, not a sliver
  // of it. Still bounded by the remaining headroom, so it can never saturate.
  var kickAmt = clamp(kick, 0.0, 1.0);
  bri = bri + (0.40 + 0.60 * crest) * kickAmt * (1.0 - bri) * 0.85;

  // ── Paint ONE chosen colour — never a blend of two ───────────────────────
  var orr = 0.0, ogg = 0.0, obb = 0.0;
  if      (zone == 0) { orr = pr0; ogg = pg0; obb = pb0; }
  else if (zone == 1) { orr = pr1; ogg = pg1; obb = pb1; }
  else if (zone == 2) { orr = pr2; ogg = pg2; obb = pb2; }
  else if (zone == 3) { orr = pr3; ogg = pg3; obb = pb3; }
  else                { orr = pr4; ogg = pg4; obb = pb4; }

  rgb(orr * bri, ogg * bri, obb * bri);
}
