// Auto-generated view-mask sidecar for the summer_camp_logsville model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/summer_camp_logsville/views.yaml).
// Updated: 2026-06-10T19:55:08.246Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'TowerBars': 0x00000001,
  'TowerVintageLights': 0x00000002,
  'DJ Lights': 0x00000004,
  'WallVintageLights': 0x00000008,
  'Redwoods1': 0x00000010,
  'Redwoods2': 0x00000020,
  'Redwoods3': 0x00000100,
  'WallVintageLightsTop': 0x00000200,
  'LedBarsWall': 0x00000400,
};

export const viewMasks = [
  { name: 'RedwoodPARs', bit: 0x0040, groups: ['Redwoods1', 'Redwoods2', 'Redwoods3'] },
  { name: 'VintageOnly', bit: 0x0080, groups: ['TowerVintageLights', 'WallVintageLights', 'WallVintageLightsTop'] },
];
