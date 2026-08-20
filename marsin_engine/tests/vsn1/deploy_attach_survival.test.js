// VSN1 attach state machine + engine-survival regressions.
//
// WHY (report .agent/reports/202607/20260725_30_…, fix plan steps 6 + 9):
//
// 1. ATTACH STATE. The engine used to deploy BLIND — the only gate was config,
//    so with no VSN1 plugged in every layout change spawned the full CLI, burned
//    a ~2-3 s compile, failed with "No VSN1 found", RE-QUEUED the page, and
//    painted a red banner. Per edit. Forever. "Not attached" now exists as a
//    first-class state: pending pages cleared, ONE line logged per transition,
//    no child spawned, no throw.
//
// 2. SURVIVAL. The operator's stack died with a libuv abort
//    (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) right after a
//    deploy failure. The deploy child was exonerated as the cause, but the
//    engine's duty either way is to SURVIVE anything a child does to it. These
//    tests fire the nastiest child behaviours we can synthesize — a 6 KB stderr
//    dump, a spawn `error` event, a Windows hard-abort exit code — and assert
//    the hook settles cleanly, leaks no unhandled rejection, and is still usable
//    afterwards.
//
// Zero real processes: spawnFn and probeFn are both injected. Nothing here can
// touch a device, a port, or the operator's live stack.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLayoutDeployHook } from '../../lib/vsn1_layout_deploy.js';

// Windows STATUS_STACK_BUFFER_OVERRUN — what a Node process that hits an
// assert/abort actually exits with. This is the code the operator's crash
// would have produced in the deploy child.
const WINDOWS_ABORT_EXIT = 3221226505;

const mkDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `vsn1-${tag}-`));

const layoutEvt = (revision = 1, pages = [0]) => ({
  type: 'layout-changed', revision, pages,
  layout: { version: 1, slots: [{ slotId: 1, effectId: 'strobe' }] },
});

/**
 * A fake spawn whose child behaviour is decided per call by `behave(args)`:
 *   { code }            → close with this exit code
 *   { code, stderr }    → emit stderr first, then close
 *   { emitError: Error} → emit an 'error' event (a real spawn failure)
 *   { throwSync: Error }→ throw synchronously from spawn() itself
 */
function mkSpawn(calls, behave) {
  return (cmd, args) => {
    const plan = behave(args) || { code: 0 };
    calls.push({ cmd, args, killed: false });
    const entry = calls[calls.length - 1];
    if (plan.throwSync) throw plan.throwSync;
    const handlers = {};
    const stdoutCbs = [];
    const stderrCbs = [];
    const child = {
      stdout: { on: (ev, cb) => { if (ev === 'data') stdoutCbs.push(cb); } },
      stderr: { on: (ev, cb) => { if (ev === 'data') stderrCbs.push(cb); } },
      on: (ev, cb) => { handlers[ev] = cb; },
      kill: () => { entry.killed = true; },
      unref: () => { entry.unrefed = true; },
    };
    // Deliver asynchronously, like a real child.
    setImmediate(() => {
      if (plan.emitError) { if (handlers.error) handlers.error(plan.emitError); return; }
      if (plan.stdout) for (const cb of stdoutCbs) cb(Buffer.from(plan.stdout));
      if (plan.stderr) for (const cb of stderrCbs) cb(Buffer.from(plan.stderr));
      if (handlers.close) handlers.close(plan.code);
    });
    return child;
  };
}

/** Deploy-CLI calls only (the probe/soft-reset children carry no --page). */
const deployCalls = (calls) => calls.filter((c) => c.args.includes('--page'));

/** Capture console output for the duration of `fn`. */
async function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return lines;
}

const skipLines = (lines) => lines.filter((l) => l.includes('VSN1 not attached'));

/** Let pending microtasks + the unhandledRejection check run. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};

// ── unhandled-rejection trap (the "engine survives" assertion) ──────────
const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
before(() => { process.on('unhandledRejection', onUnhandled); });
after(() => { process.off('unhandledRejection', onUnhandled); });
beforeEach(() => { unhandled.length = 0; });

function mkFakeTimer() {
  const state = { cb: null };
  return {
    setTimeoutFn: (cb) => { state.cb = cb; return 1; },
    clearTimeoutFn: () => { state.cb = null; },
    fire: () => { const c = state.cb; state.cb = null; if (c) c(); },
    armed: () => state.cb !== null,
  };
}

// ── 1. Detached: the state that did not exist before ────────────────────

test('DETACHED: a layout change spawns NO deploy child and does not throw', async () => {
  const calls = [];
  const { hook, status, flush } = createLayoutDeployHook({
    stateDir: mkDir('detached'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => 'detached',
  });
  const lines = await captureConsole(async () => {
    await hook(layoutEvt(1));
    await flush(); // MUST resolve — "no device" is not an error
  });
  assert.equal(deployCalls(calls).length, 0, 'no deploy child may spawn with nothing attached');
  assert.equal(status.lastResult, 'skipped-detached');
  assert.equal(status.attachState, 'detached');
  assert.equal(status.lastError, null, 'a skip is not an error');
  assert.deepEqual(status.pendingPages, [], 'pending pages are CLEARED, never left to pile up');
  assert.equal(skipLines(lines).length, 1, 'exactly one skip line');
  await settle();
  assert.deepEqual(unhandled, [], 'no unhandled rejection');
});

test('DETACHED: ten edits produce exactly ONE skip line (no per-change spam)', async () => {
  const calls = [];
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('detached-spam'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => 'detached',
  });
  const lines = await captureConsole(async () => {
    for (let i = 1; i <= 10; i++) { await hook(layoutEvt(i)); await flush(); }
  });
  // This is the whole point of the transition latch: an operator editing with
  // the controller unplugged sees ONE message, not ten.
  assert.equal(skipLines(lines).length, 1, `expected 1 skip line, got ${skipLines(lines).length}`);
  assert.equal(deployCalls(calls).length, 0, 'still no deploy children');
  assert.equal(status.lastResult, 'skipped-detached');
});

test('the layout YAML is STILL written while detached (tools keep working)', async () => {
  const dir = mkDir('detached-yaml');
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn([], () => ({ code: 0 })),
    probeFn: async () => 'detached',
  });
  await captureConsole(async () => { await hook(layoutEvt(3)); await flush(); });
  assert.ok(fs.existsSync(path.join(dir, 'vsn1_layout.yaml')),
    'the inspection artifact is independent of the device being present');
});

// ── 2. Hot plug / unplug ────────────────────────────────────────────────

test('device VANISHES between the debounce and the drain — caught, skipped, once', async () => {
  const calls = [];
  const timer = mkFakeTimer();
  let attach = 'attached';
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('vanish'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => attach,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });
  const lines = await captureConsole(async () => {
    // A first edit deploys normally.
    await hook(layoutEvt(1));
    timer.fire();
    await flush();
    assert.equal(deployCalls(calls).length, 1, 'the attached deploy went through');

    // Operator queues another edit, THEN yanks the USB cable before the quiet
    // period elapses. The probe at the top of the drain is what catches it.
    await hook(layoutEvt(2));
    attach = 'detached';
    timer.fire();
    await flush();
  });
  assert.equal(deployCalls(calls).length, 1, 'no child spawned for the vanished device');
  assert.equal(status.lastResult, 'skipped-detached');
  assert.deepEqual(status.pendingPages, []);
  assert.equal(skipLines(lines).length, 1, 'exactly ONE skip line for the transition');
  await settle();
  assert.deepEqual(unhandled, [], 'a device vanishing mid-burst must not crash the engine');
});

test('REATTACH: plugging back in re-queues page 0 once and deploys the missed edits', async () => {
  const calls = [];
  let attach = 'detached';
  const { hook, flush, status, probeAttach } = createLayoutDeployHook({
    stateDir: mkDir('reattach'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => attach,
  });
  await captureConsole(async () => {
    await hook(layoutEvt(7));   // edited while unplugged
    await flush();
    assert.equal(deployCalls(calls).length, 0);
    assert.equal(status.lastResult, 'skipped-detached');

    attach = 'attached';        // operator plugs it back in
    await probeAttach();        // the next decision point notices
    await flush();
  });
  assert.equal(deployCalls(calls).length, 1, 'the missed edit is flashed exactly once on reattach');
  assert.equal(status.lastResult, 'ok');
  assert.equal(status.attachState, 'attached');

  // …and it does NOT re-queue again on a later probe (once means once).
  await captureConsole(async () => { await probeAttach(); await flush(); });
  assert.equal(deployCalls(calls).length, 1, 'no repeat catch-up deploy');
});

test('UNKNOWN probe result does not block the deploy (we could not tell, so we try)', async () => {
  const calls = [];
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('unknown'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => 'unknown',
  });
  await captureConsole(async () => { await hook(layoutEvt(1)); await flush(); });
  // A broken probe must never silently disable deploys — that would be a
  // fallback behaviour masquerading as safety (Codex P0).
  assert.equal(deployCalls(calls).length, 1, 'an unknown attach state still attempts the deploy');
  assert.equal(status.lastResult, 'ok');
  assert.equal(status.attachState, 'unknown');
});

test('a THROWING probe degrades to unknown, not to detached', async () => {
  const calls = [];
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('probe-throw'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => { throw new Error('probe exploded'); },
  });
  const lines = await captureConsole(async () => { await hook(layoutEvt(1)); await flush(); });
  assert.equal(status.attachState, 'unknown');
  assert.equal(deployCalls(calls).length, 1, 'still attempts');
  assert.equal(skipLines(lines).length, 0, 'a broken probe is NOT a "not attached" claim');
  await settle();
  assert.deepEqual(unhandled, []);
});

test('the DEFAULT probe maps CLI exit codes 0/3/other to attached/detached/unknown', async () => {
  // No probeFn injected — this exercises the real probe_vsn1.cjs contract
  // through the injected spawn, so the exit-code mapping itself is covered.
  for (const [code, expected] of [[0, 'attached'], [3, 'detached'], [1, 'unknown'], [2, 'unknown']]) {
    const calls = [];
    const { hook, flush, status } = createLayoutDeployHook({
      stateDir: mkDir(`probe-exit-${code}`),
      engineConfig: { vsn1: { deployLayout: true } },
      spawnFn: mkSpawn(calls, (args) => (
        args.some((a) => a.endsWith('probe_vsn1.cjs')) ? { code } : { code: 0 }
      )),
    });
    await captureConsole(async () => { await hook(layoutEvt(1)); await flush(); });
    assert.equal(status.attachState, expected, `probe exit ${code} → ${expected}`);
    assert.ok(
      calls.some((c) => c.args.some((a) => a.endsWith('probe_vsn1.cjs'))),
      'the probe CLI is actually invoked',
    );
  }
});

test('probe is NOT spawned at all when layout deploy is config-gated OFF', async () => {
  const calls = [];
  const { probeAttach } = createLayoutDeployHook({
    stateDir: mkDir('gated-off'),
    engineConfig: {}, // deploy disabled
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
  });
  const state = await probeAttach();
  // A gated machine (CI, a dev laptop) must never spawn ANY VSN1 child — a
  // probe is still a child.
  assert.equal(calls.length, 0, 'no child of any kind on a gated engine');
  assert.equal(state, 'unknown', 'we did not look, which is not the same as absent');
});

// ── 3. Engine survival: the child misbehaves ────────────────────────────

test('SURVIVAL: a child exiting 1 with 6 KB of stderr settles cleanly', async () => {
  const calls = [];
  const bigStderr = `ERROR: ${'x'.repeat(6000)}`;
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('big-stderr'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 1, stderr: bigStderr })),
    probeFn: async () => 'attached',
  });
  await captureConsole(async () => {
    await hook(layoutEvt(1));
    await assert.rejects(flush(), /VSN1 layout deploy failed/, 'fails LOUD, not silently');
  });
  assert.equal(status.lastResult, 'error');
  assert.ok(status.lastError.length > 5000, 'the full stderr is preserved for diagnosis');
  assert.deepEqual(status.pendingPages, [0], 'the failed page stays queued for retry');
  assert.equal(status.deploying, false, 'the busy-guard reset');
  await settle();
  assert.deepEqual(unhandled, [], 'no unhandled rejection');

  // The hook must still WORK after a failure — a wedged busy-guard would make
  // every later deploy a silent no-op.
  await captureConsole(async () => {
    await hook(layoutEvt(2));
    await assert.rejects(flush(), /VSN1 layout deploy failed/);
  });
  assert.equal(deployCalls(calls).length, 2, 'the hook is still usable after a failure');
});

test('SURVIVAL: a child that emits an ERROR event does not wedge the busy-guard', async () => {
  const calls = [];
  let mode = 'error';
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('child-error'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, (args) => (
      args.includes('--page') && mode === 'error'
        ? { emitError: new Error('spawn ENOENT') }
        : { code: 0 }
    )),
    probeFn: async () => 'attached',
  });
  await captureConsole(async () => {
    await hook(layoutEvt(1));
    await assert.rejects(flush(), /spawn ENOENT/);
  });
  // The 2026-07-10 stuck-state bug: a runCli REJECTION escaped before the flag
  // reset, wedging `flushing` at true forever so every later deploy no-opped on
  // the busy-guard. The try/finally must hold under an 'error' event too.
  assert.equal(status.deploying, false, 'busy-guard reset after a spawn error');
  await settle();
  assert.deepEqual(unhandled, []);

  mode = 'ok';
  await captureConsole(async () => { await hook(layoutEvt(2)); await flush(); });
  assert.equal(status.lastResult, 'ok', 'the hook recovers completely');
});

test('SURVIVAL: a child HARD-ABORT exit (0xC0000409) mid-drain is survived', async () => {
  const calls = [];
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('hard-abort'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({
      code: WINDOWS_ABORT_EXIT,
      stderr: 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94',
    })),
    probeFn: async () => 'attached',
  });
  const lines = await captureConsole(async () => {
    await hook(layoutEvt(1));
    await assert.rejects(flush(), /VSN1 layout deploy failed/);
  });
  // The engine's contract: whatever the child does to ITSELF, the engine keeps
  // running with correct state. The abort code must be surfaced, not swallowed.
  assert.equal(status.lastResult, 'error');
  assert.match(status.lastError, /UV_HANDLE_CLOSING/, 'the abort detail reaches the operator');
  assert.equal(status.deploying, false);
  assert.deepEqual(status.pendingPages, [0], 'the page survives for a retry');
  assert.ok(lines.some((l) => l.includes('deploy FAILED')), 'the failure is logged loudly');
  await settle();
  assert.deepEqual(unhandled, [], 'a child abort must not take the engine with it');
});

test('SURVIVAL: a synchronous spawn throw is reported, not swallowed', async () => {
  const calls = [];
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: mkDir('spawn-throw'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, (args) => (
      args.includes('--page') ? { throwSync: new Error('EMFILE: too many open files') } : { code: 0 }
    )),
    probeFn: async () => 'attached',
  });
  await captureConsole(async () => {
    await hook(layoutEvt(1));
    await assert.rejects(flush(), /EMFILE/);
  });
  assert.equal(status.deploying, false);
  await settle();
  assert.deepEqual(unhandled, []);
});

// ── 4. Teardown hygiene (fix plan step 10) ──────────────────────────────

test('dispose() cancels the debounce timer so no deploy fires after shutdown', async () => {
  const calls = [];
  const timer = mkFakeTimer();
  const { hook, dispose } = createLayoutDeployHook({
    stateDir: mkDir('dispose-timer'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn(calls, () => ({ code: 0 })),
    probeFn: async () => 'attached',
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });
  await hook(layoutEvt(1));
  assert.ok(timer.armed(), 'a deploy is pending');
  dispose();
  assert.equal(timer.armed(), false, 'the pending timer is cancelled at shutdown');
  timer.fire(); // a no-op now
  await settle();
  assert.equal(calls.length, 0, 'nothing spawns after dispose');
});

test('dispose() kills an in-flight deploy child (fewer live handles at exit)', async () => {
  const calls = [];
  // A child that never closes — the worst case for teardown: the engine is
  // holding its stdout/stderr pipes while the process tries to exit. Live
  // handles at teardown are the surface the libuv abort lives on.
  const hangingSpawn = (cmd, args) => {
    const entry = { cmd, args, killed: false, unrefed: false };
    calls.push(entry);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: () => {},
      kill: () => { entry.killed = true; },
      unref: () => { entry.unrefed = true; },
    };
  };
  const { hook, flush, dispose } = createLayoutDeployHook({
    stateDir: mkDir('dispose-child'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: hangingSpawn,
    probeFn: async () => 'attached',
  });
  await hook(layoutEvt(1));
  flush().catch(() => { /* never settles; we are testing teardown */ });
  await settle();
  assert.equal(deployCalls(calls).length, 1, 'a child is in flight');
  dispose();
  assert.equal(deployCalls(calls)[0].killed, true, 'the in-flight child is killed at shutdown');
  assert.equal(deployCalls(calls)[0].unrefed, true, 'and unref-ed so it cannot hold the loop open');
});

test('dispose() is idempotent and safe with nothing in flight', () => {
  const { dispose } = createLayoutDeployHook({
    stateDir: mkDir('dispose-idem'),
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkSpawn([], () => ({ code: 0 })),
    probeFn: async () => 'attached',
  });
  dispose();
  dispose(); // shutdown paths can fire twice; this must never throw
});
