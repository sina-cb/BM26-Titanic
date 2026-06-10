// View-mask sidecar for the Summer Camp Dome model.
//
// This sidecar defines composite view masks for the dome.
// Base groups get their bits dynamically from the engine at load time
// (docs/13 §4.5.1); composites reference those groups BY NAME so they
// survive model regeneration and group renames.

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
