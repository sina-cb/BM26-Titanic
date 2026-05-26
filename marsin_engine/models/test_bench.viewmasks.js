// View-mask sidecar for the Test Bench model.
//
// This sidecar defines composite view masks for the test bench.
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
    name:  'ParsAndBars',
    bit:   0x05,                       // ParLights | BarLights
    pixelIndices: [...range(0, 3), ...range(16, 51)],
  },
];
