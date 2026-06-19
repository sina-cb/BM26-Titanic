import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSunEvents, formatLocal } from '../lib/timeline/sun.js';

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

test('bad input throws', () => {
  assert.throws(() => computeSunEvents({ lat: 200, lon: 0, date: new Date() }), /lat/);
  assert.throws(() => computeSunEvents({ lat: 0, lon: 999, date: new Date() }), /lon/);
  assert.throws(() => computeSunEvents({ lat: 0, lon: 0, date: 'nope' }), /date/);
  assert.throws(() => formatLocal('nope', TZ), /date/);
});
