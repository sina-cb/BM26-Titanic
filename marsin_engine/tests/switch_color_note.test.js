/**
 * switch_color_note.test.js — regression test for the note→colour fix in
 * audio/signals/switch_signals.js.
 *
 * BUG (operator report: "the note colour change signals weren't working"):
 * the old code advanced `_prevPc` (and `_lastNoteChangeMs`) the MOMENT the
 * pitch class differed, even when the colour fire was then blocked by
 * `colorMinDwellMs`. So any note change that landed inside the colour dwell
 * window was silently CONSUMED with no recolour — the rig changed colour at
 * roughly half the real note rate and felt disconnected from the melody.
 *
 * FIX: latch a PENDING note intent and only commit `_prevPc` /
 * `_lastNoteChangeMs` when the colour actually fires, so a blocked change
 * stays pending and fires on the next eligible hop.
 *
 * These tests drive SwitchSignals directly (a relative clock, so the startup
 * guard behaves as intended) with everything BUT the note held constant, so
 * the only thing that can fire `switchColor` is a note change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwitchSignals } from '../audio/signals/switch_signals.js';

const DT = 1 / 86.13;

// Step the module from `startMs` to `endMs`, holding a constant pitch class,
// counting switchColor fires. Returns { fires, firedMs:[...] }.
function drive(sw, startMs, endMs, pitchClass) {
  let now = startMs;
  const fires = [];
  while (now <= endMs) {
    const r = sw.update({
      nowMs: now, dt: DT,
      dropPulse: 0, energyRatio: 0.5, buildScore: 0, slowZone: 0,
      structure: 1, beatEdge: false, bpmLocked: false,
      pitchClass, noteStable: true,
    });
    if (r.switchColor) fires.push(Math.round(now));
    now += DT * 1000;
  }
  return { fires: fires.length, firedMs: fires };
}

test('first stable note past the startup guard fires a colour', () => {
  const sw = new SwitchSignals();
  // startupGuardMs default 2000 (relative clock here) — begin at 2500.
  const r = drive(sw, 2500, 2600, 0);
  assert.ok(r.fires >= 1, 'the first stable note should recolour once');
});

test('a note change blocked by colorMinDwell is NOT lost — it fires after the dwell', () => {
  const sw = new SwitchSignals();
  // 1) first note (pc 0) at t=2500 → fires a colour, stamps _lastColorMs.
  const a = drive(sw, 2500, 2520, 0);
  assert.ok(a.fires >= 1, 'first colour should fire');
  // 2) change to pc 3 only ~300 ms later — inside colorMinDwellMs (2500): the
  //    colour is blocked on these hops, so the change must be LATCHED pending.
  const b = drive(sw, 2820, 2900, 3);
  assert.equal(b.fires, 0, 'colour is correctly blocked inside the dwell window');
  // 3) hold pc 3 and run past the dwell — the PENDING change must now fire.
  //    (Old buggy behaviour: _prevPc was already advanced to 3 at step 2 with
  //    no fire, so this window produced NOTHING and the note never coloured.)
  const c = drive(sw, 2900, 6000, 3);
  assert.ok(c.fires >= 1,
    'the pending note change must recolour once the colour dwell elapses (the fix)');
});

test('a note that flips back to the last-coloured class before firing is dropped (no recolour to same hue)', () => {
  const sw = new SwitchSignals();
  drive(sw, 2500, 2520, 0);            // colour committed for pc 0
  drive(sw, 2820, 2900, 3);            // pc 3 latched pending (blocked by dwell)
  // pc returns to 0 (the last-coloured class) before the dwell elapses → the
  // pending intent is stale and must be dropped (don't recolour to the same hue).
  const back = drive(sw, 2900, 6000, 0);
  assert.equal(back.fires, 0, 'returning to the last-coloured note must not recolour');
});

test('a steady held note does not strobe the colour', () => {
  const sw = new SwitchSignals();
  drive(sw, 2500, 2520, 5);            // one fire for the first note
  const steady = drive(sw, 2520, 9000, 5);   // ~6.5 s holding the SAME note
  assert.equal(steady.fires, 0, 'a held note must not keep recolouring');
});
