/**
 * sacn_bridge_engine_poll.test.js — the input bridge's engine-poll state
 * machine (catalog 20260805_161 gap G4, rank 3): `pollEngineStatus`
 * (`server/sacn_bridge.js:986-1034`), the mechanism behind "hardware follows
 * the ENGINE's active scene".
 *
 * `pollEngineStatus` is NOT exported (this file has no `module.exports` at
 * all) and is invoked only at boot and from its own `setInterval(...,
 * ENGINE_POLL_MS)` (3000 ms, unref'd) — there is no way to call it directly
 * from a test. This file therefore drives it the same way
 * `bench_mirror_arm.test.js` already does for its two engine-poll-driven
 * auto-disarm cases: swap the harness's `fetch` stub / `engineStatus`, then
 * really wait (in wall-clock time) for the next natural tick to pick it up.
 * That is slower than a direct call would be, but it is the ACTUAL contract
 * under test — the poll interval is real, not mocked, in production.
 *
 * Every transition assertion below is a BEFORE/AFTER count on its log
 * pattern, never a bare "count >= 1" — the boot-time poll (before any test
 * runs) already fires one real "Engine up" transition on its own, so a bare
 * threshold would pass on stale history instead of the NEW transition.
 *
 * Tests are ORDER-DEPENDENT: `engineState` is one bridge-global variable for
 * the whole process, so each test's ending state is the next test's starting
 * condition — the same idiom the arm suite and the G1 arbitration file use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, request } = H;
const observer = connect(); // defaults to scene 'titanic' == the CLI pin

const matchingLogs = (re) => observer.json('log').filter((m) => re.test(m.msg));
let _reqN = 0;
async function routesNow() {
  _reqN += 1;
  return request(observer, { type: 'getRoutes' }, `g4-routes-${_reqN}`, 'routes');
}
/** Real-wall-clock wait for the count of logs matching `re` to pass `atLeast`. */
async function waitForLogCount(re, atLeast, ms, what) {
  await H.waitMs(() => matchingLogs(re).length >= atLeast, what || `log matching ${re}`, ms);
}
/** Change engine status/fetch, then wait for exactly one NEW matching log. */
async function expectOneNewLog(re, mutate, ms, what) {
  const before = matchingLogs(re).length;
  mutate();
  await waitForLogCount(re, before + 1, ms, what);
  assert.equal(matchingLogs(re).length, before + 1, `exactly one new log for: ${what}`);
}

test('G4 baseline: boot polled once already, reachable, scene == the CLI pin', async () => {
  const reply = await routesNow();
  assert.deepEqual(reply.activeScenes, ['titanic']);
});

test('G4: a REJECTING fetch makes the engine unreachable — logged once, never throws', async () => {
  await expectOneNewLog(/Engine unreachable/,
    () => H.setFetchImpl(async () => { throw new Error('ECONNREFUSED (simulated, no real socket)'); }),
    4500, 'reachable→unreachable (rejecting fetch)');
  const reply = await routesNow();
  assert.deepEqual(reply.activeScenes, ['titanic'],
    'an unreachable engine contributes no engine-scene route');
});

test('G4: reachable again with a NEW engine scene — one "Engine up" log, its routes join', async () => {
  await expectOneNewLog(/Engine up/, () => {
    H.resetFetchImpl();
    H.setEngineStatus({ service: 'marsin-engine', activeScene: 'studio', outputRouting: { controllers: [] } });
  }, 4500, 'unreachable→reachable, scene studio');
  const reply = await routesNow();
  assert.ok(reply.activeScenes.includes('studio'), 'the engine scene joins the active-scenes union');
  assert.ok(reply.activeScenes.includes('titanic'), 'the CLI-pinned scene is never displaced');
});

test('G4: an engine scene CHANGE (reachability unchanged) — one "scene changed" log, routes swap',
  async () => {
    // The bridge's own console line reads "Engine active scene changed";
    // the WS broadcast the browser (and this test) actually sees is the
    // shorter "Engine scene → '<name>'" — the two texts differ by design
    // (the operator terminal gets the verbose form, the HUD gets the terse
    // one), so the assertion matches the BROADCAST text, not the console one.
    await expectOneNewLog(/Engine scene → /,
      () => H.setEngineStatus({ ...H.getEngineStatus(), activeScene: 'test_bench' }),
      4500, 'scene change studio→test_bench');
    const reply = await routesNow();
    assert.ok(reply.activeScenes.includes('test_bench'));
    assert.ok(!reply.activeScenes.includes('studio'), 'the OLD engine scene leaves the union');
  });

test('G4: two consecutive IDENTICAL polls produce no duplicate transition log', async () => {
  const before = matchingLogs(/Engine scene → |Engine up|Engine unreachable/).length;
  // Two full real poll cycles with the stub left completely unchanged.
  await new Promise((resolve) => setTimeout(resolve, 3000 * 2 + 600));
  const after = matchingLogs(/Engine scene → |Engine up|Engine unreachable/).length;
  assert.equal(after, before, 'an identical status must never re-fire a transition log');
});

test('G4: activeScene "unknown" resolves to NO scene — never a literal scene named "unknown"',
  async () => {
    await expectOneNewLog(/Engine scene → 'null'/,
      () => H.setEngineStatus({ ...H.getEngineStatus(), activeScene: 'unknown' }),
      4500, 'scene test_bench→null via "unknown"');
    const reply = await routesNow();
    assert.ok(!reply.activeScenes.includes('unknown'));
    assert.ok(!reply.activeScenes.includes('test_bench'), 'the previous engine scene must be gone');
  });

test('G4: a 200 OK from the wrong `service` is treated as UNREACHABLE, not parsed as the engine',
  async () => {
    await expectOneNewLog(/Engine unreachable/,
      () => H.setEngineStatus({ service: 'some-other-daemon', activeScene: 'titanic' }),
      4500, 'reachable→unreachable via wrong service field');
  });

test('G4: a non-OK HTTP response is ALSO unreachable, never a crash', async () => {
  // First re-establish reachable so the ok:false stub below produces an
  // observable NEW transition rather than a no-op (already unreachable).
  await expectOneNewLog(/Engine up/, () => {
    H.resetFetchImpl();
    H.setEngineStatus({ service: 'marsin-engine', activeScene: 'titanic', outputRouting: { controllers: [] } });
  }, 4500, 'reachable re-established before the ok:false probe');

  await expectOneNewLog(/Engine unreachable/,
    () => H.setFetchImpl(async () => ({ ok: false, json: async () => ({}) })),
    4500, 'ok:false → unreachable');
});

test('G4: `outputRouting` absent warns ONCE (dual-source suppression unavailable); present-empty does not',
  async () => {
    // Both the "Engine up" broadcast and the "too old" broadcast fire from
    // the SAME poll pass here (two independent `if`s in `pollEngineStatus`),
    // so both baselines must be taken BEFORE the mutation — taking the
    // second baseline only after awaiting the first log would already be
    // past the poll that produced both, undercounting by exactly one.
    const staleBefore = matchingLogs(/too old for dual-source suppression/).length;
    await expectOneNewLog(/Engine up/, () => {
      H.resetFetchImpl();
      // No `outputRouting` key at all — an older engine build.
      H.setEngineStatus({ service: 'marsin-engine', activeScene: 'titanic' });
    }, 4500, 'reachable transition with outputRouting absent');
    assert.equal(matchingLogs(/too old for dual-source suppression/).length, staleBefore + 1,
      'the ownedUnavailable warn must land in the SAME poll pass as the reachable transition');
    const staleAfterFirst = matchingLogs(/too old for dual-source suppression/).length;

    // Now present-but-empty: ownedUnavailable must clear, and clearing must
    // NOT itself produce a second "too old" warning (only the RISING edge warns).
    H.setEngineStatus({ ...H.getEngineStatus(), outputRouting: { controllers: [] } });
    // No log names this transition, so there's nothing to wait FOR — wait long
    // enough for the next poll to have definitely run, then assert silence.
    await new Promise((resolve) => setTimeout(resolve, 3000 + 600));
    assert.equal(matchingLogs(/too old for dual-source suppression/).length, staleAfterFirst,
      'outputRouting becoming present-and-empty must not warn again');
  });

test('G4: poll re-entrancy — a slow /status never stacks a second concurrent fetch', async () => {
  let fetchCalls = 0;
  H.setFetchImpl(() => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      setTimeout(() => resolve({
        ok: true,
        json: async () => ({
          service: 'marsin-engine', activeScene: 'titanic',
          outputRouting: { controllers: [{ name: 'reentrancy-marker', host: '10.9.9.250', universes: [] }] },
        }),
      }), 7000); // longer than TWO natural 3000 ms poll intervals
    });
  });
  // Wait past the point where at least one extra natural tick would have
  // fired while the first call is still pending, AND past the first call's
  // own resolution — `_enginePollBusy` must have kept `fetchCalls` at 1 the
  // entire time, because a second real fetch mid-flight would double the
  // in-flight AbortControllers and could resolve out of order.
  await new Promise((resolve) => setTimeout(resolve, 8000));
  assert.equal(fetchCalls, 1,
    'a poll already in flight must make every re-entrant interval tick a no-op, never a second fetch');
});

test('G4 teardown: restore the real module loader', () => {
  H.restoreModuleLoad();
});
