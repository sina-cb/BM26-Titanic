// Unit tests for AutopilotPool — the per-channel autopilot scheduler
// pool introduced in docs/19 Phase 2.3.
//
// Run:  node --test tests/autopilot_pool.test.js
//
// The pool is parameterized by, per channel: a `readState` callback
// (returns {active, delay_s, shuffle}) and an `advance` callback. That
// seam lets us drive everything with fake channels + tiny real delays —
// no engine, no WASM, no disk. We use short delay_s values (fractional
// seconds via the parseInt(delay_s) * 1000 math) so the suite stays fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AutopilotPool } from '../lib/autopilot.js';

// delay_s is multiplied by 1000 internally. A real interval of N ms is
// expressed as delay_s = N/1000 — parseInt() of '0.03' is 0, so we pass
// the NUMERIC fraction and rely on the (parseInt(...) || 30) fallback?
// No — parseInt('0.03') === 0 which would fall back to 30. To get small
// real timers we instead pass delay_s as a STRING of whole ms-as-seconds
// won't work either. The pool does parseInt(delay_s,10) * 1000, so the
// smallest non-fallback delay is 1 (=> 1000 ms). For a fast hermetic
// test we therefore stub global.setTimeout-free by using delay_s that the
// pool reads, but advance the clock manually is not exposed. Instead we
// keep the loop honest by using delay_s values >= 1 and a fake timer.
//
// node:test ships no fake-timer of its own, so we install a minimal
// manual clock by monkey-patching setTimeout/clearTimeout for the
// duration of each test. This keeps the tests deterministic AND instant.

function withFakeClock(fn) {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let nextId = 1;
  let nowMs = 0;
  const timers = new Map(); // id -> { fireAt, cb }

  global.setTimeout = (cb, ms) => {
    const id = nextId++;
    timers.set(id, { fireAt: nowMs + (ms || 0), cb });
    return id;
  };
  global.clearTimeout = (id) => {
    timers.delete(id);
  };

  // Advance the fake clock by `ms`, firing any timers due in that window
  // in chronological order. Timers scheduled DURING a callback are
  // honoured (self-rescheduling loops depend on this).
  const advance = async (ms) => {
    const target = nowMs + ms;
    // Loop because callbacks can schedule new timers.
    while (true) {
      let soonest = null;
      for (const [id, t] of timers) {
        if (t.fireAt <= target && (soonest === null || t.fireAt < soonest.fireAt)) {
          soonest = { id, ...t };
        }
      }
      if (!soonest) break;
      nowMs = soonest.fireAt;
      timers.delete(soonest.id);
      const ret = soonest.cb();
      // Await async advance() callbacks so a re-schedule inside them is
      // visible before we look for the next timer.
      if (ret && typeof ret.then === 'function') await ret;
    }
    nowMs = target;
  };

  return Promise.resolve(fn({ advance }))
    .finally(() => {
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
    });
}

// A fake channel: holds its own autopilot block + an advance counter.
function makeChannel(id, autopilot) {
  return {
    id,
    advances: 0,
    playlist: { name: 'pl', activeEntryId: 'e1', cursor: 0, autopilot },
  };
}

test('deck autopilot advances via its advance callback when active (back-compat)', async () => {
  await withFakeClock(async ({ advance }) => {
    const deck = makeChannel('ch_base', { active: true, delay_s: 1, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(
      deck.id,
      () => deck.playlist.autopilot,
      () => { deck.advances++; },
    );
    assert.equal(deck.advances, 0);
    await advance(1000); // one delay_s period
    assert.equal(deck.advances, 1);
    await advance(3000); // three more periods
    assert.equal(deck.advances, 4);
  });
});

test('a mixer channel advances its OWN entry independently, without touching the deck', async () => {
  await withFakeClock(async ({ advance }) => {
    const deck = makeChannel('ch_base', { active: false, delay_s: 1, shuffle: false });
    const mix = makeChannel('ch_mix', { active: true, delay_s: 1, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(deck.id, () => deck.playlist.autopilot, () => { deck.advances++; });
    pool.arm(mix.id, () => mix.playlist.autopilot, () => { mix.advances++; });

    await advance(3000);
    assert.equal(mix.advances, 3, 'mixer channel cycled on its own timer');
    assert.equal(deck.advances, 0, 'inactive deck never advanced');
  });
});

test('disabling a channel autopilot clears its timer (no further advance)', async () => {
  await withFakeClock(async ({ advance }) => {
    const mix = makeChannel('ch_mix', { active: true, delay_s: 1, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(mix.id, () => mix.playlist.autopilot, () => { mix.advances++; });

    await advance(2000);
    assert.equal(mix.advances, 2);

    // Operator disables autopilot for this channel, then re-arms.
    mix.playlist.autopilot.active = false;
    pool.rearm(mix.id);

    await advance(5000);
    assert.equal(mix.advances, 2, 'no advances after disarm');
  });
});

test('two mixer channels cycle independently on different delays', async () => {
  await withFakeClock(async ({ advance }) => {
    const fast = makeChannel('ch_fast', { active: true, delay_s: 1, shuffle: false });
    const slow = makeChannel('ch_slow', { active: true, delay_s: 2, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(fast.id, () => fast.playlist.autopilot, () => { fast.advances++; });
    pool.arm(slow.id, () => slow.playlist.autopilot, () => { slow.advances++; });

    await advance(6000);
    assert.equal(fast.advances, 6, 'fast channel: 6 ticks over 6s @1s');
    assert.equal(slow.advances, 3, 'slow channel: 3 ticks over 6s @2s');
  });
});

test('removing a channel drops its loop (timer stops firing)', async () => {
  await withFakeClock(async ({ advance }) => {
    const mix = makeChannel('ch_mix', { active: true, delay_s: 1, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(mix.id, () => mix.playlist.autopilot, () => { mix.advances++; });

    await advance(2000);
    assert.equal(mix.advances, 2);

    pool.drop(mix.id);
    assert.equal(pool.has(mix.id), false);

    await advance(5000);
    assert.equal(mix.advances, 2, 'dropped channel never advances again');
  });
});

test('re-arm with a new delay restarts the countdown from a clean baseline', async () => {
  await withFakeClock(async ({ advance }) => {
    const mix = makeChannel('ch_mix', { active: true, delay_s: 2, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(mix.id, () => mix.playlist.autopilot, () => { mix.advances++; });

    // 1s into a 2s wait, operator shortens the delay to 1s and re-arms.
    await advance(1000);
    assert.equal(mix.advances, 0);
    mix.playlist.autopilot.delay_s = 1;
    pool.rearm(mix.id);

    // The original 2s timer must NOT fire; the new 1s timer governs.
    await advance(1000);
    assert.equal(mix.advances, 1, 'one tick on the new 1s cadence');
    await advance(2000);
    assert.equal(mix.advances, 3);
  });
});

test('an active channel with no playlist does nothing and is not an error', async () => {
  await withFakeClock(async ({ advance }) => {
    // advance() short-circuits when there is no playlist — model that as a
    // no-op advance callback. The loop must still run without throwing.
    const ch = { id: 'ch_x', advances: 0, playlist: { autopilot: { active: true, delay_s: 1, shuffle: false } } };
    const pool = new AutopilotPool();
    pool.arm(
      ch.id,
      () => ch.playlist.autopilot,
      () => { /* no usable playlist → advance does nothing */ },
    );
    await advance(3000); // must not throw
    assert.equal(ch.advances, 0);
  });
});

test('rearm on an unregistered channel is a loud no-op, not a crash', async () => {
  await withFakeClock(async () => {
    const pool = new AutopilotPool();
    // Should warn + return, never throw.
    assert.doesNotThrow(() => pool.rearm('nope'));
  });
});

test('clearAll stops every loop', async () => {
  await withFakeClock(async ({ advance }) => {
    const a = makeChannel('a', { active: true, delay_s: 1, shuffle: false });
    const b = makeChannel('b', { active: true, delay_s: 1, shuffle: false });
    const pool = new AutopilotPool();
    pool.arm(a.id, () => a.playlist.autopilot, () => { a.advances++; });
    pool.arm(b.id, () => b.playlist.autopilot, () => { b.advances++; });

    await advance(1000);
    assert.equal(a.advances, 1);
    assert.equal(b.advances, 1);

    pool.clearAll();
    await advance(5000);
    assert.equal(a.advances, 1, 'a stopped after clearAll');
    assert.equal(b.advances, 1, 'b stopped after clearAll');
  });
});
