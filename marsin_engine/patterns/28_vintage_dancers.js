/*
  28_vintage_dancers.js

  TWO DANCERS ON THE VINTAGE STRIPS — self-filtered to fixtureId 5..6 only.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 5 or > 6. Only the two 6-head Vintage strips light up; the
  pars (1..4) and bars (7,8) stay dark under this pattern.

  VERTICAL LANES: each vintage is a vertical column of 6 heads. From
  test_bench.js, fId5 (Vintage LEFT) = index 4..9 and fId6 (Vintage RIGHT) =
  index 10..15, head_1 (top) -> head_6 (bottom). We reconstruct each head's
  position WITHIN its own strip from `index` (the "fixture view"):
      rel = index - fixStart[fId];  localPos = rel / 5   (0 = top .. 1 = bottom)

  OWNERSHIP + ECHO: Dancer 1 OWNS the LEFT strip (fId5), dancer 2 OWNS the
  RIGHT strip (fId6). Each dancer's vertical position is its `ball*_x` slider
  (re-used here as the dancer's height along the 6-head lane, 0..1) run through
  its OWN critically-damped dance spring. On each strip the OWNER paints a
  bright soft orb in its own palette; the OTHER dancer appears as a dimmer
  ECHO on the same lane, so the two strips feel coupled without one dominating.

  RED-GLOW BUG FIX: the floor / echo are intentionally DIM and strictly on the
  cp1<->cp2 palette line (no hardcoded RGB, no constant red wash). All colour
  comes from the palette-RGB cache (pr1/pg1/pb1, pr2/pg2/pb2) lerped/screened —
  so the RIGHT strip can never sit at a flat red glow. With the default cyan/
  magenta palette the resting strips read cyan/magenta, never red. baseGlow is
  the palette midpoint, kept low so the strips are alive but not washed out.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderBall1X      (ball1_x)      <- micDomEnergy1   (left height)
      MODULATE sliderBall2X      (ball2_x)      <- micDomEnergy2   (right height)
      MODULATE sliderBall1Energy (ball1_energy) <- micDomEnergy1
      MODULATE sliderBall2Energy (ball2_energy) <- micDomEnergy2
      MODULATE sliderChevronSpeedup (chevronSpeedup) <- micLow
*/

// ── Per-fixture layout (only the vintage strips matter here) ─────────────────
var fixStart = array(9);
var fixLen   = array(9);
fixStart[5] = 4;  fixLen[5] = 6;   // Vintage LEFT  (index 4..9)
fixStart[6] = 10; fixLen[6] = 6;   // Vintage RIGHT (index 10..15)

// ── Exported controls (consistent across 27/28/29) ──────────────────────────
export var localSpeed = 0.5;
export var baseGlow = 0.12;
export var dancerSize = 0.30;
export var dancerGlow = 1.0;
export var chevronSpeedup = 0.0;       // global motion drive (MODULATE <- micLow)
export var ball1_x = 0.35;             // dancer-1 height on the LEFT lane
export var ball1_energy = 0.6;
export var ball2_x = 0.65;             // dancer-2 height on the RIGHT lane
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

var DANCE_OMEGA = 7.0;
var ECHO = 0.40; // the non-owner dancer shows on a lane at 40% strength

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
var d1x = 0.35, d1v = 0.0;
var d2x = 0.65, d2v = 0.0;

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

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the two vintage strips (fId 5..6) ─────────────────
  if (fixtureId < 5 || fixtureId > 6) { rgb(0, 0, 0); return; }

  // Reconstruct this head's vertical position within its own 6-head lane.
  var lenF = fixLen[fixtureId];
  var rel = index - fixStart[fixtureId];
  if (rel < 0) rel = 0;
  if (rel > (lenF - 1)) rel = lenF - 1;
  var localPos = rel / (lenF - 1); // 0 = top head, 1 = bottom head

  var e1 = clamp01(ball1_energy);
  var e2 = clamp01(ball2_energy);
  var halfW1 = dancerSize * (0.6 + 0.4 * e1);
  var halfW2 = dancerSize * (0.6 + 0.4 * e2);
  if (halfW1 < 0.18) halfW1 = 0.18;
  if (halfW2 < 0.18) halfW2 = 0.18;

  // Owner vs echo strengths depend on which strip this is.
  // fId5 (LEFT): dancer 1 owns, dancer 2 echoes.
  // fId6 (RIGHT): dancer 2 owns, dancer 1 echoes.
  var own1 = 1.0; var own2 = ECHO;
  if (fixtureId == 6) { own1 = ECHO; own2 = 1.0; }

  var h1 = orbProfile(abs(localPos - d1x), halfW1);
  var h2 = orbProfile(abs(localPos - d2x), halfW2);
  var lvl1 = dancerGlow * (0.35 + 0.65 * e1) * h1 * own1;
  var lvl2 = dancerGlow * (0.35 + 0.65 * e2) * h2 * own2;

  // Bright cores only for the OWNER (echo stays soft, no white-hot echo).
  var core1 = orbProfile(abs(localPos - d1x), 0.32 * halfW1) * (0.3 + 0.7 * e1) * own1 * own1;
  var core2 = orbProfile(abs(localPos - d2x), 0.32 * halfW2) * (0.3 + 0.7 * e2) * own2 * own2;

  // Floor = DIM palette midpoint (NOT red). All colour from the palette cache.
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

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
