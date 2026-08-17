// DRAFT — pending operator review
/*
  119_bow_stern_tidal_push.js — BOW/STERN TIDAL PUSH

  A monumental bow-to-stern compression wall meets a slower stern-to-bow
  answer. Each carries a broad recoil shelf while two incommensurate
  cross-section tides bend their faces, making the whole ship exchange water
  rather than repeat one flat sweep. The heading is intentionally fixed; this
  concept has no truthful artistic use for a Direction control.

  PORTABILITY
    The primary composition uses normalized XYZ only. No view, group, section,
    controller, raw fixture metadata, or load-bearing fixture role is required.
    FIX_TE_SIGN carries the Identity accent: each 74-pixel surface receives the
    same index-authored counter-tide, so the two TE signs stay exactly balanced,
    fully energized, and readable above a dedicated palette floor. Titanic and
    test_bench both provide this canonical role; a model without it fails the
    compile loudly instead of silently dropping the authored Identity layer.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. It is added before every other energy
    term, so no pixel can fall below the selected palette-derived intensity.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.24..1.00 curve linear # whole pressure field
    sliderPulse     <- micKick range 0.00..0.88 curve pow2   # compression crest punch
    sliderWaveWidth <- micFlux range 0.28..0.82 curve linear # builds broaden the ship-wide inhale
  # STATIC: localSpeed, recoil, contrast, safetyFloor, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.55;
export var waveWidth = 0.56;
export var recoil = 0.48;
export var contrast = 0.58;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.58, cp1S = 0.88, cp1V = 1.0; // deep pressure water
export var cp2H = 0.12, cp2S = 0.72, cp2V = 1.0; // luminous compression crest
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderWaveWidth(v) { waveWidth = v; }
export function sliderRecoil(v) { recoil = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Canonical append-only registry id. The injector fails loudly when absent.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var travelPhase = 0.0;
var returnPhase = 0.37;
var crossPhase = 0.13;
var lowerPhase = 0.183847;
var shelfPhase = 0.080344;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smoothUnit(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function circularDistance(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Local Speed is the sole rate control. The independent incommensurate clocks
  // retain their current phase through live edits and avoid a visible re-lock.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  travelPhase = travelPhase + dt * 0.096 * localMultiplier;
  returnPhase = returnPhase + dt * 0.061803 * localMultiplier;
  crossPhase = crossPhase + dt * 0.039191 * localMultiplier;
  lowerPhase = lowerPhase + dt * 0.055425 * localMultiplier;
  shelfPhase = shelfPhase + dt * 0.024222 * localMultiplier;
  if (travelPhase >= PHASE_WRAP) travelPhase = travelPhase - PHASE_WRAP;
  if (returnPhase >= PHASE_WRAP) returnPhase = returnPhase - PHASE_WRAP;
  if (crossPhase >= PHASE_WRAP) crossPhase = crossPhase - PHASE_WRAP;
  if (lowerPhase >= PHASE_WRAP) lowerPhase = lowerPhase - PHASE_WRAP;
  if (shelfPhase >= PHASE_WRAP) shelfPhase = shelfPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var front = travelPhase - floor(travelPhase);
  var returnFront = 1.0 - (returnPhase - floor(returnPhase));
  if (returnFront >= 1.0) returnFront = returnFront - 1.0;
  var cross = crossPhase;
  var width = 0.10 + clamp01(waveWidth) * 0.24;

  // Two slowly changing cross-section bends give each tidal face a different
  // three-dimensional pressure contour without breaking the longitudinal read.
  var upperBend = wave(ny * 0.71 + nz * 0.37 + cross) - 0.5;
  var lowerBend = wave(ny * 0.29 - nz * 0.63 - lowerPhase) - 0.5;
  var bowedFront = front + (ny - 0.5) * 0.052 + (nz - 0.5) * 0.034
                 + upperBend * 0.032;
  bowedFront = bowedFront - floor(bowedFront);
  var compressionDistance = circularDistance(nx, bowedFront);
  var compression = smoothUnit(1.0 - compressionDistance / width);
  compression = pow(compression, 0.72 + clamp01(contrast) * 2.65);

  var bowedReturn = returnFront - (ny - 0.5) * 0.043
                  + (nz - 0.5) * 0.028 + lowerBend * 0.029;
  bowedReturn = bowedReturn - floor(bowedReturn);
  var returnDistance = circularDistance(nx, bowedReturn);
  var returnCompression = smoothUnit(1.0 - returnDistance / (width * 0.90));
  returnCompression = pow(returnCompression,
                          0.84 + clamp01(contrast) * 2.25);

  // Each front leaves its own broad pressure shelf in the direction it came
  // from. Recoil therefore changes the authored exchange, not global level.
  var recoilCenter = bowedFront - (0.11 + width * 0.55);
  recoilCenter = recoilCenter - floor(recoilCenter);
  var recoilDistance = circularDistance(nx, recoilCenter);
  var recoilWave = smoothUnit(1.0 - recoilDistance / (width * 1.38));
  recoilWave = pow(recoilWave, 0.88 + clamp01(contrast) * 1.35);

  var returnRecoilCenter = bowedReturn + (0.09 + width * 0.47);
  returnRecoilCenter = returnRecoilCenter - floor(returnRecoilCenter);
  var returnRecoilDistance = circularDistance(nx, returnRecoilCenter);
  var returnRecoil = smoothUnit(1.0 - returnRecoilDistance
                                        / (width * 1.52));
  returnRecoil = pow(returnRecoil, 0.96 + clamp01(contrast) * 1.18);

  var recoilGain = clamp01(recoil);
  recoilWave = recoilWave * recoilGain;
  returnRecoil = returnRecoil * recoilGain;

  // A model-wide tidal shelf bridges the two monumental faces. Its partial
  // spatial turns keep the hull, outline, Jewelry, and Organs active without
  // dissolving the two-front identity into a generic repeated field.
  var sectionRelief = 0.74 + upperBend * 0.15 + lowerBend * 0.11;
  var tidalShelf = wave(nx * 0.43 + ny * 0.16 - nz * 0.11
                       - shelfPhase);
  tidalShelf = 0.28 + tidalShelf * 0.72;
  compression = compression * (0.91 + sectionRelief * 0.09);
  returnCompression = returnCompression * (0.82 + sectionRelief * 0.18);
  recoilWave = recoilWave * (0.88 + tidalShelf * 0.12);
  returnRecoil = returnRecoil * (0.84 + (1.0 - tidalShelf) * 0.16);

  // SafetyFloor is mechanically constrained to 10..20%. Level shapes all
  // authored energy above it; Pulse reinforces only the compression crest.
  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var levelGain = 0.18 + clamp01(level) * 1.50;
  var pulseGain = clamp01(pulse);
  var primaryCrest = max(compression, returnCompression * 0.78);
  var pressure = (compression * 0.88 + returnCompression * 0.56
                 + recoilWave * 0.25 + returnRecoil * 0.19
                 + tidalShelf * sectionRelief * 0.055) * levelGain
               + primaryCrest * pulseGain * 0.45;
  var bri = floorV + (1.0 - floorV) * pressure;
  bri = clamp01(bri);

  var paletteMix = clamp01(compression * (0.68 + pulseGain * 0.10)
                          + returnCompression * 0.47
                          + recoilWave * 0.20 + returnRecoil * 0.15
                          + tidalShelf * 0.08);

  if (fixtureType == FIX_TE_SIGN) {
    // Both TE signs are the same 74-pixel instrument. Authoring from their
    // matched local topology gives exact left/right equality while two
    // opposing tides travel across every letter instead of shrinking to a
    // world-coordinate glint on one surface.
    var signPosition = clamp01(pixelLocalIndex / 73.0);
    var signWidth = 0.15 + clamp01(waveWidth) * 0.17;
    var signBowDistance = circularDistance(signPosition, front);
    var signBow = smoothUnit(1.0 - signBowDistance / signWidth);
    signBow = pow(signBow, 0.82 + clamp01(contrast) * 1.68);
    var signReturnDistance = circularDistance(signPosition, returnFront);
    var signReturn = smoothUnit(1.0 - signReturnDistance / signWidth);
    signReturn = pow(signReturn, 0.94 + clamp01(contrast) * 1.42);
    var signUndertow = wave(signPosition * 0.82 - shelfPhase
                           + wave(signPosition * 0.37 + cross) * 0.10);
    var identityFloor = clamp01(floorV + 0.12);
    var identityPressure = (signBow * 0.54 + signReturn * 0.43
                           + signUndertow * 0.16) * levelGain
                         + max(signBow, signReturn) * pulseGain * 0.34;
    bri = identityFloor + (1.0 - identityFloor)
        * clamp01(identityPressure);
    paletteMix = clamp01(signBow * (0.69 + pulseGain * 0.08)
                        + signReturn * 0.51 + signUndertow * 0.16);
  }

  // Strict endpoint interpolation in RGB space. This concept authors no white;
  // W and A are therefore exactly matched at zero on every fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
