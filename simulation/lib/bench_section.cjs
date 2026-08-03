/**
 * bench_section.cjs — Pure derivation of the `TB `-prefixed test-bench block
 * that lets the real bench hardware live as a SECTION of another scene
 * (report 20260725_33 §3, option B: "derived copy + parity gate").
 *
 * WHY THIS EXISTS
 *
 *   The operator wants to audit titanic patterns while sanity-checking looks on
 *   the real bench fixtures (DMX 10.x.x.10 + LED 10.x.x.60). The engine loads
 *   exactly ONE model, and no scene-level include mechanism exists, so the bench
 *   has to appear INSIDE the titanic scene. A hand-made copy would silently rot
 *   the moment either side is edited.
 *
 *   So: the **test_bench scene stays the single source of truth** and this
 *   module DERIVES the block from it, deterministically. Re-deriving is the only
 *   sanctioned way to change the copy; every other path is caught by the parity
 *   comparison (`compareBenchSection`) which refuses on ANY divergence of an
 *   invariant field. Loud on drift by construction — codex P0 satisfied by a
 *   gate, not by hope.
 *
 * THE TWO FIELD TIERS (this is the whole contract)
 *
 *   INVARIANT — electrical + identity truth, carried verbatim from the bench and
 *   parity-enforced (divergence ⇒ REFUSAL, never a silent reconcile). Exactly
 *   report §3B's list: controller ip/type/protocol, port index, universe,
 *   startAddress, chain ORDER, chain member names, DMX `at` addresses, LED wire
 *   block, device binding, fixture identity (name/group/fixtureType), strand
 *   identity (name) and pixel counts.
 *
 *   TARGET-LOCAL — everything else: placement (position, rotation, scale), sim-preview
 *   looks (color/intensity/brightness/enabled/diffusion...). The block seeds
 *   them from the bench (docked beside the ship) but the operator owns them in
 *   the target scene, so they are NEVER a parity failure.
 *
 *   VOLATILE / DERIVED — stripped entirely, never copied:
 *     - `device.lastPush` (a timestamped push receipt: changes on every push),
 *     - `sectionId` / `fixtureId` / `viewMask` / `controllerId` — re-derived by
 *       the registry inside the TARGET scene. Copying the bench's numbering into
 *       titanic would import bench id collisions wholesale (see the sId/fId
 *       union bug, report 20260725_33 §1.3),
 *     - controller `id` — assigned by the target registry (`nextControllerId`);
 *       `cId` is a panel ordinal, not a portable identity.
 *
 * IDEMPOTENCY comes from: no timestamps, no volatile fields, canonical key
 * ordering, and sorted collections. Deriving twice from an unchanged bench
 * yields a byte-identical block (proven in tests/bench_section_sync.test.js).
 *
 * Dependency-free apart from Node built-ins so it is unit-testable and usable
 * headless. All file I/O belongs to the caller (tools/bench_section_sync.cjs).
 */
'use strict';

const crypto = require('crypto');

// ── Contract constants ──────────────────────────────────────────────────────

/** Namespace prefix: keeps bench groups/sections/views distinct in the target. */
const BENCH_PREFIX = 'TB ';

/** Default dock: beside the ship's hull (titanic spans x -31.5..33.6). */
const DEFAULT_DOCK = { x: 45, y: 0, z: 0 };

/** Placeholder controller sentinel (report §2, "fail-loud placeholder rules"). */
const SENTINEL_IP = '0.0.0.0';

/** Re-derived by the target registry — never carried across. */
const DERIVED_METADATA_FIELDS = ['sectionId', 'fixtureId', 'viewMask', 'controllerId'];

/** The exporter throws past 31 view bits (view_registry.js). */
const MAX_VIEW_BITS = 31;

const SEVERITY_REFUSE = 'refuse';
const SEVERITY_WARN = 'warn';
const SEVERITY_INFO = 'info';

// ── Small deterministic helpers ─────────────────────────────────────────────

/**
 * Re-key an object so serialization is stable: `preferred` keys first in the
 * order given, then every remaining key alphabetically. Undefined values are
 * dropped so an absent optional field never shows up as `null`.
 */
function orderKeys(obj, preferred) {
  const out = {};
  for (const k of preferred) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  for (const k of Object.keys(obj).sort()) {
    if (!preferred.includes(k) && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Canonical JSON (recursively key-sorted) — the digest/compare substrate. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function finding(severity, code, scope, message) {
  return { severity, code, scope, message };
}

/** Deterministic finding order: severity, then code, then scope. */
const SEVERITY_RANK = { [SEVERITY_REFUSE]: 0, [SEVERITY_WARN]: 1, [SEVERITY_INFO]: 2 };
function sortFindings(findings) {
  return findings.slice().sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    a.code.localeCompare(b.code) ||
    a.scope.localeCompare(b.scope));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Collapse negative zero to +0 throughout the block.
 *
 * IDEMPOTENCY HAZARD, found while testing: the bench scene stores `rotX: -0.0`
 * (a UI rotation that landed on negative zero). YAML round-trips that as
 * `-0.0`, but JSON — and therefore the digest — sees plain `0`. Two blocks
 * would then agree on their digest while emitting different bytes. -0 and +0
 * are the same rotation, so normalizing is value-preserving and makes
 * "re-derive twice ⇒ identical bytes" hold unconditionally.
 */
function normalizeNegativeZero(value) {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(normalizeNegativeZero);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = normalizeNegativeZero(value[k]);
    return out;
  }
  return value;
}

/** The bench view-bit name for a strand: its group, else its own name. */
function strandBitName(strand) {
  return strand.group ? strand.group : strand.name;
}

// ── Source integrity ────────────────────────────────────────────────────────

/**
 * Verify the SOURCE scene's own layers agree before anything is derived from
 * them. A bench whose controllers.yaml and patches.yaml disagree is exactly the
 * "divergence it cannot reconcile" case: deriving would bake the disagreement
 * into the target, so the tool refuses instead.
 *
 * @param {{sceneConfig:Object, controllers:Object, patches:Object}} source
 * @returns {Array<{severity:string,code:string,scope:string,message:string}>}
 */
function checkSourceIntegrity(source) {
  const findings = [];
  const fixtures = (source.sceneConfig?.parLights?.fixtures) || [];
  const strands = (source.sceneConfig?.ledStrands?.strands) || [];
  const controllers = (source.controllers?.controllers) || [];
  const patches = (source.patches?.patches) || {};

  if (controllers.length === 0) {
    findings.push(finding(SEVERITY_REFUSE, 'SRC_NO_CONTROLLERS', 'controllers.yaml',
      'source scene declares no controllers — there is no bench wiring to derive'));
  }

  // S5 — unique names across the fixture + strand namespace.
  const seenNames = new Map();
  for (const f of [...fixtures, ...strands]) {
    const n = f.name;
    seenNames.set(n, (seenNames.get(n) || 0) + 1);
  }
  for (const [n, count] of seenNames) {
    if (count > 1) {
      findings.push(finding(SEVERITY_REFUSE, 'SRC_DUPLICATE_NAME', n,
        `name appears ${count}× in the source scene — chain references are ambiguous`));
    }
  }

  const fixtureByName = new Map(fixtures.map((f) => [f.name, f]));
  const strandByName = new Map(strands.map((s) => [s.name, s]));
  const chainMembership = new Map(); // name → ["<controller>/port N", ...]

  for (const c of controllers) {
    const cScope = c.name || `controller#${c.id}`;

    // S6 — a controller with no usable IP cannot be relayed to.
    if (typeof c.ip !== 'string' || c.ip.trim() === '') {
      findings.push(finding(SEVERITY_REFUSE, 'SRC_CONTROLLER_NO_IP', cScope,
        'controller has no IP — the derived block would be unroutable'));
    } else if (c.ip.trim() === SENTINEL_IP) {
      findings.push(finding(SEVERITY_WARN, 'SRC_PLACEHOLDER_IP', cScope,
        `controller IP is the ${SENTINEL_IP} placeholder sentinel — the relay will ` +
        'REFUSE its routes; --strict fails until a real IP is authored'));
    }

    for (const port of (c.ports || [])) {
      const pScope = `${cScope}/port ${port.port}`;
      const universe = parseInt(port.universe, 10);
      if (!Number.isInteger(universe) || universe < 1) {
        findings.push(finding(SEVERITY_REFUSE, 'SRC_BAD_UNIVERSE', pScope,
          `port universe '${port.universe}' is not a positive integer`));
      }
      let lastAt = -Infinity;
      for (const entry of (port.chain || [])) {
        const isDmxEntry = isPlainObject(entry);
        const memberName = isDmxEntry ? entry.fixture : entry;
        const mScope = `${pScope} → ${memberName}`;

        // S1 — every chain member must exist in the scene.
        const asFixture = fixtureByName.get(memberName);
        const asStrand = strandByName.get(memberName);
        if (!asFixture && !asStrand) {
          findings.push(finding(SEVERITY_REFUSE, 'SRC_CHAIN_ORPHAN', mScope,
            'chain references a fixture/strand that does not exist in scene_config.yaml'));
          continue;
        }
        if (!chainMembership.has(memberName)) chainMembership.set(memberName, []);
        chainMembership.get(memberName).push(pScope);

        const patch = patches[memberName];
        if (!patch) {
          findings.push(finding(SEVERITY_REFUSE, 'SRC_CHAIN_UNPATCHED', mScope,
            'chained member has no record in patches.yaml — wiring is half-authored'));
          continue;
        }

        // S2 — controllers.yaml and patches.yaml must tell the same story.
        if (parseInt(patch.dmxUniverse, 10) !== universe) {
          findings.push(finding(SEVERITY_REFUSE, 'SRC_UNIVERSE_MISMATCH', mScope,
            `controllers.yaml says U${universe}, patches.yaml says U${patch.dmxUniverse}`));
        }
        if (String(patch.controllerIp || '') !== String(c.ip || '')) {
          findings.push(finding(SEVERITY_REFUSE, 'SRC_IP_MISMATCH', mScope,
            `controllers.yaml says ip ${c.ip}, patches.yaml says ip '${patch.controllerIp}'`));
        }

        if (isDmxEntry) {
          const at = parseInt(entry.at, 10);
          if (!Number.isInteger(at) || at < 1 || at > 512) {
            findings.push(finding(SEVERITY_REFUSE, 'SRC_ADDRESS_RANGE', mScope,
              `chain address ${entry.at} is outside DMX 1..512`));
          }
          if (parseInt(patch.dmxAddress, 10) !== at) {
            findings.push(finding(SEVERITY_REFUSE, 'SRC_ADDRESS_MISMATCH', mScope,
              `controllers.yaml says at ${at}, patches.yaml says ${patch.dmxAddress}`));
          }
          // Descending chains are legal but almost always a wiring typo.
          if (at <= lastAt) {
            findings.push(finding(SEVERITY_WARN, 'SRC_CHAIN_NOT_ASCENDING', mScope,
              `chain address ${at} does not follow the previous entry (${lastAt})`));
          }
          lastAt = at;
        } else {
          // S4 — LED strand: port ↔ patch record ↔ strand pixel count.
          const startAddress = parseInt(port.startAddress, 10);
          if (Number.isInteger(startAddress) && parseInt(patch.dmxAddress, 10) !== startAddress) {
            findings.push(finding(SEVERITY_REFUSE, 'SRC_ADDRESS_MISMATCH', mScope,
              `port startAddress ${startAddress}, patches.yaml says ${patch.dmxAddress}`));
          }
          const ledCount = parseInt(asStrand.ledCount, 10);
          if (parseInt(patch.pixelCount, 10) !== ledCount) {
            findings.push(finding(SEVERITY_REFUSE, 'SRC_PIXEL_COUNT_MISMATCH', mScope,
              `strand ledCount ${ledCount} but patches.yaml pixelCount ${patch.pixelCount}`));
          }
          const segments = Array.isArray(patch.segments) ? patch.segments : [];
          const segPixels = segments.reduce((sum, s) => sum + (parseInt(s.pixelCount, 10) || 0), 0);
          if (segments.length > 0 && segPixels !== parseInt(patch.pixelCount, 10)) {
            findings.push(finding(SEVERITY_REFUSE, 'SRC_SEGMENT_SUM_MISMATCH', mScope,
              `segments carry ${segPixels} px but the record claims ${patch.pixelCount}`));
          }
          // The patch record's outputIndex is the PHYSICAL board output the port
          // DECLARES (`port.output - 1`, report 20260725_70), not the port row
          // number: a crossed mapping (P1 → output 2) is legal and must not warn.
          // An absent `output` is the identity migration the loader materializes
          // (output = port), so a pre-selector controllers.yaml reads unchanged.
          const declaredOutput = Number.isInteger(port.output) ? port.output : port.port;
          const outputIndex = parseInt(patch.outputIndex, 10);
          if (Number.isInteger(outputIndex) && outputIndex !== declaredOutput - 1) {
            findings.push(finding(SEVERITY_WARN, 'SRC_OUTPUT_INDEX_UNEXPECTED', mScope,
              `outputIndex ${outputIndex} is not the declared output ${declaredOutput} - 1 ` +
              `(port ${port.port}) — verify the wire order`));
          }
        }
      }
    }
  }

  // S5b — one fixture must not hang off two ports.
  for (const [name, ports] of chainMembership) {
    if (ports.length > 1) {
      findings.push(finding(SEVERITY_REFUSE, 'SRC_DOUBLE_CHAINED', name,
        `appears in ${ports.length} chains (${ports.join(', ')}) — ambiguous wiring`));
    }
  }

  // S3 — a patched fixture that no chain reaches is an orphan record.
  for (const [name, patch] of Object.entries(patches)) {
    const universe = parseInt(patch.dmxUniverse, 10);
    if (universe > 0 && !chainMembership.has(name)) {
      findings.push(finding(SEVERITY_REFUSE, 'SRC_ORPHAN_PATCH', name,
        `patches.yaml patches it to U${universe} but no controller chain includes it`));
    }
  }

  return sortFindings(findings);
}

// ── Derivation ──────────────────────────────────────────────────────────────

const CONTROLLER_KEY_ORDER = ['name', 'sourceName', 'ip', 'type', 'protocol', 'ports',
  'parkedOutputs', 'led', 'device'];
// `output` = the physical board output an LED port drives (report 20260725_70).
// orderKeys drops undefined keys, so a DMX port (or a pre-selector LED port)
// emits exactly what it did before.
const PORT_KEY_ORDER = ['port', 'output', 'universe', 'startAddress', 'chain'];
const FIXTURE_KEY_ORDER = ['name', 'sourceName', 'group', 'sourceGroup', 'fixtureType'];
const STRAND_KEY_ORDER = ['name', 'sourceName', 'group', 'ledCount'];

function stripDerivedMetadata(obj) {
  const out = { ...obj };
  for (const k of DERIVED_METADATA_FIELDS) delete out[k];
  return out;
}

/** Prefix a name, refusing to double-prefix an already-derived one. */
function prefixed(prefix, name) {
  return String(name).startsWith(prefix) ? String(name) : `${prefix}${name}`;
}

/**
 * Derive the `TB ` block from a parsed source (test_bench) scene.
 *
 * @param {Object} args
 * @param {{sceneConfig:Object, controllers:Object, patches:Object, views:Object}} args.source
 * @param {string} [args.sourceScene='test_bench']  provenance stamp
 * @param {string} [args.prefix=BENCH_PREFIX]
 * @param {{x:number,y:number,z:number}} [args.dock=DEFAULT_DOCK]
 * @returns {{block:Object}} the derived block (deterministic, digest-stamped)
 */
function deriveBenchSection({ source, sourceScene = 'test_bench', prefix = BENCH_PREFIX, dock = DEFAULT_DOCK }) {
  const srcFixtures = (source.sceneConfig?.parLights?.fixtures) || [];
  const srcStrands = (source.sceneConfig?.ledStrands?.strands) || [];
  const srcControllers = (source.controllers?.controllers) || [];

  const controllers = srcControllers.map((c) => {
    const ports = (c.ports || []).map((p) => orderKeys({
      port: p.port,
      output: p.output,
      universe: p.universe,
      startAddress: p.startAddress,
      chain: (p.chain || []).map((entry) => (isPlainObject(entry)
        ? orderKeys({ fixture: prefixed(prefix, entry.fixture), at: entry.at }, ['fixture', 'at'])
        : prefixed(prefix, entry))),
    }, PORT_KEY_ORDER));

    // device: keep the binding, drop the push receipt (volatile). `provisional`
    // is part of the BINDING, not a receipt — dropping it would turn an
    // operator-declared (fingerprint-less) block into a verified block with no
    // controllerId, which the registry loader refuses outright.
    let device;
    if (isPlainObject(c.device)) {
      device = orderKeys({
        vendor: c.device.vendor,
        provisional: c.device.provisional === true ? true : undefined,
        controllerId: c.device.controllerId,
        boardId: c.device.boardId,
      }, ['vendor', 'provisional', 'controllerId', 'boardId']);
    }

    return orderKeys({
      name: prefixed(prefix, c.name),
      sourceName: c.name,
      ip: c.ip,
      type: c.type,
      protocol: c.protocol,
      ports,
      led: isPlainObject(c.led) ? c.led : undefined,
      device,
    }, CONTROLLER_KEY_ORDER);
  }).sort((a, b) => a.name.localeCompare(b.name));

  const fixtures = srcFixtures.map((f) => {
    const base = stripDerivedMetadata(f);
    return orderKeys({
      ...base,
      name: prefixed(prefix, f.name),
      sourceName: f.name,
      group: prefixed(prefix, f.group),
      sourceGroup: f.group,
      fixtureType: f.fixtureType,
      x: (Number(f.x) || 0) + dock.x,
      y: (Number(f.y) || 0) + dock.y,
      z: (Number(f.z) || 0) + dock.z,
    }, FIXTURE_KEY_ORDER);
  }).sort((a, b) => a.name.localeCompare(b.name));

  const ledStrands = srcStrands.map((s) => {
    const base = stripDerivedMetadata(s);
    return orderKeys({
      ...base,
      name: prefixed(prefix, s.name),
      sourceName: s.name,
      group: s.group ? prefixed(prefix, s.group) : '',
      startX: (Number(s.startX) || 0) + dock.x,
      startY: (Number(s.startY) || 0) + dock.y,
      startZ: (Number(s.startZ) || 0) + dock.z,
      endX: (Number(s.endX) || 0) + dock.x,
      endY: (Number(s.endY) || 0) + dock.y,
      endZ: (Number(s.endZ) || 0) + dock.z,
    }, STRAND_KEY_ORDER);
  }).sort((a, b) => a.name.localeCompare(b.name));

  // View bits the block will consume in the target: one per distinct fixture
  // group, plus one per strand (a strand with no group gets a bit under its own
  // name — see both scenes' views.yaml groupBits).
  const viewBitNames = [...new Set([
    ...fixtures.map((f) => f.group).filter(Boolean),
    ...ledStrands.map(strandBitName),
  ])].sort();

  const universes = [...new Set(controllers.flatMap((c) =>
    (c.ports || []).map((p) => parseInt(p.universe, 10)).filter((u) => Number.isInteger(u) && u > 0)),
  )].sort((a, b) => a - b);

  const block = normalizeNegativeZero(orderKeys({
    sourceScene,
    prefix,
    dock: orderKeys({ x: dock.x, y: dock.y, z: dock.z }, ['x', 'y', 'z']),
    controllers,
    fixtures,
    ledStrands,
    viewBitNames,
    universes,
  }, ['sourceScene', 'prefix', 'dock', 'sourceDigest', 'controllers', 'fixtures', 'ledStrands',
    'viewBitNames', 'universes']));

  // Digest covers the INVARIANT projection only, so a purely cosmetic bench
  // edit (someone recolours a par) does not read as electrical drift.
  block.sourceDigest = sha256(canonicalJson(invariantProjection(block)));
  return { block: orderKeys(block, ['sourceScene', 'prefix', 'dock', 'sourceDigest', 'controllers',
    'fixtures', 'ledStrands', 'viewBitNames', 'universes']) };
}

// ── Invariant projection + parity comparison ────────────────────────────────

/**
 * Reduce a block to the fields parity is enforced on (report §3B). Placement and
 * sim-preview looks are deliberately EXCLUDED: the operator owns them in the
 * target scene, and a nudged fixture must not read as electrical drift.
 */
function invariantProjection(block) {
  return {
    controllers: (block.controllers || []).map((c) => ({
      name: c.name,
      ip: c.ip,
      type: c.type,
      protocol: c.protocol,
      ports: (c.ports || []).map((p) => ({
        port: p.port,
        universe: p.universe,
        startAddress: p.startAddress ?? null,
        chain: (p.chain || []).map((e) => (isPlainObject(e)
          ? { fixture: e.fixture, at: e.at }
          : { fixture: e, at: null })),
      })),
      led: c.led ?? null,
      device: c.device ?? null,
    })),
    fixtures: (block.fixtures || []).map((f) => ({
      name: f.name,
      group: f.group,
      fixtureType: f.fixtureType,
    })),
    ledStrands: (block.ledStrands || []).map((s) => ({
      name: s.name,
      group: s.group ?? '',
      ledCount: s.ledCount,
    })),
    universes: block.universes || [],
  };
}

/** Walk two canonical values and emit a dotted-path diff list. */
function diffValues(pathPrefix, expected, actual, out) {
  if (canonicalJson(expected) === canonicalJson(actual)) return;
  const bothArrays = Array.isArray(expected) && Array.isArray(actual);
  const bothObjects = isPlainObject(expected) && isPlainObject(actual);
  if (bothArrays && expected.length === actual.length) {
    for (let i = 0; i < expected.length; i += 1) {
      diffValues(`${pathPrefix}[${i}]`, expected[i], actual[i], out);
    }
    return;
  }
  if (bothObjects) {
    for (const k of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      diffValues(pathPrefix ? `${pathPrefix}.${k}` : k, expected[k], actual[k], out);
    }
    return;
  }
  out.push({
    path: pathPrefix,
    expected: expected === undefined ? null : expected,
    actual: actual === undefined ? null : actual,
  });
}

/**
 * Compare a freshly derived block against the one actually present in the target
 * scene, on invariant fields only.
 *
 * This is the gate the plan's §4 check 6 ("bench-section parity") calls. ANY
 * diff is a refusal: the derived copy is not editable in place, and the only
 * sanctioned way to change it is to change test_bench and re-derive.
 *
 * @returns {{inSync:boolean, diffs:Array<{path:string,expected:*,actual:*}>}}
 */
function compareBenchSection(expectedBlock, actualBlock) {
  const diffs = [];
  diffValues('', invariantProjection(expectedBlock), invariantProjection(actualBlock), diffs);
  diffs.sort((a, b) => a.path.localeCompare(b.path));
  return { inSync: diffs.length === 0, diffs };
}

// ── Target extraction + compatibility ───────────────────────────────────────

/**
 * Pull whatever `prefix`-named block ALREADY exists in a parsed target scene.
 * Returns null when the target carries none (the Phase A state: nothing applied
 * yet). Shaped exactly like a derived block so `compareBenchSection` can be
 * pointed straight at it.
 */
function extractBenchSection({ sceneConfig, controllers, prefix = BENCH_PREFIX, sourceScene = 'test_bench' }) {
  const isOurs = (n) => typeof n === 'string' && n.startsWith(prefix);
  const tFixtures = ((sceneConfig?.parLights?.fixtures) || []).filter((f) => isOurs(f.name));
  const tStrands = ((sceneConfig?.ledStrands?.strands) || []).filter((s) => isOurs(s.name));
  const tControllers = ((controllers?.controllers) || []).filter((c) => isOurs(c.name));
  if (tFixtures.length === 0 && tStrands.length === 0 && tControllers.length === 0) return null;

  const blockControllers = tControllers.map((c) => orderKeys({
    name: c.name,
    ip: c.ip,
    type: c.type,
    protocol: c.protocol,
    ports: (c.ports || []).map((p) => orderKeys({
      port: p.port,
      output: p.output,
      universe: p.universe,
      startAddress: p.startAddress,
      chain: (p.chain || []).map((e) => (isPlainObject(e)
        ? orderKeys({ fixture: e.fixture, at: e.at }, ['fixture', 'at'])
        : e)),
    }, PORT_KEY_ORDER)),
    led: isPlainObject(c.led) ? c.led : undefined,
    device: isPlainObject(c.device)
      ? orderKeys({
        vendor: c.device.vendor,
        // See the mirror above: `provisional` is binding grade, not a receipt.
        provisional: c.device.provisional === true ? true : undefined,
        controllerId: c.device.controllerId,
        boardId: c.device.boardId,
      }, ['vendor', 'provisional', 'controllerId', 'boardId'])
      : undefined,
  }, CONTROLLER_KEY_ORDER)).sort((a, b) => a.name.localeCompare(b.name));

  const universes = [...new Set(blockControllers.flatMap((c) =>
    (c.ports || []).map((p) => parseInt(p.universe, 10)).filter((u) => Number.isInteger(u) && u > 0)),
  )].sort((a, b) => a - b);

  return normalizeNegativeZero({
    sourceScene,
    prefix,
    controllers: blockControllers,
    fixtures: tFixtures.map((f) => orderKeys({ ...stripDerivedMetadata(f) }, FIXTURE_KEY_ORDER))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ledStrands: tStrands.map((s) => orderKeys({ ...stripDerivedMetadata(s) }, STRAND_KEY_ORDER))
      .sort((a, b) => a.name.localeCompare(b.name)),
    universes,
  });
}

/**
 * Check the derived block can legally land in the target scene. These are the
 * collisions that make an apply unsafe; each one is a refusal, because the
 * resolution is an operator decision (rename / re-deal universes / free a view
 * bit), never something a sync tool may guess at.
 */
function checkTargetCompatibility({ block, target, prefix = BENCH_PREFIX }) {
  const findings = [];
  const targetFixtures = (target.sceneConfig?.parLights?.fixtures) || [];
  const targetStrands = (target.sceneConfig?.ledStrands?.strands) || [];
  const targetControllers = (target.controllers?.controllers) || [];
  const targetPatches = (target.patches?.patches) || {};

  const derivedNames = new Set([
    ...block.fixtures.map((f) => f.name),
    ...block.ledStrands.map((s) => s.name),
  ]);
  const derivedControllerNames = new Set(block.controllers.map((c) => c.name));

  // T1 — a prefixed name in the target that the block does not own is a
  // squatter: applying would either collide or silently adopt it.
  for (const f of [...targetFixtures, ...targetStrands]) {
    if (typeof f.name === 'string' && f.name.startsWith(prefix) && !derivedNames.has(f.name)) {
      findings.push(finding(SEVERITY_REFUSE, 'TGT_PREFIX_SQUATTER', f.name,
        `target scene already has a '${prefix}'-prefixed item the derived block does not own`));
    }
  }
  for (const c of targetControllers) {
    if (typeof c.name === 'string' && c.name.startsWith(prefix) && !derivedControllerNames.has(c.name)) {
      findings.push(finding(SEVERITY_REFUSE, 'TGT_PREFIX_SQUATTER', c.name,
        `target controller uses the '${prefix}' namespace but is not part of the derived block`));
    }
  }

  // T2 — bench universes are RESERVED (report §2 O3). Anything else in the
  // target sitting on U1/U2/U10/U12 with a different controller is a clash.
  const benchUniverses = new Set(block.universes);
  const benchIps = new Set(block.controllers.map((c) => c.ip));
  for (const [name, patch] of Object.entries(targetPatches)) {
    const u = parseInt(patch.dmxUniverse, 10);
    if (!benchUniverses.has(u)) continue;
    if (derivedNames.has(name)) continue;
    const ip = String(patch.controllerIp || '');
    if (!benchIps.has(ip)) {
      findings.push(finding(SEVERITY_REFUSE, 'TGT_UNIVERSE_RESERVED', name,
        `target fixture occupies bench-reserved U${u} on ${ip || '(no ip)'} — re-deal the ` +
        'universe plan (O3) before applying the bench block'));
    }
  }

  // T3 — view-bit budget: the exporter throws past 31 bits.
  const targetBits = (target.views?.views?.groupBits) || {};
  const targetBitNames = new Set(Object.keys(targetBits));
  const customCount = ((target.views?.views?.custom) || []).length;
  const newBitNames = block.viewBitNames.filter((n) => !targetBitNames.has(n));
  const projectedBits = targetBitNames.size + customCount + newBitNames.length;
  if (projectedBits > MAX_VIEW_BITS) {
    findings.push(finding(SEVERITY_REFUSE, 'TGT_VIEW_BIT_BUDGET', 'views.yaml',
      `applying needs ${newBitNames.length} new view bits on top of ${targetBitNames.size} group + ` +
      `${customCount} custom bits = ${projectedBits}, over the ${MAX_VIEW_BITS}-bit ceiling`));
  } else {
    findings.push(finding(SEVERITY_INFO, 'TGT_VIEW_BIT_HEADROOM', 'views.yaml',
      `${projectedBits}/${MAX_VIEW_BITS} view bits after apply (${MAX_VIEW_BITS - projectedBits} spare)`));
  }

  // T4 — placeholder sentinels: loud by default, fatal under --strict.
  for (const c of block.controllers) {
    if (String(c.ip).trim() === SENTINEL_IP) {
      findings.push(finding(SEVERITY_WARN, 'BLOCK_PLACEHOLDER_IP', c.name,
        `derived controller carries the ${SENTINEL_IP} sentinel — no hardware will be reached`));
    }
  }

  return sortFindings(findings);
}

module.exports = {
  BENCH_PREFIX,
  DEFAULT_DOCK,
  SENTINEL_IP,
  MAX_VIEW_BITS,
  DERIVED_METADATA_FIELDS,
  SEVERITY_REFUSE,
  SEVERITY_WARN,
  SEVERITY_INFO,
  checkSourceIntegrity,
  deriveBenchSection,
  invariantProjection,
  compareBenchSection,
  extractBenchSection,
  checkTargetCompatibility,
  canonicalJson,
  sortFindings,
};
