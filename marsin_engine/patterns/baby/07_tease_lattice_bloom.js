// DRAFT - pending operator review
/* Lattice Bloom: a breathing 3D interference lattice opens like a flower. */

export var localSpeed = 0.50;
export var level = 0.86;
export var latticeScale = 0.46;
export var bloom = 0.64;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderLatticeScale(v) { latticeScale = v; }
export function sliderBloom(v) { bloom = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.30 * localMult;
  teasePhase = teasePhase + dt * 0.23 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var scale = 2.0 + clamp01(latticeScale) * 7.0;
  var bloomAmt = clamp01(bloom);
  var axisA = wave(x * scale + y * 0.73 - phase);
  var axisB = wave(y * scale * 0.83 + z * 0.61 + phase * 1.41421356);
  var axisC = wave(z * scale * 1.11 - x * 0.47 - phase * 1.7320508);
  var intersection = pow(axisA * axisB * axisC, 0.55 + bloomAmt * 1.8);
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var radius = sqrt(cx * cx + cy * cy + cz * cz);
  var shell = pow(wave(radius * (3.0 + bloomAmt * 3.0) - phase * 0.62), 5.0);
  var field = max(intersection, shell * (0.45 + bloomAmt * 0.45));
  var familyBlue = index % 2;
  var dominance = 0.76 + 0.24 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.80);
  var bri = clamp01((0.17 + field * 0.82) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
