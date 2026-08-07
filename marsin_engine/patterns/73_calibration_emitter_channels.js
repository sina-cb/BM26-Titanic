// DRAFT — pending operator review
/*
  73_calibration_emitter_channels.js — CALIBRATION diagnostic utility.

  Drives exactly one logical emitter family across the model. Use it after any
  DMX/wire change to confirm channel order, missing emitters, and white/UV
  capability. `channel` selects six discrete modes:
    0 red, 1 green, 2 blue, 3 matched W+A white, 4 UV, 5 RGB white.

  Fixtures without the selected physical emitter correctly remain dark. The
  dedicated-white mode always drives W and A byte-identically, preserving the
  project's white convention on RGBWAU fixtures while RGBW fixtures consume W.

  This is intentionally static test content, not a production show pattern:
  no motion, no localSpeed, and fixed diagnostic colours.

  CONTROLS
    - channel : discrete logical emitter selection.
    - level   : selected emitter intensity.
*/

export var channel = 0.0;
export var level = 0.80;

export function sliderChannel(v) { channel = v; }
export function sliderLevel(v) { level = v; }

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function render3D(index, x, y, z) {
  var mode = floor(clamp01(channel) * 5.999);
  var outLevel = clamp01(level);
  var outR = 0.0;
  var outG = 0.0;
  var outB = 0.0;
  var outW = 0.0;
  var outU = 0.0;

  if (mode == 0) outR = outLevel;
  else if (mode == 1) outG = outLevel;
  else if (mode == 2) outB = outLevel;
  else if (mode == 3) outW = outLevel;
  else if (mode == 4) outU = outLevel;
  else {
    outR = outLevel;
    outG = outLevel;
    outB = outLevel;
  }

  rgbwau(outR, outG, outB, outW, outW, outU);
}
