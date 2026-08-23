/**
 * smokestack_routes.test.js — HTTP-level coverage for the save-server's
 * smokestack surface: `GET /smokestack/provision`, `POST /smokestack/status`,
 * `POST /smokestack/run`, `GET /smokestack/job`.
 *
 * Runs against the REAL server process (the `save_server_endpoints` harness:
 * SIM_SAVE_SERVER_PORT on a random high port, SIM_SAVE_SERVER_ROOT on a
 * throwaway temp dir). The deploy CLI is a NODE STUB in the temp dir,
 * provisioned via the real env-var contract (BM26_SMOKESTACK_CLI +
 * BM26_DEPLOY_REGISTRY, with BM26_SMOKESTACK_PYTHON pointed at the node
 * binary) — so the full dry-run → typed-confirm → apply → SAFE TO KILL
 * NETWORK chain is exercised end-to-end without python and without ever
 * naming a real board. A second, UNPROVISIONED server pins the honest-503
 * behavior. No test here opens a socket to anything but 127.0.0.1.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  CONFIRM_PHRASES as MODEL_CONFIRM_PHRASES,
  SMOKESTACK_CONTROLLER_IDS,
  MODE_DMX,
  MODE_SWARM,
  MODE_UNREACHABLE,
  forceConfirmPhrase,
  forceFleetVerdict,
  jobOutcomeModel,
  runTimelineModel,
  reReleaseConfirmPhrase,
  reReleaseFleetVerdict,
  ASSETS_CANONICAL,
  ASSETS_RESIDUE,
  TIMELINE_DONE,
  TIMELINE_FAILED,
  VERDICT_SAFE_TO_KILL,
} from '../src/dmx/smokestack_mode.js';

const require = createRequire(import.meta.url);
const {
  CONFIRM_PHRASES: SERVER_CONFIRM_PHRASES,
  confirmPhraseFor: serverConfirmPhraseFor,
} = require('../server/smokestack_cli_service.cjs');

const SAVE_SERVER = path.resolve(
  fileURLToPath(import.meta.url), '..', '..', 'server', 'save-server.js');

// The stub deploy CLI: canned tables + the CLI's documented verdict lines.
// argv: [node, stub, action, ...flags]
// `$BM26_STUB_MODE` selects which real-CLI generation the stub imitates:
//   'legacy'  the CLI as it shipped — a --names subset apply IGNORES
//             --plan-fingerprint entirely (report _352 §A5). Used to prove
//             the BM layer is the one refusing.
//   'patched' the companion-fixed CLI — EVERY --yes needs a matching
//             fingerprint, exit 2 when absent.
//   'rollback' a board that fails its verify and is rolled back.
// `$BM26_STUB_FAIL_NAMES` names a controller the stub fails on.
const STUB_CLI = `
const args = process.argv.slice(2);
const action = args[0];
const flags = args.slice(1);
const fingerprint = '${'b'.repeat(64)}';
const mode = process.env.BM26_STUB_MODE || 'legacy';
const namesIndex = flags.indexOf('--names');
const names = namesIndex >= 0 ? flags[namesIndex + 1].split(',') : [];
const targeted = names.length > 0;
if (action === 'status') {
  console.log('BOARD              REACH  MODE');
  console.log('rope_a             YES    SWARM-native');
  process.exit(0);
}
// The canonical run is the exact four, in the CLI's own registry order, so the
// timeline parser sees real controller ids and real per-board lines.
const FLEET = ['ss_left_right', 'ss_left_left', 'ss_right_right', 'ss_right_left'];
console.log('=== smokestack ' + action + ' ===');
const rows = targeted ? names : FLEET;
const target = names.length > 0 ? names[names.length - 1] : FLEET[0];
if (flags.includes('--dry-run')) {
  for (const name of rows) {
    if (action === 'to-swarm' && names.length === 2 && name === names[0]) {
      console.log(name + ': already in target mode - no mutation POST would be sent');
    } else {
      console.log(name + ': WOULD POST /api/config');
    }
  }
  console.log('VERDICT: DRY RUN - no changes made');
  console.log('PLAN FINGERPRINT: ' + fingerprint);
  process.exit(0);
}
if (flags.includes('--yes')) {
  // A re-release has no previous mode to restore, so it never carries the
  // mode path's rollback flag. Every other apply must.
  if (!flags.includes('--rollback-on-failure') && action !== 're-release') {
    console.log('VERDICT: NOT SAFE - stub expected --rollback-on-failure');
    process.exit(1);
  }
  const fingerprintIndex = flags.indexOf('--plan-fingerprint');
  const supplied = fingerprintIndex >= 0 ? flags[fingerprintIndex + 1] : null;
  // The pre-fix CLI enforced the fingerprint ONLY for a canonical run.
  const enforce = mode === 'patched' || !targeted;
  if (enforce && supplied === null) {
    console.log('USAGE ERROR: apply requires the --plan-fingerprint printed by the ' +
      'immediately preceding dry-run');
    process.exit(2);
  }
  if (enforce && supplied !== fingerprint) {
    console.log('VERDICT: REFUSED PLAN FINGERPRINT - NO board was mutated');
    process.exit(1);
  }
  if (mode === 'rollback') {
    console.log(target + ': verification FAILED after apply');
    console.log(target + ': rolled back to the pre-change snapshot');
    console.log('VERDICT: NOT SAFE - 1 board(s) failed; transaction rollback OK');
    process.exit(1);
  }
  if (action === 're-release') {
    for (const name of rows) console.log(name + '  PASS  assets->canonical  restored');
    console.log('VERDICT: OK');
    process.exit(0);
  }
  // The real CLI's phase markers, verbatim, so the panel's timeline parser is
  // exercised against the exact strings it claims to anchor on.
  if (!targeted) {
    console.log('pre-flight: parallel read-only plan sweep across all boards');
    for (const name of rows) console.log('  [' + name + '] pre-flight OK');
    console.log('  [' + rows[0] + '] POST /api/config');
    console.log('  [' + rows[0] + '] needs-reboot - queued for readiness polling');
    console.log('followers: parallel mutation POST across 3 board(s)');
    console.log('followers: parallel readiness wait across 3 board(s)');
    console.log('followers: parallel verification across 3 board(s)');
    if (action === 'to-swarm') {
      console.log('  [' + rows[1] + '] reboot-survival already proven: skipping the ' +
        'redundant terminal reboot');
    }
    console.log('terminal: independent canonical 4/4 asset/runtime readback');
    const arrow = action === 'to-dmx' ? 'SWARM->DMX' : 'DMX->SWARM';
    for (const name of rows) console.log(name + '  PASS  ' + arrow + '  verified');
  } else {
    for (const name of rows) {
      console.log(name + '  OK  ->' + (action === 'to-dmx' ? 'dmx' : 'swarm'));
    }
  }
  console.log(action === 'to-swarm' ? 'VERDICT: SAFE TO KILL NETWORK' : 'VERDICT: OK');
  process.exit(0);
}
console.log('refusing to mutate without --yes');
process.exit(2);
`;

let tmpRoot = '';
const servers = { provisioned: null, bare: null, patched: null, rollback: null };
const FORCE_DIGEST = 'ss_left_left|swarm|false|DETACHED|false|primary|true|1.2.5|true';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body));
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, agent: false,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve,
        { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (err) => done(reject, err));
    if (data) req.write(data);
    req.end();
  });
}

async function startServer(extraEnv) {
  const port = await freePort();
  const env = { ...process.env, SIM_SAVE_SERVER_PORT: String(port),
    SIM_SAVE_SERVER_ROOT: tmpRoot, ...extraEnv };
  // The bare server must be honestly UNPROVISIONED even on a machine where
  // the operator has the real deployment source exported.
  if (!extraEnv) {
    delete env.BM26_SMOKESTACK_CLI;
    delete env.BM26_DEPLOY_REGISTRY;
    delete env.BM26_SMOKESTACK_PYTHON;
  }
  const child = spawn(process.execPath, [SAVE_SERVER],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, port, exited: null };
  child.on('exit', (code, signal) => { record.exited = { code, signal }; });
  child.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(
      () => reject(new Error('save-server did not report listening in 10s')), 10_000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (/listening on/.test(buf)) { clearTimeout(to); resolve(); }
    });
  });
  return record;
}

async function pollJobDone(port, id, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await request(port, 'GET', `/smokestack/job?id=${id}`);
    assert.equal(r.status, 200, r.body);
    const { job } = JSON.parse(r.body);
    if (job.state === 'done') return job;
    if (Date.now() > deadline) throw new Error(`job ${id} still running after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function runGuardedAction(port, action) {
  const dryStart = await request(port, 'POST', '/smokestack/run', { action });
  assert.equal(dryStart.status, 200, dryStart.body);
  const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
  assert.equal(dryJob.verdictLine, 'VERDICT: DRY RUN - no changes made');
  assert.equal(dryJob.planFingerprint, 'b'.repeat(64));
  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action,
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dryJob.id,
  });
  assert.equal(applyStart.status, 200, applyStart.body);
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.equal(applyJob.exitCode, 0);
  assert.equal(applyJob.planFingerprint, dryJob.planFingerprint);
  assert.deepEqual(applyJob.args.slice(-2), ['--plan-fingerprint', dryJob.planFingerprint]);
  return applyJob;
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smokestack_routes_'));
  const stubCli = path.join(tmpRoot, 'stub_smokestack_cli.js');
  const stubRegistry = path.join(tmpRoot, 'stub_registry.yaml');
  fs.writeFileSync(stubCli, STUB_CLI);
  fs.writeFileSync(stubRegistry, 'controllers: []\n');

  servers.provisioned = await startServer({
    BM26_SMOKESTACK_CLI: stubCli,
    BM26_DEPLOY_REGISTRY: stubRegistry,
    BM26_SMOKESTACK_PYTHON: process.execPath,
  });
  servers.bare = await startServer(undefined);
  servers.patched = await startServer({
    BM26_SMOKESTACK_CLI: stubCli,
    BM26_DEPLOY_REGISTRY: stubRegistry,
    BM26_SMOKESTACK_PYTHON: process.execPath,
    BM26_STUB_MODE: 'patched',
  });
  servers.rollback = await startServer({
    BM26_SMOKESTACK_CLI: stubCli,
    BM26_DEPLOY_REGISTRY: stubRegistry,
    BM26_SMOKESTACK_PYTHON: process.execPath,
    BM26_STUB_MODE: 'rollback',
  });
});

after(() => {
  for (const record of Object.values(servers)) {
    if (record && record.child && record.exited === null) record.child.kill('SIGKILL');
  }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Contract parity ──────────────────────────────────────────────────────────

test('the browser model and the server enforce IDENTICAL confirm phrases', () => {
  assert.deepEqual(MODEL_CONFIRM_PHRASES, SERVER_CONFIRM_PHRASES);
  assert.deepEqual(MODEL_CONFIRM_PHRASES, {
    'to-dmx': 'SWITCH',
    'to-swarm': 'SWITCH',
    'repair-to-dmx': 'SWITCH',
  });
});

// ── /smokestack/provision ────────────────────────────────────────────────────

test('provision: provisioned server says so; bare server names the missing env vars', async () => {
  const yes = await request(servers.provisioned.port, 'GET', '/smokestack/provision');
  assert.equal(yes.status, 200);
  assert.equal(JSON.parse(yes.body).provisioned, true);

  const no = await request(servers.bare.port, 'GET', '/smokestack/provision');
  assert.equal(no.status, 200);
  const body = JSON.parse(no.body);
  assert.equal(body.provisioned, false);
  assert.deepEqual(body.missing, ['BM26_SMOKESTACK_CLI', 'BM26_DEPLOY_REGISTRY']);
  // Names only, never a path value.
  assert.equal(no.body.includes(tmpRoot), false);
});

// ── /smokestack/status ───────────────────────────────────────────────────────

test('status: hostile shapes are 400s, never crashes', async () => {
  const port = servers.provisioned.port;
  for (const [payload, errRe] of [
    ['not json', /invalid JSON/],
    ['null', /JSON object/],
    ['[1,2]', /JSON object/],
    [{ targets: 'x' }, /`targets` must be a list/],
    [{ targets: [], timeoutMs: -5 }, /timeoutMs/],
  ]) {
    const r = await request(port, 'POST', '/smokestack/status', payload);
    assert.equal(r.status, 400, JSON.stringify(payload));
    assert.match(JSON.parse(r.body).error, errRe);
  }
  assert.equal(servers.provisioned.exited, null);
});

test('status: unprobeable targets come back as loud unreachable RESULTS, in order', async () => {
  // Placeholder / empty / invalid IPs only — this test must not put a packet
  // on any network.
  const r = await request(servers.provisioned.port, 'POST', '/smokestack/status', {
    targets: [
      { id: 13, name: 'LeftLeftRopes', ip: '0.0.0.0' },
      { id: 24, name: 'RightRightRopes', ip: '' },
    ],
  });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.results.map((x) => x.id), [13, 24]);
  for (const result of body.results) {
    assert.equal(result.reachable, false);
    assert.match(result.detail, /not a probeable/);
  }
});

// ── /smokestack/run + /smokestack/job ────────────────────────────────────────

test('run: the bare server refuses with an honest 503 not-provisioned', async () => {
  const r = await request(servers.bare.port, 'POST', '/smokestack/run',
    { action: 'to-swarm' });
  assert.equal(r.status, 503);
  const body = JSON.parse(r.body);
  assert.equal(body.code, 'not_provisioned');
  assert.match(body.error, /deployment source not provisioned/);
});

test('run: bad action 400; apply without its dry-run 409; wrong phrase 403', async () => {
  const port = servers.provisioned.port;

  const bad = await request(port, 'POST', '/smokestack/run', { action: 'nuke' });
  assert.equal(bad.status, 400);

  const noDryRun = await request(port, 'POST', '/smokestack/run', {
    action: 'to-swarm', apply: true, confirm: MODEL_CONFIRM_PHRASES['to-swarm'] });
  assert.equal(noDryRun.status, 409);
  assert.equal(JSON.parse(noDryRun.body).code, 'dry_run_required');

  const wrongPhrase = await request(port, 'POST', '/smokestack/run', {
    action: 'to-swarm', apply: true, confirm: 'yes please' });
  assert.equal(wrongPhrase.status, 403);
  assert.equal(JSON.parse(wrongPhrase.body).code, 'confirm_mismatch');
});

test('run: the full operator chain — dry-run, typed confirm, apply, SAFE TO KILL NETWORK',
  async () => {
    const port = servers.provisioned.port;

    // Step 1: dry-run.
    const dryStart = await request(port, 'POST', '/smokestack/run', { action: 'to-swarm' });
    assert.equal(dryStart.status, 200, dryStart.body);
    const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
    assert.equal(dryJob.exitCode, 0);
    assert.equal(dryJob.apply, false);
    assert.equal(dryJob.verdictLine, 'VERDICT: DRY RUN - no changes made');
    assert.equal(dryJob.planFingerprint, 'b'.repeat(64));
    assert.match(dryJob.output, /=== smokestack to-swarm ===/);

    // Step 2: apply, referencing that dry-run, with the exact phrase.
    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 'to-swarm', apply: true,
      confirm: MODEL_CONFIRM_PHRASES['to-swarm'], dryRunJobId: dryJob.id });
    assert.equal(applyStart.status, 200, applyStart.body);
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
    assert.equal(applyJob.exitCode, 0);
    assert.deepEqual(applyJob.args, ['to-swarm', '--yes', '--rollback-on-failure',
      '--plan-fingerprint', 'b'.repeat(64)]);
    assert.equal(applyJob.verdictLine, VERDICT_SAFE_TO_KILL);

    // The browser outcome model reads this exact job as the green banner…
    assert.equal(jobOutcomeModel(applyJob).safeToKillNetwork, true);

    // …and a re-used dry-run cannot arm a SECOND apply of a different action.
    const crossAction = await request(port, 'POST', '/smokestack/run', {
      action: 'to-dmx', apply: true,
      confirm: MODEL_CONFIRM_PHRASES['to-dmx'], dryRunJobId: dryJob.id });
    assert.equal(crossAction.status, 409);
    assert.equal(JSON.parse(crossAction.body).code, 'dry_run_required');
  });

test('run: to-dmx apply chain verifies with VERDICT: OK (no kill verdict)', async () => {
  const port = servers.provisioned.port;
  const dryStart = await request(port, 'POST', '/smokestack/run', { action: 'to-dmx' });
  const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
  assert.equal(dryJob.exitCode, 0);

  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action: 'to-dmx', apply: true,
    confirm: MODEL_CONFIRM_PHRASES['to-dmx'], dryRunJobId: dryJob.id });
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.equal(applyJob.verdictLine, 'VERDICT: OK');
  const outcome = jobOutcomeModel(applyJob);
  assert.equal(outcome.kind, 'dmx_ok');
  assert.equal(outcome.safeToKillNetwork, false);
});

test('run: five full cycles plus idempotent same-mode actions retain plan binding', async () => {
  const port = servers.provisioned.port;
  for (let cycle = 1; cycle <= 5; cycle++) {
    const swarm = await runGuardedAction(port, 'to-swarm');
    assert.equal(swarm.verdictLine, VERDICT_SAFE_TO_KILL, `cycle ${cycle} to-swarm`);
    const dmx = await runGuardedAction(port, 'to-dmx');
    assert.equal(dmx.verdictLine, 'VERDICT: OK', `cycle ${cycle} to-dmx`);
  }
  assert.equal((await runGuardedAction(port, 'to-dmx')).verdictLine, 'VERDICT: OK');
  assert.equal((await runGuardedAction(port, 'to-swarm')).verdictLine, VERDICT_SAFE_TO_KILL);
  assert.equal((await runGuardedAction(port, 'to-swarm')).verdictLine, VERDICT_SAFE_TO_KILL);
});

test('run: targeted repair freezes .62 from dry-run through rollback apply', async () => {
  const port = servers.provisioned.port;
  const targetIds = ['ss_left_right'];
  const dryStart = await request(port, 'POST', '/smokestack/run', {
    action: 'repair-to-dmx', targetIds,
  });
  assert.equal(dryStart.status, 200, dryStart.body);
  const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
  assert.deepEqual(dryJob.targetIds, targetIds);
  assert.deepEqual(dryJob.args,
    ['to-dmx', '--names', 'ss_left_right', '--dry-run']);
  assert.equal(dryJob.verdictLine, 'VERDICT: DRY RUN - no changes made');

  const drift = await request(port, 'POST', '/smokestack/run', {
    action: 'repair-to-dmx',
    targetIds: ['ss_right_right'],
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dryJob.id,
  });
  assert.equal(drift.status, 409, drift.body);
  assert.equal(JSON.parse(drift.body).code, 'dry_run_target_mismatch');

  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action: 'repair-to-dmx',
    targetIds,
    apply: true,
    confirm: 'SWITCH',
    dryRunJobId: dryJob.id,
  });
  assert.equal(applyStart.status, 200, applyStart.body);
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.deepEqual(applyJob.targetIds, targetIds);
  assert.deepEqual(applyJob.args, [
    'to-dmx', '--names', 'ss_left_right', '--yes', '--rollback-on-failure',
    '--plan-fingerprint', 'b'.repeat(64),
  ]);
  assert.equal(applyJob.verdictLine, 'VERDICT: OK');
});

test('run: targeted repair rejects unsafe target shapes before spawning', async () => {
  const port = servers.provisioned.port;
  const refusedTargets = [
    [],
    ['ss_left_right', 'ss_left_right'],
    ['10.1.1.62'],
    ['rope-controller-2'],
  ];
  for (const targetIds of refusedTargets) {
    const response = await request(port, 'POST', '/smokestack/run', {
      action: 'repair-to-dmx', targetIds,
    });
    assert.equal(response.status, 400, response.body);
    assert.equal(JSON.parse(response.body).code, 'bad_targets');
  }
});

test('job: unknown ids are named 404s', async () => {
  const r = await request(servers.provisioned.port, 'GET', '/smokestack/job?id=99999');
  assert.equal(r.status, 404);
  assert.match(JSON.parse(r.body).error, /no smokestack job/);
});

// ── Advanced Recovery over the wire ──────────────────────────────────────────

/** Post-readback board rows the panel would build from a /smokestack/status
 * sweep. Explicit, so a test never accidentally asserts against a guess. */
function readbackBoards(modes) {
  return SMOKESTACK_CONTROLLER_IDS.map((controllerId) => ({
    controllerId, mode: modes[controllerId],
  }));
}

async function forceDryRun(port, action, targetId, extra = {}) {
  const start = await request(port, 'POST', '/smokestack/run', {
    action, targetIds: [targetId], preflightDigest: FORCE_DIGEST, ...extra,
  });
  assert.equal(start.status, 200, start.body);
  return pollJobDone(port, JSON.parse(start.body).job.id);
}

test('force: the model and the server derive IDENTICAL confirm phrases for all 8 combos', () => {
  for (const targetId of SMOKESTACK_CONTROLLER_IDS) {
    for (const [action, expected] of [
      ['force-to-dmx', `FORCE DMX ${targetId}`],
      ['force-to-swarm', `FORCE SWARM ${targetId}`],
    ]) {
      assert.equal(serverConfirmPhraseFor(action, [targetId]), expected);
      assert.equal(forceConfirmPhrase(action, targetId), expected);
    }
  }
  for (const action of ['to-dmx', 'to-swarm', 'repair-to-dmx']) {
    assert.equal(serverConfirmPhraseFor(action, null), MODEL_CONFIRM_PHRASES[action]);
  }
});

test('force: the full one-controller chain ends in an HONEST mixed-fleet verdict', async () => {
  const port = servers.provisioned.port;

  // 1. dry-run — the CLI's own --names selector, nothing else.
  const dryJob = await forceDryRun(port, 'force-to-dmx', 'ss_left_left');
  assert.equal(dryJob.exitCode, 0, dryJob.output);
  assert.deepEqual(dryJob.args, ['to-dmx', '--names', 'ss_left_left', '--dry-run']);
  assert.deepEqual(dryJob.targetIds, ['ss_left_left']);
  assert.deepEqual(dryJob.cliNames, ['ss_left_left']);
  assert.equal(dryJob.preflightDigest, FORCE_DIGEST);
  assert.equal(dryJob.consumed, false);
  assert.equal(dryJob.planFingerprint, 'b'.repeat(64));

  // 2. the controller-specific typed phrase — the fleet SWITCH is refused.
  const wrongPhrase = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'SWITCH', dryRunJobId: dryJob.id, preflightDigest: FORCE_DIGEST });
  assert.equal(wrongPhrase.status, 403);
  assert.equal(JSON.parse(wrongPhrase.body).code, 'confirm_mismatch');

  // 3. drift between the reviewed plan and now.
  const drifted = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', dryRunJobId: dryJob.id,
    preflightDigest: `${FORCE_DIGEST};ss_left_left FOLLOWING now` });
  assert.equal(drifted.status, 409);
  assert.equal(JSON.parse(drifted.body).code, 'force_drift');

  // 4. apply.
  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', dryRunJobId: dryJob.id,
    preflightDigest: FORCE_DIGEST });
  assert.equal(applyStart.status, 200, applyStart.body);
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.deepEqual(applyJob.args, ['to-dmx', '--names', 'ss_left_left', '--yes',
    '--rollback-on-failure', '--plan-fingerprint', 'b'.repeat(64)]);
  assert.equal(applyJob.verdictLine, 'VERDICT: OK');
  const outcome = jobOutcomeModel(applyJob);
  assert.equal(outcome.kind, 'force_dmx_ok');
  assert.equal(outcome.safeToKillNetwork, false);

  // 5. the readback decides — and the verdict stays honest about the fleet.
  assert.equal(
    forceFleetVerdict('force-to-dmx', 'ss_left_left', readbackBoards({
      ss_left_left: MODE_DMX, ss_left_right: MODE_SWARM,
      ss_right_right: MODE_SWARM, ss_right_left: MODE_SWARM })),
    'TARGET RECOVERED TO DMX — FLEET REMAINS MIXED');

  // 6. that dry-run is spent; a stale job id can never arm a second write.
  const replay = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', dryRunJobId: dryJob.id,
    preflightDigest: FORCE_DIGEST });
  assert.equal(replay.status, 409);
  assert.equal(JSON.parse(replay.body).code, 'dry_run_consumed');
});

test('force: a leader-only SWARM force gets the CLI kill verdict — BM never repeats it',
  async () => {
    const port = servers.provisioned.port;
    const dryJob = await forceDryRun(port, 'force-to-swarm', 'ss_left_right');
    assert.deepEqual(dryJob.args, ['to-swarm', '--names', 'ss_left_right', '--dry-run']);
    assert.equal(dryJob.leaderContextUnsafe, false);

    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 'force-to-swarm', targetIds: ['ss_left_right'], apply: true,
      confirm: 'FORCE SWARM ss_left_right', dryRunJobId: dryJob.id,
      preflightDigest: FORCE_DIGEST });
    assert.equal(applyStart.status, 200, applyStart.body);
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);

    // The CLI really does print it (its terminal check sees no followers).
    assert.equal(applyJob.verdictLine, VERDICT_SAFE_TO_KILL);
    const outcome = jobOutcomeModel(applyJob);
    assert.equal(outcome.kind, 'force_swarm_ok');
    assert.equal(outcome.safeToKillNetwork, false);
    assert.equal(/SAFE TO KILL/.test(outcome.headline), false);
    assert.equal(outcome.headline,
      'TARGET ss_left_right ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN');
    const verdict = forceFleetVerdict('force-to-swarm', 'ss_left_right', readbackBoards({
      ss_left_left: MODE_SWARM, ss_left_right: MODE_SWARM,
      ss_right_right: MODE_SWARM, ss_right_left: MODE_SWARM }));
    assert.equal(verdict, 'TARGET ENTERED SWARM — FLEET COHERENCE NOT YET PROVEN');
    assert.equal(/SAFE TO KILL/.test(verdict), false);
  });

test('force: a follower SWARM force carries the leader read-only, and PROVES it', async () => {
  const port = servers.provisioned.port;
  const dryJob = await forceDryRun(port, 'force-to-swarm', 'ss_left_left',
    { leaderContext: 'ss_left_right' });
  assert.deepEqual(dryJob.args,
    ['to-swarm', '--names', 'ss_left_right,ss_left_left', '--dry-run']);
  assert.deepEqual(dryJob.cliNames, ['ss_left_right', 'ss_left_left']);
  assert.match(dryJob.output,
    /ss_left_right: already in target mode - no mutation POST would be sent/);
  assert.equal(dryJob.leaderContextUnsafe, false);
  // The context name is not a target: only ss_left_left is ever written.
  assert.deepEqual(dryJob.targetIds, ['ss_left_left']);

  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-swarm', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE SWARM ss_left_left', dryRunJobId: dryJob.id,
    leaderContext: 'ss_left_right', preflightDigest: FORCE_DIGEST });
  assert.equal(applyStart.status, 200, applyStart.body);
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.deepEqual(applyJob.args, ['to-swarm', '--names', 'ss_left_right,ss_left_left',
    '--yes', '--rollback-on-failure', '--plan-fingerprint', 'b'.repeat(64)]);
});

test('force: unsafe target shapes and leader contexts are refused before any spawn', async () => {
  const port = servers.provisioned.port;
  for (const [payload, status, code] of [
    [{ action: 'force-to-dmx', preflightDigest: FORCE_DIGEST }, 400, 'force_target_required'],
    [{ action: 'force-to-dmx', targetIds: [], preflightDigest: FORCE_DIGEST },
      400, 'force_target_required'],
    [{ action: 'force-to-dmx', targetIds: ['ss_left_left', 'ss_right_right'],
      preflightDigest: FORCE_DIGEST }, 400, 'force_target_required'],
    [{ action: 'force-to-dmx', targetIds: ['10.1.1.61'], preflightDigest: FORCE_DIGEST },
      400, 'bad_targets'],
    [{ action: 'force-to-dmx', targetIds: ['LeftLeftRopes'], preflightDigest: FORCE_DIGEST },
      400, 'bad_targets'],
    [{ action: 'force-to-dmx', targetIds: ['ss_left_left'] }, 409, 'force_drift'],
    [{ action: 'force-to-swarm', targetIds: ['ss_left_left'], preflightDigest: FORCE_DIGEST },
      409, 'force_leader_context'],
    [{ action: 'force-to-swarm', targetIds: ['ss_left_left'], leaderContext: 'ss_right_right',
      preflightDigest: FORCE_DIGEST }, 409, 'force_leader_context'],
    [{ action: 'force-to-swarm', targetIds: ['ss_left_right'], leaderContext: 'ss_left_right',
      preflightDigest: FORCE_DIGEST }, 409, 'force_leader_context'],
  ]) {
    const response = await request(port, 'POST', '/smokestack/run', payload);
    assert.equal(response.status, status, `${JSON.stringify(payload)} ${response.body}`);
    assert.equal(JSON.parse(response.body).code, code, JSON.stringify(payload));
  }
});

test('force: a rolled-back apply is force_failed with the CLI reason and NO verified target',
  async () => {
    const port = servers.rollback.port;
    const dryJob = await forceDryRun(port, 'force-to-dmx', 'ss_left_left');
    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
      confirm: 'FORCE DMX ss_left_left', dryRunJobId: dryJob.id,
      preflightDigest: FORCE_DIGEST });
    assert.equal(applyStart.status, 200, applyStart.body);
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
    assert.equal(applyJob.exitCode, 1);

    const outcome = jobOutcomeModel(applyJob);
    assert.equal(outcome.kind, 'force_failed');
    assert.equal(outcome.safeToKillNetwork, false);
    assert.match(outcome.reason, /NOT SAFE - 1 board\(s\) failed; transaction rollback OK/);
    assert.match(applyJob.output, /rolled back to the pre-change snapshot/);

    // The board is back in SWARM, so the fleet verdict says so plainly.
    assert.match(
      forceFleetVerdict('force-to-dmx', 'ss_left_left', readbackBoards({
        ss_left_left: MODE_SWARM, ss_left_right: MODE_SWARM,
        ss_right_right: MODE_SWARM, ss_right_left: MODE_SWARM })),
      /^TARGET NOT VERIFIED — ss_left_left reads SWARM, expected DMX$/);
  });

test('force: a verdict-OK apply with a failed or incomplete readback is never green', () => {
  // Exit 0 + the CLI's own OK line is NOT the verdict — the independent
  // four-controller readback is, and a missing one says so.
  const applyJob = {
    action: 'force-to-dmx', apply: true, state: 'done', exitCode: 0,
    timedOut: false, outputTruncated: false, verdictLine: 'VERDICT: OK',
    targetIds: ['ss_left_left'], output: 'ss_left_left  OK  ->dmx\n',
  };
  assert.equal(jobOutcomeModel(applyJob).kind, 'force_dmx_ok');
  assert.equal(jobOutcomeModel(applyJob).safeToKillNetwork, false);
  assert.match(
    forceFleetVerdict('force-to-dmx', 'ss_left_left', readbackBoards({
      ss_left_left: MODE_UNREACHABLE, ss_left_right: MODE_SWARM,
      ss_right_right: MODE_SWARM, ss_right_left: MODE_SWARM })),
    /^TARGET NOT VERIFIED — ss_left_left reads UNREACHABLE/);
  assert.match(
    forceFleetVerdict('force-to-dmx', 'ss_left_left',
      readbackBoards({ ss_left_left: MODE_DMX, ss_left_right: MODE_SWARM,
        ss_right_right: MODE_SWARM, ss_right_left: MODE_SWARM }).slice(0, 2)),
    /readback is incomplete \(2\/4\)/);
});

test('force: BM refuses a fingerprint-less apply even where the OLD CLI would not', async () => {
  // The pre-fix CLI ignored --plan-fingerprint on every --names run
  // (report _352 §A5). BM never lets an apply reach it without one: the
  // fingerprint is read ONLY from the stored dry-run, and an apply with no
  // dry-run is refused outright — a request-body fingerprint buys nothing.
  const legacy = await request(servers.provisioned.port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', preflightDigest: FORCE_DIGEST,
    planFingerprint: 'e'.repeat(64) });
  assert.equal(legacy.status, 409);
  assert.equal(JSON.parse(legacy.body).code, 'dry_run_required');

  // And the companion-fixed CLI is the second lock: it demands the
  // fingerprint on a --names apply too, so the chain works end to end only
  // when BM passes the reviewed one through.
  const port = servers.patched.port;
  const dryJob = await forceDryRun(port, 'force-to-dmx', 'ss_left_left');
  const applyStart = await request(port, 'POST', '/smokestack/run', {
    action: 'force-to-dmx', targetIds: ['ss_left_left'], apply: true,
    confirm: 'FORCE DMX ss_left_left', dryRunJobId: dryJob.id,
    preflightDigest: FORCE_DIGEST });
  const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
  assert.equal(applyJob.exitCode, 0, applyJob.output);
  assert.deepEqual(applyJob.args.slice(-2), ['--plan-fingerprint', 'b'.repeat(64)]);
  assert.equal(applyJob.verdictLine, 'VERDICT: OK');
});

// ── Run timeline + panel/CLI verdict parity (report _354 §1.5) ──────────────

test('timeline: a real-shape apply log walks PREFLIGHT→VERDICT with four PASS chips',
  async () => {
    const port = servers.provisioned.port;
    const targets = SMOKESTACK_CONTROLLER_IDS.map((controllerId, index) => ({
      id: index + 1, controllerId,
    }));

    const dryStart = await request(port, 'POST', '/smokestack/run', { action: 'to-swarm' });
    const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
    // A dry-run models exactly two steps and yields the 64-hex fingerprint.
    const dryTimeline = runTimelineModel(dryJob, targets);
    assert.deepEqual(dryTimeline.steps.map((step) => step.key), ['PREFLIGHT', 'PLAN']);
    assert.equal(dryTimeline.planFingerprint, 'b'.repeat(64));

    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 'to-swarm', apply: true,
      confirm: MODEL_CONFIRM_PHRASES['to-swarm'], dryRunJobId: dryJob.id });
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);

    const timeline = runTimelineModel(applyJob, targets);
    assert.deepEqual(timeline.steps.map((step) => step.key), [
      'PREFLIGHT', 'CANARY', 'PARALLEL', 'REBOOT WAIT', 'VERIFY', 'COHERENCE',
      'READBACK', 'VERDICT',
    ]);
    for (const step of timeline.steps) {
      assert.equal(step.state, TIMELINE_DONE, `${step.key} must be done`);
    }
    assert.equal(timeline.rolledBack, false);
    // All four boards settled with an explicit PASS row — no UNKNOWN, and no
    // chip left showing mid-flight progress.
    for (const controllerId of SMOKESTACK_CONTROLLER_IDS) {
      assert.equal(timeline.chips.get(controllerId).text, 'PASS', controllerId);
      assert.equal(timeline.chips.get(controllerId).cls, 'smk-transition-ok');
    }
    assert.ok(timeline.elapsedMs >= 0);

    // PANEL/CLI PARITY: the timeline's verdict, the job's extracted verdict and
    // the outcome model's trusted line are the SAME bytes the CLI printed.
    const cliLine = applyJob.output.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line.startsWith('VERDICT: ')).pop();
    assert.equal(timeline.verdictLine, cliLine);
    assert.equal(applyJob.verdictLine, cliLine);
    assert.equal(cliLine, VERDICT_SAFE_TO_KILL);
    assert.equal(jobOutcomeModel(applyJob).safeToKillNetwork, true);
  });

test('timeline: a rolled-back apply fails its step and never reports READBACK done',
  async () => {
    const port = servers.rollback.port;
    const targets = SMOKESTACK_CONTROLLER_IDS.map((controllerId, index) => ({
      id: index + 1, controllerId,
    }));
    const dryStart = await request(port, 'POST', '/smokestack/run', { action: 'to-swarm' });
    const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 'to-swarm', apply: true,
      confirm: MODEL_CONFIRM_PHRASES['to-swarm'], dryRunJobId: dryJob.id });
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
    assert.equal(applyJob.exitCode, 1);

    const timeline = runTimelineModel(applyJob, targets);
    // The stub's rollback wording is not one of the anchored phase lines, so
    // the parser refuses to claim ANY later phase completed.
    assert.notEqual(
      timeline.steps.find((step) => step.key === 'READBACK').state, TIMELINE_DONE);
    assert.notEqual(
      timeline.steps.find((step) => step.key === 'VERDICT').state, TIMELINE_FAILED);
    // Every board is UNKNOWN — the run printed no result row for any of them.
    for (const controllerId of SMOKESTACK_CONTROLLER_IDS) {
      assert.equal(timeline.chips.get(controllerId).text, 'UNKNOWN', controllerId);
    }
    assert.equal(jobOutcomeModel(applyJob).safeToKillNetwork, false);
    assert.equal(applyJob.verdictLine,
      'VERDICT: NOT SAFE - 1 board(s) failed; transaction rollback OK');
  });

// ── Asset re-release, end to end through the real server ────────────────────

test('re-release: the full asset-repair chain runs the CLI subcommand and verifies honestly',
  async () => {
    const port = servers.patched.port;
    const targetIds = ['ss_left_left', 'ss_right_right'];

    const dryStart = await request(port, 'POST', '/smokestack/run',
      { action: 're-release', targetIds });
    assert.equal(dryStart.status, 200, dryStart.body);
    const dryJob = await pollJobDone(port, JSON.parse(dryStart.body).job.id);
    assert.equal(dryJob.exitCode, 0);
    assert.deepEqual(dryJob.args,
      ['re-release', '--names', 'ss_left_left,ss_right_right', '--dry-run']);
    assert.deepEqual(dryJob.targetIds, targetIds);
    assert.equal(dryJob.planFingerprint, 'b'.repeat(64));

    // The multi-board phrase is required; the single-board one cannot arm it.
    const wrongPhrase = await request(port, 'POST', '/smokestack/run', {
      action: 're-release', apply: true, targetIds,
      confirm: 'RE-RELEASE ss_left_left', dryRunJobId: dryJob.id });
    assert.equal(wrongPhrase.status, 403);
    assert.equal(JSON.parse(wrongPhrase.body).code, 'confirm_mismatch');

    const applyStart = await request(port, 'POST', '/smokestack/run', {
      action: 're-release', apply: true, targetIds,
      confirm: 'RE-RELEASE ALL', dryRunJobId: dryJob.id });
    assert.equal(applyStart.status, 200, applyStart.body);
    const applyJob = await pollJobDone(port, JSON.parse(applyStart.body).job.id);
    assert.equal(applyJob.exitCode, 0);
    // The asset subcommand, fingerprint-bound, WITHOUT the mode path's flags.
    assert.deepEqual(applyJob.args, ['re-release', '--names', 'ss_left_left,ss_right_right',
      '--yes', '--plan-fingerprint', 'b'.repeat(64)]);
    assert.equal(applyJob.args.includes('--rollback-on-failure'), false);
    assert.equal(applyJob.verdictLine, 'VERDICT: OK');

    const outcome = jobOutcomeModel(applyJob);
    assert.equal(outcome.kind, 're_release_ok');
    // Exit 0 is HALF the evidence: the panel still says "pending readback".
    assert.equal(outcome.safeToKillNetwork, false);
    assert.match(outcome.headline, /pending independent readback/);

    // The independent readback is what decides. Still-residue ⇒ not verified.
    const canonical = SMOKESTACK_CONTROLLER_IDS.map((controllerId) =>
      ({ controllerId, assets: ASSETS_CANONICAL }));
    assert.match(reReleaseFleetVerdict(targetIds, canonical), /^ASSETS RESTORED/);
    assert.match(reReleaseFleetVerdict(targetIds, canonical.map((row) =>
      row.controllerId === 'ss_left_left' ? { ...row, assets: ASSETS_RESIDUE } : row)),
    /^ASSETS NOT VERIFIED — ss_left_left/);
  });

test('re-release: a fingerprint-less apply is refused by BM before the CLI ever runs',
  async () => {
    const port = servers.patched.port;
    // No dry-run at all ⇒ nothing to bind to.
    const noPlan = await request(port, 'POST', '/smokestack/run', {
      action: 're-release', apply: true, targetIds: ['ss_left_left'],
      confirm: 'RE-RELEASE ss_left_left' });
    assert.equal(noPlan.status, 409);
    assert.equal(JSON.parse(noPlan.body).code, 'dry_run_required');

    // A mode dry-run can never arm an asset apply, and vice versa.
    const modeDry = await request(port, 'POST', '/smokestack/run', { action: 'to-dmx' });
    const modeDryJob = await pollJobDone(port, JSON.parse(modeDry.body).job.id);
    const crossed = await request(port, 'POST', '/smokestack/run', {
      action: 're-release', apply: true, targetIds: ['ss_left_left'],
      confirm: 'RE-RELEASE ss_left_left', dryRunJobId: modeDryJob.id });
    assert.equal(crossed.status, 409);
    assert.equal(JSON.parse(crossed.body).code, 'dry_run_required');
  });

test('re-release: model and server derive the SAME confirm phrase for every target shape', () => {
  const shapes = [
    ['ss_left_left'], ['ss_left_right'], ['ss_right_right'], ['ss_right_left'],
    ['ss_left_left', 'ss_right_right'], SMOKESTACK_CONTROLLER_IDS.slice(),
  ];
  for (const ids of shapes) {
    assert.equal(serverConfirmPhraseFor('re-release', ids), reReleaseConfirmPhrase(ids),
      ids.join(','));
  }
});
