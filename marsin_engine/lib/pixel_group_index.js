// pixel_group_index.js - resolve each pixel's ordinal WITHIN ITS GROUP.
//
// WHY THIS EXISTS ALONGSIDE pixel_local_index.js
//
// `pixel_local_index.js` answers "where is this pixel inside its FIXTURE".
// That is the right datum for a sweep that runs along one bar or one strand,
// and it is what the Tier-B `pixelLocalIndex` builtin exposes.
//
// It is the WRONG datum for anything that wants to travel the length of a
// GROUP, because a titanic group usually holds several fixtures and the
// exporter restarts `localIndex` at 0 on every one of them. Measured on the
// live titanic model (964 px, 24 groups):
//
//   Right Front Wall     90 px   5 fixtures   localIndex 0..17, five times
//   TE Sign              74 px   2 fixtures   localIndex 0..39, twice
//   Left_Front_Left      40 px   1 fixture    localIndex 0..39
//   Right Front Rails    24 px   4 fixtures   localIndex 0..5, four times
//   Right SmokeStacks     8 px   8 fixtures   localIndex 0 on EVERY pixel
//
// 16 of the 24 groups hold more than one fixture. A trace keyed on
// `localIndex` would run five short sweeps along one wall instead of one long
// one, and on the smokestacks - eight single-pixel pars - it would not move at
// all, because every pixel there has localIndex 0.
//
// So a group-relative effect needs a group-relative ordinal. That is this
// file: 0..n-1 across the WHOLE group, spanning its fixtures.
//
// ORDER: model order. The exporter emits each group's pixels in fixture order
// and each fixture's pixels in physical pixel order, so ranking by model index
// walks the group the way the light physically runs. Ranking is used rather
// than assuming contiguity, so a group whose pixels are interleaved in the
// model still gets a stable, complete 0..n-1 run.

/**
 * Ordinal of every pixel within its own group, plus that group's size.
 *
 * Returns two arrays parallel to `pixels`. Null pixels (model holes) get
 * index 0 and size 0, and are excluded from their group's numbering, so a
 * hole never leaves a gap in the run or stretches the group's length.
 *
 * @param {Array<object|null>} pixels model pixels
 * @returns {{ index: number[], size: number[], groupId: number[] }}
 */
export function derivePixelGroupIndices(pixels) {
  if (!Array.isArray(pixels)) {
    throw new Error('derivePixelGroupIndices: pixels must be an array');
  }

  const index = new Array(pixels.length).fill(0);
  const size = new Array(pixels.length).fill(0);
  const groupId = new Array(pixels.length).fill(0);
  const counter = new Map();
  const ids = new Map();

  // Pass 1 - rank each pixel inside its group, in model order, and number the
  // groups themselves. The group NUMBER is what lets an effect treat a group
  // as a unit ("this whole group is one colour, the next one is the next
  // colour") rather than only as a run of pixels.
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const group = typeof px.group === 'string' ? px.group : '';
    if (!ids.has(group)) ids.set(group, ids.size);
    groupId[i] = ids.get(group);
    const n = counter.get(group) || 0;
    index[i] = n;
    counter.set(group, n + 1);
  }

  // Pass 2 - stamp the finished group length onto every one of its pixels, so
  // the effect never has to look anything up per frame.
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const group = typeof px.group === 'string' ? px.group : '';
    size[i] = counter.get(group) || 0;
  }

  return { index, size, groupId };
}

/**
 * Cached per-model view of the above.
 *
 * The derivation is O(pixels) and the answer only changes when the MODEL
 * changes, so it is computed once per pixels array and held against that
 * array. Keyed weakly: a model reload hands over a new array and the old
 * entry is collectable, with no invalidation call to forget.
 */
const cache = new WeakMap();

/**
 * @param {Array<object|null>} pixels model pixels
 * @returns {{ index: number[], size: number[], groupId: number[] }}
 */
export function groupIndicesFor(pixels) {
  const hit = cache.get(pixels);
  // A model reload can hand back an array of the same identity but a different
  // length (in-place rebuild), which would silently mis-index every pixel.
  if (hit && hit.index.length === pixels.length) return hit;
  const built = derivePixelGroupIndices(pixels);
  cache.set(pixels, built);
  return built;
}
