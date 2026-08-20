// DRAFT — pending operator review
/*
  123_mirrored_broadside_call.js — "Mirrored Broadside Call"

  Two enormous symmetric wave walls leave the ship center for both outer edges,
  then answer by converging inward. abs(x - 0.5) supplies exact left/right
  symmetry while Y/Z bend the walls into broad 3D surfaces on every model.
  A palette-derived 10–20% floor keeps the complete rig visible between calls.

  Portable by construction: normalized XYZ is the load-bearing canvas. There
  are no named views, raw ids, or required fixture roles. TE signs optionally
  receive a brighter mirrored center-kiss when the returning walls meet.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.30..1.00 curve ease  # wall energy
    sliderPulse     <- micKick range 0.00..1.00 curve pow2  # meeting punch
    sliderExpansion <- micFlux range 0.35..1.00 curve ease  # broadside reach
  # STATIC: localSpeed, wallWidth, contrast, safetyFloor, colorPalette1/2
*/

// Optional accent only; absent TE-sign roles match no pixels.
var FIX_TE_SIGN = 7;

// Export order is physical MIDI knob order.
export var localSpeed = 0.32;
export var level = 0.64;
export var wallWidth = 0.48;
export var expansion = 0.72;
export var contrast = 0.62;
export var safetyFloor = 0.50; // maps strictly to 0.10..0.20
export var pulse = 0.0;

export var cp1H = 0.54, cp1S = 0.94, cp1V = 1.0;
export var cp2H = 0.91, cp2S = 0.92, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderWallWidth(v) { wallWidth = v; }
export function sliderExpansion(v) { expansion = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

var PHASE_WRAP = 10000.0;
var callClock = 0.0;
var shapeClock = 0.0;
var depthClock = 0.0;

var wallPosition = 0.0;
var echoPosition = 0.0;
var responseMix = 0.0;
var warpSin = 0.0;
var warpCos = 1.0;
var liveWidth = 0.12;
var liveSharp = 2.0;
var liveFloor = 0.15;
var liveLevel = 0.64;
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

  var rate = 0.025 + pow(2.0, (localSpeed - 0.5) * 4.0) * 0.105;
  callClock = callClock + dt * rate;
  shapeClock = shapeClock + dt * rate * 0.73;
  depthClock = depthClock + dt * rate * 1.37;
  if (callClock >= PHASE_WRAP) callClock -= PHASE_WRAP;
  if (shapeClock >= PHASE_WRAP) shapeClock -= PHASE_WRAP;
  if (depthClock >= PHASE_WRAP) depthClock -= PHASE_WRAP;

  liveWidth = 0.045 + clamp01(wallWidth) * 0.180;
  liveSharp = 0.80 + clamp01(contrast) * 3.90;
  liveFloor = 0.10 + clamp01(safetyFloor) * 0.10;
  liveLevel = clamp01(level);
  livePulse = clamp01(pulse);

  var callWave = wave(callClock);
  var reach = 0.65 + clamp01(expansion) * 0.35;
  wallPosition = callWave * reach;

  // cos(callClock) is the smooth signed travel velocity: positive outbound,
  // negative inbound. The echo trails the active direction without a hard flip.
  var velocity = cos(callClock * PI2);
  echoPosition = clamp01(wallPosition - velocity * (0.10 + liveWidth * 0.35));
  responseMix = 0.5 - velocity * 0.5; // cp1 call outward, cp2 answer inward
  warpSin = sin(shapeClock * PI2);
  warpCos = cos(depthClock * PI2);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Exact mirrored coordinate: 0 at center, 1 at both outside edges.
  var mirrorX = abs(nx - 0.5) * 2.0;
  // Y/Z curve the broadside walls identically on both halves.
  var yzWarp = (ny - 0.5) * warpSin * 0.13
             + (nz - 0.5) * warpCos * 0.11
             + sin((ny * 0.63 + nz * 0.37) * PI2
                 + shapeClock * PI2 * 2.0) * 0.025;
  var curvedX = clamp01(mirrorX + yzWarp * (0.45 + expansion * 0.55));

  var width = liveWidth * (1.0 + livePulse * 0.28);
  var mainWall = 1.0 - clamp01(abs(curvedX - wallPosition) / width);
  var echoWall = 1.0 - clamp01(abs(curvedX - echoPosition) / (width * 1.28));
  mainWall = pow(mainWall * mainWall * (3.0 - 2.0 * mainWall), liveSharp);
  echoWall = pow(echoWall * echoWall * (3.0 - 2.0 * echoWall),
                 liveSharp + 0.65) * 0.58;

  var meeting = pow(clamp01(1.0 - wallPosition * 3.6), 2.2);
  var broadside = pow(clamp01((wallPosition - 0.78) * 4.55), 2.0);
  var wallEnergy = clamp01(max(mainWall, echoWall)
                         + mainWall * echoWall * 0.35
                         + meeting * livePulse * 0.20
                         + broadside * livePulse * 0.12);

  // Optional Identity kiss at the center meeting: still mirror-derived and
  // smooth, with letter-path refraction rather than a scene-specific view.
  var signKiss = 0.0;
  if (fixtureType == FIX_TE_SIGN) {
    var signPath = pixelLocalIndex * 0.01351351351;
    var kissLens = wave(signPath * 0.67 + ny * 0.23 - nz * 0.17
                      + depthClock * 2.0);
    signKiss = meeting * kissLens;
    wallEnergy = clamp01(wallEnergy + signKiss * (0.20 + livePulse * 0.22));
  }

  var mainMix = 0.08 + responseMix * 0.84;
  var echoMix = 0.92 - responseMix * 0.84;
  var mixWeight = mainWall + echoWall + 0.001;
  var wallMix = (mainWall * mainMix + echoWall * echoMix) / mixWeight;
  var floorCoord = clamp01((nx * 0.68 + nz * 0.32 - 0.18) * 1.56);
  floorCoord = floorCoord * floorCoord * (3.0 - 2.0 * floorCoord);
  var colorMix = floorCoord + (wallMix - floorCoord) * wallEnergy;
  if (fixtureType == FIX_TE_SIGN) colorMix = clamp01(colorMix + signKiss * 0.14);

  // Level owns the wall energy with a wide range; the independent safety floor
  // remains visible at Level=0 instead of hiding a weak brightness response.
  var wallGain = 0.06 + liveLevel * 1.20;
  var brightness = liveFloor + liveLevel * 0.035
                 + wallEnergy * wallGain
                 * (0.70 + contrast * 0.30)
                 + mainWall * livePulse * 0.24;
  brightness = clamp01(brightness);

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  // RGB-only; W and A are matched at zero.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
