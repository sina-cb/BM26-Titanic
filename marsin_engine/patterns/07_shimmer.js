/*
  07_shimmer.js
  Shimmering Glow
*/

export var localSpeed = 0.5;
export var shimmerSpeedTrim = 0.5;
export var shimmerDensity = 10.0;
export var breathingInt = 0.4;
export var minBrightness = 0.2;

export var cp1H = 0.1, cp1S = 1.0, cp1V = 1.0; // Base wash default (warm yellow)
export var cp2H = 0.2, cp2S = 1.0, cp2V = 1.0; // Shimmer glints default (white/amber hues)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShimmerSpeedTrim(v) { shimmerSpeedTrim = v; }
export function sliderDensity(v) { shimmerDensity = 2.0 + v * 30.0; }
export function sliderBreathing(v) { breathingInt = v; }

var tBreathing;
var tShimmer;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var localShimmerMultiplier = pow(2.0, (shimmerSpeedTrim - 0.5) * 11.0);
  tBreathing = time(0.1 / localMultiplier);
  tShimmer = time(0.12 / localShimmerMultiplier);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var sWave = wave(pct * shimmerDensity - tShimmer);
  sWave = pow(sWave, 3);
  
  var bWave = wave(pct + tBreathing);
  var intensity = minBrightness + (bWave * breathingInt);
  
  var shimmerContribution = sWave * 0.4;
  var totalVal = intensity + shimmerContribution;
  totalVal = max(0.0, min(1.0, totalVal));
  
  var tVal = totalVal > 0.0 ? (shimmerContribution / totalVal) : 0.0;
  
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var finalHue = cp1H + dh * tVal;
  var finalSat = cp1S + (cp2S - cp1S) * tVal;
  var maxVal = cp1V + (cp2V - cp1V) * tVal;
  
  hsv(finalHue - floor(finalHue), finalSat, totalVal * maxVal);
}
