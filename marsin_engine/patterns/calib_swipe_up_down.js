/*
  calib_swipe_up_down.js — CALIBRATION pattern.

  A sharp band sweeps along the world Z axis — the 2D Pixel Map's VERTICAL axis
  in the default top-down projection, so it reads as UP ↔ DOWN on screen (and as
  bow↔stern depth in 3D). Pair it with calib_swipe_left_right to confirm the 2D
  layout is aligned on BOTH axes: the band must glide as one clean line. Pixels
  that break away from the line belong to a fixture that needs re-placing in
  Edit mode.

  Hue-tinted by Z (green near → magenta far) with a faint floor so the whole
  rig stays visible. Coordinates x/y/z are engine-normalized 0..1.
*/

export var localSpeed = 0.35;   // sweep rate (0 = slow creep … 1 = fast)
export var bandW = 0.05;        // band half-width as a fraction of the axis

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBandW(v) { bandW = 0.02 + v * 0.18; }

var MAX_RATE = 0.5;
var phase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var mult = pow(2.0, (localSpeed - 0.5) * 4.0);
  phase = phase + dt * mult * MAX_RATE;
  phase = phase - floor(phase);
}

export function render3D(index, x, y, z) {
  var d = abs(z - phase);
  var bri = 0.0;
  if (d < bandW) bri = 0.5 + 0.5 * cos(d / bandW * PI);
  var base = 0.05;
  var v = bri; if (v < base) v = base;
  var h = 0.33 + (0.92 - 0.33) * z;                        // green(near) → magenta(far)
  hsv(h, 1.0 - 0.25 * bri, v);
}
