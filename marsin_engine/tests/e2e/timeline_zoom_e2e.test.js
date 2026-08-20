/*
 * timeline_zoom_e2e.test.js — SLICE S5: the end-to-end scenario suite that
 * closes the timeline-zoom wave (design `_94`, engine `_95`, pad `_97`,
 * bugfixes `_98`; this report `_100`).
 *
 * Every scenario here drives a REAL `engine.js` subprocess over REAL HTTP and
 * REAL `/ws/control` WebSockets. `tests/timeline/*` already pins the
 * TimelineService's LOGIC in-process; what only an e2e can prove is the WIRING:
 * that the routes carry the state, that the broadcast reaches a second client,
 * that a zoom really is runtime-only across a process boundary, and that the
 * exit table's rows hold when the exit is a kill -9 rather than a method call.
 *
 * Named after `_94`'s exit table and `_97` §7's "what S5 should cover" list —
 * including the two paths `_97` never exercised live: ENGINE RESTART MID-ZOOM
 * and PLAN SAVE MID-ZOOM.
 *
 * SAFETY: see the harness header. sACN is black-holed at the CONFIG (not by
 * `--dest`, which does not cover the `controllers:` block — the `_97` §4.4 trap)
 * and every boot ASSERTS it; state, playlists and the show-plan library are all
 * redirected into temp dirs; ports are far from the operator's 6967-6972 band.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

// MANDATORY for any suite that spawns an engine (`_95` §4.3): without it the
// spawned engine persists deck autopilot state into the tracked
// marsin_engine/config.yaml. Idempotent, and the harness additionally hands
// every child its OWN black-holed config path.
import '../helpers/setup_config_guard.mjs';

import {
  createTimelineE2E, buildE2EPlan, buildDormantPlan, clockAt, dateAt,
  sleep, until, startMoodPublisher, assertMoodKeyRegistered,
  REPO_DIR, BLACKHOLE_HOST,
} from './timeline_e2e_harness.mjs';

const TODAY = () => dateAt(Date.now());

/** Spin a harness, run `fn`, always tear the engine down. */
async function withEngine(opts, fn) {
  const h = createTimelineE2E(opts);
  try {
    await h.start();
    return await fn(h);
  } finally {
    await h.teardown();
  }
}

/** The standard in-window rig: one live ambient cue, one program due later. */
function inWindowRig(prefix, { showInMin = 240, timelinePatch = {} } = {}) {
  return {
    prefix,
    plans: { zoom_e2e: buildE2EPlan(Date.now(), { showInMin }) },
    activePlan: 'zoom_e2e',
    timelinePatch,
  };
}

/**
 * Sleep until we are ~`leadSec` before the next wall-clock minute, then return
 * `Date.now()`. A `clock` cue at `+1 min` from that instant therefore fires in
 * about `leadSec` seconds — which is how a scenario watches a REAL trigger fire
 * without waiting a real minute.
 */
async function alignToMinute(leadSec = 12) {
  const secs = new Date().getSeconds();
  await sleep((((60 - leadSec - secs) + 60) % 60) * 1000);
  return Date.now();
}

// ══════════════════════════════════════════════════════════════════════════
// GROUP 0 — the safety walls themselves
// ══════════════════════════════════════════════════════════════════════════

test('E0 · the engine this suite spawns cannot reach the rig (the `_97` --dest trap)', async () => {
  await withEngine(inWindowRig('bm26-e2e-safety'), async (h) => {
    // assertBlackHoled() already ran inside start(); re-assert explicitly so the
    // guarantee is a NAMED scenario and not a side effect of the harness.
    const status = await (await fetch(h.base() + '/status')).json();
    await h.assertBlackHoled(status);

    // The config the engine actually booted from. A declared `controllers:`
    // block used to carry its own host and win for the universes it claimed,
    // making `--dest` decoration (the `_97` §4.4 trap). That mechanism is
    // REMOVED: the key must be ABSENT — its mere presence is a boot refusal
    // (marsin_engine/lib/output_config_guard.js) — and the black hole in
    // `sacn.destinations` is then the whole wall.
    const cfg = fs.readFileSync(h.configFile, 'utf8');
    assert.doesNotMatch(cfg, /^controllers:/m,
      'the removed direct-to-hardware key must not appear in a spawned engine config');
    assert.ok(cfg.includes(BLACKHOLE_HOST), 'the black-hole destination is not in the config');

    // And the tracked scene tree is unreachable: the plan library is a temp dir.
    assert.ok(!h.timelineDir.includes(path.join('simulation', 'scenes')),
      `plan library resolved into the scene tree: ${h.timelineDir}`);
    assert.ok(fs.existsSync(path.join(h.timelineDir, 'zoom_e2e.yaml')));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP 1 — the zoom ladder
// ══════════════════════════════════════════════════════════════════════════

test('E1 · PERFORM on the ACTIVE cue: scoped lease, plan held, D3 deferral, fire-on-exit', async () => {
  // programLeaseSec 3 s: a PLAIN takeover would let the show seize control 3 s
  // after it comes due (arbiter I2). The whole point of D3 is that a zoom does
  // not, so the scenario deliberately waits well past it.
  await withEngine({
    ...inWindowRig('bm26-e2e-perform', { showInMin: 240, timelinePatch: { programLeaseSec: 3 } }),
  }, async (h) => {
    const pad = await h.client('A');
    const before = await h.state();
    assert.equal(before.activeCue.id, 'c_live', 'the fixture must boot with c_live owning the deck');
    assert.equal(before.zoom, null);

    // Re-point c_show at the next wall-clock minute so it really comes due
    // mid-zoom. Saving over the ACTIVE plan hot-reloads it (this is also the
    // maker's auto-save path) — done BEFORE the zoom, since save is itself an
    // exit (scenario X4).
    const anchor = await alignToMinute(12);
    const save = await h.api('POST', '/timeline/plans', buildE2EPlan(anchor, { showInMin: 1 }));
    assert.equal(save.status, 200, JSON.stringify(save.data));

    // ── enter PERFORM ────────────────────────────────────────────────────
    const tk = await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' });
    assert.equal(tk.status, 200, JSON.stringify(tk.data));
    assert.equal(tk.data.zoom.scope, 'perform');
    assert.equal(tk.data.zoom.cueId, 'c_live');
    assert.equal(tk.data.zoom.label, 'Evening ramp');
    assert.ok(tk.data.operatorLease.expiresAtMs > Date.now());

    const zoomed = await h.state();
    assert.equal(zoomed.mode, 'overridden');
    assert.equal(zoomed.controller, 'manual');
    assert.equal(zoomed.zoom.scope, 'perform');
    // The scope reaches every client, not just the one that asked.
    await pad.waitFor(m => m.zoom && m.zoom.scope === 'perform', { what: 'the PERFORM zoom on the broadcast' });

    // Snapshot the deck once the takeover has SETTLED (two ticks). Entering any
    // takeover — plain or PERFORM — hands the deck to the human and the tick
    // stands the plan's baseline autopilot down; that transition is the
    // takeover's, not the zoom's (pinned by E1b, and reported in `_100` §5 as a
    // `_98` FIX 6 interaction). What must hold from here on is that the PLAN
    // moves nothing under the performer.
    await sleep(2200);
    const deckUnderZoom = await h.deck();

    // ── D3: the show comes due MID-ZOOM and is DEFERRED, not started ──────
    const deferred = await pad.waitFor(
      m => m.zoom && m.zoom.pendingDeferred && m.zoom.pendingDeferred.cueId === 'c_show',
      { timeoutMs: 30000, what: 'the deferred show on the broadcast' },
    );
    assert.equal(deferred.msg.zoom.pendingDeferred.label, 'Scheduled show');
    assert.ok(deferred.msg.zoom.pendingDeferred.dueAtLocal, 'the banner needs a due time');

    // Well past programLeaseSec: a PLAIN takeover would have been overrun by now.
    await sleep(6000);
    const held = await h.state();
    assert.equal(held.controller, 'manual', 'the show seized control during a PERFORM zoom (D3 broken)');
    assert.equal(held.mode, 'overridden');
    assert.equal(held.activeProgram, null, 'the deferred show started anyway');
    assert.ok(held.pendingProgram && held.pendingProgram.cueId === 'c_show',
      'the deferral DISMISSED the show instead of deferring it');
    assert.deepEqual(await h.deck(), deckUnderZoom, 'the plan moved the deck under the performer');

    // The event log says "deferred", never the misleading "auto-starts in Ns".
    const log = held.recentFires.filter(e => e.cueId === 'c_show');
    assert.ok(log.some(e => e.reason === 'lease-deferred'), `no lease-deferred entry: ${JSON.stringify(log)}`);
    assert.ok(!log.some(e => e.reason === 'lease-armed'), 'a zoom logged the plain-takeover lease-armed line');
    assert.ok(!log.some(e => e.reason === 'lease-expired'), 'the deferred show auto-started');

    // ── EXIT (exit-table row: POST /timeline/resume) ──────────────────────
    const rs = await h.api('POST', '/timeline/resume');
    assert.equal(rs.status, 200, JSON.stringify(rs.data));
    const after = await until(() => h.state(), s => s.zoom === null && s.mode === 'armed',
      { what: 'the zoom to clear on resume' });
    assert.equal(after.operatorLease, null);

    // DEFERRED, NEVER DISMISSED: catchUp fires it on the way out.
    const resumed = await until(() => h.state(), s => s.activeProgram !== null,
      { what: 'the deferred show to fire via catchUp' });
    assert.equal(resumed.activeProgram.cueId, 'c_show');
    assert.equal(resumed.controller, 'program');
    assert.equal((await h.deck()).name, 'burn_night', 'the show did not reach the deck on exit');
    assert.ok(resumed.recentFires.some(e => e.cueId === 'c_show' && e.reason === 'catchUp'),
      'the show was not fired by the exit catchUp');
  });
});

test('E1b · PERFORM changes the rig no more than a PLAIN takeover does', async () => {
  // `_95` §3.3's contract: the scope tag is the ONLY difference. Two engines,
  // identical fixtures, one bodyless takeover and one scoped — the deck they
  // leave behind must match.
  const rig = (p) => ({ ...inWindowRig(p), plans: { zoom_e2e: buildE2EPlan(Date.now()) } });
  const plain = await withEngine(rig('bm26-e2e-plain'), async (h) => {
    const r = await h.api('POST', '/timeline/takeover');
    assert.equal(r.status, 200);
    assert.equal(r.data.zoom, null, 'a bodyless takeover must not be a zoom');
    await sleep(2500);
    const s = await h.state();
    return { deck: await h.deck(), mode: s.mode, controller: s.controller };
  });
  const perform = await withEngine(rig('bm26-e2e-scoped'), async (h) => {
    const r = await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' });
    assert.equal(r.status, 200);
    assert.equal(r.data.zoom.scope, 'perform');
    await sleep(2500);
    const s = await h.state();
    return { deck: await h.deck(), mode: s.mode, controller: s.controller };
  });
  assert.deepEqual(perform, plain,
    'a PERFORM zoom left the rig in a different state than a plain takeover');
});

test('E2 · TIME TRAVEL on an inactive event: static snapshot, steppers, zero live bookkeeping', async () => {
  await withEngine(inWindowRig('bm26-e2e-travel'), async (h) => {
    const pad = await h.client('A');
    const before = await h.state();
    const firedBefore = before.recentFires.length;

    const tv = await h.api('POST', '/timeline/travel', { cueId: 'c_morning', date: TODAY() });
    assert.equal(tv.status, 200, JSON.stringify(tv.data));
    assert.equal(tv.data.zoom.scope, 'travel');
    assert.equal(tv.data.zoom.cueId, 'c_morning');
    assert.equal(tv.data.zoom.targetLocal, '04:00');
    assert.equal(tv.data.resolved.owner.cueId, 'c_morning');
    assert.ok(Array.isArray(tv.data.steps) && tv.data.steps.length > 0,
      'travel must report what it dispatched');

    // The SNAPSHOT really reached the rig, through the normal dispatch path.
    assert.equal((await h.deck()).name, 'slow', 'the traveled look never reached the deck');
    await pad.waitFor(m => m.zoom && m.zoom.scope === 'travel', { what: 'the travel zoom on the broadcast' });

    // …and the LIVE plan's bookkeeping is untouched: no program, no cue fires.
    const during = await h.state();
    assert.equal(during.activeProgram, null);
    assert.equal(during.controller, 'manual');
    const newFires = during.recentFires.slice(firedBefore).filter(e => e.kind === 'fire');
    assert.deepEqual(newFires, [], `travel wrote cue fires into the live log: ${JSON.stringify(newFires)}`);
    assert.ok(during.recentFires.some(e => e.reason === 'travel'),
      'travel must leave a lifecycle entry so the night is auditable');

    // STATIC in plan-time (D4): the target does not drift with the wall clock.
    const t0 = during.zoom.targetMs;
    await sleep(2500);
    assert.equal((await h.state()).zoom.targetMs, t0, 'the travel target moved — the clock was warped');

    // ── steppers walk the day's events and FAIL LOUD at the edges ─────────
    const next = await h.api('POST', '/timeline/travel', { step: 'next' });
    assert.equal(next.status, 200, JSON.stringify(next.data));
    assert.equal(next.data.zoom.cueId, 'c_expired');
    assert.equal((await h.deck()).name, 'burn_night', 'the stepper did not re-apply the snapshot');

    const back = await h.api('POST', '/timeline/travel', { step: 'prev' });
    assert.equal(back.status, 200);
    assert.equal(back.data.zoom.cueId, 'c_morning');

    const edge = await h.api('POST', '/timeline/travel', { step: 'prev' });
    assert.equal(edge.status, 400, 'the stepper CLAMPED at the first event instead of failing loud');
    assert.match(edge.data.error, /no prev event on \d{4}-\d{2}-\d{2}/);

    // ── EXIT ─────────────────────────────────────────────────────────────
    assert.equal((await h.api('POST', '/timeline/resume')).status, 200);
    const after = await until(() => h.state(), s => s.zoom === null, { what: 'the travel zoom to clear' });
    assert.equal(after.mode, 'armed');
    assert.equal((await h.deck()).name, 'default', 'exiting travel did not return the deck to the plan-at-now');
  });
});

test('E3 · REHEARSAL on a DORMANT plan: PERFORM refused, TRAVEL allowed, exit returns to dormancy', async () => {
  const now = Date.now();
  await withEngine({
    prefix: 'bm26-e2e-dormant',
    plans: { zoom_dormant: buildDormantPlan(now, { startInDays: 30 }) },
    activePlan: 'zoom_dormant',
  }, async (h) => {
    const dormant = await h.state();
    assert.equal(dormant.inFestivalWindow, false, 'the rehearsal fixture must be dormant');
    assert.ok(dormant.festivalStartsInDays > 0);

    // PERFORM is impossible: nothing is live, so takeover arms nothing at all.
    const tk = await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' });
    assert.equal(tk.status, 200);
    assert.equal(tk.data.operatorLease, null, 'a PERFORM lease armed on a dormant plan');
    assert.equal(tk.data.zoom, null);
    assert.equal((await h.state()).zoom, null);

    // TRAVEL to an OUT-OF-WINDOW instant is refused — no silent fallback to now.
    const bad = await h.api('POST', '/timeline/travel', { date: TODAY(), time: '21:00' });
    assert.equal(bad.status, 400, 'travel accepted an out-of-festival-window target');

    // TRAVEL to an IN-WINDOW instant is the rehearsal case, and it works.
    const target = dateAt(now, 31);
    const tv = await h.api('POST', '/timeline/travel', { date: target, time: '04:30' });
    assert.equal(tv.status, 200, JSON.stringify(tv.data));
    assert.equal(tv.data.zoom.scope, 'travel');
    assert.equal(tv.data.zoom.targetDate, target);
    assert.equal((await h.deck()).name, 'slow', 'the rehearsal snapshot never reached the deck');

    // It must SURVIVE the dormancy gate — that gate is the earliest in the tick
    // and used to null every lease (`_95` §3.7).
    await sleep(2500);
    const alive = await h.state();
    assert.equal(alive.zoom && alive.zoom.scope, 'travel', 'the dormancy gate tore down the rehearsal zoom');

    assert.equal((await h.api('POST', '/timeline/resume')).status, 200);
    const after = await until(() => h.state(), s => s.zoom === null, { what: 'the rehearsal zoom to clear' });
    assert.equal(after.inFestivalWindow, false, 'exiting a dormant rehearsal did not return to dormancy');
    assert.equal(after.mode, 'armed');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP 2 — the exit table, row by row (`_94` §5 / `_95` §3.5)
// ══════════════════════════════════════════════════════════════════════════

test('X2 · lease EXPIRY hands the ship back (and activity pings hold it open)', async () => {
  await withEngine(inWindowRig('bm26-e2e-expiry', { timelinePatch: { operatorLeaseSec: 6 } }),
    async (h) => {
      assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);

      // PRESENCE, not touch (`_94` §3.2): while the banner is mounted the pad
      // pings every ~30 s. Here: ping across more than one lease window.
      for (let i = 0; i < 5; i++) {
        await sleep(2000);
        assert.equal((await h.api('POST', '/timeline/activity')).status, 200);
      }
      assert.equal((await h.state()).zoom.scope, 'perform',
        'presence pings did not keep the zoom alive across the lease window');

      // Pings stop (app backgrounded / iPad dead / WiFi gone) → auto-release.
      const after = await until(() => h.state(), s => s.zoom === null,
        { timeoutMs: 15000, what: 'the lease to expire' });
      assert.equal(after.mode, 'armed');
      assert.equal(after.operatorLease, null);
      assert.ok(after.recentFires.some(e => e.reason === 'lease-released'),
        'the auto-release was not written to the event log');
    });
});

test('X3 · AUTOPILOT OFF clears the zoom', async () => {
  await withEngine(inWindowRig('bm26-e2e-apoff'), async (h) => {
    assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);
    assert.equal((await h.state()).zoom.scope, 'perform');

    assert.equal((await h.api('POST', '/timeline/autopilot', { enabled: false })).status, 200);
    const after = await h.state();
    assert.equal(after.zoom, null, 'AUTO OFF left a stranded zoom');
    assert.equal(after.autopilotEnabled, false);
    assert.equal(after.operatorLease, null);
  });
});

test('X4 · PLAN SAVE mid-zoom exits the zoom (the maker auto-saves — never tested live before)', async () => {
  // `_97` §7 item 5. The always-editing maker auto-saves; saving over the ACTIVE
  // plan hot-reloads it and runs catchUp, which drops any takeover. The pad must
  // learn about it from the BROADCAST, because it never asked for the exit.
  await withEngine(inWindowRig('bm26-e2e-save'), async (h) => {
    const pad = await h.client('maker');
    assert.equal((await h.api('POST', '/timeline/travel', { cueId: 'c_morning', date: TODAY() })).status, 200);
    await pad.waitFor(m => m.zoom && m.zoom.scope === 'travel', { what: 'the travel zoom' });
    assert.equal((await h.deck()).name, 'slow');

    // A genuine edit (relabel a cue) saved over the ACTIVE plan.
    const edited = buildE2EPlan(Date.now());
    edited.cues.find(c => c.id === 'c_live').label = 'Evening ramp (edited)';
    const save = await h.api('POST', '/timeline/plans', edited);
    assert.equal(save.status, 200, JSON.stringify(save.data));

    const after = await until(() => h.state(), s => s.zoom === null,
      { what: 'the plan save to drop the zoom' });
    assert.equal(after.mode, 'armed');
    assert.equal(after.operatorLease, null);
    assert.equal(after.activeCue.label, 'Evening ramp (edited)', 'the edit did not hot-reload');
    assert.equal((await h.deck()).name, 'default', 'the deck stayed on the traveled snapshot after the save');

    // The pad is TOLD — it did not ask for this exit.
    const cleared = await pad.waitFor(m => m.zoom === null && m.mode === 'armed',
      { what: 'the cleared zoom on the broadcast' });
    assert.equal(cleared.msg.zoom, null);
  });
});

test('X5 · ACTIVATING another plan clears the zoom', async () => {
  const now = Date.now();
  await withEngine({
    prefix: 'bm26-e2e-activate',
    plans: { zoom_e2e: buildE2EPlan(now), zoom_other: buildE2EPlan(now, { name: 'zoom_other', liveAgoMin: 40 }) },
    activePlan: 'zoom_e2e',
  }, async (h) => {
    assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);
    assert.equal((await h.state()).zoom.scope, 'perform');

    const act = await h.api('POST', '/timeline/plan/activate', { name: 'zoom_other' });
    assert.equal(act.status, 200, JSON.stringify(act.data));
    const after = await until(() => h.state(), s => s.zoom === null, { what: 'activate to clear the zoom' });
    assert.equal(after.activePlan, 'zoom_other');
    assert.equal(after.mode, 'armed');
  });
});

test('X6 · ENGINE RESTART mid-zoom, BOTH scopes: the ship wakes in the present (never tested live before)', async () => {
  // `_97` §7 item 4 — the one exit path that thread could not exercise. The
  // guarantee under test is structural: the zoom rides ON the lease object, and
  // the lease is never persisted, so a restart CANNOT resurrect a stale zoom.
  for (const scope of ['perform', 'travel']) {
    await withEngine(inWindowRig(`bm26-e2e-restart-${scope}`), async (h) => {
      const padBefore = await h.client('before');
      if (scope === 'perform') {
        assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);
      } else {
        assert.equal((await h.api('POST', '/timeline/travel', { cueId: 'c_morning', date: TODAY() })).status, 200);
      }
      const zoomed = await h.state();
      assert.equal(zoomed.zoom.scope, scope);
      assert.equal(zoomed.mode, 'overridden');
      await padBefore.waitFor(m => m.zoom && m.zoom.scope === scope, { what: `the ${scope} zoom` });

      // Let the tick persist at least once, so the on-disk state is the state a
      // reboot would actually read.
      //
      // FINDING (`_100` §5, F1): the scoped lease DOES reach disk. `_94` §4.3
      // and `_95` §3.5 describe the zoom as "runtime-only"; that is true of its
      // SEMANTICS (a restart never resumes it) but NOT of the bytes —
      // `timeline_state.yaml` carries the whole lease object, zoom scope and
      // all. Nothing but the boot `_catchUp` scrub stands between a persisted
      // `scope:'perform'` lease and a rig that wakes up believing a human has
      // the deck. So this scenario pins the SCRUB, not an absence of writes.
      await sleep(1500);
      const persisted = readTimelineState(h.stateDir);
      const leasePersisted = (persisted.operatorLease ?? null) !== null;

      // ── the real thing: the process dies ─────────────────────────────────
      await h.restart();

      await until(
        async () => readTimelineState(h.stateDir).operatorLease ?? null,
        (lease) => lease === null,
        {
          what: `boot to scrub the persisted operator lease (${scope}); it was `
            + `${leasePersisted ? 'on disk' : 'absent'} before the restart`,
        },
      );

      const after = await h.state();
      assert.equal(after.zoom, null, `a ${scope} zoom survived an engine restart`);
      assert.equal(after.operatorLease, null);
      assert.equal(after.mode, 'armed', `mode stuck at "${after.mode}" after a restart mid-${scope} zoom`);
      assert.notEqual(after.controller, 'manual', 'the rebooted engine still thinks a human holds the deck');

      // A pad RECONNECTING sees the truth on its very first frame — the replay,
      // not a tick later. This is what stops a stale banner surviving the reboot.
      const padAfter = await h.client('after');
      const first = padAfter.latest();
      assert.ok(first, 'a reconnecting client got no timelineState replay');
      assert.equal(first.zoom, null, 'a reconnecting pad was told a zoom is still live');
      assert.equal(first.mode, 'armed');

      // The plan is genuinely running again, on the deck.
      assert.equal(after.activeCue.id, 'c_live');
      assert.equal((await h.deck()).name, 'default');
    });
  }
});

test('X8 · ENABLE starts the deferred show now and clears the zoom', async () => {
  await withEngine({
    ...inWindowRig('bm26-e2e-enable', { showInMin: 240, timelinePatch: { programLeaseSec: 3 } }),
  }, async (h) => {
    const anchor = await alignToMinute(12);
    assert.equal((await h.api('POST', '/timeline/plans', buildE2EPlan(anchor, { showInMin: 1 }))).status, 200);
    assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);

    const deferred = await until(() => h.state(), s => s.zoom && s.zoom.pendingDeferred,
      { timeoutMs: 30000, what: 'the show to come due mid-zoom' });
    assert.equal(deferred.zoom.pendingDeferred.cueId, 'c_show');

    // The banner's ENABLE: "start it now". A deferred show is never dismissed.
    const en = await h.api('POST', '/timeline/program/enable');
    assert.equal(en.status, 200, JSON.stringify(en.data));

    const after = await until(() => h.state(), s => s.activeProgram !== null,
      { what: 'ENABLE to start the show' });
    assert.equal(after.activeProgram.cueId, 'c_show');
    assert.equal(after.zoom, null, 'ENABLE left the zoom banner up after handing the deck to the show');
    assert.equal(after.controller, 'program');
    assert.equal((await h.deck()).name, 'burn_night');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP 3 — two clients (`_94` §4.3 one-writer, D1/D6; `_97` §3.4)
// ══════════════════════════════════════════════════════════════════════════

test('T1 · two clients: B renders the banner, browsing never yanks A, either pad may retarget or EXIT', async () => {
  await withEngine(inWindowRig('bm26-e2e-two-pads'), async (h) => {
    const A = await h.client('A');

    // A enters a travel zoom.
    assert.equal((await h.api('POST', '/timeline/travel', { cueId: 'c_morning', date: TODAY() })).status, 200);
    await A.waitFor(m => m.zoom && m.zoom.scope === 'travel', { what: 'A to see its own zoom' });

    // B connects afterwards and is told the truth immediately, on the replay —
    // "nobody can walk up to a pad and not know" (`_94` §3.3).
    const B = await h.client('B');
    const bFirst = B.latest();
    assert.ok(bFirst, 'the second client got no timelineState replay');
    assert.equal(bFirst.zoom.scope, 'travel');
    assert.equal(bFirst.zoom.cueId, 'c_morning');

    // B BROWSING is client-local: it makes no engine call, so A's zoom lives on.
    // (D1 gates the tab-return exit on `zoomEnteredHere()`; the engine-side
    // guarantee that makes that safe is simply that reading state changes none.)
    for (let i = 0; i < 3; i++) { await h.state(); await h.api('GET', '/timeline/overview'); }
    await sleep(1500);
    assert.equal((await h.state()).zoom.scope, 'travel', "a second pad's browsing ended A's zoom");

    // ONE WRITER, ONE SESSION (D6): B retargets the single engine zoom and A
    // sees the same new target — there are never two zooms.
    const re = await h.api('POST', '/timeline/travel', { step: 'next' });
    assert.equal(re.status, 200);
    assert.equal(re.data.zoom.cueId, 'c_expired');
    const aSees = await A.waitFor(m => m.zoom && m.zoom.cueId === 'c_expired',
      { what: "A to see B's retarget" });
    assert.equal(aSees.msg.zoom.targetMs, re.data.zoom.targetMs);
    const bSees = await B.waitFor(m => m.zoom && m.zoom.cueId === 'c_expired', { what: 'B to see its own retarget' });
    assert.deepEqual(bSees.msg.zoom, aSees.msg.zoom, 'the two pads rendered different zooms');

    // B's EXIT ends it for BOTH — the banner's EXIT is on every client.
    assert.equal((await h.api('POST', '/timeline/resume')).status, 200);
    await A.waitFor(m => m.zoom === null, { what: "A to see B's EXIT" });
    await B.waitFor(m => m.zoom === null, { what: 'B to see its own EXIT' });
    assert.equal((await h.state()).mode, 'armed');
  });
});

test("T2 · the `_97` race is real: the cleared-zoom broadcast beats the resume() response", async () => {
  // `_97` §3.4 found this LIVE and fixed it by staking the exit claim BEFORE the
  // request goes out. The pure decision (`shouldAnnounceZoomEnd`) is unit-pinned
  // in CaptainPad; what only an e2e can show is that its PREMISE is real — that
  // an operator-initiated exit genuinely sees `zoom:null` arrive before its own
  // response. Without the claim, that ordering raises a "zoom ended — the plan
  // resumed" alarm at the person who just asked to leave.
  await withEngine(inWindowRig('bm26-e2e-race'), async (h) => {
    const pad = await h.client('A');
    assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);
    await pad.waitFor(m => m.zoom && m.zoom.scope === 'perform', { what: 'the zoom' });

    const beforeCount = pad.timelineFrames().length;
    await h.api('POST', '/timeline/resume');
    const responseAtMs = Date.now();

    // The frame the engine pushed as part of handling resume().
    const cleared = pad.timelineFrames().slice(beforeCount).find(f => f.msg.zoom === null);
    assert.ok(cleared, 'no cleared-zoom broadcast arrived with the resume');
    assert.ok(cleared.atMs <= responseAtMs,
      `the broadcast (${cleared.atMs}) did NOT beat the response (${responseAtMs}) — `
      + 'if this ever stops holding, re-check whether CaptainPad still needs its pre-staked exit claim');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP 4 — party sessions vs the zoom (`_98` fix 1)
// ══════════════════════════════════════════════════════════════════════════

test('P1 · a party fire during a PERFORM lease is SUPPRESSED, not CONSUMED (`_98` fix 1)', async () => {
  await withEngine(inWindowRig('bm26-e2e-party-suppressed'), async (h) => {
    await assertMoodKeyRegistered(h);
    let party = false;
    // The mood trigger arms by OBSERVING calm first — exactly as the Companion
    // publishes silence before music. Start calm or the cue can never arm.
    const stopMood = startMoodPublisher(h, i => (party ? 0.9 + (i % 2) * 0.05 : (i % 2) * 0.01));
    try {
      await sleep(3000);
      assert.equal((await h.api('GET', '/party-config')).data.effectiveState, 'armed');

      assert.equal((await h.api('POST', '/timeline/takeover', { scope: 'perform', cueId: 'c_live' })).status, 200);
      await sleep(2200);                  // let the takeover settle (see E1)
      const deckUnderZoom = await h.deck();

      party = true;                       // the music starts while the operator performs
      await sleep(8000);

      const during = await h.state();
      assert.equal(during.currentMood, 'party', 'the mood never reached party — the scenario proved nothing');
      assert.equal(during.controller, 'manual');
      assert.deepEqual(await h.deck(), deckUnderZoom, 'a party session seized the deck during a PERFORM zoom');

      // SUPPRESSED — and visible, never silent.
      const would = during.wouldFire.filter(w => w.cueId === 'c_party');
      assert.ok(would.length >= 1, 'the suppressed party fire was not surfaced as wouldFire');
      // EDGE-ONLY: one entry per continuous episode, not one per second.
      assert.ok(would.length <= 2, `wouldFire logged per-tick, not per-episode: ${would.length} entries`);

      // NOT CONSUMED: the arm latch and the cooldown are both intact, which is
      // the whole of `_98` fix 1 — before it, one suppressed attempt cost the
      // entire night's party.
      const pc = (await h.api('GET', '/party-config')).data;
      assert.equal(pc.triggerArmed, true, 'the suppressed fire burnt the one-fire-per-arrival latch');
      assert.equal(pc.cooldownRemainingSec, 0, 'the suppressed fire stamped the cooldown');

      // …so the moment the operator hands back, the party can actually happen.
      assert.equal((await h.api('POST', '/timeline/resume')).status, 200);
      const after = await until(() => h.state(), s => s.activeCue && s.activeCue.id === 'c_party',
        { timeoutMs: 15000, what: 'the party session to start after the hand-back' });
      assert.equal(after.controller, 'autopilot');
      assert.equal((await h.deck()).name, 'party_high');
    } finally { stopMood(); }
  });
});

test('P2 · a party session MID-FLIGHT when a zoom starts is suppressed by the human layer and re-derived on exit', async () => {
  await withEngine(inWindowRig('bm26-e2e-party-midflight'), async (h) => {
    await assertMoodKeyRegistered(h);
    let party = false;
    const stopMood = startMoodPublisher(h, i => (party ? 0.9 + (i % 2) * 0.05 : (i % 2) * 0.01));
    try {
      await sleep(3000);
      party = true;
      const live = await until(() => h.state(), s => s.activeCue && s.activeCue.id === 'c_party',
        { timeoutMs: 20000, what: 'a party session to start' });
      assert.equal((await h.deck()).name, 'party_high');
      assert.ok(live.activeCue.untilMs, 'the session should carry its window end');

      // TRAVEL away mid-session. Entering a zoom is a takeover, so the existing
      // end-vs-rejoin rules apply — travel adds NO new party semantics.
      assert.equal((await h.api('POST', '/timeline/travel', { cueId: 'c_morning', date: TODAY() })).status, 200);
      assert.equal((await h.deck()).name, 'slow', 'the traveled snapshot did not take the deck from the session');
      await sleep(2000);
      assert.equal((await h.state()).zoom.scope, 'travel', 'the live session tore down the zoom');

      // Exit → catchUp re-derives NOW. The engine decides end-vs-rejoin; what is
      // asserted here is that it reaches a COHERENT state — never a session that
      // owns the deck while the plan thinks it is over, and never a stuck zoom.
      assert.equal((await h.api('POST', '/timeline/resume')).status, 200);
      const after = await until(() => h.state(), s => s.zoom === null, { what: 'the zoom to clear' });
      assert.equal(after.mode, 'armed');
      const pc = (await h.api('GET', '/party-config')).data;
      const deck = await h.deck();
      if (after.activeCue && after.activeCue.id === 'c_party') {
        assert.equal(pc.effectiveState, 'in_session', 'the deck runs the session but the card says otherwise');
        assert.equal(deck.name, 'party_high');
      } else {
        assert.notEqual(pc.effectiveState, 'in_session', 'the card claims a session the deck is not running');
        assert.notEqual(deck.name, 'party_high', 'the session look survived a session the plan ended');
      }
    } finally { stopMood(); }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GROUP 5 — post-`_98` conformance on the wire
// ══════════════════════════════════════════════════════════════════════════

test('C1 · hold expiry lands on AMBIENT, and `hold-expired-baseline` is gone from the wire (`_98` FIX 7)', async () => {
  await withEngine(inWindowRig('bm26-e2e-g1'), async (h) => {
    // The fixture's c_expired fired 3 h ago with a 30 min hold — long over. The
    // BOOT half of FIX 7: catchUp re-applies its action then releases the latch
    // so the ambient defaultCue reclaims the deck. Before `_98` the deck sat on
    // the baseline playlist with the dead cue still owning it.
    const resolve = await h.api('GET', `/timeline/resolve?date=${TODAY()}&time=${clockAt(Date.now(), -150)}`);
    assert.equal(resolve.status, 200, JSON.stringify(resolve.data));
    assert.equal(resolve.data.owner.kind, 'defaultCue',
      'an expired program hold still owns the deck (G1 regressed)');
    assert.equal(resolve.data.playlist, 'ambient');
    assert.notEqual(resolve.data.source, 'hold-expired-baseline');

    // …and nowhere in the whole ribbon, on any day.
    const ov = await h.api('GET', '/timeline/overview');
    assert.equal(ov.status, 200);
    assertRibbonSane(ov.data, 'zoom_e2e');
  });
});

test("C2 · the ribbon is honest on the OPERATOR'S OWN shipped plan", async () => {
  // The real `playa_default` is COPIED in read-only. It is dormant today, which
  // is exactly the review case day zoom exists for: the operator studies nights
  // that have not happened yet.
  const shipped = path.join(REPO_DIR, 'simulation', 'scenes', 'titanic', 'timeline', 'playa_default.yaml');
  await withEngine({
    prefix: 'bm26-e2e-shipped',
    plans: { zoom_e2e: buildE2EPlan(Date.now()) },
    copyPlans: [shipped],
    activePlan: 'playa_default',
  }, async (h) => {
    const st = await h.state();
    assert.equal(st.activePlan, 'playa_default');
    // `_98` FIX 4 is a LOUD DIAGNOSTIC, not a throw: the shipped plan still
    // loads, and says what is wrong with it.
    assert.ok(Array.isArray(st.planWarnings));

    const ov = await h.api('GET', '/timeline/overview');
    assert.equal(ov.status, 200);
    const days = assertRibbonSane(ov.data, 'playa_default');

    // Every festival day must give the ambient defaultCue real time. This is
    // `_98`'s headline (0 h → 12 h 20 m of ambient) asserted on the REVIEW
    // SURFACE, which is where the operator actually reads it.
    for (const day of days) {
      const ambient = day.segments.filter(s => s.playlist === 'ambient');
      assert.ok(ambient.length > 0,
        `day ${day.date || day.dayIndex} shows no ambient at all — G1 is back on the wire`);
    }

    // B1 REGRESSION (`_100`): a cue that hands the deck back must produce a
    // BOUNDARY. `c_visibility_on` holds 90 min; the segment that starts when it
    // fires must not run past its hold end.
    for (const day of days) {
      for (let i = 0; i < day.segments.length; i++) {
        const s = day.segments[i];
        if (s.owner.cueId !== 'c_visibility_on' || s.controller !== 'program') continue;
        assert.ok(s.toMs - s.fromMs <= 90 * 60000 + 1000,
          `a 90-minute program hold is reported as owning ${(s.toMs - s.fromMs) / 60000} minutes`);
      }
    }
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * The `_95` §3.1 ribbon contract, asserted: phases present, segments tiling
 * [00:00, 24:00) with no gaps and no overlaps, a known `source` union, and NO
 * `hold-expired-baseline` (removed at the source by `_98` FIX 7).
 */
function assertRibbonSane(overview, planName) {
  const days = overview.days || [];
  assert.ok(days.length > 0, `${planName}: overview carries no days`);
  const SOURCES = new Set(['cue', 'default-cue', 'autopilot-baseline', 'dormant']);
  for (const day of days) {
    assert.ok(Array.isArray(day.phases), `${planName}: a day carries no phases array`);
    assert.ok(Array.isArray(day.segments) && day.segments.length > 0,
      `${planName}: a day carries no segments`);
    assert.equal(day.segments[0].fromLocal, '00:00');
    assert.equal(day.segments[day.segments.length - 1].toLocal, '24:00',
      `${planName}: the ribbon must terminate at the literal 24:00`);
    for (let i = 0; i < day.segments.length; i++) {
      const s = day.segments[i];
      assert.notEqual(s.source, 'hold-expired-baseline',
        `${planName}: 'hold-expired-baseline' is on the wire — G1 regressed (\`_98\` FIX 7)`);
      assert.ok(SOURCES.has(s.source), `${planName}: unknown segment source ${JSON.stringify(s.source)}`);
      assert.ok(s.toMs > s.fromMs, `${planName}: a segment has non-positive duration`);
      if (i > 0) {
        assert.equal(s.fromMs, day.segments[i - 1].toMs,
          `${planName}: the ribbon has a gap or an overlap at ${s.fromLocal}`);
      }
    }
  }
  return days;
}

/** The engine's PERSISTED timeline state — the bytes a reboot would read. */
function readTimelineState(stateDir) {
  const file = path.join(stateDir, 'timeline_state.yaml');
  assert.ok(fs.existsSync(file), `no persisted timeline state at ${file}`);
  return yaml.load(fs.readFileSync(file, 'utf8')) || {};
}
