/*
  21_pelagic_manta_rays.js — coherent manta silhouettes gliding through dark
  pelagic water, with reef color, warm foam flecks, and a UV undertow.

  IDENTITY
    Two broad manta rays cross the rig at independent rates. Their wing bodies
    remain coherent silhouettes rather than a whole-frame wash. Dark rolling
    water supplies negative space; fine wing texture and beat foam reveal the
    rays without erasing the surrounding abyss.

  CONTROL OWNERSHIP (physical MIDI order preserved)
    localSpeed — the only control that changes travel rate.
    travel     — a fixed calm forward heading; Local Speed owns rate.
    level      — overall visible-water and manta brightness.
    kick       — a short body/foam ocean punch.
    radius     — wing span and reach only. It does not affect travel speed,
                 center travel distance, or the fixed body exponent.
    detail     — fine wing-ripple contrast.
    whiteFoam  — sparse warm Jewelry foam strength.
    uvUndertow — violet strength on UV-capable bars and pars only.

  PORTABLE FIXTURE STAGING
    FIX_BAR_18     — manta body over UV-capable dark water.
    FIX_RAW_LED    — long wing-edge traces.
    FIX_VINTAGE_6 — sparse warm foam flecks with byte-matched W+A.
    FIX_PAR        — restrained warm ocean pulses with a small UV undertow.
    FIX_TE_SIGN    — calm, continuously readable identity bed.
    No authored view, group, controller, fixture id, or section id is used.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.28..1.00 curve linear # bass reveals the rays
    sliderKick   <- micKick range 0.00..1.00 curve pow2   # beat foam/ocean punch
    sliderRadius <- micFlux range 0.32..0.92 curve linear # builds widen coherent wings
    sliderDetail <- micHigh range 0.25..0.95 curve linear # highs articulate wing texture
  Static params: localSpeed, whiteFoam, uvUndertow, colorPalette1/2.
*/

// Canonical append-only optional fixture role; absent roles match no pixels.
var FIX_RAW_LED = 1;

export var localSpeed = 0.5;
export var level = 0.7;
export var kick = 0.0;
export var radius = 0.5;
export var detail = 0.5;
export var whiteFoam = 0.55;
export var uvUndertow = 0.3;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.44, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

// Canonical append-only optional role id. Self-declaration keeps the same source
// compilable on models without TE signs; no pixel there has fixtureType id 7.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var MAX_RATE = 0.16;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// Fixed exponent: Radius is prohibited from changing body hardness. Only reach
// and half-height passed by the caller grow, so the whole wing expands coherently.
function mantaShape(nx, ny, cx, cy, reach, halfHeight, flap) {
  var dx = nx - cx;
  if (dx > 0.5) dx = dx - 1.0;
  if (dx < -0.5) dx = dx + 1.0;
  var wingX = 1.0 - abs(dx) / reach;
  if (wingX <= 0.0) return 0.0;
  var arch = pow(wingX, 0.58);
  var wingLine = cy + sin((dx / reach) * PI) * flap * arch;
  var thickness = 0.012 + halfHeight * arch;
  var body = 1.0 - abs(ny - wingLine) / thickness;
  if (body <= 0.0) return 0.0;
  return pow(body * arch, 2.15);
}

var swimA = 0.0;
var swimB = 0.43;
var colorPhase = 0.0;
var flutterPhase = 0.0;
var levelGain = 1.0;
var travelSign = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  travelSign = 1.0;

  // Radius is deliberately absent from every clock equation.
  swimA = swimA + dt * MAX_RATE * rate * travelSign;
  swimB = swimB + dt * MAX_RATE * 0.47 * rate * travelSign;
  colorPhase = colorPhase + dt * 0.026 * rate;
  flutterPhase = flutterPhase + dt * 0.083 * rate;

  if (swimA >= PHASE_WRAP) swimA = swimA - PHASE_WRAP;
  if (swimA < 0.0) swimA = swimA + PHASE_WRAP;
  if (swimB >= PHASE_WRAP) swimB = swimB - PHASE_WRAP;
  if (swimB < 0.0) swimB = swimB + PHASE_WRAP;
  if (colorPhase >= PHASE_WRAP) colorPhase = colorPhase - PHASE_WRAP;
  if (flutterPhase >= PHASE_WRAP) flutterPhase = flutterPhase - PHASE_WRAP;

  // Keep the abyss dark but readable. At the Ambient tune this leaves enough
  // pelagic water to describe the complete ship between manta crossings.
  levelGain = 0.16 + level * level * 1.55;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var centerAX = swimA - floor(swimA);
  var centerBX = swimB - floor(swimB);
  var centerAY = 0.54 + sin(swimB * PI2) * 0.12;
  var centerBY = 0.30 + sin(swimA * PI2 + 2.1) * 0.075;

  // Radius changes only coherent wing reach and height. Center paths, rates,
  // flap amplitude, and the fixed body exponent remain unchanged.
  var reach = 0.085 + radius * 0.30;
  var halfHeight = 0.020 + radius * 0.064;
  var flapA = sin(flutterPhase * PI2) * 0.022;
  var flapB = sin(flutterPhase * PI2 + 2.4) * 0.017;
  var bodyA = mantaShape(nx, ny, centerAX, centerAY, reach, halfHeight, flapA);
  var bodyB = mantaShape(nx, ny, centerBX, centerBY, reach * 0.72,
                         halfHeight * 0.76, flapB) * 0.38;
  var body = bodyA;
  if (bodyB > body) body = bodyB;

  var wingRipple = wave(nx * 5.1 + ny * 2.7 + flutterPhase
                      + sin(swimB * PI2 + nz * 2.3) * 0.23);
  wingRipple = pow(wingRipple, 3.0);

  // A faint wake stays behind the dominant manta. Its asymmetry makes the
  // fixed forward travel keeps the wake asymmetric and easy to read.
  var wakeDx = nx - centerAX;
  if (wakeDx > 0.5) wakeDx = wakeDx - 1.0;
  if (wakeDx < -0.5) wakeDx = wakeDx + 1.0;
  var trail = -wakeDx * travelSign;
  var wake = 0.0;
  if (trail > 0.0 && trail < reach * 1.45) {
    var wakeLength = 1.0 - trail / (reach * 1.45);
    var wakeHeight = 1.0 - abs(ny - centerAY) / (halfHeight * 1.7 + 0.015);
    if (wakeHeight > 0.0) wake = wakeLength * wakeHeight * wakeHeight;
  }

  // Deep water: narrow crests over a readable floor preserve negative space
  // without letting most of the Titanic disappear at the Ambient tune.
  var rolling = wave(ny * 1.8 - nx * 0.62 + colorPhase * 0.74);
  rolling = pow(rolling, 4.2);
  var water = 0.095 + rolling * 0.125;
  var detailRidge = pow(wave(nx * 8.3 + ny * 4.1 + flutterPhase * 0.73), 9.0)
                  * body * detail * 0.34;
  var rayLight = body * (0.43 + wingRipple * (0.07 + detail * 0.72))
               + detailRidge + wake * 0.075;
  var kickPunch = kick * (body * 0.48 + rolling * 0.09);
  var ocean = clamp01((water + rayLight + kickPunch) * levelGain);

  var colorMix = clamp01(nx + sin(colorPhase * PI2 + ny * 1.7) * 0.13);
  colorMix = colorMix * colorMix * (3.0 - 2.0 * colorMix);
  colorMix = clamp01(colorMix * (1.0 - body * 0.34) + body * 0.48);
  var r = (pr1 + (pr2 - pr1) * colorMix) * ocean;
  var g = (pg1 + (pg2 - pg1) * colorMix) * ocean;
  var b = (pb1 + (pb2 - pb1) * colorMix) * ocean;

  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;
  var white = 0.0;
  var uv = 0.0;

  if (isBar) {
    // Bars own the readable body and UV-capable pelagic water.
    r = r * 1.04;
    g = g * 1.04;
    b = b * 1.08;
    uv = clamp01((rolling * 0.11 + body * 0.34 + kick * body * 0.20)
               * uvUndertow * (0.42 + level * 0.76));
  } else if (isRaw) {
    // Raw strands become long, dark wing traces rather than a uniform wash.
    var trace = pow(body, 0.48) * (0.18 + wingRipple * (0.10 + detail * 0.92))
              + detailRidge * 0.72;
    var traceV = clamp01((0.025 + water * 0.75 + trace
                        + kick * body * 0.18) * levelGain);
    r = (pr1 + (pr2 - pr1) * colorMix) * traceV;
    g = (pg1 + (pg2 - pg1) * colorMix) * traceV;
    b = (pb1 + (pb2 - pb1) * colorMix) * traceV;
  } else if (isVintage) {
    // Jewelry only catches sparse warm foam flecks. No saturated ocean blue and
    // no UV reaches these fixtures.
    var fleck = wave(pixelLocalIndex * 0.371 + nx * 2.7
                   + flutterPhase * 0.63 + body * 0.41);
    fleck = pow(fleck, 15.0) * (body * 0.72 + rolling * 0.28);
    var warm = clamp01((0.040 + water * 0.18 + body * 0.16 + fleck * 0.68
                      + kick * fleck * 0.72) * levelGain);
    r = warm * 1.00;
    g = warm * 0.43;
    b = warm * 0.055;
    white = clamp01(fleck * whiteFoam * (0.22 + level * 0.92)
                  * (1.0 + kick * 1.55));
  } else if (isPar) {
    // Pars breathe as restrained warm ocean punctuation. Their violet lane is
    // physically capable, so a small undertow may sit below the warm pulse.
    var parPulse = pow(wave(colorPhase * 0.34 + nx * 0.31 + ny * 0.47), 5.0);
    var parV = clamp01((0.060 + parPulse * 0.052 + body * 0.12
                      + kick * 0.07) * levelGain);
    r = parV;
    g = parV * 0.36;
    b = parV * 0.075;
    uv = clamp01((rolling * 0.045 + body * 0.10)
               * uvUndertow * (0.35 + level * 0.50));
  } else if (isSign) {
    // Identity gets two coherent sign-scaled mantas rather than a generic
    // breathing field. Their centers sit on the Titanic letter band; the
    // second ray crosses in the opposite direction on its independent clock.
    var signReach = 0.11 + radius * 0.28;
    var signHalfHeight = 0.022 + radius * 0.050;
    var signCenterAY = 0.575 + sin(swimB * PI2) * 0.034;
    var signCenterBY = 0.620 + sin(swimA * PI2 + 2.1) * 0.028;
    var signCenterBX = 1.0 - centerBX;
    var signRayA = mantaShape(nx, ny, centerAX, signCenterAY, signReach,
                              signHalfHeight, flapA * 0.78);
    var signRayB = mantaShape(nx, ny, signCenterBX, signCenterBY,
                              signReach * 0.82, signHalfHeight * 0.82,
                              -flapB * 0.86);

    // Each wake remains behind its own direction of travel. The asymmetric
    // tapered trails make the silhouettes read as swimming forms, not blobs.
    var signDxA = nx - centerAX;
    if (signDxA > 0.5) signDxA = signDxA - 1.0;
    if (signDxA < -0.5) signDxA = signDxA + 1.0;
    var signTrailA = -signDxA;
    var signWakeA = 0.0;
    if (signTrailA > 0.0 && signTrailA < signReach * 1.55) {
      var signWakeLengthA = 1.0 - signTrailA / (signReach * 1.55);
      var signWakeHeightA = 1.0 - abs(ny - signCenterAY)
        / (signHalfHeight * 1.65 + 0.012);
      if (signWakeHeightA > 0.0) {
        signWakeA = signWakeLengthA * signWakeHeightA * signWakeHeightA;
      }
    }

    var signDxB = nx - signCenterBX;
    if (signDxB > 0.5) signDxB = signDxB - 1.0;
    if (signDxB < -0.5) signDxB = signDxB + 1.0;
    var signTrailB = signDxB;
    var signWakeB = 0.0;
    if (signTrailB > 0.0 && signTrailB < signReach * 1.28) {
      var signWakeLengthB = 1.0 - signTrailB / (signReach * 1.28);
      var signWakeHeightB = 1.0 - abs(ny - signCenterBY)
        / (signHalfHeight * 1.45 + 0.012);
      if (signWakeHeightB > 0.0) {
        signWakeB = signWakeLengthB * signWakeHeightB * signWakeHeightB;
      }
    }

    // Two moving XYZ pressure fields hold a readable pelagic floor around the
    // coherent rays. They make the Identity visibly alive even between body
    // crossings without turning it into random sparkle or a flat breath.
    var signCurrent = wave(nx * 0.83 + ny * 1.37 - nz * 0.59
                         + colorPhase * 2.0 + pixelLocalIndex * 0.009);
    var signPressure = wave(abs(nx - 0.5) * 2.13 - ny * 1.41 + nz * 1.77
                          + swimA * 0.73 - swimB * 0.41
                          + pixelLocalIndex * 0.0035);
    var signWingA = wave((nx - centerAX) * 4.31 - ny * 2.13
                        + flutterPhase * 0.43);
    var signWingB = wave((nx - signCenterBX) * 3.71 + ny * 2.47
                        - flutterPhase * 0.37);
    var signBodies = signRayA * (0.28 + signWingA * detail * 0.20)
                   + signRayB * (0.25 + signWingB * detail * 0.18);
    var signWakes = signWakeA * 0.13 + signWakeB * 0.115;
    var signBed = (0.27 + signCurrent * 0.090 + signPressure * 0.120
                 + signBodies * 1.18 + signWakes * 1.22)
                * (0.79 + level * 0.21);
    var signMix = clamp01(0.08 + signCurrent * 0.20
                        + signPressure * 0.24
                        + signRayA * 0.34 + signRayB * 0.48
                        + signWakes * 0.55);
    r = (pr1 + (pr2 - pr1) * signMix) * signBed;
    g = (pg1 + (pg2 - pg1) * signMix) * signBed;
    b = (pb1 + (pb2 - pb1) * signMix) * signBed;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), white, white, uv);
}
