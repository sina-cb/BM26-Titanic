// DRAFT — pending operator review
/*
  125_eclipse_orbit.js — ECLIPSE ORBIT

  One enormous soft 3D shadow body orbits through the ship. A broad luminous
  annular rim reveals its edge, while the vessel outside remains a restrained
  palette wash. The silhouette is intentionally simple and readable from far
  away: one body, one rim, one smooth orbit.

  PORTABILITY
    The shared composition uses normalized XYZ only. No view, group, section,
    controller, raw fixture metadata, or load-bearing fixture role is required.
    FIX_TE_SIGN is an optional accent: where present, Identity receives a
    readable floor and a strengthened moving annular rim. Scenes without TE
    signs compile and render the complete eclipse unchanged.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. The eclipse can reduce authored
    energy to that palette-derived floor, but it can never black the vessel.

  AUDIO_MODULATION_V1:
    sliderLevel       <- micLow  range 0.24..1.00 curve linear # vessel and rim luminosity
    sliderPulse       <- micKick range 0.00..0.88 curve pow2   # annular rim punch
    sliderEclipseSize <- micFlux range 0.26..0.86 curve linear # builds enlarge the shadow body
  # STATIC: localSpeed, rimWidth, depth, safetyFloor, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.58;
export var eclipseSize = 0.52;
export var rimWidth = 0.52;
export var depth = 0.58;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.67, cp1S = 0.86, cp1V = 1.0; // eclipse / night field
export var cp2H = 0.11, cp2S = 0.52, cp2V = 1.0; // luminous annular rim
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderEclipseSize(v) { eclipseSize = v; }
export function sliderRimWidth(v) { rimWidth = v; }
export function sliderDepth(v) { depth = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Optional accent role: canonical append-only registry id. It is never needed
// for the shared composition and matches no pixel on scenes without TE signs.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var orbitPhase = 0.0;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // A full orbit takes about twelve seconds at midpoint. Local Speed is the
  // only clock trim; integer-turn wrapping preserves every orbit consumer.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  orbitPhase = orbitPhase + dt * 0.08 * localMultiplier;
  if (orbitPhase >= PHASE_WRAP) orbitPhase = orbitPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var theta = orbitPhase * 6.2831853;
  var depthAmount = clamp01(depth);

  // The center follows one smooth, legible orbit. Z uses the second harmonic
  // to carry the body through the ship rather than sliding across a flat plane.
  var centerX = 0.50 + cos(theta) * 0.43;
  var centerY = 0.50 + sin(theta) * 0.30;
  var centerZ = 0.50 + sin(theta * 2.0 + 0.73)
              * (0.06 + depthAmount * 0.36);

  // Depth controls the body's true 3D reach as well as its orbital Z travel.
  var dx = nx - centerX;
  var dy = ny - centerY;
  var dzScale = 0.55 + depthAmount * 0.75;
  var dz = (nz - centerZ) / dzScale;
  var distance = sqrt(dx * dx + dy * dy + dz * dz);

  var radius = 0.13 + clamp01(eclipseSize) * 0.35;
  var edgeSoftness = 0.055 + radius * 0.16;

  // Inside is the soft shadow body; outside remains a restrained vessel wash.
  var outside = smoothUnit((distance - radius + edgeSoftness)
                         / (edgeSoftness * 2.0));

  // A single broad annulus reveals the eclipse edge. Rim Width changes only
  // its thickness; it never changes orbit speed or shadow size.
  var rimSpan = 0.018 + clamp01(rimWidth) * 0.145;
  var rimDistance = abs(distance - radius);
  var rim = smoothUnit(1.0 - rimDistance / rimSpan);
  rim = pow(rim, 1.45);

  // SafetyFloor is mechanically constrained to 10..20%. Level raises the
  // outside vessel and annulus above it; Pulse reinforces only the rim.
  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var levelGain = clamp01(level);
  var pulseGain = clamp01(pulse);
  var vesselEnergy = (0.10 + levelGain * 0.44)
                   * (0.20 + outside * 0.80);
  var rimEnergy = rim * (0.18 + levelGain * 0.82 + pulseGain * 0.48);
  var bri = floorV + (1.0 - floorV) * (vesselEnergy + rimEnergy);
  bri = clamp01(bri);

  var paletteMix = clamp01(outside * 0.12
                          + rim * (0.78 + pulseGain * 0.12));

  if (fixtureType == FIX_TE_SIGN) {
    // Identity receives the same moving annulus with stronger continuity and a
    // protected readable floor. No second orbit or unrelated texture is added.
    var identityFloor = floorV + 0.07;
    var identityRim = smoothUnit(1.0 - rimDistance / (rimSpan * 1.25));
    identityRim = pow(identityRim, 1.35);
    var identityEnergy = (0.10 + levelGain * 0.22)
                       + identityRim * (0.24 + levelGain * 0.58
                                      + pulseGain * 0.36);
    bri = max(bri, identityFloor + (1.0 - identityFloor) * identityEnergy);
    bri = clamp01(bri);
    paletteMix = clamp01(max(paletteMix, identityRim * 0.88));
  }

  // Strict cp1<->cp2 RGB interpolation. This concept authors no white, so W
  // and A are byte-identical zeros on every model and fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
