/*
 * overview_perf.test.js — regression for J1 (reports _116 / _113):
 * GET/POST /timeline/overview froze the whole engine.
 *
 * The `_95` day ribbon was built synchronously on the HTTP thread in
 * O(days × cues²) — `buildDaySegments` re-ran `resolveDayTimes` per sample
 * point, each constructing Intl.DateTimeFormat per clock cue. Measured on a real
 * engine: 512 cues (the schema's own cap) × 8 days = 296 s FROZEN, starving the
 * render loop / sACN out / tick. The fix caches the Intl formatters (per tz) and
 * injects the day's already-resolved `dayTimes` into the per-sample resolver, so
 * the ribbon does zero per-sample Intl work.
 *
 * This asserts a STATED BUDGET (well under the pre-fix freeze) plus a CORRECTNESS
 * invariant: the injected-dayTimes ribbon must agree with a direct, independent
 * resolve at the same instant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOverview } from '../../lib/timeline/timeline_service.js';
import { buildDaySegments, resolveDeckStateAt } from '../../lib/timeline/resolve_deck_state.js';
import { validateShowPlan } from '../../lib/timeline/show_plan.js';
import { dateClockToEpochMs } from '../../lib/timeline/triggers.js';

const TZ = 'America/Los_Angeles';

// A plan with N clock cues across a multi-day festival — the ribbon's worst case.
function bigPlan(nCues) {
  const cues = [];
  for (let i = 0; i < nCues; i += 1) {
    const hh = String(Math.floor((i * 3) / 60) % 24).padStart(2, '0');
    const mm = String((i * 3) % 60).padStart(2, '0');
    cues.push({
      id: `c_${i}`,
      label: `Cue ${i}`,
      enabled: true,
      catchUp: true,
      trigger: { type: 'clock', at: `${hh}:${mm}` },
      action: { type: 'look', look: 'ambient' },
      kind: 'ambient',
      days: 'all',
    });
  }
  return validateShowPlan({
    schemaVersion: 2,
    name: 'perf_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    festival: { startDate: '2026-08-25', days: 8 },
    autopilot: { enabled: true, playlist: 'default', delay_s: 45, shuffle: true, target: { channel: 'deck', id: null }, mood: true },
    phases: {},
    looks: { ambient: { playlist: 'ambient' } },
    defaultCue: { label: 'Ambient', action: { type: 'look', look: 'ambient' } },
    cues,
  });
}

test('J1: buildOverview on the 512-cue cap completes FAR under the pre-fix freeze', () => {
  const plan = bigPlan(500);
  const t0 = performance.now();
  const ov = buildOverview(plan, Date.parse('2026-08-26T12:00:00-07:00'));
  const ms = performance.now() - t0;
  // Pre-fix this was ~296 s. The budget here is a generous 15 s so a slow CI box
  // never flakes, while still proving the O(days×cues²) Intl-construction freeze
  // is gone (a ~20× floor over the measured pre-fix number).
  assert.ok(ms < 15000, `overview took ${ms.toFixed(0)} ms — budget 15000 ms (pre-fix ~296 s)`);
  assert.equal(ov.days.length, 8, 'all festival days rendered');
  assert.ok(ov.days[0].segments.length > 0, 'the ribbon has segments');
});

test('J1: the injected-dayTimes ribbon AGREES with an independent resolve (correctness)', () => {
  const plan = bigPlan(64);
  const dateKey = '2026-08-26';
  const segments = buildDaySegments({ plan, dateKey });
  assert.ok(segments.length > 0);
  // Pick a sample instant inside the day and resolve it WITHOUT the injected
  // dayTimes; the ribbon segment covering that instant must name the same owner.
  const atMs = dateClockToEpochMs(dateKey, '13:37', TZ);
  const direct = resolveDeckStateAt({ plan, atMs }); // no dayTimes injection
  const seg = segments.find((s) => s.fromMs <= atMs && atMs < s.toMs);
  assert.ok(seg, 'a ribbon segment must cover the sample instant');
  assert.equal(seg.owner.kind, direct.owner.kind, 'owner kind must match the direct resolve');
  assert.equal(seg.owner.cueId, direct.owner.cueId, 'owner cueId must match the direct resolve');
  assert.equal(seg.playlist, direct.playlist, 'playlist must match the direct resolve');
});
