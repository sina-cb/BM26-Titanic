// View-mask sidecar for the Summer Camp Logsville model.
//
// `groupBits` pins the base group → bit contract pattern code compiles
// against; the engine validates it against the loaded model and fails
// loudly on drift (docs/13 §4.5.1). Membership for the presets is
// declared BY GROUP NAME so it survives model regeneration — the
// previous pixelIndices version went stale when the model was
// re-exported (it tagged LedBarsWall pixels as 'VintageOnly').
//
// The two presets keep EXPLICIT bits on purpose: the Logsville pattern
// family hardcodes them as constants (`var MASK_REDWOOD_PARS = 64;` /
// `var MASK_VINTAGE_ONLY = 128;` in patterns 70–117), so the values
// are part of the pattern API. The engine reserves these bits, so the
// base groups below must route around 0x40/0x80.

export const groupBits = {
  'TowerBars':            0x001,
  'TowerVintageLights':   0x002,
  'DJ Lights':            0x004,
  'WallVintageLights':    0x008,
  'Redwoods1':            0x010,
  'Redwoods2':            0x020,
  // 0x040 / 0x080 reserved by RedwoodPARs / VintageOnly below.
  'Redwoods3':            0x100,
  'WallVintageLightsTop': 0x200,
  'LedBarsWall':          0x400,
};

export const viewMasks = [
  // ── Explicit-bit presets (bit values hardcoded in patterns) ─────
  {
    name:   'RedwoodPARs',
    bit:    0x040,
    groups: ['Redwoods1', 'Redwoods2', 'Redwoods3'],
  },
  {
    name:   'VintageOnly',
    bit:    0x080,
    groups: ['TowerVintageLights', 'WallVintageLights', 'WallVintageLightsTop'],
  },
];
