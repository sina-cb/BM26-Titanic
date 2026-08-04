/**
 * bench_section_sync.test.js — the bench-as-section derivation + parity gate
 * (lib/bench_section.cjs, tools/bench_section_sync.cjs).
 *
 * Report 20260725_33 §3 option B: test_bench stays the SINGLE SOURCE OF TRUTH
 * and the titanic scene carries a DERIVED `TB `-prefixed copy. That is only safe
 * if three properties hold, and each is pinned here:
 *
 *   1. IDEMPOTENT — re-deriving an unchanged bench is byte-identical, so the
 *      sim's boot-time re-projection/re-save can never make the copy "drift a
 *      little" every cycle.
 *   2. REFUSES divergence it cannot reconcile — a bench whose own YAMLs
 *      contradict each other, a target that cannot legally accept the block, or
 *      an ALREADY-APPLIED block that someone hand-edited. Every one of these
 *      exits non-zero with a named finding; none of them are "fixed up".
 *   3. NEVER carries derived/volatile state across — bench section/fixture ids
 *      and push receipts must not be imported into the target scene.
 *
 * Tests run against the REAL test_bench + titanic scenes (the shapes that
 * actually ship) plus synthetic mutations for each refusal path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  BENCH_PREFIX,
  SEVERITY_REFUSE,
  SEVERITY_WARN,
  checkSourceIntegrity,
  deriveBenchSection,
  compareBenchSection,
  extractBenchSection,
  checkTargetCompatibility,
  canonicalJson,
} = require('../lib/bench_section.cjs');
const { readScene, serializeBlock } = require('../tools/bench_section_sync.cjs');

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(SIM_ROOT, 'tools', 'bench_section_sync.cjs');

const realBench = () => readScene('test_bench');
const realTitanic = () => readScene('titanic');
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Run the CLI and hand back {code, stdout} without throwing on non-zero. */
function runTool(args) {
  try {
    const stdout = execFileSync(process.execPath, [TOOL, ...args], {
      cwd: SIM_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '' };
  }
}

const refusals = (findings) => findings.filter((f) => f.severity === SEVERITY_REFUSE);
const codes = (findings) => refusals(findings).map((f) => f.code);

// ── 1. Derivation against the real bench ────────────────────────────────────

test('derives the whole bench: every controller, fixture and strand, TB -prefixed', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  assert.equal(block.controllers.length, 2);
  assert.equal(block.fixtures.length, 12);
  assert.equal(block.ledStrands.length, 2);
  for (const item of [...block.controllers, ...block.fixtures, ...block.ledStrands]) {
    assert.ok(item.name.startsWith(BENCH_PREFIX), `${item.name} is not prefixed`);
  }
  // Bench universes carried verbatim (U1/U2 DMX + U10/U12 LED).
  assert.deepEqual(block.universes, [1, 2, 10, 12]);
});

test('electrical truth is carried verbatim: ip, port, universe, chain order, addresses', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const dmx = block.controllers.find((c) => c.type === 'DMX');
  assert.equal(dmx.ip, '10.1.1.10');
  const port1 = dmx.ports.find((p) => p.port === 1);
  assert.equal(port1.universe, 2);
  assert.deepEqual(port1.chain, [
    { fixture: 'TB Par 1', at: 1 },
    { fixture: 'TB Par 2', at: 11 },
    { fixture: 'TB Par 3', at: 21 },
    { fixture: 'TB Par 4', at: 31 },
  ]);
  const led = block.controllers.find((c) => c.type === 'LED');
  assert.equal(led.ip, '10.1.1.60');
  assert.equal(led.led.stride, 4);
  assert.equal(led.led.order, 'RGBW');
  assert.equal(led.led.wire.foldAmber, true);          // wire block is invariant
  assert.equal(led.device.controllerId, 'titanic_202'); // device binding survives
  assert.deepEqual(led.ports.map((p) => p.universe), [10, 12]);
  assert.deepEqual(block.ledStrands.map((s) => s.ledCount), [20, 20]);
});

test('derived/volatile state is STRIPPED — no bench ids or push receipts cross over', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const text = canonicalJson(block);
  assert.ok(!text.includes('lastPush'), 'device.lastPush must not be copied');
  for (const f of [...block.fixtures, ...block.ledStrands]) {
    for (const k of ['sectionId', 'fixtureId', 'viewMask', 'controllerId']) {
      assert.equal(f[k], undefined, `${f.name} still carries ${k}`);
    }
  }
  for (const c of block.controllers) {
    assert.equal(c.id, undefined, 'controller id is assigned by the TARGET registry');
  }
  // The bench's own strand ids (sId 5/6, fId 11/12) are exactly the numbers that
  // would collide inside titanic — proving they are gone is the point.
  const bench = realBench();
  assert.equal(bench.sceneConfig.ledStrands.strands[0].sectionId, 5);
});

test('fixtures are docked beside the ship, not left inside the hull', () => {
  const dock = { x: 45, y: 0, z: 0 };
  const { block } = deriveBenchSection({ source: realBench(), dock });
  const bench = realBench();
  const srcPar1 = bench.sceneConfig.parLights.fixtures.find((f) => f.name === 'Par 1');
  const outPar1 = block.fixtures.find((f) => f.name === 'TB Par 1');
  assert.equal(outPar1.x, srcPar1.x + dock.x);
  assert.equal(outPar1.y, srcPar1.y);
  // Titanic's own fixtures top out at x ≈ 33.7 — the dock must clear them.
  const titanicMaxX = Math.max(...realTitanic().sceneConfig.parLights.fixtures.map((f) => f.x));
  assert.ok(Math.min(...block.fixtures.map((f) => f.x)) > titanicMaxX,
    'docked bench overlaps the ship');
});

test('the source scene object is never mutated (test_bench is read-only truth)', () => {
  const source = realBench();
  const before = canonicalJson(source);
  deriveBenchSection({ source });
  assert.equal(canonicalJson(source), before);
});

// ── 2. Idempotency ──────────────────────────────────────────────────────────

test('IDEMPOTENT: two derivations are byte-identical, digest included', () => {
  const a = deriveBenchSection({ source: realBench() }).block;
  const b = deriveBenchSection({ source: realBench() }).block;
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(serializeBlock(a), serializeBlock(b));
  assert.equal(a.sourceDigest, b.sourceDigest);
});

test('IDEMPOTENT: key order in the source does not change the output', () => {
  const source = realBench();
  const shuffled = clone(source);
  // Re-insert each fixture's keys in reverse order: same data, different order.
  shuffled.sceneConfig.parLights.fixtures = shuffled.sceneConfig.parLights.fixtures.map((f) => {
    const out = {};
    for (const k of Object.keys(f).reverse()) out[k] = f[k];
    return out;
  });
  shuffled.sceneConfig.parLights.fixtures.reverse();
  assert.equal(
    serializeBlock(deriveBenchSection({ source: shuffled }).block),
    serializeBlock(deriveBenchSection({ source }).block));
});

test('IDEMPOTENT: negative zero in the source cannot split the bytes from the digest', () => {
  // The bench really does store `rotX: -0.0` on the TE Sign fixtures. YAML keeps
  // the sign, JSON (and so the digest) does not — normalize or the two disagree.
  const src = clone(realBench());
  const signA = src.sceneConfig.parLights.fixtures.find((f) => f.name === 'TE Sign V3 A');
  signA.rotX = -0;
  const withNegZero = deriveBenchSection({ source: src }).block;
  signA.rotX = 0;
  const withPosZero = deriveBenchSection({ source: src }).block;
  assert.equal(serializeBlock(withNegZero), serializeBlock(withPosZero));
  assert.ok(!serializeBlock(withNegZero).includes('-0.0'));
});

test('digest tracks ELECTRICAL truth only — a recolour is not drift, a rewire is', () => {
  const base = deriveBenchSection({ source: realBench() }).block;

  const recoloured = clone(realBench());
  recoloured.sceneConfig.parLights.fixtures[0].color = '#123456';
  assert.equal(deriveBenchSection({ source: recoloured }).block.sourceDigest, base.sourceDigest);

  const rewired = clone(realBench());
  rewired.controllers.controllers[0].ports[0].chain[0].at = 5;
  rewired.patches.patches['Par 1'].dmxAddress = 5;
  assert.notEqual(deriveBenchSection({ source: rewired }).block.sourceDigest, base.sourceDigest);
});

// ── 3. Source-integrity refusals (each falsified once) ──────────────────────

test('source integrity is CLEAN on the real bench scene', () => {
  assert.deepEqual(refusals(checkSourceIntegrity(realBench())), []);
});

test('REFUSES: chain references a fixture that does not exist', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ports[0].chain[0].fixture = 'Ghost Par';
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_CHAIN_ORPHAN'));
});

test('REFUSES: controllers.yaml address disagrees with patches.yaml', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ports[0].chain[0].at = 99;
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_ADDRESS_MISMATCH'));
});

test('REFUSES: controllers.yaml universe disagrees with patches.yaml', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ports[0].universe = 7;
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_UNIVERSE_MISMATCH'));
});

test('REFUSES: controllers.yaml IP disagrees with patches.yaml', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ip = '10.1.1.99';
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_IP_MISMATCH'));
});

test('REFUSES: a patched fixture no chain reaches (orphan patch record)', () => {
  const src = clone(realBench());
  src.patches.patches['TE Sign V3 A'].dmxUniverse = 4;
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_ORPHAN_PATCH'));
});

test('REFUSES: one fixture chained off two ports', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ports[1].chain.push({ fixture: 'Par 1', at: 300 });
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_DOUBLE_CHAINED'));
});

test('REFUSES: strand ledCount disagrees with the patch pixelCount', () => {
  const src = clone(realBench());
  src.sceneConfig.ledStrands.strands[0].ledCount = 40; // the open O8 question, mid-edit
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_PIXEL_COUNT_MISMATCH'));
});

test('REFUSES: LED segments do not sum to the declared pixel count', () => {
  const src = clone(realBench());
  src.patches.patches.LED_0.segments[0].pixelCount = 11;
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_SEGMENT_SUM_MISMATCH'));
});

test('REFUSES: chain address outside DMX 1..512', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ports[0].chain[0].at = 900;
  src.patches.patches['Par 1'].dmxAddress = 900;
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_ADDRESS_RANGE'));
});

test('REFUSES: a source scene with no controllers has no wiring to derive', () => {
  const src = clone(realBench());
  src.controllers.controllers = [];
  assert.ok(codes(checkSourceIntegrity(src)).includes('SRC_NO_CONTROLLERS'));
});

test('placeholder sentinel WARNS but does not block sim-side derivation', () => {
  const src = clone(realBench());
  src.controllers.controllers[0].ip = '0.0.0.0';
  for (const p of Object.values(src.patches.patches)) {
    if (p.controllerIp === '10.1.1.10') p.controllerIp = '0.0.0.0';
  }
  const findings = checkSourceIntegrity(src);
  assert.deepEqual(refusals(findings), []);
  assert.ok(findings.some((f) => f.code === 'SRC_PLACEHOLDER_IP' && f.severity === SEVERITY_WARN));
});

// ── 4. Target compatibility ─────────────────────────────────────────────────

test('the real titanic scene can accept the block today (no collisions)', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const findings = checkTargetCompatibility({ block, target: realTitanic() });
  assert.deepEqual(refusals(findings), []);
});

// The budget is PER WORD (report _137 §2). `viewMask` (word 0) and
// `viewMaskHi` (word 1) are independent 31-bit spaces; base group bits — and
// therefore every bit this block adds — can only live in word 0. Charging
// word-1 composite views to the word-0 budget (the pre-_137 behaviour) both
// overstated the number and could refuse an apply that actually fits.
test('view-bit headroom is REPORTED — titanic fills the word-0 ceiling exactly', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const findings = checkTargetCompatibility({ block, target: realTitanic() });
  const headroom = findings.find((f) => f.code === 'TGT_VIEW_BIT_HEADROOM');
  assert.ok(headroom, 'the budget must always be reported, not only when it breaks');
  // 24 titanic group bits + 0 word-0 composites + 7 `TB ` group bits = 31/31.
  assert.match(headroom.message, /31\/31 word-0 view bits after apply \(0 spare/);
  // Word 1 is reported, never charged.
  assert.match(headroom.message, /word 1 holds \d+ custom bit\(s\), independent of this budget/);
});

test('word-1 composite views are NOT charged to the word-0 budget', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const target = realTitanic();
  const word0Only = checkTargetCompatibility({ block, target })
    .find((f) => f.code === 'TGT_VIEW_BIT_HEADROOM');
  // Twenty more word-1 views must not move the word-0 number by one bit.
  target.views.views.custom = [
    ...target.views.views.custom,
    ...Array.from({ length: 20 }, (_, i) => ({ name: `hi_${i}`, bit: 1 << (i + 17), word: 1 })),
  ];
  const withHiViews = checkTargetCompatibility({ block, target })
    .find((f) => f.code === 'TGT_VIEW_BIT_HEADROOM');
  assert.ok(withHiViews, 'adding word-1 views must not turn the budget into a refusal');
  assert.match(withHiViews.message, /31\/31 word-0 view bits after apply \(0 spare/);
  assert.match(word0Only.message, /31\/31 word-0 view bits after apply \(0 spare/);
});

test('REFUSES a malformed custom-view entry, and charges it to NEITHER word', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const clean = checkTargetCompatibility({ block, target: realTitanic() })
    .find((f) => f.code === 'TGT_VIEW_BIT_HEADROOM');
  const target = realTitanic();
  // A bare `- ` in views.yaml parses to null; a bogus `word` is equally
  // unattributable. Both must be named, not silently counted as word 0.
  target.views.views.custom = [...target.views.views.custom, null, { name: 'bad', word: 7 }];
  const findings = checkTargetCompatibility({ block, target });
  assert.equal(findings.filter((f) => f.code === 'TGT_VIEW_ENTRY_MALFORMED').length, 2);
  const dirty = findings.find((f) => f.code === 'TGT_VIEW_BIT_HEADROOM');
  assert.ok(dirty, 'the budget is still reported alongside the refusal');
  assert.equal(dirty.message, clean.message, 'malformed entries must not move either word count');
});

test('REFUSES: view-bit budget would exceed the 31-bit word-0 export ceiling', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const target = realTitanic();
  // No `word` key ⇒ word 0 (the back-compat default in view_registry.js), so
  // these DO compete with the group bits.
  target.views.views.custom = Array.from({ length: 6 }, (_, i) => ({ name: `audit_${i}` }));
  const findings = checkTargetCompatibility({ block, target });
  assert.ok(codes(findings).includes('TGT_VIEW_BIT_BUDGET'));
});

test('REFUSES: something else already squats the TB namespace in the target', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const target = realTitanic();
  target.sceneConfig.parLights.fixtures.push({ name: 'TB Impostor', group: 'TB Impostor' });
  assert.ok(codes(checkTargetCompatibility({ block, target })).includes('TGT_PREFIX_SQUATTER'));
});

test('REFUSES: a titanic fixture occupies a bench-reserved universe', () => {
  const { block } = deriveBenchSection({ source: realBench() });
  const target = realTitanic();
  target.patches.patches['Left Wall 1'] = { dmxUniverse: 2, dmxAddress: 60, controllerIp: '10.1.1.77' };
  assert.ok(codes(checkTargetCompatibility({ block, target })).includes('TGT_UNIVERSE_RESERVED'));
});

// ── 5. Parity gate against an APPLIED block ─────────────────────────────────

/** Build what Phase B step 6's apply must produce, so parity has a subject. */
function titanicWithBlockApplied() {
  const { block } = deriveBenchSection({ source: realBench() });
  const target = realTitanic();
  target.sceneConfig.parLights.fixtures.push(...clone(block.fixtures));
  target.sceneConfig.ledStrands.strands.push(...clone(block.ledStrands));
  target.controllers.controllers.push(...clone(block.controllers).map((c, i) => ({ id: 40 + i, ...c })));
  return { block, target };
}

test('an applied block reads back IN SYNC (the happy Phase B state)', () => {
  const { block, target } = titanicWithBlockApplied();
  const applied = extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  });
  assert.ok(applied, 'the block must be extractable once applied');
  const { inSync, diffs } = compareBenchSection(block, applied);
  assert.deepEqual(diffs, []);
  assert.ok(inSync);
});

test('a target with no block extracts as null (the Phase A state), not as empty', () => {
  const target = realTitanic();
  assert.equal(extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }), null);
});

test('REFUSES: a hand-edited address in the applied copy is caught with its path', () => {
  const { block, target } = titanicWithBlockApplied();
  const c = target.controllers.controllers.find((x) => x.name === 'TB Test Bench 1');
  c.ports[0].chain[0].at = 250;
  const { inSync, diffs } = compareBenchSection(block, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }));
  assert.equal(inSync, false);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'controllers[0].ports[0].chain[0].at');
  assert.deepEqual([diffs[0].expected, diffs[0].actual], [1, 250]);
});

test('REFUSES: a hand-edited controller IP in the applied copy', () => {
  const { block, target } = titanicWithBlockApplied();
  target.controllers.controllers.find((x) => x.name === 'TB Titanic_202').ip = '10.1.1.61';
  const { inSync, diffs } = compareBenchSection(block, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }));
  assert.equal(inSync, false);
  assert.ok(diffs.some((d) => d.path.endsWith('.ip')));
});

test('REFUSES: a dropped chain member (silent unwiring) in the applied copy', () => {
  const { block, target } = titanicWithBlockApplied();
  target.controllers.controllers.find((x) => x.name === 'TB Test Bench 1').ports[0].chain.pop();
  const { inSync } = compareBenchSection(block, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }));
  assert.equal(inSync, false);
});

test('REFUSES: an edited LED wire block in the applied copy', () => {
  const { block, target } = titanicWithBlockApplied();
  target.controllers.controllers.find((x) => x.name === 'TB Titanic_202').led.stride = 3;
  const { inSync, diffs } = compareBenchSection(block, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }));
  assert.equal(inSync, false);
  assert.ok(diffs.some((d) => d.path.endsWith('led.stride')));
});

test('ALLOWS target-local edits: placement and look are the operator\'s, not drift', () => {
  const { block, target } = titanicWithBlockApplied();
  const f = target.sceneConfig.parLights.fixtures.find((x) => x.name === 'TB Par 1');
  f.x += 12;
  f.color = '#00ff00';
  f.brightness = 42;
  const strand = target.sceneConfig.ledStrands.strands.find((x) => x.name === 'TB LED_0');
  strand.startY += 3;
  // The registry also re-derives ids into the applied copy — must not read as drift.
  f.sectionId = 9;
  f.fixtureId = 91;
  const { inSync } = compareBenchSection(block, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  }));
  assert.ok(inSync, 'target-local fields must never trip the parity gate');
});

test('a re-push updating device.lastPush in the bench does NOT trip parity', () => {
  const { block, target } = titanicWithBlockApplied();
  const pushed = clone(realBench());
  pushed.controllers.controllers[1].device.lastPush = { at: 'later', outcome: 'applied' };
  const rederived = deriveBenchSection({ source: pushed }).block;
  assert.equal(rederived.sourceDigest, block.sourceDigest);
  assert.ok(compareBenchSection(rederived, extractBenchSection({
    sceneConfig: target.sceneConfig, controllers: target.controllers,
  })).inSync);
});

// ── 6. CLI contract ─────────────────────────────────────────────────────────

test('CLI: default emit against the real scenes exits 0 and reports parity=absent', () => {
  const { code, stdout } = runTool(['--check', '--json', '--quiet']);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.parity, 'absent');
  assert.deepEqual(report.summary.universes, [1, 2, 10, 12]);
});

test('CLI: --require-applied fails (exit 3) while Phase B has not applied the block', () => {
  const { code, stdout } = runTool(['--check', '--require-applied', '--json', '--quiet']);
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout).ok, false);
});

test('CLI: --apply refuses — applying is Phase B, not this tool\'s job yet', () => {
  const { code } = runTool(['--apply']);
  assert.equal(code, 1);
});

test('CLI: an unknown flag is fatal, never ignored', () => {
  assert.equal(runTool(['--wat']).code, 1);
});

test('CLI: a nonexistent scene is fatal', () => {
  assert.equal(runTool(['--source', 'no_such_scene', '--quiet']).code, 1);
});

// ── _71 (25): the bench check reads the port's DECLARED output ───────────────
// A port declares the PHYSICAL board output it drives (report 20260725_70), so
// SRC_OUTPUT_INDEX_UNEXPECTED must compare `patch.outputIndex` against
// `port.output - 1` — not against `port.port - 1`, which turned every legal
// crossed mapping into a spurious warning in the parity tool.

const warns = (findings) => findings.filter((f) => f.severity === 'warn').map((f) => f.code);

test('_71: a legal CROSSED port → output mapping raises NO SRC_OUTPUT_INDEX_UNEXPECTED', () => {
  const src = clone(realBench());
  const led = src.controllers.controllers.find((c) => c.type === 'LED');
  // Cross the two LED rows: P1 drives board output 2, P2 drives output 1. The
  // patch records follow the declared output, exactly as the projection emits.
  led.ports[0].output = 2;
  led.ports[1].output = 1;
  src.patches.patches[led.ports[0].chain[0]].outputIndex = 1;
  src.patches.patches[led.ports[1].chain[0]].outputIndex = 0;
  const findings = checkSourceIntegrity(src);
  assert.deepEqual(refusals(findings), [], 'a crossed mapping is legal, not a refusal');
  assert.equal(warns(findings).includes('SRC_OUTPUT_INDEX_UNEXPECTED'), false);
});

test('_71: a patch record that disagrees with the DECLARED output still warns', () => {
  const src = clone(realBench());
  const led = src.controllers.controllers.find((c) => c.type === 'LED');
  led.ports[0].output = 2;                       // declares output 2…
  // …but the patch record still says output 1: the two layers disagree.
  assert.ok(warns(checkSourceIntegrity(src)).includes('SRC_OUTPUT_INDEX_UNEXPECTED'));
});

test('_71: a controllers.yaml with no `output` yet reads exactly as before (identity)', () => {
  // The migration is materialized at LOAD; a file written before the field must
  // still check clean here, or every scene would warn until its first re-save.
  const src = clone(realBench());
  for (const c of src.controllers.controllers) {
    for (const p of c.ports) delete p.output;
  }
  assert.equal(warns(checkSourceIntegrity(src)).includes('SRC_OUTPUT_INDEX_UNEXPECTED'), false);
});
