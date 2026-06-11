// Auto-generated view-mask sidecar for the summer_camp_dome model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/summer_camp_dome/views.yaml).
// Updated: 2026-06-10T19:52:47.564Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'TriangleEdges': 0x00000001,
  'TrianglePars': 0x00000002,
  'BarLights': 0x00000004,
  'VintageLights': 0x00000008,
};

export const viewMasks = [
  { name: 'Apex', bit: 0x0010, groups: ['TriangleEdges', 'TrianglePars'] },
  { name: 'AllButApex', bit: 0x0020, groups: ['BarLights', 'VintageLights'] },
];
