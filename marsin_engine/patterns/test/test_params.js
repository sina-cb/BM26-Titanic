/*
  Benchmark + UI Params
*/
export var speed = 0.5;
export var reverse = 0;
export var hue = 0.0;
export var sat = 1.0;
export var val = 1.0;
export var is_breathing = 0;
export var hold_flash = 0;
export var flash_speed = 0.05;

export function sliderSpeed(v) { speed = v * 10; }
export function sliderFlashSpeed(v) { flash_speed = 0.05 - (v * 0.045); }
export function toggleReverse(state) { reverse = state; }
export function hsvPickerColor(h, s, v) { hue = h; sat = s; val = v; }
export function toggleBreathing(state) { is_breathing = state; }
export function toggleHoldFlash(state) { hold_flash = state; }

var t1;
var phase;

export function beforeRender(delta) {
  t1 = time(0.1); 
  phase = t1 * speed;
}

export function render(index) {
  var pos = index * 0.2;

  // Use the calculated phase with optional reverse
  var currentPhase = phase;
  if (reverse > 0.5) currentPhase = -phase;
  
  var w = sin(pos - currentPhase);
  var b = (w + 1) / 2;
  
  // Sharpness and line width
  b = pow(b, 5);
  b = b * 2;
  if (b > 1) b = 1;

  // Modulate b by value and breathing
  var outputVal = b * val;
  if (is_breathing > 0.5) {
     outputVal *= wave(time(0.05));
  }
  
  // Flash overlay (adjustable speed strobe restricted to active geometry)
  if (hold_flash > 0.5) {
     var strobe_state = (time(flash_speed) % 0.1 < 0.05) ? 1 : 0;
     // Only flash pixels that are already illuminated by the wave
     outputVal = (outputVal > 0.1) ? strobe_state : 0; 
  }

  hsv(hue, sat, outputVal);
}
