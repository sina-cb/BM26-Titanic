/*
  calib_swipe_left_right.js — CALIBRATION pattern.

  A sharp band sweeps along the world X axis (LEFT → RIGHT). Use it to verify
  the 2D Pixel Map placement matches the physical / 3D layout: the lit band must
  read as ONE clean line gliding smoothly left→right in BOTH the 3D view and the
  2D map. If a fixture is mis-placed in the 2D layout, its pixels fall out of the
  moving line and scatter — that's your cue to nudge it in Edit mode.

  The band is hue-tinted by X (cyan at left → amber at right) so direction and
  full extent are obvious, and the whole rig keeps a faint floor so every pixel
  stays visible for placement checking. Coordinates x/y/z are engine-normalized
  0..1.
*/

export var localSpeed = 0.001;   // sweep rate (0 = slow creep … 1 = fast)
export var bandW = 0.05;        // band half-width as a fraction of the axis

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBandW(v) { bandW = 0.02 + v * 0.18; }

var MAX_RATE = 0.5;             // sweeps/sec at localSpeed = 1
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
  var d = abs(x - phase);
  var bri = 0.0;
  if (d < bandW) bri = 0.5 + 0.5 * cos(d / bandW * PI);   // crisp cosine core
  var base = 0.05;                                        // faint floor
  var v = bri; if (v < base) v = base;
  var h = 0.5 + (0.08 - 0.5) * x;                         // cyan(left) → amber(right)
  hsv(h, 1.0 - 0.25 * bri, v);
}
