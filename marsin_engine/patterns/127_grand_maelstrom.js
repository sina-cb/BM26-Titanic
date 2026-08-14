// DRAFT — pending operator review
/*
  127_grand_maelstrom.js — GRAND MAELSTROM

  One huge ocean vortex rotates around the normalized XZ center. Two or three
  broad filled arms curl radially and climb through Y, making the complete ship
  appear immersed in a single slow maelstrom from far away. This is not a tube
  helix or a set of ring shells: it is one continuous polar flow field with a
  calm eye and large area-filling arms.

  PORTABILITY
    The shared composition uses normalized XYZ only. No authored view, group,
    section, controller, raw fixture metadata, or load-bearing fixture role is
    required. FIX_TE_SIGN is an optional accent: Identity receives a readable
    floor and a strengthened vortex-eye/arm crossing. Scenes without TE signs
    compile and render the complete maelstrom unchanged.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. Every pixel receives that palette-
    derived intensity before arm, eye, level, or pulse energy.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.24..1.00 curve linear # complete vortex luminosity
    sliderPulse <- micKick range 0.00..0.88 curve pow2   # arm/eye pressure punch
    sliderDepth <- micFlux range 0.20..0.88 curve linear # builds deepen curl and vertical climb
  # STATIC: localSpeed, armWidth, armCount, safetyFloor, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.58;
export var armWidth = 0.58;
export var armCount = 0.32;
export var depth = 0.56;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.58, cp1S = 0.92, cp1V = 1.0; // abyssal water
export var cp2H = 0.40, cp2S = 0.76, cp2V = 1.0; // luminous current arms
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderArmWidth(v) { armWidth = v; }
export function sliderArmCount(v) { armCount = v; }
export function sliderDepth(v) { depth = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Optional accent role: canonical append-only registry id. It is never needed
// for the shared composition and matches no pixel on scenes without TE signs.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var vortexPhase = 0.0;

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

  // A full rotation takes about eleven seconds at midpoint. Local Speed is the
  // sole clock trim; integer-turn wrapping preserves both arm solutions.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  vortexPhase = vortexPhase + dt * 0.09 * localMultiplier;
  if (vortexPhase >= PHASE_WRAP) vortexPhase = vortexPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var radius = sqrt(dx * dx + dz * dz);
  var angle = atan2(dz, dx) / 6.2831853;
  var depthAmount = clamp01(depth);

  // Two integer angular fields keep the atan seam continuous. Arm Count blends
  // smoothly between them, avoiding the live-edit jump of rounding 2↔3 arms.
  var radialCurl2 = radius * (1.30 + depthAmount * 1.35);
  var radialCurl3 = radius * (1.65 + depthAmount * 1.55);
  var verticalClimb2 = ny * (0.34 + depthAmount * 0.92);
  var verticalClimb3 = ny * (0.48 + depthAmount * 1.12);
  var phase2 = angle * 2.0 - radialCurl2 + verticalClimb2 - vortexPhase;
  var phase3 = angle * 3.0 - radialCurl3 + verticalClimb3 - vortexPhase;
  var armTwo = wave(phase2);
  var armThree = wave(phase3);
  var countMix = smoothUnit(clamp01(armCount));
  var armField = armTwo + (armThree - armTwo) * countMix;

  // Width changes filled angular area rather than creating a tubular contour.
  // A mild radial envelope keeps the complete field broad while preserving a
  // calm eye and softer outer water.
  var width = 0.32 + clamp01(armWidth) * 0.62;
  var arm = smoothUnit((armField - (1.0 - width)) / width);
  arm = pow(arm, 0.58 + (1.0 - clamp01(armWidth)) * 0.92);
  var radialEnvelope = 0.72 + smoothUnit(1.0 - radius / 0.74) * 0.28;
  arm = arm * radialEnvelope;
  // Expand the low-frequency crest across large ship surfaces. This is a
  // filled ocean arm, so it should read as a monumental mass rather than the
  // thin luminous tubes used by the neighboring helix concepts.
  arm = smoothUnit(arm * (2.70 + clamp01(armWidth) * 2.20));

  // The calm eye is a filled center pressure, not a ring shell. Its broad edge
  // meets the passing arms to make a single readable vortex gesture.
  var eyeRadius = 0.09 + depthAmount * 0.09;
  var eye = smoothUnit(1.0 - radius / eyeRadius);
  var eyePressure = eye * (0.38 + arm * 0.62);

  // SafetyFloor is mechanically constrained to 10..20%. Level raises the
  // current arms above it; Pulse reinforces the broad arms and calm eye.
  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var levelGain = 0.18 + clamp01(level) * 1.28;
  var pulseGain = clamp01(pulse);
  var energy = arm * levelGain + eyePressure * (0.12 + levelGain * 0.24)
             + max(arm, eyePressure) * pulseGain * 0.42;
  var bri = floorV + (1.0 - floorV) * energy;
  bri = clamp01(bri);

  var paletteMix = clamp01(arm * (0.76 + pulseGain * 0.10)
                          + eyePressure * 0.22);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity holds the vortex eye and brightens the same arm crossing. Its
    // floor stays readable when neither broad arm occupies the sign geometry.
    var identityFloor = floorV + 0.07;
    var crossing = max(arm, eyePressure * 0.72);
    var identityEnergy = crossing * (0.26 + levelGain * 0.56)
                       + eye * 0.14 + crossing * pulseGain * 0.32;
    bri = max(bri, identityFloor + (1.0 - identityFloor) * identityEnergy);
    bri = clamp01(bri);
    paletteMix = clamp01(max(paletteMix, crossing * 0.88));
  }

  // Strict cp1<->cp2 RGB interpolation. This concept authors no white, so W
  // and A are byte-identical zeros on every model and fixture.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
