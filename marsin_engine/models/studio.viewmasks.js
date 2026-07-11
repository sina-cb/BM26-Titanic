// Auto-generated view-mask sidecar for the studio model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/studio/views.yaml).
// Updated: 2026-07-11T21:34:31.175Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'Bars_3_4': 0x00000001,
  'Bars_5_6_7': 0x00000004,
  'Bars_0_1_2': 0x00000008,
  'Bars_8_9': 0x00000002,
  'Vintage_0_1_2_3': 0x00000010,
  'Vintage_4_5_6_7': 0x00000020,
  'Vintage_8_9_10_11': 0x00000040,
  'Strand 1': 0x00000100,
};

export const viewMasks = [
  { name: 'LeftSide', bit: 0x0080, groups: ['Bars_0_1_2', 'Vintage_0_1_2_3'] },
];
