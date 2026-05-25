/*
  03_dual_axis_crush.js
  A linear continuous attack pattern that spawns at the extreme left and right 
  edges of the room and collapses into the physical stage center forever.
*/

export var localSpeed = 0.5;
export var swipeLength = 0.8;
export var beamWidth = 0.5;
export var globalDir = 1.0;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Tail/edge colour
export var cp2H = 0.1,  cp2S = 1.0, cp2V = 1.0; // Beam-head colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCount(v) { swipeLength = 0.2 + v * 1.5; }
export function sliderBeamWidth(v) { beamWidth = 0.1 + v * 0.8; }
export function sliderDirection(v) { globalDir = (v * 2.0) - 1.0; }

var attackPos = 0.0;
var flashIntensity = 0;
var invBeamWidth = 1.0;

// ── Palette RGB cache (strict cp1<->cp2 blending) ─────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var phaseIncrement = (delta / 65536.0) / (0.05 / localMultiplier);
  attackPos = (attackPos + phaseIncrement * globalDir) % 1.0;
  if (attackPos < 0) attackPos += 1.0;

  invBeamWidth = 1.0 / beamWidth;

  var flashPhase = attackPos % 1.0;
  flashIntensity = 0.0;
  if (flashPhase < 0.1) {
    flashIntensity = 1.0 - (flashPhase * 10.0);
    flashIntensity *= flashIntensity;
  }
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var normDist = 0.0;
  if (x < 0.6) {
    normDist = (0.6 - x) * 0.5376;
  } else {
    normDist = (x - 0.6) * 0.7936;
  }

  var spatialPhase = normDist / swipeLength;
  var cycle = (spatialPhase + attackPos) % 1.0;
  var distBehind = cycle * swipeLength;

  var tVal = min(1.0, distBehind * invBeamWidth);
  var brightness = max(0.0, 1.0 - tVal);
  brightness *= brightness;

  // Centre flash now boosts cp2 (beam-head) brightness rather than zeroing
  // saturation (the old code drove sat -> 0 + val -> 1, which produced
  // a non-palette WHITE flash).  Boost intensity along the palette line.
  var centerProximity = max(0.0, 1.0 - normDist * 4.0);
  var localFlash = flashIntensity * centerProximity;
  var v = max(brightness, localFlash);

  // Strict RGB lerp: tVal=0 -> cp2 (head), tVal=1 -> cp1 (tail)
  var r = (pr2 + (pr1 - pr2) * tVal) * v;
  var g = (pg2 + (pg1 - pg2) * tVal) * v;
  var b = (pb2 + (pb1 - pb2) * tVal) * v;

  rgb(r, g, b);
}
