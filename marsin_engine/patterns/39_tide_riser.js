/*
  39_tide_riser.js — high-def EDM BUILD / TIDE (two-colour water + foam).

  A glowing water LEVEL rises up the rig as build energy climbs. BELOW the
  waterline the rig glows deep-ocean (cp1, a body of one hue); right AT the
  waterline — and as spray flung ABOVE it — sits a crisp, bright FOAM/CREST in
  a DISTINCT second hue (cp2, warm amber-white). So the rig always shows BOTH
  colours at once: a cool body capped by a warm crest. A riser synth (high
  spectral flux) makes the tide CLIMB; a kick flings the crest spray higher.

  Vertical level is driven by `y` (normalised 0..1 across the rig): vintage
  heads sit low (~0..0.27), bars mid (~0.64), pars up top (~1.0), so a rising
  level fills bottom-up across the whole rig and reads as one body of water.

  REACTIVITY (why it tracks the music):
    - TIDE HEIGHT and the BODY's per-pixel brightness BOTH scale with `rise`:
      a higher level lights MORE pixels AND lights each lit pixel brighter, so
      total brightness climbs hard and monotonically with flux (primary corr).
    - CREST SPRAY height + crest brightness scale with `spray` (a kick handle):
      a second, orthogonal dimension that punches the warm crest up on the beat.

  CONTRAST: BASE floor is near-zero so far above the spray pixels are true
  black; the crest is a tight bright band riding the surface. A faint
  time-based shimmer keeps it readable in silence (never fully dark).

  CORE EQUATION (per pixel, ny = clamp01(y), surf = waterline):
      body  = (ny <= surf)            -> cp1 * (0.45 + 0.55*rise) * depthGlow
      crest = exp over |ny - surf|    -> cp2, band widened upward by spray
      out   = lerp(cp1,cp2, crestMix) * max(body, crest, floor)

  CONTROLS (UI order = declaration order)
    - localSpeed : shimmer / drift rate of the water surface.
    - rise       : water LEVEL height 0..1 (flux pushes this up). Modulatable.
                   Drives BOTH lit-area AND body brightness -> strong corr.
    - spray      : CREST spray height / pop above the waterline (kick). Modulatable.
    - foam       : crest-line sharpness (1 = razor band, 0 = soft surf).
    - base       : minimum floor under the water glow.
    - colorPalette1/2 : cp1 deep ocean blue (body), cp2 warm foam amber-white.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderRise  <- micFlux range 0.20..0.90 curve linear   # PRIMARY build/riser: flux climbs the tide height + body brightness
    sliderSpray <- micKick range 0.00..1.00 curve linear   # kick: flings the warm crest spray up above the waterline
  STATIC (operator handles, not audio-mapped): localSpeed, foam, base, colorPalette1/2.
*/

// ── Exported controls ────────────────────────────────────────────────────────
export var localSpeed = 0.5;   // surface shimmer / drift rate
export var rise = 0.25;        // water level height 0..1 (flux climbs this)
export var spray = 0.0;        // crest spray height above the waterline (kick)
export var foam = 0.5;         // crest-line sharpness (1 = razor, 0 = soft surf).
                               //   0.5 (mid) gives a crest band broad enough that BOTH
                               //   the cool body and warm crest read at rest (hueSpread up)
export var base = 0.06;        // minimum floor under the water

// cp1 = deep ocean blue (BODY). cp2 = warm amber-white FOAM/CREST.
// Distinct hues (0.60 vs 0.09) so the rig reads two colours -> hueSpread high.
export var cp1H = 0.60, cp1S = 1.0, cp1V = 0.9;  // deep ocean blue (below water)
export var cp2H = 0.09, cp2S = 0.55, cp2V = 1.0; // warm amber-white crest / foam
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRise(v) { rise = v; }
export function sliderSpray(v) { spray = v; }
export function sliderFoam(v) { foam = v; }
export function sliderBase(v) { base = v; }

// ── Tunables (irrational ratios — no integer periods) ────────────────────────
// SQRT2 / PHI / golden-angle phases keep the surface wobble + shimmer aperiodic
// so the waterline never beats into a visible repeating ripple.
var FOAM_MAX = 0.20;   // crest half-band thickness (ny) at foam = 0 (broad surf)
var FOAM_MIN = 0.035;  // crest half-band thickness (ny) at foam = 1 (razor)
var SPRAY_MAX = 0.34;  // extra crest reach ABOVE the surface at spray = 1
var R_SQRT2 = 1.41421; // wobble spatial frequency along x
var R_PHI = 1.61803;   // shimmer cross-frequency
var R_GOLD = 2.39996;  // swell drift increment (golden angle, turns/sec-ish)

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
var foamHalf = 0.1;    // resolved crest half-band thickness this frame
var bodyBri = 0.5;     // resolved body brightness this frame (tracks rise)
var sprayUp = 0.0;     // resolved extra crest reach above surface this frame
var crestBri = 0.7;    // resolved crest brightness this frame (tracks spray)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Aperiodic drift: increments use irrational ratios so nothing loops cleanly.
  // localSpeed warps the surface drift rate exponentially across 0..1
  // (2^((localSpeed-0.5)*4): 0.0625x at 0 .. 16x at 1) so the slider VISIBLY
  // changes how fast the water shimmers; a small floor keeps the surface always
  // alive (never a dead-flat waterline, even at localSpeed=0).
  var rateMul = 0.06 + pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  shimmer = shimmer + dt * rateMul * 0.35 * R_PHI;
  shimmer = shimmer - floor(shimmer);
  swell = swell + dt * rateMul * 0.08 * R_GOLD;
  swell = swell - floor(swell);

  // Waterline rides the rig bottom->top with the rise control (flux). Headroom
  // keeps the crest on-rig at full rise.
  var rs = clamp01(rise);
  level = 0.04 + rs * 0.90;

  // PRIMARY reactivity: body brightness ALSO climbs with rise, so total
  // brightness tracks flux on BOTH axes (more lit area + brighter per pixel).
  bodyBri = 0.45 + rs * 0.55;

  // Crest thickness: foam=1 -> razor band, foam=0 -> broad surf.
  foamHalf = FOAM_MIN + (1.0 - clamp01(foam)) * (FOAM_MAX - FOAM_MIN);

  // 2nd dimension: kick flings the crest spray upward and pops its brightness.
  var sp = clamp01(spray);
  sprayUp = sp * SPRAY_MAX;
  crestBri = 0.65 + sp * 0.35;
}

export function render3D(index, x, y, z) {
  // Vertical position of this pixel, 0 (bottom) .. 1 (top).
  var ny = clamp01(y);

  // Aperiodic surface wobble so the waterline isn't a dead-flat line.
  var wob = (wave(x * R_SQRT2 + shimmer) - 0.5) * 0.05
          + (wave(ny * R_PHI + swell) - 0.5) * 0.03;
  var surf = level + wob;

  var bri = 0.0;
  var tcol = 0.0;   // 0 -> cp1 body (blue), 1 -> cp2 crest (warm)

  // ── BODY (cp1): deep-ocean glow below the waterline ─────────────────────────
  // Uniform-ish body so total brightness tracks lit AREA (level); brightness
  // ALSO scales with bodyBri (rise) -> strong flux correlation.
  if (ny <= surf) {
    var depth = surf - ny;
    var glow = bodyBri * (0.78 + 0.22 * clamp01(depth * 1.3));
    glow = glow * (0.9 + 0.1 * wave(x * 0.7 + ny * R_PHI + shimmer));
    bri = glow;
    tcol = 0.0;   // body is pure cp1
  }

  // ── CREST / FOAM (cp2): bright warm band riding the surface, spray ABOVE ─────
  // Below the surface the crest half-band is foamHalf; ABOVE the surface it is
  // extended by sprayUp (kick), so spray throws cp2 colour up the dark rig.
  var dband;
  if (ny >= surf) {
    var halfUp = foamHalf + sprayUp;
    dband = (ny - surf) / (halfUp + 0.0001);   // 0 at surface, 1 at top of spray
  } else {
    dband = (surf - ny) / (foamHalf + 0.0001); // 0 at surface, 1 at band bottom
  }
  if (dband < 1.0) {
    var fedge = 1.0 - dband;
    fedge = pow(fedge, 1.6 + clamp01(foam) * 3.0);
    var fb = fedge * crestBri;
    if (fb > bri) bri = fb;
    if (fedge > tcol) tcol = fedge;   // crest pushes colour toward cp2
  }

  // ── Minimal time-based base so it always reads (never fully dark) ───────────
  var floorv = base * (0.5 + 0.5 * wave(ny * 0.6 + swell));
  if (floorv > bri) bri = floorv;

  bri = clamp01(bri);
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Crisp white core on the W channel at the very crest (only the bright tip).
  var white = 0.0;
  if (dband < 1.0) {
    var we = 1.0 - dband;
    white = pow(we, 3.0) * 0.7 * crestBri;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), 0.0, 0.0);
}
