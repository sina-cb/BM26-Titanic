// View-mask sidecar for the Test Bench model.
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1). Composites reference groups BY
// NAME so they survive model regeneration.

export const groupBits = {
  'ParLights':     0x01,
  'VintageLights': 0x02,
  'BarLights':     0x04,
};

export const viewMasks = [
  // ── Composite presets ───────────────────────────────────────────
  {
    name:   'ParsAndBars',
    groups: ['ParLights', 'BarLights'],
  },
];
