// Unit tests for SnapshotManager (F-A: named mixer snapshots / look recall).
//
// Covers: save/list/load/delete round-trip, atomic-write residue, missing
// snapshot ⇒ null (caller 404s), malformed YAML ⇒ SnapshotLoadError (caller
// 400s, never a silent empty look), structural validation, and name safety.
//
// Recall's channel add/remove-to-match logic is an api_server concern (it
// reuses buildChannelFromSaved) and is exercised end-to-end in the HIL test;
// here we pin the persistence + fail-loud contract of the manager itself.
//
// Run:  cd marsin_engine && node --test tests/snapshot_manager.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { StateManager } from '../../lib/state_manager.js';
import { SnapshotManager, SnapshotLoadError } from '../../lib/snapshot_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot_mgr_'));
}

function makeManager() {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const snap = new SnapshotManager(dir, sm);
  return { dir, snap };
}

function sampleLook() {
  return {
    master: 0.8,
    deck: {
      id: 'ch_base', name: 'Base', pattern: 'p_deck', mode: 'blend_screen',
      fader: 1, enabled: true, locked: false, faderLocked: false,
      localControls: {}, playlist: null,
      viewSelection: { type: 'all', target: null, invert: false },
      faderMax: 1.0, color: null,
    },
    channels: [
      {
        id: 'ch_o1', name: 'Layer 1', pattern: 'p1', mode: 'blend_screen',
        fader: 0.5, enabled: true, locked: false, faderLocked: false,
        localControls: {}, playlist: null,
        viewSelection: { type: 'all', target: null, invert: false },
        faderMax: 0.7, color: '#ff0000',
      },
    ],
  };
}

test('save then load round-trips a full look', () => {
  const { snap } = makeManager();
  snap.save('night_one', sampleLook());
  const loaded = snap.load('night_one');
  assert.equal(loaded.name, 'night_one');
  assert.equal(loaded.master, 0.8);
  assert.equal(loaded.deck.pattern, 'p_deck');
  assert.equal(loaded.channels.length, 1);
  assert.equal(loaded.channels[0].faderMax, 0.7);
  assert.equal(loaded.channels[0].color, '#ff0000');
  assert.ok(loaded.savedAt, 'savedAt timestamp stamped');
});

test('save then load round-trips the mixGroups registry (gang faders)', () => {
  const { snap } = makeManager();
  const look = sampleLook();
  // A channel that belongs to a group + the group registry the capture carries.
  look.channels[0].mixGroupId = 'mg_1_1700000000000';
  look.mixGroups = [
    { id: 'mg_1_1700000000000', name: 'Stage Left', fader: 0.6, muted: false, color: '#00ff88' },
  ];
  snap.save('grouped', look);
  const loaded = snap.load('grouped');
  assert.ok(Array.isArray(loaded.mixGroups), 'mixGroups persisted as an array');
  assert.equal(loaded.mixGroups.length, 1);
  assert.equal(loaded.mixGroups[0].id, 'mg_1_1700000000000');
  assert.equal(loaded.mixGroups[0].name, 'Stage Left');
  assert.equal(loaded.mixGroups[0].fader, 0.6);
  assert.equal(loaded.mixGroups[0].color, '#00ff88');
  // The member pointer survives too, so recall reconnects membership.
  assert.equal(loaded.channels[0].mixGroupId, 'mg_1_1700000000000');
});

test('a look with no groups loads to an empty mixGroups array', () => {
  const { snap } = makeManager();
  snap.save('ungrouped', sampleLook());           // sampleLook has no mixGroups
  const loaded = snap.load('ungrouped');
  assert.deepEqual(loaded.mixGroups, [], 'absent groups default to []');
});

test('list returns saved snapshot names sorted', () => {
  const { snap } = makeManager();
  snap.save('zebra', sampleLook());
  snap.save('alpha', sampleLook());
  snap.save('mike', sampleLook());
  assert.deepEqual(snap.list(), ['alpha', 'mike', 'zebra']);
});

test('has() reflects existence', () => {
  const { snap } = makeManager();
  assert.equal(snap.has('look_x'), false);
  snap.save('look_x', sampleLook());
  assert.equal(snap.has('look_x'), true);
});

test('save overwrites an existing snapshot', () => {
  const { snap } = makeManager();
  snap.save('dup', sampleLook());
  const second = sampleLook();
  second.master = 0.1;
  snap.save('dup', second);
  assert.equal(snap.load('dup').master, 0.1);
  assert.equal(snap.list().filter(n => n === 'dup').length, 1);
});

test('atomic save leaves no .tmp residue', () => {
  const { dir, snap } = makeManager();
  snap.save('clean', sampleLook());
  snap.save('clean', sampleLook());
  const leftovers = fs.readdirSync(path.join(dir, 'snapshots')).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('load of a missing snapshot returns null (caller 404s)', () => {
  const { snap } = makeManager();
  assert.equal(snap.load('nope'), null);
});

test('delete removes the file and reports true; missing reports false', () => {
  const { snap } = makeManager();
  snap.save('to_del', sampleLook());
  assert.equal(snap.delete('to_del'), true);
  assert.equal(snap.has('to_del'), false);
  assert.equal(snap.delete('to_del'), false);
});

test('malformed YAML throws SnapshotLoadError (fail loud, never silent)', () => {
  const { dir, snap } = makeManager();
  // Write a corrupt file directly into the snapshots dir.
  fs.writeFileSync(path.join(dir, 'snapshots', 'bad.yaml'), 'master: [unclosed\n  : :');
  assert.throws(() => snap.load('bad'), (e) => {
    assert.ok(e instanceof SnapshotLoadError);
    assert.equal(e.code, 'SNAPSHOT_MALFORMED');
    return true;
  });
});

test('a structurally invalid look (no channels array) throws SnapshotLoadError', () => {
  const { dir, snap } = makeManager();
  fs.writeFileSync(path.join(dir, 'snapshots', 'noch.yaml'), 'master: 0.5\n');
  assert.throws(() => snap.load('noch'), SnapshotLoadError);
});

test('a non-finite master in the file throws SnapshotLoadError', () => {
  const { dir, snap } = makeManager();
  fs.writeFileSync(path.join(dir, 'snapshots', 'badmaster.yaml'),
    'master: .nan\nchannels: []\n');
  assert.throws(() => snap.load('badmaster'), SnapshotLoadError);
});

test('an unsafe / path-traversal name is rejected on save and load', () => {
  const { snap } = makeManager();
  assert.throws(() => snap.save('../escape', sampleLook()), /Invalid snapshot name/);
  assert.throws(() => snap.load('../../etc/passwd'), /Invalid snapshot name/);
  assert.throws(() => snap.save('Has Spaces', sampleLook()), /Invalid snapshot name/);
});

test('a look with no deck and no overlays is still a valid capture', () => {
  const { snap } = makeManager();
  snap.save('empty_look', { master: 1.0, deck: null, channels: [] });
  const loaded = snap.load('empty_look');
  assert.equal(loaded.deck, null);
  assert.deepEqual(loaded.channels, []);
});

test('constructor rejects a state manager without writeFileAtomic', () => {
  const dir = tmpStateDir();
  assert.throws(() => new SnapshotManager(dir, {}), /writeFileAtomic/);
});
