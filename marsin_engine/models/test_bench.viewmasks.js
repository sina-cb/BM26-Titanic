// Named view-mask presets for the test_bench rig.
//
// This file is the SIDECAR companion to the auto-generated
// `test_bench.js` model. The model file gets regenerated from the
// simulator and would clobber any hand-edited `viewMasks` /
// per-pixel `vMask`, so we declare both here instead. The engine
// (marsin_engine/engine.js → loadModel) OR-merges each entry's
// `pixelIndices` into the corresponding `pixels[i].vMask` at boot,
// then exposes the name+bit table via /model/view-selection-options
// so the CaptainPad mixer strip can list these in its view-selection
// picker. See docs/27 §3.1 and docs/13 §4.
//
// Pixel-index legend for test_bench (52 pixels total):
//   0–3     ParLights      (UkingPar × 4)
//   4–9     Vintage Left   (VintageLed × 6 sub-pixels)
//   10–15   Vintage Right  (VintageLed × 6 sub-pixels)
//   16–33   Bar Left       (ShehdsBar × 18 sub-pixels)
//   34–51   Bar Right      (ShehdsBar × 18 sub-pixels)
//
// Conventions:
//   * Bits are 1-hot (0x01, 0x02, 0x04, ...) so view masks can be
//     unioned (a pixel may belong to multiple views). The 16-bit
//     budget per docs/13 §4 leaves plenty of room for show-time
//     additions.
//   * Names are PascalCase short labels — they render uppercased in
//     the CaptainPad picker so keep them readable when SHOUTED.

export const viewMasks = [
  {
    // Just the four UkingPar lights — handy when you want a pattern
    // restricted to the par wash without touching the LED strips or
    // vintage bulbs.
    name: 'ParsOnly',
    bit: 0x0001,
    pixelIndices: [0, 1, 2, 3],
  },
  {
    // Both Vintage Led racks. 12 sub-pixels (left ×6 + right ×6).
    name: 'VintageOnly',
    bit: 0x0002,
    pixelIndices: [
      4, 5, 6, 7, 8, 9,
      10, 11, 12, 13, 14, 15,
    ],
  },
  {
    // Both LED bars. 36 sub-pixels (left ×18 + right ×18).
    name: 'BarsOnly',
    bit: 0x0004,
    pixelIndices: [
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33,
      34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
      44, 45, 46, 47, 48, 49, 50, 51,
    ],
  },
  {
    // Big-source fixtures only: pars + bars (skip the vintage bulbs).
    // A common "night-show wash" preset.
    name: 'MainWash',
    bit: 0x0008,
    pixelIndices: [
      0, 1, 2, 3,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33,
      34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
      44, 45, 46, 47, 48, 49, 50, 51,
    ],
  },
];
