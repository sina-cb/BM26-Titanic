/*
  116_tower_cathedral_organ

  The 8 tower bars behave like cathedral organ pipes.
  Vertical chord bands swell at different heights, towers answer each other
  in harmonic groupings, and vintage fixtures pulse like warm chapel lamps.

  Tower-only:
  - TowerBars: index 0..143, 8 towers x 18 pixels.
  - VintageOnly: soft downbeat / lantern response.
  - Redwoods: explicitly black.

  Controls:
  - localSpeed: speed trim.
  - organGlow: quiet architecture -> bright organ swell.
  - chordSpread: narrow notes -> wide stacked chords.
  - shimmer: clean breath -> complex harmonic sparkle.
  - blackoutDepth: soft ambience -> dramatic cathedral shadows.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var TOWER_BAR_HI = 143;
var REDWOOD_START = 204;
var REDWOOD_END = 221;

var TOWER_COUNT = 8;
var PIXELS_PER_TOWER = 18;

export var localSpeed = 0.5;
export var organGlow = 0.74;
export var chordSpread = 0.48;
export var shimmer = 0.36;
export var blackoutDepth = 0.52;

export var cp1H = 0.66, cp1S = 1.0, cp1V = 0.92;
export var cp2H = 0.10, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderOrganGlow(v) { organGlow = v; }
export function sliderChordSpread(v) { chordSpread = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

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

function wrap01(v) {
  v = v % 1.0;
  if (v < 0.0) v += 1.0;
  return v;
}

function smoothstep01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function softPulse(d, w) {
  var n = clamp01(1.0 - d / w);
  return smoothstep01(n);
}

function hash01(v) {
  var h = sin(v * 12.9898) * 43758.5453;
  return h - floor(h);
}

function tri01(v) {
  v = wrap01(v);
  if (v < 0.5) return v * 2.0;
  return 2.0 - v * 2.0;
}

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;

var tChord = 0.0;
var tRise = 0.0;
var tBell = 0.0;
var tShadow = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1000.0) * localMult;

  tChord  = wrap01(tChord  + dt * (0.040 + organGlow * 0.105));
  tRise   = wrap01(tRise   + dt * (0.055 + chordSpread * 0.160));
  tBell   = wrap01(tBell   + dt * (0.090 + organGlow * 0.110));
  tShadow = wrap01(tShadow + dt * (0.026 + blackoutDepth * 0.120));
  tColor  = wrap01(tColor  + dt * (0.014 + organGlow * 0.045));
  tSpark  = wrap01(tSpark  + dt * (0.28 + shimmer * 1.80));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRedwoodByMask = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isRedwoodByIndex = index >= REDWOOD_START && index <= REDWOOD_END;
  var isRedwood = isRedwoodByMask || isRedwoodByIndex;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;
  var colorMix = 0.0;
  var brightness = 0.0;

  if (isRedwood) {
    // Tower-only pattern: keep redwoods dark.
  } else if (index <= TOWER_BAR_HI) {
    var towerId = floor(index / PIXELS_PER_TOWER);
    var barT = (index % PIXELS_PER_TOWER) / (PIXELS_PER_TOWER - 1.0);
    var towerPos = towerId / TOWER_COUNT;

    // Harmonic chord gates: towers join/leave the chord in waves.
    var chordGateA = pow(wave(tChord + towerId * 0.131), 1.70);
    var chordGateB = pow(wave(tChord * SQRT2 + towerId * GOLDEN), 2.60) * (0.35 + shimmer * 0.45);
    var chordGate = clamp01(0.52 * chordGateA + 0.48 * chordGateB);

    // Three note centers: root / fifth / octave-like vertical bands.
    var noteRoot = tri01(tRise + towerId * 0.043);
    var noteFifth = tri01(tRise * 0.73 + 0.333 + towerId * 0.097);
    var noteOctave = tri01(tRise * 1.31 + 0.666 + towerId * 0.061);

    var width = 0.050 + chordSpread * 0.210;
    var rootBand = softPulse(abs(barT - noteRoot), width);
    var fifthBand = softPulse(abs(barT - noteFifth), width * 0.86 + 0.018) * 0.76;
    var octaveBand = softPulse(abs(barT - noteOctave), width * 0.72 + 0.014) * 0.56;

    // A slow cathedral swell from base to top.
    var swell = pow(wave(tBell + barT * 0.33 + towerId * 0.057), 1.70);
    var harmonicTexture = pow(wave(barT * 3.0 - tShadow + towerId * 0.17), 3.0) * shimmer;

    var chordEnergy = clamp01((rootBand + fifthBand + octaveBand) * (0.45 + chordGate * 0.75));
    var shadowArch = pow(wave(barT * 2.0 + tShadow * SQRT2 + towerId * 0.223), 2.4 + blackoutDepth * 4.2);

    brightness = (1.0 - blackoutDepth) * (0.020 + organGlow * 0.050)
               + chordEnergy * (0.25 + organGlow * 0.70)
               + swell * organGlow * 0.120
               + harmonicTexture * organGlow * 0.080;

    brightness = brightness * (1.0 - shadowArch * blackoutDepth * (0.30 + 0.35 * (1.0 - chordEnergy)));
    brightness = clamp01(brightness);

    var heightMix = barT;
    var chordMix = clamp01(rootBand * 0.20 + fifthBand * 0.55 + octaveBand * 0.82);
    var auraMix = wave(tColor + towerPos * 0.47 + chordGate * 0.23);
    colorMix = clamp01(0.34 * heightMix + 0.38 * chordMix + 0.28 * auraMix);
    colorMix = clamp01(colorMix - shadowArch * blackoutDepth * 0.08 + chordEnergy * 0.08);

    var sparkSeed = hash01(index * 21.31 + floor(tSpark * 7.0) + towerId * 5.1);
    var glint = 0.0;
    if (sparkSeed > 0.965) {
      glint = (sparkSeed - 0.965) * 28.57 * shimmer * chordEnergy;
    }

    brightness = clamp01(brightness + glint * 0.10);
    colorMix = clamp01(colorMix + glint * 0.08);

    w = clamp01(glint * 0.050 + octaveBand * chordGate * shimmer * 0.060);
    a = clamp01(chordEnergy * organGlow * 0.025);

  } else if (isVintage) {
    // Warm downbeat lamps.
    var bell = pow(wave(tBell + x * 0.23 + z * 0.17), 1.80);
    var downbeat = pow(wave(tChord * 1.15 + index * 0.019), 4.0);
    brightness = 0.025 + organGlow * (bell * 0.095 + downbeat * 0.110);
    brightness = brightness * (1.0 - blackoutDepth * 0.18);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.55 + 0.26 * bell + 0.19 * downbeat);
    a = clamp01(organGlow * (bell * 0.035 + downbeat * 0.050));

  } else {
    var ambient = pow(wave(tBell + x * 0.19 + z * 0.23), 1.90);
    brightness = (1.0 - blackoutDepth) * 0.018 + organGlow * ambient * 0.055;
    brightness = clamp01(brightness);
    colorMix = clamp01(0.45 + 0.45 * wave(tColor + x * 0.31 + z * 0.13));
  }

  r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}