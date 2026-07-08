// Auto-generated view-mask sidecar for the studio_top_loft model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/studio_top_loft/views.yaml).
// Updated: 2026-07-07T16:50:39.015Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'Left Vintage': 0x00000001,
  'Back Vintage': 0x00000002,
  'Right Vintage': 0x00000004,
  'Left Bar': 0x00000008,
  'Back Bar': 0x00000010,
  'Right Bar': 0x00000020,
};

export const viewMasks = [
  { name: 'vintages', bit: 0x0040, groups: ['Left Vintage', 'Back Vintage', 'Right Vintage'] },
  { name: 'bars', bit: 0x0080, groups: ['Left Bar', 'Back Bar', 'Right Bar'] },
];
