/*
  22_abyssal_sway_garden.js
  An underwater garden of vertical fronds swaying in a slow abyssal current.
  Each frond bends laterally with low-freq drift; phosphorescent tips
  flicker at the top, deep blue-green base palette fades into the dark.
*/

export var localSpeed = 0.5;
export var frondDensity = 7.0;
export var swayAmplitude = 0.35;
export var tipGlow = 0.55;
export var baseDarkness = 0.55;
export var currentRate = 0.5;

export var cp1H = 0.55, cp1S = 0.95, cp1V = 1.0; // deep abyssal blue
export var cp2H = 0.38, cp2S = 0.95, cp2V = 1.0; // bioluminescent green
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFrondDensity(v) { frondDensity = 3.0 + v * 14.0; }
export function sliderSwayAmplitude(v) { swayAmplitude = v * 0.7; }
export function sliderTipGlow(v) { tipGlow = v; }
export function sliderBaseDarkness(v) { baseDarkness = v; }
export function sliderCurrentRate(v) { currentRate = v; }

var tCurrent = 0.0;
var tFlicker = 0.0;
var tTide = 0.0;
var currentScale = 0.04;

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
  currentScale = 0.04 / localMultiplier;
  // Slow sway current — primary phase that bends every frond.
  tCurrent = time(currentScale * (0.45 + currentRate * 1.2)) * 6.2831853;
  // Fast phosphorescent flicker on frond tips.
  tFlicker = time(currentScale * 0.18) * 6.2831853;
  // Very slow tide — long-period vertical breath of the whole garden.
  tTide = time(currentScale * 4.7);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  // Per-frond lateral sway — fronds higher up bend more (cantilever).
  // The "kelp in current" feel comes from sway scaling with ny^2.
  var bend = sin(tCurrent + nx * 4.0) * swayAmplitude * ny * ny;
  var bendSlow = sin(tCurrent * 0.41 + nx * 2.3) * swayAmplitude * ny * 0.5;
  var swayedX = nx + bend + bendSlow;

  // Vertical fronds: a phase pattern in x produces tall thin stalks.
  // Irrational density offset per frond avoids visible repeat.
  var frondPhase = swayedX * frondDensity + sin(swayedX * 11.7) * 0.13;
  var frond = wave(frondPhase);
  // Sharpen into stalks — soft sides, bright spine.
  frond = pow(frond, 2.6);

  // Vertical falloff: dark base, bright top (kelp grows toward the light).
  var heightWeight = pow(ny, 1.2);
  var body = frond * heightWeight;

  // Phosphorescent tip flicker — localized to top 35% of each frond,
  // jittered per-frond so tips don't all flicker in unison.
  var tipBand = pow(max(0.0, ny - 0.62) / 0.38, 1.5);
  var flick = wave(tFlicker + swayedX * 7.3 + ny * 2.1);
  flick = pow(flick, 4.0);
  var tipFlicker = tipBand * flick * tipGlow * frond;

  // Long slow tide breath — whole garden brightens/dims over ~30s.
  var tide = 0.8 + sin(tTide * 6.2831853) * 0.2;

  // Dark abyssal floor — base of garden is genuinely dark.
  var darkFloor = (1.0 - heightWeight) * baseDarkness;
  var v = body * 0.85 + tipFlicker;
  v = v * tide - darkFloor * 0.5;
  v = max(0.0, min(1.0, v));

  // Palette: base of frond leans cp1 (deep blue), tips lean cp2
  // (bioluminescent green). Flickers push hard toward cp2.
  var tVal = heightWeight * 0.55 + tipFlicker * 0.8;
  tVal = max(0.0, min(1.0, tVal));

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  rgb(r, g, b);
}
