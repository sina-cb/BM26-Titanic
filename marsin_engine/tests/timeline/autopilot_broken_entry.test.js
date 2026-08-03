/*
 * autopilot_broken_entry.test.js — regression for I3 (reports _116 / _112):
 * a playlist entry that exists but won't compile permanently wedges the
 * sequential autopilot, and duplicate entry ids wedge the deck at cursor 0.
 *
 * The pure picker now excludes `_broken` entries (the caller flags an entry that
 * failed to compile so the autopilot advances PAST it instead of re-selecting it
 * forever) AND de-dupes duplicate ids (keeping the first), so neither can pin
 * the sequential walk. This pins the PURE picker; the api_server-side flagging +
 * the deck daemon skip are exercised by the engine e2e.
 *
 * Flipped from the red-team repro into a GREEN regression. Pure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pickNextAutoCycleEntry } from '../../lib/autopilot_pick.js';

const seq = { shuffle: false };

test('I3: sequential SKIPS a _broken entry instead of re-selecting it forever', () => {
  const pl = { entries: [{ id: 'a' }, { id: 'b', _broken: true }, { id: 'c' }] };
  // From 'a', the next usable is 'c' — 'b' (broken) is stepped over.
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'a').id, 'c');
  // From the broken entry itself the walk still advances (never traps on it).
  assert.notEqual(pickNextAutoCycleEntry(pl, seq, 'b').id, 'b');
});

test('I3: a wedge clears once the deck has advanced past the broken entry', () => {
  // b is broken; walking a→c→a→c cycles the two good entries, never sticking.
  const pl = { entries: [{ id: 'a' }, { id: 'b', _broken: true }, { id: 'c' }] };
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'c').id, 'a');
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'a').id, 'c');
});

test('I3 silent-twin: DUPLICATE entry ids no longer pin the walk at cursor 0', () => {
  // Two entries share id 'a'; de-dup keeps the first, so a→b→a cycles.
  const pl = { entries: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] };
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'a').id, 'b');
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'b').id, 'a');
});

test('I3: all-broken playlist yields null (nothing usable), never a broken entry', () => {
  const pl = { entries: [{ id: 'a', _broken: true }, { id: 'b', _broken: true }] };
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'a'), null);
});

test('I3: shuffle also excludes _broken and duplicate entries', () => {
  const pl = { entries: [{ id: 'a' }, { id: 'a' }, { id: 'b', _broken: true }, { id: 'c' }] };
  // Only 'a' (first) and 'c' are usable; from 'a', shuffle must pick 'c'.
  const picked = pickNextAutoCycleEntry(pl, { shuffle: true }, 'a');
  assert.equal(picked.id, 'c');
});

test('I3: a well-formed playlist behaves EXACTLY as before (no _broken, no dups)', () => {
  const pl = { entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'a').id, 'b');
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'b').id, 'c');
  assert.equal(pickNextAutoCycleEntry(pl, seq, 'c').id, 'a'); // wraps
  // _missing is still excluded, as before.
  const withMissing = { entries: [{ id: 'a' }, { id: 'b', _missing: true }, { id: 'c' }] };
  assert.equal(pickNextAutoCycleEntry(withMissing, seq, 'a').id, 'c');
});
