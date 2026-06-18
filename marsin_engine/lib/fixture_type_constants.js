// fixture_type_constants.js — canonical FIX_* fixture-type registry.
//
// `fixtureType` (e.g. 'UkingPar', 'ShehdsBar', 'VintageLed') is authored
// per-fixture in the scene and already written into every engine model
// pixel as a STRING — but it is the ONE per-pixel property that stays
// stable when you switch models (fId/group/viewMask all reshuffle).
// Reports 20260618_1/_4 promote it to a model-INDEPENDENT targeting key:
// a pattern says `fixtureType == FIX_PAR` instead of the test_bench-only
// `fixtureId >= 1 && fixtureId <= 4`, and the same pattern runs on every
// model.
//
// This module owns the SEMANTIC mapping `fixtureType string → stable
// small integer fixtureTypeId` and the `FIX_*` role-constant names that
// patterns author against. It is the BM26-side authority the cross-repo
// ABI contract defers to: post-Tier-B, MarsinScript exposes an opaque
// uint16 `fixtureType` builtin, and the host sets each pixel's
// fixtureTypeId FROM THIS TABLE.
//
//   Naming convention (operator): role + pixel-count suffix, where the
//   number is pixels-per-fixture of that type, so new sizes can be added
//   later without renumbering. Pars are single-pixel, so FIX_PAR carries
//   no suffix.
//
//   id 0 is reserved for UNTYPED — a pixel whose fixtureType the registry
//   does not know. It is NOT a fallback target: unknown FIX_* references
//   throw at compile (codex P0); id 0 only means "this pixel matched no
//   known type", which is the correct, explicit answer for, e.g., a
//   special-effect channel pixel.
//
// IDS ARE APPEND-ONLY AND GLOBAL. Never renumber an existing id —
// patterns and the future host fixtureTypeId lane both bind to these
// integers; a renumber silently re-targets every pattern. The
// fixtureTypeStability test pins them.

import { sanitizeName, buildConstantTable, injectConstants } from './name_id_registry.js';

const FIX_PREFIX = 'FIX';

export const UNTYPED_ID = 0;

// ── Canonical registry ──────────────────────────────────────────────
// Each entry: the scene fixtureType STRING(s) that map to a role, the
// stable id, the role's FIX_* constant name, and the canonical
// pixels-per-fixture count (documentation + the count suffix source).
// `aliases` lets a future "different brand of par" join FIX_PAR without
// touching patterns (target the ROLE, not the SKU — report _1 §2.1, Q2).
//
// Counts are the test_bench reference geometry (par=1, vintage=6,
// bar=18); titanic packs the same TYPES at different per-fixture counts
// but the ROLE id is what stays stable across models.
const REGISTRY = [
  { id: 1, role: 'FIX_RAW_LED', count: null, types: ['RawLed'], aliases: [''] },
  { id: 2, role: 'FIX_PAR', count: 1, types: ['UkingPar'], aliases: [] },
  { id: 3, role: 'FIX_VINTAGE_6', count: 6, types: ['VintageLed'], aliases: [] },
  { id: 4, role: 'FIX_BAR_18', count: 18, types: ['ShehdsBar'], aliases: [] },
  { id: 5, role: 'FIX_HAZE', count: null, types: ['ChauvetHaze4D'], aliases: [] },
  { id: 6, role: 'FIX_FOG', count: null, types: ['TEFogMachine'], aliases: [] },
];

// Build the string → id and role → id lookups once. The empty string is
// a legitimate raw-LED strand marker today (titanic's 480 LED pixels),
// so it interns to FIX_RAW_LED rather than UNTYPED — an empty string was
// never targetable before, so this is purely additive (report _1 §2.6).
const STRING_TO_ID = new Map();
const ROLE_TO_ID = new Map();
const ID_TO_ROLE = new Map();
for (const entry of REGISTRY) {
  if (sanitizeName(FIX_PREFIX, entry.role.slice(FIX_PREFIX.length + 1)) !== entry.role) {
    throw new Error(`Registry role '${entry.role}' is not a canonical FIX_ constant name`);
  }
  ROLE_TO_ID.set(entry.role, entry.id);
  ID_TO_ROLE.set(entry.id, entry.role);
  for (const name of [...entry.types, ...entry.aliases]) {
    if (STRING_TO_ID.has(name)) {
      throw new Error(`fixtureType string '${name}' is mapped by two registry entries`);
    }
    STRING_TO_ID.set(name, entry.id);
  }
}

/**
 * Stable fixtureTypeId for a scene fixtureType string. An unknown
 * (non-empty) type is UNTYPED_ID — NOT a fallback target, just the
 * explicit "no known type" answer. The host uses this to fill the
 * per-pixel fixtureTypeId lane at Tier-B integration.
 */
export function fixtureTypeId(typeString) {
  const key = typeString == null ? '' : String(typeString);
  return STRING_TO_ID.has(key) ? STRING_TO_ID.get(key) : UNTYPED_ID;
}

/** The canonical FIX_* role constant name for an id (for diagnostics). */
export function roleForId(id) {
  return ID_TO_ROLE.get(id) || null;
}

/** All FIX_* role names the registry knows (for diagnostics / UI). */
export function allFixtureRoles() {
  return [...ROLE_TO_ID.keys()];
}

/**
 * The set of distinct fixtureTypeIds actually present on a model's
 * pixels (excluding UNTYPED). Used to size the Tier-A bit block and to
 * emit only the FIX_* constants a model can satisfy.
 */
export function presentTypeIds(pixels) {
  const present = new Set();
  for (const px of pixels) {
    if (!px) continue;
    const id = fixtureTypeId(px.fixtureType);
    if (id !== UNTYPED_ID) present.add(id);
  }
  return present;
}

const MAX_VIEW_BIT = 0x40000000; // bit 30 — highest safe signed-Int32 bit

/**
 * Tier-A fixture-type bit allocator (works on the CURRENT vendored WASM,
 * no rebuild — report _1 §2.5). Encodes each PRESENT fixture type as a
 * fixed reserved viewMask bit placed ABOVE every bit the model already
 * uses, so `fixtureType == FIX_PAR` is expressed in-pattern as
 * `(viewMask & FIX_PAR) != 0` with FIX_PAR a model-independent bit.
 *
 * Returns null when the present types do not fit in the model's free bit
 * budget (titanic burns bits 0..25; a few free high bits may not hold
 * every present type). A null result means: Tier-A-via-viewMask does not
 * fit this model — fixture-typing there is delivered by Tier-B (the real
 * `fixtureType` builtin) at integration, with the SAME FIX_* authoring
 * surface, so patterns do not change between tiers.
 *
 * @param {Array} pixels      model pixels (with resolved vMask)
 * @param {number} usedMask   OR of every pixel's current viewMask
 * @returns {{ table: Object<string,number>, bitOf: (s:string)=>number,
 *             idToBit: Map<number,number> } | null}
 */
export function buildFixtureTypeBits(pixels, usedMask) {
  const present = [...presentTypeIds(pixels)].sort((a, b) => a - b);
  if (present.length === 0) return null;

  // Highest bit already used (round up to the next free power of two).
  let candidate = 1;
  while (candidate <= usedMask && candidate <= MAX_VIEW_BIT) candidate *= 2;

  const idToBit = new Map();
  const tableEntries = [];
  for (const id of present) {
    while ((candidate & usedMask) !== 0 && candidate <= MAX_VIEW_BIT) candidate *= 2;
    if (candidate > MAX_VIEW_BIT) {
      // Does not fit — Tier B owns this model's fixture-typing.
      return null;
    }
    idToBit.set(id, candidate);
    tableEntries.push({ name: roleForId(id).slice(FIX_PREFIX.length + 1), value: candidate, origin: 'fixtureType' });
    candidate *= 2;
  }

  const table = buildConstantTable(FIX_PREFIX, tableEntries);
  const stringToBit = new Map();
  for (const px of pixels) {
    if (!px) continue;
    const id = fixtureTypeId(px.fixtureType);
    if (idToBit.has(id)) stringToBit.set(px.fixtureType ?? '', idToBit.get(id));
  }
  return {
    table,
    idToBit,
    bitOf: (typeString) => stringToBit.get(typeString == null ? '' : String(typeString)) || 0,
  };
}

/**
 * Prepend `var FIX_X = <bit>;` declarations for every FIX_* identifier a
 * pattern references and the model's Tier-A table knows. Unknown FIX_*
 * reference → loud compile error (codex P0). Mirrors injectMaskConstants
 * but on the FIX_ namespace, so a pattern can freely mix MASK_* and
 * FIX_* (the two injectors are prefix-isolated).
 */
export function injectFixtureConstants(source, fixtureConstants) {
  return injectConstants(source, fixtureConstants || {}, FIX_PREFIX);
}
