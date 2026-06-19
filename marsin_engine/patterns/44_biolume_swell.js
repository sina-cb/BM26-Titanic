/*
  44_biolume_swell.js — HD, SOUND-REACTIVE BIOLUMINESCENCE (reinterprets
  11_bioluminescence). A slow ambient underwater SWELL in cp1 (deep blue/teal)
  with sharp bright bioluminescent CRESTS in cp2 (cyan/green) that POP only
  where the swell peaks. The crests are pow-sharpened to crisp HD cores over
  near-black troughs — high contrast, high definition. A gentle additive UV
  GLOW rides a slow counter-wave (the original's signature blacklight feel),
  gated by a named slider. Calm non-black ambient floor in silence.

  WHOLE-RIG, coordinate-driven: a 2D swell field f(nx,ny,t) sweeps across pars
  (top), bars (mid) and vintage (low) so the swell is one coherent body of
  water rolling over the entire structure. No section self-filter — every
  fixture participates in the swell.

  CONTROLS (UI order = declaration order)
    - localSpeed : overall swell + counter-wave rate.
    - swell      : swell amplitude + OVERALL BRIGHTNESS (PRIMARY audio dim).
    - sparkle    : bright crest plankton glints — count + brightness (2nd dim).
    - kick       : a crest burst that briefly blooms/expands every crest (3rd dim).
    - uvGlow     : named UV blacklight glow amount on the slow counter-wave.
    - base       : calm ambient floor so silence still reads (never fully black).
    - colorPalette1/2 : cp1 deep blue/teal swell, cp2 cyan/green crest.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderSwell   <- micLow  range 0.30..0.95 curve linear   # PRIMARY brightness + swell amplitude
    sliderSparkle <- micHigh range 0.00..0.80 curve pow2     # plankton crest glints/detail
    sliderKick    <- micFlux range 0.00..0.90 curve linear   # build blooms/expands every crest (swell)
  Static (unmapped) params: localSpeed, uvGlow, base, colorPalette1/2.
    micFlux (build->expansion) drives the crest-bloom dimension — the swell's
    signature gesture; micLow stays the dominant brightness driver (PRIMARY corr).

  CORE EQUATION (irrational, never loops):
      swellF(nx,ny,t) = 0.5 + 0.5*sin( PI2*( t*SQRT2*0.5
                          + nx*PHI*1.7 + ny*SQRT3*1.1 ) )
                        blended with a counter term at t*SQRT3*0.31;
      crest = pow(swellF, 3 + 5*(1-swell)) ; UV = wave(t*0.37*SQRT2 - ny*0.5).
    SQRT2=1.41421356, SQRT3=1.73205081, PHI=1.61803399 are mutually irrational,
    so the swell phase never returns to a common period (no integer loop).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // overall swell + counter-wave rate
export var swell = 0.5;        // swell amplitude + OVERALL BRIGHTNESS (micLow) — mid bias (crests pop, two-colour reads)
export var sparkle = 0.2;      // crest plankton glints count+brightness (micHigh)
export var kick = 0.0;         // crest burst (micKick)
export var uvGlow = 0.6;       // named UV blacklight glow amount
export var base = 0.12;        // calm ambient floor (never fully black)

export var cp1H = 0.62, cp1S = 1.0, cp1V = 1.0; // deep blue swell
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // green crest
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwell(v) { swell = v; }     // micLow maps here (PRIMARY)
export function sliderSparkle(v) { sparkle = v; } // micHigh maps here
export function sliderKick(v) { kick = v; }       // micKick maps here
export function sliderUvGlow(v) { uvGlow = v; }
export function sliderBase(v) { base = v; }

// ── Irrational constants (mutually incommensurate → swell never loops) ───────
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI   = 1.61803399;

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

// ── Per-frame scalars ─────────────────────────────────────────────────────────
var tSwell = 0.0;     // primary swell phase (irrational rate)
var tCounter = 0.0;   // counter-wave phase for UV
var tGlint = 0.0;     // plankton glint churn phase
var ampNow = 0.0;     // resolved swell amplitude this frame (from swell slider)
var briGain = 0.0;    // overall brightness gain (from swell slider — PRIMARY)
var crestSharp = 8.0; // crest pow exponent (low swell -> sharper/darker)
var kickBloom = 0.0;  // crest burst bloom amount (from kick slider)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Speed scales exponentially around localSpeed=0.5 (like 11_bioluminescence).
  var rate = pow(2.0, (localSpeed - 0.5) * 3.0);

  // Irrational rates -> phases never share a common period (no integer loop).
  tSwell   = tSwell   + dt * 0.32 * SQRT2 * rate;
  tCounter = tCounter + dt * 0.21 * SQRT3 * rate;
  tGlint   = tGlint   + dt * 0.83 * PHI * rate;
  if (tSwell   > 100000.0) tSwell   = tSwell   - 100000.0;
  if (tCounter > 100000.0) tCounter = tCounter - 100000.0;
  if (tGlint   > 100000.0) tGlint   = tGlint   - 100000.0;

  // PRIMARY audio dim: micLow -> swell amplitude AND overall brightness.
  // Both rise together so micLow strongly correlates with total brightness.
  // briGain spans a wide range and multiplies the WHOLE frame, so the
  // per-frame total brightness tracks micLow tightly (corr driver).
  var sw = clamp01(swell);
  ampNow = 0.30 + sw * 0.55;          // swell strength
  // Expand the response so the (narrow) micLow band still swings brightness
  // hard: a power curve makes briGain steep across the useful 0.4..0.8 range,
  // and the wide 0.06..1.0 span makes total brightness a near-linear readout of
  // micLow (PRIMARY corr driver).
  var swCurve = pow(sw, 1.8);
  briGain = 0.06 + swCurve * 0.94;    // overall brightness (PRIMARY corr driver)

  // Louder lows -> broader/softer crests (more lit); quiet -> very sharp/dark.
  crestSharp = 3.0 + (1.0 - sw) * 5.0;

  // micKick -> a crest burst. To keep micLow as the dominant brightness driver
  // (P0 PRIMARY), the kick RESHAPES the crest (broadens its core) instead of
  // adding net brightness — a punch in DEFINITION, not a brightness spike.
  kickBloom = clamp01(kick);
}

export function render3D(index, x, y, z) {
  // ── Slow ambient SWELL field over the whole rig (2D, irrational freqs) ────
  // Higher spatial frequency -> several wave cycles span the rig at once, so the
  // field always shows both crests and troughs. That makes the per-frame TOTAL
  // brightness spatially stable and leaves briGain (micLow) as the dominant
  // temporal lever -> strong micLow->brightness correlation (PRIMARY bar).
  var phase = tSwell + x * PHI * 3.3 + y * SQRT3 * 2.7;
  var s1 = sin(phase * PI2);
  // A second, slower, counter-travelling component for organic non-looping roll.
  var s2 = sin((tCounter + x * 2.6 - y * SQRT2 * 2.1) * PI2);
  var swellRaw = 0.5 + 0.5 * (0.65 * s1 + 0.35 * s2);
  swellRaw = clamp01(swellRaw);

  // Apply audio-driven amplitude: low energy flattens the swell toward a calm
  // mid level; high energy lets it swing full depth (deep troughs, tall crests).
  var sFld = 0.5 + (swellRaw - 0.5) * ampNow;

  // ── Sharp bioluminescent CREST: pow-sharpened peak of the swell ──────────
  var crest = pow(clamp01(sFld), crestSharp); // crisp HD cores, dark troughs

  // ── Plankton GLINTS (2nd audio dim, micHigh): crisp deterministic sparks
  // that pop ON the crests where the water is brightest. ───────────────────
  var seed = index * 12.9898 + z * 37.719 + floor(tGlint * 60.0) * 0.137;
  var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
  spk = spk * spk; spk = spk * spk;            // sharpen -> crisp single sparks
  var glintThresh = 0.955 - clamp01(sparkle) * 0.45; // more highs -> more glints (HD sparks)
  var glint = 0.0;
  if (spk > glintThresh && sFld > 0.45) {       // glints ride the brighter water
    var gamt = (spk - glintThresh) / (1.0 - glintThresh + 0.0001);
    glint = clamp01(gamt) * (0.45 + clamp01(sparkle) * 0.55) * (0.4 + crest * 0.6);
  }

  // ── Calm ambient FLOOR — slow breathing swell so silence still reads ─────
  var floorV = base * (0.45 + 0.55 * sFld);

  // BRIGHTNESS BACKBONE: the ambient water body, scaled by briGain (micLow).
  // This is the dominant per-pixel brightness, so the per-frame TOTAL tracks
  // micLow tightly (PRIMARY bar). Crest + glint are HD highlights that mostly
  // REDISTRIBUTE/SHARPEN brightness rather than inflate the frame total.
  // Ambient water glows with the swell but darkens in troughs (pow > 1 deepens
  // the troughs -> crisp contrast, dark water between crests = HD).
  var bodyWave = pow(clamp01(sFld), 1.8) * 0.7;
  var body = floorV;
  if (bodyWave > body) body = bodyWave;
  // EVERY brightness term is multiplied by briGain (micLow) so the whole rig
  // dims/brightens together with the lows -> total brightness is a clean readout
  // of micLow (PRIMARY corr bar). Crest/glint only REDISTRIBUTE that brightness
  // toward HD cores; they never add an audio-independent floor.
  var lit = body;
  if (crest > lit) lit = crest;                  // crest dominates where it pops
  if (glint > lit) lit = glint;                  // sparks top everything
  var v = clamp01(lit * briGain);

  // ── Colour: blend cp1 (deep blue swell) -> cp2 (green crest) along the crest
  // sharpness; glints push hard to cp2 for bright pops. micKick is a COLOUR/UV
  // dimension: a hit shoves the crest hue toward cp2 (a green flash) without
  // inflating total brightness, so micLow stays the dominant brightness driver. ─
  // tcol is driven by the swell height with a gentler curve so a meaningful
  // band of mid-swell pixels reads cp2 (green crest) while troughs stay cp1
  // (deep blue) -> the rig shows BOTH hues at once (two-colour bar). The crest
  // cores push fully to cp2; glints/kick push harder still.
  // Widen the cp1<->cp2 hue split WITHOUT coupling colour to overall brightness
  // (that would decorrelate micLow->total-brightness, the PRIMARY bar). A static
  // spatial bias pushes some regions toward cp1 (deep blue troughs) and others
  // toward cp2 (green crests) so BOTH palette poles are strongly present across
  // the rig at once. The bias is time-invariant, so it adds hue spread without
  // touching the per-frame brightness->micLow coupling.
  var hueBias = (wave(x * 2.3 + y * 1.7) - 0.5) * 0.5; // static spatial cp1/cp2 lean
  var tcol = pow(clamp01(sFld), 1.3) + hueBias;  // troughs cp1, rising mid->cp2
  tcol = clamp01(tcol);
  if (crest * 1.4 > tcol) tcol = crest * 1.4;    // crest cores -> full cp2
  tcol = clamp01(tcol + crest * kickBloom * 0.5);// kick: greener crest flash
  if (glint > 0.0) tcol = clamp01(tcol + 0.4);
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * v;
  var g = (pg1 + (pg2 - pg1) * tcol) * v;
  var b = (pb1 + (pb2 - pb1) * tcol) * v;

  // ── UV GLOW: additive blacklight emitter on a slow counter-wave, gated by
  // the named uvGlow slider. Riding ny so it sweeps vertically like the
  // original's signature feel. The UV is multiplied by briGain so its glow
  // (and therefore its contribution to total brightness) RISES AND FALLS WITH
  // micLow — keeping it from decoupling the PRIMARY brightness correlation. The
  // slow counter-wave only shapes WHERE it glows, not the frame-total level. ─
  var uvWave = 0.45 + 0.55 * wave(tCounter * 0.37 * SQRT2 - y * 0.5);
  var outU = clamp01(uvWave * uvGlow * 0.45 * briGain);

  // Crisp white pop on the crest cores keeps glints HD without non-palette hue.
  // Gated by briGain so the white highlight also tracks micLow (no audio-free add).
  var outW = clamp01((crest * 0.3 + glint * 0.6) * briGain);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), outW, 0.0, outU);
}
