/*
  45_manta_drift.js — MANTA DRIFT (HD, audio-reactive reinterpretation of
  21_pelagic_manta_rays).

  A lit oceanic water field across the whole rig, with a small SCHOOL of soft
  manta-ray shadows gliding across it. Each manta is a moving 2-D Gaussian wing
  shape — a long horizontal wingspan with a tapered body — that GLIDES across x
  while its altitude (y) undulates. The wings BEAT with a slow flap that pinches
  and spreads the wing thickness, and the wing-TIPS carry bright phosphorescent
  foam. Where a manta passes it brightens the water (a glowing pelagic giant);
  the deep water between mantas stays dark for high contrast / high definition.

  Water body  = cp1 (deep blue).   Manta glow / wing edges = cp2 (distinct,
  teal/violet) — both palette colours are always present across the rig so the
  picker pair reads. Strict cp1<->cp2 blend in RGB space (PATTERNS.md §7).

  HD: crisp tapered wing edges (pow() sharpening), bright wing-tip phosphorescence,
  dark water between mantas, never a mushy global wash.

  IRRATIONAL MOTION (no integer periods, never repeats) — each manta i drifts on
  its own irrational glide rate and undulates on a second irrational rate, seeded
  by the golden angle so the school is evenly, non-periodically spread:
      glideX_i(t)  = frac( t * (RG + i*SQRT2*0.21) + i*GOLDEN )
      altY_i(t)    = 0.5 + 0.30*sin((t*SQRT3*PI2)*(1 + i*0.13) + i*PHI*PI2)
      flap_i(t)    = 0.5 + 0.5*sin(t*PHI*PI2*(1 + i*0.07) + i*SQRT2*PI2)
  with RG=0.61803399 (golden), SQRT2=1.41421356, SQRT3=1.7320508, PHI=1.61803399,
  GOLDEN=0.38196601 (golden-angle fraction). No two rates are rationally related.

  CONTROLS (UI order = declaration order)
    - localSpeed : overall glide / flap animation rate.
    - swell      : water brightness + manta COUNT + glide speed (PRIMARY audio
                   handle). Rises with the bass — more mantas surge faster on a
                   brighter sea. Modulatable.
    - foam       : wing-tip foam sparkle intensity (2nd dimension). Highs make the
                   wing-tips shimmer with crisp phosphorescent foam. Modulatable.
    - span       : manta wingspan thickness (how much sky each ray covers).
    - depth      : water darkness between mantas (edge sharpness of the field).
    - colorPalette1/2 : cp1 deep blue water, cp2 teal/violet manta glow.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderSwell <- micLow  range 0.30..0.90 curve linear   # PRIMARY brightness + manta count + glide speed
    sliderFoam  <- micHigh range 0.00..0.85 curve pow2     # 2nd dim: wing-tip foam sparkle/detail
  Static (unmapped) params: localSpeed, span, depth, colorPalette1/2.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // glide / flap animation rate
export var swell = 0.5;        // PRIMARY: water bri + manta count + glide speed — mid bias (lit sea, school of ~3)
export var foam = 0.3;         // 2nd dim: wing-tip foam sparkle (highs)
export var span = 0.5;         // manta wingspan thickness
export var depth = 0.5;        // water darkness / field edge sharpness

export var cp1H = 0.58, cp1S = 1.0, cp1V = 1.0; // deep blue water
export var cp2H = 0.83, cp2S = 0.9, cp2V = 1.0; // violet/magenta manta glow (wide hue sep)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwell(v) { swell = v; }   // micLow maps here (PRIMARY)
export function sliderFoam(v) { foam = v; }      // micHigh maps here (2nd dim)
export function sliderSpan(v) { span = v; }
export function sliderDepth(v) { depth = v; }

// ── Irrational constants (no integer periods; equation in header) ────────────
var RG = 0.61803399;      // golden ratio fraction (glide base rate)
var SQRT2 = 1.41421356;
var SQRT3 = 1.7320508;
var PHI = 1.61803399;
var GOLDEN = 0.38196601;  // golden-angle fraction — even non-periodic seeding
var MAX_MANTA = 5;        // school size at full swell

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
var clock = 0.0;      // accumulated glide clock (irrational rates applied per manta)
var flapClock = 0.0;  // accumulated flap clock
var waterClock = 0.0; // slow water shimmer clock
var glide = array(5); // glideX_i this frame (0..1)
var alt = array(5);   // altitude y_i this frame (0..1)
var flap = array(5);  // flap factor i this frame (0..1) — wing pinch/spread
var actN = 0;         // active manta count this frame (1..MAX_MANTA from swell)
var waterBri = 0.0;   // base water brightness this frame
var spanW = 0.18;     // resolved wing half-thickness (y)
var bodyW = 0.20;     // resolved body half-width along glide (x)
var edgeP = 2.0;      // field edge sharpness exponent

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Speed: localSpeed trims, swell (micLow) surges the glide faster on the bass.
  var rate = pow(2.0, (localSpeed - 0.5) * 3.0);
  var surge = 0.45 + swell * 1.15;            // bass speeds the school up
  clock = clock + dt * 0.06 * rate * surge;
  flapClock = flapClock + dt * 0.11 * rate;
  waterClock = waterClock + dt * 0.04 * rate;
  if (clock > 100000.0) clock = clock - 100000.0;
  if (flapClock > 100000.0) flapClock = flapClock - 100000.0;
  if (waterClock > 100000.0) waterClock = waterClock - 100000.0;

  // Manta count rides the bass: calm sea = 1 ray, big drop = full school.
  actN = 1 + floor(clamp01(swell) * (MAX_MANTA - 1) + 0.001);
  if (actN < 1) actN = 1;
  if (actN > MAX_MANTA) actN = MAX_MANTA;

  // Resolve each manta's irrational glide / altitude / flap (see header eqs).
  for (var kk = 0; kk < MAX_MANTA; kk++) {
    var gx = clock * (RG + kk * SQRT2 * 0.21) + kk * GOLDEN;
    gx = gx - floor(gx);
    glide[kk] = gx;
    alt[kk] = 0.5 + 0.30 * sin((clock * SQRT3 * PI2) * (1.0 + kk * 0.13) + kk * PHI * PI2);
    flap[kk] = 0.5 + 0.5 * sin(flapClock * PHI * PI2 * (1.0 + kk * 0.07) + kk * SQRT2 * PI2);
  }

  // Water brightness rises with the bass (PRIMARY). Calm floor keeps the sea
  // alive in silence (never fully black).
  waterBri = 0.16 + clamp01(swell) * 0.62;

  // Geometry from sliders.
  spanW = 0.10 + span * 0.20;     // wing half-thickness in y
  bodyW = 0.12 + span * 0.16;     // body half-width along glide in x
  edgeP = 1.4 + depth * 3.2;      // higher depth => darker water between rays
}

export function render3D(index, x, y, z) {
  // ── Living water bed (cp1). Slow rolling shimmer so silence still reads. ──
  var roll = wave(waterClock + x * 0.7 - y * 0.4) * 0.5 + wave(waterClock * 1.31 - x * 1.1) * 0.5;
  var water = waterBri * (0.55 + 0.45 * roll);
  // Water itself carries slow cp1<->cp2 caustic BANDS so BOTH palette colours
  // are always strongly present across the rig (deep cp1 troughs, full cp2
  // crests). Two incommensurate waves keep the bands drifting non-periodically.
  var caust = wave(waterClock * 0.71 + y * 0.9 + x * 0.5) * 0.6
            + wave(waterClock * SQRT2 * 0.5 - y * 1.3) * 0.4;
  // Push caustic crests fully to cp2 (violet bands) while troughs stay cp1 (blue):
  // a wide hue split lives in the water itself, drifting non-periodically.
  var waterCol = clamp01((caust - 0.30) * 1.9);

  // ── Sum the manta school. Each is a separable Gaussian-ish wing. ──
  var mGlow = 0.0;     // accumulated manta glow brightness (cp2-leaning)
  var mTip = 0.0;      // accumulated wing-tip foam weight (for sparkle + W)
  for (var kk = 0; kk < MAX_MANTA; kk++) {
    if (kk < actN) {
      // Distance from this pixel to the manta center along each axis.
      var dx = x - glide[kk];
      // wrap dx into [-0.5,0.5] so the manta glides seamlessly across the rig
      if (dx > 0.5) dx = dx - 1.0;
      if (dx < -0.5) dx = dx + 1.0;
      var dy = y - alt[kk];

      // Flap pinches the wing thickness: thin on the down-beat, spread on up.
      var wingTh = spanW * (0.55 + 0.55 * flap[kk]);

      // Wing falloff in y (crisp tapered edge via pow), body falloff in x.
      var wy = 1.0 - abs(dy) / wingTh;
      if (wy < 0.0) wy = 0.0;
      wy = pow(wy, edgeP);
      var wx = 1.0 - abs(dx) / bodyW;
      if (wx < 0.0) wx = 0.0;
      wx = pow(wx, 1.3);

      var bodyAmt = wy * wx;            // 0..1 manta body presence at this pixel
      if (bodyAmt > mGlow) mGlow = bodyAmt;   // brightest manta wins (no wash)

      // Wing-TIPS: the lateral extremes of the wingspan (large |dy|, near body
      // center in x). A thin bright ridge at the wing edge => phosphorescence.
      var tipBand = 1.0 - abs(abs(dy) - wingTh * 0.82) / (wingTh * 0.30 + 0.0001);
      if (tipBand < 0.0) tipBand = 0.0;
      tipBand = tipBand * tipBand;       // crisp ridge
      var tip = tipBand * wx;
      if (tip > mTip) mTip = tip;
    }
  }

  // ── Foam sparkle on the wing-tips (2nd dimension, micHigh). Deterministic
  //    crisp glint gated to where the tips actually are. ──
  var seed = index * 12.9898 + z * 37.719 + floor(flapClock * 160.0) * 0.137;
  var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
  spk = spk * spk; spk = spk * spk;       // sharpen -> crisp
  var foamThresh = 0.62 - foam * 0.5;
  var foamGlint = 0.0;
  if (spk > foamThresh) foamGlint = (spk - foamThresh) / (1.0 - foamThresh + 0.0001);
  foamGlint = clamp01(foamGlint) * mTip * (0.4 + foam * 1.4);

  // ── Compose brightness + palette blend. Water=cp1, manta glow/tips=cp2. ──
  var bri = water;
  var glowBri = mGlow * (0.55 + swell * 0.6);   // mantas brighten with the bass too
  if (glowBri > bri) bri = glowBri;
  var tipBri = mTip * (0.30 + foam * 0.7);
  if (tipBri > bri) bri = tipBri;
  bri = clamp01(bri);

  // Palette position: water carries a cp1<->cp2 caustic base; manta presence
  // pulls strongly toward cp2 (the glowing pelagic giant reads violet).
  var tcol = clamp01(waterCol + mGlow * 0.85 + mTip * 0.95);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Wing-tip foam glints add a crisp phosphorescent core on the W channel.
  var ww = clamp01(foamGlint);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), ww, 0.0, 0.0);
}
