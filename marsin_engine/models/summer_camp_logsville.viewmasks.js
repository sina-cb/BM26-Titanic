// View-mask sidecar for the Summer Camp Logsville model.
//
// This sidecar defines composite view masks for Logsville.
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
    name: 'RedwoodPARs',
    bit:  0x0040,
    pixelIndices: range(204, 221),
  },
  {
    name: 'VintageOnly',
    bit:  0x0080,
    pixelIndices: range(144, 203),
  },
];