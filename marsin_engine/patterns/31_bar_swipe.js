/*
  31_bar_swipe.js

  HIGH-CONTRAST SWIPE ACROSS THE TWO BARS — self-filtered to fixtureId 7..8.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 7 or > 8. Only the two 18-pixel ShehdsBar strips light up; the
  pars (1..4) and vintage strips (5,6) stay dark under this pattern.

  THE BAR ROW: the two bars sit side by side and the model's normalized x
  coordinate already runs 0..1 LEFT->RIGHT across BOTH of them as one
  continuous row (test_bench.js: leftmost bar pixel fId7 nx=0.000 ...
  rightmost bar pixel fId8 nx=1.000). So we sweep directly in x-space — no
  per-fixture index math needed (same coordinate convention as
  26_dom_dancers_chevron, which reads `x` as a global 0..1 position).

  THE SWIPE: a single narrow bright window (`swipeWidth`) whose centre is the
  swipe position. Pixels under the window are at FULL brightness on the strict
  cp1<->cp2 palette; everything else sits at a tiny floor (`BASE_FLOOR`) — hard
  on/off, maximum contrast. Distance is LINEAR along the row (the bars are a
  straight left->right run, not a loop): when the auto-animation phase wraps
  1->0 the window restarts at the left, a clean sawtooth chase.

  POSITION / DIRECTION (the "x param"):
    - `localSpeed` auto-animates an internal phase 0->1 (set it to 0 to freeze
      the swipe and position it purely by `swipeX`).
    - `swipeX` (0..1) offsets the swipe centre — this is the modulation-drivable
      "x param". With localSpeed=0 it IS the centre; a modulation on sliderSwipeX
      drives the swipe directly.
    - `swipeDir` flips travel: <0.5 = LEFT->RIGHT, >=0.5 = RIGHT->LEFT.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwipeX     (swipeX)     <- micLow
      MODULATE sliderSwipeWidth (swipeWidth) <- micDomEnergy1
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // auto-animate rate (0 = freeze, drive by swipeX)
export var swipeX = 0.0;       // 0..1 swipe-centre offset (the modulatable x)
export var swipeWidth = 0.18;  // window width along the row (x-space)
export var swipeDir = 0.0;     // <0.5 = L->R, >=0.5 = R->L

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 (left edge / cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 (right edge / amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwipeX(v) { swipeX = v; }
export function sliderSwipeWidth(v) { swipeWidth = 0.05 + v * 0.5; }
export function sliderSwipeDir(v) { swipeDir = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RATE = 1.5;     // sweeps per second at localSpeed = 1.0
var BASE_FLOOR = 0.04;  // tiny resting glow on un-swept pixels (P0: not a blackout)

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

// ── Persistent state ─────────────────────────────────────────────────────────
var phase = 0.0;        // internal auto-animation phase, 0..1
var swipeCenter = 0.0;  // resolved swipe centre this frame, 0..1

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Advance the auto-animation phase (sawtooth, wrapped to 0..1).
  phase = phase + dt * localSpeed * MAX_RATE;
  phase = phase - floor(phase);

  // Resolve the swipe centre: auto phase + the modulatable x offset, then
  // flip for direction. With localSpeed = 0 the centre IS swipeX. Wrap ONLY
  // when the sum runs past 1.0 so swipeX = 1.0 stays the right edge (a plain
  // mod would fold 1.0 -> 0.0 and snap the endpoint back to the left).
  var pp = phase + swipeX;
  if (pp > 1.0) pp = pp - floor(pp);
  if (swipeDir >= 0.5) pp = 1.0 - pp;
  swipeCenter = pp;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the two bars (fId 7..8) ───────────────────────────
  if (fixtureId < 7 || fixtureId > 8) { rgb(0, 0, 0); return; }

  // Row position 0..1: model's normalized x already runs LEFT->RIGHT across
  // both bars as one continuous lane.
  var pos = clamp01(x);

  // Linear distance from the swipe centre along the straight bar row.
  var dist = abs(pos - swipeCenter);

  // Hard on/off window for maximum contrast.
  var halfW = swipeWidth * 0.5;
  var bri = BASE_FLOOR;
  if (dist <= halfW) bri = 1.0;

  // Lit colour blends cp1->cp2 along the swipe position (stays on palette).
  var tcol = clamp01(swipeCenter);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
