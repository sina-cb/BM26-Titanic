/*
  23_prismatic_strange_attractors.js
  Strange moving gravity wells, prismatic contrast, soft white cores, and a UV ghost field.
*/

export var speed = 0.16;
export var chaos = 4.5;
export var orbitReach = 0.42;
export var contrast = 3.0;
export var darkFloor = 0.04;
export var whiteCore = 0.5;
export var uvGhost = 0.35;
export var hueA = 0.58;
export var hueB = 0.86;
export var hueC = 0.12;
export var colorSpread = 1.0;

export function sliderSpeed(v) { speed = 0.7 - v * 0.68; }
export function sliderChaos(v) { chaos = 1.0 + v * 10.0; }
export function sliderOrbitReach(v) { orbitReach = 0.12 + v * 0.55; }
export function sliderContrast(v) { contrast = 1.0 + v * 7.0; }
export function sliderDarkFloor(v) { darkFloor = v * 0.18; }
export function sliderWhiteCore(v) { whiteCore = v; }
export function sliderUvGhost(v) { uvGhost = v; }
export function sliderColorSpread(v) { colorSpread = 0.2 + v * 1.4; }
export function hsvPickerColorA(h, s, v) { hueA = h; }
export function hsvPickerColorB(h, s, v) { hueB = h; }
export function hsvPickerColorC(h, s, v) { hueC = h; }

var phaseA = 0.0;
var phaseB = 0.0;
var phaseC = 0.0;

export function beforeRender(delta) {
  phaseA = time(speed) * 6.2831853;
  phaseB = time(speed * 0.47) * 6.2831853;
  phaseC = time(speed * 0.29) * 6.2831853;
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  var nz = (z + 0.35) / 1.2;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));
  nz = max(0.0, min(1.0, nz));

  var ax = 0.5 + orbitReach * sin(phaseA + sin(phaseB) * 0.8) * 0.9;
  var ay = 0.5 + orbitReach * sin(phaseA * 1.37 + phaseC) * 0.68;
  var bx = 0.5 + orbitReach * sin(phaseB * 1.71 - 1.4) * 0.8;
  var by = 0.5 + orbitReach * cos(phaseA * 0.63 + phaseB) * 0.62;
  var cx = 0.5 + orbitReach * cos(phaseC * 1.93 + phaseA * 0.3) * 0.74;
  var cy = 0.5 + orbitReach * sin(phaseC - phaseB * 0.7) * 0.7;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);
  var nearest = min(dA, min(dB, dC));

  var curl = sin((dA - dB + dC) * chaos * 6.2831853 + phaseA);
  curl += sin((nx * ny + nz * 0.5) * chaos * 3.1 - phaseB);
  curl += sin((nx - ny + nz) * chaos * 2.2 + phaseC);
  curl = abs(curl * 0.333);

  var glow = pow(max(0.0, 1.0 - nearest * (2.0 + contrast)), 1.8);
  var filament = pow(curl, contrast);
  var intensity = min(1.0, darkFloor + glow * 0.75 + filament * 0.55);

  var colorPhase = (curl * colorSpread + glow * 1.4 + time(speed * 0.19) * 2.0) % 3.0;
  if (colorPhase < 0.0) colorPhase += 3.0;

  var hue = hueA;
  if (colorPhase < 1.0) {
    var dhAB = hueB - hueA;
    if (dhAB > 0.5) dhAB -= 1.0;
    else if (dhAB < -0.5) dhAB += 1.0;
    hue = hueA + dhAB * colorPhase;
  } else if (colorPhase < 2.0) {
    var dhBC = hueC - hueB;
    if (dhBC > 0.5) dhBC -= 1.0;
    else if (dhBC < -0.5) dhBC += 1.0;
    hue = hueB + dhBC * (colorPhase - 1.0);
  } else {
    var dhCA = hueA - hueC;
    if (dhCA > 0.5) dhCA -= 1.0;
    else if (dhCA < -0.5) dhCA += 1.0;
    hue = hueC + dhCA * (colorPhase - 2.0);
  }

  var sat = 0.92 - glow * 0.32;
  var base = intensity * (1.0 - sat);
  var r = base + intensity * wave(hue + 0.000) * sat;
  var g = base + intensity * wave(hue + 0.333) * sat;
  var b = base + intensity * wave(hue + 0.666) * sat;

  var white = min(1.0, pow(glow, 2.4) * whiteCore);
  var uv = min(1.0, (filament * 0.35 + (1.0 - ny) * curl * 0.35) * uvGhost);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
