/*
  32_caustic_shimmer.js — high-def water CAUSTICS with crisp shimmer glints.

  Amalgamates 14_lunar_current (layered sine current), 16_ghost_tide_uv
  (sweep + UV/white foam) and 07_shimmer (fine pow-sharpened glints):

    1. A smooth CAUSTIC field: layered sine interference over (x,y,time)
       creates flowing bright veins, like sunlight refracting on a pool
       floor. `depth` raises the contrast so the veins pop crisply.
    2. Fine, crisp SHIMMER glints scattered on top — high-frequency
       sparkles whose DENSITY and BRIGHTNESS scale with `shimmer`. Glints
       use the W (white) channel via rgbwau so they read as sharp white
       points over the teal caustics.
    3. A RIPPLE brightness pulse on kick — `ripple` momentarily lifts the
       whole caustic field, an expanding swell each beat.

  HIGH-DEF: base floor is a tiny time-based caustic minimum so the rig is
  never fully black (mission-critical visibility) while silent, yet
  un-veined pixels stay near-black for true high contrast. Glints are
  single-point sharp (pow-sharpened), not blurry.

  Coordinate-driven (nx,ny over x,y) so it ports from test_bench to the
  real rig: Pars (X), Vintage (Y), Bars (X) all sample the same field.

  CONTROLS (declaration order = UI order)
    - localSpeed : caustic flow rate.
    - shimmer    : glint density + brightness (highs).
    - ripple     : kick brightness-pulse amount.
    - depth      : caustic contrast (vein sharpness).
    - base       : minimum floor brightness.
    - colorPalette1/2 : cp1 deep teal (veins) <-> cp2 pale cyan/white (crests).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
      MODULATE sliderShimmer (shimmer) <- micHigh
      MODULATE sliderRipple  (ripple)  <- micKick
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // caustic flow rate
export var shimmer = 0.35;     // glint density + brightness (highs)
export var ripple = 0.0;       // kick brightness-pulse amount
export var depth = 0.6;        // caustic contrast (vein sharpness)
export var base = 0.12;        // minimum floor brightness

export var cp1H = 0.50, cp1S = 1.00, cp1V = 1.0; // deep teal (veins)
export var cp2H = 0.52, cp2S = 0.25, cp2V = 1.0; // pale cyan / near-white (crests)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderRipple(v) { ripple = v; }
export function sliderDepth(v) { depth = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var CAUSTIC_DENSITY = 3.2;   // spatial frequency of the interference field
var GLINT_DENSITY = 34.0;    // spatial frequency of the shimmer glints
var RIPPLE_DECAY = 2.6;      // how fast the kick swell fades (per second)

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
var flowA = 0.0;       // caustic drift phase A
var flowB = 0.0;       // caustic drift phase B
var glintT = 0.0;      // glint scintillation phase
var rippleEnv = 0.0;   // decaying envelope of the kick pulse

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  flowA = time(0.030 / localMultiplier);
  flowB = time(0.017 / localMultiplier);
  glintT = time(0.011 / localMultiplier);

  _hsv2rgb1();
  _hsv2rgb2();

  // Kick pulse: `ripple` (driven by micKick) re-arms a decaying swell so the
  // beat reads as an expanding brightness lift even between mod updates.
  if (ripple > rippleEnv) rippleEnv = ripple;
  rippleEnv = rippleEnv - dt * RIPPLE_DECAY;
  if (rippleEnv < 0.0) rippleEnv = 0.0;
}

export function render3D(index, x, y, z) {
  // ── Portable normalized coords (cover the whole rig) ────────────────────
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  // ── Caustic field: layered sine interference (smooth flowing veins) ──────
  var w1 = wave((nx * CAUSTIC_DENSITY) + (ny * 0.7) - flowA);
  var w2 = wave((ny * CAUSTIC_DENSITY * 0.8) - (nx * 0.5) + flowB);
  var w3 = wave((nx * CAUSTIC_DENSITY * 0.45) + (ny * CAUSTIC_DENSITY * 0.45) + flowA * 0.5);
  var field = (w1 * 0.4) + (w2 * 0.35) + (w3 * 0.25);

  // Sharpen into crisp veins. `depth` raises the exponent for tighter cores.
  var sharp = 1.6 + depth * 4.0;
  var caustic = pow(field, sharp);

  // ── Time-based base floor so it's never fully black when silent ──────────
  var floorPulse = base * (0.5 + 0.5 * wave(ny * 0.6 + flowB));

  // ── Ripple swell on kick: lifts the whole caustic field ──────────────────
  var swell = 1.0 + rippleEnv * 1.4 * (0.5 + 0.5 * caustic);

  var bri = clamp01(floorPulse + caustic * swell);

  // Continuous shimmer GAIN: highs scale the whole caustic body up smoothly
  // across the entire rig, so total brightness tracks micHigh measurably.
  // (The sparse W glints below are the crisp visual hook on top of this.)
  var gain = 0.42 + shimmer * 1.05;
  bri = clamp01(bri * gain);

  // Colour: cp1 (teal vein body) -> cp2 (pale crest) along caustic strength.
  var tcol = clamp01(caustic);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // ── Crisp SHIMMER glints (W channel) — density + brightness scale highs ──
  // The glint LAYER's total brightness scales directly + strongly with
  // `shimmer` (driven by micHigh), so highs measurably lift total brightness.
  var glint = 0.0;
  if (shimmer > 0.0) {
    // High-frequency scintillation field; pow makes it sparse + sharp.
    var gph = wave((nx * GLINT_DENSITY) + (ny * GLINT_DENSITY * 1.3) + glintT)
            * wave((ny * GLINT_DENSITY * 0.9) - (nx * GLINT_DENSITY * 1.1) - glintT * 1.7);
    if (gph < 0.0) gph = 0.0;
    // More highs => lower gate => more glints fire, AND each is brighter.
    var gate = 0.78 - shimmer * 0.6;
    if (gph > gate) {
      var t01 = (gph - gate) / (1.0 - gate);
      glint = pow(t01, 2.2) * (0.25 + shimmer * 1.4);
    }
  }

  var w = clamp01(glint);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, 0.0, 0.0);
}
