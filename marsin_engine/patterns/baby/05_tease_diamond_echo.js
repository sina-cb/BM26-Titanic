// DRAFT - pending operator review
/* Diamond Echo: faceted shells expand through XYZ like a cut-gem sonar. */

export var localSpeed = 0.44;
export var level = 0.85;
export var facetWidth = 0.52;
export var echoDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderFacetWidth(v) { facetWidth = v; }
export function sliderEchoDepth(v) { echoDepth = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.24 * localMult;
  teasePhase = teasePhase + dt * 0.18 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var cx = abs(x - 0.5);
  var cy = abs(y - 0.5);
  var cz = abs(z - 0.5);
  var depth = clamp01(echoDepth);
  var diamond = cx * (1.0 + depth * 0.4) + cy * 0.83 + cz * (1.15 - depth * 0.3);
  var focus = 2.0 + (1.0 - clamp01(facetWidth)) * 9.0;
  var shellA = pow(wave(diamond * 4.1 - phase), focus);
  var shellB = pow(wave((max(cx, cz) + cy * 0.57) * 5.3 + phase * 1.61803399), focus + 1.1);
  var cut = pow(wave((x + z) * 6.0 - y * 4.0 + phase * 0.73), 12.0);
  var field = max(shellA, shellB * 0.88);
  var familyBlue = index % 2;
  var dominance = 0.77 + 0.23 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.20 + field * 0.68 + cut * 0.18);
  var bri = clamp01((0.17 + field * 0.73 + cut * depth * 0.14) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
