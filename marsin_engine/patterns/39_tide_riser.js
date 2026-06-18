/*
  39_tide_riser.js — high-def EDM BUILD / TIDE.

  A glowing water LEVEL rises up the rig as build energy climbs. Below the
  waterline the rig glows deep-ocean (cp1); right AT the waterline sits a crisp,
  bright FOAM line (cp2, pale cyan/white); above it is dark. A riser synth (high
  spectral flux) makes the tide CLIMB. When the build peaks and drops (low
  energy collapses) the whole rig WASHES bright — the flood.

  Vertical level is driven by `y` (normalised 0..1 across the rig): vintage heads
  sit low (~0..0.27), bars mid (~0.64), pars up top (~1.0), so a rising level
  fills bottom-up across the whole rig and reads as one body of water.

  CONTRAST: BASE floor is near-zero so above-water pixels are true black; the
  foam line is a single tight bright band. A tiny time-based shimmer base keeps
  it readable in silence (mission-critical visibility — never fully dark).

  CONTROLS (UI order = declaration order)
    - localSpeed : shimmer / drift rate of the water surface.
    - rise       : water LEVEL height 0..1 (flux pushes this up). Modulatable.
    - wash       : FLOOD brightness — low energy washes the whole rig bright.
                   Modulatable (drives total brightness → measurable reactivity).
    - foam       : foam-line sharpness (1 = razor band, 0 = soft surf).
    - base       : minimum floor under the water glow.
    - colorPalette1/2 : cp1 deep ocean blue (below), cp2 pale foam cyan/white.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderRise (rise) <- micFlux
      MODULATE sliderWash (wash) <- micLow
*/

// ── Exported controls ────────────────────────────────────────────────────────
export var localSpeed = 0.5;   // surface shimmer / drift rate
export var rise = 0.25;        // water level height 0..1 (flux climbs this)
export var wash = 0.0;         // flood brightness (low energy → whole rig bright)
export var foam = 0.7;         // foam-line sharpness (1 = razor, 0 = soft surf)
export var base = 0.06;        // minimum floor under the water

export var cp1H = 0.62, cp1S = 1.0, cp1V = 0.9;  // deep ocean blue (below water)
export var cp2H = 0.50, cp2S = 0.25, cp2V = 1.0; // pale foam cyan / near-white
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRise(v) { rise = v; }
export function sliderWash(v) { wash = v; }
export function sliderFoam(v) { foam = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var FOAM_MAX = 0.32;   // foam half-band thickness (ny) at foam = 0
var FOAM_MIN = 0.04;   // foam half-band thickness (ny) at foam = 1 (razor)

// ── Palette RGB cache (strict cp1<->cp2 blending) ────────────────────────────
var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 1, pb2 = 1;
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
var shimmer = 0.0;     // surface shimmer phase 0..1
var swell = 0.0;       // slow swell phase 0..1
var level = 0.0;       // resolved waterline height this frame (ny)
var foamHalf = 0.1;    // resolved foam half-band thickness this frame
var floodBri = 0.0;    // resolved flood brightness this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  shimmer = shimmer + dt * (0.25 + localSpeed * 1.4);
  shimmer = shimmer - floor(shimmer);
  swell = swell + dt * (0.05 + localSpeed * 0.25);
  swell = swell - floor(swell);

  // Waterline rides the rig bottom→top with the rise control (flux). Keep a
  // touch of headroom so the foam line stays on-rig at full rise.
  level = 0.04 + clamp01(rise) * 0.92;

  // Foam thickness: foam=1 -> razor band, foam=0 -> broad surf.
  foamHalf = FOAM_MIN + (1.0 - clamp01(foam)) * (FOAM_MAX - FOAM_MIN);

  // Flood: wash lights the whole rig bright (the drop). Squared for snap.
  var w = clamp01(wash);
  floodBri = w * w;
}

export function render3D(index, x, y, z) {
  // Vertical position of this pixel, 0 (bottom) .. 1 (top).
  var ny = clamp01(y);

  // Surface wobble so the waterline isn't a dead-flat line across the rig.
  var wob = (wave(x * 0.9 + shimmer) - 0.5) * 0.05
          + (wave(ny * 1.7 + swell) - 0.5) * 0.03;
  var surf = level + wob;

  // ── Below the waterline: deep ocean glow that brightens with depth ──────────
  var bri = 0.0;
  var tcol = 0.0;
  if (ny <= surf) {
    var depth = (surf - ny);                 // how far under the surface
    // Mostly-uniform body glow so total brightness tracks the lit AREA (level),
    // with a gentle depth gradient + shimmer for life.
    var glow = 0.6 + 0.18 * clamp01(depth * 1.2);
    glow = glow * (0.9 + 0.1 * wave(x * 0.7 + ny * 1.1 + shimmer));
    bri = glow;
    tcol = 0.0;                              // ocean colour (cp1) below
  }

  // ── Foam line: crisp bright band exactly at the waterline (cp2) ─────────────
  var dband = abs(ny - surf);
  if (dband < foamHalf) {
    var fedge = 1.0 - dband / foamHalf;
    fedge = pow(fedge, 2.0 + clamp01(foam) * 3.0);
    var fcol = fedge;                        // foam pushes colour toward cp2
    if (fedge > bri) bri = fedge;
    if (fcol > tcol) tcol = fcol;
  }

  // ── Minimal time-based base so it always reads (never fully dark) ───────────
  var floorv = base * (0.5 + 0.5 * wave(ny * 0.6 + swell));
  if (floorv > bri) bri = floorv;

  // ── Flood / wash: the drop washes the whole rig bright (toward foam) ────────
  if (floodBri > 0.0) {
    var flo = floodBri * (0.8 + 0.2 * wave(x * 0.5 + shimmer));
    if (flo > bri) bri = flo;
    if (floodBri > tcol) tcol = floodBri;   // wash whitens toward foam
  }

  bri = clamp01(bri);
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Foam crisp on the W channel near the waterline / in the flood.
  var white = 0.0;
  if (dband < foamHalf) {
    var we = 1.0 - dband / foamHalf;
    white = pow(we, 3.0) * 0.8;
  }
  if (floodBri * 0.6 > white) white = floodBri * 0.6;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), 0.0, 0.0);
}
