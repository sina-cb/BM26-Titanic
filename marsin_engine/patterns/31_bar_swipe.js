/*
  31_bar_swipe.js

  SHARP 1-PIXEL HORIZONTAL SWIPE ACROSS THE TWO BARS — self-filtered to fId 7..8.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 7 or > 8. Only the two 18-pixel ShehdsBar strips light up; the
  pars (1..4) and vintage strips (5,6) stay dark under this pattern.

  PIXEL-ORDINAL SPACE (physical left->right). Each bar LED is ranked 0..35 by
  PHYSICAL x position (verified monotonic against the model): fId7 -> 33-index
  (0..17, left bar), fId8 -> 69-index (18..35, right bar). The inter-bar gap
  collapses to contiguous ordinals so the swipe crosses both bars as one
  continuous run. Working in ordinal space makes the core exactly ONE LED and
  the trail/blur crisp on the big pixels.

  THE SWIPE:
    - CORE: always exactly ONE LED — the pixel whose ordinal == round(center).
      Full brightness on the strict cp1<->cp2 palette (no width knob; sharp).
    - BLUR (0..1): soft halo that bleeds onto neighbouring LEDs out to
      ±BLUR_MAX·blur pixels (raised-cosine). 0 = hard single pixel.
    - TRAIL (0..1): pixelated fading tail — any LED that was the core within the
      last TRAIL_N frames lights, dimming with age. Quantised to LEDs, so it
      stays crisp; sits BEHIND the motion (reads the past-centre history).

  POSITION / DIRECTION:
    - `localSpeed` auto-animates the swipe (0 = freeze, position by `swipeX`).
    - `swipeX` (0..1) is the modulation-drivable position along x.
    - `swipeDir` <0.5 = LEFT->RIGHT, >=0.5 = RIGHT->LEFT.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwipeX (swipeX) <- micLow
      MODULATE sliderTrail  (trail)  <- micDomEnergy1
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // auto-animate rate (0 = freeze, drive by swipeX)
export var swipeX = 0.0;       // 0..1 swipe position along x (modulatable)
export var swipeDir = 0.0;     // <0.5 = L->R, >=0.5 = R->L
export var blur = 0.3;         // soft halo bleed onto neighbour LEDs (0 = hard 1px)
export var trail = 0.5;        // pixelated fading tail behind the swipe (0 = none)

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 (left edge / cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 (right edge / amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwipeX(v) { swipeX = v; }
export function sliderSwipeDir(v) { swipeDir = v; }
export function sliderBlur(v) { blur = v; }
export function sliderTrail(v) { trail = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var PIX_N = 36;         // bar LEDs across both strips (physical-ordinal range)
var MAX_RATE = 0.5;     // sweeps per second at localSpeed = 1.0 (slow-ish)
var BASE_FLOOR = 0.04;  // tiny resting glow on un-swept pixels (P0: not a blackout)
var BLUR_MAX = 4.0;     // max halo radius in LEDs at blur = 1.0
var TRAIL_N = 14;       // trail history length (frames) — pixelated tail

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
var phase = 0.0;            // internal auto-animation phase, 0..1
var centerOrd = 0.0;        // resolved swipe centre this frame, in LED ordinals
var coreOrd = 0;            // nearest LED ordinal (the sharp 1px core)
var ordHist = array(14);    // ring buffer of past core ordinals (trail)
var histHead = 0;
var histInit = 0;

// Pixelated fading trail: brightness at LED `ord` from the core-ordinal history.
function trailAt(ordv) {
  if (trail <= 0.0) return 0.0;
  var acc = 0.0;
  for (var kk = 1; kk < TRAIL_N; kk++) {
    var idx = histHead - 1 - kk;
    if (idx < 0) idx = idx + TRAIL_N;
    if (ordHist[idx] == ordv) {
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
  // past 1.0 so swipeX = 1.0 stays the right edge.
  var pp = phase + swipeX;
  if (pp > 1.0) pp = pp - floor(pp);
  if (swipeDir >= 0.5) pp = 1.0 - pp;

  centerOrd = pp * (PIX_N - 1.0);
  coreOrd = floor(centerOrd + 0.5);   // sharp single-LED core

  // Record the core ordinal for the pixelated trail (seed on first frame).
  if (histInit == 0) {
    for (var kk = 0; kk < TRAIL_N; kk++) ordHist[kk] = coreOrd;
    histInit = 1;
  }
  ordHist[histHead] = coreOrd;
  histHead = histHead + 1;
  if (histHead >= TRAIL_N) histHead = 0;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the two bars (fId 7..8) ───────────────────────────
  if (fixtureId < 7 || fixtureId > 8) { rgb(0, 0, 0); return; }

  // Physical-x LED ordinal 0..35 (left->right across both bars).
  var ord;
  if (fixtureId == 7) ord = 33 - index;   // left bar  (idx 16..33 -> 17..0)
  else ord = 69 - index;                  // right bar (idx 34..51 -> 35..18)

  // Sharp 1-pixel core.
  var bri = BASE_FLOOR;
  if (ord == coreOrd) bri = 1.0;

  // Blur: soft halo onto neighbouring LEDs (raised-cosine over ±BLUR_MAX*blur).
  if (blur > 0.0) {
    var radius = BLUR_MAX * blur;
    var dd = abs(ord - centerOrd);
    if (dd < radius) {
      var bv = 0.5 + 0.5 * cos(dd / radius * PI);
      if (bv > bri) bri = bv;
    }
  }

  // Pixelated trail behind the swipe.
  var tr = trailAt(ord);
  if (tr > bri) bri = tr;

  // Lit colour blends cp1->cp2 along the swipe position (stays on palette).
  var tcol = clamp01(centerOrd / (PIX_N - 1.0));
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
