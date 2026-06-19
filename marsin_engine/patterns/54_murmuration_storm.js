/*
  54_murmuration_storm.js — HD, SOUND-REACTIVE CHROMATIC MURMURATION.

  An HD audio reinterpretation of 24_chromatic_murmuration. A flock of
  starlings (modelled as four moving density CENTERS) drifts and swirls across
  the rig as a colour storm. Each center orbits on its own IRRATIONAL Lissajous
  phase (SQRT2 / SQRT3 / PHI / GOLDEN-ANGLE ratios) so the flock never repeats.

  Per pixel, brightness = proximity to the flock DENSITY FIELD: crisp and bright
  where birds cluster (a tight core raised to a contrast power), TRUE BLACK where
  the sky is sparse. Colour blends cp1<->cp2 (strict RGB-space lerp) by the local
  flock VELOCITY DIRECTION, so both palette colours storm across the rig as the
  flock banks and turns. A faint living haze keeps the night sky readable (never
  fully dark) in silence — mission-critical visibility, codex P0.

  HD: dense cores are crisp single-cluster glows on a true-black sky; micHigh
  shatters birds into scattered single-pixel GLINTS (deterministic per-pixel
  hash, like 13_sparkle / 35_sparkle_rain).

  CORE EQUATION (per pixel; ck = center k at irrational phase, dk = dist):
      glow_k = max(0, 1 - dk * focus * (1 - 0.45*build))^contrast
      dense  = (0.42 + 0.58*flockEnergy) * Σ glow_k        // micLow drives this
      bri    = max(haze, dense, scatterGlints(micHigh))
      tcol   = velocity-direction weighted (cp1 leading edge <-> cp2 trailing)
    Center orbits use SQRT2/SQRT3/PHI/GOLDEN-ANGLE time() bases (no integer
    periods), e.g.  ax = 0.5 + reach*sin(orbA*SQRT2 + sin(orbB*PHI))

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderFlockEnergy (flockEnergy) <- micLow   PRIMARY: cohesion +
                                                            overall brightness
      MODULATE sliderScatter     (scatter)     <- micHigh  2nd dim: birds scatter
                                                            into bright glints
      MODULATE sliderBuild       (build)       <- micFlux  murmuration BUILD /
                                                            flock expansion
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // flock drift / swirl rate
export var flockEnergy = 0.5;  // PRIMARY: flock cohesion + overall brightness (micLow)
export var scatter = 0.5;      // birds scatter into glints (micHigh)
export var build = 0.5;        // murmuration build / flock expansion (micFlux)
export var focus = 0.5;        // flock core tightness (1 = pinpoint cores)
export var haze = 0.35;        // faint living night-sky floor (never fully black)

// cp1 = cool storm blue (leading edge), cp2 = warm ember (trailing edge).
// Distinct hues (0.60 vs 0.05) so the rig reads two colours -> hueSpread high.
export var cp1H = 0.60, cp1S = 0.95, cp1V = 1.0; // cool storm blue
export var cp2H = 0.05, cp2S = 0.95, cp2V = 1.0; // warm ember
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFlockEnergy(v) { flockEnergy = v; }  // micLow maps here (PRIMARY)
export function sliderScatter(v) { scatter = v; }          // micHigh maps here
export function sliderBuild(v) { build = v; }              // micFlux maps here
export function sliderFocus(v) { focus = v; }
export function sliderHaze(v) { haze = v; }

// ── Tunables (irrational ratios — no integer periods) ────────────────────────
var SQRT2 = 1.41421356;  // orbit ratio
var SQRT3 = 1.73205081;  // orbit ratio
var PHI   = 1.61803399;  // golden ratio
var GOLD  = 2.39996323;  // golden angle (radians)
var BASE_SCALE = 0.16;   // base time() scale at localSpeed = 0.5
var REACH = 0.34;        // base flock orbit radius (nx/ny units)
var FOCUS_MIN = 1.7;     // softest core falloff (broad, smooth flock body)
var FOCUS_MAX = 3.6;     // tightest (HD) core falloff — still crisp, less spiky

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
// Per-center positions + a coarse velocity-direction term, resolved once per
// frame in beforeRender (cheap per-pixel path = HD on a 5000-instr budget).
var ax = 0.5, ay = 0.5, bx = 0.5, by = 0.5;
var cx = 0.5, cy = 0.5, dx = 0.5, dy = 0.5;
var avx = 0.0, bvx = 0.0, cvx = 0.0, dvx = 0.0;  // x-velocity sign proxy per center
var coreFocus = 4.0;   // resolved focus this frame
var coreGain = 0.7;    // resolved flock brightness this frame (tracks flockEnergy)
var frameGain = 0.7;   // resolved whole-frame brightness gain (PRIMARY, tracks micLow)
var reachNow = 0.34;   // resolved orbit radius this frame (expands with build)
var churn = 0.0;       // sparkle re-roll term for scatter glints

// Irrational orbit phase bases (radians). Per-center prime-ish offsets keep the
// four centers desynchronised; each uses its own irrational time() scale so no
// two ever beat into a common period.
var orbA = 0.0, orbB = 0.0, orbC = 0.0, orbD = 0.0;
var orbA2 = 0.0, orbB2 = 0.0, orbC2 = 0.0, orbD2 = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var scl = BASE_SCALE / localMult;

  // Irrational, per-center time bases (each scale is the base / an irrational).
  orbA  = time(scl)        * 6.2831853;
  orbB  = time(scl / SQRT2) * 6.2831853;
  orbC  = time(scl / SQRT3) * 6.2831853;
  orbD  = time(scl / PHI)   * 6.2831853;
  orbA2 = time(scl / 1.273) * 6.2831853;   // 1.273 ~ 4/PI, irrational
  orbB2 = time(scl / 2.236) * 6.2831853;   // 2.236 ~ sqrt5
  orbC2 = time(scl / 0.786) * 6.2831853;   // 0.786 ~ PI/4
  orbD2 = time(scl / 1.902) * 6.2831853;   // 1.902 irrational

  _hsv2rgb1();
  _hsv2rgb2();

  // micFlux build expands the flock outward (murmuration BUILD): the centers
  // fly APART so the storm spreads across more of the rig. This is a SPATIAL
  // dimension — we keep its brightness side-effect small (cores stay the same
  // size) so build doesn't steal the brightness budget from micLow.
  var bl = clamp01(build);
  reachNow = REACH * (0.86 + bl * 0.42);
  coreFocus = FOCUS_MIN + (FOCUS_MAX - FOCUS_MIN) * clamp01(focus);
  coreFocus = coreFocus * (1.0 - bl * 0.12);   // build only slightly softens cores

  // micLow cohesion: flock brightness climbs with flockEnergy -> the PRIMARY
  // drive of overall brightness (more energy = brighter, denser flock). The
  // gain spans a wide range and multiplies the WHOLE frame (dense + haze) so
  // total rig brightness tracks micLow monotonically (strong corr).
  coreGain = 0.45 + clamp01(flockEnergy) * 0.85;

  // PRIMARY whole-frame gain: the flock layer is multiplied by frameGain, which
  // is driven almost ENTIRELY by flockEnergy (micLow) so TOTAL rig brightness
  // tracks the low band hard and monotonically -> primary corr. A small floor
  // keeps a faint flock alive at zero audio; build/scatter deliberately do NOT
  // lift brightness here (they own SPATIAL dimensions — expansion + glints — so
  // they don't compete with micLow for the brightness budget).
  var fe = clamp01(flockEnergy);
  frameGain = 0.22 + 2.8 * fe * fe * fe;

  // Four density centers on irrational Lissajous orbits. Velocity proxy = the
  // cos of the dominant phase (leads the sin position by 90deg), used to lean
  // colour toward cp1 (incoming) or cp2 (outgoing) as the center banks.
  ax = 0.5 + reachNow * sin(orbA * SQRT2 + sin(orbB) * 0.6) * 0.78;
  ay = 0.5 + reachNow * cos(orbA2 * PHI - orbB) * 0.66;
  avx = cos(orbA * SQRT2 + sin(orbB) * 0.6);

  bx = 0.5 + reachNow * cos(orbB * PHI + 2.2) * 0.84;
  by = 0.5 + reachNow * sin(orbB2 * SQRT2 + orbC) * 0.6;
  bvx = -sin(orbB * PHI + 2.2);

  cx = 0.5 + reachNow * sin(orbC * SQRT3 - 1.1) * 0.7;
  cy = 0.5 + reachNow * cos(orbC2 + orbA * 0.5) * 0.72;
  cvx = cos(orbC * SQRT3 - 1.1);

  dx = 0.5 + reachNow * cos(orbD * SQRT2 + orbC * 0.4) * 0.72;
  dy = 0.5 + reachNow * sin(orbD2 * PHI - orbB * 0.3) * 0.64;
  dvx = -sin(orbD * SQRT2 + orbC * 0.4);

  // Sparkle re-roll term so scatter glints twinkle/move over time.
  churn = time(0.05 / (0.25 + localSpeed * 0.6));
}

export function render3D(index, x, y, z) {
  // x, y are already normalised 0..1 across the rig in this engine.
  var nx = clamp01(x);
  var ny = clamp01(y);

  // Proximity to each flock density center (crisp HD cores via contrast power).
  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);
  var dD = hypot(nx - dx, ny - dy);

  var gA = max(0.0, 1.0 - dA * coreFocus);
  var gB = max(0.0, 1.0 - dB * coreFocus);
  var gC = max(0.0, 1.0 - dC * coreFocus);
  var gD = max(0.0, 1.0 - dD * coreFocus);
  // Sharpen to crisp cores (true-black sparse sky between clusters). Squared
  // (not cubed) keeps cores defined yet broad enough to overlap several pixels,
  // so the flock TOTAL stays smooth as it moves -> micLow dominates corr.
  gA = gA * gA;
  gB = gB * gB;
  gC = gC * gC;
  gD = gD * gD;

  // Density field. PRIMARY brightness drive: coreGain scales with micLow, so a
  // louder low band makes every cluster brighter AND lights more sky.
  var dense = coreGain * (gA + gB + gC + gD);

  // Velocity-direction colour: each center contributes its velocity-sign proxy
  // weighted by how much it lights this pixel. Leading edge -> cp1, trailing
  // edge -> cp2, so both palette colours storm across the rig as it banks.
  var glowSum = gA + gB + gC + gD;
  var velMix = 0.5;
  if (glowSum > 0.0001) {
    var vsum = gA * avx + gB * bvx + gC * cvx + gD * dvx;
    velMix = 0.5 + 0.5 * (vsum / glowSum);
  }
  velMix = clamp01(velMix);

  // micHigh scatter: birds shatter into bright deterministic single-pixel glints
  // riding on the flock field — a 2nd, orthogonal dimension. Glints favour where
  // the flock already is (gated by the density field) so highs make the storm
  // sparkle rather than spraying random noise on empty sky.
  var glint = 0.0;
  if (scatter > 0.0) {
    var seed = index * 12.9898 + z * 37.719 + churn * 53.41;
    var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
    spk = spk * spk;        // 0..1 biased low
    spk = spk * spk;        // sharpen -> crisp glints
    var thr = 0.93 - scatter * 0.6;
    if (spk > thr) {
      var amt = (spk - thr) / (1.0 - thr + 0.0001);
      // Gate by local density (+ a little base) so glints live on the flock.
      glint = clamp01(amt) * scatter * (0.35 + 0.65 * clamp01(glowSum)) * 1.25;
      glint = clamp01(glint);
    }
  }

  // Faint living night sky so the rig never reads fully black (mission-critical).
  // Slow aperiodic haze drift on irrational phases. This is a SMOOTH, always-on
  // floor (NOT multiplied by frameGain) so silence stays calm-but-visible and
  // its stable per-frame level does not pollute the micLow brightness corr.
  var hz = haze * (0.45 + 0.55 * wave(nx * SQRT2 * 0.5 + ny * 0.4 + orbA / 6.2831853));
  hz = hz * 0.32;

  // PRIMARY: the dense flock body is multiplied by frameGain (micLow) so the
  // storm's brightness tracks the low band hard and monotonically. The scatter
  // GLINTS (micHigh) and the smooth haze floor are layered on TOP, NOT scaled by
  // frameGain — they are independent dimensions (sparkle / night sky), so they
  // stay punchy in a hats-heavy drop with little low-band and don't pollute the
  // micLow brightness correlation.
  var body = dense * frameGain;

  var bri = hz;
  if (body > bri) bri = body;
  if (glint > bri) bri = glint;
  bri = clamp01(bri);

  // Glints pull colour toward cp1 (cool glints) for a crisp shimmer pop.
  var tcol = velMix;
  if (glint > body) tcol = velMix * 0.35;
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Crisp white core only on the very densest cluster peaks + scatter glints.
  var white = 0.0;
  if (dense > 0.7) white = (dense - 0.7) * 0.5;
  if (glint > white) white = glint * 0.5;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), 0.0, 0.0);
}
