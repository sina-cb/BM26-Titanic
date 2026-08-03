/*
 * timeline_state_validation.test.js — regression for J2 / L3
 * (reports _116 / _113 / _115, DOUBLE-CONFIRMED): a corrupt timeline_state.yaml
 * silently kills the timeline while /timeline/state reports mode:armed,
 * lastError:null.
 *
 * Before the fix, loadTimelineState validated ONLY the 5 party fields, so a bad
 * `firedToday`, a bad `moodArmed`, or a top-level SCALAR document loaded CLEAN
 * and then threw on EVERY tick (`Cannot create property … on string 'yes'`) —
 * the whole timeline drove nothing all night while the engine looked healthy.
 * Now the ENTIRE persisted shape is validated at load and a corrupt file THROWS
 * ONCE, loudly, naming the file + field — exactly like a broken YAML, and the
 * same contract the party-field guard already had (party_config.test.js).
 *
 * Flipped from the red-team repro into a GREEN regression. Pure — no engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import {
  loadTimelineState, saveTimelineState, defaultTimelineState,
} from '../../lib/timeline/timeline_state.js';

function freshStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-state-valid-'));
  return dir;
}

/** Write raw YAML text as the state file (bypasses saveTimelineState's dump). */
function writeRaw(dir, text) {
  fs.writeFileSync(path.join(dir, 'timeline_state.yaml'), text, 'utf8');
}

test('a valid persisted state round-trips through load', () => {
  const dir = freshStateDir();
  saveTimelineState(defaultTimelineState(), dir);
  const s = loadTimelineState(dir);
  assert.equal(s.mode, 'armed');
  assert.equal(typeof s.firedToday, 'object');
});

test('a MISSING file loads the clean default (the only non-error path)', () => {
  const dir = freshStateDir();
  const s = loadTimelineState(dir);
  assert.equal(s.mode, 'armed');
  assert.equal(s.activePlan, null);
});

test('J2: firedToday as a SCALAR is rejected at load, naming file + field', () => {
  const dir = freshStateDir();
  saveTimelineState(defaultTimelineState(), dir);
  // The exact _113 J2 example: a scalar where a map is required.
  writeRaw(dir, yaml.dump({ ...defaultTimelineState(), firedToday: 'yes' }));
  assert.throws(() => loadTimelineState(dir), (err) => {
    assert.match(err.message, /timeline state invalid/);
    assert.match(err.message, /timeline_state\.yaml/, 'must name the FILE');
    assert.match(err.message, /firedToday/, 'must name the FIELD');
    return true;
  });
});

test('J2: moodArmed as a NUMBER is rejected at load, naming the field', () => {
  const dir = freshStateDir();
  writeRaw(dir, yaml.dump({ ...defaultTimelineState(), moodArmed: 5 }));
  assert.throws(() => loadTimelineState(dir), (err) => {
    assert.match(err.message, /timeline state invalid/);
    assert.match(err.message, /moodArmed/);
    return true;
  });
});

test('J2: a top-level SCALAR document is rejected (partyConfigOf treated it as {})', () => {
  const dir = freshStateDir();
  writeRaw(dir, 'yes\n'); // a bare scalar YAML document
  assert.throws(() => loadTimelineState(dir), (err) => {
    assert.match(err.message, /timeline state invalid/);
    assert.match(err.message, /mapping/);
    return true;
  });
});

test('J2: a bad moodSince (string) and a bad mode enum are rejected', () => {
  const dir1 = freshStateDir();
  writeRaw(dir1, yaml.dump({ ...defaultTimelineState(), moodSince: 'soon' }));
  assert.throws(() => loadTimelineState(dir1), /moodSince must be a finite number/);

  const dir2 = freshStateDir();
  writeRaw(dir2, yaml.dump({ ...defaultTimelineState(), mode: 'banana' }));
  assert.throws(() => loadTimelineState(dir2), /mode must be 'armed' or 'overridden'/);
});

test('J2: a bad map VALUE (moodLastFire[id] non-numeric) is rejected', () => {
  const dir = freshStateDir();
  writeRaw(dir, yaml.dump({ ...defaultTimelineState(), moodLastFire: { c_x: 'later' } }));
  assert.throws(() => loadTimelineState(dir), (err) => {
    assert.match(err.message, /moodLastFire\['c_x'\]/);
    return true;
  });
});

test('an older/partial state file still migrates (only PRESENT fields are checked)', () => {
  const dir = freshStateDir();
  // A minimal pre-feature file: no firedToday/moodArmed/party fields at all.
  writeRaw(dir, yaml.dump({ activePlan: 'playa_default', mode: 'armed' }));
  const s = loadTimelineState(dir);
  assert.equal(s.activePlan, 'playa_default');
});
