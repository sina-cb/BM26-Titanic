/**
 * scene_model_parity.cjs — PURE scene ↔ generated-model parity checks.
 *
 * The acceptance gate for the mapping campaign (plan 20260725_33 §4). It
 * answers ONE question with named, located findings:
 *
 *   Does `marsin_engine/models/<scene>.js` (+ sidecars) say EXACTLY what
 *   `simulation/scenes/<scene>/*.yaml` says — and is what they say
 *   electrically sendable?
 *
 * Nothing else in the repo checks this. The engine validates only
 * groupBits↔model-groups at load; the exporter aborts on internal
 * inconsistency; the unit tests pin serialization. A stale model, a
 * hand-edited patches.yaml, a duplicate DMX address, an unmapped
 * fixture, or a DMX/LED section-id collision all pass silently today.
 *
 * ── Why this module imports NOTHING from `simulation/src/` ──────────────
 * An acceptance gate that re-runs the code it audits cannot catch a bug in
 * that code — it would agree with the exporter about a wrong answer. So the
 * contract below is re-stated INDEPENDENTLY from the authoring artifacts,
 * and it stays runnable while the sim source is mid-refactor. The contract
 * mirrors, and must be kept in step with:
 *   - `src/dmx/pixelblaze_model_exporter.js` (pixel roster, names, patches)
 *   - `src/dmx/controller_registry.js`       (projection, LED lanes, ordinals)
 *   - `src/dmx/led/led_patch_projection.js`  (no-straddle per-pixel walk)
 *   - `src/dmx/led/led_metadata.js`          (LED ids float above the DMX max)
 * Each re-stated rule cites its source below. Drift in the CONTRACT (not in
 * a scene) shows up as a validator failure on a scene known to be good —
 * which is the intended alarm, not a false positive to be silenced.
 *
 * PURE: no fs, no network, no process, no DOM. Inputs are parsed objects;
 * the caller (tools/scene_model_parity.cjs) does all I/O.
 *
 * Severity contract:
 *   error — the scene is broken: fix before the model is trusted. Exit 1.
 *   warn  — legal but almost certainly an authoring mistake.
 *   info  — recorded state (placeholders, unpatched strands) that `--strict`
 *           promotes to error, because `--strict` IS the hardware gate.
 */

'use strict';

// ── Contract constants (mirrors of the source modules named above) ───────
const DMX_UNIVERSE_SIZE = 512;      // controller_registry.js DMX_UNIVERSE_SIZE
const MAX_UNIVERSE = 63999;         // controller_registry.js MAX_UNIVERSE (sACN ceiling)
const EFFECTS_UNIVERSE = 1;         // controller_registry.js EFFECTS_UNIVERSE
const MAX_VIEW_BIT = 0x40000000;    // marsin_engine/lib/view_word.js MAX_WORD_BIT
const PLACEHOLDER_IP = '0.0.0.0';   // plan 20260725_33 §2 sentinel
const PLACEHOLDER_MARKER = 'PLACEHOLDER';

// controller_registry.js LED_CHANNEL_ORDERS
const LED_CHANNEL_ORDERS = {
  RGB: { r: 1, g: 2, b: 3 },
  GRB: { r: 2, g: 1, b: 3 },
  BGR: { r: 3, g: 2, b: 1 },
  RGBW: { r: 1, g: 2, b: 3, w: 4 },
  GRBW: { r: 2, g: 1, b: 3, w: 4 },
  RGBWA: { r: 1, g: 2, b: 3, w: 4, a: 5 },
};
const DEFAULT_LED_ORDER = 'RGBW';

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const CHECKS = {
  GENERATOR_SPLITS: 'generator_splits',
  COVERAGE: 'coverage',
  PATCH_TRUTH: 'patch_truth',
  ADDRESS_HYGIENE: 'address_hygiene',
  METADATA: 'metadata',
  VIEWS: 'views',
  BENCH_PARITY: 'bench_parity',
  PLACEHOLDER: 'placeholder',
  DRIFT: 'drift',
};

const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

// ── Small pure helpers ──────────────────────────────────────────────────

function isValidIp(ip) {
  const m = IP_RE.exec(String(ip == null ? '' : ip));
  if (!m) return false;
  return m.slice(1).every((octet) => Number(octet) <= 255);
}

/** Effects fixtures export to `<scene>.effects.js`, NOT the pixel model.
 *  Mirrors pixelblaze_model_exporter.js:186. */
function isEffectsFixtureType(fixtureType) {
  const t = String(fixtureType || '');
  return t.includes('Fog') || t === 'ChauvetHaze4D' || t.includes('Horn') || t.includes('Fire');
}

/** Mirrors pixelblaze_model_exporter.js standardizeChannels(). */
function standardizeChannels(ch) {
  if (!ch) return null;
  const std = {};
  if (ch.red !== undefined) std.r = ch.red;
  if (ch.green !== undefined) std.g = ch.green;
  if (ch.blue !== undefined) std.b = ch.blue;
  if (ch.white !== undefined) std.w = ch.white;
  if (ch.value !== undefined && std.w === undefined) std.w = ch.value;
  if (ch.amber !== undefined) std.a = ch.amber;
  if (ch.violet !== undefined) std.u = ch.violet;
  if (ch.purple !== undefined) std.u = ch.purple;
  if (ch.uv !== undefined) std.u = ch.uv;
  return Object.keys(std).length > 0 ? std : null;
}

/** Mirrors led_metadata.js groupKeyForStrand(): `strand.group || strand.name`. */
function strandGroupKey(strand) {
  const group = typeof strand.group === 'string' ? strand.group.trim() : '';
  if (group.length > 0) return group;
  const name = typeof strand.name === 'string' ? strand.name.trim() : '';
  return name;
}

/** Mirrors controller_registry.js entryFixtureName(); gaps return null. */
function entryFixtureName(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.fixture === 'string') return entry.fixture;
  return null;
}

function isGapEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.gap === 'number';
}

function shallowEqualMaps(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** True when every key the SCENE authored appears identically in `actual`.
 *  Normalization may add defaults to the model — extra keys are not drift,
 *  a changed authored value is. */
function authoredSubsetMatches(authored, actual) {
  if (authored === null || authored === undefined) return true;
  if (actual === null || actual === undefined) return false;
  for (const [k, v] of Object.entries(authored)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (!authoredSubsetMatches(v, actual[k])) return false;
    } else if (!deepEqual(v, actual[k])) {
      return false;
    }
  }
  return true;
}

function fmtPatch(patch) {
  if (!patch) return 'null (unpatched)';
  return `U${patch.universe}:${patch.addr}+${patch.footprint}${patch.led ? ' led' : ''}`;
}

// ── Scene readers (tolerant of the GUI-schema wrappers) ──────────────────

function readDmxFixtures(sceneConfig) {
  const section = sceneConfig && sceneConfig.parLights;
  const list = section && Array.isArray(section.fixtures) ? section.fixtures : [];
  return list.filter((f) => f && typeof f.name === 'string' && f.name.length > 0);
}

function readStrands(sceneConfig) {
  const section = sceneConfig && sceneConfig.ledStrands;
  const list = section && Array.isArray(section.strands) ? section.strands : [];
  return list.filter((s) => s && typeof s.name === 'string' && s.name.length > 0);
}

function readTraces(sceneConfig) {
  const list = sceneConfig && Array.isArray(sceneConfig.traces) ? sceneConfig.traces : [];
  return list.filter((t) => t && typeof t === 'object');
}

function readControllers(controllersYaml) {
  const list = controllersYaml && Array.isArray(controllersYaml.controllers)
    ? controllersYaml.controllers : [];
  return list.filter((c) => c && typeof c === 'object');
}

function readPatchRecords(patchesYaml) {
  const table = patchesYaml && patchesYaml.patches && typeof patchesYaml.patches === 'object'
    ? patchesYaml.patches : {};
  return new Map(Object.entries(table));
}

function readViews(viewsYaml) {
  const views = (viewsYaml && viewsYaml.views) || {};
  return {
    groupBits: (views.groupBits && typeof views.groupBits === 'object') ? views.groupBits : {},
    custom: Array.isArray(views.custom) ? views.custom : [],
  };
}

function isLedController(controller) {
  return String(controller.type || '').toUpperCase() === 'LED';
}

function ledStride(controller) {
  const led = controller.led || {};
  if (Number.isInteger(led.stride) && led.stride > 0) return led.stride;
  const order = LED_CHANNEL_ORDERS[led.order || DEFAULT_LED_ORDER];
  return order ? Object.keys(order).length : 4;
}

// ── The checker ─────────────────────────────────────────────────────────

/**
 * @param {Object} input
 * @param {string} input.scene            scene name (for `where` locators)
 * @param {Object} input.sceneConfig      parsed scene_config.yaml
 * @param {Object} input.controllers      parsed controllers.yaml
 * @param {Object} input.patches          parsed patches.yaml
 * @param {Object} input.views            parsed views.yaml
 * @param {Object} input.model            { pixelCount, pixels } from models/<scene>.js
 * @param {Object} [input.viewmasks]      { groupBits, viewMasks } from the sidecar
 * @param {Object} [input.effects]        { specialEffects } from the effects sidecar
 * @param {Object} input.fixtureDefs      fixtureType → { footprint, pixels:[{id,channels}] }
 * @param {Object} [input.pins]           config.yaml `global_effects` pin table
 * @param {Object} [input.benchScene]     { scene, sceneConfig, controllers } for §3B parity
 * @param {boolean} [input.strict]        hardware-ready mode
 * @returns {{ findings: Array, stats: Object, ok: boolean }}
 */
function checkSceneModelParity(input) {
  const scene = input.scene || '(unnamed scene)';
  const strict = !!input.strict;
  const findings = [];

  const add = (check, code, severity, where, message) => {
    findings.push({ check, code, severity, where, message });
  };
  // A policy finding: recorded state in default mode, a hard failure under
  // --strict (the deploy/hardware gate).
  const addPolicy = (check, code, baseSeverity, where, message) => {
    findings.push({
      check, code, severity: strict ? SEVERITY.ERROR : baseSeverity,
      where, message, strictOnly: true,
    });
  };

  const fixtures = readDmxFixtures(input.sceneConfig);
  const strands = readStrands(input.sceneConfig);
  const traces = readTraces(input.sceneConfig);
  const controllers = readControllers(input.controllers);
  const records = readPatchRecords(input.patches);
  const views = readViews(input.views);
  const fixtureDefs = input.fixtureDefs || {};
  const pins = input.pins || {};
  const modelPixels = Array.isArray(input.model && input.model.pixels) ? input.model.pixels : [];

  const state = {
    scene, strict, findings, add, addPolicy,
    fixtures, strands, traces, controllers, records, views, fixtureDefs, pins, modelPixels,
    model: input.model || {},
    viewmasks: input.viewmasks || null,
    effects: input.effects || null,
    benchScene: input.benchScene || null,
  };

  checkSceneIdentity(state);
  checkGeneratorSplits(state);
  const roster = buildExpectedRoster(state);
  checkCoverage(state, roster);
  const wiring = buildWiring(state);
  checkPlaceholders(state, wiring);
  checkWiringAndPatches(state, wiring);
  checkPatchTruth(state, roster, wiring);
  checkAddressHygiene(state, wiring);
  checkMetadata(state, roster);
  checkViews(state);
  checkEffectsSidecar(state, wiring);
  checkBenchParity(state);

  const stats = {
    scene,
    strict,
    errors: findings.filter((f) => f.severity === SEVERITY.ERROR).length,
    warnings: findings.filter((f) => f.severity === SEVERITY.WARN).length,
    infos: findings.filter((f) => f.severity === SEVERITY.INFO).length,
    sceneFixtures: fixtures.length,
    sceneStrands: strands.length,
    modelPixels: modelPixels.length,
    expectedPixels: roster.pixels.length,
    controllers: controllers.length,
  };
  return { findings, stats, ok: stats.errors === 0 };
}

// ── 0. Scene identity — names are the join key for everything below ──────

function checkSceneIdentity(state) {
  const seen = new Map();
  const note = (kind, name) => {
    if (seen.has(name)) {
      state.add(CHECKS.COVERAGE, 'duplicate_scene_name', SEVERITY.ERROR,
        `scene_config.yaml ${kind} '${name}'`,
        `name '${name}' is used by more than one scene entry (${seen.get(name)} and ${kind}) — ` +
        'fixture names are the join key for patches.yaml, the chains in controllers.yaml and ' +
        'every model pixel, so a duplicate makes the mapping ambiguous. Rename one.');
    } else {
      seen.set(name, kind);
    }
  };
  for (const f of state.fixtures) note('DMX fixture', f.name);
  for (const s of state.strands) note('LED strand', s.name);

  for (const s of state.strands) {
    if (strandGroupKey(s).length === 0) {
      state.add(CHECKS.COVERAGE, 'strand_without_key', SEVERITY.ERROR,
        `scene_config.yaml LED strand (unnamed)`,
        'an LED strand has neither a non-empty `group` nor a non-empty `name` — it has no ' +
        'stable group key, so its section id and view bit cannot be derived (led_metadata.js ' +
        'throws on this at export time).');
    }
    const count = s.ledCount;
    if (!Number.isInteger(count) || count < 1) {
      state.add(CHECKS.COVERAGE, 'strand_bad_led_count', SEVERITY.ERROR,
        `scene_config.yaml LED strand '${s.name}'`,
        `ledCount is ${JSON.stringify(count)} — must be a positive integer.`);
    }
  }
}

// ── 0b. Generator chain splits — the wiring order is well-formed ─────────
//
// A DMX trace generator may carry `chainSplits: [{from, to}…]` — the physical
// daisy-chain walk over its 1..count path positions (design 20260725_41 §3).
// Generation permutes fixture NUMBERS through that walk, so a malformed list
// means the generator refuses to run and the scene's generated fixture rows
// are stale the moment anyone opens the sim.
//
// The EFFECT of valid splits needs no teaching here: they materialize as
// ordinary `{fixture, at}` chain entries, which the drift / patch-truth /
// coverage families already validate. Only the INTENT — the declaration in
// scene_config.yaml — is new, so this is the one added rule.
//
// Re-stated INDEPENDENTLY of `src/dmx/generator_chain_order.js`, per this
// module's design rule (a gate that imports the code it audits agrees with
// that code's bugs). Rules, verbatim from §3.3: endpoints are integers within
// 1..count; every position is covered EXACTLY once; an empty array is invalid
// and is never read as "absent".
function checkGeneratorSplits(state) {
  for (let t = 0; t < state.traces.length; t++) {
    const trace = state.traces[t];
    if (!('chainSplits' in trace) || trace.chainSplits === null ||
        trace.chainSplits === undefined) {
      continue; // absent = plain path order = nothing to check
    }
    const label = trace.name || trace.groupName || `traces[${t}]`;
    const where = `scene_config.yaml trace '${label}'`;
    const bad = (message) => state.add(CHECKS.GENERATOR_SPLITS, 'invalid_cover',
      SEVERITY.ERROR, where, message);

    const count = trace.count;
    if (!Number.isInteger(count) || count < 1) {
      bad(`carries chainSplits but count is ${JSON.stringify(count)} — the splits declare a ` +
        'walk over 1..count, so without a positive integer count they cannot mean anything. ' +
        'Fix the trace count or remove chainSplits.');
      continue;
    }

    const splits = trace.chainSplits;
    if (!Array.isArray(splits)) {
      bad(`chainSplits must be a list of {from, to} ranges (got ${typeof splits}).`);
      continue;
    }
    if (splits.length === 0) {
      bad('chainSplits is an EMPTY list. That is not the same as omitting the field: it ' +
        'declares a chain order covering nothing. Remove the field to use plain path ' +
        'order, or declare ranges covering 1..' + count + '.');
      continue;
    }

    let shapeError = null;
    for (let s = 0; s < splits.length && !shapeError; s++) {
      const split = splits[s];
      if (split === null || typeof split !== 'object' || Array.isArray(split)) {
        shapeError = `split ${s + 1} is not a {from, to} object.`;
        break;
      }
      for (const key of ['from', 'to']) {
        const v = split[key];
        if (!Number.isInteger(v)) {
          shapeError = `split ${s + 1}: ${key}=${JSON.stringify(v)} is not an integer.`;
          break;
        }
        if (v < 1 || v > count) {
          shapeError = `split ${s + 1}: ${key}=${v} is outside the trace's 1..${count} ` +
            'path positions.';
          break;
        }
      }
    }
    if (shapeError) {
      bad(`${shapeError} chainSplits endpoints are 1-based path positions and must be ` +
        `integers within 1..${count}.`);
      continue;
    }

    const coveredBy = new Map();
    let overlap = null;
    for (let s = 0; s < splits.length && !overlap; s++) {
      const { from, to } = splits[s];
      const step = from <= to ? 1 : -1;
      for (let p = from; ; p += step) {
        if (coveredBy.has(p)) {
          overlap = `position ${p} is covered twice (splits ${coveredBy.get(p)} and ${s + 1})`;
          break;
        }
        coveredBy.set(p, s + 1);
        if (p === to) break;
      }
    }
    if (overlap) {
      bad(`${overlap} — chainSplits must cover 1..${count} EXACTLY once, so the same light ` +
        'can never take two chain numbers.');
      continue;
    }

    const missing = [];
    for (let p = 1; p <= count; p++) if (!coveredBy.has(p)) missing.push(p);
    if (missing.length > 0) {
      const shown = missing.slice(0, 12).join(', ');
      const rest = missing.length > 12 ? `, … and ${missing.length - 12} more` : '';
      bad(`path position(s) {${shown}${rest}} are not covered by any split — chainSplits ` +
        `must cover 1..${count} exactly once, so every light gets a chain number. The ` +
        'generator refuses to (re)generate until this is fixed.');
    }
  }
}

// ── 1. Coverage — the expected pixel roster, in export order ─────────────

function buildExpectedRoster(state) {
  const pixels = [];          // expected model pixels, in exporter order
  const owners = new Map();   // fixture/strand name → { kind, def, first, count }
  const effectsFixtures = []; // exported to <scene>.effects.js instead

  for (const f of state.fixtures) {
    const def = state.fixtureDefs[f.fixtureType];
    if (!def) {
      state.add(CHECKS.COVERAGE, 'missing_fixture_def', SEVERITY.ERROR,
        `fixture '${f.name}'`,
        `fixtureType '${f.fixtureType}' has no definition under simulation/dmx/fixtures/ — the ` +
        'exporter cannot resolve it and SKIPS its pixels, so this fixture can never be driven. ' +
        'Add the model YAML or fix the fixtureType.');
      continue;
    }
    const defPixels = Array.isArray(def.pixels) ? def.pixels : [];
    if (defPixels.length > 0) {
      const first = pixels.length;
      defPixels.forEach((dp, j) => {
        pixels.push({
          type: 'dmx',
          fixtureType: f.fixtureType,
          name: `${f.name} - ${dp.id}`,
          group: f.group || '',
          localIndex: j,
          channels: standardizeChannels(dp.channels),
          owner: f.name,
        });
      });
      owners.set(f.name, { kind: 'dmx', def, first, count: defPixels.length, config: f });
      continue;
    }
    if (isEffectsFixtureType(f.fixtureType)) {
      effectsFixtures.push(f);
      owners.set(f.name, { kind: 'effect', def, first: -1, count: 0, config: f });
      continue;
    }
    state.add(CHECKS.COVERAGE, 'indeterminate_export_shape', SEVERITY.WARN,
      `fixture '${f.name}'`,
      `fixtureType '${f.fixtureType}' has a definition with ZERO pixels and is not a global ` +
      'effect, so its exported shape depends on the live 3D runtime (the exporter\'s ' +
      'simple-fixture branch) and cannot be predicted offline. This validator does not check ' +
      'it — verify it by hand, or give the definition explicit pixels.');
    owners.set(f.name, { kind: 'indeterminate', def, first: -1, count: 0, config: f });
  }

  for (const s of state.strands) {
    const count = Number.isInteger(s.ledCount) && s.ledCount > 0 ? s.ledCount : 0;
    const group = strandGroupKey(s);
    const first = pixels.length;
    for (let j = 0; j < count; j++) {
      pixels.push({
        type: 'led',
        fixtureType: '',
        name: s.name,
        group,
        localIndex: j,
        channels: undefined,   // resolved from the owning controller in patch truth
        owner: s.name,
      });
    }
    owners.set(s.name, { kind: 'led', def: null, first, count, config: s });
  }

  return { pixels, owners, effectsFixtures };
}

function checkCoverage(state, roster) {
  const expected = roster.pixels;
  const actual = state.modelPixels;

  // pixelCount export vs the array it describes (engine sizes WASM buffers
  // off `pixelCount`; a disagreement corrupts every downstream lane).
  const declared = state.model.pixelCount;
  if (declared !== actual.length) {
    state.add(CHECKS.DRIFT, 'pixel_count_export_mismatch', SEVERITY.ERROR,
      `models/${state.scene}.js`,
      `exported \`pixelCount\` is ${declared} but the \`pixels\` array has ${actual.length} ` +
      'entries — the engine sizes its WASM buffers from pixelCount. Re-export the model.');
  }

  if (expected.length !== actual.length) {
    state.add(CHECKS.COVERAGE, 'pixel_roster_size', SEVERITY.ERROR,
      `models/${state.scene}.js`,
      `the scene describes ${expected.length} pixels (${state.fixtures.length} DMX fixtures + ` +
      `${state.strands.length} LED strands, per their fixture definitions) but the model has ` +
      `${actual.length} — the model is STALE or an export was skipped. Re-open the scene in ` +
      'the sim and save (💾) to regenerate.');
    reportRosterSetDiff(state, expected, actual);
    return;
  }

  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i] || {};
    const fields = [];
    if (a.name !== e.name) fields.push(`name '${a.name}' ≠ '${e.name}'`);
    if ((a.group || '') !== e.group) fields.push(`group '${a.group}' ≠ '${e.group}'`);
    if (a.type !== e.type) fields.push(`type '${a.type}' ≠ '${e.type}'`);
    if ((a.fixtureType || '') !== e.fixtureType) {
      fields.push(`fixtureType '${a.fixtureType}' ≠ '${e.fixtureType}'`);
    }
    if ((a.localIndex || 0) !== e.localIndex) {
      fields.push(`localIndex ${a.localIndex} ≠ ${e.localIndex}`);
    }
    if (e.type === 'dmx' && e.channels !== undefined && !deepEqual(a.channels || null, e.channels)) {
      fields.push(`channels ${JSON.stringify(a.channels)} ≠ ${JSON.stringify(e.channels)} ` +
        '(from the fixture definition)');
    }
    if (fields.length > 0) {
      state.add(CHECKS.COVERAGE, 'pixel_field_mismatch', SEVERITY.ERROR,
        `models/${state.scene}.js pixel i=${i} ('${e.owner}')`,
        `model pixel disagrees with the scene: ${fields.join('; ')}. Re-export the model.`);
    }
  }
}

function reportRosterSetDiff(state, expected, actual) {
  const tally = (list) => {
    const m = new Map();
    for (const p of list) m.set(p.name, (m.get(p.name) || 0) + 1);
    return m;
  };
  const want = tally(expected);
  const got = tally(actual);
  for (const [name, n] of want) {
    const have = got.get(name) || 0;
    if (have !== n) {
      state.add(CHECKS.COVERAGE, 'pixel_missing_from_model', SEVERITY.ERROR,
        `pixel group '${name}'`,
        `the scene expects ${n} model pixel(s) named '${name}', the model has ${have}.`);
    }
  }
  for (const [name, n] of got) {
    if (!want.has(name)) {
      state.add(CHECKS.COVERAGE, 'pixel_absent_from_scene', SEVERITY.ERROR,
        `pixel group '${name}'`,
        `the model carries ${n} pixel(s) named '${name}' that no scene fixture or strand ` +
        'produces — the model is stale (fixture deleted or renamed since the last export).');
    }
  }
}

// ── Wiring — controllers.yaml resolved into per-fixture expectations ─────

function buildWiring(state) {
  const byName = new Map();          // fixture/strand name → wiring entry
  const controllerByIp = new Map();
  const ordinalOf = new Map();       // controller object → 1-based panel ordinal
  const dead = new Set();            // controllers whose fixtures cannot send

  state.controllers.forEach((c, i) => ordinalOf.set(c, i + 1));

  for (const c of state.controllers) {
    const ordinal = ordinalOf.get(c);
    const where = `controllers.yaml controller #${ordinal} '${c.name}'`;
    if (!isValidIp(c.ip)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'controller_bad_ip', SEVERITY.ERROR, where,
        `IP '${c.ip}' is malformed or missing — every fixture on this controller projects ` +
        'UNPATCHED (controller_registry.js `bad_ip`). Fix the IP.');
      dead.add(c);
    } else if (controllerByIp.has(c.ip)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'controller_duplicate_ip', SEVERITY.ERROR, where,
        `IP ${c.ip} is already used by controller '${controllerByIp.get(c.ip).name}' — the ` +
        'second controller projects UNPATCHED (controller_registry.js `dup_ip`).');
      dead.add(c);
    } else {
      controllerByIp.set(c.ip, c);
    }

    const ports = Array.isArray(c.ports) ? c.ports : [];
    for (const port of ports) {
      const portWhere = `${where} port ${port && port.port}`;
      const chain = (port && Array.isArray(port.chain)) ? port.chain : [];
      if (Number.isInteger(port.universe) && (port.universe < 1 || port.universe > MAX_UNIVERSE)) {
        state.add(CHECKS.ADDRESS_HYGIENE, 'universe_out_of_range', SEVERITY.ERROR, portWhere,
          `universe ${port.universe} is outside 1–${MAX_UNIVERSE} (the sACN ceiling) — its ` +
          'fixtures project UNPATCHED.');
      }
      for (const entry of chain) {
        if (isGapEntry(entry)) continue;
        const name = entryFixtureName(entry);
        if (name === null) continue;
        // A bare string is the legacy packed DMX entry (no absolute `at:`);
        // migrateLegacyChains converts it at boot. On an LED port a bare
        // strand name is the NORMAL shape — the LED projection walks ports,
        // not per-entry addresses — so it is not flagged there.
        if (typeof entry === 'string' && !isLedController(c)) {
          state.add(CHECKS.ADDRESS_HYGIENE, 'legacy_packed_entry', SEVERITY.ERROR, portWhere,
            `chain entry '${entry}' is a legacy packed (bare string) entry with no allocated ` +
            'address — it projects UNPATCHED. Re-save the scene from the sim to migrate it.');
        }
        if (byName.has(name)) {
          state.add(CHECKS.ADDRESS_HYGIENE, 'fixture_in_two_chains', SEVERITY.ERROR, portWhere,
            `'${name}' is already chained on ${byName.get(name).portWhere} — a fixture may ` +
            'appear in exactly one chain.');
          continue;
        }
        byName.set(name, {
          name, controller: c, ordinal, port, entry, portWhere,
          isLed: isLedController(c),
          dead: dead.has(c),
        });
      }
    }
  }

  return { byName, controllerByIp, ordinalOf, dead };
}

// ── 7. Placeholder policy (plan §2) ─────────────────────────────────────

function checkPlaceholders(state, wiring) {
  for (const c of state.controllers) {
    const ordinal = wiring.ordinalOf.get(c);
    const where = `controllers.yaml controller #${ordinal} '${c.name}'`;
    const isSentinel = String(c.ip || '') === PLACEHOLDER_IP;
    const isMarked = String(c.name || '').includes(PLACEHOLDER_MARKER);
    if (isSentinel && !isMarked) {
      state.add(CHECKS.PLACEHOLDER, 'sentinel_without_marker', SEVERITY.ERROR, where,
        `IP is the ${PLACEHOLDER_IP} placeholder sentinel but the controller name does not ` +
        `contain '${PLACEHOLDER_MARKER}'. The convention is BOTH (plan 20260725_33 §2) so the ` +
        'placeholder is visible in the panel, not just in the routing table. Rename it.');
    }
    if (!isSentinel && isMarked) {
      state.add(CHECKS.PLACEHOLDER, 'marker_with_real_ip', SEVERITY.ERROR, where,
        `the name is marked ${PLACEHOLDER_MARKER} but the IP is ${c.ip} — a controller that ` +
        'claims to be a placeholder WILL transmit to that address. Either finish the wiring ' +
        `(drop the marker) or set the IP back to ${PLACEHOLDER_IP}.`);
    }
    if (isSentinel && isMarked) {
      state.addPolicy(CHECKS.PLACEHOLDER, 'placeholder_controller', SEVERITY.INFO, where,
        `placeholder controller (${PLACEHOLDER_IP}) — mapping-valid for the sim audit, ` +
        'HARDWARE-FORBIDDEN. --strict refuses it: the real IP is still unknown.');
    }
  }

  // Unpatched LED strand pixels carry the exporter's loud `unpatched: true`.
  const unpatchedByStrand = new Map();
  for (const px of state.modelPixels) {
    if (px && px.unpatched) {
      unpatchedByStrand.set(px.name, (unpatchedByStrand.get(px.name) || 0) + 1);
    }
  }
  for (const [name, count] of unpatchedByStrand) {
    state.addPolicy(CHECKS.PLACEHOLDER, 'unpatched_marker', SEVERITY.INFO,
      `strand '${name}'`,
      `${count} model pixel(s) carry the exporter's \`unpatched: true\` marker — the strand is ` +
      'bound to no LED controller and receives no sACN.');
  }
}

// ── 3/8. controllers.yaml ↔ patches.yaml ↔ scene ─────────────────────────

/** Re-derive the patch record controllers.yaml implies, independently of
 *  the sim's projection. Returns null when the fixture cannot send. */
function expectedRecordFor(state, wiring, fixture) {
  const wired = wiring.byName.get(fixture.name);
  if (!wired) return { patched: false, reason: 'not chained on any controller' };
  if (wired.dead) return { patched: false, reason: `controller '${wired.controller.name}' is unsendable` };
  if (wired.isLed) return null; // LED strands: see checkLedStrandPatch

  const entry = wired.entry;
  const def = state.fixtureDefs[fixture.fixtureType];
  const footprint = def ? def.footprint : 0;

  // Global effects are pinned by fixtureType in config.yaml, on the pin's
  // universe — NOT the port universe (controller_registry.js:1526-1560).
  if (isEffectsFixtureType(fixture.fixtureType)) {
    const pin = state.pins[fixture.fixtureType];
    if (!pin || !Number.isInteger(pin.address)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'effect_without_pin', SEVERITY.ERROR,
        `fixture '${fixture.name}' (${wired.portWhere})`,
        `global effect '${fixture.fixtureType}' has no entry in config.yaml global_effects — ` +
        'it projects UNPATCHED.');
      return { patched: false, reason: 'no global_effects pin' };
    }
    if (entry && entry.at !== pin.address) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'effect_pin_mismatch', SEVERITY.ERROR,
        `fixture '${fixture.name}' (${wired.portWhere})`,
        `global effect must be pinned at U${pin.universe}:${pin.address} (config.yaml ` +
        `global_effects) but the chain says @${entry.at} — it projects UNPATCHED.`);
      return { patched: false, reason: 'pin mismatch' };
    }
    return {
      patched: true, controllerIp: wired.controller.ip, universe: pin.universe,
      address: pin.address, controllerId: wired.ordinal, footprint,
    };
  }

  if (!entry || !Number.isInteger(entry.at)) {
    state.add(CHECKS.ADDRESS_HYGIENE, 'chain_entry_without_address', SEVERITY.ERROR,
      `fixture '${fixture.name}' (${wired.portWhere})`,
      'the chain entry has no absolute `at:` address — it projects UNPATCHED.');
    return { patched: false, reason: 'no address' };
  }
  if (entry.at < 1 || entry.at + footprint - 1 > DMX_UNIVERSE_SIZE) {
    state.add(CHECKS.ADDRESS_HYGIENE, 'address_out_of_universe', SEVERITY.ERROR,
      `fixture '${fixture.name}' (${wired.portWhere})`,
      `@${entry.at} with a ${footprint}-channel footprint spans ch ` +
      `${entry.at}–${entry.at + footprint - 1}, outside 1–${DMX_UNIVERSE_SIZE} — it projects ` +
      'UNPATCHED. Move it or split the fixture to another universe.');
    return { patched: false, reason: 'address out of range' };
  }
  if (portUniverse(wired) === EFFECTS_UNIVERSE) {
    state.add(CHECKS.ADDRESS_HYGIENE, 'non_effect_on_effects_universe', SEVERITY.ERROR,
      `fixture '${fixture.name}' (${wired.portWhere})`,
      `universe ${EFFECTS_UNIVERSE} is reserved for global effects (pinned addresses); a ` +
      'normal fixture there projects UNPATCHED.');
    return { patched: false, reason: 'non-effect on the effects universe' };
  }
  return {
    patched: true, controllerIp: wired.controller.ip, universe: portUniverse(wired),
    address: entry.at, controllerId: wired.ordinal, footprint,
  };
}

function portUniverse(wired) {
  return wired.port && Number.isInteger(wired.port.universe) ? wired.port.universe : 0;
}

function checkWiringAndPatches(state, wiring) {
  const sceneNames = new Set([
    ...state.fixtures.map((f) => f.name),
    ...state.strands.map((s) => s.name),
  ]);

  // Chain entries must name something that exists in the scene, and an LED
  // chain must carry strands (and a DMX chain, fixtures).
  for (const [name, wired] of wiring.byName) {
    if (!sceneNames.has(name)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'orphan_chain_entry', SEVERITY.ERROR, wired.portWhere,
        `chain entry '${name}' does not resolve to any fixture or LED strand in ` +
        'scene_config.yaml — drop the entry or fix the name.');
      continue;
    }
    const isStrand = state.strands.some((s) => s.name === name);
    if (wired.isLed && !isStrand) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'dmx_fixture_on_led_controller', SEVERITY.ERROR,
        wired.portWhere,
        `'${name}' is a DMX fixture but is chained on LED controller ` +
        `'${wired.controller.name}' — LED chains carry strand names only.`);
    }
    if (!wired.isLed && isStrand) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'strand_on_dmx_controller', SEVERITY.ERROR,
        wired.portWhere,
        `'${name}' is an LED strand but is chained on DMX controller ` +
        `'${wired.controller.name}' — strands need an LED-type controller.`);
    }
  }

  // Every fixture and strand must be mapped: an unmapped one emits no sACN
  // at all, which is exactly the "no data from sacn_in" symptom.
  for (const f of state.fixtures) {
    if (!wiring.byName.has(f.name)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'unmapped_fixture', SEVERITY.ERROR,
        `fixture '${f.name}' (group '${f.group || ''}')`,
        'is not chained on any controller in controllers.yaml — it has no universe/address, ' +
        'so the engine never transmits for it and the sim paints it undriven. Map it in the ' +
        'Controller Mapping panel.');
    }
  }
  for (const s of state.strands) {
    if (!wiring.byName.has(s.name)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'unmapped_strand', SEVERITY.ERROR,
        `strand '${s.name}' (${s.ledCount} px)`,
        'is not chained on any LED controller in controllers.yaml — it exports unpatched and ' +
        'receives no sACN. Bind it to an LED controller.');
    }
  }

  // patches.yaml key set ↔ scene.
  for (const name of state.records.keys()) {
    if (!sceneNames.has(name)) {
      state.add(CHECKS.DRIFT, 'orphan_patch_record', SEVERITY.ERROR,
        `patches.yaml '${name}'`,
        'records a fixture/strand that no longer exists in scene_config.yaml — patches.yaml is ' +
        'stale. Re-save the scene.');
    }
  }
  for (const f of state.fixtures) {
    if (!state.records.has(f.name)) {
      state.add(CHECKS.DRIFT, 'missing_patch_record', SEVERITY.ERROR,
        `patches.yaml '${f.name}'`,
        'every DMX fixture gets a record (zeroed when unpatched); this one has none. ' +
        'patches.yaml is stale — re-save the scene.');
    }
  }

  // patches.yaml must equal what controllers.yaml implies. Hand-editing
  // patches.yaml is futile (the boot projection wipes it back) — a
  // disagreement here means someone tried, or the file is stale.
  for (const f of state.fixtures) {
    const record = state.records.get(f.name);
    if (!record) continue;
    const expected = expectedRecordFor(state, wiring, f);
    if (expected === null) continue;
    const got = {
      controllerIp: record.controllerIp || '',
      universe: record.dmxUniverse || 0,
      address: record.dmxAddress || 0,
      controllerId: record.controllerId || 0,
    };
    const want = expected.patched
      ? {
        controllerIp: expected.controllerIp, universe: expected.universe,
        address: expected.address, controllerId: expected.controllerId,
      }
      : { controllerIp: '', universe: 0, address: 0, controllerId: 0 };
    if (!shallowEqualMaps(want, got)) {
      state.add(CHECKS.DRIFT, 'patch_record_disagrees_with_chains', SEVERITY.ERROR,
        `patches.yaml '${f.name}'`,
        `records ${got.controllerIp || '(no ip)'} U${got.universe}:${got.address} cId ` +
        `${got.controllerId}, but controllers.yaml implies ${want.controllerIp || '(no ip)'} ` +
        `U${want.universe}:${want.address} cId ${want.controllerId}` +
        (expected.patched ? '' : ` (${expected.reason})`) +
        '. controllers.yaml is the authoring surface — patches.yaml is derived from it and ' +
        'is rewritten on every sim boot, so this file is stale or was hand-edited.');
    }
  }
}

// ── 2. Patch truth — patches.yaml ↔ model, per fixture and per strand ────

function checkPatchTruth(state, roster, wiring) {
  for (const f of state.fixtures) {
    const owner = roster.owners.get(f.name);
    if (!owner || owner.kind !== 'dmx') continue;
    const record = state.records.get(f.name) || {};
    const patched = (record.dmxUniverse > 0) && (record.dmxAddress > 0);
    const footprint = owner.def.footprint;
    const want = patched
      ? { universe: record.dmxUniverse, addr: record.dmxAddress, footprint }
      : null;

    for (let k = 0; k < owner.count; k++) {
      const px = state.modelPixels[owner.first + k];
      if (!px) continue;   // roster-size mismatch already reported
      const got = px.patch || null;
      const same = (want === null && got === null) ||
        (want !== null && got !== null && want.universe === got.universe &&
          want.addr === got.addr && want.footprint === got.footprint && !got.led);
      if (!same) {
        state.add(CHECKS.PATCH_TRUTH, 'dmx_patch_mismatch', SEVERITY.ERROR,
          `fixture '${f.name}' model pixel i=${owner.first + k}`,
          `model patch ${fmtPatch(got)} ≠ patches.yaml ${fmtPatch(want)} ` +
          `(footprint ${footprint} from the ${f.fixtureType} definition). The model is stale ` +
          'or the footprint changed — re-export.');
        break; // one message per fixture; the whole fixture shares one patch
      }
    }
  }

  for (const s of state.strands) {
    checkLedStrandPatch(state, roster, wiring, s);
  }
}

function checkLedStrandPatch(state, roster, wiring, strand) {
  const owner = roster.owners.get(strand.name);
  if (!owner || owner.kind !== 'led') return;
  const where = `strand '${strand.name}'`;
  const record = state.records.get(strand.name);
  const wired = wiring.byName.get(strand.name);
  const pixels = [];
  for (let k = 0; k < owner.count; k++) {
    const px = state.modelPixels[owner.first + k];
    if (px) pixels.push(px);
  }
  if (pixels.length === 0) return;

  const patchedInModel = pixels.some((px) => px.patch);
  const hasRecord = !!record && (record.dmxUniverse > 0) && (record.dmxAddress > 0);

  if (!hasRecord) {
    if (patchedInModel) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_model_patched_without_record', SEVERITY.ERROR, where,
        'the model carries sACN addresses for this strand but patches.yaml has no patched ' +
        'record for it — the model is stale relative to the scene.');
    }
    if (!pixels.every((px) => px.unpatched === true)) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_missing_unpatched_marker', SEVERITY.ERROR, where,
        'the strand is unpatched but its model pixels do not all carry the loud ' +
        '`unpatched: true` marker the exporter must emit (codex P0: no silent skip).');
    }
    return;
  }
  if (!patchedInModel) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_record_without_model_patch', SEVERITY.ERROR, where,
      `patches.yaml patches this strand at U${record.dmxUniverse}:${record.dmxAddress} but ` +
      'every model pixel is unpatched — the model is STALE. Re-export.');
    return;
  }

  // Record ↔ scene ↔ model pixel counts.
  if (record.pixelCount !== undefined && record.pixelCount !== owner.count) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_pixel_count_mismatch', SEVERITY.ERROR, where,
      `patches.yaml records pixelCount ${record.pixelCount} but scene_config.yaml says ` +
      `ledCount ${owner.count} — re-save the scene.`);
  }

  // Stride: the model's own footprint, cross-checked against the controller.
  const stride = pixels[0].patch.footprint;
  if (!Number.isInteger(stride) || stride < 1) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_bad_stride', SEVERITY.ERROR, where,
      `model pixel footprint (stride) is ${JSON.stringify(stride)} — must be a positive integer.`);
    return;
  }
  if (wired && wired.isLed) {
    const want = ledStride(wired.controller);
    if (want !== stride) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_stride_mismatch', SEVERITY.ERROR, where,
        `model stride ${stride} ≠ ${want} implied by LED controller ` +
        `'${wired.controller.name}' (order ${(wired.controller.led || {}).order || DEFAULT_LED_ORDER}). ` +
        'Re-export the model.');
    }
    const order = (wired.controller.led || {}).order || DEFAULT_LED_ORDER;
    const orderMap = LED_CHANNEL_ORDERS[order];
    if (!orderMap) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_unknown_channel_order', SEVERITY.ERROR, where,
        `LED controller '${wired.controller.name}' declares channel order '${order}', which is ` +
        `not one of ${Object.keys(LED_CHANNEL_ORDERS).join(', ')}.`);
    } else if (!deepEqual(pixels[0].channels || null, orderMap)) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_channel_map_mismatch', SEVERITY.ERROR, where,
        `model channels ${JSON.stringify(pixels[0].channels)} ≠ ${JSON.stringify(orderMap)} ` +
        `for order '${order}'. Re-export the model.`);
    }
    const led = wired.controller.led || {};
    if (led.whiteMode !== undefined && pixels[0].whiteMode !== led.whiteMode) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_white_mode_mismatch', SEVERITY.ERROR, where,
        `model whiteMode '${pixels[0].whiteMode}' ≠ controller '${led.whiteMode}'.`);
    }
    if (led.wire && !authoredSubsetMatches(led.wire, pixels[0].ledWire)) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_wire_mismatch', SEVERITY.ERROR, where,
        `the controller's \`led.wire\` block is not reflected in the model's \`ledWire\`: ` +
        `model has ${JSON.stringify(pixels[0].ledWire)}, controller authored ` +
        `${JSON.stringify(led.wire)}. Re-export the model.`);
    }
  }

  // The no-straddle contiguous walk (led_patch_projection.js
  // projectLedStrandPixels): pixel 0 sits at the record's start; each next
  // pixel advances `stride` bytes; a pixel that would cross ch 512 rolls to
  // channel 1 of the next universe, leaving the tail bytes unused.
  let universe = record.dmxUniverse;
  let addr = record.dmxAddress;
  for (let k = 0; k < pixels.length; k++) {
    if (addr + stride - 1 > DMX_UNIVERSE_SIZE) {
      universe += 1;
      addr = 1;
    }
    const got = pixels[k].patch;
    if (!got || got.universe !== universe || got.addr !== addr || got.footprint !== stride ||
        got.led !== true) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_walk_mismatch', SEVERITY.ERROR,
        `${where} pixel ${k} (model i=${owner.first + k})`,
        `model patch ${fmtPatch(got)} ≠ the contiguous walk's U${universe}:${addr}+${stride} led. ` +
        `The walk starts at patches.yaml U${record.dmxUniverse}:${record.dmxAddress} and ` +
        'advances by whole pixels, wrapping to ch 1 of the next universe rather than straddling ' +
        `ch ${DMX_UNIVERSE_SIZE}. The model disagrees with the scene — re-export.`);
      return;
    }
    if (universe > MAX_UNIVERSE) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'strand_universe_overflow', SEVERITY.ERROR, where,
        `the strand spills past the sACN universe ceiling ${MAX_UNIVERSE} at pixel ${k}.`);
      return;
    }
    addr += stride;
  }
  const endUniverse = universe;
  const endChannel = addr - 1;
  if (record.endUniverse !== undefined && record.endUniverse !== endUniverse) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_end_universe_mismatch', SEVERITY.ERROR, where,
      `patches.yaml endUniverse ${record.endUniverse} ≠ ${endUniverse} implied by ` +
      `${pixels.length} px × ${stride} B from U${record.dmxUniverse}:${record.dmxAddress}.`);
  }
  if (record.endChannel !== undefined && record.endChannel !== endChannel) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_end_channel_mismatch', SEVERITY.ERROR, where,
      `patches.yaml endChannel ${record.endChannel} ≠ ${endChannel} implied by ` +
      `${pixels.length} px × ${stride} B from U${record.dmxUniverse}:${record.dmxAddress}.`);
  }
  checkStrandSegments(state, where, record, pixels, stride);

  if (wired && wired.isLed && record.controllerIp !== wired.controller.ip) {
    state.add(CHECKS.DRIFT, 'strand_controller_ip_mismatch', SEVERITY.ERROR, where,
      `patches.yaml controllerIp '${record.controllerIp}' ≠ controllers.yaml ` +
      `'${wired.controller.ip}' for LED controller '${wired.controller.name}'.`);
  }
}

function checkStrandSegments(state, where, record, pixels, stride) {
  if (!Array.isArray(record.segments)) return;
  const bySegment = [];
  let current = null;
  for (const px of pixels) {
    const p = px.patch;
    if (!current || current.universe !== p.universe) {
      current = { universe: p.universe, startChannel: p.addr, endChannel: p.addr + stride - 1, pixelCount: 0 };
      bySegment.push(current);
    }
    current.endChannel = p.addr + stride - 1;
    current.pixelCount += 1;
  }
  if (bySegment.length !== record.segments.length) {
    state.add(CHECKS.PATCH_TRUTH, 'strand_segment_count_mismatch', SEVERITY.ERROR, where,
      `patches.yaml lists ${record.segments.length} segment(s) but the model's pixels span ` +
      `${bySegment.length} universe run(s).`);
    return;
  }
  for (let i = 0; i < bySegment.length; i++) {
    const want = bySegment[i];
    const got = record.segments[i];
    const diffs = [];
    for (const key of ['universe', 'startChannel', 'endChannel', 'pixelCount']) {
      if (got[key] !== want[key]) diffs.push(`${key} ${got[key]} ≠ ${want[key]}`);
    }
    if (diffs.length > 0) {
      state.add(CHECKS.PATCH_TRUTH, 'strand_segment_mismatch', SEVERITY.ERROR,
        `${where} segment ${i}`,
        `patches.yaml segment disagrees with the model's pixels: ${diffs.join('; ')}.`);
    }
  }
}

// ── 3. Address hygiene — channel occupancy across the whole scene ────────

function checkAddressHygiene(state, wiring) {
  // Claims keyed by universe, carrying the destination IP: two fixtures on
  // ONE wire at overlapping channels is always wrong; the same universe on
  // two DIFFERENT controllers is allowed by design (independent unicast
  // targets) but mirrors identical bytes to both — an authoring smell.
  const claims = new Map();
  const push = (universe, ip, start, end, owner) => {
    if (!claims.has(universe)) claims.set(universe, []);
    claims.get(universe).push({ ip, start, end, owner });
  };

  for (const f of state.fixtures) {
    const record = state.records.get(f.name);
    if (!record || !(record.dmxUniverse > 0) || !(record.dmxAddress > 0)) continue;
    const def = state.fixtureDefs[f.fixtureType];
    const footprint = def ? def.footprint : 0;
    if (footprint < 1) continue;
    const start = record.dmxAddress;
    const end = start + footprint - 1;
    if (start < 1 || end > DMX_UNIVERSE_SIZE) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'patch_address_out_of_range', SEVERITY.ERROR,
        `fixture '${f.name}'`,
        `patches.yaml puts it at U${record.dmxUniverse}:${start}, spanning ch ${start}–${end} ` +
        `with its ${footprint}-channel footprint — outside 1–${DMX_UNIVERSE_SIZE}.`);
      continue;
    }
    if (isEffectsFixtureType(f.fixtureType)) continue; // gang-fire pins share addresses by design
    push(record.dmxUniverse, record.controllerIp || '', start, end, `fixture '${f.name}'`);
  }

  for (const s of state.strands) {
    const record = state.records.get(s.name);
    if (!record || !(record.dmxUniverse > 0)) continue;
    const segments = Array.isArray(record.segments) ? record.segments : [];
    for (const seg of segments) {
      push(seg.universe, record.controllerIp || '', seg.startChannel, seg.endChannel,
        `strand '${s.name}'`);
    }
  }

  for (const [universe, list] of claims) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.owner.localeCompare(b.owner));
    for (let i = 1; i < sorted.length; i++) {
      for (let j = i - 1; j >= 0; j--) {
        const a = sorted[j];
        const b = sorted[i];
        if (a.end < b.start) continue;
        const sameWire = a.ip === b.ip;
        const detail = `U${universe}: ${b.owner} (ch ${b.start}–${b.end}) overlaps ${a.owner} ` +
          `(ch ${a.start}–${a.end})`;
        if (sameWire) {
          state.add(CHECKS.ADDRESS_HYGIENE, 'duplicate_address', SEVERITY.ERROR,
            `${a.owner} vs ${b.owner}`,
            `${detail} on the SAME controller ${a.ip || '(no ip)'} — the two fixtures fight over ` +
            'the same channels. Re-address one.');
        } else {
          state.addPolicy(CHECKS.ADDRESS_HYGIENE, 'shared_universe_overlap', SEVERITY.WARN,
            `${a.owner} vs ${b.owner}`,
            `${detail}, on DIFFERENT controllers (${a.ip || '(no ip)'} vs ${b.ip || '(no ip)'}). ` +
            'That is legal — controllers are independent unicast targets — but the engine ' +
            'renders ONE buffer per universe, so both fixtures receive identical bytes. ' +
            'Intentional mirroring, or an addressing mistake?');
        }
      }
    }
  }
}

// ── 4. Metadata — controller / section / fixture ids ─────────────────────

function checkMetadata(state, roster) {
  const groupsBySid = new Map();   // sId → Set(group)
  const sidsByGroup = new Map();   // group → Set(sId)
  const ownersByFid = new Map();   // fId → Set(owning fixture/strand name)
  const sidTypes = new Map();      // sId → Set('dmx'|'led')
  const fidTypes = new Map();      // fId → Set('dmx'|'led')

  // Model pixel index → the fixture/strand that produced it. fId identifies a
  // FIXTURE, so a multi-pixel fixture sharing one fId is correct; only two
  // distinct OWNERS on one fId is a collision.
  const ownerOfIndex = [];
  for (const [name, owner] of roster.owners) {
    if (owner.first < 0) continue;
    for (let k = 0; k < owner.count; k++) ownerOfIndex[owner.first + k] = name;
  }

  for (let i = 0; i < state.modelPixels.length; i++) {
    const px = state.modelPixels[i];
    if (!px) continue;
    const ownerName = ownerOfIndex[i] || px.name;
    const patched = !!px.patch;
    if (patched && !(px.cId > 0)) {
      state.add(CHECKS.METADATA, 'patched_pixel_without_controller_id', SEVERITY.ERROR,
        `model pixel i=${i} ('${px.name}')`,
        'is patched but carries cId 0 — the controller id (panel ordinal) is missing, so any ' +
        'per-controller routing or UI grouping treats it as unowned.');
    }
    if (patched && !(px.sId > 0)) {
      state.add(CHECKS.METADATA, 'patched_pixel_without_section_id', SEVERITY.ERROR,
        `model pixel i=${i} ('${px.name}')`,
        'is patched but carries sId 0 — it belongs to no section, so it is invisible to the ' +
        'CaptainPad Dimmer Rack and every section-keyed mask.');
    }
    if (patched && !(px.fId > 0)) {
      state.add(CHECKS.METADATA, 'patched_pixel_without_fixture_id', SEVERITY.ERROR,
        `model pixel i=${i} ('${px.name}')`,
        'is patched but carries fId 0 — it has no fixture identity for per-fixture effects.');
    }
    if (px.sId > 0) {
      if (!groupsBySid.has(px.sId)) groupsBySid.set(px.sId, new Set());
      groupsBySid.get(px.sId).add(px.group || '');
      const g = px.group || '';
      if (!sidsByGroup.has(g)) sidsByGroup.set(g, new Set());
      sidsByGroup.get(g).add(px.sId);
      if (!sidTypes.has(px.sId)) sidTypes.set(px.sId, new Set());
      sidTypes.get(px.sId).add(px.type);
    }
    if (px.fId > 0) {
      if (!ownersByFid.has(px.fId)) ownersByFid.set(px.fId, new Set());
      ownersByFid.get(px.fId).add(ownerName);
      if (!fidTypes.has(px.fId)) fidTypes.set(px.fId, new Set());
      fidTypes.get(px.fId).add(px.type);
    }
  }

  for (const [sid, groups] of groupsBySid) {
    if (groups.size > 1) {
      state.add(CHECKS.METADATA, 'section_id_spans_groups', SEVERITY.ERROR,
        `sectionId ${sid}`,
        `is shared by ${groups.size} groups [${[...groups].join(', ')}] — a section maps to ` +
        'exactly one group. Any section-keyed control (Dimmer Rack, saved per-section state) ' +
        'now drives all of them at once.');
    }
  }
  for (const [group, sids] of sidsByGroup) {
    if (sids.size > 1) {
      state.add(CHECKS.METADATA, 'group_spans_section_ids', SEVERITY.ERROR,
        `group '${group}'`,
        `carries ${sids.size} different section ids [${[...sids].join(', ')}] — the group→section ` +
        'mapping must be bijective.');
    }
  }
  for (const [fid, names] of ownersByFid) {
    if (names.size > 1) {
      state.add(CHECKS.METADATA, 'fixture_id_collision', SEVERITY.ERROR,
        `fixtureId ${fid}`,
        `is carried by ${names.size} distinct fixtures/strands [${[...names].join(', ')}] — a ` +
        'fixture id must identify exactly one fixture. DMX and LED ids share ONE id space ' +
        '(led_metadata.js floors the LED counters at the DMX max); a collision here is the ' +
        'projectOntoConfigs DMX-only-max bug (report 20260725_4 finding 1).');
    }
  }
  for (const [sid, types] of sidTypes) {
    if (types.size > 1) {
      state.add(CHECKS.METADATA, 'section_id_dmx_led_collision', SEVERITY.ERROR,
        `sectionId ${sid}`,
        'is used by BOTH a DMX fixture and an LED strand — the two id namespaces must be ' +
        'mutually exclusive (LED ids float strictly above the DMX max).');
    }
  }
  for (const [fid, types] of fidTypes) {
    if (types.size > 1) {
      state.add(CHECKS.METADATA, 'fixture_id_dmx_led_collision', SEVERITY.ERROR,
        `fixtureId ${fid}`,
        'is used by BOTH a DMX fixture and an LED strand — the two id namespaces must be ' +
        'mutually exclusive (LED ids float strictly above the DMX max).');
    }
  }

  // Model metadata must equal the YAML it was generated from (freshness).
  for (const f of state.fixtures) {
    const owner = roster.owners.get(f.name);
    if (!owner || owner.kind !== 'dmx') continue;
    const record = state.records.get(f.name);
    if (!record) continue;
    const px = state.modelPixels[owner.first];
    if (!px) continue;
    const diffs = [];
    if ((px.cId || 0) !== (record.controllerId || 0)) diffs.push(`cId ${px.cId} ≠ ${record.controllerId || 0}`);
    if ((px.sId || 0) !== (record.sectionId || 0)) diffs.push(`sId ${px.sId} ≠ ${record.sectionId || 0}`);
    if ((px.fId || 0) !== (record.fixtureId || 0)) diffs.push(`fId ${px.fId} ≠ ${record.fixtureId || 0}`);
    if ((px.vMask || 0) !== (record.viewMask || 0)) diffs.push(`vMask ${px.vMask} ≠ ${record.viewMask || 0}`);
    if (diffs.length > 0) {
      state.add(CHECKS.DRIFT, 'metadata_drift', SEVERITY.ERROR,
        `fixture '${f.name}'`,
        `model metadata ≠ patches.yaml: ${diffs.join('; ')}. The model is stale — re-export.`);
    }
  }
  for (const s of state.strands) {
    const owner = roster.owners.get(s.name);
    if (!owner || owner.kind !== 'led') continue;
    const px = state.modelPixels[owner.first];
    if (!px) continue;
    const diffs = [];
    if ((px.sId || 0) !== (s.sectionId || 0)) diffs.push(`sId ${px.sId} ≠ ${s.sectionId || 0}`);
    if ((px.fId || 0) !== (s.fixtureId || 0)) diffs.push(`fId ${px.fId} ≠ ${s.fixtureId || 0}`);
    if ((px.vMask || 0) !== (s.viewMask || 0)) diffs.push(`vMask ${px.vMask} ≠ ${s.viewMask || 0}`);
    if (diffs.length > 0) {
      state.add(CHECKS.DRIFT, 'strand_metadata_drift', SEVERITY.ERROR,
        `strand '${s.name}'`,
        `model metadata ≠ scene_config.yaml: ${diffs.join('; ')}. The model is stale — re-export.`);
    }
  }
}

// ── 5. Views — groupBits ↔ model groups ↔ sidecar ────────────────────────

function isPowerOfTwoBit(bit) {
  return Number.isInteger(bit) && bit > 0 && bit <= MAX_VIEW_BIT && (bit & (bit - 1)) === 0;
}

function checkViews(state) {
  const modelGroups = [];
  for (const px of state.modelPixels) {
    if (px && typeof px.group === 'string' && px.group.length > 0 && !modelGroups.includes(px.group)) {
      modelGroups.push(px.group);
    }
  }
  const groupBits = state.views.groupBits;
  const declared = Object.keys(groupBits);

  for (const g of modelGroups) {
    if (groupBits[g] === undefined) {
      state.add(CHECKS.VIEWS, 'group_without_bit', SEVERITY.ERROR,
        `group '${g}'`,
        'exists in the model but has no bit in views.yaml groupBits — the engine REFUSES to ' +
        'load a model whose groups are out of sync with the sidecar (engine.js groupBits ' +
        'validation). Re-save the scene so the Views panel reconciles.');
    }
  }
  for (const g of declared) {
    if (!modelGroups.includes(g)) {
      state.add(CHECKS.VIEWS, 'stale_group_bit', SEVERITY.ERROR,
        `group '${g}'`,
        'has a bit in views.yaml groupBits but no pixel in the model carries that group — ' +
        'the engine refuses the model on this. Re-save the scene.');
    }
  }

  const usedBits = new Map();
  for (const [g, bit] of Object.entries(groupBits)) {
    if (!isPowerOfTwoBit(bit)) {
      state.add(CHECKS.VIEWS, 'bad_group_bit', SEVERITY.ERROR,
        `views.yaml groupBits['${g}']`,
        `bit ${bit} must be a power of two in 1..0x${MAX_VIEW_BIT.toString(16)}.`);
      continue;
    }
    if (usedBits.has(bit)) {
      state.add(CHECKS.VIEWS, 'duplicate_view_bit', SEVERITY.ERROR,
        `views.yaml groupBits['${g}']`,
        `bit 0x${bit.toString(16)} is already taken by '${usedBits.get(bit)}' — view bits must ` +
        'be unique within a word.');
      continue;
    }
    usedBits.set(bit, g);
  }

  const seenNames = new Set();
  const usedCustomBits = new Set();
  for (const view of state.views.custom) {
    if (!view || typeof view.name !== 'string' || view.name.length === 0) {
      state.add(CHECKS.VIEWS, 'custom_view_without_name', SEVERITY.ERROR,
        'views.yaml custom[]',
        `a custom view has no name: ${JSON.stringify(view)}.`);
      continue;
    }
    if (seenNames.has(view.name)) {
      state.add(CHECKS.VIEWS, 'duplicate_custom_view', SEVERITY.ERROR,
        `views.yaml custom view '${view.name}'`, 'the name is declared more than once.');
    }
    seenNames.add(view.name);
    for (const g of (Array.isArray(view.groups) ? view.groups : [])) {
      if (groupBits[g] === undefined) {
        state.add(CHECKS.VIEWS, 'custom_view_unknown_group', SEVERITY.ERROR,
          `views.yaml custom view '${view.name}'`,
          `references group '${g}', which has no bit in groupBits (and so no pixels). The ` +
          'engine throws on this at load.');
      }
    }
    if (view.bit !== undefined) {
      if (!isPowerOfTwoBit(view.bit)) {
        state.add(CHECKS.VIEWS, 'bad_custom_view_bit', SEVERITY.ERROR,
          `views.yaml custom view '${view.name}'`,
          `bit ${view.bit} must be a power of two in 1..0x${MAX_VIEW_BIT.toString(16)}.`);
      } else {
        const word = view.word === 1 ? 1 : 0;
        const key = `${word}:${view.bit}`;
        const priorGroup = word === 0 ? usedBits.get(view.bit) : undefined;
        if (priorGroup !== undefined) {
          state.add(CHECKS.VIEWS, 'duplicate_view_bit', SEVERITY.ERROR,
            `views.yaml custom view '${view.name}'`,
            `bit 0x${view.bit.toString(16)} (word ${word}) collides with group '${priorGroup}'.`);
        } else if (usedCustomBits.has(key)) {
          state.add(CHECKS.VIEWS, 'duplicate_view_bit', SEVERITY.ERROR,
            `views.yaml custom view '${view.name}'`,
            `bit 0x${view.bit.toString(16)} (word ${word}) is used by another custom view.`);
        }
        usedCustomBits.add(key);
      }
    }
  }

  checkViewmasksSidecar(state, groupBits);
}

function checkViewmasksSidecar(state, groupBits) {
  const sidecar = state.viewmasks;
  if (!sidecar) {
    state.add(CHECKS.VIEWS, 'missing_viewmasks_sidecar', SEVERITY.ERROR,
      `models/${state.scene}.viewmasks.js`,
      'no view-mask sidecar was found — the engine validates the model against it at load. ' +
      'Re-save the scene to regenerate.');
    return;
  }
  const sidecarBits = sidecar.groupBits || {};
  for (const [g, bit] of Object.entries(groupBits)) {
    if (sidecarBits[g] === undefined) {
      state.add(CHECKS.DRIFT, 'sidecar_missing_group', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `views.yaml declares group '${g}' (bit 0x${Number(bit).toString(16)}) but the sidecar ` +
        'does not — the sidecar is stale. Re-export.');
    } else if (sidecarBits[g] !== bit) {
      state.add(CHECKS.DRIFT, 'sidecar_bit_mismatch', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `group '${g}': sidecar bit 0x${Number(sidecarBits[g]).toString(16)} ≠ views.yaml ` +
        `0x${Number(bit).toString(16)}. Patterns compile against the sidecar — re-export.`);
    }
  }
  for (const g of Object.keys(sidecarBits)) {
    if (groupBits[g] === undefined) {
      state.add(CHECKS.DRIFT, 'sidecar_stale_group', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `the sidecar declares group '${g}', which views.yaml does not — re-export.`);
    }
  }

  const sidecarViews = Array.isArray(sidecar.viewMasks) ? sidecar.viewMasks : [];
  const byName = new Map(sidecarViews.map((v) => [v && v.name, v]));
  for (const view of state.views.custom) {
    if (!view || !view.name) continue;
    const got = byName.get(view.name);
    if (!got) {
      state.add(CHECKS.DRIFT, 'sidecar_missing_view', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `views.yaml declares custom view '${view.name}' but the sidecar does not — re-export.`);
      continue;
    }
    if (view.bit !== undefined && got.bit !== view.bit) {
      state.add(CHECKS.DRIFT, 'sidecar_view_bit_mismatch', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `custom view '${view.name}': sidecar bit 0x${Number(got.bit).toString(16)} ≠ views.yaml ` +
        `0x${Number(view.bit).toString(16)}.`);
    }
    if (Array.isArray(view.groups) && !deepEqual([...view.groups].sort(), [...(got.groups || [])].sort())) {
      state.add(CHECKS.DRIFT, 'sidecar_view_groups_mismatch', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `custom view '${view.name}': sidecar groups ${JSON.stringify(got.groups)} ≠ views.yaml ` +
        `${JSON.stringify(view.groups)}.`);
    }
  }
  for (const v of sidecarViews) {
    if (v && v.name && !state.views.custom.some((c) => c && c.name === v.name)) {
      state.add(CHECKS.DRIFT, 'sidecar_stale_view', SEVERITY.ERROR,
        `models/${state.scene}.viewmasks.js`,
        `the sidecar declares custom view '${v.name}', which views.yaml does not — re-export.`);
    }
  }
}

// ── 8. Effects sidecar ──────────────────────────────────────────────────

function checkEffectsSidecar(state, wiring) {
  const expected = state.fixtures.filter((f) => {
    const def = state.fixtureDefs[f.fixtureType];
    return def && (!Array.isArray(def.pixels) || def.pixels.length === 0) &&
      isEffectsFixtureType(f.fixtureType);
  });
  if (expected.length === 0 && !state.effects) return;
  const list = (state.effects && Array.isArray(state.effects.specialEffects))
    ? state.effects.specialEffects : [];
  const byName = new Map(list.map((fx) => [fx && fx.name, fx]));

  for (const f of expected) {
    const fx = byName.get(f.name);
    if (!fx) {
      state.add(CHECKS.DRIFT, 'effect_missing_from_sidecar', SEVERITY.ERROR,
        `models/${state.scene}.effects.js`,
        `global effect '${f.name}' (${f.fixtureType}) is in the scene but not in the effects ` +
        'sidecar — re-export.');
      continue;
    }
    const record = state.records.get(f.name) || {};
    const patched = (record.dmxUniverse > 0) && (record.dmxAddress > 0);
    const got = fx.patch || null;
    const same = patched
      ? (!!got && got.universe === record.dmxUniverse && got.addr === record.dmxAddress)
      : got === null;
    if (!same) {
      state.add(CHECKS.DRIFT, 'effect_patch_mismatch', SEVERITY.ERROR,
        `models/${state.scene}.effects.js '${f.name}'`,
        `sidecar patch ${fmtPatch(got)} ≠ patches.yaml ` +
        `${patched ? `U${record.dmxUniverse}:${record.dmxAddress}` : 'null (unpatched)'}.`);
    }
    if (!wiring.byName.has(f.name)) {
      state.add(CHECKS.ADDRESS_HYGIENE, 'unmapped_effect', SEVERITY.ERROR,
        `global effect '${f.name}'`,
        'is not chained on any controller — it has no output path.');
    }
  }
  for (const fx of list) {
    if (fx && fx.name && !expected.some((f) => f.name === fx.name)) {
      state.add(CHECKS.DRIFT, 'stale_effect_in_sidecar', SEVERITY.ERROR,
        `models/${state.scene}.effects.js`,
        `the sidecar carries '${fx.name}', which is not a global-effect fixture in the scene — ` +
        're-export.');
    }
  }
}

// ── 6. Bench-section parity (plan §3B) ──────────────────────────────────

const BENCH_PREFIX = 'TB ';

function checkBenchParity(state) {
  const bench = state.benchScene;
  const localFixtures = state.fixtures.filter((f) => f.name.startsWith(BENCH_PREFIX));
  const localGroups = new Set(state.fixtures
    .filter((f) => typeof f.group === 'string' && f.group.startsWith(BENCH_PREFIX))
    .map((f) => f.group));
  const localControllers = state.controllers.filter(
    (c) => typeof c.name === 'string' && c.name.startsWith(BENCH_PREFIX));

  if (localFixtures.length === 0 && localGroups.size === 0 && localControllers.length === 0) {
    state.add(CHECKS.BENCH_PARITY, 'no_bench_block', SEVERITY.INFO,
      `scene '${state.scene}'`,
      `carries no '${BENCH_PREFIX}'-prefixed bench block — bench-section parity is not ` +
      'applicable (plan step 6 has not been applied).');
    return;
  }
  if (!bench) {
    state.add(CHECKS.BENCH_PARITY, 'bench_source_not_supplied', SEVERITY.ERROR,
      `scene '${state.scene}'`,
      `carries a '${BENCH_PREFIX}' bench block but the test_bench source scene was not supplied ` +
      'to the validator, so the block cannot be proven in sync. Run with --bench <scene>.');
    return;
  }

  const benchFixtures = new Map(readDmxFixtures(bench.sceneConfig).map((f) => [f.name, f]));
  const benchStrands = new Map(readStrands(bench.sceneConfig).map((s) => [s.name, s]));
  const benchControllers = new Map(readControllers(bench.controllers).map((c) => [c.name, c]));

  for (const f of localFixtures) {
    const sourceName = f.name.slice(BENCH_PREFIX.length);
    const src = benchFixtures.get(sourceName);
    if (!src) {
      state.add(CHECKS.BENCH_PARITY, 'bench_fixture_not_in_source', SEVERITY.ERROR,
        `fixture '${f.name}'`,
        `has no counterpart '${sourceName}' in the ${bench.scene} scene — the bench block is a ` +
        'DERIVED copy; the bench scene is the single source of truth. Re-run the sync tool.');
      continue;
    }
    if (f.fixtureType !== src.fixtureType) {
      state.add(CHECKS.BENCH_PARITY, 'bench_fixture_type_drift', SEVERITY.ERROR,
        `fixture '${f.name}'`,
        `fixtureType '${f.fixtureType}' ≠ '${src.fixtureType}' in ${bench.scene}.`);
    }
  }
  for (const [name, src] of benchStrands) {
    const local = state.strands.find((s) => s.name === `${BENCH_PREFIX}${name}`);
    if (!local) continue;
    if (local.ledCount !== src.ledCount) {
      state.add(CHECKS.BENCH_PARITY, 'bench_strand_length_drift', SEVERITY.ERROR,
        `strand '${local.name}'`,
        `ledCount ${local.ledCount} ≠ ${src.ledCount} in ${bench.scene}.`);
    }
  }
  for (const c of localControllers) {
    const sourceName = c.name.slice(BENCH_PREFIX.length);
    const src = benchControllers.get(sourceName);
    if (!src) {
      state.add(CHECKS.BENCH_PARITY, 'bench_controller_not_in_source', SEVERITY.ERROR,
        `controller '${c.name}'`,
        `has no counterpart '${sourceName}' in the ${bench.scene} scene.`);
      continue;
    }
    const diffs = [];
    if (c.ip !== src.ip) diffs.push(`ip ${c.ip} ≠ ${src.ip}`);
    if (String(c.type) !== String(src.type)) diffs.push(`type ${c.type} ≠ ${src.type}`);
    if (String(c.protocol) !== String(src.protocol)) {
      diffs.push(`protocol ${c.protocol} ≠ ${src.protocol}`);
    }
    const localPorts = Array.isArray(c.ports) ? c.ports : [];
    const srcPorts = Array.isArray(src.ports) ? src.ports : [];
    if (localPorts.length !== srcPorts.length) {
      diffs.push(`${localPorts.length} port(s) ≠ ${srcPorts.length}`);
    } else {
      for (let i = 0; i < localPorts.length; i++) {
        const lp = localPorts[i];
        const sp = srcPorts[i];
        if (lp.universe !== sp.universe) {
          diffs.push(`port ${sp.port} universe ${lp.universe} ≠ ${sp.universe}`);
        }
        const lc = (lp.chain || []).map((e) => `${entryFixtureName(e)}@${e && e.at}`).join(',');
        const sc = (sp.chain || []).map((e) => `${BENCH_PREFIX}${entryFixtureName(e)}@${e && e.at}`).join(',');
        if (lc !== sc) diffs.push(`port ${sp.port} chain [${lc}] ≠ [${sc}]`);
      }
    }
    if (src.led && !authoredSubsetMatches(src.led, c.led)) {
      diffs.push('the `led:` block (order/stride/wire) diverges from the bench scene');
    }
    if (diffs.length > 0) {
      state.add(CHECKS.BENCH_PARITY, 'bench_controller_drift', SEVERITY.ERROR,
        `controller '${c.name}'`,
        `the derived bench block diverges from the ${bench.scene} source on invariant fields: ` +
        `${diffs.join('; ')}. The bench scene is the single source of truth — re-run the sync ` +
        'tool rather than hand-editing the copy.');
    }
  }
}

module.exports = {
  checkSceneModelParity,
  CHECKS,
  SEVERITY,
  PLACEHOLDER_IP,
  PLACEHOLDER_MARKER,
  DMX_UNIVERSE_SIZE,
  MAX_UNIVERSE,
  // exported for the tool + tests
  standardizeChannels,
  strandGroupKey,
  isEffectsFixtureType,
  isValidIp,
};
