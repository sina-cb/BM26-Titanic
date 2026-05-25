/*
  trans_wipe_down.js — Vertical Wipe (reveal sweeps top -> bottom)
  Spatial wipe across y axis with feathered edge: the new pattern
  is uncovered starting at y=1 and the boundary travels downward
  as progress ramps 0 -> 1.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  var edge = smoothstep(1.0 - progress - feather, 1.0 - progress + feather, y);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
