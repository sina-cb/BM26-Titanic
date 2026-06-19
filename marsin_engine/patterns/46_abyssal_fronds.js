/*
  46_abyssal_fronds.js — ABYSSAL FRONDS (HD, sound-reactive).

  An HD, audio-reactive reinterpretation of 22_abyssal_sway_garden. Vertical
  fronds / kelp stand across the whole rig and sway laterally in a slow abyssal
  current: a low-frequency lateral drift whose phase is IRRATIONAL per frond, so
  the garden never repeats. The frond BODY is cp1 (deep blue/green water); each
  frond's phosphorescent glowing TIP is cp2 (bright, distinct) so BOTH palette
  colours always read on the rig. HD comes from sharp bright tips on crisp
  stalks over genuinely DARK water between fronds — never a mushy wash.

  SPATIAL LAYOUT (coordinate-driven, covers the whole rig):
    - Every section roots fronds in nx (lateral) and grows them in height.
    - PARS  (sId 1, ny~1.0)   : short fronds at the top edge — tips read here.
    - BARS  (sId 3, ny~0.636) : the broad mid-water band of swaying stalks.
    - VINTAGE (sId 2, fId 5-6) : the two TALL upper-Y heads. Their 6-head Y stack
      (ny 0..0.2727) is remapped to a FULL 0..1 frond so they read as the
      TALLEST fronds with the BRIGHTEST tips (head_1, top, is the glowing crown).

  IRRATIONAL EQUATION (no integer periods — frondPhase below):
    swayedX = nx + sin(tCur*PI2 + nx*PHI*7)*amp*hw^2
                 + sin(tCur*SQRT2*PI2 + nx*SQRT3*4)*amp*hw*0.5
    frondPhase = swayedX*density + sin(swayedX*GOLDEN)*0.13
      PHI=1.6180339887, SQRT2=1.4142135624, SQRT3=1.7320508076,
      GOLDEN=11.0905 (golden-angle * 1000-ish irrational), density=irr float.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
      MODULATE sliderCurrent (current) <- micLow   (PRIMARY: sway amp + overall
                                                     brightness; corr >= 0.5)
      MODULATE sliderGlints  (glints)  <- micHigh  (tip phosphorescence / glints,
                                                     a DIFFERENT dimension)
  Identity-slider convention: each slider stores v directly; scaling happens in
  render. At rest (silence) the garden glows a calm, non-black blue/green sway.

  CONTROLS (UI order = declaration order)
    - localSpeed : current drift rate (sway + flicker animation speed).
    - current    : sway amplitude + overall brightness. PRIMARY audio handle.
    - glints     : tip phosphorescence / glint intensity. 2nd audio handle.
    - frondDensity : how many fronds stand across the rig.
    - baseGlow   : calm resting brightness floor (never fully black).
    - colorPalette1/2 : cp1 deep abyssal blue body, cp2 bioluminescent tip.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;     // current drift / animation rate
export var current = 0.45;       // PRIMARY: sway amplitude + overall brightness (<- micLow)
export var glints = 0.5;         // 2nd dimension: tip phosphorescence (<- micHigh)
export var frondDensity = 0.5;   // how many fronds stand across the rig
export var baseGlow = 0.4;       // calm resting floor (never fully black)

export var cp1H = 0.58, cp1S = 1.00, cp1V = 1.0; // deep abyssal blue (body)
export var cp2H = 0.33, cp2S = 0.95, cp2V = 1.0; // bioluminescent green (tip)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCurrent(v) { current = v; }     // micLow maps here (PRIMARY)
export function sliderGlints(v) { glints = v; }        // micHigh maps here (2nd dim)
export function sliderFrondDensity(v) { frondDensity = v; }
export function sliderBaseGlow(v) { baseGlow = v; }

// ── Irrational constants (no integer periods anywhere) ──────────────────────
var PHI = 1.6180339887;
var SQRT2 = 1.4142135624;
var SQRT3 = 1.7320508076;
var GOLDEN = 11.0905;     // irrational frond-jitter frequency

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ────────────
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

// ── Per-frame scalars (delta-accumulated so SPEED drags don't phase-jump) ────
var tCur = 0.0;       // slow sway-current phase (turns, 0..1)
var tFlick = 0.0;     // faster phosphorescent flicker phase (turns, 0..1)
var swayAmp = 0.0;    // resolved sway amplitude this frame
var briGain = 0.0;    // resolved overall brightness gain this frame
var density = 7.0;    // resolved frond count this frame (irrational)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed trims drift rate around a slow abyssal pace.
  var rate = 0.25 + localSpeed * 1.4;
  // Sway current drifts at an irrational base; flicker rides faster on SQRT2.
  tCur = tCur + dt * 0.030 * rate;
  tCur = tCur - floor(tCur);
  tFlick = tFlick + dt * 0.14 * rate;
  tFlick = tFlick - floor(tFlick);

  // PRIMARY audio handle: micLow -> `current` drives BOTH sway amplitude and
  // overall brightness, so louder lows visibly sway the garden harder AND
  // brighten it (continuous corr(micLow, brightness) >= 0.5). briGain has a
  // small floor (calm visible garden) but is dominated by the micLow term so
  // total rig brightness tracks the lows.
  swayAmp = 0.08 + current * 0.42;
  briGain = 0.22 + current * 1.40;     // overall brightness rises hard with micLow

  // Irrational frond count, never an integer multiple.
  density = 4.3 + frondDensity * 9.7;
}

export function render3D(index, x, y, z) {
  // ── Lateral root (nx) + per-section frond HEIGHT (hw, 0..1) ──────────────
  // RIG-AGNOSTIC: on test_bench the sectionId roles set the original frond
  // heights (vintage = tallest crowned heads, pars = tip band, bars = mid-water
  // body). On ANY other rig (titanic/dome/logsville, sId not 1..3) the frond
  // height comes straight from the pixel's normalized Y, so the garden grows
  // up the whole ship from coordinates. NEVER returns black.
  var nx = x;
  var hw = 0.0;             // 0 = frond base (dark water), 1 = frond tip (glow)
  if (sectionId == 2) {
    // VINTAGE: the two tall upper-Y heads. Remap each head's 6-step Y stack
    // (normalized y 0..0.2727) to a FULL 0..1 frond so these read as the
    // TALLEST fronds with the BRIGHTEST tips (head_1 at the top is the crown).
    hw = clamp01(y / 0.2727);
  } else if (sectionId == 1) {
    // PARS: short fronds at the very top edge — read mostly as tips.
    hw = 0.72;
  } else if (sectionId == 3) {
    // BARS: the broad mid-water band of swaying stalk bodies.
    hw = 0.5;
  } else {
    // Coordinate-driven frond height: Y maps the dark water base (bottom) up to
    // the glowing tip (top), so fronds stand across the whole rig.
    hw = clamp01(y);
  }

  // ── Lateral sway: slow abyssal current, irrational phase per frond ───────
  // Higher up a frond bends MORE (cantilever): scale by hw^2 on the primary
  // sway, hw on the slow counter-sway. Two irrational frequencies (PHI, SQRT2/
  // SQRT3) never lock into a repeating period.
  var bend = sin(tCur * 6.2831853 + nx * PHI * 7.0) * swayAmp * hw * hw;
  var bendSlow = sin(tCur * SQRT2 * 6.2831853 + nx * SQRT3 * 4.0) * swayAmp * hw * 0.5;
  var swayedX = nx + bend + bendSlow;

  // ── Vertical stalks: a sharpened wave in the swayed-x makes thin fronds. ──
  // Irrational golden jitter offsets each frond so none align (no integer period).
  var frondPhase = swayedX * density + sin(swayedX * GOLDEN) * 0.13;
  var frondRaw = wave(frondPhase);
  var frond = pow(frondRaw, 2.8);   // crisp bright spine, dark water (HD)

  // ── Body: deep blue water along the stalk, brighter toward the tip. The
  // sharp `frond` spine gives HD crisp stalks; a modest soft glow + a small
  // floor keep the water BETWEEN fronds dark (high contrast) while the broad
  // sum still scales cleanly with briGain so total brightness tracks micLow
  // (the bars are the dominant, always-lit mid-water band). ─────────────────
  var heightWeight = pow(hw, 1.15);
  var stalk = frond * 0.80 + pow(frondRaw, 2.2) * 0.18 + 0.05;
  var body = stalk * (0.28 + 0.72 * heightWeight);

  // ── Phosphorescent TIP: localized to the top of each frond, jittered per
  // frond so tips don't flicker in unison. micHigh -> `glints` lowers the
  // threshold and lifts intensity, so highs make the tips glint brighter
  // (a DIFFERENT dimension than micLow's sway/brightness). The tip rides on
  // the frond spine and on the broad top band so the bright cp2 colour shows
  // across the rig (not just the very top heads). ──────────────────────────
  var tipBand = clamp01((hw - 0.40) / 0.60);
  tipBand = tipBand * tipBand;                       // crisp-ish top band
  var flick = wave(tFlick + swayedX * 7.3 + hw * 2.1);
  flick = pow(flick, 3.0);                           // sharp glints
  var glintThresh = 0.22 - glints * 0.20;            // more highs => more glints
  var glint = 0.0;
  if (flick > glintThresh) {
    glint = (flick - glintThresh) / (1.0 - glintThresh + 0.0001);
  }
  // Steady phosphorescent tip whose LEVEL rises with `glints` (micHigh) — a
  // clean 2nd dimension. A gentle time flicker gives life without swamping the
  // glints-driven level (kept small so micHigh->brightness stays a clean corr).
  var tipLevel = tipBand * pow(frond, 0.7);
  var tipGlow = tipLevel * (0.14 + glints * 0.78) * (0.80 + 0.20 * flick);

  // ── Compose: dark water between fronds, calm non-black resting floor. The
  // body brightness is multiplied by briGain (micLow) so total rig brightness
  // tracks the lows; floor is a tiny static lift so silence is never black. ──
  var floorV = baseGlow * 0.045;
  var bri = (body * 0.95 + tipGlow) * briGain + floorV;
  bri = clamp01(bri);

  // ── Palette: dark water leans cp1 (deep blue), the bright frond SPINES and
  // the phosphorescent TIPS read cp2 (bioluminescent green) so BOTH colours are
  // always present across the rig. Driving tcol off the frond spine (`frond`)
  // makes every lit stalk glow green against blue water — the cp1/cp2 split
  // shows on the bars too, not just the tall heads (hueSpread). ─────────────
  var tcol = frond * 0.62 + tipBand * 0.55 + tipGlow * 0.9;
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
