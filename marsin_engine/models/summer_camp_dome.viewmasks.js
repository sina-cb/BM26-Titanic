// View-mask sidecar for the Summer Camp Dome model.
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1). Dome patterns 40/44 hardcode these
// values (`viewMask & 1` = TriangleEdges, etc.) — do not renumber
// without updating them. Composites reference groups BY NAME so they
// survive model regeneration.

export const groupBits = {
  'TriangleEdges': 0x01,
  'TrianglePars':  0x02,
  'BarLights':     0x04,
  'VintageLights': 0x08,
};

export const viewMasks = [
  // ── Composite presets ───────────────────────────────────────────
  {
    name:   'Apex',
    groups: ['TriangleEdges', 'TrianglePars'],
  },
  {
    name:   'AllButApex',
    groups: ['BarLights', 'VintageLights'],
  },
];
