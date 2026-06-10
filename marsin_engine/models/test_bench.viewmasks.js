// Auto-generated view-mask sidecar for the test_bench model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/test_bench/views.yaml).
// Updated: 2026-06-10T23:51:05.727Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'ParLights': 0x00000001,
  'VintageLights': 0x00000002,
  'BarLights': 0x00000004,
};

export const viewMasks = [
  { name: 'Test', bit: 0x0008, groups: ['ParLights', 'BarLights'] },
  { name: 'Test2', bit: 0x0010, groups: ['BarLights'] },
];
