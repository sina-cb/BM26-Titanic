/*
  27_par_dancers.js

  TWO DANCERS ACROSS THE FOUR PARS — self-filtered to fixtureId 1..4 only.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 1 or > 4. Only the four single-pixel ParLights light up;
  the vintage strips (5,6) and bars (7,8) stay dark under this pattern.

  THE PAR ROW: the four pars are single pixels arranged left->right in the
  rig. By their physical X (test_bench.js): Par4 is LEFTmost, Par1 RIGHTmost.
  We map each par to a ROW position 0..1 with fId4 = 0.0, fId3 = 0.333,
  fId2 = 0.667, fId1 = 1.0 — i.e. left->right is fId 4,3,2,1. So the four
  pars become ONE horizontal lane the dancers move across.

  TWO DANCERS: `ball1_x` / `ball2_x` (0..1) are the dancers' positions along
  that four-par row. Each runs through its OWN critically-damped dance spring
  (DANCE_OMEGA = 7, danceSpringStep parity) so it glides with no overshoot.
  Each dancer paints a SOFT HALO (raised-cosine) that spans neighbouring pars
  so a dancer between two pars lights both. Dancer 1 leans palette 1, dancer
  2 leans palette 2. A duet BRIDGE glows between the two dancers and brightens
  as they close. `baseGlow` keeps a palette wash on every par (never dark, P0).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderBall1X      (ball1_x)      <- micDomEnergy1
      MODULATE sliderBall2X      (ball2_x)      <- micDomEnergy2
      MODULATE sliderBall1Energy (ball1_energy) <- micDomEnergy1
      MODULATE sliderBall2Energy (ball2_energy) <- micDomEnergy2
      MODULATE sliderChevronSpeedup (chevronSpeedup) <- micLow
*/

// ── Exported controls (consistent across 27/28/29) ──────────────────────────
export var localSpeed = 0.5;
export var baseGlow = 0.12;
export var dancerSize = 0.30;
export var dancerGlow = 1.0;
export var chevronSpeedup = 0.0;       // global motion drive (MODULATE <- micLow)
export var ball1_x = 0.30;
export var ball1_energy = 0.6;
export var ball2_x = 0.70;
export var ball2_energy = 0.6;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // dancer 1 (cyan)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // dancer 2 (magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBaseGlow(v) { baseGlow = v * 0.30; }
export function sliderDancerSize(v) { dancerSize = 0.14 + v * 0.45; }
export function sliderDancerGlow(v) { dancerGlow = v; }
export function sliderChevronSpeedup(v) { chevronSpeedup = v; }
export function sliderBall1X(v) { ball1_x = v; }
export function sliderBall1Energy(v) { ball1_energy = v; }
export function sliderBall2X(v) { ball2_x = v; }
export function sliderBall2Energy(v) { ball2_energy = v; }

// ── Dance spring (danceSpringStep parity) ────────────────────────────────────
var DANCE_OMEGA = 7.0;

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
function screen1(a, b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}
function orbProfile(d, halfW) {
  if (d >= halfW) return 0.0;
  return 0.5 + 0.5 * cos(d / halfW * PI);
}

// ── Persistent state ─────────────────────────────────────────────────────────
var d1x = 0.30, d1v = 0.0;
var d2x = 0.70, d2v = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var k = DANCE_OMEGA * DANCE_OMEGA;
  var c = 2.0 * DANCE_OMEGA;

  var t1 = clamp01(ball1_x);
  d1v = d1v + (k * (t1 - d1x) - c * d1v) * dt;
  d1x = d1x + d1v * dt;
  if (d1x < 0.0) { d1x = 0.0; d1v = 0.0; }
  if (d1x > 1.0) { d1x = 1.0; d1v = 0.0; }

  var t2 = clamp01(ball2_x);
  d2v = d2v + (k * (t2 - d2x) - c * d2v) * dt;
  d2x = d2x + d2v * dt;
  if (d2x < 0.0) { d2x = 0.0; d2v = 0.0; }
  if (d2x > 1.0) { d2x = 1.0; d2v = 0.0; }
}

// Map a par fixtureId (1..4) to its left->right ROW position 0..1.
// fId4=0.0 (left), fId3=0.333, fId2=0.667, fId1=1.0 (right).
function parRowPos(fid) {
  return (4.0 - fid) / 3.0;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the four pars (fId 1..4) ──────────────────────────
  if (fixtureId < 1 || fixtureId > 4) { rgb(0, 0, 0); return; }

  var pos = parRowPos(fixtureId); // 0..1 along the four-par row

  var e1 = clamp01(ball1_energy);
  var e2 = clamp01(ball2_energy);
  // Halo spans ~1.3 par-gaps so a dancer between two pars lights both.
  var halfW1 = dancerSize * (0.6 + 0.4 * e1);
  var halfW2 = dancerSize * (0.6 + 0.4 * e2);
  if (halfW1 < 0.20) halfW1 = 0.20;
  if (halfW2 < 0.20) halfW2 = 0.20;

  var h1 = orbProfile(abs(pos - d1x), halfW1);
  var h2 = orbProfile(abs(pos - d2x), halfW2);
  var lvl1 = dancerGlow * (0.35 + 0.65 * e1) * h1;
  var lvl2 = dancerGlow * (0.35 + 0.65 * e2) * h2;

  // Bright cores.
  var core1 = orbProfile(abs(pos - d1x), 0.35 * halfW1) * (0.3 + 0.7 * e1);
  var core2 = orbProfile(abs(pos - d2x), 0.35 * halfW2) * (0.3 + 0.7 * e2);

  // Duet bridge between the dancers (brighter as they close).
  var lo = d1x; var hi = d2x;
  if (hi < lo) { var sw = lo; lo = hi; hi = sw; }
  var gap = hi - lo;
  var bridge = 0.0;
  if (pos > lo && pos < hi && gap > 0.001) {
    var bspan = (pos - lo) / gap;
    var bShape = 0.5 + 0.5 * cos((bspan - 0.5) * PI2);
    var closeness = clamp01(1.0 - gap);
    bridge = bShape * (0.16 + 0.40 * closeness) * (0.5 * (e1 + e2));
  }

  var midR = (pr1 + pr2) * 0.5;
  var midG = (pg1 + pg2) * 0.5;
  var midB = (pb1 + pb2) * 0.5;

  var r = baseGlow * midR;
  var g = baseGlow * midG;
  var b = baseGlow * midB;

  r = screen1(r, lvl1 * pr1); r = screen1(r, lvl2 * pr2);
  g = screen1(g, lvl1 * pg1); g = screen1(g, lvl2 * pg2);
  b = screen1(b, lvl1 * pb1); b = screen1(b, lvl2 * pb2);

  r = screen1(r, core1); r = screen1(r, core2);
  g = screen1(g, core1); g = screen1(g, core2);
  b = screen1(b, core1); b = screen1(b, core2);

  r = screen1(r, bridge * midR);
  g = screen1(g, bridge * midG);
  b = screen1(b, bridge * midB);

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
