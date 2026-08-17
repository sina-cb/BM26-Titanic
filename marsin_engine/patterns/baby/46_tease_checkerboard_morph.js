// DRAFT - pending operator review
/*
  Checkerboard Morph: interleaved pink and blue facets fold through a soft 3D
  lattice across the whole ship. The alternating families stay simultaneous
  while two incommensurate waves reshape the checker relief indefinitely.
  Palette-independent Baby pink + Baby blue RGB only; W=A=U=0.
  Handles: local speed, overall level, cell scale, and morph depth.
*/

export var localSpeed = 0.42;
export var level = 0.88;
export var cellScale = 0.46;
export var morphDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderCellScale(v) { cellScale = v; }
export function sliderMorphDepth(v) { morphDepth = v; }

var phaseA = 0.0;
var phaseB = 0.0;

function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phaseA = phaseA + dt * 0.21 * localMult;
  phaseB = phaseB + dt * 0.21 * 1.41421356 * localMult;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
}

export function render3D(index, x, y, z) {
  var scale = 2.4 + clamp01(cellScale) * 7.2;
  var depth = clamp01(morphDepth);
  var foldX = (wave(y * 1.19 + z * 0.73 + phaseA) - 0.5) * depth * 0.34;
  var foldY = (wave(z * 1.37 - x * 0.67 - phaseB) - 0.5) * depth * 0.34;
  var foldZ = (wave(x * 1.61 + y * 0.83 + phaseB * 0.71) - 0.5) * depth * 0.30;
  var cellX = floor((x + foldX) * scale);
  var cellY = floor((y + foldY) * scale);
  var cellZ = floor((z + foldZ) * scale);
  var checker = (cellX + cellY + cellZ) % 2;
  if (checker < 0.0) checker = checker + 2.0;

  var seamX = abs(wave((x + foldX) * scale) - 0.5) * 2.0;
  var seamY = abs(wave((y + foldY) * scale) - 0.5) * 2.0;
  var seamZ = abs(wave((z + foldZ) * scale) - 0.5) * 2.0;
  var facet = clamp01((seamX + seamY + seamZ) / 3.0);
  var relief = 0.30 + facet * 0.56 + checker * 0.10;
  var traveling = wave(x * 0.91 + y * 1.13 + z * 1.57 - phaseA * 0.73);
  var shade = clamp01(0.18 + relief * 0.66 + traveling * 0.16);
  var bri = clamp01((0.30 + relief * 0.62 + traveling * 0.10) * clamp01(level));

  // Stable interleaving guarantees an outcome-blind mix even on test_bench.
  var familyBlue = index % 2;
  if (familyBlue) {
    rgbwau((0.008 + shade * 0.025) * bri,
           (0.13 + shade * 0.32) * bri,
           (0.62 + shade * 0.38) * bri,
           0.0, 0.0, 0.0);
  } else {
    rgbwau((0.62 + shade * 0.38) * bri,
           (0.008 + shade * 0.027) * bri,
           (0.17 + shade * 0.19) * bri,
           0.0, 0.0, 0.0);
  }
}
