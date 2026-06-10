// View-mask sidecar for the Summer Camp Logsville model.
//
// This sidecar defines composite view masks for Logsville.
// Base groups get their bits dynamically from the engine at load time
// (docs/13 §4.5.1). Membership is declared BY GROUP NAME so it survives
// model regeneration — the previous pixelIndices version went stale
// when the model was re-exported (it tagged LedBarsWall pixels as
// 'VintageOnly').
//
// The two presets below keep EXPLICIT bits on purpose: the Logsville
// pattern family hardcodes them as constants (`var MASK_REDWOOD_PARS =
// 64;` / `var MASK_VINTAGE_ONLY = 128;` in patterns 70–117), so the
// values are part of the pattern API. The engine reserves these bits
// before assigning base-group bits, so they can never collide.
// Do not change them without updating every pattern that references them.

export const viewMasks = [
  // ── Explicit-bit presets (bit values hardcoded in patterns) ─────
  {
    name:   'RedwoodPARs',
    bit:    0x0040,
    groups: ['Redwoods1', 'Redwoods2', 'Redwoods3'],
  },
  {
    name:   'VintageOnly',
    bit:    0x0080,
    groups: ['TowerVintageLights', 'WallVintageLights', 'WallVintageLightsTop'],
  },
];
