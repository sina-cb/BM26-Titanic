/*
  boiler_glow
  Pressure-room heat for Summer Camp Dome.
  BarLights become rotating vent sectors; TriangleEdges are gauge needles;
  Vintage lamps carry filament heat while cooling gaps stay dark.
*/

export var localSpeed = 0.5;
export var boilerHeat = 0.55;
export var flickerComplexity = 0.48;
export var ventWidth = 0.34;
export var steamFlash = 0.28;
export var triangleRPM = 0.52;
export var blackoutDepth = 0.64;

export var cp1H = 0.025, cp1S = 1.0, cp1V = 0.72;
export var cp2H = 0.115, cp2S = 0.92, cp2V = 0.58;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderFlickerComplexity(v) { flickerComplexity = v; }
export function sliderVentWidth(v) { ventWidth = v; }
export function sliderSteamFlash(v) { steamFlash = v; }
export function sliderTriangleRPM(v) { triangleRPM = v; }
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

function circDist(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

function softPulse(dist, width) {
  var xVal = clamp01(1.0 - dist / width);
  return xVal * xVal * (3.0 - 2.0 * xVal);
}

var tVent = 0.0;
var tNeedle = 0.0;
var tFlicker = 0.0;
var tRelease = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tVent = tVent + dt * (0.16 + boilerHeat * 0.62);
  tNeedle = tNeedle + dt * (0.24 + triangleRPM * 1.55);
  tFlicker = tFlicker + dt * (1.30 + flickerComplexity * 3.40);
  tRelease = tRelease + dt * (0.10 + steamFlash * 0.82);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var isApex = isTriangleEdge || isTrianglePar;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var width = 0.018 + ventWidth * 0.155;
  var pressure = clamp01(0.22 + boilerHeat * 0.68 + wave(tRelease * 0.73) * 0.10);

  var ventStage = 0.0;
  var coolingUv = 0.0;
  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var sectorA = softPulse(circDist(theta, wrap01(tVent)), width);
    var sectorB = softPulse(circDist(theta, wrap01(0.43 - tVent * 0.57)), width * 0.72) * 0.70;
    var sectorC = softPulse(circDist(theta, wrap01(0.71 + tRelease * 1.31)), width * 0.46) * steamFlash;
    var piston = pow(wave(barT * 1.9 - tFlicker * 0.58 + barIndex * 0.137), 1.7);
    var shutter = pow(wave(theta * 6.0 + tNeedle * 0.39), 2.6);
    ventStage = sectorA;
    if (sectorB > ventStage) ventStage = sectorB;
    if (sectorC > ventStage) ventStage = sectorC;
    ventStage = ventStage * (0.33 + piston * 0.67) * (0.35 + shutter * 0.65);
    coolingUv = pow(clamp01(1.0 - ventStage), 3.2) * sectorC * steamFlash;
  }

  var gaugeStage = 0.0;
  var whiteStage = 0.0;
  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var needleA = softPulse(circDist(edgeT, wrap01(tNeedle + edgeId * 0.333)), 0.030 + ventWidth * 0.085);
    var needleB = softPulse(circDist(edgeT, wrap01(1.0 - tNeedle * 0.64 + edgeId * 0.217)), 0.024 + ventWidth * 0.050) * 0.55;
    var dialHeat = pow(wave(edgeT * 0.72 + tFlicker * 0.21 + edgeId * 0.19), 2.4) * 0.30;
    gaugeStage = clamp01((needleA + needleB + dialHeat) * (0.36 + triangleRPM * 0.82));
    whiteStage = clamp01((needleA * 0.40 + needleB * 0.22) * steamFlash);
  }

  var parBurst = 0.0;
  if (isTrianglePar) {
    var burst = pow(wave(tRelease * 2.3 + index * 0.31), 9.0);
    parBurst = burst > (0.48 + (1.0 - steamFlash) * 0.36) ? burst * steamFlash : 0.0;
  }

  var filament = 0.0;
  if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var bank = softPulse(circDist(wrap01(fixtureNo / 5.0), wrap01(tVent * 0.31 + 0.12)), 0.11 + ventWidth * 0.10);
    var flameA = wave(tFlicker * 0.93 + fixtureNo * 0.271 + lampNo * 0.073);
    var flameB = wave(tFlicker * 2.71 + fixtureNo * 0.137 + lampNo * 0.101);
    filament = (0.030 + bank * (0.32 + flameA * 0.22 + flameB * 0.14)) * boilerHeat;
  }

  var stage = 0.0;
  if (isBar) stage = ventStage;
  else if (isTriangleEdge) stage = gaugeStage;
  else if (isTrianglePar) stage = parBurst;
  else if (isVintage) stage = filament;

  var emberNoise = wave(tFlicker * 0.37 + x * 0.071 - z * 0.053 + y * 0.021);
  var colorMix = clamp01(0.10 + pressure * 0.48 + emberNoise * 0.24 + stage * 0.18);
  var floorGlow = (1.0 - blackoutDepth) * boilerHeat * 0.025;
  var brightness = floorGlow + stage * (0.25 + boilerHeat * 0.42);
  if (isVintage) brightness = floorGlow * 0.35 + filament * 0.22;
  if (isTrianglePar) brightness = floorGlow * 0.20 + parBurst * 0.08;

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness * 0.30;
  var w = isApex ? clamp01(whiteStage + parBurst * 0.55) : 0.0;
  var a = isVintage ? clamp01(filament * (0.52 + boilerHeat * 0.58)) : 0.0;
  var u = clamp01(coolingUv + whiteStage * 0.12 + parBurst * 0.18);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
