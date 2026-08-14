// DRAFT — pending operator review
/*
  120_crossing_beacons.js — two counter-rotating mirrored beacon fans.

  Each beacon is an antipodal XZ axis, so every source throws two opposed rays.
  The axes rotate against one another and repeatedly open into a grand X around
  the ship. This is not 58's single lighthouse wedge or mirrored phase: two
  independently clocked fans, their crossing angle, and their trailing light
  remain visible at once.

  A palette-derived safety floor is always present. sliderSafetyFloor maps only
  to 0.10..0.20 brightness, so no control setting can erase the installation.
  All colour is a strict cp1<->cp2 RGB interpolation; native emitters stay off.
  Geometry uses normalized XYZ only. The optional TE-sign branch refracts the
  same two fans into a smooth Identity prism without relying on authored views.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — counter-rotation rate; 0 still creeps.
    level       — brightness above the safety floor.
    beamWidth   — angular width of both mirrored fan axes.
    crossing    — smoothly opens/closes the angle between the two fan systems.
    afterglow   — length and energy of the two directional trails.
    safetyFloor — hard palette-derived floor, constrained to 10%..20%.
    flash       — immediate brightness punch on both fan systems.

  AUDIO_MODULATION_V1:
    sliderLevel    <- micLow  range 0.25..1.00 curve linear # whole beacon energy
    sliderFlash    <- micKick range 0.00..1.00 curve pow2   # dual-fan punch
    sliderCrossing <- micFlux range 0.25..0.85 curve ease   # opens the grand X
  # STATIC: localSpeed, beamWidth, afterglow, safetyFloor, palettes
*/

// Optional accent role at its append-only canonical registry id. Models with
// no TE signs simply have no pixels in this branch.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.35;
export var level = 0.65;
export var beamWidth = 0.38;
export var crossing = 0.50;
export var afterglow = 0.45;
export var safetyFloor = 0.50;
export var flash = 0.00;

export var cp1H = 0.08, cp1S = 0.88, cp1V = 1.0;
export var cp2H = 0.62, cp2S = 0.92, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderCrossing(v) { crossing = v; }
export function sliderAfterglow(v) { afterglow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderFlash(v) { flash = v; }

var PHASE_WRAP = 10000.0;
var phaseA = 0.125;
var phaseB = 0.375;

var liveSpeed = 0.35;
var liveLevel = 0.65;
var liveWidth = 0.38;
var liveCrossing = 0.50;
var liveAfterglow = 0.45;
var liveFloor = 0.50;
var liveFlash = 0.00;

var resolvedHalfWidth = 0.07;
var resolvedTrailLag = 0.06;
var resolvedFloor = 0.15;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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

function axisDistance(angle, axis) {
  var d = angle - axis;
  d = d - floor(d + 0.5);
  d = abs(d);
  if (d > 0.25) d = 0.5 - d;
  return d;
}

function fanProfile(distance, halfWidth) {
  var q = clamp01(1.0 - distance / (halfWidth + 0.0001));
  return q * q * (3.0 - 2.0 * q);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var geometryFollow = clamp01(dt * 3.2);
  var levelFollow = clamp01(dt * 10.0);
  var flashFollow = clamp01(dt * 18.0);
  liveSpeed = liveSpeed + (clamp01(localSpeed) - liveSpeed) * geometryFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * levelFollow;
  liveWidth = liveWidth + (clamp01(beamWidth) - liveWidth) * geometryFollow;
  liveCrossing = liveCrossing
               + (clamp01(crossing) - liveCrossing) * geometryFollow;
  liveAfterglow = liveAfterglow
                + (clamp01(afterglow) - liveAfterglow) * geometryFollow;
  liveFloor = liveFloor
            + (clamp01(safetyFloor) - liveFloor) * levelFollow;
  liveFlash = liveFlash + (clamp01(flash) - liveFlash) * flashFollow;

  var rate = 0.018 + 0.22 * pow(2.0, (liveSpeed - 0.5) * 4.0);
  phaseA = phaseA + dt * rate;
  phaseB = phaseB - dt * rate * 0.78615;
  if (phaseA >= PHASE_WRAP) phaseA = phaseA - PHASE_WRAP;
  if (phaseB < 0.0) phaseB = phaseB + PHASE_WRAP;

  resolvedHalfWidth = 0.025 + liveWidth * 0.135;
  resolvedTrailLag = 0.018 + liveAfterglow * 0.115;
  resolvedFloor = 0.10 + liveFloor * 0.10;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var angle = atan2(dz, dx) / PI2;
  angle = angle - floor(angle);

  // Crossing shifts the second fan by +/-22.5 degrees. The smoothed control
  // opens and closes the X without ever reversing or teleporting either clock.
  var axisA = phaseA;
  var axisB = phaseB + (liveCrossing - 0.5) * 0.125;
  var fanA = fanProfile(axisDistance(angle, axisA), resolvedHalfWidth);
  var fanB = fanProfile(axisDistance(angle, axisB), resolvedHalfWidth);

  // Each afterglow trails its own direction of travel. Both use the same live
  // length control, but their offsets point opposite ways by construction.
  var tailA = fanProfile(axisDistance(angle, axisA - resolvedTrailLag),
                         resolvedHalfWidth * (1.15 + liveAfterglow * 0.45));
  var tailB = fanProfile(axisDistance(angle, axisB + resolvedTrailLag),
                         resolvedHalfWidth * (1.15 + liveAfterglow * 0.45));
  tailA = tailA * liveAfterglow;
  tailB = tailB * liveAfterglow;

  var primaryFan = max(fanA, fanB);
  var overlap = min(fanA, fanB);
  var trailEnergy = max(tailA, tailB);
  var beamSignal = primaryFan * 0.82 + trailEnergy * 0.42
                 + overlap * (0.22 + liveCrossing * 0.58);
  var beamGain = 0.16 + liveLevel * 1.12;
  var flashPunch = liveFlash * (primaryFan * 0.72 + overlap * 0.48);
  var authored = clamp01(beamSignal * beamGain + flashPunch);
  var bri = resolvedFloor + (1.0 - resolvedFloor) * authored;

  // The safety bed is also palette-derived. Above it, fan A pulls toward cp1,
  // fan B toward cp2, and their crossing forms a genuine mixed-light centre.
  var bedMix = clamp01(0.50 + dx * 0.34 + dz * 0.24 + (ny - 0.5) * 0.16);
  var energyA = fanA + tailA * 0.62;
  var energyB = fanB + tailB * 0.62;
  var mixValue = (energyB + bedMix * 0.20)
               / (energyA + energyB + 0.20);
  mixValue = clamp01(mixValue);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity prism: when both counter-fans meet, a folded XYZ refraction
    // articulates the letters. It is continuous, palette-only, and subordinate
    // to the two large fan axes so the sign still reads from far away.
    var signFold = wave(dx * 1.73 + (ny - 0.5) * 2.39 - dz * 1.41
                      + phaseA - phaseB);
    var signPrism = sqrt(max(0.0, fanA * fanB))
                  + (fanA + fanB) * signFold * 0.22;
    signPrism = clamp01(signPrism);
    var signKeep = resolvedFloor + 0.06;
    var signBri = signKeep + (1.0 - signKeep)
                * clamp01(authored * 0.82 + signPrism * 0.46);
    if (signBri > bri) bri = signBri;
    mixValue = clamp01(0.50 + (fanB - fanA) * 0.42
                     + signFold * 0.12 + (ny - 0.5) * 0.16);
  }

  var r = (pr1 + (pr2 - pr1) * mixValue) * bri;
  var g = (pg1 + (pg2 - pg1) * mixValue) * bri;
  var b = (pb1 + (pb2 - pb1) * mixValue) * bri;

  // No native white or amber is required; zero == zero satisfies lane parity.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
