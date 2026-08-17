// DRAFT — pending operator review
/*
  30_organ_bellows.js — ORGAN BELLOWS

  CONCEPT
    The ship is a slow mechanical instrument: upper and lower Organ chambers
    compress in strict counterphase, then the Hull answers with a delayed
    pressure wave. This is localized machine breathing, never a whole-rig
    brightness pulse.

  INSTRUMENT STAGING
    FIX_PAR        — hero bellows, split into complementary upper/lower
                     chambers with crisp internal ribs.
    FIX_BAR_18     — broad pressure body that follows the Organs 0.62 seconds
                     late, crossed by restrained longitudinal reinforcement.
    FIX_RAW_LED    — steady dark casing with a moving pressure seam.
    FIX_VINTAGE_6  — palette-RGB valve indicators; no native white.
    FIX_TE_SIGN    — paired fixture-local pressure diagrams, bright and
                     exactly balanced between the two signs.

  MOTION / MATH
    A raised cosine is passed through a controllable cubic dwell curve. Its
    exact complement drives the opposite vertical Organ chamber, guaranteeing
    anti-correlated motion. Chamber Count changes the density of Y ribs. Hull
    response evaluates the same dwell wave at phase - rate * 0.62, making the
    delay explicit in seconds instead of inventing another oscillator.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — rate of the mechanical cycle.
    chamberCount  — density of the bellows ribs.
    compression   — upper/lower pressure contrast.
    dwell         — time visually held near open and closed extrema.
    organLevel    — prominence of the organ-driven machine above the floor;
                    PAR bellows remain its strongest voice.
    hullResonance — strength of the delayed Hull pressure response.
    safetyFloor   — minimum whole-model visibility.

  AUDIO_MODULATION_V1:
    sliderCompression   <- micLow  range 0.20..0.52 curve ease   # bass deepens the opposing chambers
    sliderHullResonance <- micFlux range 0.12..0.40 curve linear # spectral change wakes the delayed hull
  Static (unmapped) params: localSpeed, chamberCount, dwell, organLevel,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the cp1-to-cp2 line. Native W, A, and UV are zero
    on every fixture, so W=A exactly. Silence remains a complete, visible
    composition on Titanic and portable fixture-role models.
*/

export var localSpeed = 0.30;
export var chamberCount = 0.46;
export var compression = 0.36;
export var dwell = 0.48;
export var organLevel = 0.68;
export var hullResonance = 0.28;
export var safetyFloor = 0.27;

export var cp1H = 0.585, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.095, cp2S = 0.88, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderChamberCount(v) { chamberCount = v; }
export function sliderCompression(v) { compression = v; }
export function sliderDwell(v) { dwell = v; }
export function sliderOrganLevel(v) { organLevel = v; }
export function sliderHullResonance(v) { hullResonance = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 62831.85307;
var HULL_DELAY_SECONDS = 0.62;

var bellowsPhase = 0.0;
var currentRate = 0.18;
var organUpper = 0.5;
var organLower = 0.5;
var hullPressure = 0.5;

var liveSpeed = 0.30;
var liveChamberCount = 0.46;
var liveCompression = 0.36;
var liveDwell = 0.48;
var liveOrganLevel = 0.68;
var liveHullResonance = 0.28;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}

function dwellWave(phaseValue, dwellAmount) {
  var rawWave = 0.5 + 0.5 * cos(phaseValue);
  // Two cubic passes flatten the neighborhoods around both endpoints without
  // changing either endpoint or breaking upper/lower complementarity.
  var heldWave = smooth01(smooth01(rawWave));
  return rawWave + (heldWave - rawWave) * clamp01(dwellAmount);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Slewed controls keep live MIDI edits from snapping mechanical geometry.
  var follow = min(1.0, dt * 4.5);
  liveSpeed += (localSpeed - liveSpeed) * follow;
  liveChamberCount += (chamberCount - liveChamberCount) * follow;
  liveCompression += (compression - liveCompression) * follow;
  liveDwell += (dwell - liveDwell) * follow;
  liveOrganLevel += (organLevel - liveOrganLevel) * follow;
  liveHullResonance += (hullResonance - liveHullResonance) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var speedMultiplier = 0.25 + clamp01(liveSpeed)
    * (32.824 - 16.412 * clamp01(liveSpeed));
  currentRate = 0.46 * speedMultiplier;
  bellowsPhase += dt * currentRate;
  if (bellowsPhase >= PHASE_WRAP) bellowsPhase -= PHASE_WRAP;

  organUpper = dwellWave(bellowsPhase, liveDwell);
  organLower = 1.0 - organUpper;
  hullPressure = dwellWave(bellowsPhase - currentRate * HULL_DELAY_SECONDS,
                           liveDwell * 0.78);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var roleBrightness = 0.50;
  var colorMix = 0.50;

  if (fixtureType == FIX_PAR) {
    // The vertical split is soft enough for physical pools of light, while
    // the underlying envelopes remain exact complements in time.
    var upperWeight = smoothstep(0.43, 0.57, uy);
    var chamberPressure = organLower
                        + (organUpper - organLower) * upperWeight;
    var chamberDensity = 2.0 + clamp01(liveChamberCount) * 8.0;
    var ribPhase = uy * chamberDensity;
    var ribCell = ribPhase - floor(ribPhase);
    var ribDistance = abs(ribCell - 0.5) * 2.0;
    var ribBody = smoothstep(0.04, 0.34, ribDistance);
    var compressionDepth = 0.28 + clamp01(liveCompression) * 0.70;
    var pressureBody = 0.18 + chamberPressure * compressionDepth;
    roleBrightness = pressureBody * (0.62 + ribBody * 0.38);
    colorMix = clamp01(0.20 + chamberPressure * 0.72
                     + (ribBody - 0.5) * 0.10);
  } else if (fixtureType == FIX_BAR_18) {
    // Broad delayed pressure across the Hull, with a secondary longitudinal
    // brace that never overwhelms the explicit Organ-to-Hull lag.
    var braceDensity = 1.0 + clamp01(liveChamberCount) * 4.5;
    var longBrace = 0.5 + 0.5 * cos((ux * braceDensity - uz * 0.72) * PI2
                                  + bellowsPhase * 0.13);
    longBrace = smooth01(longBrace);
    var hullAmount = clamp01(liveHullResonance);
    var pressureDepth = 0.18 + clamp01(liveCompression) * 0.82;
    var compressedHull = 0.5 + (hullPressure - 0.5) * pressureDepth;
    roleBrightness = 0.30 + hullAmount
                   * (0.22 + compressedHull * 0.68)
                   * (0.76 + longBrace * 0.24);
    colorMix = clamp01(0.16 + compressedHull * 0.62 + longBrace * 0.12);
  } else if (fixtureType == FIX_RAW_LED) {
    // A narrow casing seam moves through a stable outline. This movement is
    // spatial, so the Silhouette does not join the global pressure pulse.
    var seamAxis = ux * 0.72 + uz * 0.28;
    var casingDensity = 1.2 + clamp01(liveChamberCount) * 3.6;
    var seamWave = 0.5 + 0.5 * cos((seamAxis * casingDensity
                                  - bellowsPhase * 0.11)
                                 * PI2);
    var casingSeam = smoothstep(0.74, 0.98, seamWave);
    roleBrightness = 0.34 + casingSeam * 0.38;
    colorMix = 0.08 + casingSeam * 0.24;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Alternating fixture-local valves. Palette RGB only: the pattern's
    // machine room is colored brass, not generic white sparkle.
    var valveStride = 1.0 + clamp01(liveChamberCount) * 2.0;
    var valveOffset = (pixelLocalIndex % 6.0) * GOLDEN_ANGLE * valveStride;
    var valveWave = 0.5 + 0.5 * cos(bellowsPhase * SQRT2 + valveOffset);
    var valveOpen = smoothstep(0.58, 0.92, valveWave);
    roleBrightness = 0.35 + valveOpen * 0.65;
    colorMix = 0.64 + valveOpen * 0.31;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Each sign is patched as 40 + 34 pixels. Fold one complete row-major
    // 10x8/74-pixel pressure diagram so its second fixture continues the
    // surface and both complete signs remain byte-identical.
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    var signY = floor(signIndex / 10.0) / 7.0;
    var signUpperWeight = smoothstep(0.42, 0.58, signY);
    var signPressureRaw = organLower
                        + (organUpper - organLower) * signUpperWeight;
    var signPressureDepth = 0.24 + clamp01(liveCompression) * 0.76;
    var signPressure = 0.5 + (signPressureRaw - 0.5) * signPressureDepth;
    var diagramDensity = 1.5 + clamp01(liveChamberCount) * 4.0;
    var diagramLine = 0.5 + 0.5 * cos((signX * diagramDensity
                                    + signY * SQRT3)
                                    * PI2 - bellowsPhase * 0.21);
    var diagramInk = smoothstep(0.56, 0.94, diagramLine);
    roleBrightness = 0.46 + signPressure * 0.22 + diagramInk * 0.28;
    colorMix = clamp01(0.24 + signPressure * 0.46 + diagramInk * 0.18);
  }

  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.175;
  // This is the organ-driven machine's shared authored layer. At zero, every
  // instrument keeps only a quiet shadow of its mechanical role above the
  // independently controlled safety floor; at one the full staging speaks.
  var machineLevel = 0.50 + clamp01(liveOrganLevel) * 0.50;
  var brightness = floorLevel + (1.0 - floorLevel)
                 * clamp01(roleBrightness) * machineLevel;
  var mixAmount = clamp01(colorMix);
  var red = (pr1 + (pr2 - pr1) * mixAmount) * brightness;
  var green = (pg1 + (pg2 - pg1) * mixAmount) * brightness;
  var blue = (pb1 + (pb2 - pb1) * mixAmount) * brightness;
  rgbwau(clamp01(red), clamp01(green), clamp01(blue), 0.0, 0.0, 0.0);
}
