/*
 * party_window.test.js — the ONE Party Window predicate (report 356 §2, P0-1).
 *
 * The bug this pins (finding F2): the engine carried TWO definitions of "the
 * window is open" — a night-start-day one in the status and a calendar-day one
 * in the evaluator. They disagreed for the whole post-midnight half of every
 * wrapping window, so `/party-config` said WINDOW CLOSED while the evaluator
 * fired the party cue anyway. `partyWindowAt()` is now the only answer.
 *
 * PURE tests: no service, no clock, every instant injected.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/party_window.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateShowPlan } from '../../lib/timeline/show_plan.js';
import { dateClockToEpochMs } from '../../lib/timeline/triggers.js';
import { partyWindowAt, phaseWindowAt, noPartyWindow } from '../../lib/timeline/party_window.js';

const TZ = 'America/Los_Angeles';
const LOC = { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 };

// Festival day 0 = 2026-08-23, four days. The window wraps midnight, exactly
// like the operator's authored plan: 21:00 → 09:00.
const DAY0 = '2026-08-23';
const DAY1 = '2026-08-24';
const DAY2 = '2026-08-25';

const at = (dateKey, hhmm) => dateClockToEpochMs(dateKey, hhmm, TZ);

function makePlan({ days = [0], phase = { start: { clock: '21:00' }, end: { clock: '09:00' } }, whenPhase = 'pw' } = {}) {
  const trigger = {
    type: 'mood', from: 'calm', to: 'party', minDwellSec: 15, cooldownSec: 60,
  };
  if (whenPhase !== null) trigger.whenPhase = whenPhase;
  return validateShowPlan({
    schemaVersion: 2,
    name: 'window_plan',
    location: LOC,
    festival: { startDate: DAY0, days: 4 },
    autopilot: {
      enabled: true, playlist: 'default', delay_s: 45, shuffle: false,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: { pw: phase },
    looks: {},
    cues: [{
      id: 'c_party',
      label: 'Party 1',
      kind: 'mood',
      days,
      trigger,
      action: { type: 'playlist', name: 'party', target: { channel: 'deck', id: null } },
    }],
  });
}

const partyCueOf = (plan) => plan.cues.find((c) => c.id === 'c_party');

function windowAt(plan, ms) {
  return partyWindowAt({ plan, cue: partyCueOf(plan), now: ms, sunEvents: {} });
}

// ── the open/closed answer ───────────────────────────────────────────────────

test('BEFORE the window starts on its own day: closed, and it opens TODAY at 21:00', () => {
  const plan = makePlan();
  const w = windowAt(plan, at(DAY0, '12:00'));
  assert.equal(w.open, false);
  assert.equal(w.phaseId, 'pw');
  assert.equal(w.opensAtMs, at(DAY0, '21:00'), 'the chip must be able to say "opens 21:00"');
  assert.equal(w.closesAtMs, at(DAY1, '09:00'), 'and the window it names closes the next morning');
});

test('INSIDE the window before midnight: open, with the night it opened on', () => {
  const plan = makePlan();
  const w = windowAt(plan, at(DAY0, '23:30'));
  assert.equal(w.open, true);
  assert.equal(w.opensAtMs, at(DAY0, '21:00'));
  assert.equal(w.nightStartMs, at(DAY0, '21:00'));
  assert.equal(w.closesAtMs, at(DAY1, '09:00'));
});

test('AFTER midnight the window still belongs to the night it opened on (days:[0])', () => {
  // THE F2 CASE. At 02:00 the calendar day is festival day 1, but the open
  // window began at 21:00 on day 0 — which is the day `days:[0]` names.
  const plan = makePlan({ days: [0] });
  const w = windowAt(plan, at(DAY1, '02:00'));
  assert.equal(w.open, true, 'the post-midnight half of the window must stay OPEN');
  assert.equal(w.nightStartMs, at(DAY0, '21:00'));
  assert.equal(w.closesAtMs, at(DAY1, '09:00'));
});

test('AFTER midnight a NEXT-day-only cue (days:[1]) is CLOSED even though the clock is inside', () => {
  // The mirror image, and the reason a clock-only phase check is not a window:
  // the phase is active at 02:00 on day 1, but this cue only applies to the
  // night that STARTS on day 1 — which has not opened yet.
  const plan = makePlan({ days: [1] });
  const w = windowAt(plan, at(DAY1, '02:00'));
  assert.equal(w.open, false);
  assert.equal(w.opensAtMs, at(DAY1, '21:00'), 'it opens tonight, not this morning');
  assert.equal(w.closesAtMs, at(DAY2, '09:00'));
});

test('a days:[0] window never opens again once its night is over', () => {
  const plan = makePlan({ days: [0] });
  const w = windowAt(plan, at(DAY1, '12:00'));
  assert.equal(w.open, false);
  assert.equal(w.opensAtMs, null, 'no future night applies — say so instead of guessing');
  assert.equal(w.closesAtMs, null);
});

test("days:'all' is open on every night of the span, both sides of midnight", () => {
  const plan = makePlan({ days: 'all' });
  assert.equal(windowAt(plan, at(DAY0, '22:00')).open, true);
  assert.equal(windowAt(plan, at(DAY1, '03:00')).open, true);
  assert.equal(windowAt(plan, at(DAY2, '22:00')).open, true);
  const midday = windowAt(plan, at(DAY1, '12:00'));
  assert.equal(midday.open, false, 'midday is outside the phase clock');
  assert.equal(midday.opensAtMs, at(DAY1, '21:00'));
});

test('a NON-WRAPPING window is the plain same-day interval', () => {
  const plan = makePlan({ days: 'all', phase: { start: { clock: '21:00' }, end: { clock: '23:00' } } });
  assert.equal(windowAt(plan, at(DAY0, '20:59')).open, false);
  const open = windowAt(plan, at(DAY0, '22:00'));
  assert.equal(open.open, true);
  assert.equal(open.opensAtMs, at(DAY0, '21:00'));
  assert.equal(open.closesAtMs, at(DAY0, '23:00'), 'no midnight roll for a same-day window');
  const after = windowAt(plan, at(DAY0, '23:30'));
  assert.equal(after.open, false);
  assert.equal(after.opensAtMs, at(DAY1, '21:00'));
});

test('with NO whenPhase the cue days ARE the window — all day, every applicable day', () => {
  const plan = makePlan({ days: [1], whenPhase: null });
  assert.equal(windowAt(plan, at(DAY0, '22:00')).open, false);
  const w = windowAt(plan, at(DAY1, '04:00'));
  assert.equal(w.open, true, 'no authored phase → cueAppliesOn is the whole answer');
  assert.equal(w.phaseId, null);
  assert.equal(w.opensAtMs, null, 'a whole-day window has no HH:MM to open at');
});

test('no party cue at all is a CLOSED window, not a crash and not a null', () => {
  const plan = makePlan();
  const w = partyWindowAt({ plan, cue: null, now: at(DAY0, '22:00'), sunEvents: {} });
  assert.deepEqual(w, noPartyWindow());
  assert.equal(w.open, false);
});

// ── loudness (codex P0: no silent guessing) ─────────────────────────────────

test('a cue gated on an UNDEFINED phase throws — never a silent "closed"', () => {
  const plan = makePlan();
  const cue = { ...partyCueOf(plan), trigger: { ...partyCueOf(plan).trigger, whenPhase: 'not_a_phase' } };
  assert.throws(
    () => partyWindowAt({ plan, cue, now: at(DAY0, '22:00'), sunEvents: {} }),
    /not_a_phase/,
  );
});

test('partyWindowAt refuses a missing plan or a non-numeric instant', () => {
  const plan = makePlan();
  assert.throws(() => partyWindowAt({ plan: null, cue: partyCueOf(plan), now: 1 }), /plan is required/);
  assert.throws(() => partyWindowAt({ plan, cue: partyCueOf(plan), now: 'later' }), /finite epoch ms/);
});

// ── the shared phase helper (P1-5 uses it for the phase-baseline cue) ────────

test('phaseWindowAt reports the night a wrapping phase belongs to', () => {
  const plan = makePlan();
  const before = phaseWindowAt({ plan, phaseId: 'pw', atMs: at(DAY0, '23:00') });
  assert.equal(before.active, true);
  assert.equal(before.nightStartMs, at(DAY0, '21:00'));
  assert.equal(before.nightEndMs, at(DAY1, '09:00'));

  const after = phaseWindowAt({ plan, phaseId: 'pw', atMs: at(DAY1, '02:00') });
  assert.equal(after.active, true);
  assert.equal(after.nightStartMs, at(DAY0, '21:00'), 'the SAME night, seen from the other side of midnight');
  assert.equal(after.nightEndMs, at(DAY1, '09:00'));

  const outside = phaseWindowAt({ plan, phaseId: 'pw', atMs: at(DAY1, '12:00') });
  assert.equal(outside.active, false);
  assert.equal(outside.nightStartMs, at(DAY1, '21:00'), 'the next night is the one now pending');
});
