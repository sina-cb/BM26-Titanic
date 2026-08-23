/**
 * smokestack_cli_service.test.js — the operator-gated SWITCH path
 * (server/smokestack_cli_service.cjs) behind `POST /smokestack/run`.
 *
 * Everything is injected (env, spawn, clock, fs.exists) — no test here ever
 * launches a real process or reads the real environment. The promises pinned:
 *   - NOT PROVISIONED is a loud refusal naming the missing env vars, with no
 *     path guessing and no fallback;
 *   - an APPLY demands the exact typed phrase AND a fresh, clean, same-action
 *     dry-run — every miss is a distinct named refusal;
 *   - one job at a time, never a queue;
 *   - the spawned argv is exactly the documented CLI surface (`--dry-run`
 *     vs `--yes --rollback-on-failure`), and the wire-shape job never leaks
 *     the CLI/interpreter machine paths;
 *   - timeout and output-overflow are marked on the job (the outcome model
 *     treats both as NOT SAFE).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import {
  FORCE_DRY_RUN_FRESH_MS as MODEL_FORCE_DRY_RUN_FRESH_MS,
  reReleaseConfirmPhrase as modelReReleaseConfirmPhrase,
} from '../src/dmx/smokestack_mode.js';

const require = createRequire(import.meta.url);
const {
  createSmokestackCliService,
  extractVerdictLine,
  extractPlanFingerprint,
  CONFIRM_PHRASES,
  OUTPUT_MAX_BYTES,
  ACTION_REPAIR_TO_DMX,
  ACTION_RE_RELEASE: RE_RELEASE,
  TITANIC_TARGET_IDS,
  confirmPhraseFor,
  DRY_RUN_FRESH_MS,
  FORCE_DRY_RUN_FRESH_MS,
} = require('../server/smokestack_cli_service.cjs');

const CLI_PATH = '/provisioned/deploy/smokestack_mode.py';
const REGISTRY_PATH = '/provisioned/registry.yaml';
const PLAN_FINGERPRINT = 'a'.repeat(64);

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    // A SIGKILLed process closes with a null code.
    child.emit('close', null);
    return true;
  };
  return child;
}

function makeService(overrides = {}) {
  const spawned = [];
  const clock = { t: 1_000_000 };
  const service = createSmokestackCliService({
    env: {
      BM26_SMOKESTACK_CLI: CLI_PATH,
      BM26_DEPLOY_REGISTRY: REGISTRY_PATH,
      ...overrides.env,
    },
    existsFn: overrides.existsFn || ((p) => [CLI_PATH, REGISTRY_PATH].includes(p)),
    spawnFn: (cmd, args, opts) => {
      const child = fakeChild();
      spawned.push({ cmd, args, opts, child });
      return child;
    },
    now: () => clock.t,
    ...overrides.opts,
  });
  return { service, spawned, clock };
}

function finish(entry, { output = '', code = 0 } = {}) {
  if (output) entry.child.stdout.emit('data', Buffer.from(output));
  entry.child.emit('close', code);
}

// ── Provisioning ─────────────────────────────────────────────────────────────

test('provisioning: both env vars absent ⇒ both named missing, nothing guessed', () => {
  const service = createSmokestackCliService({ env: {}, existsFn: () => true });
  const state = service.provisionState();
  assert.equal(state.provisioned, false);
  assert.deepEqual(state.missing, ['BM26_SMOKESTACK_CLI', 'BM26_DEPLOY_REGISTRY']);
  assert.ok(state.reasons.every((r) => /is not set/.test(r)));
});

test('provisioning: a set-but-nonexistent path is missing too (fail loud, no trust)', () => {
  const { service } = makeService({ existsFn: (p) => p === REGISTRY_PATH });
  const state = service.provisionState();
  assert.equal(state.provisioned, false);
  assert.deepEqual(state.missing, ['BM26_SMOKESTACK_CLI']);
  assert.match(state.reasons[0], /does not exist/);
});

test('unprovisioned startJob refuses every action with the reasons named', () => {
  const service = createSmokestackCliService({ env: {}, existsFn: () => false });
  for (const action of ['status', 'to-dmx', 'to-swarm']) {
    const r = service.startJob({ action });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not_provisioned');
    assert.match(r.error, /deployment source not provisioned/);
  }
});

// ── Argument surface + wire shape ────────────────────────────────────────────

test('dry-run spawns `<python> <cli> <action> --dry-run`; the public job hides the paths', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({ action: 'to-swarm' });
  assert.equal(r.ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, 'python');
  assert.deepEqual(spawned[0].args, [CLI_PATH, 'to-swarm', '--dry-run']);
  // Wire shape: action args only — never the CLI or interpreter machine paths.
  assert.deepEqual(r.job.args, ['to-swarm', '--dry-run']);
  assert.equal(JSON.stringify(r.job).includes(CLI_PATH), false);
  assert.equal('child' in r.job, false);
});

test('BM26_SMOKESTACK_PYTHON overrides the interpreter', () => {
  const { service, spawned } = makeService({ env: { BM26_SMOKESTACK_PYTHON: 'python3' } });
  service.startJob({ action: 'status' });
  assert.equal(spawned[0].cmd, 'python3');
  assert.deepEqual(spawned[0].args, [CLI_PATH, 'status']);
});

test('bad actions are refused before anything spawns', () => {
  const { service, spawned } = makeService();
  assert.equal(service.startJob({ action: 'reboot' }).code, 'bad_action');
  assert.equal(service.startJob({ action: 'status', apply: true }).code, 'bad_action');
  assert.equal(service.startJob({}).code, 'bad_action');
  assert.equal(spawned.length, 0);
});

test('repair dry-run targets only the approved .62 semantic ID', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.job.targetIds, ['ss_left_right']);
  assert.deepEqual(r.job.args,
    ['to-dmx', '--names', 'ss_left_right', '--dry-run']);
  assert.deepEqual(spawned[0].args,
    [CLI_PATH, 'to-dmx', '--names', 'ss_left_right', '--dry-run']);
  const argv = spawned[0].args.join(' ');
  for (const healthyId of TITANIC_TARGET_IDS.filter((id) => id !== 'ss_left_right')) {
    assert.equal(argv.includes(healthyId), false, `repair spilled to ${healthyId}`);
  }
});

test('repair multi-target set is sorted, copied, and frozen for the job', () => {
  const { service, spawned } = makeService();
  const requested = ['ss_right_left', 'ss_left_left'];
  const r = service.startJob({ action: ACTION_REPAIR_TO_DMX, targetIds: requested });
  requested[0] = 'ss_left_right';
  r.job.targetIds[0] = 'ss_right_right';
  assert.deepEqual(service.getJob(r.job.id).targetIds,
    ['ss_left_left', 'ss_right_left']);
  assert.deepEqual(spawned[0].args, [CLI_PATH, 'to-dmx', '--names',
    'ss_left_left,ss_right_left', '--dry-run']);
});

test('repair refuses empty, duplicate, unknown, IP, and non-array targets', () => {
  const { service, spawned } = makeService();
  const refused = [
    undefined,
    [],
    ['ss_left_right', 'ss_left_right'],
    ['rope-controller-2'],
    ['10.1.1.62'],
    'ss_left_right',
  ];
  for (const targetIds of refused) {
    const r = service.startJob({ action: ACTION_REPAIR_TO_DMX, targetIds });
    assert.equal(r.ok, false, JSON.stringify(targetIds));
    assert.equal(r.code, 'bad_targets', JSON.stringify(targetIds));
  }
  assert.equal(spawned.length, 0);
});

test('fleet actions remain fleet-only and reject a targeted payload', () => {
  const { service, spawned } = makeService();
  const targetedFleet = service.startJob({
    action: 'to-dmx', targetIds: ['ss_left_right'],
  });
  assert.equal(targetedFleet.code, 'bad_targets');
  assert.equal(spawned.length, 0);

  const fleet = service.startJob({ action: 'to-dmx' });
  assert.equal(fleet.ok, true);
  assert.deepEqual(spawned[0].args, [CLI_PATH, 'to-dmx', '--dry-run']);
  assert.equal('targetIds' in fleet.job, false);
});

// ── One at a time ────────────────────────────────────────────────────────────

test('a second run while one is in flight is a named busy refusal, never a queue', () => {
  const { service, spawned } = makeService();
  const first = service.startJob({ action: 'to-dmx' });
  const second = service.startJob({ action: 'status' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'busy');
  assert.equal(second.runningJobId, first.job.id);
  assert.equal(spawned.length, 1);

  finish(spawned[0], { output: 'VERDICT: DRY RUN - no changes made\n', code: 0 });
  assert.equal(service.startJob({ action: 'status' }).ok, true);
});

// ── The apply two-step ───────────────────────────────────────────────────────

function cleanDryRun(service, spawned, action = 'to-swarm') {
  const dry = service.startJob({ action });
  finish(spawned[spawned.length - 1],
    { output: `=== plan ===\nVERDICT: DRY RUN - no changes made\n` +
      `PLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n`, code: 0 });
  return dry.job;
}

function cleanRepairDryRun(service, spawned, targetIds) {
  const dry = service.startJob({ action: ACTION_REPAIR_TO_DMX, targetIds });
  finish(spawned[spawned.length - 1],
    { output: `=== plan ===\nVERDICT: DRY RUN - no changes made\n` +
      `PLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n`, code: 0 });
  return dry.job;
}

test('apply: wrong or missing phrase is confirm_mismatch — per action, exact', () => {
  const { service, spawned } = makeService();
  const dry = cleanDryRun(service, spawned);
  for (const confirm of [undefined, '', 'switch', 'SWITCH TO SWARM', 'SWITCH ']) {
    const r = service.startJob({
      action: 'to-swarm', apply: true, confirm, dryRunJobId: dry.id });
    assert.equal(r.code, 'confirm_mismatch', JSON.stringify(confirm));
  }
  assert.equal(spawned.length, 1);
});

test('apply: demands a completed clean dry-run of the SAME action', () => {
  const { service, spawned } = makeService();
  const confirm = CONFIRM_PHRASES['to-swarm'];

  // No dry-run at all.
  assert.equal(service.startJob({ action: 'to-swarm', apply: true, confirm }).code,
    'dry_run_required');
  // A dry-run for the OTHER direction.
  const dmxDry = cleanDryRun(service, spawned, 'to-dmx');
  assert.equal(service.startJob({
    action: 'to-swarm', apply: true, confirm, dryRunJobId: dmxDry.id }).code, 'dry_run_required');
  // A dry-run that was REFUSED (exit 1).
  const refused = service.startJob({ action: 'to-swarm' });
  finish(spawned[spawned.length - 1], { output: 'REFUSED: placeholder MAC\n', code: 1 });
  assert.equal(service.startJob({
    action: 'to-swarm', apply: true, confirm, dryRunJobId: refused.job.id }).code,
  'dry_run_failed');
});

test('apply: a stale dry-run is refused — the plan must reflect the fleet NOW', () => {
  const { service, spawned, clock } = makeService();
  const dry = cleanDryRun(service, spawned);
  clock.t += 16 * 60 * 1000; // past DRY_RUN_FRESH_MS
  const r = service.startJob({
    action: 'to-swarm', apply: true,
    confirm: CONFIRM_PHRASES['to-swarm'], dryRunJobId: dry.id });
  assert.equal(r.code, 'dry_run_stale');
  assert.match(r.error, /re-run/);
});

test('apply binds the reviewed fingerprint and captures the terminal verdict', () => {
  const { service, spawned } = makeService();
  const dry = cleanDryRun(service, spawned);
  const r = service.startJob({
    action: 'to-swarm', apply: true,
    confirm: CONFIRM_PHRASES['to-swarm'], dryRunJobId: dry.id });
  assert.equal(r.ok, true);
  assert.deepEqual(spawned[1].args, [CLI_PATH, 'to-swarm', '--yes',
    '--rollback-on-failure', '--plan-fingerprint', PLAN_FINGERPRINT]);
  assert.equal(r.job.planFingerprint, PLAN_FINGERPRINT);

  finish(spawned[1], {
    output: '=== smokestack to-swarm ===\n…\nVERDICT: SAFE TO KILL NETWORK\n', code: 0 });
  const job = service.getJob(r.job.id);
  assert.equal(job.state, 'done');
  assert.equal(job.exitCode, 0);
  assert.equal(job.verdictLine, 'VERDICT: SAFE TO KILL NETWORK');
  assert.equal(job.timedOut, false);
});

test('apply preserves the reviewed fingerprint and fails if emitted evidence differs', () => {
  const { service, spawned } = makeService();
  const dry = cleanDryRun(service, spawned);
  const apply = service.startJob({
    action: 'to-swarm', apply: true,
    confirm: CONFIRM_PHRASES['to-swarm'], dryRunJobId: dry.id,
  });
  finish(spawned[1], {
    output: `PLAN FINGERPRINT: ${'b'.repeat(64)}\nVERDICT: SAFE TO KILL NETWORK\n`,
    code: 0,
  });
  const job = service.getJob(apply.job.id);
  assert.equal(job.planFingerprint, PLAN_FINGERPRINT);
  assert.equal(job.planFingerprintMismatch, true);
  assert.equal(job.exitCode, -1);
  assert.match(job.output, /ERROR: plan fingerprint mismatch/);
});

test('repair apply requires the identical frozen target set from its dry-run', () => {
  const { service, spawned } = makeService();
  const dry = cleanRepairDryRun(
    service, spawned, ['ss_right_right', 'ss_left_right']);

  const drift = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dry.id,
  });
  assert.equal(drift.code, 'dry_run_target_mismatch');
  assert.equal(spawned.length, 1);

  const apply = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right', 'ss_right_right'],
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dry.id,
  });
  assert.equal(apply.ok, true);
  assert.deepEqual(apply.job.targetIds, ['ss_left_right', 'ss_right_right']);
  assert.deepEqual(spawned[1].args, [CLI_PATH, 'to-dmx', '--names',
    'ss_left_right,ss_right_right', '--yes', '--rollback-on-failure',
    '--plan-fingerprint', PLAN_FINGERPRINT]);
});

test('repair apply rejects another action dry-run and demands exact SWITCH', () => {
  const { service, spawned } = makeService();
  const fleetDry = cleanDryRun(service, spawned, 'to-dmx');
  const wrongAction = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: fleetDry.id,
  });
  assert.equal(wrongAction.code, 'dry_run_required');

  const repairDry = cleanRepairDryRun(service, spawned, ['ss_left_right']);
  const wrongPhrase = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
    apply: true,
    confirm: 'switch',
    dryRunJobId: repairDry.id,
  });
  assert.equal(wrongPhrase.code, 'confirm_mismatch');
  assert.equal(spawned.length, 2);
});

test('repair apply rejects exit-zero dry-run without the trusted no-write verdict', () => {
  const { service, spawned } = makeService();
  const dry = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
  });
  finish(spawned[0], { output: 'plan output without a verdict\n', code: 0 });
  const apply = service.startJob({
    action: ACTION_REPAIR_TO_DMX,
    targetIds: ['ss_left_right'],
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dry.job.id,
  });
  assert.equal(apply.code, 'dry_run_failed');
  assert.match(apply.error, /trusted no-write verdict/);
  assert.equal(spawned.length, 1);
});

test('apply rejects an exact no-write verdict without a SHA-256 plan fingerprint', () => {
  const { service, spawned } = makeService();
  const dry = service.startJob({ action: 'to-dmx' });
  finish(spawned[0], {
    output: 'VERDICT: DRY RUN - no changes made\n',
    code: 0,
  });
  const apply = service.startJob({
    action: 'to-dmx',
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dry.job.id,
  });
  assert.equal(apply.code, 'dry_run_failed');
  assert.match(apply.error, /SHA-256 plan fingerprint/);
  assert.equal(spawned.length, 1);
});

// ── Degraded runs stay honest ────────────────────────────────────────────────

test('stderr is captured too, and a spawn error finishes the job loudly', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({ action: 'status' });
  spawned[0].child.stderr.emit('data', Buffer.from('Traceback: boom\n'));
  spawned[0].child.emit('error', new Error('ENOENT: python not found'));
  const job = service.getJob(r.job.id);
  assert.equal(job.state, 'done');
  assert.equal(job.exitCode, -1);
  assert.match(job.output, /Traceback: boom/);
  assert.match(job.output, /spawn error.*python not found/);
});

test('output overflow marks the job truncated (outcome model reads that as NOT SAFE)', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({ action: 'to-swarm' });
  const chunk = Buffer.alloc(OUTPUT_MAX_BYTES / 2 + 1024, 0x61); // 'a…'
  spawned[0].child.stdout.emit('data', chunk);
  spawned[0].child.stdout.emit('data', chunk);
  spawned[0].child.stdout.emit('data', Buffer.from('VERDICT: SAFE TO KILL NETWORK\n'));
  spawned[0].child.emit('close', 0);
  const job = service.getJob(r.job.id);
  assert.equal(job.outputTruncated, true);
  assert.match(job.output, /\[output truncated\]/);
  // The verdict printed AFTER the cap never reaches the record — truncation
  // alone already voids the verdict in the outcome model.
  assert.notEqual(job.verdictLine, 'VERDICT: SAFE TO KILL NETWORK');
});

test('the job ceiling kills a hung run and marks it timedOut', async () => {
  const { service, spawned } = makeService({ opts: { jobTimeoutMs: 30 } });
  const r = service.startJob({ action: 'to-swarm' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const job = service.getJob(r.job.id);
  assert.equal(spawned[0].child.killed, true);
  assert.equal(job.state, 'done');
  assert.equal(job.timedOut, true);
  assert.match(job.output, /UNVERIFIED/);
  // The slot frees up — the next run may start.
  assert.equal(service.startJob({ action: 'status' }).ok, true);
});

// ── Misc ─────────────────────────────────────────────────────────────────────

test('getJob: unknown ids are null; a running job surfaces its verdict live', () => {
  const { service, spawned } = makeService();
  assert.equal(service.getJob('nope'), null);
  const r = service.startJob({ action: 'to-dmx' });
  spawned[0].child.stdout.emit('data', Buffer.from('VERDICT: DRY RUN - no changes made\n'));
  assert.equal(service.getJob(r.job.id).verdictLine, 'VERDICT: DRY RUN - no changes made');
  assert.equal(service.getJob(r.job.id).state, 'running');
});

test('extractVerdictLine mirrors the browser model (line-anchored, last wins)', () => {
  assert.equal(extractVerdictLine('x\nVERDICT: OK\n'), 'VERDICT: OK');
  assert.equal(extractVerdictLine('mid-line VERDICT: OK'), null);
  assert.equal(extractVerdictLine(''), null);
});

test('extractPlanFingerprint accepts only an anchored lowercase SHA-256 line', () => {
  assert.equal(extractPlanFingerprint(
    `x\nPLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n`), PLAN_FINGERPRINT);
  assert.equal(extractPlanFingerprint(`mid PLAN FINGERPRINT: ${PLAN_FINGERPRINT}`), null);
  assert.equal(extractPlanFingerprint('PLAN FINGERPRINT: abc\n'), null);
});

// ── Advanced Recovery (force ONE controller) ────────────────────────────────

const DRY_RUN_OUT = 'VERDICT: DRY RUN - no changes made\n' +
  `PLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n`;
const LEADER_NO_WRITE =
  'ss_left_right: already in target mode - no mutation POST would be sent\n';
const DIGEST = 'ss_left_left|swarm|false|DETACHED|false|primary|true|1.2.5|true';

/** Complete one force dry-run and return its public job. */
function forceDryRun(harness, action, targetIds, extra = {}) {
  const started = harness.service.startJob({
    action, targetIds, preflightDigest: DIGEST, ...extra });
  assert.equal(started.ok, true, JSON.stringify(started));
  const entry = harness.spawned[harness.spawned.length - 1];
  finish(entry, { output: (extra.leaderOutput || '') + DRY_RUN_OUT });
  return { job: harness.service.getJob(started.job.id), entry };
}

test('force: spawns the CLI --names selector only, and freezes the exact target set', () => {
  const harness = makeService();
  const dmx = harness.service.startJob({
    action: 'force-to-dmx', targetIds: ['ss_left_left'], preflightDigest: DIGEST });
  assert.equal(dmx.ok, true, JSON.stringify(dmx));
  assert.deepEqual(dmx.job.args, ['to-dmx', '--names', 'ss_left_left', '--dry-run']);
  assert.deepEqual(dmx.job.targetIds, ['ss_left_left']);
  assert.deepEqual(dmx.job.cliNames, ['ss_left_left']);
  assert.equal(dmx.job.preflightDigest, DIGEST);
  assert.equal(dmx.job.consumed, false);
  // The wire shape never leaks the interpreter or CLI machine paths.
  assert.equal(JSON.stringify(dmx.job).includes(CLI_PATH), false);
  finish(harness.spawned[0], { output: DRY_RUN_OUT });

  const swarm = harness.service.startJob({
    action: 'force-to-swarm', targetIds: ['ss_left_left'],
    leaderContext: 'ss_left_right', preflightDigest: DIGEST });
  assert.equal(swarm.ok, true, JSON.stringify(swarm));
  assert.deepEqual(swarm.job.args,
    ['to-swarm', '--names', 'ss_left_right,ss_left_left', '--dry-run']);
  assert.deepEqual(swarm.job.targetIds, ['ss_left_left']);
  assert.deepEqual(swarm.job.cliNames, ['ss_left_right', 'ss_left_left']);
});

test('force: EXACTLY ONE approved controller id — nothing else selects anything', () => {
  const { service } = makeService();
  for (const [targetIds, code] of [
    [undefined, 'force_target_required'],
    [[], 'force_target_required'],
    [['ss_left_left', 'ss_right_right'], 'force_target_required'],
    [['ss_left_left', 'ss_left_left'], 'force_target_required'],
    [['192.0.2.61'], 'bad_targets'],
    [['LeftLeftRopes'], 'bad_targets'],
    [[13], 'bad_targets'],
    [['ss_left_left '], 'bad_targets'],
    [TITANIC_TARGET_IDS.slice(), 'force_target_required'],
  ]) {
    const r = service.startJob({
      action: 'force-to-dmx', targetIds, preflightDigest: DIGEST });
    assert.equal(r.ok, false, JSON.stringify(targetIds));
    assert.equal(r.code, code, JSON.stringify(targetIds));
  }
});

test('force: a run without a preflight digest cannot start at all', () => {
  const { service } = makeService();
  for (const preflightDigest of [undefined, '', null, 42]) {
    const r = service.startJob({
      action: 'force-to-dmx', targetIds: ['ss_left_left'], preflightDigest });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'force_drift');
  }
});

test('force: leader context is required for a follower, forbidden otherwise, and never free', () => {
  const { service } = makeService();
  const base = { action: 'force-to-swarm', targetIds: ['ss_left_left'],
    preflightDigest: DIGEST };

  assert.equal(service.startJob(base).code, 'force_leader_context');
  assert.equal(service.startJob({ ...base, leaderContext: 'ss_right_right' }).code,
    'force_leader_context');
  assert.equal(service.startJob({ ...base, leaderContext: '192.0.2.62' }).code,
    'force_leader_context');
  // The leader's own SWARM force must NOT carry context…
  assert.equal(service.startJob({ ...base, targetIds: ['ss_left_right'],
    leaderContext: 'ss_left_right' }).code, 'force_leader_context');
  // …and a DMX force never carries any (to-dmx has no leader dependency).
  assert.equal(service.startJob({ action: 'force-to-dmx', targetIds: ['ss_left_left'],
    leaderContext: 'ss_left_right', preflightDigest: DIGEST }).code, 'force_leader_context');
  // Nor do the fleet actions.
  assert.equal(service.startJob({ action: 'to-dmx', leaderContext: 'ss_left_right' }).code,
    'force_leader_context');
});

test('force apply: the phrase is the CONTROLLER\'s own, never the fleet SWITCH', () => {
  for (const [action, verb] of [['force-to-dmx', 'FORCE DMX'], ['force-to-swarm', 'FORCE SWARM']]) {
    for (const targetId of TITANIC_TARGET_IDS) {
      const harness = makeService();
      const leaderContext = action === 'force-to-swarm' && targetId !== 'ss_left_right'
        ? 'ss_left_right' : undefined;
      const { job } = forceDryRun(harness, action, [targetId], {
        leaderContext,
        leaderOutput: leaderContext ? LEADER_NO_WRITE : '',
      });
      for (const wrong of ['SWITCH', `${verb} ss_right_left`.replace(targetId, 'zz'),
        verb.toLowerCase() + ' ' + targetId, `${verb} ${targetId} `]) {
        const bad = harness.service.startJob({ action, targetIds: [targetId], apply: true,
          confirm: wrong, dryRunJobId: job.id, leaderContext, preflightDigest: DIGEST });
        assert.equal(bad.ok, false, `${action}/${targetId}/'${wrong}'`);
        assert.equal(bad.code, 'confirm_mismatch');
      }
      const good = harness.service.startJob({ action, targetIds: [targetId], apply: true,
        confirm: `${verb} ${targetId}`, dryRunJobId: job.id, leaderContext,
        preflightDigest: DIGEST });
      assert.equal(good.ok, true, JSON.stringify(good));
      assert.deepEqual(good.job.args.slice(-4),
        ['--yes', '--rollback-on-failure', '--plan-fingerprint', PLAN_FINGERPRINT]);
      assert.deepEqual(good.job.args.slice(0, 3), [action === 'force-to-dmx' ? 'to-dmx' : 'to-swarm',
        '--names', leaderContext ? `ss_left_right,${targetId}` : targetId]);
    }
  }
});

test('force apply: drift, staleness, target/name mismatch and reuse are each refused', () => {
  const armed = (harness, job, overrides = {}) => harness.service.startJob({
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', dryRunJobId: job.id, preflightDigest: DIGEST,
    ...overrides });

  // Digest drift.
  let harness = makeService();
  let { job } = forceDryRun(harness, 'force-to-dmx', ['ss_left_left']);
  let refusal = armed(harness, job, { preflightDigest: `${DIGEST};changed` });
  assert.equal(refusal.code, 'force_drift');
  assert.match(refusal.error, /state drifted since the dry-run/);

  // A different controller than the one planned.
  refusal = armed(harness, job, { targetIds: ['ss_right_right'],
    confirm: 'FORCE DMX ss_right_right' });
  assert.equal(refusal.code, 'dry_run_target_mismatch');

  // Freshness: one window for every plan (FORCE_DRY_RUN_FRESH_MS ===
  // DRY_RUN_FRESH_MS), so a force plan goes stale exactly when a fleet
  // plan does. The digest, not the clock, is what guards against drift.
  harness.clock.t += FORCE_DRY_RUN_FRESH_MS + 1;
  refusal = armed(harness, job);
  assert.equal(refusal.code, 'dry_run_stale');
  assert.match(refusal.error, /older than 15 minutes/);

  // A dry-run is single-use: once it arms an apply it is consumed forever.
  harness = makeService();
  ({ job } = forceDryRun(harness, 'force-to-dmx', ['ss_left_left']));
  const first = armed(harness, job);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(harness.service.getJob(job.id).consumed, true);
  finish(harness.spawned[harness.spawned.length - 1], { output: 'VERDICT: OK\n' });
  const second = armed(harness, job);
  assert.equal(second.code, 'dry_run_consumed');

  // A fingerprint supplied in the REQUEST is ignored — only the stored
  // dry-run's own fingerprint is ever passed to the CLI.
  harness = makeService();
  ({ job } = forceDryRun(harness, 'force-to-dmx', ['ss_left_left']));
  const spoofed = armed(harness, job, { planFingerprint: 'f'.repeat(64) });
  assert.equal(spoofed.ok, true);
  assert.deepEqual(spoofed.job.args.slice(-2), ['--plan-fingerprint', PLAN_FINGERPRINT]);

  // CLI target-name mismatch (same single target, different --names shape).
  harness = makeService();
  ({ job } = forceDryRun(harness, 'force-to-swarm', ['ss_left_left'],
    { leaderContext: 'ss_left_right', leaderOutput: LEADER_NO_WRITE }));
  const noContext = harness.service.startJob({ action: 'force-to-swarm',
    targetIds: ['ss_left_left'], apply: true, confirm: 'FORCE SWARM ss_left_left',
    dryRunJobId: job.id, preflightDigest: DIGEST });
  assert.equal(noContext.code, 'force_leader_context');
});

test('force: a leader context the dry-run did not PROVE read-only refuses the apply', () => {
  for (const leaderOutput of ['', 'ss_left_right: WOULD POST /api/config\n',
    'ss_left_right: already in target mode\n',
    'ss_left_left: already in target mode - no mutation POST would be sent\n']) {
    const harness = makeService();
    const { job } = forceDryRun(harness, 'force-to-swarm', ['ss_left_left'],
      { leaderContext: 'ss_left_right', leaderOutput });
    assert.equal(job.leaderContextUnsafe, true, `'${leaderOutput}' must not count as proof`);
    const refusal = harness.service.startJob({ action: 'force-to-swarm',
      targetIds: ['ss_left_left'], apply: true, confirm: 'FORCE SWARM ss_left_left',
      dryRunJobId: job.id, leaderContext: 'ss_left_right', preflightDigest: DIGEST });
    assert.equal(refusal.ok, false);
    assert.equal(refusal.code, 'force_leader_context');
  }

  // The exact line, and only the exact line, clears the gate.
  const harness = makeService();
  const { job } = forceDryRun(harness, 'force-to-swarm', ['ss_left_left'],
    { leaderContext: 'ss_left_right', leaderOutput: LEADER_NO_WRITE });
  assert.equal(job.leaderContextUnsafe, false);
  const ok = harness.service.startJob({ action: 'force-to-swarm', targetIds: ['ss_left_left'],
    apply: true, confirm: 'FORCE SWARM ss_left_left', dryRunJobId: job.id,
    leaderContext: 'ss_left_right', preflightDigest: DIGEST });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('force apply: an emitted fingerprint that differs from the reviewed one still fails', () => {
  const harness = makeService();
  const { job } = forceDryRun(harness, 'force-to-dmx', ['ss_left_left']);
  const applied = harness.service.startJob({ action: 'force-to-dmx',
    targetIds: ['ss_left_left'], apply: true, confirm: 'FORCE DMX ss_left_left',
    dryRunJobId: job.id, preflightDigest: DIGEST });
  assert.equal(applied.ok, true);
  finish(harness.spawned[harness.spawned.length - 1], {
    output: `PLAN FINGERPRINT: ${'9'.repeat(64)}\nVERDICT: OK\n` });
  const done = harness.service.getJob(applied.job.id);
  assert.equal(done.planFingerprintMismatch, true);
  assert.equal(done.exitCode, -1);
  assert.match(done.output, /plan fingerprint mismatch/);
});

test('confirm phrases: the server\'s own derivation covers all 8 force combos + the 3 fleet ones',
  () => {
    for (const targetId of TITANIC_TARGET_IDS) {
      assert.equal(confirmPhraseFor('force-to-dmx', [targetId]), `FORCE DMX ${targetId}`);
      assert.equal(confirmPhraseFor('force-to-swarm', [targetId]), `FORCE SWARM ${targetId}`);
    }
    for (const action of ['to-dmx', 'to-swarm', ACTION_REPAIR_TO_DMX]) {
      assert.equal(confirmPhraseFor(action, null), 'SWITCH');
    }
    // No single frozen target ⇒ no phrase at all, so no apply can match one.
    assert.equal(confirmPhraseFor('force-to-dmx', []), null);
    assert.equal(confirmPhraseFor('force-to-dmx', ['a', 'b']), null);
  });

test('force and fleet plans share ONE freshness window; the digest is the real drift guard', () => {
  // Operator ruling: no shorter force-only window. Staleness is a coarse
  // backstop — the preflight digest refuses on ANY state change, clock or no.
  assert.equal(FORCE_DRY_RUN_FRESH_MS, DRY_RUN_FRESH_MS);
  assert.equal(FORCE_DRY_RUN_FRESH_MS, 15 * 60 * 1000);
  assert.equal(MODEL_FORCE_DRY_RUN_FRESH_MS, FORCE_DRY_RUN_FRESH_MS,
    'the browser model and the server must age a force plan identically');
});

// ── Asset re-release ────────────────────────────────────────────────────────
//
// A mutating action that rewrites on-board FILES. It is gated exactly like the
// targeted repair — frozen target set, two-step, fingerprint-bound apply — and
// it must never acquire the mode path's flags or leader context.

test('re-release: dry-run and apply spawn the CLI asset subcommand and nothing else', () => {
  const { service, spawned, clock } = makeService();
  const dry = service.startJob({ action: RE_RELEASE, targetIds: ['ss_right_right'] });
  assert.equal(dry.ok, true);
  assert.deepEqual(spawned[0].args,
    [CLI_PATH, 're-release', '--names', 'ss_right_right', '--dry-run']);
  assert.deepEqual(dry.job.targetIds, ['ss_right_right']);
  finish(spawned[0], {
    output: `VERDICT: DRY RUN - no changes made\nPLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n` });

  clock.t += 1000;
  const apply = service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_right_right'], confirm: 'RE-RELEASE ss_right_right',
    dryRunJobId: dry.job.id });
  assert.equal(apply.ok, true, apply.error);
  assert.deepEqual(spawned[1].args, [CLI_PATH, 're-release', '--names', 'ss_right_right',
    '--yes', '--plan-fingerprint', PLAN_FINGERPRINT]);
  // A re-release has no previous mode to restore, so it must NOT inherit the
  // mode path's rollback flag.
  assert.equal(spawned[1].args.includes('--rollback-on-failure'), false);
  // …and it must never become a mode switch by accident.
  assert.equal(spawned[1].args.includes('to-dmx'), false);
  assert.equal(spawned[1].args.includes('to-swarm'), false);
});

test('re-release: a multi-board set is sorted, deduped and passed as one --names list', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({ action: RE_RELEASE,
    targetIds: ['ss_right_right', 'ss_left_left'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.job.targetIds, ['ss_left_left', 'ss_right_right']);
  assert.deepEqual(spawned[0].args,
    [CLI_PATH, 're-release', '--names', 'ss_left_left,ss_right_right', '--dry-run']);
});

test('re-release: unsafe target shapes are refused before anything is spawned', () => {
  const { service, spawned } = makeService();
  for (const targetIds of [undefined, [], ['ss_left_left', 'ss_left_left'],
    ['192.0.2.61'], ['LeftLeftRopes'], [13], ['ss_left_left', 'nope'], 'ss_left_left']) {
    const r = service.startJob({ action: RE_RELEASE, targetIds });
    assert.equal(r.ok, false, JSON.stringify(targetIds));
    assert.equal(r.code, 'bad_targets');
  }
  assert.equal(spawned.length, 0, 'a refused target set never reaches the CLI');
});

test('re-release: leader context is meaningless here and is refused outright', () => {
  const { service, spawned } = makeService();
  const r = service.startJob({ action: RE_RELEASE, targetIds: ['ss_left_left'],
    leaderContext: 'ss_left_right' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'force_leader_context');
  assert.equal(spawned.length, 0);
});

test('re-release: the phrase is per-set, and the frozen set must survive to apply', () => {
  assert.equal(confirmPhraseFor(RE_RELEASE, ['ss_left_left']), 'RE-RELEASE ss_left_left');
  assert.equal(confirmPhraseFor(RE_RELEASE, ['ss_left_left', 'ss_right_right']),
    'RE-RELEASE ALL');
  assert.equal(confirmPhraseFor(RE_RELEASE, []), null);
  // Server and browser model must derive the SAME phrase for every shape.
  for (const ids of [['ss_left_left'], ['ss_left_right'], ['ss_right_right'],
    ['ss_right_left'], ['ss_left_left', 'ss_right_left'], TITANIC_TARGET_IDS.slice()]) {
    assert.equal(confirmPhraseFor(RE_RELEASE, ids), modelReReleaseConfirmPhrase(ids),
      ids.join(','));
  }

  const { service, spawned, clock } = makeService();
  const dry = service.startJob({ action: RE_RELEASE,
    targetIds: ['ss_left_left', 'ss_right_right'] });
  finish(spawned[0], {
    output: `VERDICT: DRY RUN - no changes made\nPLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n` });
  clock.t += 1000;

  // The single-board phrase cannot arm a two-board plan.
  assert.equal(service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_left_left', 'ss_right_right'], confirm: 'RE-RELEASE ss_left_left',
    dryRunJobId: dry.job.id }).code, 'confirm_mismatch');
  // Nor can the fleet phrase.
  assert.equal(service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_left_left', 'ss_right_right'], confirm: 'SWITCH',
    dryRunJobId: dry.job.id }).code, 'confirm_mismatch');
  // Narrowing the set at apply time is refused even with a matching phrase.
  assert.equal(service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_left_left'], confirm: 'RE-RELEASE ss_left_left',
    dryRunJobId: dry.job.id }).code, 'dry_run_target_mismatch');
  assert.equal(spawned.length, 1, 'no refused apply ever spawned the CLI');

  const ok = service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_right_right', 'ss_left_left'], confirm: 'RE-RELEASE ALL',
    dryRunJobId: dry.job.id });
  assert.equal(ok.ok, true, ok.error);
});

test('re-release: a stale, dirty, unfingerprinted or reused dry-run can never arm it', () => {
  const arm = (mutate = () => {}, applyOverrides = {}) => {
    const { service, spawned, clock } = makeService();
    const dry = service.startJob({ action: RE_RELEASE, targetIds: ['ss_left_left'] });
    mutate({ spawned, clock });
    clock.t += 1000;
    return service.startJob({ action: RE_RELEASE, apply: true, targetIds: ['ss_left_left'],
      confirm: 'RE-RELEASE ss_left_left', dryRunJobId: dry.job.id, ...applyOverrides });
  };
  const clean = ({ spawned }) => finish(spawned[0], {
    output: `VERDICT: DRY RUN - no changes made\nPLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n` });

  assert.equal(arm(clean).ok, true);
  assert.equal(arm(({ spawned }) => finish(spawned[0], { code: 1 })).code, 'dry_run_failed');
  assert.equal(arm(({ spawned }) => finish(spawned[0], {
    output: 'VERDICT: DRY RUN - no changes made\n' })).code, 'dry_run_failed',
  'no fingerprint ⇒ no apply');
  assert.equal(arm(({ spawned }) => finish(spawned[0], {
    output: `VERDICT: OK\nPLAN FINGERPRINT: ${PLAN_FINGERPRINT}\n` })).code, 'dry_run_failed');
  assert.equal(arm(({ spawned, clock }) => {
    clean({ spawned });
    clock.t += DRY_RUN_FRESH_MS + 1;
  }).code, 'dry_run_stale');

  // Single-use: the same clean dry-run can never arm a second apply.
  const { service, spawned, clock } = makeService();
  const dry = service.startJob({ action: RE_RELEASE, targetIds: ['ss_left_left'] });
  clean({ spawned });
  clock.t += 1000;
  const first = service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_left_left'], confirm: 'RE-RELEASE ss_left_left', dryRunJobId: dry.job.id });
  assert.equal(first.ok, true);
  finish(spawned[1], { output: 'VERDICT: OK\n' });
  assert.equal(service.startJob({ action: RE_RELEASE, apply: true,
    targetIds: ['ss_left_left'], confirm: 'RE-RELEASE ss_left_left',
    dryRunJobId: dry.job.id }).code, 'dry_run_consumed');
});

test('re-release: it is one job at a time with everything else, and never a status action', () => {
  const { service, spawned } = makeService();
  service.startJob({ action: RE_RELEASE, targetIds: ['ss_left_left'] });
  const busy = service.startJob({ action: 'to-dmx' });
  assert.equal(busy.ok, false);
  assert.equal(busy.code, 'busy');
  assert.equal(spawned.length, 1);
  // The mode actions still refuse a targetIds array of their own.
  assert.equal(service.startJob({ action: 'to-swarm', targetIds: ['ss_left_left'] }).code,
    'bad_targets');
});
