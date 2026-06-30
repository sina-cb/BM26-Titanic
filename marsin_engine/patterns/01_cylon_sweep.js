/*
  01_cylon_sweep.js — "Cylon Sweep" (Knight-Rider scanner eye)

  IDENTITY: a bright beam (cp1, classic red) sweeps side to side across the rig
  X axis over a dim background (cp2, blue), with a soft eye-width falloff and a
  faint background glow. Red eye on blue bg. Knobs preserved: eye width,
  background glow.

  MOTION (clock-driven; never static, never dead-black):
    - localSpeed scales the sweep rate via pow(2,(localSpeed-0.5)*4): 0.5->1x,
      1->~4x, 0->~0.25x. A non-zero BASE_RATE keeps it creeping at localSpeed=0.
    - The eye position is triangle(scanT) so it bounces wall-to-wall.
    - DIRECTION is the product of two signs that are NEVER exactly 0:
        * sliderDirection: guarded user sign (dead-zone clamps to +-0.06).
        * an AUTONOMOUS auto-reverse: sign(0.6 + sin(autoT*PHI)*0.55 ...), a SLOW
          DRIFTING sign function — incommensurate (PHI, SQRT2) so the eye
          occasionally reverses on its own, organically, never on a fixed period.
      effDir = userDir * autoSign; |effDir| >= 0.06 always (no freeze).

  NON-REPEATING MATH (header-documented core):
      autoT advances at AUTO_RATE; auto-reverse weight =
          0.62 + 0.50*sin(autoT*2*PI*PHI) + 0.18*sin(autoT*2*PI*SQRT2)
      Two incommensurate sinusoids (PHI≈1.61803, SQRT2≈1.41421) so the sign
      drift never re-locks. scanT & autoT each wrap at a LARGE multiple of their
      period (PHASE_WRAP) so a scaled phase never jumps a fraction of a cycle.

  HIGH-DEF: crisp pow-shaped eye core, near-black background (tiny floor only),
  hueSpread from cp1(red 0.0) vs cp2(blue 0.6).

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.
  PRIMARY is a clean level->gain (no phase wobble) so corr stays high.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick       <- micKick range 0.00..1.00 curve pow2    # brightness pop on the eye
  sliderRadius     <- micFlux range 0.40..0.90 curve linear  # sweep travel / eye-width amplitude
  sliderTrail      <- micHigh range 0.20..0.80 curve linear  # afterglow / hats sparkle (secondary)
  sliderWhiteLevel <- micLow  range 0.30..0.80 curve linear  # vintage warm-white keep
  sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # vintage-head blinder pop
  # STATIC (omit from audio): localSpeed, eyeWidth, backgroundGlow, direction, blinderBite, colorPalette1/2

    The VINTAGE heads (sectionId == 2) are audience BLINDERS: a soft warm-white
    keep glows there always, and when the eye PASSES under them (or the kick
    hits) the W channel snaps hard to a white punch. sliderBlinderBite shapes how
    snappy/concentrated that hit is. White is ADDITIVE over the strict cp1/cp2
    geometry — pars/bars stay coloured, only the vintage heads carry the bite.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST control; scales sweep rate
export var level = 0.5;        // overall brightness gain (PRIMARY) — mid; audio swings up
export var kick = 0.5;         // kick-driven brightness pop on the eye
export var radius = 0.5;       // sweep travel / eye-width amplitude (audio target)
export var trail = 0.5;        // soft afterglow / glow (audio target)
export var eyeWidth = 0.5;     // eye core half-width knob (identity) — medium eye
export var backgroundGlow = 0.15; // faint background glow knob (identity) — low so the
                               // near-black scanner contrast survives; 0.5+ floods bg.
export var direction = 0.5;    // sweep direction (guarded; never freezes)
export var whiteLevel = 0.5;   // WHITE: overall vintage-head white amount/keep
export var whiteKick = 0.3;    // WHITE: kick-driven blinder pop (transient; low static
                               // default so the steady white does not wash the hue)
export var blinderBite = 0.5;  // WHITE: how snappy/concentrated the blinder hit

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Classic Red eye
export var cp2H = 0.6, cp2S = 1.0, cp2V = 0.5; // Blue background
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderTrail(v) { trail = v; }
export function sliderEyeWidth(v) { eyeWidth = v; }
export function sliderBackgroundGlow(v) { backgroundGlow = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }
export function sliderDirection(v) {
  // Dead-zone guard: slider-center would give 0 (frozen sweep). Keep the sign
  // away from 0 so the user-direction component never freezes.
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_RATE = 0.10;   // sweeps/sec at localSpeed=0 (still creeps)
var SPAN_RATE = 0.50;   // extra sweeps/sec added by localSpeed multiplier
var AUTO_RATE = 0.043;  // auto-reverse drift rate (slow, incommensurate)
var PHI    = 1.61803;
var SQRT2  = 1.41421;
var PHASE_WRAP = 10000.0; // wrap phases far from any in-frame fractional use

// ── Palette RGB cache (strict cp1<->cp2 blending; VERBATIM from 27_swipe) ─────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var scanT = 0.0;       // sweep phase (accumulates; wrapped at PHASE_WRAP)
var autoT = 0.0;       // auto-reverse drift phase (accumulates; wrapped large)
var eyePos = 0.5;      // resolved eye position this frame, 0..1
var briGain = 1.0;     // resolved overall brightness gain this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed scales the sweep rate; BASE_RATE keeps it creeping at 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + SPAN_RATE * localMultiplier;

  // Autonomous, slow, incommensurate auto-reverse weight -> drifting sign.
  autoT = autoT + dt * AUTO_RATE;
  if (autoT >= PHASE_WRAP) autoT = autoT - PHASE_WRAP;
  var w = 0.62 + 0.50 * sin(autoT * 6.2831853 * PHI)
               + 0.18 * sin(autoT * 6.2831853 * SQRT2);
  var autoSign = 1.0;
  if (w < 0.0) autoSign = -1.0;

  // User direction sign (already guarded away from 0 by the setter).
  var userSign = direction;
  if (userSign >= 0.0 && userSign < 0.06) userSign = 0.06;
  else if (userSign < 0.0 && userSign > -0.06) userSign = -0.06;

  var effDir = userSign * autoSign;          // never exactly 0

  // Advance sweep phase. Accumulate and wrap at a LARGE multiple of 1.0 so the
  // triangle() consumer never sees a fractional-cycle jump (no seam).
  scanT = scanT + dt * rate * effDir;
  if (scanT >= PHASE_WRAP) scanT = scanT - PHASE_WRAP;
  if (scanT < 0.0) scanT = scanT + PHASE_WRAP;

  // Eye position bounces wall-to-wall. radius controls sweep travel amplitude
  // (audio target): low radius -> eye hovers near center, high -> full sweep.
  var amp = 0.30 + 0.70 * clamp01(radius);   // 0.30..1.0 of full travel
  var center = 0.5;
  eyePos = center + (triangle(scanT) - 0.5) * amp;

  // PRIMARY: clean level -> overall brightness gain (NO phase wobble).
  // level default 1.0; micLow drives it. Floor keeps silence non-black.
  briGain = 0.22 + 1.25 * clamp01(level);   // mid default ~0.84 keeps the eye core
                                            // bright (peakMaxChan); level=1 -> 1.47 push
}

export function render3D(index, x, y, z) {
  // render3D coords are already 0..1 — use x directly, clamped.
  var nx = clamp01(x);

  // eye-width half-width knob; radius slightly tightens the core at low travel
  // so a small sweep still reads crisp.
  var ew = 0.05 + clamp01(eyeWidth) * 0.30;

  var dist = abs(nx - eyePos);

  // Crisp pow-shaped eye core.
  var eye = 0.0;
  if (dist < ew) {
    eye = 1.0 - (dist / ew);
    eye = pow(eye, 2.0);
  }

  // Soft afterglow / glow halo (trail audio target) — wider, gentle falloff.
  if (trail > 0.0) {
    var gw = ew * (1.5 + trail * 3.0);
    if (dist < gw) {
      var gv = (1.0 - dist / gw);
      gv = gv * gv * trail * 0.55;
      if (gv > eye) eye = gv;
    }
  }

  // Kick pop: kick-driven brightness boost concentrated on the eye core.
  var eyeBri = eye * (1.0 + kick * 1.6);
  if (eyeBri > 1.0) eyeBri = 1.0;

  // Background: faint cp2 glow + small non-black floor (mission-critical
  // visibility — never dead-black even in silence). The floor is large enough
  // that the cp2 (blue) background hue actually registers across the rig — this
  // is what gives hueSpread (red eye vs blue bg span) while still reading as
  // near-black negative space next to the bright eye core.
  // A level-coupled component of the bg floor makes the WHOLE rig's brightness
  // track `level` uniformly (no sweep-phase wobble) -> tighter PRIMARY corr.
  var bgScale = backgroundGlow * 0.45 + 0.055 + clamp01(level) * 0.05;

  // Strict palette: linear-RGB lerp from cp2 (background) to cp1 (eye).
  var r = (pr2 * bgScale) + (pr1 - pr2 * bgScale) * eyeBri;
  var g = (pg2 * bgScale) + (pg1 - pg2 * bgScale) * eyeBri;
  var b = (pb2 * bgScale) + (pb1 - pb2 * bgScale) * eyeBri;

  r = clamp01(r * briGain);
  g = clamp01(g * briGain);
  b = clamp01(b * briGain);

  // VINTAGE BLINDER (sectionId == 2 upper heads). White is its own dimension via
  // the W emitter — additive, only on the vintage heads, so pars/bars keep the
  // strict red/blue geometry. A gentle warm-white keep always glows; the PASS of
  // the eye under a head and/or the kick snaps W hard for an audience punch.
  var w = 0.0;
  var a = 0.0;
  if (sectionId == 2) {
    var wl = clamp01(whiteLevel);
    // blinderBite shapes the eye-pass falloff: high bite -> tighter, snappier.
    var bite = 1.0 + clamp01(blinderBite) * 4.0;
    var pass = pow(eye, bite);                 // eye core proximity -> snappy
    var keep = wl * 0.16;                       // calm always-on warm-white keep
    var passW = pass * wl * (0.5 + 0.5 * clamp01(blinderBite));
    var hitW = clamp01(whiteKick) * (0.55 + 0.45 * pass) * (0.7 + 0.3 * eyeBri);
    w = clamp01((keep + passW + hitW * 1.6) * briGain);
    // Tiny warm amber under the white so the blinder reads warm, not clinical.
    a = clamp01(w * 0.18);
  }

  rgbwau(r, g, b, w, a, 0.0);
}
