// DRAFT — pending operator review
/*
  70_calibration_fixture_types.js — CALIBRATION diagnostic utility.

  Gives each canonical fixture role a fixed colour so wrong fixture metadata is
  visible at a glance on every model:
    strands/raw LED = cyan, pars = green, Vintage = gold, bars = red,
    haze = blue, fog = violet, TE signs = magenta.

  Canonical fixture type ids are append-only engine metadata. Numeric ids are
  used deliberately here so this diagnostic compiles on scenes that do not
  contain every FIX_* role; referencing an absent FIX_* is a hard compile
  error. An unknown/untyped role renders white as a visible metadata fault.

  This is static test content, not a production show pattern: no motion and no
  localSpeed. Fixed diagnostic colours are a deliberate palette opt-out.

  CONTROLS
    - level : overall brightness without changing the role colours.
*/

export var level = 0.80;
export function sliderLevel(v) { level = v; }

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function render3D(index, x, y, z) {
  var outLevel = clamp01(level);

  if (fixtureType == 1) {
    rgb(0.0, outLevel, outLevel);                 // strands / raw LED
  } else if (fixtureType == 2) {
    rgb(0.0, outLevel, 0.0);                      // pars
  } else if (fixtureType == 3) {
    rgb(outLevel, outLevel * 0.32, 0.0);          // Vintage
  } else if (fixtureType == 4) {
    rgb(outLevel, 0.0, 0.0);                      // bars
  } else if (fixtureType == 5) {
    rgb(0.0, 0.15 * outLevel, outLevel);          // haze
  } else if (fixtureType == 6) {
    rgb(0.45 * outLevel, 0.0, outLevel);          // fog
  } else if (fixtureType == 7) {
    rgb(outLevel, 0.0, outLevel);                 // TE signs
  } else {
    rgb(outLevel, outLevel, outLevel);            // visible metadata fault
  }
}
