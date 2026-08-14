// DRAFT — pending operator review
/*
  118_grand_orbit_rings.js — "Grand Orbit Rings"

  Three enormous oblique luminous hoops orbit the normalized 3D model. Each is
  a true circular tube in a moving plane, so the look reads from a distance as
  broad geometry wrapped around the whole ship rather than as travelling bars.
  A palette-derived 10–20% safety floor keeps every pixel visible between hoops.

  The pattern is portable: normalized XYZ is the load-bearing canvas. It uses
  no authored views, section/group/controller ids, or required fixture roles.
  TE signs are an optional accent where overlapping hoops form a brighter lens.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.30..1.00 curve ease  # luminous hoop energy
    sliderPulse     <- micKick range 0.00..1.00 curve pow2  # broad intersection punch
    sliderRingWidth <- micFlux range 0.20..0.85 curve ease  # hoop tube expansion
  # STATIC: localSpeed, orbitTilt, contrast, safetyFloor, colorPalette1/2
*/

// Optional accent only; absent TE-sign roles match no pixels.
var FIX_TE_SIGN = 7;

// Export order is physical MIDI knob order.
export var localSpeed = 0.32;
export var level = 0.62;
export var ringWidth = 0.48;
export var orbitTilt = 0.58;
export var contrast = 0.62;
export var safetyFloor = 0.50; // maps strictly to 0.10..0.20 in render
export var pulse = 0.0;

export var cp1H = 0.56, cp1S = 0.92, cp1V = 1.0;
export var cp2H = 0.88, cp2S = 0.90, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderOrbitTilt(v) { orbitTilt = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

var PHASE_WRAP = 10000.0;
var orbitA = 0.0;
var orbitB = 0.0;
var orbitC = 0.0;

// Resolved ring centers and plane normals; calculated once per frame.
var c1x = 0.0, c1y = 0.0, c1z = 0.0;
var c2x = 0.0, c2y = 0.0, c2z = 0.0;
var c3x = 0.0, c3y = 0.0, c3z = 0.0;
var n1x = 0.0, n1y = 1.0, n1z = 0.0;
var n2x = 1.0, n2y = 0.0, n2z = 0.0;
var n3x = 0.0, n3y = 0.0, n3z = 1.0;

var liveWidth = 0.12;
var liveSharp = 2.0;
var liveFloor = 0.15;
var liveLevel = 0.62;
var livePulse = 0.0;

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

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var rate = 0.018 + pow(2.0, (localSpeed - 0.5) * 4.0) * 0.090;
  orbitA = orbitA + dt * rate;
  orbitB = orbitB + dt * rate * 0.73;
  orbitC = orbitC + dt * rate * 1.37;
  if (orbitA >= PHASE_WRAP) orbitA -= PHASE_WRAP;
  if (orbitB >= PHASE_WRAP) orbitB -= PHASE_WRAP;
  if (orbitC >= PHASE_WRAP) orbitC -= PHASE_WRAP;

  var a = orbitA * PI2;
  var b = orbitB * PI2;
  var c = orbitC * PI2;
  var tilt = 0.22 + clamp01(orbitTilt) * 0.96;
  var st = sin(tilt);
  var ct = cos(tilt);

  // Three differently tilted unit normals orbit on incommensurate clocks.
  n1x = st * cos(a); n1y = ct;          n1z = st * sin(a);
  n2x = ct;          n2y = st * sin(b); n2z = st * cos(b);
  n3x = st * sin(c); n3y = st * cos(c); n3z = ct;

  // Small center excursions make the hoops orbit rather than spin in place.
  c1x = sin(b) * 0.075; c1y = cos(c) * 0.045; c1z = sin(a) * 0.055;
  c2x = cos(c) * 0.060; c2y = sin(a) * 0.070; c2z = cos(b) * 0.040;
  c3x = sin(a) * 0.050; c3y = cos(b) * 0.050; c3z = sin(c) * 0.070;

  liveWidth = 0.055 + clamp01(ringWidth) * 0.170;
  liveSharp = 0.85 + clamp01(contrast) * 3.65;
  liveFloor = 0.10 + clamp01(safetyFloor) * 0.10;
  liveLevel = clamp01(level);
  livePulse = clamp01(pulse);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x) - 0.5;
  var py = clamp01(y) - 0.5;
  var pz = clamp01(z) - 0.5;

  var x1 = px - c1x, y1 = py - c1y, z1 = pz - c1z;
  var plane1 = x1 * n1x + y1 * n1y + z1 * n1z;
  var radial1 = sqrt(max(0.0, x1 * x1 + y1 * y1 + z1 * z1
                       - plane1 * plane1));
  var dist1 = hypot(radial1 - 0.43, plane1);

  var x2 = px - c2x, y2 = py - c2y, z2 = pz - c2z;
  var plane2 = x2 * n2x + y2 * n2y + z2 * n2z;
  var radial2 = sqrt(max(0.0, x2 * x2 + y2 * y2 + z2 * z2
                       - plane2 * plane2));
  var dist2 = hypot(radial2 - 0.36, plane2);

  var x3 = px - c3x, y3 = py - c3y, z3 = pz - c3z;
  var plane3 = x3 * n3x + y3 * n3y + z3 * n3z;
  var radial3 = sqrt(max(0.0, x3 * x3 + y3 * y3 + z3 * z3
                       - plane3 * plane3));
  var dist3 = hypot(radial3 - 0.51, plane3);

  var width = liveWidth * (1.0 + livePulse * 0.28);
  var ring1 = 1.0 - clamp01(dist1 / width);
  var ring2 = 1.0 - clamp01(dist2 / width);
  var ring3 = 1.0 - clamp01(dist3 / width);
  ring1 = pow(ring1 * ring1 * (3.0 - 2.0 * ring1), liveSharp);
  ring2 = pow(ring2 * ring2 * (3.0 - 2.0 * ring2), liveSharp);
  ring3 = pow(ring3 * ring3 * (3.0 - 2.0 * ring3), liveSharp);

  var intersection = clamp01(ring1 * ring2 + ring2 * ring3 + ring3 * ring1);
  var ringEnergy = clamp01(max(ring1, max(ring2, ring3))
                         + intersection * (0.42 + livePulse * 0.58));

  // Optional Identity lens: intersections refract gently along the sign path.
  var signLens = 0.0;
  if (fixtureType == FIX_TE_SIGN) {
    var signPath = pixelLocalIndex * 0.01351351351;
    signLens = wave(signPath * 0.73 + px * 0.31 - pz * 0.19
                  + orbitC * 2.0) * intersection;
    ringEnergy = clamp01(ringEnergy + intersection * 0.25
                       + signLens * 0.18);
  }

  // Opposing hoops pull decisively toward opposite palette endpoints; the
  // third remains the refracted midpoint. The safety floor spans that same
  // palette line spatially instead of introducing a third colour.
  var ringMix = clamp01(0.50 + (ring2 - ring1) * 0.62
                       + (ring3 - (ring1 + ring2) * 0.50) * 0.20);
  ringMix = ringMix * ringMix * (3.0 - 2.0 * ringMix);
  var floorMix = clamp01(((px + 0.5) * 0.65 + (pz + 0.5) * 0.35
                        - 0.18) * 1.56);
  floorMix = floorMix * floorMix * (3.0 - 2.0 * floorMix);
  var colorMix = floorMix + (ringMix - floorMix) * ringEnergy;
  if (fixtureType == FIX_TE_SIGN) {
    colorMix = clamp01(colorMix + signLens * 0.12);
  }

  var ringGain = 0.28 + liveLevel * 0.92;
  var brightness = liveFloor + ringEnergy * ringGain
                 * (0.72 + clamp01(contrast) * 0.28)
                 + intersection * livePulse * 0.30;
  brightness = clamp01(brightness);

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  // RGB-only by design; matched W/A remain exactly zero.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
