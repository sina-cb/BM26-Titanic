/*
  35_sparkle_rain.js — crisp falling glints over a living two-color rain field.

  IDENTITY
    Fine deterministic droplets fall through a near-black field. Rain and
    highlights stay inside the selected palette, while fixture roles
    turn the same portable spatial field into a composed rig-wide shower.

  PORTABLE FIXTURE STAGING
    FIX_BAR_18     — primary rain canvas and strongest falling field.
    FIX_RAW_LED    — vertical luminous traces through the falling droplets.
    FIX_VINTAGE_6 — sparse Jewelry droplets with matched W+A phosphor.
    FIX_PAR        — restrained beat punctuation, never a full glare wall.
    FIX_TE_SIGN    — steady, readable identity bed with only a subtle rain echo.
    World coordinates author the common field. No model-specific group, view,
    controller, fixture id, or section id is used.

  CLOCKS
    Fall, sparkle churn, trace, and base color each own a delta-accumulated phase
    in turns. Each wraps only after 10000 complete turns, so there is no short
    time() re-lock or irrational post-wrap discontinuity.

  CONTROLS (physical MIDI order preserved)
    localSpeed — overall pace of fall, churn, traces, and field drift.
    level      — overall rain brightness; primary low-band handle.
    density    — spatial count of active droplets; high-band detail handle.
    kick       — clear beat-driven shower punch: more droplets plus a rain veil.
    fall       — downward travel speed independent of sparkle churn.
    intensity  — material peak strength of each glint, not glint count.
    base       — silence-safe living field floor.

  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.25..1.00 curve linear  # bass lifts the full shower
    sliderDensity <- micHigh range 0.18..1.00 curve linear  # highs add spatial droplet count
    sliderKick    <- micKick range 0.00..1.00 curve pow2    # beat launches a bright shower punch
  Static params: localSpeed, fall, intensity, base, colorPalette1/2.
*/

// Canonical append-only optional fixture role; absent roles match no pixels.
var FIX_RAW_LED = 1;

export var localSpeed = 0.5;
export var level = 0.5;
export var density = 0.5;
export var kick = 0.0;
export var fall = 0.5;
export var intensity = 0.85;
export var base = 0.12;

export var cp1H = 0.58, cp1S = 0.35, cp1V = 1.0;
export var cp2H = 0.12, cp2S = 0.45, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderDensity(v) { density = v; }
export function sliderKick(v) { kick = v; }
export function sliderFall(v) { fall = v; }
export function sliderIntensity(v) { intensity = v; }
export function sliderBase(v) { base = v; }

// FIX_TE_SIGN is append-only role id 7 in the canonical fixture registry. It is
// self-declared so this portable pattern also compiles on models with no sign;
// such models simply have no fixtureType 7 pixels to stage.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var fallPhase = 0.0;
var churnPhase = 0.0;
var tracePhase = 0.0;
var basePhase = 0.0;
var levelGain = 1.0;

function sparkleSample(seed) {
  var hash = sin(seed) * sin(seed * 1.713 + 1.3) * sin(seed * 3.117 + 2.1);
  hash = hash * hash;
  hash = hash * hash;
  // Churn is a seam-safe probability modulation, not a discontinuous reseed.
  var churn = wave(churnPhase + sin(seed * 0.071) * 0.43);
  return hash * (0.66 + churn * 0.34);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  var fallRate = 0.055 + fall * fall * 0.72;

  fallPhase = fallPhase + dt * fallRate * rate;
  churnPhase = churnPhase + dt * 0.19 * rate;
  tracePhase = tracePhase + dt * 0.11 * rate;
  basePhase = basePhase + dt * 0.027 * rate;

  if (fallPhase >= PHASE_WRAP) fallPhase = fallPhase - PHASE_WRAP;
  if (churnPhase >= PHASE_WRAP) churnPhase = churnPhase - PHASE_WRAP;
  if (tracePhase >= PHASE_WRAP) tracePhase = tracePhase - PHASE_WRAP;
  if (basePhase >= PHASE_WRAP) basePhase = basePhase - PHASE_WRAP;

  // Wide enough for micLow to read clearly, with a non-black silence floor.
  levelGain = 0.18 + level * level * 2.95;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  // Crisp deterministic cell identity. Two adjacent falling rows crossfade with
  // a smoothstep, so cell turnover never produces a whole-rig frame jump.
  var cellTravel = (ny + fallPhase) * 21.0;
  var row = floor(cellTravel);
  var cellFrac = cellTravel - row;
  var rowBlend = cellFrac * cellFrac * (3.0 - 2.0 * cellFrac);
  var col = floor(nx * 19.0 + nz * 7.0);
  var seed = index * 12.9898 + row * 78.233 + col * 37.719;
  var seedNext = seed + 78.233;
  var sampleNow = sparkleSample(seed);
  var sampleNext = sparkleSample(seedNext);
  var candidate = sampleNow + (sampleNext - sampleNow) * rowBlend;

  // Density owns count: it moves only the activation threshold. The span is
  // intentionally large so the fader travels from rare pinpricks to rainfall.
  var d = clamp01(density);
  var kk = clamp01(kick);
  var threshold = 0.975 - d * 0.61 - kk * 0.24;
  if (isVintage) threshold = threshold + 0.12; // Jewelry remains sparse.
  if (isPar) threshold = threshold + 0.16;     // Pars punctuate, never flood.

  var glint = 0.0;
  if (candidate > threshold) {
    var amt = (candidate - threshold) / (1.0 - threshold + 0.0001);
    amt = clamp01(amt);
    // Intensity owns peak amplitude and does not change the number of droplets.
    glint = pow(amt, 0.42) * (0.015 + intensity * intensity * 2.15);
  }
  // A narrow pre-glint halo belongs to the same deterministic droplet cell. It
  // makes Intensity's amplitude travel visible around each peak without moving
  // the activation threshold that Density owns.
  var halo = 0.0;
  var haloThreshold = threshold - 0.19;
  if (candidate > haloThreshold) {
    halo = (candidate - haloThreshold) / 0.19;
    halo = clamp01(halo) * intensity * intensity * 0.44;
  }
  glint = glint + halo;
  // A very narrow continuous crest gives Intensity material peak-brightness
  // travel even when Density is sparse. It changes amplitude, not the main
  // droplet activation threshold, so Density remains the count control.
  var peakField = wave(churnPhase * 0.43 + nx * 7.1 + ny * 11.3 + nz * 3.7);
  peakField = pow(peakField, 16.0);
  var intensityPeak = peakField * intensity * intensity * 0.15;

  // Resolve cell-boundary travel into a short head/tail profile. This retains
  // crisp droplets while making their downward movement legible between rows.
  var dropHead = wave(cellTravel);
  dropHead = dropHead * dropHead;
  glint = glint * (0.36 + dropHead * 0.64);

  // Smooth living field under the points. Bars carry the rain canvas; raw LED
  // strands carry a narrower descending vertical trace.
  var fieldWave = wave(ny * 2.6 + fallPhase * 0.34 + nx * 0.31);
  var wash = 0.22 + 0.78 * wave(nx * 1.7 + ny * 0.63 + nz * 0.41);
  var baseV = base * (0.42 + wash * 0.58) * (0.74 + fieldWave * 0.26);
  // A second, much broader curtain makes the rain legible from playa distance.
  // It is continuous analytic motion—not extra randomized droplets—so the
  // original crisp points remain visible inside a coherent falling sheet.
  var curtainColumn = pow(wave(nx * 5.2 + nz * 2.3
                             + churnPhase * 0.17), 3.0);
  var curtainFall = pow(wave((ny + fallPhase) * 4.2
                           + nx * 0.23 - nz * 0.11), 1.65);
  var rainCurtain = curtainColumn * curtainFall
                  * (0.035 + d * 0.075);
  var trace = 0.0;
  if (isBar) {
    baseV = baseV * 1.18 + rainCurtain * 1.25;
    glint = glint * 1.14;
  } else if (isRaw) {
    var traceShape = triangle(ny * 3.2 + fallPhase * 0.72
                            + tracePhase + nx * 0.37);
    trace = pow(traceShape, 4.2) * (0.070 + d * 0.20)
          + rainCurtain * 0.92;
    baseV = baseV * 0.72;
    glint = glint * 0.92;
  } else if (isVintage) {
    baseV = baseV * 0.44;
    glint = glint * 1.08;
    intensityPeak = intensityPeak * 0.36;
  } else if (isPar) {
    baseV = baseV * 0.52;
    glint = glint * 0.48;
    intensityPeak = intensityPeak * 0.24;
  }
  if (isSign) intensityPeak = 0.0;

  // Kick is a genuine shower event: a descending spatial veil plus brighter
  // activated droplets. Pars receive only restrained punctuation.
  var showerBand = pow(wave(ny * 1.35 + fallPhase * 0.23 + nx * 0.08), 3.4);
  var kickVeil = kk * (0.055 + showerBand * 0.24);
  if (isBar) kickVeil = kickVeil * 1.25;
  else if (isRaw) kickVeil = kickVeil * 0.92;
  else if (isVintage) kickVeil = kickVeil * 0.42;
  else if (isPar) kickVeil = kk * (0.025 + showerBand * 0.08);

  glint = clamp01(glint * (1.0 + kk * 0.85));
  var v = clamp01((baseV + trace + glint * 0.48 + kickVeil) * levelGain);

  var tCol = triangle(nx * 2.3 + ny * 0.6 + basePhase * 0.42);
  var sparkMix = clamp01(glint * 0.96 + kickVeil * 0.35
                       + intensityPeak * 1.40);
  var r = (pr1 + (pr2 - pr1) * tCol) * v + pr1 * sparkMix * 0.46;
  var g = (pg1 + (pg2 - pg1) * tCol) * v + pg1 * sparkMix * 0.46;
  var b = (pb1 + (pb2 - pb1) * tCol) * v + pb1 * sparkMix * 0.46;

  var w = 0.0;
  if (isVintage) {
    // Jewelry favours palette 2 and adds explicit, byte-matched white/amber.
    // Its RGB remains strictly palette-derived; no fixed gold/orange tint.
    var jewelryV = clamp01(v * 0.34 + baseV * 0.40 + glint * 0.56
                         + kickVeil * 0.18 + intensityPeak * 0.74);
    var jewelryMix = clamp01(0.72 + tCol * 0.28);
    r = (pr1 + (pr2 - pr1) * jewelryMix) * jewelryV;
    g = (pg1 + (pg2 - pg1) * jewelryMix) * jewelryV;
    b = (pb1 + (pb2 - pb1) * jewelryMix) * jewelryV;
    w = clamp01((glint * (0.12 + intensity * 0.78)
               + intensityPeak * 0.85) * levelGain);
  } else if (isPar) {
    // Restrained palette punctuation rather than a fixed warm wash.
    var parPulse = clamp01(glint * 0.20 + kickVeil * 0.52);
    var parV = clamp01(v * 0.70 + parPulse * 0.42);
    var parMix = clamp01(0.58 + tCol * 0.35);
    r = (pr1 + (pr2 - pr1) * parMix) * parV;
    g = (pg1 + (pg2 - pg1) * parMix) * parV;
    b = (pb1 + (pb2 - pb1) * parMix) * parV;
  } else if (isSign) {
    // Identity is a luminous rain-window. Two broad analytic droplet fronts
    // descend through XYZ and the traced letter path; neither hashes nor
    // reseeds, so this reads as falling rain rather than fixed chandelier dots.
    var signPath = pixelLocalIndex * 0.01351351351;
    var rainCoordA = ny * 7.5 + nz * 0.65 + nx * 0.31
                   + signPath * 0.08 + fallPhase * 2.50;
    var rainCoordB = ny * 4.3 + nz * 1.20 - nx * 0.60
                   + signPath * 0.21 + fallPhase * 1.50 + 0.37;
    var rainHeadA = wave(rainCoordA);
    var rainHeadB = wave(rainCoordB);
    var dropA = pow(rainHeadA, 1.55);
    var dropB = pow(rainHeadB, 1.95);
    var rainCoordC = ny * 2.7 - nz * 1.45 + nx * 0.88
                   + signPath * 0.31 + fallPhase * 0.92 + 0.19;
    var dropC = pow(wave(rainCoordC), 2.15);
    var rainColumn = 0.55 + 0.45
                   * wave(signPath * (1.5 + d * 3.5) + nx * 0.73 + nz * 0.41);
    var signRain = (dropA * 0.48 + dropB * 0.30 + dropC * 0.22)
                 * rainColumn;
    var rainTail = wave(rainCoordA - 0.16) * rainColumn;
    var signV = clamp01((0.37 + signRain * 0.31 + rainTail * 0.12
                      + kk * (0.03 + signRain * 0.12))
                      * (0.55 + level * 0.65));
    var signMix = clamp01(0.18 + signRain * 0.50 + rainTail * 0.18);
    r = (pr1 + (pr2 - pr1) * signMix) * signV;
    g = (pg1 + (pg2 - pg1) * signMix) * signV;
    b = (pb1 + (pb2 - pb1) * signMix) * signV;
    w = 0.0;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
