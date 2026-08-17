/*
  33_aurora_breath.js — BOREALIS SAILS: two immense breathing light-veils.

  CURRENT DESIGN: two
  curved, near-orthogonal signed-distance sheets twist through the full XYZ
  ship volume. Their independent folds travel in opposite directions; their
  intersection forms a moving magnetic spine. The breath opens and thickens
  the sails, Ribbons changes their internal fold count, Soft changes physical
  sheet thickness, and Shimmer illuminates continuous fold nodes—never a
  random per-pixel sparkle field. TE signs show a strengthened cross-section,
  PARs act as palette-coloured roots, and Vintage alone receives matched W+A
  aurora-star glints.

  CONTROLS (UI order = declaration order)
    - localSpeed : magnetic rotation and fold-travel rate.
    - level      : direct whole-aurora energy. Modulatable.
    - shimmer    : moving fold-node and intersection brilliance. Modulatable.
    - breathRate : autonomous sail-opening cadence.
    - breathDepth: sail separation and breathing width.
    - ribbons    : structural fold count inside both sails.
    - soft       : sail thickness and edge softness.
    - base       : moving palette-coloured visibility floor.
    - colorPalette1/2 : the two aurora materials.

  AUDIO (modulators-only — never read CPC audio globals natively):
AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.10..1.00 curve pow2     # PRIMARY brightness: keeps detail in quiet lows, then blooms clearly
  sliderShimmer <- micHigh range 0.00..0.85 curve pow2     # detail: highs add fine crisp crest sparkle (distinct axis)
  sliderBreathDepth <- micFlux range 0.25..0.90 curve linear # musical motion: flux widens the autonomous curtain breath
  # sliderBreathRate  static 0.50  # breath speed (autonomous, not audio-driven)
  # sliderRibbons     static 0.50  # ribbon density (geometry, not audio-driven)
  # sliderSoft        static 0.50  # edge softness (geometry, not audio-driven)
  # sliderBase        static 0.14  # silence visibility floor (static)
  # sliderLocalSpeed  static 0.50  # operator drift rate, not an audio target
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
// Optional accent role: self-declare the append-only canonical registry id so
// models without TE signs compile without changing their authored output.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // magnetic heading / fold-travel rate
export var level = 0.5;        // LOW level -> DIRECT brightness (the glow); 0.5 =
                               // a bright, blooming aurora with NO audio (Phase-1 default)
export var shimmer = 0.4;      // HIGH level -> moving fold-node brilliance
export var breathRate = 0.5;   // autonomous sail-opening speed
export var breathDepth = 0.5;  // sail separation / breathing width
export var ribbons = 0.5;      // structural fold count
export var soft = 0.5;         // sail thickness / edge softness
export var base = 0.14;        // moving visibility floor (silence still reads)

export var cp1H = 0.34, cp1S = 1.0, cp1V = 1.0; // green (horizon, low ny)
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // magenta / violet (crown, high ny)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }         // micLow maps here (PRIMARY)
export function sliderShimmer(v) { shimmer = v; }      // micHigh maps here (DETAIL)
export function sliderBreathRate(v) { breathRate = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderRibbons(v) { ribbons = v; }
export function sliderSoft(v) { soft = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MIN_RIBBONS = 1.5;   // ribbon count at sliderRibbons = 0
var MAX_RIBBONS = 7.0;   // ribbon count at sliderRibbons = 1
var SQRT2 = 1.41421;     // incommensurate ribbon frequency A
var PHI   = 1.61803;     // incommensurate ribbon frequency B (golden ratio)
var PHASE_WRAP = 10000.0; // large wrap keeps every visible scaled phase continuous
var GA    = 2.39996;     // golden angle (radians) — shimmer hash, never repeats

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

// ── Persistent / per-frame state ──────────────────────────────────────────────
var drift = 0.0;       // magnetic heading phase
var weaveDrift = 0.0;  // independent fold-travel phase
var undulate = 0.0;    // slow centerline-bend phase
var colorWobble = 0.0; // moving polar-haze phase
var shimT = 0.0;       // continuous fold-node travel phase
var slowShim = 0.0;    // very slow Identity silk / floor phase
var breathe = 0.0;     // autonomous breath swell/ebb phase, 0..1
var ribCount = 3.0;    // resolved ribbon count this frame
var breathSwell = 0.5; // resolved autonomous expansion phase this frame
var floorV = 0.18;     // resolved calm floor this frame
var shimGain = 0.0;    // resolved shimmer (high-band) gain this frame
var briLevel = 1.0;    // resolved DIRECT brightness multiplier (the glow level)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Local-speed trim, exponential so the fader feels even (matches template).
  var localMult = pow(2.0, (localSpeed - 0.5) * 7.0);
  var shimmerMult = pow(2.0, (localSpeed - 0.5) * 5.0);

  drift       = drift       + dt * 0.090 * localMult;
  weaveDrift  = weaveDrift  + dt * 0.054 * localMult;
  undulate    = undulate    + dt * 0.034 * localMult;
  colorWobble = colorWobble + dt * 0.017 * localMult;
  slowShim    = slowShim    + dt * 0.011 * localMult;
  // Fold nodes move faster than the monumental sails, but stay continuous.
  shimT = shimT + dt * 0.900 * shimmerMult;
  if (drift >= PHASE_WRAP) drift = drift - PHASE_WRAP;
  if (weaveDrift >= PHASE_WRAP) weaveDrift = weaveDrift - PHASE_WRAP;
  if (undulate >= PHASE_WRAP) undulate = undulate - PHASE_WRAP;
  if (colorWobble >= PHASE_WRAP) colorWobble = colorWobble - PHASE_WRAP;
  if (slowShim >= PHASE_WRAP) slowShim = slowShim - PHASE_WRAP;
  if (shimT >= PHASE_WRAP) shimT = shimT - PHASE_WRAP;

  // The breath runs on its own clock, independent of localSpeed and audio.
  // Exponential rate
  // so the breathRate fader feels even (slow ~24 s .. brisk ~1.5 s per breath; the
  // ~6 s default reads as a calm, natural breath).
  var breathMult = pow(2.0, (breathRate - 0.5) * 4.0);
  breathe = breathe + dt * 0.165 * breathMult; breathe = breathe - floor(breathe);

  ribCount = MIN_RIBBONS + ribbons * (MAX_RIBBONS - MIN_RIBBONS);

  // A softened full-travel swell opens, separates and thickens both sails.
  var swell = triangle(breathe);             // 0..1 full-travel swell/ebb
  swell = swell * swell * (3.0 - 2.0 * swell); // soften the turnarounds
  breathSwell = swell;
  // Level remains the primary direct energy handle.
  briLevel = 0.44 + level * 1.55;

  // High-band detail dimension: more highs => brighter fold intersections.
  shimGain = shimmer;

  // Calm base floor — gentle, SWELLS AND EBBS with the breath so even in silence
  // the rig visibly breathes (the floor glow brightens on the in-breath, draws
  // back on the out-breath) without pulsing the audio-driven curtain brightness.
  // A slow shimmer adds fine life on top.
  floorV = base * (0.45 + 0.45 * swell + 0.10 * wave(slowShim));
}

export function render3D(index, x, y, z) {
  // Two curved signed-distance sheets cross the full XYZ volume.
  var nx = clamp01(x);
  var ny = clamp01(y);
  // Slow magnetic rotation and autonomous breath change the sails' heading,
  // separation and thickness continuously.
  var nz = clamp01(z);
  var cx = nx - 0.5;
  var cy = ny - 0.5;
  var cz = nz - 0.5;

  // The two centerlines bend independently through height and depth.
  var heading = (drift * 0.42 + undulate * 0.17
    + (breathSwell - 0.5) * breathDepth * 0.14) * PI2;
  var hc = cos(heading);
  var hs = sin(heading);
  var sailX = cx * hc - cz * hs;
  var sailZ = cx * hs + cz * hc;

  var open = (breathSwell - 0.5) * breathDepth * 0.28;
  var bendA = sin((cy * 1.13 + sailZ * 0.47 + undulate * SQRT2) * PI2)
    * (0.055 + breathDepth * 0.055);
  var bendB = sin((cy * 0.91 - sailX * 0.53 - weaveDrift * PHI) * PI2)
    * (0.050 + breathDepth * 0.060);
  var distA = abs(sailX - bendA - open);
  var distB = abs(sailZ - bendB + open);
  var sailWidth = 0.030 + soft * 0.135
    + breathSwell * breathDepth * 0.065;
  var sheetA = clamp01(1.0 - distA / sailWidth);
  var sheetB = clamp01(1.0 - distB / sailWidth);
  var edgePower = 2.15 - soft * 1.10;
  sheetA = pow(sheetA, edgePower);
  sheetB = pow(sheetB, edgePower);

  var foldCount = 1.35 + ribCount * 0.72;
  var foldA = wave(cy * foldCount + sailZ * (1.25 + ribbons * 1.70)
    - weaveDrift * 3.0 + nx * 0.17);
  var foldB = wave(cy * foldCount * PHI - sailX * (1.10 + ribbons * 1.45)
    + drift * 2.0 - nz * 0.13);
  var veilA = sheetA * (0.26 + foldA * 0.74);
  var veilB = sheetB * (0.26 + foldB * 0.74);
  var intersection = sqrt(sheetA * sheetB);
  var curtain = clamp01(veilA + veilB * 0.92 + intersection * 0.72);

  // Soft sets the signed-distance sheet thickness and edge exponent directly.

  // Level owns sail energy; the gentle breath gain makes the opening cadence
  // legible without taking final brightness authority away from Level.
  var bri = curtain * briLevel * 0.76;
  var breathGain = 0.65 + breathSwell * (0.25 + breathDepth * 0.45);
  bri = bri * breathGain;

  // Shimmer follows continuous fold nodes and the magnetic intersection. It
  // never hashes or reseeds pixels, so live edits remain visually stable.
  var glint = 0.0;
  if (curtain > 0.0 && shimGain > 0.0) {
    var nodeA = pow(wave(cy * 3.17 + sailZ * 2.31 - shimT * 0.31), 7.0);
    var nodeB = pow(wave(cy * 2.73 - sailX * 2.57 + shimT * 0.23), 7.0);
    var foldNode = veilA * nodeA + veilB * nodeB;
    var spineNode = intersection
      * pow(wave(cy * 2.19 + (sailX - sailZ) * GA + shimT * 0.17), 5.0);
    glint = clamp01((foldNode * 0.82 + spineNode * 1.45) * shimGain * 1.35);
  }
  bri = bri + glint * 0.92;

  // A low moving polar haze protects visibility without flattening the sails.
  var polarHaze = wave(cy * 0.71 + sailX * 0.43 - sailZ * 0.37
    + colorWobble * PHI);
  var curtainFloor = floorV * (0.42 + polarHaze * 0.42);
  if (bri < curtainFloor) bri = curtainFloor;
  bri = clamp01(bri);

  // Each sail owns one palette material; intersections blend them deliberately.
  var materialTotal = veilA + veilB + 0.0001;
  var traw = clamp01(veilB / materialTotal + intersection * 0.12
    + (ny - 0.5) * 0.10);
  var tcol = traw * traw * (3.0 - 2.0 * traw);   // smoothstep(0,1,traw)
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // PAR roots stay within the selected palette; Vintage alone gets matched
  // W+A aurora stars. Both paths remain fixture-capability portable.
  if (fixtureType == FIX_TE_SIGN) {
    // Identity is a breathing aurora volume. Rotate X/Z around a Y-dependent
    // twist, then fold Y through that rotated plane: the ribbons visibly curl
    // through the sign instead of behaving like ordinary translated sine bars.
    var signX = nx - 0.5;
    var signY = ny - 0.5;
    var signZ = z - 0.5;
    var signPath = pixelLocalIndex * 0.01351351351;
    var twistAngle = (signY * (1.30 + breathDepth * 1.40)
      + drift * 4.0 + undulate * 3.0
      + (breathSwell - 0.5) * breathDepth * 0.50) * PI2;
    var twistCos = cos(twistAngle);
    var twistSin = sin(twistAngle);
    var foldX = signX * twistCos - signZ * twistSin;
    var foldZ = signX * twistSin + signZ * twistCos;
    var foldY = signY + sin((foldX * 1.70 + foldZ * 0.90
      + undulate * 4.0) * PI2) * (0.06 + breathDepth * 0.12)
      * (0.70 + breathSwell * 0.30);

    var signAxisA = wave(foldX * ribCount * 1.25 + foldY * 0.85
      + foldZ * 1.35 - drift * 4.0 + signPath * 0.040);
    var signAxisB = wave(foldZ * ribCount * 0.90 - foldY * 1.10
      + foldX * 0.70 + weaveDrift * 6.0 - signPath * 0.025);
    var signFold = 1.0 - clamp01(abs(signAxisA - signAxisB) * 2.20);
    signFold = signFold * signFold * (3.0 - 2.0 * signFold);
    var signCurtain = clamp01(0.08 + signAxisA * 0.45
      + signAxisB * 0.25 + signFold * 0.48);
    signCurtain = pow(signCurtain, 1.15 + (1.0 - soft) * 0.95);

    // Fine silk follows the folded volume and letter path. Its continuous slow
    // phase remains subordinate to the broad curling curtain, never noise.
    var signSilk = wave(foldX * 6.31 + foldY * 3.70 - foldZ * 2.30
      - slowShim * 12.0 + signPath * 0.17);
    var signFloor = 0.32 + base * 0.45 + level * 0.40;
    var signV = signFloor + signCurtain * (0.12 + level * 0.38)
      + signSilk * shimmer * 0.045;
    signV = clamp01(signV);
    var signT = clamp01(0.06 + ny * 0.78 + signCurtain * 0.10
      + signSilk * 0.06);
    signT = signT * signT * (3.0 - 2.0 * signT);
    r = (pr1 + (pr2 - pr1) * signT) * signV;
    g = (pg1 + (pg2 - pg1) * signT) * signV;
    b = (pb1 + (pb2 - pb1) * signT) * signV;
  } else if (fixtureType == FIX_PAR) {
    var rootV = clamp01(curtainFloor + curtain * briLevel * 0.58
      + intersection * 0.20);
    var rootT = clamp01(0.18 + tcol * 0.64);
    r = (pr1 + (pr2 - pr1) * rootT) * rootV;
    g = (pg1 + (pg2 - pg1) * rootT) * rootV;
    b = (pb1 + (pb2 - pb1) * rootT) * rootV;
  }

  var ww = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    // Frost catches at the physical overlap of the two sails and intensifies
    // near the open-breath crest. Fold-node glint remains a smaller secondary
    // layer, preserving broad palette-coloured aurora between white events.
    var overlapFrost = pow(intersection, 1.9)
                     * (0.24 + breathSwell * 0.76) * shimmer;
    var auroraStar = clamp01(glint * 0.54 + overlapFrost * 1.28);
    r = r + auroraStar * (pr2 * 0.22 + pr1 * 0.18);
    g = g + auroraStar * (pg2 * 0.22 + pg1 * 0.18);
    b = b + auroraStar * (pb2 * 0.22 + pb1 * 0.18);
    ww = clamp01(auroraStar * 0.62);
  }

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(clamp01(r), clamp01(g), clamp01(b), ww, ww, 0.0);
}
