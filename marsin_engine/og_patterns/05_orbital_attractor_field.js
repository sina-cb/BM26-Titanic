/*
  05_orbital_attractor_field.js
  Orbital Attractor Field
*/

export var localSpeed = 0.5;
export var orbit1 = 0.4;
export var orbit2 = 0.5;
export var orbit3 = 0.3;
export var r1 = 1.0;
export var r2 = -1.5;
export var r3 = 2.0;
export var falloff = 2.5; 
export var focus = 1.5;
export var colorVariation = 0.45;
export var blackoutTexture = 0.0;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Classic Red default
export var cp2H = 0.15, cp2S = 1.0, cp2V = 1.0; // Yellow/Orange default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFalloff(v) { falloff = 1.0 + v * 5.0; }
export function sliderFocus(v) { focus = 1.0 + v * 4.0; }
export function sliderColorVariation(v) { colorVariation = v; }
export function sliderBlackoutTexture(v) { blackoutTexture = v; }

var beatPhase = 0.0;
// Continuity: each orbit gets its own time() base so the angle fed into
// sin/cos is exactly time(s)*TAU (period-2π safe across wraps). Previously
// b2 = beatPhase*TAU*r2 with r2=-1.5 jumped by -3π per wrap → cos(b2) flips
// sign every period (visible orbit-2 flicker).
var b1 = 0.0, b2 = 0.0, b3 = 0.0;
// Extra wrap-clean phases for wave() color drifts in render3D (each is a
// non-integer multiple of beatPhase in the original — would jump at wrap).
var beatPhase041 = 0.0, beatPhase073 = 0.0, beatPhase117 = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  beatPhase = time(0.05 / localMultiplier);
  // |r_k| sets rate; sign sets direction. time(s/|r_k|) wraps cleanly.
  // Guard against r=0 (would stall the orbit, not crash) with a small floor.
  var s = 0.05 / localMultiplier;
  var ar1 = max(abs(r1), 0.001);
  var ar2 = max(abs(r2), 0.001);
  var ar3 = max(abs(r3), 0.001);
  b1 = time(s / ar1) * 6.28318 * (r1 >= 0.0 ? 1.0 : -1.0);
  b2 = time(s / ar2) * 6.28318 * (r2 >= 0.0 ? 1.0 : -1.0);
  b3 = time(s / ar3) * 6.28318 * (r3 >= 0.0 ? 1.0 : -1.0);
  beatPhase041 = time(s / 0.41);
  beatPhase073 = time(s / 0.73);
  beatPhase117 = time(s / 1.17);
}

export function render3D(index, wx, wy, wz) {
  var nx = (wx + 1.264) / 3.125;
  var ny = wy / 6.5; 
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ax1 = 0.5 + orbit1 * cos(b1);
  var ay1 = 0.5 + orbit1 * sin(b1);
  
  var ax2 = 0.5 + orbit2 * cos(b2);
  var ay2 = 0.5 + orbit2 * sin(b2);
  
  var ax3 = 0.5 + orbit3 * cos(b3);
  var ay3 = 0.5 + orbit3 * sin(b3);

  var d1 = hypot(nx - ax1, ny - ay1);
  var d2 = hypot(nx - ax2, ny - ay2);
  var d3 = hypot(nx - ax3, ny - ay3);

  var d = min(d1, min(d2, d3));
  var v = pow(max(0.0, min(1.0, 1.0 - d * falloff)), focus);

  var outV = v;
  var outW = 0.0;
  var outA = 0.0;
  
  var influence1 = pow(max(0.0, 1.0 - d1 * falloff), focus);
  var influence2 = pow(max(0.0, 1.0 - d2 * falloff), focus);
  var influence3 = pow(max(0.0, 1.0 - d3 * falloff), focus);
  var influenceTotal = influence1 + influence2 + influence3 + 0.0001;

  var attractorBlend = (influence2 + influence3 * 0.52) / influenceTotal;
  var verticalGradient = ny * 0.24 + nx * 0.10;
  var orbitalGradient = wave((d1 - d2) * 1.7 + d3 * 0.9 + beatPhase041) * 0.22;
  var tVal = max(0.0, min(1.0, attractorBlend * 0.68 + verticalGradient + orbitalGradient));

  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * tVal;
  var sat = cp1S + (cp2S - cp1S) * tVal;
  var maxVal = cp1V + (cp2V - cp1V) * tVal;

  var colorWaveA = wave(nx * 2.7 + ny * 1.9 + beatPhase073);
  var colorWaveB = wave((d1 - d2 + d3) * 1.8 - beatPhase117);
  var orbitHue = (colorWaveA - 0.5) * colorVariation * 0.22;
  var attractorHue = (colorWaveB - 0.5) * colorVariation * 0.12;
  hue += orbitHue + attractorHue + (tVal - 0.5) * colorVariation * 0.10;
  sat = max(0.0, min(1.0, sat - colorVariation * 0.12 + colorWaveB * colorVariation * 0.18));
  maxVal = maxVal * (0.82 + colorVariation * 0.08 + colorWaveA * colorVariation * 0.16);

  var isBar = wy < 1.8;
  var isPar = wy >= 1.8 && wy < 4.0;
  var isVintage = wy >= 4.0;

  if (isBar) {
     // Default
  } 
  else if (isVintage) {
     outW += v * v * 0.6;
     outA += v * 0.4;
  } 
  else if (isPar) {
     outV = v * 0.9;
     outW += max(0.0, 1.0 - (d * 5.0)) * 0.5; 
  }

  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));

  if (blackoutTexture > 0.0) {
    var cell = floor(nx * 17.0 + ny * 29.0 + index * 0.071);
    var maskA = wave(cell * 0.371 + beatPhase * 0.19);
    var maskB = wave((nx - ny) * 3.7 + beatPhase * 0.43);
    var movingCut = pow(maskB, 2.0 + blackoutTexture * 5.0);
    var sparseCut = maskA > (0.72 - blackoutTexture * 0.34) ? 1.0 : 0.0;
    var blackMask = clamp(1.0 - sparseCut * movingCut * blackoutTexture, 0.0, 1.0);
    outV *= blackMask;
    outW *= blackMask;
    outA *= blackMask;
  }
  
  var val = outV * maxVal;
  var h = abs(hue - floor(hue)); 
  var iObj = floor(h * 6);
  var fObj = h * 6 - iObj;
  var pObj = val * (1.0 - sat);
  var qObj = val * (1.0 - fObj * sat);
  var tObj = val * (1.0 - (1.0 - fObj) * sat);
  var r = 0, g = 0, b = 0;
  iObj = iObj % 6;
  if (iObj == 0)      { r = val; g = tObj; b = pObj; }
  else if (iObj == 1) { r = qObj; g = val; b = pObj; }
  else if (iObj == 2) { r = pObj; g = val; b = tObj; }
  else if (iObj == 3) { r = pObj; g = qObj; b = val; }
  else if (iObj == 4) { r = tObj; g = pObj; b = val; }
  else                { r = val; g = pObj; b = qObj; }

  rgbwau(r, g, b, outW, outA, 0.0);
}
