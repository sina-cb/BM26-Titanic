/*
  apex_perimeter_ping
  Spatial sonar pings from triangle stage to circular perimeter.
*/

export var localSpeed = 0.5;
export var pingWidth = 0.34;
export var laneCount = 0.42;
export var trailDecay = 0.52;
export var pingImpact = 0.46;
export var vintageMidpoint = 0.26;
export var blackoutDepth = 0.72;

export var cp1H = 0.53, cp1S = 0.92, cp1V = 0.50;
export var cp2H = 0.68, cp2S = 0.86, cp2V = 0.42;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPingWidth(v) { pingWidth = v; }
export function sliderLaneCount(v) { laneCount = v; }
export function sliderTrailDecay(v) { trailDecay = v; }
export function sliderPingImpact(v) { pingImpact = v; }
export function sliderVintageMidpoint(v) { vintageMidpoint = v; }
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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tPing = 0.0;
var tLane = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tPing = tPing + dt * (0.34 + pingImpact * 1.10);
  tLane = tLane + dt * (0.09 + laneCount * 0.38);
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
  var lanes = floor(3.0 + laneCount * 8.0);
  var laneGate = pow(wave(theta * lanes + tLane), 4.0);
  var width = 0.025 + pingWidth * 0.115;
  var head = wrap01(tPing);
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var launch = softPulse(circDist(edgeT, wrap01(head * 1.4 + edgeId * 0.333)), width);
    var echo = softPulse(circDist(edgeT, wrap01(1.0 - head * 0.72 + edgeId * 0.19)), width * 0.62) * trailDecay;
    stage = clamp01((launch + echo) * (0.42 + pingImpact * 0.72));
    white = clamp01(launch * pingImpact * 0.62);
    uv = echo * trailDecay * 0.32;
  } else if (isBar) {
    var barLocal = index - 57;
    var barT = (barLocal % 18) / 17.0;
    var radialT = 0.48 + barT * 0.52;
    var ping = softPulse(abs(radialT - head), width);
    var trail = head > radialT ? softPulse(head - radialT, 0.10 + trailDecay * 0.26) : 0.0;
    stage = (ping + trail * 0.36) * (0.20 + laneGate * 0.80);
    white = ping * pingImpact * laneGate;
    uv = clamp01((ping * 0.28 + trail * 0.44) * trailDecay);
  } else if (isTrianglePar) {
    var par = softPulse(circDist(head, 0.06), width * 1.3);
    stage = par * pingImpact * 0.10;
    white = par * pingImpact;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var mid = softPulse(circDist(head, 0.58 + fixtureNo * 0.008), width * 1.4);
    amber = mid * vintageMidpoint * wave(tLane * 2.0 + vintageLocal * 0.061);
    stage = amber * 0.055;
  }

  var colorMix = clamp01(0.18 + theta * 0.36 + stage * 0.34);
  var brightness = (1.0 - blackoutDepth) * 0.012 + stage * (0.24 + pingWidth * 0.28);
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
