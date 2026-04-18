/*
  12_breathing.js
  Enhanced Synchronized Breathing
  Transforms a basic sine wave into an advanced, tension-building heartbeat 
  with optional rippling geometry arrays!
*/

export var speed = 0.05;
export var baseHue = 0.0;
export var spatialOffset = 0.0; // 0 = perfectly uniform breathing, >0 = rippling wave across the array
export var breathSharpness = 1.0; // Alters the sine curve into sharp pulsing spikes (heartbeats)

export function sliderSpeed(v) { speed = 0.01 + v * 0.15; }
export function hsvPickerColor(h,s,v) { baseHue = h; }
export function sliderRipple(v) { spatialOffset = v * 2.0; }
export function sliderSharpness(v) { breathSharpness = 1.0 + v * 8.0; }

var t1;
export function beforeRender(delta) {
  t1 = time(speed);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  // Calculate core breathing matrix
  var v = wave(t1 + (pct * spatialOffset));
  
  // Apply exponent sharpness to alter the curve from a smooth sine 
  // into an aggressive striking tension drop!
  v = pow(v, breathSharpness);
  
  hsv(baseHue, 1.0, v);
}
