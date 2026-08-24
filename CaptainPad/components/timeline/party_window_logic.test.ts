import { describe, expect, it } from 'vitest';

import type { ActionPlaylist, PlanCue, ShowPlan } from '../../utils/timelineApi';
import {
  partyWindowBaselineCueId,
  partyWindowDayLabel,
  partyWindowDaysSummary,
  partyWindowEndCueId,
  partyWindowPhaseId,
  partyWindowSeed,
  partyWindowStartDays,
  partyWindowWrapsMidnight,
  planWithPartyWindow,
  planWithoutPartyWindow,
} from './party_window_logic';

const playlist = (name: string): ActionPlaylist => ({
  type: 'playlist',
  name,
  target: { channel: 'deck', id: null },
});

const plan: ShowPlan = {
  schemaVersion: 2,
  name: 'party_test',
  location: { lat: 0, lon: 0, tz: 'UTC' },
  festival: { startDate: '2026-08-30', days: 2 },
  autopilot: { enabled: true, delay_s: 30, shuffle: false },
  defaultCue: { label: 'Normal night', action: playlist('default') },
  phases: {},
  looks: {},
  cues: [],
};

const cue: PlanCue = {
  id: 'c_party_window',
  label: 'Party hours',
  enabled: true,
  kind: 'mood',
  trigger: { type: 'mood', from: 'calm', to: 'party' },
  action: playlist('party_high'),
  days: 'all',
};

describe('Party Window plan authoring', () => {
  it('compiles one operator Party Window into the existing phase-gated engine contract', () => {
    const out = planWithPartyWindow(plan, cue, {
      startAt: '21:00',
      windowDurationMin: 480,
      baselineAction: playlist('ambient'),
      partyAction: {
        ...playlist('party_high'),
        autopilot: { active: true, delay_s: 15, shuffle: true },
        transition: { enabled: true, mode: 'trans_flash', durationMs: 400, shuffle: false },
        globals: { speed: 0.25, bpmSpeedSync: 0 },
        overlays: 'disable',
      },
      minDwellSec: 90,
      sessionDurationMin: 12,
      cooldownSec: 300,
    });
    const phaseId = partyWindowPhaseId(cue.id);
    const baselineId = partyWindowBaselineCueId(cue.id);

    expect(out.phases[phaseId]).toEqual({
      start: { clock: '21:00' },
      end: { clock: '05:00' },
    });
    expect(out.cues.find((candidate) => candidate.id === baselineId)).toMatchObject({
      kind: 'ambient',
      trigger: { type: 'phase', phase: phaseId },
      action: { type: 'playlist', name: 'ambient' },
    });
    expect(out.cues.find((candidate) => candidate.id === 'pwe_c_party_window')).toMatchObject({
      kind: 'ambient',
      trigger: { type: 'clock', at: '05:00' },
      action: { type: 'playlist', name: 'default' },
    });
    expect(out.cues.find((candidate) => candidate.id === cue.id)).toMatchObject({
      kind: 'mood',
      trigger: {
        type: 'mood',
        from: 'calm',
        to: 'party',
        whenPhase: phaseId,
        minDwellSec: 90,
        cooldownSec: 300,
      },
      action: {
        type: 'playlist',
        name: 'party_high',
        autopilot: { active: true, delay_s: 15, shuffle: true },
        transition: { mode: 'trans_flash', durationMs: 400 },
        globals: { speed: 0.25, bpmSpeedSync: 0 },
        overlays: 'disable',
      },
      durationMin: 12,
    });
    expect(partyWindowSeed(out, out.cues.find((candidate) => candidate.id === cue.id) ?? null))
      .toMatchObject({
        startAt: '21:00',
        windowDurationMin: 480,
        partyAction: { name: 'party_high' },
        sessionDurationMin: 12,
      });
  });

  it('removes the internal baseline and phase with the operator Party Window', () => {
    const authored = planWithPartyWindow(plan, cue, {
      startAt: '22:00',
      windowDurationMin: 360,
      baselineAction: playlist('default'),
      partyAction: playlist('party_high'),
      minDwellSec: 30,
      sessionDurationMin: 10,
      cooldownSec: 120,
    });
    const removed = planWithoutPartyWindow(authored, cue.id);

    expect(removed.cues).toEqual([]);
    expect(removed.phases).toEqual({});
  });

  it('removes the legacy party phase baseline when migrating an old mood cue', () => {
    const legacy: ShowPlan = {
      ...plan,
      phases: {
        party_night: { start: { clock: '20:00' }, end: { clock: '02:00' } },
      },
      cues: [
        {
          id: 'c_party_start',
          label: 'Party night ramp',
          kind: 'ambient',
          trigger: { type: 'phase', phase: 'party_night' },
          action: playlist('ambient'),
        },
        cue,
      ],
    };
    const migrated = planWithPartyWindow(legacy, cue, {
      startAt: '21:00',
      windowDurationMin: 240,
      baselineAction: playlist('ambient'),
      partyAction: playlist('party_high'),
      minDwellSec: 60,
      sessionDurationMin: 12,
      cooldownSec: 120,
    });

    expect(migrated.cues.some((candidate) => candidate.id === 'c_party_start')).toBe(false);
    expect(migrated.phases.party_night).toBeUndefined();
  });
});

// ── THE PARTY WINDOW DAY RULE ────────────────────────────────────────────
//
// Regression cover for the live bug of 2026-08-23: a 09:00 → 17:00 window
// authored on festival day 0 landed on days:[1] (baseline + party) and [2]
// (closer), so the engine reported `opensAtMs` = TOMORROW 09:00 and the PARTY
// card read "× WINDOW · opens 09:00" while the operator was standing in the
// window. Two causes, both pinned below:
//   1. the editor ran the window's days through the 6 PM operator-day shift,
//      which is for ordinary clock cues — a Party Window's days are CALENDAR
//      days resolved against the instant the window OPENS (party_window.js);
//   2. the closer was shifted +1 day unconditionally, even for a window that
//      ends the same afternoon.
//
// The rule now: OPENS on day N ⇒ baseline + party cue [N]; the closer is [N]
// for a window that ends before midnight and [N+1] for one that wraps.
describe('Party Window day assignment', () => {
  // Mirrors the live `test_week` plan: 4 festival days from a Sunday.
  const week: ShowPlan = {
    ...plan,
    name: 'day_rule',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles' },
    festival: { startDate: '2026-08-23', days: 4 },
  };

  const author = (days: PlanCue['days'], startAt: string, windowDurationMin: number) =>
    planWithPartyWindow(week, { ...cue, days }, {
      startAt,
      windowDurationMin,
      baselineAction: playlist('ambient'),
      partyAction: playlist('party_high'),
      minDwellSec: 30,
      sessionDurationMin: 12,
      cooldownSec: 120,
    });

  const daysOf = (out: ShowPlan, id: string) =>
    out.cues.find((candidate) => candidate.id === id)?.days;

  const baselineId = partyWindowBaselineCueId(cue.id);
  const endId = partyWindowEndCueId(cue.id);

  it('THE BUG: a daytime window authored for day 0 stays on day 0, closer included', () => {
    const out = author([0], '09:00', 480); // 09:00 → 17:00, same day
    expect(daysOf(out, baselineId)).toEqual([0]);
    expect(daysOf(out, cue.id)).toEqual([0]);
    expect(daysOf(out, endId)).toEqual([0]);
  });

  it('a window that wraps past midnight closes on the NEXT day', () => {
    const out = author([0], '21:00', 720); // 21:00 → 09:00
    expect(daysOf(out, baselineId)).toEqual([0]);
    expect(daysOf(out, cue.id)).toEqual([0]);
    expect(daysOf(out, endId)).toEqual([1]);
  });

  it('an evening window that ends before midnight closes the same day', () => {
    const out = author([2], '20:00', 180); // 20:00 → 23:00
    expect(daysOf(out, baselineId)).toEqual([2]);
    expect(daysOf(out, endId)).toEqual([2]);
  });

  it('a window ending exactly at midnight counts as wrapping (00:00 is tomorrow)', () => {
    const out = author([1], '21:00', 180); // 21:00 → 00:00
    expect(daysOf(out, endId)).toEqual([2]);
  });

  // RULE, authoring at 01:00 on day 1 while last night's window is still up:
  // the DAYS pill is the CALENDAR festival day the pad is on (timeline.tsx
  // todayIndex = the overview day whose DATE matches today in the plan tz), so
  // a window authored at 01:00 on day 1 opens on day 1 — it does NOT reach back
  // and re-open the window that started on day 0. The editor now SAYS which day
  // (partyWindowDaysSummary), so the operator can pick day 0 explicitly if the
  // window they mean is the one already running.
  it('authoring after midnight targets the calendar day the pad is on, not last night', () => {
    const out = author([1], '21:00', 720);
    expect(daysOf(out, baselineId)).toEqual([1]);
    expect(daysOf(out, endId)).toEqual([2]);
  });

  // RULE, authoring after the window's own end time: the day comes from the
  // DAYS selection, never from the wall clock. A 09:00 → 17:00 window authored
  // at 18:00 on day 0 is authored FOR day 0 (already past); the engine's
  // nextOpening then reports the next day it applies, and the chip names that
  // day. Nothing silently rolls the authoring to tomorrow.
  it('authoring after the window has already ended still targets the selected day', () => {
    const out = author([0], '09:00', 480);
    expect(daysOf(out, cue.id)).toEqual([0]);
  });

  it('the LAST festival day cannot host a wrapping window — it fails loud', () => {
    expect(() => author([3], '21:00', 720))
      .toThrow(/closes on day D5 — past the last festival day \(D4\)/);
    // …and the same window one day earlier is fine.
    expect(daysOf(author([2], '21:00', 720), endId)).toEqual([3]);
  });

  it('multi-day picks map element-wise', () => {
    expect(daysOf(author([0, 2], '09:00', 480), endId)).toEqual([0, 2]);
    expect(daysOf(author([0, 2], '21:00', 720), endId)).toEqual([1, 3]);
  });

  it('"All days" is untouched on every cue, wrapping or not', () => {
    for (const [startAt, length] of [['09:00', 480], ['21:00', 720]] as const) {
      const out = author('all', startAt, length);
      expect(daysOf(out, baselineId)).toBe('all');
      expect(daysOf(out, cue.id)).toBe('all');
      expect(daysOf(out, endId)).toBe('all');
    }
  });

  it('explicit calendar dates follow the same same-day / next-day rule', () => {
    expect(daysOf(author(['2026-08-23'], '09:00', 480), endId)).toEqual(['2026-08-23']);
    expect(daysOf(author(['2026-08-23'], '21:00', 720), endId)).toEqual(['2026-08-24']);
  });

  it('partyWindowWrapsMidnight is the wrap predicate, and rejects junk loudly', () => {
    expect(partyWindowWrapsMidnight('09:00', 480)).toBe(false);
    expect(partyWindowWrapsMidnight('21:00', 180)).toBe(true);   // → 00:00
    expect(partyWindowWrapsMidnight('21:00', 720)).toBe(true);
    expect(() => partyWindowWrapsMidnight('9am', 60)).toThrow(/must be HH:MM/);
    expect(() => partyWindowWrapsMidnight('09:00', 0)).toThrow(/between 1 and 1,440/);
  });
});

describe('Party Window DAYS serialization (editor → wire)', () => {
  it('passes a calendar day selection through with NO operator-day shift', () => {
    expect(partyWindowStartDays([0], 4)).toEqual({ days: [0], overflowError: null });
    expect(partyWindowStartDays([2, 0], 4)).toEqual({ days: [0, 2], overflowError: null });
    expect(partyWindowStartDays('all', 4)).toEqual({ days: 'all', overflowError: null });
    expect(partyWindowStartDays(undefined, 4)).toEqual({ days: 'all', overflowError: null });
    expect(partyWindowStartDays(['2026-08-23'], 4))
      .toEqual({ days: ['2026-08-23'], overflowError: null });
  });

  it('refuses a day outside the festival span instead of clamping it away', () => {
    const out = partyWindowStartDays([4], 4);
    expect(out.overflowError).toMatch(/Day 5 is outside this plan's festival span \(D1–D4\)/);
    const empty = partyWindowStartDays([], 4);
    expect(empty.overflowError).toMatch(/Pick at least one day/);
  });
});

describe('Party Window DAYS summary (the operator can SEE the day)', () => {
  const week: ShowPlan = {
    ...plan,
    festival: { startDate: '2026-08-23', days: 4 }, // Sun 23 Aug 2026
  };

  it('names the festival day AND its calendar date', () => {
    expect(partyWindowDayLabel(week, 0)).toBe('D1 · Sun, Aug 23');
    expect(partyWindowDayLabel(week, 1)).toBe('D2 · Mon, Aug 24');
  });

  it('says which day a same-day window opens and closes on', () => {
    expect(partyWindowDaysSummary({
      plan: week, days: [0], startAt: '09:00', windowDurationMin: 480,
    })).toBe('Opens 09:00 → 17:00 on D1 · Sun, Aug 23 and closes the same day.');
  });

  it('says which morning a wrapping window closes on', () => {
    expect(partyWindowDaysSummary({
      plan: week, days: [0], startAt: '21:00', windowDurationMin: 720,
    })).toBe(
      'Opens 21:00 → 09:00 on D1 · Sun, Aug 23 and closes the next morning on D2 · Mon, Aug 24.',
    );
  });

  it('covers the All-days and date-string forms', () => {
    expect(partyWindowDaysSummary({
      plan: week, days: 'all', startAt: '09:00', windowDurationMin: 480,
    })).toBe('Opens 09:00 → 17:00 EVERY festival day and closes the same day.');
    expect(partyWindowDaysSummary({
      plan: week, days: ['2026-08-23'], startAt: '21:00', windowDurationMin: 720,
    })).toBe('Opens 21:00 → 09:00 on 2026-08-23 and closes the next morning.');
  });
});
