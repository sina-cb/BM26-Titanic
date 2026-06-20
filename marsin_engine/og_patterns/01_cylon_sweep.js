/*
  01_cylon_sweep.js
  Classic Cylon/Scanner Sweep
*/

export var localSpeed = 0.5;
export var eyeWidth = 0.15;
export var bgBrightness = 0.05;
export var globalDir = 1.0;

// audio_brightness: playlist binds a CPC source here (e.g. micLow). At 0 the
// pattern renders identically to before; at 1.0 the rgb output is scaled by
// up to ~2.5x (rgb() clamps anything that saturates). Codex P0: no fallback —
// at slider 0 there's simply no audio boost, the rest of the pattern is
// unchanged. Prototype for the catalog-wide audio_brightness convention.
export var audioBrightness = 0.0;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Classic Red default
export var cp2H = 0.6, cp2S = 1.0, cp2V = 0.5; // Blue background default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
// `size` and `direction` were CPC globals through May 2026; now
// they're pattern-local so the CaptainPad per-pattern panel surfaces
// them as proper sliders. SIZE is engine-owned now (acts on coords),
// so the eye-width control is renamed to be its own local slider.
export function sliderBeamWidth(v) { eyeWidth = 0.05 + v * 0.3; }
export function sliderBackgroundGlow(v) { bgBrightness = v * 0.3; }
export function sliderDirection(v) { globalDir = (v * 2.0) - 1.0; }
export function sliderAudioBrightness(v) { audioBrightness = v; }

var scanT = 0.0;

// ── Palette RGB cache (strict cp1<->cp2 blending) ─────────────────────
// Pre-convert cp1/cp2 (HSV) to RGB once per frame, then lerp in RGB-space
// in the per-pixel path. This guarantees output stays on the straight line
// between the two pickers (e.g. red+blue -> only red/magenta/blue, no
// green/yellow/cyan drift from HSV shortest-path interpolation).
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var phaseIncrement = (delta / 65536.0) / (0.05 / localMultiplier);
  scanT = (scanT + phaseIncrement * globalDir) % 1.0; 
  if (scanT < 0) scanT += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var normX = (x + 0.4) / 2.02;
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;
  
  var scannerFocus = triangle(scanT); 
  var dist = abs(normX - scannerFocus);
  
  var intensity = 0.0;
  if (dist < eyeWidth) {
     intensity = 1.0 - (dist / eyeWidth);
     intensity = pow(intensity, 2.0);
  }
  
  // Strict palette: linear-RGB lerp between cp2 (background) and cp1 (beam)
  // — produces ONLY colours that lie on the straight line in RGB-space
  // between the two pickers (e.g. red+blue -> red/magenta/blue, no purple
  // chroma drift, no green).
  var bgScale = bgBrightness;
  var r = (pr2 * bgScale) + (pr1 - pr2 * bgScale) * intensity;
  var g = (pg2 * bgScale) + (pg1 - pg2 * bgScale) * intensity;
  var b = (pb2 * bgScale) + (pb1 - pb2 * bgScale) * intensity;

  // audio_brightness gain — multiplicative pump on the final colour. At 0 this
  // is a no-op (1.0x); at full slider (1.0) the rgb output is scaled by 2.5x
  // and rgb() clamps anything beyond saturation. Prototype that other
  // patterns will copy once we like the feel.
  var audioGain = 1.0 + audioBrightness * 1.5;
  rgb(r * audioGain, g * audioGain, b * audioGain);
}