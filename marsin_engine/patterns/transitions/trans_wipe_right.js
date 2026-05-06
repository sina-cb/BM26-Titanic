/*
  trans_wipe_right.js — Horizontal Wipe (Right to Left)
  Spatial wipe across x axis with feathered edge.
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  var edge = 1.0 - smoothstep(progress - feather, progress + feather, x);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
