/*
  47_quasicrystal_dunes.js — HD, SOUND-REACTIVE QUASICRYSTAL DUNES.

  A high-definition reinterpretation of 17_rolling_color_dunes. Instead of a
  stack of ad-hoc shear/contour waves, the dune field is a true QUASICRYSTAL
  interference pattern: the sum of 5 plane cosine waves whose propagation
  directions sit at k*72deg (k = 0..4). Five-fold symmetry is incommensurate
  with the integer plane lattice, so the field is QUASI-PERIODIC — it rolls and
  reshapes forever and NEVER exactly repeats.

  CORE EQUATION (per pixel, p = (px,py) in plane units):
      field = (1/5) * sum_{k=0..4} cos( (cos(ak)*px + sin(ak)*py)*PI2 - drift )
      where  ak = k*2pi/5 + phi*PHI ,  PHI = 1.618... (golden, irrational),
             drift = rollPhase (irrational accumulation), phi = slow rotation.
  The k*72deg basis + the irrational golden rotation of the whole basis +
  irrational per-wave drift => no integer period in space OR time.

  The crests of `field` are sharpened (pow + a tunable surf-line gate) into
  crisp bright surf-lines on dark troughs (HD). Colour blends along the field:
  TROUGH = cp1 (cool), CREST = cp2 (warm), so both palette colours show.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderDuneHeight <- micLow  range 0.30..0.95 curve linear   # PRIMARY brightness/dune height
    sliderSurf       <- micHigh range 0.00..0.85 curve pow2     # 2nd dim: crest sharpness/surf shimmer
  Static (unmapped) params: localSpeed, duneScale, floor, colorPalette1/2.
  At slider rest the rig shows calm, never-black dunes (mission-critical glow).

  CONTROLS (UI order = declaration order)
    - localSpeed  : dune roll + basis-rotation rate.
    - duneHeight  : overall dune brightness / height (PRIMARY audio handle).
    - surf        : crest sharpness + surf-line shimmer (2nd audio handle).
    - duneScale   : spatial frequency of the quasicrystal (zoom).
    - floor       : calm base glow so silence is never fully black.
    - colorPalette1/2 : cp1 trough (cool), cp2 crest (warm).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // dune roll + rotation rate
export var duneHeight = 0.5;   // PRIMARY audio handle: brightness/height (micLow) — mid bias
export var surf = 0.5;         // 2nd audio handle: crest sharpness/shimmer (micHigh)
export var duneScale = 0.5;    // spatial frequency (zoom)
export var floor_ = 0.1;       // calm base glow (never fully black)

export var cp1H = 0.55, cp1S = 0.85, cp1V = 0.8; // palette 1 — trough (cool cyan)
export var cp2H = 0.08, cp2S = 0.95, cp2V = 1.0; // palette 2 — crest (warm amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDuneHeight(v) { duneHeight = v; } // micLow maps here
export function sliderSurf(v) { surf = v; }             // micHigh maps here
export function sliderDuneScale(v) { duneScale = v; }
export function sliderFloor(v) { floor_ = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var PHI = 1.6180339887;   // golden ratio — irrational basis-rotation factor
var DRIFT2 = 0.6180339887; // 1/PHI — second irrational drift term

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

// ── Persistent / per-frame state (frame-to-frame accumulation; SPEC §9.4) ────
var rollPhase = 0.0;    // irrational drift of every plane wave (the dunes roll)
var rotPhase = 0.0;     // slow rotation of the whole 5-fold basis (never repeats)
var shimmerT = 0.0;     // surf-line shimmer phase
// Precomputed basis directions (cos/sin of each of the 5 angles), refreshed
// per frame because the basis slowly rotates by an irrational amount.
var dcx = array(5);
var dcy = array(5);

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var rate = pow(2.0, (localSpeed - 0.5) * 3.0);
  rollPhase = rollPhase + dt * rate * 0.34;       // dunes roll (irrational below)
  rotPhase = rotPhase + dt * rate * 0.013;        // basis rotates very slowly
  shimmerT = shimmerT + dt * rate * (0.6 + surf); // surf shimmer speeds with surf
  if (rollPhase > 100000.0) rollPhase = rollPhase - 100000.0;
  if (shimmerT > 100000.0) shimmerT = shimmerT - 100000.0;

  // 5 plane-wave directions at k*72deg, the WHOLE basis rotated by an
  // irrational angle (rotPhase * PHI) so the quasicrystal never repeats.
  for (var kk = 0; kk < 5; kk++) {
    var ak = kk * (PI2 / 5.0) + rotPhase * PHI;
    dcx[kk] = cos(ak);
    dcy[kk] = sin(ak);
  }
}

export function render3D(index, x, y, z) {
  // ── Map each section into one shared plane (px,py) so the quasicrystal is
  //    coherent across the whole rig (coordinate-driven, full coverage). ──────
  var nx = clamp01((x + 0.6) / 2.4);   // world x ~ -0.4..1.62  -> 0..~0.9
  var ny = clamp01(y / 2.2);           // world y 0..2          -> 0..~0.9

  var sc = 1.4 + duneScale * 5.2;       // plane frequency (zoom)
  var px = nx * sc;
  var py = ny * sc + z * 0.35;          // z lifts bars off the par/vintage plane

  // ── Sum of 5 cosine plane waves (the quasicrystal interference field). ─────
  // Each wave drifts by an irrational amount so crests roll without repeating.
  var fieldv = 0.0;
  for (var kk = 0; kk < 5; kk++) {
    var proj = dcx[kk] * px + dcy[kk] * py;
    fieldv = fieldv + cos(proj * PI2 - rollPhase - kk * DRIFT2);
  }
  fieldv = fieldv / 5.0;                 // -1..1
  var f01 = fieldv * 0.5 + 0.5;          // 0..1, dune surface

  // ── Sharpen crests into crisp surf-lines (HD). `surf` raises the exponent
  //    so highs cut the crests sharper; a thin surf-gate adds a bright lip.
  //    The crest peak is energy-compensated (* (1 + surf*..)) so sharpening
  //    reshapes the dune WITHOUT collapsing total brightness — that keeps surf
  //    a SHAPE dimension and leaves overall brightness to duneHeight. ─────────
  var sharp = 1.4 + surf * 2.6;
  var dune = pow(f01, sharp) * (1.0 + surf * 0.9); // sharpened, energy-compensated

  // Crisp surf-line lip near the very top of each crest, shimmering with highs.
  var lip = 0.0;
  if (f01 > 0.62) {
    var edge = (f01 - 0.62) / 0.38;      // 0..1 across the crest band
    edge = clamp01(edge);
    var shimmer = 0.6 + 0.4 * wave(shimmerT + index * 0.13 + f01 * 1.7);
    lip = edge * edge * (0.25 + surf * 0.95) * shimmer;
  }
  var crest = clamp01(dune + lip);

  // ── Brightness: PRIMARY audio handle (duneHeight) scales the whole field;
  //    a calm floor keeps the rig glowing in silence (never fully black). The
  //    floor is small and the dune term dominates, so micLow->duneHeight is the
  //    primary driver of overall brightness (corr requirement). ──────────────
  var base = floor_ * 0.42 * (0.5 + 0.5 * wave(rollPhase * 0.07 + ny * 0.6 + nx * 0.4));
  var dh = clamp01(duneHeight);
  var height = 0.12 + dh * dh * 2.0;     // super-linear: micLow strongly drives brightness
  var bri = base + crest * height;
  bri = clamp01(bri);

  // ── Colour: trough = cp1, crest = cp2 (blend by the dune surface). ─────────
  var tcol = clamp01(f01 * 0.85 + crest * 0.15);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Crisp white pop on the surf-line lip only (W channel) for HD highlights.
  var ww = lip * clamp01(duneHeight) * 0.5;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
