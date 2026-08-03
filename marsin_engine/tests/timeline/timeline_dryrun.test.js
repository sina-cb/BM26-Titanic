/*
 * timeline_dryrun.test.js — the DRY-RUN HARNESS's own plumbing
 * (tools/timeline_dryrun.mjs, report 20260725_93).
 *
 * Scope is deliberately the harness, NOT the timeline: the show logic is already
 * covered by the other 13 files in this directory, and the harness drives that
 * code unmodified. What is tested here is everything that could make a dry run
 * LIE — clock/span resolution, the mood-script compiler, the event-ring drain,
 * and the summary arithmetic — plus one end-to-end run proving the harness
 * really drives the real TimelineService offline.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/timeline_dryrun.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MOOD_SCRIPTS, parseArgv, shiftDayKey, dayKeyDelta, resolveSpan, stepInstants,
  parseMoodDoc, compileMoodTrack, makeRng, newSummary, accumulate, renderSummary,
  drainRing, suppressionReason, runDryRun,
} from '../../tools/timeline_dryrun.mjs';
import { dateClockToEpochMs } from '../../lib/timeline/triggers.js';

// The harness proxies the service's chatter through console; a bare run would
// otherwise trip the Windows node:test worker-IPC flake (report 20260725_12 §7).
const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

const TZ = 'America/Los_Angeles';
const MIN = 60000;

// ── day-key arithmetic ───────────────────────────────────────────────────────

test('shiftDayKey / dayKeyDelta cross month and year boundaries', () => {
  assert.equal(shiftDayKey('2026-08-30', 7), '2026-09-06');
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31');
  assert.equal(dayKeyDelta('2026-08-30', '2026-09-06'), 7);
  assert.equal(dayKeyDelta('2026-09-06', '2026-08-30'), -7);
  assert.equal(dayKeyDelta('2026-09-01', '2026-09-01'), 0);
  assert.throws(() => shiftDayKey('not-a-date', 1), /YYYY-MM-DD/);
});

// ── argv parsing: every bad input must fail LOUD (codex P0) ──────────────────

test('parseArgv defaults describe a one-day titanic run', () => {
  const o = parseArgv([]);
  assert.equal(o.scene, 'titanic');
  assert.equal(o.plan, 'playa_default');
  assert.equal(o.days, 1);
  assert.equal(o.from, '12:00');
  assert.equal(o.stepMin, 1);
  assert.equal(o.mood, 'quiet');
  assert.equal(o.fixture, false);
  assert.equal(o.allowDormant, false);
});

test('parseArgv reads flags and rejects every bad one', () => {
  const o = parseArgv(['--fixture', '--date', '2026-09-01', '--days', '3', '--step', '5', '--events-only']);
  assert.equal(o.fixture, true);
  assert.equal(o.date, '2026-09-01');
  assert.equal(o.days, 3);
  assert.equal(o.stepMin, 5);
  assert.equal(o.eventsOnly, true);

  assert.throws(() => parseArgv(['--nope']), /unknown flag "--nope"/);
  assert.throws(() => parseArgv(['playa_default']), /unexpected positional/);
  assert.throws(() => parseArgv(['--date']), /requires a value/);
  assert.throws(() => parseArgv(['--date', '09-01-2026']), /--date must be YYYY-MM-DD/);
  assert.throws(() => parseArgv(['--days', '0']), /--days must be an integer/);
  assert.throws(() => parseArgv(['--step', '90']), /--step must be an integer 1\.\.60/);
  assert.throws(() => parseArgv(['--from', '25:00']), /--from must be HH:MM/);
  assert.throws(() => parseArgv(['--mood', 'disco']), /unknown mood script "disco"/);
  assert.throws(() => parseArgv(['--fixture', '--plan', 'x']), /mutually exclusive/);
  assert.throws(() => parseArgv(['--mood', 'quiet', '--mood-file', 'x.yaml']), /mutually exclusive/);
});

// ── clock injection: the span is playa-local and independent of the real date ─

test('resolveSpan anchors on the requested playa date, not today', () => {
  const span = resolveSpan({ dateKey: '2026-09-01', days: 1, tz: TZ, fromClock: '12:00', toClock: null });
  assert.equal(span.startMs, dateClockToEpochMs('2026-09-01', '12:00', TZ));
  assert.equal(span.endMs, dateClockToEpochMs('2026-09-02', '12:00', TZ));
  assert.equal(span.endMs - span.startMs, 24 * 60 * MIN);
  assert.deepEqual(span.dayKeys, ['2026-09-01']);
});

test('resolveSpan multi-day lists every day and ends day-anchored (DST-proof)', () => {
  // 2026-11-01 is the US DST fall-back: a naive start + N×24 h would land at
  // 11:00, not 12:00. The day-anchored end must still read 12:00 local.
  const span = resolveSpan({ dateKey: '2026-10-31', days: 3, tz: TZ, fromClock: '12:00', toClock: null });
  assert.deepEqual(span.dayKeys, ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(span.endMs, dateClockToEpochMs('2026-11-03', '12:00', TZ));
  assert.equal(span.endMs - span.startMs, (72 + 1) * 60 * MIN, 'the span must absorb the extra DST hour');
});

test('resolveSpan honours --to and refuses an empty span', () => {
  const span = resolveSpan({ dateKey: '2026-09-01', days: 1, tz: TZ, fromClock: '19:00', toClock: '21:30' });
  assert.equal(span.endMs - span.startMs, 150 * MIN);
  assert.throws(
    () => resolveSpan({ dateKey: '2026-09-01', days: 1, tz: TZ, fromClock: '19:00', toClock: '18:00' }),
    /empty span/,
  );
});

test('stepInstants walks [start, end) at the requested step', () => {
  const start = dateClockToEpochMs('2026-09-01', '12:00', TZ);
  const instants = stepInstants({ startMs: start, endMs: start + 10 * MIN, stepMs: 3 * MIN });
  assert.deepEqual(instants, [start, start + 3 * MIN, start + 6 * MIN, start + 9 * MIN]);
  assert.throws(() => stepInstants({ startMs: start, endMs: start + MIN, stepMs: 0 }), /stepMs must be > 0/);
});

// ── mood scripting ───────────────────────────────────────────────────────────

test('every built-in mood script validates', () => {
  for (const [name, script] of Object.entries(MOOD_SCRIPTS)) {
    const parsed = parseMoodDoc(script, name);
    assert.equal(typeof parsed.label, 'string');
    assert.ok(Array.isArray(parsed.windows));
  }
});

test('parseMoodDoc rejects malformed scripts loudly', () => {
  assert.throws(() => parseMoodDoc(null, 'x'), /must be a mapping/);
  assert.throws(() => parseMoodDoc({}, 'x'), /"windows" must be an array/);
  assert.throws(() => parseMoodDoc({ windows: [{ from: '9:00', to: '10:00' }] }, 'x'), /"from" must be HH:MM/);
  assert.throws(() => parseMoodDoc({ windows: [{ from: '09:00', to: '99:00' }] }, 'x'), /"to" must be HH:MM/);
  assert.throws(() => parseMoodDoc({ windows: [{ from: '09:00', to: '10:00', days: ['a'] }] }, 'x'), /"days" must be/);
});

test('the quiet script is never party', () => {
  const at = compileMoodTrack({ windows: [], tz: TZ, startDayKey: '2026-09-01' });
  for (const clock of ['00:00', '06:00', '15:00', '23:59']) {
    assert.equal(at(dateClockToEpochMs('2026-09-01', clock, TZ)), 0, `party at ${clock}`);
  }
});

test('loud_stereo_1500 is party exactly inside its window, every simulated day', () => {
  const script = parseMoodDoc(MOOD_SCRIPTS.loud_stereo_1500, 'loud_stereo_1500');
  const at = compileMoodTrack({ windows: script.windows, tz: TZ, startDayKey: '2026-09-01' });
  assert.equal(at(dateClockToEpochMs('2026-09-01', '14:59', TZ)), 0);
  assert.equal(at(dateClockToEpochMs('2026-09-01', '15:00', TZ)), 1);
  assert.equal(at(dateClockToEpochMs('2026-09-01', '15:39', TZ)), 1);
  assert.equal(at(dateClockToEpochMs('2026-09-01', '15:40', TZ)), 0, 'the window is half-open');
  assert.equal(at(dateClockToEpochMs('2026-09-03', '15:20', TZ)), 1, 'an undated window repeats daily');
});

test('a midnight-wrapping window covers the small hours of the NEXT day', () => {
  const at = compileMoodTrack({
    windows: [{ from: '21:00', to: '05:00', days: null }], tz: TZ, startDayKey: '2026-09-01',
  });
  assert.equal(at(dateClockToEpochMs('2026-09-01', '20:59', TZ)), 0);
  assert.equal(at(dateClockToEpochMs('2026-09-01', '21:00', TZ)), 1);
  assert.equal(at(dateClockToEpochMs('2026-09-01', '23:59', TZ)), 1);
  assert.equal(at(dateClockToEpochMs('2026-09-02', '04:59', TZ)), 1, 'the wrap must reach past midnight');
  assert.equal(at(dateClockToEpochMs('2026-09-02', '05:00', TZ)), 0);
});

test('a windows "days" filter restricts to those simulated day indices', () => {
  const at = compileMoodTrack({
    windows: [{ from: '22:00', to: '23:00', days: [1] }], tz: TZ, startDayKey: '2026-09-01',
  });
  assert.equal(at(dateClockToEpochMs('2026-09-01', '22:30', TZ)), 0, 'day 0 is excluded');
  assert.equal(at(dateClockToEpochMs('2026-09-02', '22:30', TZ)), 1, 'day 1 is the one selected');
  assert.equal(at(dateClockToEpochMs('2026-09-03', '22:30', TZ)), 0, 'day 2 is excluded');
});

test('the seeded PRNG makes a shuffled run reproducible', () => {
  const a = makeRng(7);
  const b = makeRng(7);
  const c = makeRng(8);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `PRNG out of range: ${v}`);
});

// ── event-ring draining (the ring is capped and SHIFTS) ──────────────────────

test('drainRing returns only new entries, and survives the ring shifting past its cap', () => {
  const ring = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const first = drainRing(ring, null);
  assert.deepEqual(first.fresh.map((e) => e.id), [1, 2, 3]);
  assert.equal(first.last, ring[2]);

  ring.push({ id: 4 }, { id: 5 });
  const second = drainRing(ring, first.last);
  assert.deepEqual(second.fresh.map((e) => e.id), [4, 5]);

  const third = drainRing(ring, second.last);
  assert.deepEqual(third.fresh, [], 'a quiet tick drains nothing');

  // The cap shifted the anchor out of the ring entirely.
  const shifted = [{ id: 9 }, { id: 10 }];
  const fourth = drainRing(shifted, third.last);
  assert.deepEqual(fourth.fresh.map((e) => e.id), [9, 10], 'a lost anchor must not swallow events');
});

test('suppressionReason names the arbiter rule that dropped the fire', () => {
  assert.match(
    suppressionReason({ controller: 'program' }, { cueKind: 'mood', activeProgramCueId: 'c_visibility_on', moodAllowed: true }),
    /program owns the deck \(c_visibility_on\)/,
  );
  assert.match(
    suppressionReason({ controller: 'manual' }, { cueKind: 'ambient', activeProgramCueId: null, moodAllowed: true }),
    /operator owns control/,
  );
  assert.match(
    suppressionReason({ controller: 'autopilot' }, { cueKind: 'mood', activeProgramCueId: null, moodAllowed: false }),
    /disabled at plan level/,
  );
});

// ── summary arithmetic ───────────────────────────────────────────────────────

test('accumulate is step-weighted and buckets by playlist / owner / controller', () => {
  const s = newSummary();
  const sample = (over) => ({
    dormant: false, playlist: 'ambient', owner: 'defaultCue (Ambient program)',
    controller: 'autopilot', palette: 'deep_sea', partyState: 'armed', ...over,
  });
  accumulate(s, sample(), 5);
  accumulate(s, sample(), 5);
  accumulate(s, sample({ playlist: 'party_high', owner: 'cue c_mood_to_party', partyState: 'in_session' }), 12);

  assert.equal(s.totalMin, 22);
  assert.equal(s.playlistMin.ambient, 10);
  assert.equal(s.playlistMin.party_high, 12);
  assert.equal(s.ownerMin['cue c_mood_to_party'], 12);
  assert.equal(s.controllerMin.autopilot, 22);
  assert.equal(s.paletteMin.deep_sea, 22);
  assert.equal(s.partyStateMin.in_session, 12);
  assert.equal(s.dormantMin, 0);
});

test('accumulate books DORMANT minutes separately and never as deck time', () => {
  const s = newSummary();
  accumulate(s, { dormant: true, playlist: null, owner: 'dormant', controller: 'manual', palette: null, partyState: 'no_plan' }, 30);
  assert.equal(s.totalMin, 30);
  assert.equal(s.dormantMin, 30);
  assert.deepEqual(s.playlistMin, {});
  assert.deepEqual(s.ownerMin, {});
});

test('accumulate books a deck with nothing loaded as "(none)", not as a silent gap', () => {
  const s = newSummary();
  accumulate(s, { dormant: false, playlist: null, owner: 'autopilot baseline', controller: 'autopilot', palette: null, partyState: 'armed' }, 4);
  assert.equal(s.playlistMin['(none)'], 4);
  assert.equal(s.paletteMin.unset, 4);
});

test('renderSummary reports the totals it was given', () => {
  const s = newSummary();
  accumulate(s, { dormant: false, playlist: 'default', owner: 'cue c_party_start', controller: 'autopilot', palette: 'bass_drop', partyState: 'armed' }, 480);
  accumulate(s, { dormant: false, playlist: 'ambient', owner: 'defaultCue (Ambient program)', controller: 'autopilot', palette: 'deep_sea', partyState: 'armed' }, 120);
  s.fires.c_party_start = 1;
  s.suppressed.c_mood_to_party = 3;
  s.suppressionReasons['a program owns the deck (c_visibility_on)'] = 3;
  s.partySessionsStarted = 2;
  s.partySessionEnds['party-window-elapsed'] = 2;
  s.playlistHealth.default = { entries: 72, missing: 45, usable: 27, loads: 6 };

  const text = renderSummary(s).join('\n');
  assert.match(text, / 8h00m\s+80%\s+default/);
  assert.match(text, / 2h00m\s+20%\s+ambient/);
  assert.match(text, /8h00m\s+80%\s+cue c_party_start/);
  assert.match(text, /1 ×\s+c_party_start/);
  assert.match(text, /3 ×\s+c_mood_to_party/);
  assert.match(text, /started: 2/);
  assert.match(text, /27\/72\s+usable\s+loaded 6×\s+⚠ 45 UNREACHABLE/);
});

// ── end to end: the harness really drives the real service, offline ──────────

test('a fixture dry run drives the REAL TimelineService and reports the night', async () => {
  const opts = parseArgv([
    '--fixture', '--date', '2026-09-01', '--from', '12:00', '--days', '1',
    '--step', '10', '--mood', 'loud_stereo_1500', '--events-only',
  ]);
  const result = await runDryRun(opts, null);

  // The clock is the SIMULATED date, never today's.
  assert.equal(result.summary.totalMin, 24 * 60);
  assert.equal(result.summary.dormantMin, 0, 'the fixture has no festival block — it is never dormant');
  assert.equal(result.meta.planName, 'dryrun_bench');
  assert.equal(result.meta.tz, TZ);

  // The real cues fired, through the real arbiter.
  assert.ok(result.summary.fires.c_visibility_on >= 1, 'the golden-hour program never fired');
  assert.ok(result.summary.fires.c_party_start >= 1, 'the party_night phase cue never fired');
  assert.ok(result.summary.fires.c_mood_to_party >= 1, 'the scripted 15:00 music never triggered a session');
  assert.ok(result.summary.partySessionsStarted >= 1);

  // The real PlaylistManager resolved the real playlists, missing entries and all.
  assert.ok(result.summary.playlistHealth.default, 'the baseline playlist was never resolved');
  assert.equal(
    result.summary.playlistHealth.default.entries,
    result.summary.playlistHealth.default.usable + result.summary.playlistHealth.default.missing,
  );
  assert.ok(result.summary.playlistHealth.party_high, 'the party playlist was never resolved');

  // Deck minutes are conserved: every non-dormant minute is booked to a playlist.
  const booked = Object.values(result.summary.playlistMin).reduce((a, b) => a + b, 0);
  assert.equal(booked, result.summary.totalMin - result.summary.dormantMin);

  // Scratch lives under ~/tmp and the operator's scene dir was never written.
  assert.ok(result.meta.runDir.startsWith(path.join(os.homedir(), 'tmp')), result.meta.runDir);
  assert.ok(fs.existsSync(path.join(result.meta.runDir, 'state', 'timeline_state.yaml')));
});

test('an out-of-window date on a festival plan FAILS LOUD instead of printing a flat line', async () => {
  const opts = parseArgv(['--date', '2026-01-15', '--step', '60']);
  await assert.rejects(() => runDryRun(opts, null), /is DORMANT on 2026-01-15/);
});

test('--allow-dormant runs the dormant plan and books the time as dormant', async () => {
  const opts = parseArgv(['--date', '2026-01-15', '--from', '20:00', '--to', '22:00', '--step', '30', '--allow-dormant', '--events-only']);
  const result = await runDryRun(opts, null);
  assert.equal(result.summary.totalMin, 120);
  assert.equal(result.summary.dormantMin, 120, 'every minute outside the festival window is dormant');
  assert.deepEqual(result.summary.fires, {}, 'a dormant plan must fire nothing');
});
