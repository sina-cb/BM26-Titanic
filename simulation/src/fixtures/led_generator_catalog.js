// led_generator_catalog.js — pure, ordered catalog of LED-fixture generators.
//
// Mirrors the DMX `📐 Group Generator` model for the LED Fixtures section: the
// generator area renders one "add" button per catalog entry, and clicking it
// pushes freshly-built fixture configs into the target params array where they
// become a normal (locked) group in the LED Fixture Instances list. See design
// report 20260724_26_led_generator_workflow_design.md §2.3.
//
// The whole point of this module is the SEAM: adding a future LED generator is
// ONE entry here (+ its own build module) — zero gui_builder changes. A future
// strand-emitting generator declares `target: 'ledStrands'` and its own
// `build`; the generic click handler in gui_builder dispatches on `target`.
//
// Pure module (codex discipline, same as te_sign_generator.js / group_lock.js):
// no DOM, no THREE, no window/global, no I/O — unit-testable in Node. No
// fallbacks (codex P0): a malformed catalog entry throws at module load; an
// out-of-contract build output throws when run.

import {
  buildTeSign,
  TE_SIGN_DEFAULTS,
} from './te_sign_generator.js';

// ── Contract constants ────────────────────────────────────────────────────

// The params arrays a generator may target. Anything else is a bug — throw.
// 'parLights' → LED-class fixtures that ride the DMX/par transport (the TE
// Sign today). 'ledStrands' → direct-paint LED strands (reserved for a future
// generator; no entry uses it yet).
export const LED_GENERATOR_TARGETS = Object.freeze(['parLights', 'ledStrands']);

// Display-only bucket name in the instances list — a generated group must never
// collide with it. Reserved intrinsically by uniqueGroupName.
export const RESERVED_GROUP_NAME = 'Ungrouped';

// ── The catalog ────────────────────────────────────────────────────────────

// Ordered catalog of LED-fixture generators. TE Sign is the ONLY entry for now
// (operator brief: "The only generator we will have is a TE sign"). Fields:
//   id           unique stable key (for lookup / undo labels)
//   label        the button text
//   target       which params array the build output lands in (a valid target)
//   defaultGroup the base group name; uniqueGroupName suffixes it on collision
//   bornLocked   lock the output group on creation (groupOverrides[group].locked)
//   build        (opts) => Array<fixtureConfig> — non-empty, all sharing ONE group
export const LED_GENERATORS = Object.freeze([
  Object.freeze({
    id: 'te_sign',
    label: '✨ + TE Sign (A+B)',
    target: 'parLights',
    defaultGroup: TE_SIGN_DEFAULTS.group, // 'TE Sign'
    bornLocked: true,
    build: (opts) => buildTeSign(opts),
  }),
]);

// ── Load-time validation (fail loud at startup, codex P0) ───────────────────

function validateGeneratorEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`[led_generator_catalog] catalog entry must be an object, got ${JSON.stringify(entry)}`);
  }
  const { id, label, target, defaultGroup, bornLocked, build } = entry;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`[led_generator_catalog] entry 'id' must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error(`[led_generator_catalog] entry '${id}': 'label' must be a non-empty string, got ${JSON.stringify(label)}`);
  }
  if (!LED_GENERATOR_TARGETS.includes(target)) {
    throw new Error(`[led_generator_catalog] entry '${id}': unknown target ${JSON.stringify(target)} (valid: ${LED_GENERATOR_TARGETS.join(', ')})`);
  }
  if (typeof defaultGroup !== 'string' || defaultGroup.trim().length === 0) {
    throw new Error(`[led_generator_catalog] entry '${id}': 'defaultGroup' must be a non-empty string, got ${JSON.stringify(defaultGroup)}`);
  }
  if (typeof bornLocked !== 'boolean') {
    throw new Error(`[led_generator_catalog] entry '${id}': 'bornLocked' must be a boolean, got ${JSON.stringify(bornLocked)}`);
  }
  if (typeof build !== 'function') {
    throw new Error(`[led_generator_catalog] entry '${id}': 'build' must be a function`);
  }
}

// Enforce unique ids and per-entry shape the moment this module is imported.
(() => {
  const seen = new Set();
  for (const entry of LED_GENERATORS) {
    validateGeneratorEntry(entry);
    if (seen.has(entry.id)) {
      throw new Error(`[led_generator_catalog] duplicate generator id '${entry.id}'`);
    }
    seen.add(entry.id);
  }
})();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a catalog entry by id. Throws on an unknown id (no silent null).
 * @param {string} id
 * @returns {Object} the catalog entry
 */
export function getLedGenerator(id) {
  const entry = LED_GENERATORS.find((g) => g.id === id);
  if (!entry) {
    const known = LED_GENERATORS.map((g) => g.id).join(', ');
    throw new Error(`[led_generator_catalog] unknown generator id ${JSON.stringify(id)} (known: ${known})`);
  }
  return entry;
}

/**
 * Assert a build output honors the generator contract: a non-empty array of
 * fixture-config objects, ALL sharing one non-empty group. Returns the array.
 * @param {Array<Object>} fixtures
 * @param {Object} entry - the catalog entry (for error attribution)
 * @returns {Array<Object>} the same fixtures
 */
export function assertGeneratorFixtures(fixtures, entry) {
  const id = entry && entry.id ? entry.id : '?';
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error(`[led_generator_catalog] generator '${id}' build must return a non-empty array`);
  }
  let sharedGroup = null;
  fixtures.forEach((fixture, i) => {
    if (!fixture || typeof fixture !== 'object') {
      throw new Error(`[led_generator_catalog] generator '${id}' build[${i}] must be an object`);
    }
    if (typeof fixture.group !== 'string' || fixture.group.trim().length === 0) {
      throw new Error(`[led_generator_catalog] generator '${id}' build[${i}] must carry a non-empty group`);
    }
    if (sharedGroup === null) sharedGroup = fixture.group;
    else if (fixture.group !== sharedGroup) {
      throw new Error(`[led_generator_catalog] generator '${id}' build must share ONE group, got '${sharedGroup}' and '${fixture.group}'`);
    }
  });
  return fixtures;
}

/**
 * Run a generator's build and validate its output against the contract. This is
 * the function S2's click handler calls to obtain the fixtures to push into
 * `params[entry.target]`.
 * @param {Object} entry - a catalog entry (from LED_GENERATORS / getLedGenerator)
 * @param {Object} [opts] - build options (must include `group`; passed to build)
 * @returns {Array<Object>} validated, non-empty fixture configs sharing one group
 */
export function runLedGenerator(entry, opts = {}) {
  validateGeneratorEntry(entry);
  const fixtures = entry.build(opts);
  return assertGeneratorFixtures(fixtures, entry);
}

/**
 * First free group name: `base`, then `base 2`, `base 3`, … skipping every name
 * already taken. `existingGroups` is the set of names to dodge — the caller
 * passes the UNION of the target array's group names AND `params.traces[*]
 * .groupName`, because config.js re-stamps `traceGenerated` on any fixture whose
 * group matches a trace's groupName (config.js extractParams L146-149) — so a
 * generated sign group must never collide with a trace group or it would be
 * captured as trace-generated. `RESERVED_GROUP_NAME` ('Ungrouped') is dodged
 * intrinsically. Fail-loud on a non-string base or non-iterable groups.
 *
 * @param {Array<string>|Set<string>} existingGroups - names already in use
 * @param {string} base - the desired base group name
 * @returns {string} a name not present in existingGroups (nor the reserved name)
 */
export function uniqueGroupName(existingGroups, base) {
  if (typeof base !== 'string' || base.trim().length === 0) {
    throw new Error(`[led_generator_catalog] uniqueGroupName: base must be a non-empty string, got ${JSON.stringify(base)}`);
  }
  if (!Array.isArray(existingGroups) && !(existingGroups instanceof Set)) {
    throw new Error('[led_generator_catalog] uniqueGroupName: existingGroups must be an array or Set');
  }
  const taken = new Set();
  for (const name of existingGroups) {
    if (typeof name === 'string') taken.add(name);
  }
  taken.add(RESERVED_GROUP_NAME);

  const trimmed = base.trim();
  if (!taken.has(trimmed)) return trimmed;
  let n = 2;
  while (taken.has(`${trimmed} ${n}`)) n += 1;
  return `${trimmed} ${n}`;
}
