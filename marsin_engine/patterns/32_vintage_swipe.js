/*
  32_vintage_swipe.js

  HIGH-CONTRAST VERTICAL SWIPE ON THE VINTAGE STRIPS — self-filtered to fId 5..6.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 5 or > 6. Only the two 6-head Vintage strips light up; the
  pars (1..4) and bars (7,8) stay dark under this pattern.

  AXIS = PHYSICAL Y (up<->down). The vintage heads are stacked vertically: from
  test_bench.js the strips span normalized y from 0.0 (bottom head) to ~0.273
  (top head), with both strips at the same heights. We normalize y to the strip
  extent (`VINT_Y_MAX`) so the swipe spans the full column 0..1, then sweep that
  — by PHYSICAL height, not LED index. Both strips swipe together (mirrored).

  THE SWIPE: a narrow bright band (`swipeWidth`, in normalized column units)
  whose centre is the swipe position. Heads under the band are FULL brightness
  on the strict cp1<->cp2 palette; everything else sits at a tiny floor
  (`BASE_FLOOR`) — hard on/off, maximum contrast. Linear distance; the band
  restarts at the bottom when the auto-animation phase wraps (sawtooth).

  POSITION / DIRECTION:
    - `localSpeed` auto-animates the band 0->1 (set 0 to freeze and position by
      `swipeY`).
    - `swipeY` (0..1) is the modulation-drivable swipe position along the column.
    - `swipeDir` flips travel: <0.5 = DOWN->UP (bottom->top), >=0.5 = UP->DOWN.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwipeY     (swipeY)     <- micLow
      MODULATE sliderSwipeWidth (swipeWidth) <- micDomEnergy1
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // auto-animate rate (0 = freeze, drive by swipeY)
export var swipeY = 0.0;       // 0..1 swipe position along the vertical column
export var swipeWidth = 0.26;  // band width in normalized column units (~1.5 heads)
export var swipeDir = 0.0;     // <0.5 = DOWN->UP, >=0.5 = UP->DOWN
export var glow = 0.4;         // overall glow of the swipe area (soft halo bloom)
export var trail = 0.4;        // pixelated fading tail behind the swipe (0 = none)

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 (bottom / cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 (top / amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwipeY(v) { swipeY = v; }
export function sliderSwipeWidth(v) { swipeWidth = 0.10 + v * 0.6; }
export function sliderSwipeDir(v) { swipeDir = v; }
export function sliderGlow(v) { glow = v; }
export function sliderTrail(v) { trail = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var VINT_Y_MAX = 0.273; // top of the vintage column in normalized y (test_bench)
var MAX_RATE = 0.5;     // sweeps per second at localSpeed = 1.0 (slow-ish)
var BASE_FLOOR = 0.04;  // tiny resting glow on un-swept heads (P0: not a blackout)
var GLOW_MULT = 3.0;    // glow halo radius = halfW * (1 + glow * GLOW_MULT)
var TRAIL_N = 12;       // trail history length (frames) — short, pixelated tail

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
var centerHist = array(12); // ring buffer of past swipe centres (trail)
var histHead = 0;       // next write slot
var histInit = 0;       // 0 until seeded

// Soft glow halo around the band: a raised-cosine that bleeds `glow`-scaled
// brightness out to halfW*(1+glow*GLOW_MULT) — the "glow of the swipe area".
function glowProfile(dist, halfW) {
  if (glow <= 0.0) return 0.0;
  var radius = halfW * (1.0 + glow * GLOW_MULT);
  if (dist >= radius) return 0.0;
  return (0.5 + 0.5 * cos(dist / radius * PI)) * glow;
}

// Pixelated fading trail: a head lights if the band passed over it in the last
// TRAIL_N frames, dimming with age (scaled by `trail`). Reads the past
// swipe-centre history so the tail sits behind the motion, quantised to heads.
function trailGlow(posn, halfW) {
  if (trail <= 0.0) return 0.0;
  var acc = 0.0;
  for (var kk = 1; kk < TRAIL_N; kk++) {
    var idx = histHead - 1 - kk;
    if (idx < 0) idx = idx + TRAIL_N;
    if (abs(posn - centerHist[idx]) <= halfW) {
      var fdamt = trail * (1.0 - kk / TRAIL_N);
      if (fdamt > acc) acc = fdamt;
    }
  }
  return acc;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  phase = phase + dt * localSpeed * MAX_RATE;
  phase = phase - floor(phase);

  // Auto phase + the modulatable position, then flip for direction. Wrap ONLY
  // past 1.0 so swipeY = 1.0 stays the top edge (a plain mod folds 1->0).
  var pp = phase + swipeY;
  if (pp > 1.0) pp = pp - floor(pp);
  if (swipeDir >= 0.5) pp = 1.0 - pp;
  swipeCenter = pp;

  // Record the centre for the pixelated trail (seed on first frame).
  if (histInit == 0) {
    for (var kk = 0; kk < TRAIL_N; kk++) centerHist[kk] = swipeCenter;
    histInit = 1;
  }
  centerHist[histHead] = swipeCenter;
  histHead = histHead + 1;
  if (histHead >= TRAIL_N) histHead = 0;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the two vintage strips (fId 5..6) ─────────────────
  if (fixtureId < 5 || fixtureId > 6) { rgb(0, 0, 0); return; }

  // PHYSICAL Y position 0..1 along the column: y=0 (bottom) .. VINT_Y_MAX (top).
  var pos = clamp01(y / VINT_Y_MAX);

  // Linear distance from the swipe centre along the vertical column.
  var dist = abs(pos - swipeCenter);

  // Hard on/off core band, then add the glow halo and pixelated trail.
  var halfW = swipeWidth * 0.5;
  var bri = BASE_FLOOR;
  if (dist <= halfW) bri = 1.0;
  var gl = glowProfile(dist, halfW);
  if (gl > bri) bri = gl;
  var tr = trailGlow(pos, halfW);
  if (tr > bri) bri = tr;

  // Lit colour blends cp1->cp2 along the swipe position (stays on palette).
  var tcol = clamp01(swipeCenter);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
