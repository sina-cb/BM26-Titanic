/**
 * fixture_model_scale.js — per-fixture-type RENDER exaggeration for the 3D sim.
 *
 * Some real fixtures are physically tiny next to the thing they are mounted on.
 * The Vintage LED Stage Light is 90 × 460 × 60 mm with 18 mm heads; the Titanic
 * is ~100 m long. Drawn at true physical size from any normal camera distance
 * the whole fixture collapses to a few pixels — a run of "tiny dots" with no
 * readable body, which is exactly what the operator sees in the 3D view.
 *
 * This module is the ONE place that says "draw fixture type X at N× its
 * physical size". It is a RENDER multiplier only:
 *
 *   • it scales the drawn geometry — the shell (housing) box/cylinder, its
 *     offset, the fixture's dimensions (hitbox + diffusor panel), the per-pixel
 *     emitter positions, and the bulb/halo radii — UNIFORMLY, so the fixture's
 *     proportions are unchanged and its pixel-spacing ceiling
 *     (led_halo.js clampPixelRadiusToPitch) scales with it instead of
 *     strangling the bigger bulbs back down;
 *
 *   • it does NOT touch the PHYSICAL pixel positions. `pixel.localPos` in
 *     dmx_fixture_runtime stays true to the model YAML, because that is what
 *     the Pixelblaze/marsin model exporter and the analytic light pool sample —
 *     an exported model must describe the real rig, never the exaggerated
 *     drawing of it.
 *
 * Only types listed here are exaggerated; every other fixture renders 1:1 and
 * is byte-identical to before this module existed.
 */

// Render multiplier per fixture type (fixtureDef.fixtureType).
//
// VintageLed = 2.5: the operator's order — the vintage lights must render at
// least 2.5× their model size (housing AND pixels) to read at all in the 3D
// view. Uniform, so the six Edison heads keep their exact relationship to the
// 460 mm body and to each other.
//
// UkingPar = 3.0: the same order for the par cans ("do the same 3X enlargement
// for the par can Uking pars"). A UKing RGBWAU par is a 150 mm can with ONE
// 39 mm head — the most numerous fixture on the ship (47 of them) and the
// smallest single emitter, so it suffers the ship-scale problem worst. Being
// single-pixel there is no neighbour to fuse with, so the pitch ceiling never
// applies to it and the 3× is exactly what is drawn.
export const FIXTURE_MODEL_SCALE = Object.freeze({
  VintageLed: 2.5,
  UkingPar: 3.0,
});

// Every fixture type not listed above draws at true physical size.
export const DEFAULT_MODEL_SCALE = 1;

// A garbage entry in the table is a coding error, not a runtime condition —
// crash at import time rather than silently drawing a fixture at 1× or 0×
// (codex P0: no fallback behaviors).
for (const [type, scale] of Object.entries(FIXTURE_MODEL_SCALE)) {
  if (!Number.isFinite(scale) || !(scale > 0)) {
    throw new Error(
      `[fixture_model_scale] FIXTURE_MODEL_SCALE['${type}'] must be a positive number, ` +
      `got ${JSON.stringify(scale)}`
    );
  }
}

/**
 * The render multiplier for a fixture definition.
 *
 * An absent definition or an unlisted type means "draw at physical size" — a
 * DEFINED default for a fixture nobody asked to exaggerate, not a fallback
 * masking a failure.
 *
 * @param {Object|null} fixtureDef - from FixtureDefinitionRegistry
 * @returns {number} uniform render scale (> 0)
 */
export function fixtureModelScale(fixtureDef) {
  if (!fixtureDef || typeof fixtureDef.fixtureType !== 'string') return DEFAULT_MODEL_SCALE;
  const scale = FIXTURE_MODEL_SCALE[fixtureDef.fixtureType];
  return scale === undefined ? DEFAULT_MODEL_SCALE : scale;
}
