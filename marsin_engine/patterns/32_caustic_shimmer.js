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

  TWO COLOURS: cp1 deep TEAL veins <-> cp2 warm GOLD crests (distinct hues,
  ~0.42 apart). The cp1<->cp2 blend is driven by a SMOOTH caustic-tilt field
  that genuinely spans 0..1 across the rig (low-frequency interference +
  caustic strength), so both hues are always present somewhere — teal in the
  troughs, gold riding the bright veins. This guarantees a real hue spread.

  NON-REPEATING MATH: the caustic field layers sines whose time terms drift on
  incommensurate periods (golden-angle 0.0234, sqrt2 0.0202, phi 0.0144 turns/s)
  and whose spatial frequencies use irrational ratios (sqrt2, sqrt3, phi), so
  the interference never tiles back to a loop.
    field = w(nx*D + ny*0.7 - tA) + w(ny*D*sqrt2*0.5 - nx*0.5 + tB)
          + w((nx+ny)*D*phi*0.3 + tA*phi)
  where w() is the 0..1 wave() turn and D = CAUSTIC_DENSITY.

  CONTROLS (declaration order = UI order)
    - localSpeed : caustic flow rate.
    - shimmer    : glint density + brightness AND overall body gain (highs).
    - ripple     : kick brightness-pulse amount.
    - depth      : caustic contrast (vein sharpness).
    - base       : minimum floor brightness.
    - colorPalette1/2 : cp1 deep teal (troughs) <-> cp2 warm gold (crests).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
AUDIO_MODULATION_V1:
  sliderShimmer <- micHigh range 0.30..1.00 curve linear   # PRIMARY brightness: highs drive body gain + glints
  sliderRipple  <- micKick range 0.00..1.00 curve pow2     # kick: transient expanding brightness swell
  # sliderDepth static 0.60  # caustic contrast (geometry, not audio-driven)
  # sliderBase  static 0.12  # silence visibility floor (static)
  # sliderLocalSpeed static 0.50  # operator flow rate, not an audio target
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // caustic flow rate
export var shimmer = 0.5;      // glint density + brightness (highs); 0.5 = bright lively default
export var ripple = 0.0;       // kick brightness-pulse amount
export var depth = 0.6;        // caustic contrast (vein sharpness)
export var base = 0.12;        // minimum floor brightness

export var cp1H = 0.52, cp1S = 1.00, cp1V = 1.0; // deep teal / cyan (troughs)
export var cp2H = 0.10, cp2S = 0.90, cp2V = 1.0; // warm gold / amber (crests)
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

// Irrational constants — incommensurate spatial/temporal ratios so the caustic
// interference never tiles back into a repeating loop (production bar 3).
var SQRT2 = 1.41421;
var SQRT3 = 1.73205;
var PHI = 1.61803;

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
var flowA = 0.0;       // caustic drift phase A  (golden-angle period)
var flowB = 0.0;       // caustic drift phase B  (sqrt2 period)
var glintT = 0.0;      // glint scintillation phase (phi period)
var tiltT = 0.0;       // slow colour-tilt drift  (sqrt3 period)
var rippleEnv = 0.0;   // decaying envelope of the kick pulse

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Incommensurate drift periods (turns/sec) — golden-angle/sqrt2/phi/sqrt3
  // scaled by 0.01 so the interference + colour tilt never re-loop.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  flowA = time((0.0234 / 2.39996) / localMultiplier);
  flowB = time((0.0202 / SQRT2)   / localMultiplier);
  glintT = time((0.0144 / PHI)    / localMultiplier);
  tiltT = time((0.0090 / SQRT3)   / localMultiplier);

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
  // Spatial frequencies use irrational ratios (sqrt2, sqrt3, phi); time terms
  // drift on incommensurate periods — the field never tiles back to a loop.
  var w1 = wave((nx * CAUSTIC_DENSITY) + (ny * 0.7) - flowA);
  var w2 = wave((ny * CAUSTIC_DENSITY * SQRT2 * 0.5) - (nx * 0.5) + flowB);
  var w3 = wave(((nx + ny) * CAUSTIC_DENSITY * PHI * 0.3) + flowA * PHI);
  var field = (w1 * 0.4) + (w2 * 0.35) + (w3 * 0.25);

  // Sharpen into crisp veins. `depth` raises the exponent for tighter cores.
  var sharp = 1.6 + depth * 4.0;
  var caustic = pow(field, sharp);

  // ── Time-based base floor so it's never fully black when silent ──────────
  var floorPulse = base * (0.5 + 0.5 * wave(ny * 0.6 + flowB));

  // ── Ripple swell on kick: lifts the whole caustic field (SECONDARY dim =
  //    a transient expanding brightness swell, distinct from the shimmer body
  //    gain). Riding the caustic shape keeps it an EXPANDING vein-swell, not a
  //    flat flash. ─────────────────────────────────────────────────────────────
  var swell = 1.0 + rippleEnv * 1.9 * (0.5 + 0.5 * caustic);

  // Body of light from the caustic field + base floor. Kept modest (peak ~0.7)
  // so the shimmer gain below multiplies it without saturating everywhere —
  // saturation would flatten the brightness->micHigh correlation.
  var body = clamp01((floorPulse + caustic * swell) * 0.7);

  // Continuous shimmer GAIN dominates total brightness so micHigh tracks
  // brightness strongly (primary reactivity). The shimmer-independent term is
  // kept SMALL so most of every pixel's output rides on `shimmer`.
  var gain = 0.10 + shimmer * 1.55;
  // A small shimmer-INDEPENDENT visibility floor (added after the gain) keeps
  // the rig readable in silence (mission-critical) without injecting much
  // uncorrelated variance — it is a slow, low-amplitude caustic minimum.
  var visFloor = (0.06 + base * 0.20) * (0.4 + 0.6 * caustic);
  var bri = clamp01(body * gain + visFloor);

  // ── TWO COLOURS: smooth tilt field spans 0..1 across the whole rig ───────
  // A low-frequency interference field (irrational ratios) gives every pixel a
  // smoothly varying blend position, so teal (cp1) fills the troughs and gold
  // (cp2) rides the bright veins — both hues are always present somewhere.
  var tiltLF = 0.5 + 0.5 * wave(nx * SQRT3 * 0.55 + ny * 0.45 + tiltT);
  var tcol = clamp01(tiltLF * 0.55 + caustic * 0.65);
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
