/*
  engine_room_clockwork
  Mechanical stepper pattern for Summer Camp Dome.
  BarLights act as pistons around the ring; TriangleEdges become clock hands;
  Vintage lamps tick in amber banks with hard blackout pauses.
*/

export var localSpeed = 0.5;
export var gearTeeth = 0.45;
export var tickDecay = 0.38;
export var pistonStroke = 0.52;
export var boilerHeat = 0.36;
export var pauseAmount = 0.42;
export var triangleDial = 0.62;

export var cp1H = 0.06, cp1S = 0.94, cp1V = 0.62;
export var cp2H = 0.12, cp2S = 0.88, cp2V = 0.45;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderGearTeeth(v) { gearTeeth = v; }
export function sliderTickDecay(v) { tickDecay = v; }
export function sliderPistonStroke(v) { pistonStroke = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderPauseAmount(v) { pauseAmount = v; }
export function sliderTriangleDial(v) { triangleDial = v; }

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

var tGear = 0.0;
var tTick = 0.0;
var tHeat = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tGear = tGear + dt * (0.22 + gearTeeth * 1.15);
  tTick = tTick + dt * (0.80 + tickDecay * 2.20);
  tHeat = tHeat + dt * (0.42 + boilerHeat * 1.20);

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
  var teeth = floor(5.0 + gearTeeth * 12.0);
  var toothPhase = wrap01(theta * teeth - tGear);
  var tooth = pow(wave(toothPhase), 4.0 + tickDecay * 7.0);
  var pauseGate = 1.0 - softPulse(circDist(wrap01(tTick), 0.0), 0.030 + pauseAmount * 0.080) * pauseAmount;

  var stage = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var strokeHead = wrap01(tGear * (0.84 + pistonStroke * 0.42) + barIndex * 0.077);
    var returnHead = wrap01(1.0 - tGear * 0.51 + barIndex * 0.131);
    var pistonA = softPulse(circDist(barT, strokeHead), 0.035 + pistonStroke * 0.125);
    var pistonB = softPulse(circDist(barT, returnHead), 0.024 + tickDecay * 0.055) * 0.54;
    var ratchet = tooth * (0.34 + wave(barT * 2.0 + tHeat + barIndex * 0.17) * 0.66);
    stage = clamp01((pistonA + pistonB + ratchet * 0.44) * pauseGate);
    uv = clamp01((pistonB + ratchet * 0.22) * (0.12 + tickDecay * 0.28) * pauseGate);
  } else if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var handA = softPulse(circDist(edgeT, wrap01(tGear * 0.73 + edgeId * 0.333)), 0.025 + triangleDial * 0.070);
    var handB = softPulse(circDist(edgeT, wrap01(1.0 - tGear * 0.41 + edgeId * 0.211)), 0.020 + tickDecay * 0.045) * 0.62;
    var dialTeeth = pow(wave(edgeT * teeth * 0.5 - tTick + edgeId * 0.19), 5.0) * 0.32;
    stage = clamp01((handA + handB + dialTeeth) * (0.32 + triangleDial * 0.76) * pauseGate);
    white = clamp01((handA * 0.36 + handB * 0.22) * tickDecay * pauseGate);
    uv = clamp01(dialTeeth * 0.22);
  } else if (isTrianglePar) {
    var punch = pow(wave(tTick * 2.0 + index * 0.29), 10.0);
    stage = punch * triangleDial * 0.08 * pauseGate;
    white = punch * tickDecay * 0.28;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var bank = softPulse(circDist(wrap01(fixtureNo / 5.0), wrap01(tTick * 0.53)), 0.085 + tickDecay * 0.040);
    var filament = wave(tHeat * 1.7 + fixtureNo * 0.29 + lampNo * 0.083);
    amber = (0.020 + bank * (0.34 + filament * 0.24)) * boilerHeat * pauseGate;
    stage = amber * 0.10;
  }

  var colorMix = clamp01(0.20 + tooth * 0.42 + wave(tHeat + x * 0.05 - z * 0.04) * 0.20);
  var floorGlow = boilerHeat * (1.0 - pauseAmount) * 0.010;
  var brightness = floorGlow + stage * (0.24 + boilerHeat * 0.32);
  if (isVintage) brightness = floorGlow * 0.35 + stage;
  if (isTrianglePar) brightness = floorGlow * 0.20 + stage;

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness * 0.45;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
