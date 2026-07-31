/**
 * patch_manager_notify_ordering.test.js — slice S4 (report 20260725_58 §6,
 * §7.2-7.3, §8/S4): the bridge notify must be CHAINED on the save, and every
 * failure of that chain must be LOUD.
 *
 * Why this matters: the sACN bridge rebuilds its relay routes by re-reading
 * `patches.yaml` FROM DISK when it receives `setScene`. The old
 * `saveAndNotify` armed a debounced save (2 s) and notified on a 500 ms timer,
 * so the bridge re-read the file BEFORE the save wrote it — a stale feed that
 * reported success on every surface. That is the failure mode behind the
 * operator's dark-LED day (report _58 §2).
 *
 * These tests pin, with no DOM and no network:
 *   1. the notify fires strictly AFTER the save resolves ok (and never on a timer);
 *   2. a failed save means NO notify at all — plus a loud surface;
 *   3. a failed notify is loud (toast + monitor line + console.error);
 *   4. the auto-subscribe path arms the debounce ONLY: no forced save, no notify.
 *
 * patch_manager.js is a browser module (touches `window`, starts a poll), so
 * the globals it reads are stubbed before importing it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

const { params } = await import('../src/core/state.js');
const PatchManager = (await import('../src/dmx/patch_manager.js')).default;

const { saveAndNotify, notifySacnBridgeLoud, autoSubscribePatchUniverses } = PatchManager;

/**
 * Fresh window + captured surfaces for one test. `events` records the ORDER of
 * everything the module does, which is the whole point of the slice.
 */
function harness({ exportConfig, wsOpen = true } = {}) {
  const events = [];
  const toasts = [];
  const monitorLines = [];
  const consoleErrors = [];

  globalThis.window = {
    __activeScene: 'titanic',
    _patchesActive: false,
    sacnInput: {
      _ws: {
        readyState: wsOpen ? 1 : 3,
        send: (payload) => events.push(`ws:${JSON.parse(payload).type}`),
      },
    },
    showSaveToast: (message, isError) => { toasts.push({ message, isError }); },
    sacnLog: (message, type) => { monitorLines.push({ message, type }); },
  };
  if (exportConfig) {
    globalThis.window.exportConfig = async (...args) => {
      events.push('save:start');
      const result = await exportConfig(...args);
      events.push('save:end');
      return result;
    };
  }

  const realError = console.error;
  console.error = (...args) => { consoleErrors.push(args.join(' ')); };
  const restore = () => { console.error = realError; };

  return { events, toasts, monitorLines, consoleErrors, restore };
}

/** A save that only resolves after several microtask+macrotask turns. */
async function slowOk() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { ok: true };
}

test('saveAndNotify notifies the bridge ONLY after the save resolves ok', async () => {
  const h = harness({ exportConfig: slowOk });
  try {
    const result = await saveAndNotify();

    assert.deepEqual(h.events, ['save:start', 'save:end', 'ws:setScene'],
      'the setScene must land AFTER the save resolves — never on a timer racing it');
    assert.equal(result.save.ok, true);
    assert.equal(result.notify.ok, true);
    assert.equal(result.notify.scene, 'titanic');
    assert.equal(h.toasts.length, 0, 'a clean save+notify says nothing loud');
    assert.equal(h.monitorLines.length, 0);
  } finally { h.restore(); }
});

test('saveAndNotify sends exactly one setScene (no 500 ms timer left behind)', async () => {
  const h = harness({ exportConfig: async () => ({ ok: true }) });
  try {
    await saveAndNotify();
    // The old implementation notified from a setTimeout; if any such timer
    // survived, it would fire during this wait and double the count.
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(h.events.filter((e) => e === 'ws:setScene'), ['ws:setScene'],
      'exactly one notify per saveAndNotify — no stray timer');
  } finally { h.restore(); }
});

test('a FAILED save means no notify at all, and it is loud', async () => {
  const h = harness({
    exportConfig: async () => ({ ok: false, reason: 'save server responded 500' }),
  });
  try {
    const result = await saveAndNotify();

    assert.ok(!h.events.includes('ws:setScene'),
      'notifying after a failed save would only make the bridge re-read the STALE file');
    assert.equal(result.save.ok, false);
    assert.equal(result.notify, null, 'notify is null — it was never attempted');

    assert.equal(h.toasts.length, 1, 'the failure must reach the toast');
    assert.equal(h.toasts[0].isError, true);
    assert.match(h.toasts[0].message, /scene NOT saved/);
    assert.match(h.toasts[0].message, /save server responded 500/,
      'the verbatim reason travels all the way to the operator');
    assert.equal(h.monitorLines.length, 1, 'and the sACN monitor activity log');
    assert.equal(h.monitorLines[0].type, 'error');
    assert.equal(h.consoleErrors.length, 1, 'and the console — the surface that always exists');
  } finally { h.restore(); }
});

test('a save that resolves with no {ok} is a REFUSAL, not an assumed success', async () => {
  const h = harness({ exportConfig: async () => undefined });
  try {
    const result = await saveAndNotify();
    assert.equal(result.save.ok, false);
    assert.equal(result.notify, null);
    assert.ok(!h.events.includes('ws:setScene'));
    assert.match(h.toasts[0].message, /the scene save reported no result/);
  } finally { h.restore(); }
});

test('a THROWING save is captured verbatim and never rejects saveAndNotify', async () => {
  const h = harness({
    exportConfig: async () => { throw new Error('duplicate fixture name: TE Sign V3'); },
  });
  try {
    const result = await saveAndNotify();
    assert.equal(result.save.ok, false);
    assert.match(result.save.reason, /the scene save threw: duplicate fixture name: TE Sign V3/);
    assert.equal(result.notify, null);
    assert.match(h.toasts[0].message, /TE Sign V3/);
  } finally { h.restore(); }
});

test('saveAndNotify refuses loudly when window.exportConfig is not installed', async () => {
  const h = harness({});
  try {
    const result = await saveAndNotify();
    assert.equal(result.save.ok, false);
    assert.match(result.save.reason, /window\.exportConfig is not installed/);
    assert.equal(result.notify, null);
    assert.ok(!h.events.includes('ws:setScene'));
    assert.equal(h.toasts.length, 1);
    assert.equal(h.monitorLines.length, 1);
  } finally { h.restore(); }
});

test('a saved scene whose NOTIFY fails is loud — disk fresh, feed stale', async () => {
  const h = harness({ exportConfig: async () => ({ ok: true }), wsOpen: false });
  try {
    const result = await saveAndNotify();

    assert.equal(result.save.ok, true, 'the save DID land — that half must not be misreported');
    assert.equal(result.notify.ok, false);
    assert.match(result.notify.reason, /WebSocket not connected/);

    assert.equal(h.toasts.length, 1);
    assert.equal(h.toasts[0].isError, true);
    assert.match(h.toasts[0].message, /sACN bridge NOT notified/);
    assert.match(h.toasts[0].message, /hardware will NOT follow this change/);
    assert.match(h.toasts[0].message, /reconnects/,
      'the copy must name the self-heal so the operator knows what to wait for');
    assert.equal(h.monitorLines.length, 1);
    assert.equal(h.monitorLines[0].type, 'error');
    assert.equal(h.consoleErrors.length, 1);
  } finally { h.restore(); }
});

test('notifySacnBridgeLoud is silent on success and loud on failure', async () => {
  const ok = harness({});
  try {
    const result = await notifySacnBridgeLoud();
    assert.equal(result.ok, true);
    assert.deepEqual(ok.events, ['ws:setScene']);
    assert.equal(ok.toasts.length, 0);
  } finally { ok.restore(); }

  const bad = harness({ wsOpen: false });
  try {
    const result = await notifySacnBridgeLoud();
    assert.equal(result.ok, false);
    assert.equal(bad.toasts.length, 1);
    assert.equal(bad.monitorLines.length, 1);
    assert.equal(bad.consoleErrors.length, 1);
  } finally { bad.restore(); }
});

test('the quiet notifySacnBridge stays quiet — the push renders its own failure', async () => {
  const h = harness({ wsOpen: false });
  try {
    const result = await PatchManager.notifySacnBridge();
    assert.equal(result.ok, false);
    assert.equal(h.toasts.length, 0,
      'the LED push dialog reports this step itself; a second toast would just repeat it');
    assert.equal(h.monitorLines.length, 0);
  } finally { h.restore(); }
});

test('auto-subscribe arms the debounce ONLY — no forced save, no notify', async () => {
  const h = harness({ exportConfig: async () => ({ ok: true }) });
  const debounceCalls = [];
  globalThis.window.debounceAutoSave = (force) => { debounceCalls.push(force); };
  globalThis.window._guiControllers = {};
  try {
    params.sacn_universes = '1, 2';
    params.parLights = [{ name: 'Generator 1', dmxUniverse: 2, dmxAddress: 1 }];
    params.ledStrands = [{ name: 'Left_Front_Left', dmxUniverse: 27, dmxAddress: 1 }];

    const added = autoSubscribePatchUniverses(params.parLights);
    assert.deepEqual(added, [27], 'the merge itself is unchanged');

    // Auto-subscribe is an incidental side effect of a patch recompute. The
    // operator runs with autoSave off so nothing writes the scene behind his
    // back — forcing exportConfig() here would be a surprise disk write.
    assert.deepEqual(debounceCalls, [undefined], 'the shared debounced save is armed, unforced');
    assert.ok(!h.events.includes('save:start'), 'no forced save from an incidental merge');
    // And no notify: the bridge reads patches.yaml from DISK, so telling it to
    // reload before anything was written only re-reads the old file.
    assert.ok(!h.events.includes('ws:setScene'), 'no notify without a write');

    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.ok(!h.events.includes('ws:setScene'), 'and none arrives on a stray timer either');
  } finally { h.restore(); }
});
