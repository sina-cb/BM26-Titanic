import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSunEvents, formatLocal } from '../../lib/timeline/sun.js';

const BRC = { lat: 40.7864, lon: -119.2065 };
const TZ = 'America/Los_Angeles';

// Convert "HH:MM" → minutes-of-day for window asserts.
function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

test('BRC sunset ~19:35-19:50 local on 2026-08-30', () => {
  const date = new Date('2026-08-30T12:00:00Z');
  const ev = computeSunEvents({ ...BRC, date });
  const sunset = formatLocal(ev.sunset, TZ);
  const min = minutesOfDay(sunset);
  // ±15 min window around ~19:42.
  assert.ok(min >= minutesOfDay('19:27') && min <= minutesOfDay('19:57'),
    `sunset ${sunset} out of expected window`);
});

test('BRC sunrise ~06:25-06:40 local on 2026-08-30', () => {
  const date = new Date('2026-08-30T12:00:00Z');
  const ev = computeSunEvents({ ...BRC, date });
  const sunrise = formatLocal(ev.sunrise, TZ);
  const min = minutesOfDay(sunrise);
  assert.ok(min >= minutesOfDay('06:18') && min <= minutesOfDay('06:48'),
    `sunrise ${sunrise} out of expected window`);
});

test('civilDusk is after sunset; goldenHourStart is before sunset', () => {
  const date = new Date('2026-08-30T12:00:00Z');
  const ev = computeSunEvents({ ...BRC, date });
  assert.ok(ev.civilDusk.valueOf() > ev.sunset.valueOf(), 'civilDusk should follow sunset');
  assert.ok(ev.goldenHourStart.valueOf() < ev.sunset.valueOf(), 'goldenHourStart should precede sunset');
});

test('all event fields are present and ordered sensibly', () => {
  const date = new Date('2026-08-30T12:00:00Z');
  const ev = computeSunEvents({ ...BRC, date });
  for (const k of ['sunrise', 'sunset', 'solarNoon', 'civilDawn', 'civilDusk',
    'nauticalDawn', 'nauticalDusk', 'goldenHourEnd', 'goldenHourStart']) {
    assert.ok(ev[k] instanceof Date, `${k} should be a Date at BRC`);
  }
  assert.ok(ev.sunrise.valueOf() < ev.solarNoon.valueOf());
  assert.ok(ev.solarNoon.valueOf() < ev.sunset.valueOf());
  assert.ok(ev.civilDawn.valueOf() < ev.sunrise.valueOf());
});

test('polar night returns null for sun events but not solarNoon', () => {
  // High arctic in deep winter → sun never rises.
  const ev = computeSunEvents({ lat: 78, lon: 15, date: new Date('2026-12-21T12:00:00Z') });
  assert.equal(ev.sunrise, null);
  assert.equal(ev.sunset, null);
  assert.ok(ev.solarNoon instanceof Date, 'solarNoon is always defined');
});

test('tz-anchored: any instant on one BRC local day yields identical events', () => {
  // Four instants across the SAME BRC local day (2026-08-30 PDT, UTC-7):
  //   00:30 PDT → 07:30 UTC, 06:00 PDT → 13:00 UTC,
  //   12:00 PDT → 19:00 UTC, 23:30 PDT → 06:30 UTC next day.
  const instants = [
    new Date('2026-08-30T07:30:00Z'),
    new Date('2026-08-30T13:00:00Z'),
    new Date('2026-08-30T19:00:00Z'),
    new Date('2026-08-31T06:30:00Z'),
  ];
  const events = instants.map((date) => computeSunEvents({ ...BRC, date, tz: TZ }));
  const ref = events[0];
  for (const ev of events.slice(1)) {
    assert.equal(ev.sunrise.valueOf(), ref.sunrise.valueOf(), 'sunrise must match across the local day');
    assert.equal(ev.sunset.valueOf(), ref.sunset.valueOf(), 'sunset must match across the local day');
  }
});

test('tz-anchored: 00:30 PDT returns Aug 30 events (not Aug 29)', () => {
  // 2026-08-30T07:30:00Z == 00:30 PDT on Aug 30. The legacy (no-tz) path
  // derives the solar day from the raw UTC instant and returns Aug 29's
  // sunrise; the tz-anchored path must return Aug 30's.
  const date = new Date('2026-08-30T07:30:00Z');
  const tzEv = computeSunEvents({ ...BRC, date, tz: TZ });
  // The Aug 30 sunrise computed from local noon.
  const ref = computeSunEvents({ ...BRC, date: new Date('2026-08-30T19:00:00Z'), tz: TZ });
  assert.equal(tzEv.sunrise.valueOf(), ref.sunrise.valueOf());
  // Its calendar day in BRC tz must be Aug 30.
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tzEv.sunrise);
  assert.equal(dayKey, '2026-08-30', `expected Aug 30 sunrise, got ${dayKey}`);
});

test('bad input throws', () => {
  assert.throws(() => computeSunEvents({ lat: 200, lon: 0, date: new Date() }), /lat/);
  assert.throws(() => computeSunEvents({ lat: 0, lon: 999, date: new Date() }), /lon/);
  assert.throws(() => computeSunEvents({ lat: 0, lon: 0, date: 'nope' }), /date/);
  assert.throws(() => formatLocal('nope', TZ), /date/);
});
