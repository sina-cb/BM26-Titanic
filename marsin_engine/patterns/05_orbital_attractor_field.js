/*
  05_orbital_attractor_field.js
  Orbital Attractor Field
*/

export var speedTrim = 0.5;
export var orbit1 = 0.4;
export var orbit2 = 0.5;
export var orbit3 = 0.3;
export var r1 = 1.0;
export var r2 = -1.5;
export var r3 = 2.0;
export var falloff = 2.5; 
export var focus = 1.5;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Classic Red default
export var cp2H = 0.15, cp2S = 1.0, cp2V = 1.0; // Yellow/Orange default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderFalloff(v) { falloff = 1.0 + v * 5.0; }
export function sliderFocus(v) { focus = 1.0 + v * 4.0; }

var beatPhase = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  beatPhase = time(0.05 / localMultiplier); 
}

export function render3D(index, wx, wy, wz) {
  var nx = (wx + 1.264) / 3.125;
  var ny = wy / 6.5; 
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var b1 = beatPhase * 6.28318 * r1;
  var b2 = beatPhase * 6.28318 * r2;
  var b3 = beatPhase * 6.28318 * r3;

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
  
  var tVal = 0.5;
  if (d == d1) {
    tVal = 0.0;
  } else if (d == d2) {
    tVal = 1.0;
  }

  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * tVal;
  var sat = cp1S + (cp2S - cp1S) * tVal;
  var maxVal = cp1V + (cp2V - cp1V) * tVal;

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
