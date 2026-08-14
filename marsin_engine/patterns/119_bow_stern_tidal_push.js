// DRAFT — pending operator review
/*
  119_bow_stern_tidal_push.js — BOW/STERN TIDAL PUSH

  One monumental compression wall travels from bow to stern along normalized
  X. A broader, softer recoil follows behind it, making the whole ship appear
  to inhale forward when seen from far away. The heading is intentionally fixed;
  this concept has no truthful artistic use for a Direction control.

  PORTABILITY
    The primary composition uses normalized XYZ only. No view, group, section,
    controller, raw fixture metadata, or load-bearing fixture role is required.
    FIX_TE_SIGN is an optional accent: where present, Identity carries a readable
    palette floor plus a reflected echo of the same pressure wall. Models without
    TE signs compile and render the complete shared composition unchanged.

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

// Optional accent role: canonical append-only registry id. On scenes without
// TE signs no pixel matches this value; the primary pattern remains complete.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var travelPhase = 0.0;

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

  // A full pass takes about ten seconds at midpoint. Local Speed is the sole
  // rate control; its exponential trim remains smooth under live edits.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  travelPhase = travelPhase + dt * 0.10 * localMultiplier;
  if (travelPhase >= PHASE_WRAP) travelPhase = travelPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var front = travelPhase - floor(travelPhase);
  var width = 0.10 + clamp01(waveWidth) * 0.24;

  // A small Y/Z bow gives the pressure wall dimensional scale while preserving
  // its fixed +X bow-to-stern heading. Circular distance makes each pass seam-free.
  var bowedFront = front + (ny - 0.5) * 0.035 + (nz - 0.5) * 0.025;
  bowedFront = bowedFront - floor(bowedFront);
  var compressionDistance = circularDistance(nx, bowedFront);
  var compression = smoothUnit(1.0 - compressionDistance / width);
  compression = pow(compression, 0.72 + clamp01(contrast) * 2.65);

  // The recoil center trails the advancing wall, so any fixed pixel sees the
  // strong compression first and the broader, softer release second.
  var recoilCenter = bowedFront - (0.11 + width * 0.55);
  recoilCenter = recoilCenter - floor(recoilCenter);
  var recoilDistance = circularDistance(nx, recoilCenter);
  var recoilWave = smoothUnit(1.0 - recoilDistance / (width * 1.38));
  recoilWave = pow(recoilWave, 0.88 + clamp01(contrast) * 1.35);
  recoilWave = recoilWave * clamp01(recoil);

  // Subtle cross-section relief keeps the monumental wall coherent from afar;
  // it never becomes a competing noise or traveling field.
  var sectionRelief = 0.86 + wave(ny * 0.31 + nz * 0.23) * 0.14;
  compression = compression * sectionRelief;
  recoilWave = recoilWave * (0.90 + sectionRelief * 0.10);

  // SafetyFloor is mechanically constrained to 10..20%. Level shapes all
  // authored energy above it; Pulse reinforces only the compression crest.
  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var levelGain = 0.18 + clamp01(level) * 1.50;
  var pulseGain = clamp01(pulse);
  var pressure = (compression * 1.08 + recoilWave * 0.42) * levelGain
               + compression * pulseGain * 0.45;
  var bri = floorV + (1.0 - floorV) * pressure;
  bri = clamp01(bri);

  var paletteMix = clamp01(compression * (0.78 + pulseGain * 0.10)
                          + recoilWave * 0.34);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity remains readable between passes and carries a mirrored echo of
    // the same wavefront. This is still geometric XYZ authorship, not a new field.
    var reflectedFront = 1.0 - bowedFront;
    reflectedFront = reflectedFront - floor(reflectedFront);
    var reflectionDistance = circularDistance(nx, reflectedFront);
    var reflection = smoothUnit(1.0 - reflectionDistance / (width * 1.18));
    reflection = pow(reflection, 1.20 + clamp01(contrast) * 1.70) * 0.52;
    var identityFloor = floorV + 0.07;
    var identityPressure = max(compression, reflection)
                         * (0.18 + levelGain * 0.46)
                         + recoilWave * 0.16;
    bri = max(bri, identityFloor + (1.0 - identityFloor) * identityPressure);
    bri = clamp01(bri);
    paletteMix = clamp01(max(paletteMix, reflection * 0.72));
  }

  // Strict endpoint interpolation in RGB space. This concept authors no white;
  // W and A are therefore exactly matched at zero on every fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
