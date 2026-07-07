/*
  19_swaying_lattice_ballet.js
  A regular grid of glowing lattice nodes that sways in counter-phase along
  two axes — like a corps de ballet bowing left while the row behind bows
  right. Two decorrelated lattice fields interleave; a slow Lissajous pivot
  walks the sway center so the pattern never visibly repeats.
*/

export var localSpeed = 0.5;
export var latticeScale = 6.0;
export var swayAmount = 0.35;
export var nodeSoftness = 2.4;
export var counterPhase = 0.6;
export var floorLevel = 0.08;

export var cp1H = 0.58, cp1S = 0.92, cp1V = 1.0; // base lattice (teal/blue)
export var cp2H = 0.84, cp2S = 0.92, cp2V = 1.0; // accent (violet/magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLatticeScale(v) { latticeScale = 2.5 + v * 11.0; }
export function sliderSwayAmount(v) { swayAmount = v * 0.7; }
export function sliderNodeSoftness(v) { nodeSoftness = 1.2 + v * 4.5; }
export function sliderCounterPhase(v) { counterPhase = v; }
export function sliderFloorLevel(v) { floorLevel = v * 0.25; }

var phaseA = 0.0;
var phaseB = 0.0;
var swayX = 0.0;
var swayY = 0.0;
var pivotX = 0.0;
var pivotY = 0.0;
var currentScale = 0.018;

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
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  currentScale = 0.018 / localMultiplier;
  // Two sway phases at an irrational ratio so lattices never re-align.
  phaseA = time(currentScale) * 6.2831853;
  phaseB = time(currentScale * 1.382) * 6.2831853;
  // Sway oscillations — these are the "ballet bow" left/right & up/down.
  swayX = sin(phaseA) * swayAmount;
  swayY = sin(phaseB * 0.83) * swayAmount * 0.65;
  // Lissajous pivot walks the sway center so the lattice "wanders".
  pivotX = sin(time(currentScale * 0.27) * 6.2831853) * 0.12;
  pivotY = cos(time(currentScale * 0.31) * 6.2831853) * 0.10;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  // Lattice A — sways left/right with phaseA, walks with pivot.
  var uxA = (nx - 0.5 - pivotX) * latticeScale + swayX;
  var uyA = (ny - 0.5 - pivotY) * latticeScale * 0.78 - swayY;
  var nodeA = wave(uxA) * wave(uyA);

  // Lattice B — counter-phase (offset by half-cell), sways opposite.
  var uxB = (nx - 0.5 + pivotX) * latticeScale - swayX * counterPhase;
  var uyB = (ny - 0.5 + pivotY) * latticeScale * 0.78 + swayY * counterPhase;
  var nodeB = wave(uxB + 0.5) * wave(uyB + 0.5);

  // Sharpen nodes so the grid reads as dots, not a wash.
  nodeA = pow(max(0.0, nodeA), nodeSoftness);
  nodeB = pow(max(0.0, nodeB), nodeSoftness);

  // Counter-phase interleave: pixels favour A vs B depending on the
  // alternating cell parity — produces the "two rows bowing opposite" feel.
  var bowMask = wave((nx + ny) * latticeScale * 0.5);
  var lattice = nodeA * bowMask + nodeB * (1.0 - bowMask);

  // Slow vertical breath so the corps de ballet breathes as one.
  var breath = 0.85 + sin(phaseA * 0.5 + ny * 1.8) * 0.15;
  var v = floorLevel + lattice * 0.92 * breath;
  v = max(0.0, min(1.0, v));

  // Palette mix follows which lattice dominates this pixel — A is cp1, B is cp2.
  var total = nodeA + nodeB + 0.0001;
  var tVal = nodeB / total;
  tVal = max(0.0, min(1.0, tVal));

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  rgb(r, g, b);
}
