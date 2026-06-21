/*
  71_harmonic_sparkle.js — GLINTS that burst on harmonic CHANGE, coloured by the
  current note.

  Chroma identity: the engine publishes micChromaFluxRaw — 0..1 harmonic-CHANGE
  rate (the L1 distance between successive pitch-class vectors). It spikes when
  the chord/harmony MOVES (a chord change, a melodic jump, a new stab) and sits
  near 0 on a harmonically static loop. Paired with audioNoteHue (pitch class ->
  hue), this pattern makes the rig SPARKLE on harmonic motion in the colour of the
  note that moved:

    HARMONIC CHANGE (flux spikes) -> a BURST of bright glints scatters across the
                                     hull (a quick scintillation), tinted by
                                     audioNoteHue so the new chord arrives in its
                                     own colour. The burst decays fast — the rig
                                     "twinkles" on every chord move.
    HELD HARMONY (flux ~0)        -> the glints fade out and the rig settles to a
                                     calm two-colour wash that slowly eases its
                                     hue toward the held note (so even a static
                                     passage has the note's colour, gently).

  The note hue EASES (smoothed) so the base colour walks the wheel with the melody
  without strobing; the glint burst is fast/sharp so harmonic changes pop. A
  lifted wash floor keeps the rig clearly ALIVE in silence (mission critical —
  never near-black).

  COORDINATE-DRIVEN (x/y hashed glints + radius) so it ports test_bench ->
  titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : wash drift + glint animation rate (never frozen).
    - sparkle    : micChromaFlux -> glint BURST on harmonic change (HEADLINE).
    - noteHue    : audioNoteHue -> colour of the glints + base wash hue.
    - base       : calm wash floor (always-on; never dark).
    - colorPalette1/2 : cp1 calm wash <-> cp2 hot glint (note-tinted).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderSparkle <- micChromaFluxRaw range 0.00..1.00 curve linear  # HEADLINE: glint burst on harmonic change
    sliderNoteHue <- audioNoteHue     range 0.00..1.00 curve linear  # glint + wash colour from the live note
  STATIC (operator handles, not audio-mapped): localSpeed, base, colorPalette1/2.
  Validate on --synth full_track / chord_progression (flux spikes on chord turns,
  noteHue walks). corr(micChromaFluxRaw, brightness) is the headline (each chord
  move raises total brightness via the glint burst); note->hue is the colour proof.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // wash drift + glint rate
export var sparkle = 0.0;      // chroma flux -> glint burst (audio)
export var noteHue = 0.0;      // audioNoteHue -> colour (audio)
export var base = 0.5;         // calm wash floor (always-on; never near-dark)

export var cp1H = 0.62, cp1S = 0.85, cp1V = 1.0; // palette 1 — calm wash
export var cp2H = 0.12, cp2S = 0.90, cp2V = 1.0; // palette 2 — hot glint base
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderNoteHue(v) { noteHue = v; }
export function sliderBase(v) { base = 0.22 + v * 0.40; } // 0.22..0.62; never near-dark

// ── Tunables ─────────────────────────────────────────────────────────────────
var SPARK_TAU = 2.6;    // decay of the glint burst envelope (per sec) — fast pop
var HUE_TAU   = 1.4;    // ease of the note hue (slow glide, never strobes)
var WASH_RATE = 0.06;   // calm wash drift at localSpeed=0.5
var GLINT_RATE = 1.2;   // glint animation rate at localSpeed=0.5

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 1, pb2 = 0;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

// note hue -> rgb (full saturation, full value) for the glint tint.
var nr = 1, ng = 1, nb = 1;
function _noteRgb(hue) {
  var hv = hue - floor(hue); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var q = 1.0 - fv;
  if      (iv == 0) { nr = 1;  ng = fv; nb = 0;  }
  else if (iv == 1) { nr = q;  ng = 1;  nb = 0;  }
  else if (iv == 2) { nr = 0;  ng = 1;  nb = fv; }
  else if (iv == 3) { nr = 0;  ng = q;  nb = 1;  }
  else if (iv == 4) { nr = fv; ng = 0;  nb = 1;  }
  else              { nr = 1;  ng = 0;  nb = q;  }
}

// deterministic per-pixel hash (stable per coordinate, no allocation).
function hash01(a, b) {
  var s = sin(a * 91.37 + b * 271.93) * 47453.1234;
  return s - floor(s);
}

// ── Persistent state ─────────────────────────────────────────────────────────
var burst = 0.0;       // smoothed glint-burst envelope (fast attack, fast decay)
var heldHue = 0.0;     // eased note hue -> base wash + glint colour
var washPhase = 0.0;
var glintPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // glint burst: instant attack to the flux, fast decay -> a pop on each change.
  var fx = clamp01(sparkle);
  if (fx > burst) burst = fx;
  burst = burst - dt * SPARK_TAU;
  if (burst < 0.0) burst = 0.0;

  // note hue eases (shortest-path wrap) so the colour glides with the melody.
  var target = clamp01(noteHue);
  var d = target - heldHue;
  if (d > 0.5) d -= 1.0; else if (d < -0.5) d += 1.0;   // wrap to nearest
  heldHue = heldHue + d * clamp01(dt * HUE_TAU);
  heldHue = heldHue - floor(heldHue);
  _noteRgb(heldHue);

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  washPhase = washPhase + dt * WASH_RATE * (0.4 + rateMul);
  washPhase = washPhase - floor(washPhase);
  glintPhase = glintPhase + dt * GLINT_RATE * (0.5 + rateMul);
  glintPhase = glintPhase - floor(glintPhase);
}

export function render3D(index, x, y, z) {
  var xn = clamp01(x);
  var yn = clamp01(y);
  var dx = xn - 0.5;
  var dy = yn - 0.5;
  var rad = sqrt(dx * dx + dy * dy);
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;
  var coreFall = 1.0 - radN; if (coreFall < 0.0) coreFall = 0.0;

  // ── calm BASE wash (always-on, never dark): a breathing two-colour body,
  // lifted globally so the rig is clearly lit and welcoming in silence. Its hue
  // is gently tinted toward the held note (the note's colour, even at rest).
  var washProf = 0.60 + 0.40 * coreFall;
  var washBri = base * washProf * (0.76 + 0.24 * wave(washPhase * 0.5 + rad * 1.2));

  // ── GLINT BURST on harmonic change: a scatter of bright points that only
  // light when `burst` is up. Each pixel has a stable seed + animated phase; a
  // pixel glints when its phase is near the top AND the burst is active, so the
  // whole hull scintillates on a chord move and goes quiet between.
  var ph = hash01(xn * 9.0, yn * 9.0);
  var tw = wave(glintPhase + ph);
  var thr = 1.0 - 0.55 * burst;                      // burst lowers the bar -> more glints
  var glint = tw - thr;
  if (glint < 0.0) glint = 0.0;
  glint = glint / (1.0 - thr + 0.0001);
  var glintBri = burst * glint * (0.6 + 0.4 * coreFall);

  var bri = clamp01(washBri + glintBri);

  // ── colour. Base wash sits MOSTLY on the live NOTE colour (so the rig hue
  // tracks the melody clearly — like 63_note_color's tight-tracking fix) with
  // cp1 only a faint cool floor underneath; the glints are the NOTE colour
  // (mixed with cp2 hot) so a chord move arrives in its colour.
  var washMix = clamp01(0.62 + 0.28 * coreFall);     // strong note tint (0.62 rim .. 0.90 centre)
  var wr = pr1 + (nr - pr1) * washMix;
  var wg = pg1 + (ng - pg1) * washMix;
  var wb = pb1 + (nb - pb1) * washMix;

  var gr = nr * 0.6 + pr2 * 0.4;                      // glint = note tint + hot accent
  var gg = ng * 0.6 + pg2 * 0.4;
  var gb = nb * 0.6 + pb2 * 0.4;

  // composite: wash body + glint (glint dominates where it lights).
  var r = wr * washBri + gr * glintBri;
  var g = wg * washBri + gg * glintBri;
  var b = wb * washBri + gb * glintBri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
