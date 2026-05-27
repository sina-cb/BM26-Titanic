/*
  ghost_aurora
  Layered aurora curtains for Summer Camp Dome.
  BarLights carry flowing vertical ribbons; TriangleEdges are a luminous horizon;
  Vintage lamps only catch soft human warmth at curtain crossings.
*/

export var localSpeed = 0.5;
export var curtainWidth = 0.36;
export var driftChaos = 0.42;
export var blackoutDepth = 0.68;
export var rimShimmer = 0.34;
export var triangleGain = 0.72;
export var humanWarmth = 0.28;

export var cp1H = 0.47, cp1S = 0.88, cp1V = 0.62;
export var cp2H = 0.76, cp2S = 0.84, cp2V = 0.52;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCurtainWidth(v) { curtainWidth = v; }
export function sliderDriftChaos(v) { driftChaos = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderRimShimmer(v) { rimShimmer = v; }
export function sliderTriangleGain(v) { triangleGain = v; }
export function sliderHumanWarmth(v) { humanWarmth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; }
  else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; }
  else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; }
  else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; }
  else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
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

var tDrift = 0.0;
var tCurl = 0.0;
var tShimmer = 0.0;
var tWarm = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tDrift = tDrift + dt * (0.18 + driftChaos * 0.78);
  tCurl = tCurl + dt * (0.07 + driftChaos * 0.31);
  tShimmer = tShimmer + dt * (0.68 + rimShimmer * 2.15);
  tWarm = tWarm + dt * (0.24 + humanWarmth * 0.85);

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
  var heightWave = y * (0.155 + curtainWidth * 0.050);
  var curlA = wave(theta * 0.91 + tCurl * 0.83);
  var curlB = wave(theta * 1.73 - tCurl * 0.41 + y * 0.061);
  var curtainPhase = heightWave - tDrift + (curlA - 0.5) * (0.24 + driftChaos * 0.33);
  var ribbonA = pow(wave(curtainPhase), 2.0 + blackoutDepth * 3.5);
  var ribbonB = pow(wave(curtainPhase * 0.73 + 0.31 + curlB * 0.22), 3.4 + blackoutDepth * 2.5) * 0.72;
  var ribbonC = pow(wave(heightWave * 1.41 + theta * 0.19 + tCurl * 0.67), 5.0) * 0.34;
  var aurora = clamp01(ribbonA + ribbonB + ribbonC);
  var verticalTear = pow(wave(theta * 3.0 + tCurl * 0.37), 2.0);
  aurora = aurora * (0.25 + curtainWidth * 0.55 + verticalTear * 0.35);
  aurora = aurora * (1.0 - blackoutDepth * 0.42);

  var edgeStage = 0.0;
  var edgeRim = 0.0;
  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var edgeHorizon = pow(wave(edgeT * 0.56 - tDrift * 0.62 + edgeId * 0.13), 2.2);
    var edgeCurtain = pow(wave(edgeT * 1.41 + tCurl * 0.79 + edgeId * 0.277), 5.5);
    edgeStage = clamp01((edgeHorizon * 0.44 + edgeCurtain * 0.56) * (0.30 + triangleGain * 0.88));
    edgeRim = clamp01(edgeCurtain * 0.30 + edgeHorizon * 0.16);
  }

  var barStage = 0.0;
  var barRim = 0.0;
  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var fall = pow(wave(barT * (1.2 + curtainWidth) - tDrift * 1.85 + theta * 0.37), 1.6);
    var fixtureBreath = wave(barIndex * 0.113 + tCurl * 0.52);
    barStage = aurora * (0.36 + fall * 0.52 + fixtureBreath * 0.12);
    barRim = pow(clamp01(barStage), 2.1) * (0.32 + fall * 0.68);
  }

  var parHit = 0.0;
  if (isTrianglePar) {
    var parSeed = wave(tShimmer * 1.41 + index * 0.173 + theta * 0.77);
    parHit = parSeed > (0.82 - rimShimmer * 0.28) ? parSeed : 0.0;
    parHit = clamp01(parHit * triangleGain);
  }

  var vintageGlow = 0.0;
  if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var vintageTheta = wrap01(fixtureNo / 5.0 + lampNo * 0.021);
    var cross = pow(wave(vintageTheta * 0.83 + tWarm * 0.52 + lampNo * 0.047), 5.0);
    var flame = wave(tShimmer * 0.61 + fixtureNo * 0.277 + lampNo * 0.061);
    vintageGlow = (0.012 + cross * (0.22 + flame * 0.22)) * humanWarmth;
  }

  var stage = 0.0;
  if (isTriangleEdge) stage = edgeStage;
  else if (isBar) stage = barStage;
  else if (isTrianglePar) stage = parHit;
  else if (isVintage) stage = vintageGlow;

  var darkFloor = (1.0 - blackoutDepth) * 0.026;
  var colorMix = clamp01(0.10 + wave(theta * 0.61 + heightWave * 0.73 - tCurl * 0.72) * 0.62 + ribbonB * 0.22);
  var brightness = darkFloor + stage * (0.18 + curtainWidth * 0.42);
  if (isTriangleEdge) brightness = darkFloor * 0.45 + edgeStage * (0.16 + triangleGain * 0.25);
  if (isTrianglePar) brightness = darkFloor * 0.20 + parHit * 0.10;
  if (isVintage) brightness = darkFloor * 0.18 + vintageGlow * 0.16;

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  var shimmerLine = wave(tShimmer * 3.31 + theta * 2.17 + y * 0.29 + index * 0.017);
  var rim = clamp01((barRim + edgeRim + parHit * 0.45) * rimShimmer * (0.45 + shimmerLine * 0.55));
  var w = isApex ? clamp01(rim * (0.36 + triangleGain * 0.42)) : clamp01(rim * 0.18);
  var a = isVintage ? clamp01(vintageGlow) : 0.0;
  var u = clamp01((barRim * 0.62 + edgeStage * 0.38 + parHit * 0.22) * (0.18 + rimShimmer * 0.72));

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
