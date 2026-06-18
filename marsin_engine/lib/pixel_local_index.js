// pixel_local_index.js - derive the per-fixture local index for each pixel.
//
// Tier-B exposes a `pixelLocalIndex` builtin (ABI: 0-based index of a pixel
// WITHIN its own fixture). The sim exporter does NOT emit this datum, so the
// host derives it at model load.
//
// FIXTURE IDENTITY - what counts as "one fixture":
// A fixture is the pair (group, fId). Neither key alone is universal:
//   - test_bench: `fId` uniquely identifies each physical fixture, but its
//     coarse `group` ('ParLights') lumps 4 separate pars together, so group
//     alone would wrongly index 4 pars as one 4-pixel run. fId alone is right
//     here.
//   - titanic: every pixel carries `fId: 0` (fixtureId is unpopulated in that
//     model), so fId alone is useless - it would make all 972 pixels one
//     fixture. `group` is the finest per-strand/per-fixture identity titanic
//     has (26 distinct groups), so the key must fall back to group there.
// The pair (group, fId) is correct for BOTH: on test_bench it refines group by
// fId (each par its own run); on titanic, with fId constant, it collapses to
// group. This is the most-correct available grouping, NOT a silent default -
// every pixel gets a real ordinal within a real fixture/strand.
//
// CONTIGUITY: pixels of one fixture are contiguous in the model array (the
// exporter emits them in fixture order; verified for test_bench and titanic).
// We therefore count along the array and reset the ordinal whenever the
// (group, fId) key changes. A non-contiguous re-appearance of a key would
// restart its count - acceptable because the exporter keeps fixtures
// contiguous; if that ever changes the derivation must be revisited.

/**
 * The (group, fId) fixture key for a pixel, used to bucket pixels into
 * fixtures for local-index assignment.
 */
function fixtureKey(px) {
  const group = px.group == null ? '' : String(px.group);
  const fId = px.fId == null ? 0 : px.fId;
  return `${group} ${fId}`;
}

/**
 * Compute the 0-based per-fixture local index for every pixel, in model
 * order. Returns an array parallel to `pixels`; holes (null pixels) get 0 and
 * break the current run.
 *
 * @param {Array<object|null>} pixels model pixels (with `group` and `fId`)
 * @returns {number[]} pixelLocalIndex per pixel
 */
export function derivePixelLocalIndices(pixels) {
  const out = new Array(pixels.length).fill(0);
  let key = null;
  let counter = 0;
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) {
      key = null;
      continue;
    }
    const k = fixtureKey(px);
    if (k !== key) {
      key = k;
      counter = 0;
    } else {
      counter += 1;
    }
    out[i] = counter;
  }
  return out;
}
