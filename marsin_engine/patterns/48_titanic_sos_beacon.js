/*
  titanic_sos_beacon
  Morse signal on TriangleEdges with delayed circular echoes on BarLights.
*/

export var localSpeed = 0.5;
export var signalStrength = 0.72;
export var signalSpeed = 0.46;
export var echoDelay = 0.38;
export var echoWidth = 0.34;
export var responseGlow = 0.30;
export var abyssalDarkness = 0.70;

export var cp1H = 0.58, cp1S = 0.84, cp1V = 0.34;
export var cp2H = 0.08, cp2S = 0.78, cp2V = 0.38;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSignalStrength(v) { signalStrength = v; }
export function sliderSignalSpeed(v) { signalSpeed = v; }
export function sliderEchoDelay(v) { echoDelay = v; }
export function sliderEchoWidth(v) { echoWidth = v; }
export function sliderResponseGlow(v) { responseGlow = v; }
export function sliderAbyssalDarkness(v) { abyssalDarkness = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function _hsv2rgb2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tSignal = 0.0;
var tDrift = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tSignal = tSignal + dt * (0.34 + signalSpeed * 1.25);
  tDrift = tDrift + dt * 0.17;
  _hsv2rgb1();
  _hsv2rgb2();
}

function morsePulse(sigTime) {
  var m = wrap01(sigTime) * 8.0;
  if (m < 1.5) return (m % 0.5) < 0.26 ? 1.0 : 0.0;
  if (m > 2.0 && m < 5.0) return ((m - 2.0) % 1.0) < 0.72 ? 1.0 : 0.0;
  if (m > 5.5 && m < 7.0) return ((m - 5.5) % 0.5) < 0.26 ? 1.0 : 0.0;
  return 0.0;
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var pulse = morsePulse(tSignal);
  var delayed = morsePulse(tSignal - echoDelay * 0.18 - theta * 0.22);
  var width = 0.018 + echoWidth * 0.150;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isTriangleEdge) {
    var edgeT = (index % 18) / 17.0;
    var scan = softPulse(circDist(edgeT, wrap01(tDrift * 1.2)), width);
    stage = pulse * (0.28 + scan * 0.72) * signalStrength;
    white = stage;
    uv = scan * pulse * 0.18;
  } else if (isTrianglePar) {
    stage = pulse * signalStrength * 0.08;
    white = pulse * signalStrength;
  } else if (isBar) {
    var echo = softPulse(circDist(theta, wrap01(tDrift + echoDelay * 0.31)), width) * delayed;
    var echo2 = softPulse(circDist(theta, wrap01(0.55 - tDrift * 0.63)), width * 0.72) * morsePulse(tSignal - echoDelay * 0.31);
    stage = (echo + echo2 * 0.64) * signalStrength;
    uv = stage * (0.26 + echoWidth * 0.44);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var answer = morsePulse(tSignal - 0.18 - fixtureNo * 0.018);
    amber = answer * responseGlow * wave(tDrift * 2.0 + vintageLocal * 0.071);
    stage = amber * 0.070;
  }

  var floorGlow = (1.0 - abyssalDarkness) * 0.018;
  var colorMix = clamp01(0.20 + theta * 0.28 + wave(tDrift + y * 0.07) * 0.24);
  var brightness = floorGlow + stage * 0.34;
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
