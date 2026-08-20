// te_sign_generator.js — TE Sign fixture-pair generator.
//
// The TE Sign is ONE physical luminous face, CNC-built, split left/right at a
// diagonal seam into two coplanar halves that are LED-backlit as two independent
// puck-LED chains (Side A, Side B). In the sim each half is its own LED-type
// fixture (DMX-transported): TeSignV3A40 (40 px / 120 ch) and TeSignV3B34
// (34 px / 102 ch). The pixel geometry of each half is DATA, baked into its
// fixture-definition YAML — this generator never bakes coordinates; it only
// instantiates the pair.
//
// ── HARD INVARIANT ──────────────────────────────────────────────────────────
// The two halves share ONE fixture-local coordinate frame (both are centered on
// the full-sign bounding box). The "half-ness" lives entirely in the pixel
// coordinates, so the relative transform between Side A and Side B is IDENTITY.
// Side A and Side B MUST ALWAYS carry the identical position, rotation, and
// scale. The x/y/z placement parameters move the WHOLE sign as one unit — they
// are NOT an offset between the two components. Never mirror, rotate, or offset
// one half relative to the other; do that and the seam tears and the logo
// scrambles. buildTeSign() and applyTeSignPlacement() both enforce this by
// construction (one shared transform copied into both configs).
//
// ── Data-driven pixel map (drop-in point) ───────────────────────────────────
// The real 74-LED layout is the DEFAULT and lives in:
//   simulation/dmx/fixtures/te_sign_v3/model_a_120.yaml   (Side A, 40 px)
//   simulation/dmx/fixtures/te_sign_v3/model_b_102.yaml   (Side B, 34 px)
// To swap in a revised map, regenerate/replace those YAMLs (per-pixel `dots` in
// mm, R=3i+1/G=3i+2/B=3i+3) and keep the two fixture_type strings below — no
// generator logic changes. tools/gen_led_fixture.js `map --file <pixels.json>`
// authors such a YAML from a pixel list.
//
// Pure module: no DOM, no THREE, no I/O — unit-testable in Node. No fallbacks
// (codex P0): invalid params throw.

// The two half fixture_types. These must match the `fixture_type` in the model
// YAMLs and the entries registered in main.js / the definition registry.
export const TE_SIGN_TYPE_A = 'TeSignV3A40';
export const TE_SIGN_TYPE_B = 'TeSignV3B34';

// Defaults for a freshly instantiated sign. Placement defaults reuse the
// centered front-of-ship pose the scene shipped with; the operator fine-places
// afterward (moving the whole sign, both halves together).
export const TE_SIGN_DEFAULTS = Object.freeze({
  name: 'TE Sign V3',
  group: 'TE Sign',
  x: 0,
  y: 9,
  z: 17,
  rotX: 0,
  rotY: 180,
  rotZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  color: '#ffffff',
  intensity: 5,
  angle: 20,
  penumbra: 0.5,
  brightness: 100,
  diffusion: true,
  diffusionAmount: 1.5,
});

function reqFinite(value, key) {
  // Reject the values that coerce to a misleading finite number (null→0,
  // true→1, ''→0) up front — a generator param must be a real number.
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') {
    throw new Error(`[te_sign_generator] '${key}' must be a finite number, got ${JSON.stringify(value)}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`[te_sign_generator] '${key}' must be a finite number, got ${JSON.stringify(value)}`);
  }
  return n;
}

function reqPositive(value, key) {
  const n = reqFinite(value, key);
  if (!(n > 0)) {
    throw new Error(`[te_sign_generator] '${key}' must be > 0, got ${n}`);
  }
  return n;
}

function reqNonEmptyString(value, key) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[te_sign_generator] '${key}' must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

/**
 * Resolve + validate the generator options against the defaults. Every numeric
 * placement/scale field is coerced to a finite number (scales must be > 0);
 * name/group must be non-empty strings. Throws on any invalid field (no silent
 * fallback).
 * @param {Object} [opts]
 * @returns {Object} the fully-resolved, validated option set
 */
export function resolveTeSignOptions(opts = {}) {
  if (opts === null || typeof opts !== 'object') {
    throw new Error('[te_sign_generator] options must be an object');
  }
  const merged = { ...TE_SIGN_DEFAULTS, ...opts };
  return {
    name: reqNonEmptyString(merged.name, 'name'),
    group: reqNonEmptyString(merged.group, 'group'),
    typeA: reqNonEmptyString(merged.typeA || TE_SIGN_TYPE_A, 'typeA'),
    typeB: reqNonEmptyString(merged.typeB || TE_SIGN_TYPE_B, 'typeB'),
    x: reqFinite(merged.x, 'x'),
    y: reqFinite(merged.y, 'y'),
    z: reqFinite(merged.z, 'z'),
    rotX: reqFinite(merged.rotX, 'rotX'),
    rotY: reqFinite(merged.rotY, 'rotY'),
    rotZ: reqFinite(merged.rotZ, 'rotZ'),
    scaleX: reqPositive(merged.scaleX, 'scaleX'),
    scaleY: reqPositive(merged.scaleY, 'scaleY'),
    scaleZ: reqPositive(merged.scaleZ, 'scaleZ'),
    color: merged.color,
    intensity: reqFinite(merged.intensity, 'intensity'),
    angle: reqFinite(merged.angle, 'angle'),
    penumbra: reqFinite(merged.penumbra, 'penumbra'),
    brightness: reqFinite(merged.brightness, 'brightness'),
    diffusion: merged.diffusion !== false,
    diffusionAmount: reqFinite(merged.diffusionAmount, 'diffusionAmount'),
  };
}

// The shared transform block — the SINGLE source of truth copied verbatim into
// both half configs, guaranteeing A ≡ B.
function transformOf(o) {
  return {
    x: o.x, y: o.y, z: o.z,
    rotX: o.rotX, rotY: o.rotY, rotZ: o.rotZ,
    scaleX: o.scaleX, scaleY: o.scaleY, scaleZ: o.scaleZ,
  };
}

function halfConfig(o, suffix, fixtureType, transform) {
  return {
    group: o.group,
    name: `${o.name} ${suffix}`,
    fixtureType,
    color: o.color,
    intensity: o.intensity,
    angle: o.angle,
    penumbra: o.penumbra,
    ...transform,
    traceGenerated: false,
    enabled: true,
    brightness: o.brightness,
    diffusion: o.diffusion,
    diffusionAmount: o.diffusionAmount,
  };
}

/**
 * Build the TE Sign as a pair of fixture config objects (Side A, Side B),
 * ready to append to a scene's `parLights` array. Both configs carry the
 * IDENTICAL transform (position/rotation/scale) and the shared group — the two
 * halves of one sign. Only name and fixtureType differ.
 *
 * @param {Object} [opts] - overrides for TE_SIGN_DEFAULTS (name, group, x, y,
 *   z, rot*, scale*, typeA, typeB, color, intensity, ...). x/y/z place the
 *   WHOLE sign (not a per-half offset).
 * @returns {[Object, Object]} exactly two fixture configs [sideA, sideB]
 */
export function buildTeSign(opts = {}) {
  const o = resolveTeSignOptions(opts);
  const transform = transformOf(o);
  return [
    halfConfig(o, 'A', o.typeA, transform),
    halfConfig(o, 'B', o.typeB, transform),
  ];
}

/**
 * Re-apply one placement to an existing TE Sign fixture pair (or any set of
 * fixtures that must move as a rigid unit), overwriting position/rotation/scale
 * on every fixture with the SAME values so the halves stay locked together.
 * Use this for "adjustable after instantiation": moving the sign updates both
 * halves identically. Mutates the fixtures in place and returns them.
 *
 * @param {Array<Object>} fixtures - the sign's fixture configs (≥1)
 * @param {Object} placement - { x, y, z, rotX, rotY, rotZ, scaleX, scaleY,
 *   scaleZ } — any omitted field keeps the generator default for that field.
 * @returns {Array<Object>} the same fixtures, mutated
 */
export function applyTeSignPlacement(fixtures, placement = {}) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('[te_sign_generator] applyTeSignPlacement: fixtures must be a non-empty array');
  }
  const o = resolveTeSignOptions(placement);
  const transform = transformOf(o);
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== 'object') {
      throw new Error('[te_sign_generator] applyTeSignPlacement: every fixture must be an object');
    }
    Object.assign(fixture, transform);
  }
  return fixtures;
}
