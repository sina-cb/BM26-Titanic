// Auto-generated view-mask sidecar for the titanic model — do not edit manually.
// Source of truth: the simulation scene (Views panel → scenes/titanic/views.yaml).
// Updated: 2026-08-11T19:40:35.447Z
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1).

export const groupBits = {
  'Left Back Wall': 0x00000010,
  'Left Front Wall': 0x00000040,
  'Left_Front_Left': 0x00000400,
  'Left_Back_Left': 0x00000800,
  'Left_Back_Right': 0x00001000,
  'Left_Front_Right': 0x00002000,
  'Right_Back_Left': 0x00004000,
  'Right_Back_Right': 0x00008000,
  'Right_Front_Right': 0x00010000,
  'Right_Front_Left': 0x00020000,
  'TE Sign': 0x00100000,
  'Right SmokeStacks': 0x00000002,
  'Left Small SmokeStack': 0x00200000,
  'Right Small SmokeStack': 0x00400000,
  'Right Front Wall': 0x00000001,
  'Right Front Rails': 0x00000004,
  'Right Auditorium': 0x00000008,
  'Left Auditorium': 0x00000200,
  'Right Back Wall': 0x00000020,
  'Left SmokeStack': 0x00000080,
  'Left Front Rails': 0x00000100,
  'Right Back Rails': 0x04000000,
  'Left Back Rails': 0x08000000,
  'TE Sign 2': 0x00800000,
};

export const viewMasks = [
  { name: 'Hull Canvas', bit: 0x0400, word: 1, groups: ['Left Front Wall', 'Left Back Wall', 'Right Front Wall', 'Right Back Wall'] },
  { name: 'Silhouette', bit: 0x2000, word: 1, groups: ['Left_Front_Left', 'Left_Front_Right', 'Left_Back_Left', 'Left_Back_Right', 'Right_Front_Left', 'Right_Front_Right', 'Right_Back_Left', 'Right_Back_Right'] },
  { name: 'Jewelry', bit: 0x10000, word: 1, groups: ['Left Front Rails', 'Left Back Rails', 'Right Front Rails', 'Right Back Rails'] },
  { name: 'Organs', bit: 0x0004, word: 1, groups: ['Left SmokeStack', 'Left Small SmokeStack', 'Right SmokeStacks', 'Right Small SmokeStack', 'Left Auditorium', 'Right Auditorium'] },
  { name: 'Identity', bit: 0x0020, word: 1, groups: ['TE Sign', 'TE Sign 2'] },
  { name: 'Stacks', bit: 0x0040, word: 1, groups: ['Left SmokeStack', 'Left Small SmokeStack', 'Right SmokeStacks', 'Right Small SmokeStack'] },
  { name: 'Auditoriums', bit: 0x0200, word: 1, groups: ['Left Auditorium', 'Right Auditorium'] },
];
