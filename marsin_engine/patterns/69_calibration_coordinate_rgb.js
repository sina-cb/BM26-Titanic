// DRAFT — pending operator review
/*
  69_calibration_coordinate_rgb.js — CALIBRATION diagnostic utility.

  Encodes normalized world position directly as colour: R = X, G = Y, B = Z.
  Nearby pixels should therefore have nearby colours, and a fixture placed on
  the wrong side, height, or depth of the model becomes immediately obvious.

  This is intentionally static test content, not a production show pattern:
  there is no motion and therefore no localSpeed. Fixed diagnostic colour is a
  deliberate palette opt-out. It uses no views or fixture assumptions and is
  portable to every model with normalized 3D coordinates.

  CONTROLS (declaration order = MIDI order)
    - level : overall diagnostic brightness.
    - floor : minimum RGB contribution, keeping zero-coordinate edges visible.
*/

export var level = 0.80;
export var floorLevel = 0.05;

export function sliderLevel(v) { level = v; }
export function sliderFloor(v) { floorLevel = v; }

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function render3D(index, x, y, z) {
  var outLevel = clamp01(level);
  var outFloor = clamp01(floorLevel) * 0.35;
  var span = 1.0 - outFloor;

  rgb((outFloor + clamp01(x) * span) * outLevel,
      (outFloor + clamp01(y) * span) * outLevel,
      (outFloor + clamp01(z) * span) * outLevel);
}
