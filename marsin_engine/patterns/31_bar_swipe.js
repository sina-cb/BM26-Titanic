/*
  31_bar_swipe.js

  HIGH-CONTRAST SWIPE ACROSS THE TWO BARS — self-filtered to fixtureId 7..8.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 7 or > 8. Only the two 18-pixel ShehdsBar strips light up; the
  pars (1..4) and vintage strips (5,6) stay dark under this pattern.

  THE BAR ROW (by LED INDEX, not physical position): the two 18-pixel bars are
  treated as ONE continuous strip of 36 LEDs addressed by wiring order, NOT by
  physical x/y. Combined index runs 0..35: fId7 (global index 16..33) -> 0..17,
  fId8 (global index 34..51) -> 18..35. This is the operator's explicit ask —
  sweep along the bar INDEX within the group (0 -> 36, a mix of both strips),
  ignoring any up/down/physical layout.

  THE SWIPE: a SINGLE bright LED (≈one pixel, `swipeWidth` is in PIXELS) walks
  the 0..35 index slowly. The lit pixel is FULL brightness on the strict
  cp1<->cp2 palette; every other LED sits at a tiny floor (`BASE_FLOOR`) — hard
  on/off, maximum contrast. Distance is LINEAR in index space; when the
  auto-animation phase wraps 1->0 the pixel restarts at index 0 (sawtooth).

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
export var swipeWidth = 1.0;   // lit window width in PIXELS (1 = single LED)
export var swipeDir = 0.0;     // <0.5 = index 0->35, >=0.5 = 35->0

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 (left edge / cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 (right edge / amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwipeX(v) { swipeX = v; }
export function sliderSwipeWidth(v) { swipeWidth = 1.0 + v * 6.0; } // 1..7 LEDs
export function sliderSwipeDir(v) { swipeDir = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var BAR_N = 36;         // total bar LEDs across both strips (18 + 18)
var BAR_BASE = 16;      // global pixel index of the first bar LED (fId7 start)
var MAX_RATE = 0.3;     // sweeps per second at localSpeed = 1.0 (slow single-pixel walk)
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

  // Combined LED index across BOTH bars in wiring order: fId7 -> 0..17,
  // fId8 -> 18..35 (fId7 starts at global index 16, fId8 at 34 = 16 + 18).
  var barIdx = index - BAR_BASE;

  // Swipe centre as a pixel position along the 0..35 combined strip, and the
  // linear distance (in pixels) from this LED to that position.
  var target = swipeCenter * (BAR_N - 1.0);
  var dpx = abs(barIdx - target);

  // Hard on/off single-pixel window (swipeWidth is in PIXELS, 1 = one LED).
  var halfW = swipeWidth * 0.5;
  var bri = BASE_FLOOR;
  if (dpx <= halfW) bri = 1.0;

  // Lit colour blends cp1->cp2 along the swipe position (stays on palette).
  var tcol = clamp01(swipeCenter);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
