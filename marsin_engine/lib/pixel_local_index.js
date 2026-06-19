// pixel_local_index.js - resolve the per-fixture local index for each pixel.
//
// Tier-B exposes a `pixelLocalIndex` builtin (ABI: 0-based index of a pixel
// WITHIN its own fixture). There are two ways this datum reaches the host:
//
//   1. NEW exports — the sim exporter (pixelblaze_model_exporter.js) emits a
//      TRUE per-pixel `localIndex` on every pixel, straight from the real
//      fixture membership it owns (DMX: per-fixture pixel order; LED: per-
//      strand pixel order). This is authoritative: a sweep keyed on it runs
//      ALONG a bar/strand in physical pixel order. PREFER it.
//
//   2. LEGACY exports — older models predate the field. For those we derive
//      the index host-side by grouping consecutive pixels by their (group,
//      fId) fixture key. This is the documented FALLBACK only.
//
// Codex P0 (no silent fallbacks): if a model is the NEW format (some pixels
// carry `localIndex`) but the field is MISSING on a non-null pixel where it
// is expected, we FAIL LOUDLY rather than silently mis-deriving a mixed
// model. A model is either entirely the new format (every non-null pixel has
// a numeric `localIndex`) or entirely legacy (no pixel has it); a partial
// carry is a corrupt/half-migrated export and must throw.
//
// FIXTURE IDENTITY (legacy fallback only) - what counts as "one fixture":
// A fixture is the pair (group, fId). Neither key alone is universal:
//   - test_bench: `fId` uniquely identifies each physical fixture, but its
//     coarse `group` ('ParLights') lumps 4 separate pars together, so group
//     alone would wrongly index 4 pars as one 4-pixel run. fId alone is right
//     here.
//   - titanic: every pixel carries `fId: 0` (fixtureId is unpopulated in that
//     model), so fId alone is useless - it would make all pixels one fixture.
//     `group` is the finest per-strand/per-fixture identity titanic has, so
//     the key must fall back to group there.
// The pair (group, fId) is the most-correct available grouping for BOTH, NOT
// a silent default. It is, however, indirect — which is exactly why the new
// exporter field supersedes it.
//
// CONTIGUITY (legacy fallback only): pixels of one fixture are contiguous in
// the model array (the exporter emits them in fixture order). We count along
// the array and reset the ordinal whenever the (group, fId) key changes.

/**
 * The (group, fId) fixture key for a pixel, used to bucket pixels into
 * fixtures for legacy local-index derivation.
 */
function fixtureKey(px) {
  const group = px.group == null ? '' : String(px.group);
  const fId = px.fId == null ? 0 : px.fId;
  return `${group} ${fId}`;
}

/**
 * True when a pixel carries an exporter-provided numeric `localIndex`.
 */
function hasExporterLocalIndex(px) {
  return px != null && typeof px.localIndex === 'number' && Number.isFinite(px.localIndex);
}

/**
 * Resolve the 0-based per-fixture local index for every pixel, in model
 * order. Returns an array parallel to `pixels`.
 *
 * Prefers the exporter-emitted `localIndex` when the model is the NEW format
 * (every non-null pixel carries it). Falls back to the (group, fId) heuristic
 * for LEGACY models that lack the field entirely. A PARTIAL carry (the field
 * present on some pixels but missing on other non-null pixels) is a corrupt
 * export and THROWS (codex P0 — fail loudly, never silently mis-derive).
 *
 * @param {Array<object|null>} pixels model pixels
 * @returns {number[]} pixelLocalIndex per pixel
 */
export function derivePixelLocalIndices(pixels) {
  // Classify the model: count how many non-null pixels carry the exporter
  // field. All-or-nothing; anything in between is a hard error.
  let nonNull = 0;
  let withField = 0;
  for (const px of pixels) {
    if (!px) continue;
    nonNull += 1;
    if (hasExporterLocalIndex(px)) withField += 1;
  }

  if (withField > 0 && withField < nonNull) {
    throw new Error(
      `[pixel_local_index] Corrupt model: ${withField}/${nonNull} non-null pixels ` +
      'carry an exporter `localIndex` but the rest do not. A NEW-format export must ' +
      'carry it on EVERY pixel; a LEGACY export on none. Refusing to silently ' +
      're-derive a half-migrated model (codex P0). Re-export the model from the sim.');
  }

  if (withField === nonNull && nonNull > 0) {
    // NEW format — trust the exporter's authoritative per-fixture ordinals.
    return pixels.map((px) => (px && hasExporterLocalIndex(px) ? px.localIndex : 0));
  }

  // LEGACY format — derive from the (group, fId) fixture key. Holes (null
  // pixels) get 0 and break the current run.
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
