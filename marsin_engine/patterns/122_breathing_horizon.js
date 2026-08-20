// DRAFT — pending operator review
/*
  122_breathing_horizon.js — BREATHING HORIZON

  A huge luminous horizontal plane rises and falls through normalized Y, making
  the entire ship breathe against the skyline. The central line stays simple
  and legible at distance; a broad, symmetric upper/lower afterglow gives the
  motion scale without introducing Pattern 12's detailed organism texture.

  PORTABILITY
    The composition uses normalized XYZ only. No authored view, group, section,
    controller, raw fixture metadata, or load-bearing fixture role is required.
    FIX_TE_SIGN is an optional accent: Identity receives a readable floor and a
    mirrored horizon reflection. Models without TE signs render the complete
    shared horizon unchanged.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. Every pixel receives that palette-
    derived intensity before horizon, afterglow, level, or pulse energy.

  AUDIO_MODULATION_V1:
    sliderLevel       <- micLow  range 0.24..1.00 curve linear # whole horizon luminosity
    sliderPulse       <- micKick range 0.00..0.88 curve pow2   # central plane punch
    sliderBreathDepth <- micFlux range 0.18..0.88 curve linear # builds enlarge vertical travel
  # STATIC: localSpeed, horizonWidth, afterglow, safetyFloor, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.55;
export var horizonWidth = 0.50;
export var breathDepth = 0.50;
export var afterglow = 0.58;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.64, cp1S = 0.82, cp1V = 1.0; // deep skyline
export var cp2H = 0.10, cp2S = 0.58, cp2V = 1.0; // luminous horizon
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderHorizonWidth(v) { horizonWidth = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderAfterglow(v) { afterglow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Optional accent role: canonical append-only registry id. It is never needed
// for the shared composition and matches no pixel on scenes without TE signs.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var breathPhase = 0.0;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // A calm full breath is about nine seconds at midpoint. Local Speed is the
  // sole clock trim; the phase wraps by an integer number of turns.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  breathPhase = breathPhase + dt * 0.11 * localMultiplier;
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Sine motion has zero velocity at the top and bottom of the inhale, keeping
  // both reversals elegant. Breath Depth owns only vertical travel distance.
  var breath = sin(breathPhase * 6.2831853);
  var travel = clamp01(breathDepth) * 0.38;
  var horizonY = 0.50 + breath * travel;

  // The line stays unmistakably horizontal. A very small Z/X perspective bow
  // gives the plane depth on 3D models without becoming a wave or texture field.
  var planeY = horizonY + (nz - 0.5) * 0.025 + (nx - 0.5) * 0.008;
  var width = 0.045 + clamp01(horizonWidth) * 0.235;
  var verticalDistance = abs(ny - planeY);
  var core = smoothUnit(1.0 - verticalDistance / width);
  core = pow(core, 1.55);

  // Afterglow begins outside the luminous core and spreads equally above and
  // below. At zero it disappears completely; at one it becomes a broad skyline.
  var tailStart = width * 0.42;
  var tailDistance = max(0.0, verticalDistance - tailStart);
  var tailReach = width * (1.20 + clamp01(afterglow) * 3.80);
  var tail = smoothUnit(1.0 - tailDistance / tailReach)
           * clamp01(afterglow) * (1.0 - core) * 0.62;

  // SafetyFloor is mechanically constrained to 10..20%. Level shapes all
  // horizon energy above it; Pulse reinforces only the central plane.
  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var levelGain = 0.18 + clamp01(level) * 1.46;
  var pulseGain = clamp01(pulse);
  var horizonEnergy = (core + tail * 0.58) * levelGain
                    + core * pulseGain * 0.46;
  var bri = floorV + (1.0 - floorV) * horizonEnergy;
  bri = clamp01(bri);

  var paletteMix = clamp01(core * (0.82 + pulseGain * 0.10)
                          + tail * 0.42);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity carries the direct horizon plus a softer skyline reflection.
    // Its elevated floor preserves the letters during the top/bottom reversals.
    var reflectedY = 1.0 - planeY;
    var reflectedDistance = abs(ny - reflectedY);
    var reflection = smoothUnit(1.0 - reflectedDistance / (width * 1.25));
    reflection = pow(reflection, 1.85) * 0.58;
    var identityFloor = floorV + 0.07;
    var identityEnergy = max(core, reflection) * (0.22 + levelGain * 0.52)
                       + tail * 0.18;
    bri = max(bri, identityFloor + (1.0 - identityFloor) * identityEnergy);
    bri = clamp01(bri);
    paletteMix = clamp01(max(paletteMix, reflection * 0.78));
  }

  // Strict cp1<->cp2 RGB interpolation. This concept authors no white, so W
  // and A are byte-identical zeros on every model and fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
