/*
  28_spectrum_bloom.js — a high-def 3-band SPECTRUM mapped to physical space.

  Amalgamates 02_phase_cathedral's interference-of-fields idea with 13_sparkle's
  crisp glints, but reorganised as a literal spectrum analyzer painted onto the
  rig. Each frequency band owns one fixture group and one spatial axis:

    LOW  -> BARS    (sId 3, X axis) : a thick bright block GROWS outward from the
            rig CENTER (x=0.5). More low energy => the block reaches further left
            AND right and burns brighter. This is the dominant, mission-critical
            mass of light.
    MID  -> VINTAGE (sId 2, Y axis) : glowing COLUMNS lift from the bottom head
            toward the top. More mid energy => the column fills higher and glows
            brighter (bottom->top fill).
    HIGH -> PARS    (sId 1)         : crisp deterministic GLINTS sprinkle across
            the four pars. More high energy => more glints, brighter.

  Between the bands' lit extents the pixels are TRUE BLACK (high contrast / high
  def). A tiny time-based base (sliderFloor) keeps a slow shimmer alive so the
  rig still reads in silence (mission-critical visibility) — never fully dark.

  Colour: blend cp1 (cool blue) -> cp2 (warm amber) in RGB space. Low/bars lean
  cp2 (warm core), mid/vintage blend by height, high/pars lean cp1 (cool glint),
  so the three bands read as three colours along one palette line.

  CONTROLS (UI order = declaration order)
    - localSpeed : base shimmer / glint animation rate.
    - low        : LOW band level — bars block extent + brightness (PRIMARY; audio micLow 0.20..1.00).
    - mid        : MID band level — vintage column height + brightness (audio micMid 0.15..1.00).
    - high       : HIGH band level — par glint count + brightness (audio micHigh 0.10..1.00).
    - floor      : minimum time-based base brightness (0 .. ~0.15).
    - colorPalette1/2 : strict cp1<->cp2 palette (cool blue -> warm amber).

  AUDIO_MODULATION_V1:
    sliderLow  <- micLow  range 0.20..1.00 curve linear  # PRIMARY brightness (bars block, the mission-critical mass)
    sliderMid  <- micMid  range 0.15..1.00 curve linear  # geometry (vintage column height)
    sliderHigh <- micHigh range 0.10..1.00 curve linear  # sparkle/detail (par glint count + brightness)
  (static, omit from playlist: sliderFloor, sliderLocalSpeed — operator-set, not
   audio-driven.)
  PRIMARY is the literal LOW band -> the bars block; it is the dominant light mass
  so frame brightness tracks micLow tightly (corr high).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // base shimmer / glint animation rate
export var low = 0.5;          // LOW band level  -> bars block (X, from center)
export var mid = 0.5;          // MID band level  -> vintage columns (Y, bottom->top)
export var high = 0.5;         // HIGH band level -> par glints
export var floor_ = 0.06;      // minimum time-based base brightness (0..~0.15)

export var cp1H = 0.58, cp1S = 1.0, cp1V = 1.0; // palette 1 — cool blue
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 — warm amber
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
// Audio sliders remap the incoming signal (0..1) into a SANE range with a silence
// floor (band stays seeded/visible at 0) up to a full-energy peak at 1.
export function sliderLow(v) { low = 0.20 + v * 0.80; }   // micLow  0.20..1.00 (PRIMARY)
export function sliderMid(v) { mid = 0.15 + v * 0.85; }    // micMid  0.15..1.00 (geometry)
export function sliderHigh(v) { high = 0.10 + v * 0.90; }  // micHigh 0.10..1.00 (sparkle)
export function sliderFloor(v) { floor_ = v * 0.15; } // map 0..1 -> 0..0.15

// ── Tunables ────────────────────────────────────────────────────────────────
var BARS_CENTER = 0.5;   // rig center in normalized X for the bars block
var VINT_BOT = 0.0;      // vintage bottom in normalized Y
var VINT_TOP = 0.2727;   // vintage top in normalized Y (from model)
var EDGE = 0.06;         // soft edge width for crisp-but-not-aliased borders

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

// Soft step from 0 to 1 around `edge`, width EDGE — crisp border without aliasing.
function softEdge(distInside) {
  // distInside > 0 means inside the lit region; ramp over EDGE near the border.
  if (distInside <= 0.0) return 0.0;
  if (distInside >= EDGE) return 1.0;
  var u = distInside / EDGE;
  return u * u * (3.0 - 2.0 * u); // smoothstep
}

// ── Per-frame scalars ─────────────────────────────────────────────────────────
var tBase = 0.0;     // slow shimmer phase
var tGlint = 0.0;    // faster glint phase
var lowExtent = 0.0; // half-width of the bars block, 0..0.5 (from center)
var midFill = 0.0;   // vintage fill height 0..1 (bottom->top)
var lowBri = 0.0, midBri = 0.0, highBri = 0.0;

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  // Canonical localSpeed law (rate = pow(2,(s-0.5)*4) ~0.25x..4x) so the shimmer
  // and glint cadence VISIBLY speed up across 0..1 (faster division of time()).
  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  tBase = time(0.06 / rate);
  tGlint = time(0.013 / rate);

  // Gentle autonomous breathing so the spectrum is never perfectly still in
  // silence (a live analyzer always shimmers). Small, incommensurate phases so
  // bars/columns drift independently — keeps the frame ANIMATING at rest while
  // the band levels still dominate the look.
  var br1 = 0.5 + 0.5 * wave(tBase * 0.6);          // bars breath  0..1
  var br2 = 0.5 + 0.5 * wave(tBase * 0.41 + 0.37);  // column breath 0..1

  // Map band sliders -> spatial extent + brightness. A little base extent so the
  // very center stays seeded; the rest scales hard with the signal. The breath
  // depth on the EXTENT/FILL is deep enough (±0.35) that the lit borders visibly
  // pulse in/out at rest — so the localSpeed cadence (which sets tBase's rate) is
  // clearly visible even in silence, while the band signal still dominates extent.
  lowExtent = 0.06 + clamp01(low) * 0.44 * (0.65 + 0.35 * br1); // half-width ~0.06..0.50
  midFill = 0.05 + clamp01(mid) * 0.95 * (0.65 + 0.35 * br2);   // fill ~0.05..1.0 of the column
  lowBri = 0.64 + clamp01(low) * 0.36 * (0.78 + 0.22 * br1);    // bars brightness (lifted)
  midBri = 0.45 + clamp01(mid) * 0.55 * (0.78 + 0.22 * br2);    // vintage brightness (lifted)
  highBri = 0.30 + clamp01(high) * 0.70;      // par glint brightness
}

export function render3D(index, x, y, z) {
  // Time-based base so silence still reads (never fully dark). It is a TRAVELING
  // shimmer (tBase phase + a spatial gradient) so as tBase advances the wash
  // visibly sweeps the rig — its speed is set by the localSpeed cadence (tBase's
  // time() rate), making localSpeed clearly effective even in pure silence.
  var travel = wave(tBase * 1.6 + x * 1.1 + y * 0.5);
  var base = floor_ * (0.40 + 0.60 * travel);

  var bri = base;
  var tcol = 0.5; // palette blend position cp1(0)->cp2(1)

  if (sectionId == 3) {
    // ── BARS: thick bright block grows outward from rig CENTER along X ───────
    var d = abs(x - BARS_CENTER);          // distance from center, 0..~0.5
    var inside = lowExtent - d;            // >0 inside the block
    var e = softEdge(inside);
    if (e > 0.0) {
      var v = lowBri * e;
      if (v > bri) { bri = v; }
      // warm core: bars lean cp2 (amber), warmest at the very center
      tcol = 0.65 + 0.35 * (1.0 - d / (lowExtent + 0.0001));
    }
  } else if (sectionId == 2) {
    // ── VINTAGE: glowing columns lift bottom->top along Y ───────────────────
    var ny = (y - VINT_BOT) / (VINT_TOP - VINT_BOT);
    ny = clamp01(ny);
    var inside2 = midFill - ny;            // >0 below the fill line
    var e2 = softEdge(inside2);
    if (e2 > 0.0) {
      // glow brightest near the rising fill front, gentle falloff below
      var front = 1.0 - (midFill - ny);    // 0..1, ~1 at the top of the fill
      var v2 = midBri * e2 * (0.6 + 0.4 * front);
      if (v2 > bri) { bri = v2; }
      // blend cp1(bottom, cool) -> cp2(top, warm) along height
      tcol = 0.15 + 0.6 * ny;
    }
  } else if (sectionId == 1) {
    // ── PARS: crisp deterministic glints; more/brighter with HIGH energy ────
    var seed = index * 91.7 + floor(tGlint * 220.0) * 0.137;
    var spark = sin(seed) * sin(seed * 3.3) * sin(seed * 7.7);
    spark = spark * spark; spark = spark * spark; // sharpen to crisp glints
    var threshold = 0.86 - clamp01(high) * 0.55;  // more high => lower bar => more glints
    if (spark > threshold) {
      var inten = (spark - threshold) / (1.0 - threshold + 0.0001);
      var v3 = highBri * clamp01(inten);
      if (v3 > bri) { bri = v3; }
      tcol = 0.05 + 0.2 * inten; // glints lean cp1 (cool)
    }
  } else {
    // P0 self-filter: unknown section -> only the faint base.
  }

  bri = clamp01(bri);
  tcol = clamp01(tcol);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;
  rgb(clamp01(r), clamp01(g), clamp01(b));
}
