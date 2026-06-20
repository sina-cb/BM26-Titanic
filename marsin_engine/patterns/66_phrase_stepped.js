/*
  66_phrase_stepped.js — a MUSICAL STEP on every 8-bar phrase boundary.

  Round-2 audio identity: the engine tracks musical structure — audioPhrasePhase
  ramps 0->1 across the current 8-bar phrase, and audioPhraseBoundary fires a
  one-shot pulse on each phrase wrap (re-anchored on drops). DJs and producers
  build tension over a phrase and resolve it on the boundary; this pattern makes
  the rig feel like it KNOWS the song's grammar:

    SWEEP — within a phrase, a bright bar SWEEPS across the hull driven by
            audioPhrasePhase, so the rig visibly travels from the start of the
            phrase to its end (anticipation: you can SEE the phrase about to wrap).
            The colour also glides cp1->cp2 across the phrase.
    STEP  — on audioPhraseBoundary the rig STEPS: it snaps to the NEXT look in a
            small rotation (the geometry mode advances 0->1->2->3->0 and the
            palette anchor rotates), with a clean flash on the step so the change
            reads as intentional and on-the-music, not random.

  Four geometry modes (radial rings / vertical columns / horizontal bars /
  diagonal) cycle on the boundary, so every 8 bars the rig presents a fresh but
  coherent face — looks designed, follows the music's phrasing.

  A calm base wash keeps the rig alive in silence (mission critical) — never dark.
  Phrase signals are silence-gated upstream (no phrase grid over a noise floor),
  so this pattern only steps when there is a real musical phrase.

  COORDINATE-DRIVEN (x/y + a phase) so it ports test_bench -> titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle drift when no phrase is tracked (never frozen).
    - phrasePhase: audioPhrasePhase 0->1 -> sweep position across the hull.
    - boundary   : audioPhraseBoundary pulse -> STEP to the next geometry/palette.
    - base       : calm base floor (always-on; never dark).
    - level      : overall brightness (operator taste).
    - colorPalette1/2 : cp1 phrase-start -> cp2 phrase-end.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderPhrasePhase <- audioPhrasePhase    range 0.00..1.00 curve linear  # HEADLINE: sweep position across the 8-bar phrase
    sliderBoundary    <- audioPhraseBoundary range 0.00..1.00 curve linear  # STEP geometry + palette on each phrase wrap
  STATIC (operator handles, not audio-mapped): localSpeed, base, level, colorPalette1/2.
  Validate on --synth full_track (audioPhrasePhase ramps 0->1, a boundary wraps at
  ~8 bars). corr(audioPhrasePhase, sweep position) is the headline; the boundary
  steps the geometry mode.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle drift
export var phrasePhase = 0.0;  // 0->1 across the phrase (audio audioPhrasePhase)
export var boundary = 0.0;     // phrase-wrap pulse      (audio audioPhraseBoundary)
export var base = 0.42;        // calm base floor (always-on; never near-dark) — the idle
                               //   wash reads CLEARLY at silence (mission-critical night-
                               //   visibility, ~70/255 like 62/67) while the phrase sweep
                               //   + boundary step flash still pop bright (max-composite).
export var level = 0.9;        // overall brightness

export var cp1H = 0.50, cp1S = 1.0, cp1V = 1.0; // palette 1 — teal (phrase start)
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // palette 2 — magenta (phrase end)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPhrasePhase(v) { phrasePhase = v; }
export function sliderBoundary(v) { boundary = v; }
export function sliderBase(v) { base = 0.18 + v * 0.42; } // 0.18..0.60; never near-dark
export function sliderLevel(v) { level = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var BND_ARM   = 0.5;     // boundary level that arms a STEP (rising edge)
var BND_REARM  = 0.25;   // hysteresis re-arm
var STEP_FALL = 2.2;     // step-flash fall/sec
var MODES      = 4;      // geometry modes cycled on the boundary
var SWEEP_W    = 0.22;   // width of the phrase sweep band
var BASE_RATE  = 0.10;   // idle drift at localSpeed=0.5

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 1;
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

// ── Persistent state ─────────────────────────────────────────────────────────
var mode = 0;          // current geometry mode (0..MODES-1)
var stepFlash = 0.0;   // flash envelope on the STEP
var bndArmed = 1;      // rising-edge arm for the boundary
var paletteRot = 0.0;  // palette anchor rotation (advances on each step)
var driftPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // ── boundary rising edge -> STEP: advance the geometry mode + palette + flash ─
  if (bndArmed == 1 && boundary >= BND_ARM) {
    mode = mode + 1;
    if (mode >= MODES) mode = 0;
    paletteRot = paletteRot + 0.25;          // rotate the palette anchor a quarter
    if (paletteRot >= 1.0) paletteRot = paletteRot - 1.0;
    stepFlash = 1.0;
    bndArmed = 0;
  }
  if (boundary < BND_REARM) bndArmed = 1;

  stepFlash = stepFlash - dt * STEP_FALL;
  if (stepFlash < 0.0) stepFlash = 0.0;

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  driftPhase = driftPhase + dt * BASE_RATE * (0.4 + rateMul);
  driftPhase = driftPhase - floor(driftPhase);
}

// geometry coordinate for the current mode, normalised 0..1
function _geoCoord(gm, gx, gy, grad) {
  if (gm == 0) return grad / 0.7;                     // radial rings
  if (gm == 1) return clamp01(gx);                    // vertical columns (sweep X)
  if (gm == 2) return clamp01(gy);                    // horizontal bars  (sweep Y)
  return clamp01((gx + gy) * 0.5);                    // diagonal
}

export function render3D(index, x, y, z) {
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);

  // ── calm BASE wash (always-on, never dark) — solid 0.72..1.0 floor so the wash
  // is evenly visible across the hull at silence, not a faint flicker. ──────────
  var baseBri = base * (0.72 + 0.28 * wave(driftPhase * 0.5 + rad * 1.4));

  // ── PHRASE SWEEP: a bright band whose position tracks audioPhrasePhase across
  // the current geometry coordinate. As the phrase progresses 0->1 the band
  // travels the hull — you can SEE the phrase advancing toward its boundary.
  var coord = _geoCoord(mode, x, y, rad);             // 0..1 along the mode's axis
  var pos = clamp01(phrasePhase);                     // sweep position from the phrase
  var d = abs(coord - pos);
  var sweepBri = 0.0;
  if (d < SWEEP_W) {
    var prof = 1.0 - d / SWEEP_W;
    sweepBri = prof * prof;                           // soft-edged bright band
  }
  // a soft fill BEHIND the sweep so the traversed part of the phrase stays lit
  // (the rig fills up as the phrase advances), at lower level than the band.
  var fill = 0.0;
  if (coord <= pos) fill = 0.18 * (0.5 + 0.5 * (coord / (pos + 0.001)));

  // ── STEP flash on the boundary: a clean whole-rig pop so the change reads ────
  var flashBri = stepFlash * stepFlash * 0.8;

  // compose
  var bri = baseBri;
  var phraseBri = (sweepBri + fill) * clamp01(level);
  if (phraseBri > bri) bri = phraseBri;
  if (flashBri  > bri) bri = flashBri;
  bri = clamp01(bri);

  // colour glides cp1(start)->cp2(end) across the phrase, offset by the palette
  // rotation that advanced on the last step (so each phrase opens on a new hue
  // anchor). Short-path blend stays within the cp1<->cp2 pair.
  var tcol = clamp01(phrasePhase + paletteRot);
  if (tcol > 1.0) tcol = tcol - 1.0;
  // fold the rotated coordinate back into a 0..1 cp1<->cp2 mix (triangle so it
  // stays a strict two-colour blend, never a third hue).
  var mix = tcol < 0.5 ? tcol * 2.0 : (1.0 - tcol) * 2.0;
  // bias the step flash fully toward cp2 so each step pops hot.
  mix = clamp01(mix + stepFlash * (1.0 - mix));

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  var ww = stepFlash * 0.4;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
