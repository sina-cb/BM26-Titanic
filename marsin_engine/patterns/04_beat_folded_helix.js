/*
  04_beat_folded_helix.js
  Beat-Folded Pseudo-3D Helix Tunnel
*/

export var localSpeed = 0.5;
export var armCount = 3.0;
export var twistFreq = 4.0;
export var contrast = 1.5;
export var overallBrightness = 1.0;

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0; // Cyan default
export var cp2H = 0.0, cp2S = 1.0, cp2V = 1.0; // Red default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
// Local sliders post-May 2026 (size is now engine-owned).
export function sliderCount(v) { armCount = 1.0 + floor(v * 12.0); }
export function sliderTwistFreq(v) { twistFreq = -10.0 + v * 40.0; }
export function sliderContrast(v) { contrast = 0.5 + v * 9.0; }
export function sliderOverallBrightness(v) { overallBrightness = v; }

var masterTime = 0;
var tunnelZ = 0;
var spinPhase = 0;
var beatPulse = 0;

export function beforeRender(delta) {
  var d = delta > 0.0 ? delta : 25.0; 
  masterTime += d / 1000.0;
  
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dSpeed = 0.05 * localMultiplier;
  
  tunnelZ = masterTime * (dSpeed * 120.0);
  spinPhase = masterTime * (dSpeed * 40.0);
  
  var beatFrac = (masterTime * dSpeed * 40.0);
  beatFrac = beatFrac - floor(beatFrac);
  beatPulse = (beatFrac < 0.1) ? 1.0 : 0.0;
}

export function render3D(index, wx, wy, wz) {
  var cx = 0.0;
  if (wx < 0.6) {
    cx = -(0.6 - wx) * 0.5376;
  } else {
    cx = (wx - 0.6) * 0.7936;
  }
  
  var ny = max(0.0, min(1.0, wy / 6.5));
  var cy = ny - 0.45; 
  
  var ang = atan2(cy, cx); 
  var dist = hypot(cx, cy);
  dist = max(0.02, dist);
  
  var depth = (1.0 / dist);
  var helixPhase = (ang * armCount) + (depth * twistFreq - tunnelZ + spinPhase) * PI2;
  var field = sin(helixPhase);
  
  var v = max(0.0, field);
  v = pow(v, contrast);
  
  var isBar = wy < 1.8;
  var isPar = wy >= 1.8 && wy < 4.0;
  var isVintage = wy >= 4.0;
  
  var outV = 0.0;
  var outW = 0.0;
  var outA = 0.0;
  
  if (isBar) {
     outV = v * 1.5;
     outV *= min(1.0, dist * 3.0); 
  } 
  else if (isPar) {
     outV = v * 0.6;
     if (beatPulse > 0.0 && field > 0.0) {
       outV = 1.0;
       outW = 0.8;
     }
  }
  else if (isVintage) {
     outV = v;
     outW = v * beatPulse * 0.6; 
     outA = v * 0.4;
  }

  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));
  
  var colorBlend = wave(depth * 0.2 + (helixPhase * 0.1) / PI2);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * colorBlend;
  var sat = cp1S + (cp2S - cp1S) * colorBlend;
  var maxVal = cp1V + (cp2V - cp1V) * colorBlend;

  var val = outV * maxVal;
  var h_val = abs(hue - floor(hue)); 
  var iObj = floor(h_val * 6);
  var fObj = h_val * 6 - iObj;
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

  rgbwau(
    r * overallBrightness,
    g * overallBrightness,
    b * overallBrightness,
    outW * overallBrightness,
    outA * overallBrightness,
    0.0
  );
}
