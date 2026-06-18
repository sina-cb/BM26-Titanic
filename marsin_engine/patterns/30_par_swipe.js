/*
  30_par_swipe.js

  SHARP 1-PIXEL SWIPE ACROSS THE FOUR PARS — self-filtered to fixtureId 1..4.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 1 or > 4. Only the four single-pixel ParLights light up; the
  vintage strips (5,6) and bars (7,8) stay dark under this pattern.

  PIXEL-ORDINAL SPACE (physical left->right). Each par is ranked 0..3 by
  PHYSICAL x: fId4 = 0 (leftmost) ... fId1 = 3 (rightmost), i.e. ord = 4-fId
  (verified monotonic against the model). The swipe core is always exactly ONE
  par; blur/trail work in par-ordinal units so they stay crisp.

  THE SWIPE:
    - CORE: exactly ONE par — ordinal == round(center). Full brightness on the
      strict cp1<->cp2 palette.
    - BLUR (0..1): soft bleed onto the neighbouring par(s), ±BLUR_MAX·blur.
    - TRAIL (0..1): pixelated fade — a par that was the core within the last
      TRAIL_N frames lingers, dimming with age.

  POSITION / DIRECTION:
    - `localSpeed` auto-animates the swipe (0 = freeze, position by `swipeX`).
    - `swipeX` (0..1) is the modulation-drivable position along x.
    - `swipeDir` <0.5 = LEFT->RIGHT (fId4->fId1), >=0.5 = R->L.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwipeX (swipeX) <- micLow
      MODULATE sliderTrail  (trail)  <- micDomEnergy1
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // auto-animate rate (0 = freeze, drive by swipeX)
export var swipeX = 0.0;       // 0..1 swipe position along x (modulatable)
export var swipeDir = 0.0;     // <0.5 = L->R, >=0.5 = R->L
export var blur = 0.3;         // soft bleed onto neighbour pars (0 = hard 1 par)
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
var PIX_N = 4;          // four pars (physical-ordinal range)
var MAX_RATE = 0.7;     // sweeps per second at localSpeed = 1.0
var BASE_FLOOR = 0.0;   // un-swept pars OFF (no bg glow on hardware); the swept core is always lit, so the rig is never fully dark
var BLUR_MAX = 1.5;     // max halo radius in pars at blur = 1.0
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
var centerOrd = 0.0;        // resolved swipe centre this frame, in par ordinals
var coreOrd = 0;            // nearest par ordinal (the sharp 1px core)
var ordHist = array(14);    // ring buffer of past core ordinals (trail)
var histHead = 0;
var histInit = 0;

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

  var pp = phase + swipeX;
  if (pp > 1.0) pp = pp - floor(pp);
  if (swipeDir >= 0.5) pp = 1.0 - pp;

  centerOrd = pp * (PIX_N - 1.0);
  coreOrd = floor(centerOrd + 0.5);

  if (histInit == 0) {
    for (var kk = 0; kk < TRAIL_N; kk++) ordHist[kk] = coreOrd;
    histInit = 1;
  }
  ordHist[histHead] = coreOrd;
  histHead = histHead + 1;
  if (histHead >= TRAIL_N) histHead = 0;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the four pars (fId 1..4) ──────────────────────────
  if (fixtureId < 1 || fixtureId > 4) { rgb(0, 0, 0); return; }

  // Physical-x par ordinal: fId4 = 0 (left) ... fId1 = 3 (right).
  var ord = 4 - fixtureId;

  // Sharp 1-par core.
  var bri = BASE_FLOOR;
  if (ord == coreOrd) bri = 1.0;

  // Blur: soft bleed onto neighbour pars.
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
