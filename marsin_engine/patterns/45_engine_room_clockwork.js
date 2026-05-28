/*
  45_engine_room_clockwork.js
  Multi-gear cathedral: 3 prime-tooth gears (3, 5, 7) on the three edges with
  bright teeth chasing along each. TrianglePars rotate as the central drive
  shaft at slower, offset rates. Bars run a dotted clockwork chase per-bar.

  E2 par visibility push: each par rotates at its own slightly different rate
  (1.0/1.13/0.87) on top of the parId/3 phase, with a wide-amplitude smooth +
  quarter-turn clicks and an undampened brightness path so the shaft segments
  read from across the dome (floor ≥ 0.18, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var gearSharpness = 0.55;
export var pistonStroke = 0.62;
export var driveShaft = 0.55;
export var barTickDensity = 0.50;
export var boilerHeat = 0.40;
export var pauseAmount = 0.20;
export var blackoutDepth = 0.30;

export var cp1H = 0.08, cp1S = 0.92, cp1V = 0.85;
export var cp2H = 0.14, cp2S = 0.88, cp2V = 0.70;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderGearSharpness(v) { gearSharpness = v; }
export function sliderPistonStroke(v) { pistonStroke = v; }
export function sliderDriveShaft(v) { driveShaft = v; }
export function sliderBarTickDensity(v) { barTickDensity = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderPauseAmount(v) { pauseAmount = v; }
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
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

// Prime tooth counts per edge so the gears never re-mesh into a 2-1.
// Edge 0 = 3 teeth, Edge 1 = 5 teeth, Edge 2 = 7 teeth.
var TEETH_0 = 3.0;
var TEETH_1 = 5.0;
var TEETH_2 = 7.0;

var tGear0 = 0.0;
var tGear1 = 0.0;
var tGear2 = 0.0;
var tShaft = 0.0;
var tBar = 0.0;
var tHeat = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  // Each gear advances at its own rate — slower for higher tooth counts so
  // the linear tooth speed reads similar across edges.
  tGear0 = tGear0 + dt * (0.40 + pistonStroke * 0.95);
  tGear1 = tGear1 + dt * -(0.30 + pistonStroke * 0.75);   // counter-rotate
  tGear2 = tGear2 + dt * (0.22 + pistonStroke * 0.55);

  tShaft = tShaft + dt * (0.10 + driveShaft * 0.30);
  tBar   = tBar   + dt * (0.50 + barTickDensity * 1.10);
  tHeat  = tHeat  + dt * (0.18 + boilerHeat * 0.55);

  _hsv2rgb1();
  _hsv2rgb2();
}

// Render N rotating teeth across edgeT [0..1].
function gearTeethPulse(edgeT, teeth, phase, sharpness) {
  var phaseT = wrap01(edgeT * teeth - phase);
  // Centred on 0.5 within the tooth: peak there, dark at boundaries.
  var dist = abs(phaseT - 0.5);
  return softPulse(dist, 0.10 + sharpness * 0.30);
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  // Global pause gate — deliberate punctuation, not a fallback. Capped low.
  var pauseGate = 1.0 - softPulse(abs(wrap01(tShaft * 0.5) - 0.5), 0.05 + pauseAmount * 0.10) * pauseAmount;

  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;
  var mixv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    var teeth = TEETH_0; var phase = tGear0;
    if (edgeId == 1) { teeth = TEETH_1; phase = tGear1; }
    else if (edgeId == 2) { teeth = TEETH_2; phase = tGear2; }

    var tooth = gearTeethPulse(edgeT, teeth, phase, gearSharpness);

    // Phase-unique 1-1-1 cascade (Rule 1): each edge has its own pattern.
    stage = clamp01(0.20 + tooth * 0.85);
    white = clamp01(pow(tooth, 3.0) * 0.75);
    uv    = clamp01(pow(tooth, 6.0) * 0.30);
    mixv  = clamp01(edgeId / 2.0 + tooth * 0.20);
    stage = stage * pauseGate;
    white = white * pauseGate;
    uv = uv * pauseGate;
  } else if (isTrianglePar) {
    // Each par is a drive shaft segment at its own slow rotation — strictly
    // unique offsets (Rule 2: pars active, 1-1-1 cascade). E2 push: each par
    // rotates at a slightly different rate (1.0, 1.13, 0.87) so they never
    // re-sync, and floor brightness is held above 0.18 with peak ≥ 0.90.
    var parId = index - 54;
    var parRate = 1.0;
    if (parId == 1) parRate = 1.13;
    else if (parId == 2) parRate = 0.87;
    var shaftPhase = wrap01(tShaft * parRate + parId / 3.0);
    // Continuous wide-amplitude rotation — much wider than before so the par
    // visibly waxes and wanes (Rule B: peak ≥ 0.40).
    var smooth = 0.45 + 0.45 * wave(shaftPhase + parId * 0.137);
    var clickT = wrap01(shaftPhase * 4.0);
    var click = softPulse(abs(clickT - 0.0), 0.07) + softPulse(abs(clickT - 1.0), 0.07);

    stage = clamp01((0.22 + smooth * 0.78 + click * driveShaft * 0.95) * pauseGate);
    white = clamp01((click * (0.50 + driveShaft * 0.50) + smooth * 0.18) * pauseGate);
    amber = clamp01((smooth * 0.45 + click * 0.25) * (0.40 + boilerHeat * 0.60));
    mixv = parId / 2.0;
  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    // Dotted clockwork chase: 4-6 ticks running along each bar.
    var ticks = 4.0 + barTickDensity * 5.0;
    var chaseHead = wrap01(tBar + barIndex / 13.0);              // per-bar offset
    var chaseT = wrap01(barT * ticks - chaseHead);
    var chaseDot = softPulse(abs(chaseT - 0.5), 0.12 + gearSharpness * 0.18);

    // Counter chase for visual contrast.
    var counterT = wrap01(barT * ticks + chaseHead * 0.7);
    var counterDot = softPulse(abs(counterT - 0.5), 0.10) * 0.55;

    // Always-on dot baseline so bars never go dark (Rule 3).
    var baseline = 0.16 + 0.08 * wave(barT * ticks * 1.5 + barIndex * 0.19);

    stage = clamp01((baseline + chaseDot * 0.85 + counterDot) * pauseGate);
    white = clamp01(chaseDot * 0.45 * pauseGate);
    uv    = clamp01(counterDot * 0.30 * pauseGate);
    mixv  = clamp01(barIndex / 13.0 + chaseDot * 0.30);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    var filament = 0.5 + 0.5 * wave(tHeat + fixtureNo * 0.27 + lampNo * 0.083);
    amber = (0.15 + filament * 0.45) * boilerHeat * pauseGate;
    stage = amber * 0.12;
    mixv = fixtureNo / 4.0;
  }

  var floorGlow = (1.0 - blackoutDepth) * 0.025;
  var brightness = floorGlow + stage * (0.55 + boilerHeat * 0.25);
  if (isVintage) brightness = floorGlow * 0.30 + stage;
  // Pars: undampened bright path so the drive shaft reads from across the dome.
  if (isTrianglePar) brightness = 0.12 + stage * (0.78 + boilerHeat * 0.18);

  var r = (pr1 + (pr2 - pr1) * mixv) * brightness;
  var g = (pg1 + (pg2 - pg1) * mixv) * brightness;
  var b = (pb1 + (pb2 - pb1) * mixv) * brightness * 0.55;  // amber bias

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
