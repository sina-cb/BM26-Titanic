/*
  25_heartbeat.js
  Synchronized double-pulse heartbeat. Continuous cp1<->cp2 gradient
  across the rig (was previously 3 discrete sectionId-driven colours).
*/

export var localSpeed = 0.5;
export var minBright = 0.04;
export var rippleAmount = 0.0;

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0; // Pulse core
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // Pulse outer / accent
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDormantGlow(v) { minBright = v * 0.3; }
export function sliderRippleSweep(v) { rippleAmount = v * 0.5; }

var t1;

// ── Palette RGB cache ─────────────────────────────────────────────────
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
  t1 = time(0.012 / localMultiplier);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var normX = (x + 0.4) / 2.02;
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;

  // Optional ripple: the beat front sweeps across the rig instead of
  // firing everywhere simultaneously.
  var localCycle = (t1 - (normX * rippleAmount)) % 1.0;
  if (localCycle < 0.0) localCycle += 1.0;

  var localBeat = 0.0;
  if (localCycle < 0.08) {
     localBeat = wave(localCycle / 0.08);
  } else if (localCycle > 0.12 && localCycle < 0.18) {
     localBeat = wave((localCycle - 0.12) / 0.06) * 0.7;
  }

  // Continuous cp1<->cp2 gradient across the room (left -> right).
  var tColour = normX;
  var bright = minBright + localBeat * (1.0 - minBright);
  var posMod = 1.0 - abs((y / 6.5) - 0.5) * 0.3;
  var v = bright * posMod;

  var r = (pr1 + (pr2 - pr1) * tColour) * v;
  var g = (pg1 + (pg2 - pg1) * tColour) * v;
  var b = (pb1 + (pb2 - pb1) * tColour) * v;
  rgb(r, g, b);
}
