/*
  13_sparkle.js
  Distributed Section Sparkle
*/

export var speedTrim = 0.5;
export var sparkleSpeedTrim = 0.5;
export var sparkleDensity = 0.4; 

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Section 1/Pars (Red default)
export var cp2H = 0.5, cp2S = 1.0, cp2V = 1.0; // Section 2/Vintage (Blue default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderSparkleSpeedTrim(v) { sparkleSpeedTrim = v; }
export function sliderSparkleDensity(v) { sparkleDensity = 0.1 + v * 0.8; }

var tFade;
var tSparkle;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  var localSparkleMultiplier = pow(2.0, (sparkleSpeedTrim - 0.5) * 4.0);
  tFade = time(0.02 / localMultiplier);
  tSparkle = time(0.01 / localSparkleMultiplier);
}

export function render3D(index, x, y, z) {
  var h = cp1H; 
  var s = cp1S;
  var maxVal = cp1V;

  if (sectionId == 2) {
    h = cp2H;
    s = cp2S;
    maxVal = cp2V;
  } else if (sectionId == 3) {
    var dh = cp2H - cp1H;
    if (dh > 0.5) dh -= 1.0;
    else if (dh < -0.5) dh += 1.0;
    h = cp1H + dh * 0.5;
    s = 0.5 * (cp1S + cp2S);
    maxVal = 0.5 * (cp1V + cp2V);
  }
  
  var bgAlpha = wave(tFade + (sectionId * 0.2)); 
  
  var seed = index * 73.137 + tSparkle * 1000.0;
  var sparkle = sin(seed) * sin(seed * 3.7) * sin(seed * 7.3);
  sparkle = sparkle * sparkle * sparkle * sparkle;
  
  if (sparkle > sparkleDensity) {
     var intensity = (sparkle - sparkleDensity) * 3.0;
     if (intensity > 1.0) intensity = 1.0;
     
     var sh = cp2H;
     var ss = cp2S * (1.0 - intensity);
     var sv = cp2V * intensity;
     hsv(sh - floor(sh), ss, sv);
  } else {
     hsv(h - floor(h), s, bgAlpha * 0.5 * maxVal);
  }
}
