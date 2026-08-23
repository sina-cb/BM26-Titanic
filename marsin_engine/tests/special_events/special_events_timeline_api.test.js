// ══ SPECIAL EVENTS × TIMELINE AUTHORITY (docs/52 + report `_200`) ═════════
//
// A special event is an operator TAKEOVER. It rides the timeline's existing
// operator lease rather than inventing a lock, which means it inherits the
// operator's 2026-08-14 ruling verbatim:
//
//   "The timeline is high priority."
//
// So this suite pins two things a unit test cannot reach:
//
//   1. THE PLAN OUTRANKS THE EVENT. Pressing RESUME is never blocked — and
//      when it lands, the runner sees on its next tick that the lease it took
//      at ARM is gone and ABORTS the show WITH the restore, loudly. It never
//      re-seizes. A plan switched OFF, by contrast, drives nothing, so it does
//      NOT end a live show.
//   2. ARM IS A TAKEOVER, so in performance mode it needs a FRESH operator
//      passcode every single time — the same gate POST /timeline/takeover
//      wears. Giving the rig back (ABORT) is never gated.
//
// The credentials here are TEST LITERALS written into the harness temp dir. No
// real credential material exists in this repo — the engine reads its own
// exclusively from the external $BM26_SECRETS file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import '../helpers/setup_config_guard.mjs';
import { buildE2EPlan, createTimelineE2E, sleep, until } from '../e2e/timeline_e2e_harness.mjs';

/** A two-stage bench show on real test_bench playlists. */
const BENCH_SHOW = {
  schemaVersion: 1,
  id: 'bench_event',
  name: 'Bench Event',
  stages: [
    { id: 'tease', label: 'TEASE', actions: [{ type: 'playlist', playlist: 'ambient' }] },
    { id: 'blackout', label: 'GO DARK', actions: [{ type: 'masterFade', target: 0.0, durationMs: 300 }] },
  ],
};

/** Test-only passphrases. Deliberately obvious placeholders. */
const TEST_SECRETS = {
  owner: 'test-owner-passphrase',
  collaborator: 'test-collaborator-passphrase',
  bringup: 'test-bringup-passphrase',
};

function writeTestSecrets(dir) {
  const secretsPath = path.join(dir, 'test_secrets.yaml');
  fs.writeFileSync(secretsPath, [
    `SinaAuth: ${TEST_SECRETS.owner}`,
    `MishaAuth: ${TEST_SECRETS.collaborator}`,
    `MARITIME_TERM_FOR_SAILIOR_PASS: ${TEST_SECRETS.bringup}`,
    '',
  ].join('\n'), 'utf8');
  return secretsPath;
}

/** Seed the shows dir the engine will read, and return its path. */
function writeShows(root) {
  const dir = path.join(root, 'special_events');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bench_event.yaml'), yaml.dump(BENCH_SHOW), 'utf8');
  return dir;
}

async function eventState(h) {
  const r = await h.api('GET', '/special-events/state');
  assert.equal(r.status, 200, `GET /special-events/state → ${r.status}`);
  return r.data;
}

async function post(h, url, body, headers = {}) {
  const res = await fetch(h.base() + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

test('manual Timeline special-event cue arms and starts the selected show', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'event_cue', showInMin: 240 });
  plan.cues.push({
    id: 'c_manual_event',
    label: 'Bench Event',
    kind: 'program',
    trigger: { type: 'manual', placementAt: '20:00' },
    action: { type: 'special_event', showId: 'bench_event' },
    durationMin: 30,
    days: 'all',
  });
  const showsRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR || process.env.TEMP || '/tmp', 'se-cue-'));
  const showsDir = writeShows(showsRoot);
  const h = createTimelineE2E({
    prefix: 'special-events-cue',
    plans: { event_cue: plan },
    activePlan: 'event_cue',
    extraEnv: {
      MARSIN_SPECIAL_EVENTS_DIR: showsDir,
      BM26_CAPTAINPAD_AUTH_REQUIRED: '0',
    },
  });

  try {
    await h.start();
    const fired = await h.api('POST', '/timeline/cues/c_manual_event/fire');
    assert.equal(fired.status, 200, JSON.stringify(fired.data));
    const event = await until(() => eventState(h), state => state.status === 'running',
      { what: 'manual cue to start the event' });
    assert.equal(event.showId, 'bench_event');
    assert.equal(event.stageId, 'tease');
    await until(() => h.deck(), state => state.name === 'ambient', { what: 'event tease playlist' });
    const timeline = await h.state();
    assert.equal(timeline.mode, 'overridden', 'the staged event owns the rig after cue fire');
  } finally {
    await h.teardown();
    fs.rmSync(showsRoot, { recursive: true, force: true });
  }
});

test('timeline RESUME takes the rig back and the special event aborts with a restore', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'event_priority', showInMin: 240 });
  // The shows dir must exist before the engine boots, so build it on a path we
  // control and hand the harness the env var.
  const showsRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR || process.env.TEMP || '/tmp', 'se-tl-'));
  const showsDir = writeShows(showsRoot);
  const h = createTimelineE2E({
    prefix: 'special-events-priority',
    plans: { event_priority: plan },
    activePlan: 'event_priority',
    // Long lease so ONLY the explicit RESUME can end the takeover.
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: {
      MARSIN_SPECIAL_EVENTS_DIR: showsDir,
      BM26_CAPTAINPAD_AUTH_REQUIRED: '0',
    },
  });

  try {
    await h.start();
    await until(() => h.state(), s => s.planActive === true, { what: 'the plan to drive the deck' });

    // ARM → the event takes the plan's operator lease.
    const armed = await h.api('POST', '/special-events/arm', { show: 'bench_event' });
    assert.equal(armed.status, 200, JSON.stringify(armed.data));
    assert.equal(armed.data.state.timelineLeaseHeld, true,
      'ARM must take the timeline lease when a plan is driving');
    const tl = await h.state();
    assert.equal(tl.mode, 'overridden', 'the plan should yield to the event');
    assert.ok(tl.operatorLease, 'the event should hold an operator lease');

    const fired = await h.api('POST', '/special-events/fire', { stageId: 'tease' });
    assert.equal(fired.status, 200, JSON.stringify(fired.data));
    await until(() => h.deck(), d => d.name === 'ambient', { what: 'the tease playlist' });

    // RESUME IS NEVER BLOCKED — not by the event, not by anything.
    const resumed = await h.api('POST', '/timeline/resume');
    assert.equal(resumed.status, 200, JSON.stringify(resumed.data));

    // Within a tick the runner notices the lease is gone and ends the show.
    const ended = await until(() => eventState(h), s => s.status === 'ended',
      { what: 'the event to abort after the plan took the rig back', timeoutMs: 8000 });
    assert.equal(ended.endedReason, 'aborted');
    assert.match(ended.endedDetail, /timeline resumed and took the rig back/);

    // The plan is driving again, and the event NEVER re-seizes it.
    await until(() => h.state(), s => s.mode === 'armed' && !s.operatorLease,
      { what: 'the plan to hold the rig' });
    await sleep(2500);
    const after = await h.state();
    assert.equal(after.mode, 'armed', 'the event re-seized the timeline after being overruled');
    assert.equal((await eventState(h)).status, 'ended');
  } finally {
    await h.teardown();
    fs.rmSync(showsRoot, { recursive: true, force: true });
  }
});

test('a plan switched OFF drives nothing, so it does NOT end a live special event', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'event_planoff', showInMin: 240 });
  const showsRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR || process.env.TEMP || '/tmp', 'se-tl-off-'));
  const showsDir = writeShows(showsRoot);
  const h = createTimelineE2E({
    prefix: 'special-events-plan-off',
    plans: { event_planoff: plan },
    activePlan: 'event_planoff',
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: {
      MARSIN_SPECIAL_EVENTS_DIR: showsDir,
      BM26_CAPTAINPAD_AUTH_REQUIRED: '0',
    },
  });

  try {
    await h.start();
    await until(() => h.state(), s => s.planActive === true, { what: 'the plan to drive the deck' });

    assert.equal((await h.api('POST', '/special-events/arm', { show: 'bench_event' })).status, 200);
    assert.equal((await h.api('POST', '/special-events/fire', { stageId: 'tease' })).status, 200);

    // AUTO OFF: `_goDormant` clears the takeover lease, but a disabled plan
    // drives nothing — there is no authority to lose and the show plays on.
    const off = await h.api('POST', '/timeline/autopilot', { enabled: false });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    await until(() => h.state(), s => s.planActive === false, { what: 'the plan to go inert' });

    await sleep(3000);
    const st = await eventState(h);
    assert.equal(st.status, 'running', 'switching the plan OFF must not tear a live show down');
    assert.equal(st.stageId, 'tease');

    const aborted = await h.api('POST', '/special-events/abort');
    assert.equal(aborted.status, 200, JSON.stringify(aborted.data));
    assert.equal(aborted.data.state.endedReason, 'aborted');
  } finally {
    await h.teardown();
    fs.rmSync(showsRoot, { recursive: true, force: true });
  }
});

test('performance mode gates special-event ARM on a FRESH operator passcode', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'event_auth', showInMin: 240 });
  const showsRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR || process.env.TEMP || '/tmp', 'se-tl-auth-'));
  const showsDir = writeShows(showsRoot);
  const h = createTimelineE2E({
    prefix: 'special-events-auth',
    plans: { event_auth: plan },
    activePlan: 'event_auth',
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: { MARSIN_SPECIAL_EVENTS_DIR: showsDir },
  });
  const secretsPath = writeTestSecrets(h.root);
  process.env.BM26_SECRETS = secretsPath;
  process.env.BM26_CAPTAINPAD_AUTH_REQUIRED = '1';

  let sessionToken = null;
  try {
    await h.start();
    await until(() => h.state(), s => s.planActive === true, { what: 'the plan to drive the deck' });

    // docs/56 D1: an auth-REQUIRED engine BOOTS locked. Leave the lock with the
    // captain's passcode first so the perf-mode-OFF assertions below start from
    // the state they were written for.
    const bootLocked = await h.api('GET', '/performance-mode');
    assert.equal(bootLocked.data.active, true, 'auth-required engine did not boot locked');
    const bootExit = await post(h, '/performance-mode', { active: false, exitAction: 'keep' },
      { 'X-CaptainPad-Passcode': TEST_SECRETS.owner });
    assert.equal(bootExit.status, 200, JSON.stringify(bootExit.data));
    assert.equal(bootExit.data.editPrincipal, 'owner');

    // Performance mode OFF → no gate at all. ARM, then hand the rig straight
    // back so the mode transition below starts from a clean rig.
    const openArm = await h.api('POST', '/special-events/arm', { show: 'bench_event' });
    assert.equal(openArm.status, 200, JSON.stringify(openArm.data));
    assert.equal((await h.api('POST', '/special-events/abort')).status, 200);
    assert.equal((await h.api('POST', '/special-events/dismiss')).status, 200);

    const enter = await h.api('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));

    // READ routes stay open in performance mode — the tab must be reachable to
    // be armed at all.
    assert.equal((await h.api('GET', '/special-events')).status, 200);
    assert.equal((await h.api('GET', '/special-events/state')).status, 200);

    // No passcode → refused, nothing armed, and no secret in the body.
    const bare = await h.api('POST', '/special-events/arm', { show: 'bench_event' });
    assert.equal(bare.status, 401, JSON.stringify(bare.data));
    assert.equal(bare.data.code, 'TAKEOVER_AUTH_REQUIRED');
    assert.equal(JSON.stringify(bare.data).includes(TEST_SECRETS.owner), false);
    assert.equal((await eventState(h)).status, 'idle');

    // Wrong passcode → refused, and the attempt is never echoed back.
    const wrong = await post(h, '/special-events/arm', { show: 'bench_event' },
      { 'X-CaptainPad-Passcode': 'not-the-passcode' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.code, 'TAKEOVER_AUTH_INVALID');
    assert.equal(JSON.stringify(wrong.data).includes('not-the-passcode'), false);
    assert.equal((await eventState(h)).status, 'idle');

    // A privileged SESSION is NOT a substitute — EVERY TIME means every time.
    const login = await h.api('POST', '/captainpad/auth/login', {
      passphrase: TEST_SECRETS.owner, remember30: true,
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    sessionToken = login.data.token;
    const withSession = await post(h, '/special-events/arm', { show: 'bench_event' },
      { 'X-CaptainPad-Session': sessionToken });
    assert.equal(withSession.status, 401, 'a session token bypassed the ARM passcode');
    assert.equal((await eventState(h)).status, 'idle');

    // Each of the three named principals authorises an ARM, and each ARM needs
    // its own fresh passcode.
    for (const passphrase of Object.values(TEST_SECRETS)) {
      const ok = await post(h, '/special-events/arm', { show: 'bench_event' },
        { 'X-CaptainPad-Passcode': passphrase });
      assert.equal(ok.status, 200, `principal passphrase refused: ${JSON.stringify(ok.data)}`);
      assert.equal(ok.data.state.status, 'armed');

      // GIVING THE RIG BACK IS NEVER GATED — abort takes no passcode at all.
      const back = await h.api('POST', '/special-events/abort');
      assert.equal(back.status, 200, JSON.stringify(back.data));
      assert.equal((await h.api('POST', '/special-events/dismiss')).status, 200);
    }

    // No credential material anywhere in the engine's own output.
    for (const secret of Object.values(TEST_SECRETS)) {
      assert.equal(h.stdout.includes(secret), false, 'a passphrase reached the engine log');
    }

    // docs/56 D2: the exit takes a fresh passcode, never a session token.
    const sessionOnlyExit = await post(h, '/performance-mode',
      { active: false, exitAction: 'keep' }, { 'X-CaptainPad-Session': sessionToken });
    assert.equal(sessionOnlyExit.status, 401, 'a session token ended performance mode');
    assert.equal(sessionOnlyExit.data.code, 'EXIT_AUTH_REQUIRED');

    const exit = await post(h, '/performance-mode', { active: false, exitAction: 'keep' },
      { 'X-CaptainPad-Passcode': TEST_SECRETS.owner });
    assert.equal(exit.status, 200, JSON.stringify(exit.data));
  } finally {
    delete process.env.BM26_SECRETS;
    delete process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
    try { fs.rmSync(secretsPath, { force: true }); } catch { /* temp dir goes anyway */ }
    await h.teardown();
    fs.rmSync(showsRoot, { recursive: true, force: true });
  }
});
