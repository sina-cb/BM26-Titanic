// View-mask sidecar for the Summer Camp Dome model.
//
// This sidecar defines composite view masks for the dome.
// Base groups are automatically mapped to bits by the engine at boot time.

/** Inclusive range [start, end]. */
function range(start, end) {
  const arr = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

export const viewMasks = [
  // ── Composite presets ───────────────────────────────────────────
  {
    name:  'Apex',
    bit:   0x03,                       // TriangleEdges | TrianglePars
    pixelIndices: range(0, 56),
  },
  {
    name:  'AllButApex',
    bit:   0x0C,                       // BarLights | VintageLights (all but apex)
    pixelIndices: range(57, 320),
  },
];
