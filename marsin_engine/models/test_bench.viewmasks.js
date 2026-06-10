// View-mask sidecar for the Test Bench model.
//
// This sidecar defines composite view masks for the test bench.
// Base groups get their bits dynamically from the engine at load time
// (docs/13 §4.5.1); composites reference those groups BY NAME so they
// survive model regeneration and group renames.

export const viewMasks = [
  // ── Composite presets ───────────────────────────────────────────
  {
    name:   'ParsAndBars',
    groups: ['ParLights', 'BarLights'],
  },
];
