// DRAFT — pending operator review
/*
  125_eclipse_orbit.js — ECLIPSE ORBIT

  One enormous soft 3D shadow body orbits through the ship. A broad luminous
  annular rim reveals its edge, while the vessel outside carries a restrained
  mathematical gravity drift. Two incommensurate, model-wide waves move
  behind the body without competing with its silhouette: one body, one rim,
  one smooth orbit, and the quiet wake its passage leaves in the night field.

  PORTABILITY
    The shared composition uses normalized XYZ only. No view, group, section,
    controller, raw fixture metadata, or load-bearing fixture role is required.
    FIX_TE_SIGN is an optional accent: where present, Identity receives a
    readable floor and a complete miniature eclipse transit on each letter
    path. pixelLocalIndex gives both physical signs the exact same composition
    and energy. Scenes without TE signs compile and render the complete
    eclipse unchanged.

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
var fieldPhaseA = 0.0;
var fieldPhaseB = 0.37;

var liveSpeed = 0.30;
var liveLevel = 0.58;
var liveSize = 0.52;
var liveRimWidth = 0.52;
var liveDepth = 0.58;
var liveFloor = 0.50;
var livePulse = 0.00;

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

  // Continuous control followers keep live edits from snapping the body,
  // rim, depth plane, or brightness field between adjacent frames.
  var geometryFollow = clamp01(dt * 3.2);
  var levelFollow = clamp01(dt * 10.0);
  var pulseFollow = clamp01(dt * 18.0);
  liveSpeed = liveSpeed + (clamp01(localSpeed) - liveSpeed) * geometryFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * levelFollow;
  liveSize = liveSize
           + (clamp01(eclipseSize) - liveSize) * geometryFollow;
  liveRimWidth = liveRimWidth
               + (clamp01(rimWidth) - liveRimWidth) * geometryFollow;
  liveDepth = liveDepth + (clamp01(depth) - liveDepth) * geometryFollow;
  liveFloor = liveFloor
            + (clamp01(safetyFloor) - liveFloor) * levelFollow;
  livePulse = livePulse + (clamp01(pulse) - livePulse) * pulseFollow;

  // A full orbit takes about twelve seconds at midpoint. Local Speed is the
  // only clock trim; integer-turn wrapping preserves every orbit consumer.
  var localMultiplier = pow(2.0, (liveSpeed - 0.5) * 4.0);
  var orbitRate = 0.08 * localMultiplier;
  orbitPhase = orbitPhase + dt * orbitRate;
  fieldPhaseA = fieldPhaseA + dt * orbitRate * 0.83928676;
  fieldPhaseB = fieldPhaseB - dt * orbitRate * 0.51803399;
  if (orbitPhase >= PHASE_WRAP) orbitPhase = orbitPhase - PHASE_WRAP;
  if (fieldPhaseA >= PHASE_WRAP) fieldPhaseA = fieldPhaseA - PHASE_WRAP;
  if (fieldPhaseB < 0.0) fieldPhaseB = fieldPhaseB + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var theta = orbitPhase * 6.2831853;
  var depthAmount = liveDepth;

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

  var radius = 0.13 + liveSize * 0.35;
  var edgeSoftness = 0.055 + radius * 0.16;

  // Inside is the soft shadow body; outside remains a restrained vessel wash.
  var outside = smoothUnit((distance - radius + edgeSoftness)
                         / (edgeSoftness * 2.0));

  // A single broad annulus reveals the eclipse edge. Rim Width changes only
  // its thickness; it never changes orbit speed or shadow size.
  var rimSpan = 0.018 + liveRimWidth * 0.145;
  var rimDistance = abs(distance - radius);
  var rim = smoothUnit(1.0 - rimDistance / rimSpan);
  rim = pow(rim, 1.45);

  // SafetyFloor is mechanically constrained to 10..20%. Level raises the
  // outside vessel and annulus above it; Pulse reinforces only the rim.
  var floorV = 0.10 + liveFloor * 0.10;
  var levelGain = liveLevel;
  var pulseGain = livePulse;

  // The night field takes a slow, non-repeating mathematical walk across all
  // three normalized axes. Its low amplitude lets the eclipse stay dominant;
  // unlike the former uniform wash, every region now evolves between passes.
  var fieldA = wave(nx * 0.78615138 + ny * 0.46352549
                  - nz * 0.61803399 - fieldPhaseA);
  var fieldB = wave(nx * 0.41421356 - ny * 0.73205081
                  + nz * 0.53112887 + fieldPhaseB
                  + sin((nx * 0.57735027 + ny * 0.38196601
                       + fieldPhaseA * 0.27182818) * 6.2831853) * 0.055);
  var gravityWalk = smoothUnit(fieldA * 0.58 + fieldB * 0.42);
  var fieldGain = 0.87 + gravityWalk * 0.27;
  var vesselEnergy = (0.10 + levelGain * 0.44)
                   * (0.20 + outside * 0.80) * fieldGain;
  var rimEnergy = rim * (0.18 + levelGain * 0.82 + pulseGain * 0.48);
  var bri = floorV + (1.0 - floorV) * (vesselEnergy + rimEnergy);
  bri = clamp01(bri);

  var paletteMix = clamp01(outside * (0.07 + gravityWalk * 0.10)
                          + rim * (0.78 + pulseGain * 0.12));

  if (fixtureType == FIX_TE_SIGN) {
    // Each physical letter path receives a miniature eclipse: a soft shadow
    // followed by an annular rim and the same gravitational drift as the ship.
    // Both signs have paired 40/34-pixel paths, so depending only on
    // pixelLocalIndex makes their 74 output pixels byte-identical by proof.
    var signPath = pixelLocalIndex * 0.025;
    var signCenter = orbitPhase * 0.61803399;
    signCenter = signCenter - floor(signCenter);
    var signDistance = abs(signPath - signCenter);
    signDistance = min(signDistance, 1.0 - signDistance);
    var signRadius = 0.105 + liveSize * 0.115;
    var signSoftness = 0.045 + signRadius * 0.18;
    var signOutside = smoothUnit((signDistance - signRadius + signSoftness)
                               / (signSoftness * 2.0));
    var signRimSpan = 0.030 + liveRimWidth * 0.085;
    var signRimDistance = abs(signDistance - signRadius);
    var signRim = smoothUnit(1.0 - signRimDistance / signRimSpan);
    signRim = pow(signRim, 1.35);
    var signWalk = wave(signPath * 1.61803399 - fieldPhaseA * 0.73
                      + sin((signPath * 0.78615138 + fieldPhaseB * 0.31)
                          * 6.2831853) * 0.065);
    var identityFloor = floorV + 0.08;
    var identityField = (0.14 + levelGain * 0.25)
                      * (0.30 + signOutside * 0.70)
                      * (0.89 + signWalk * 0.18);
    var identityRim = signRim
                    * (0.20 + levelGain * 0.72 + pulseGain * 0.36);
    bri = identityFloor + (1.0 - identityFloor)
        * clamp01(identityField + identityRim);
    paletteMix = clamp01(signOutside * (0.09 + signWalk * 0.10)
                        + signRim * (0.80 + pulseGain * 0.12));
  }

  // Strict cp1<->cp2 RGB interpolation. This concept authors no white, so W
  // and A are byte-identical zeros on every model and fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
