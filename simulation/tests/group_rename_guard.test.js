/**
 * Unit tests for the scene-wide group-name guard (report 20260725_52).
 *
 * The bug this module closes: every group-rename control policed only its OWN
 * list. Par groups checked `groupOrder`; LED strand groups checked strand groups;
 * neither checked the other, and neither checked generator (`trace`) group names.
 * But the view-mask bit, the 2D Pixel Map selectors and the exported engine model
 * are all keyed by group NAME — one namespace — so a cross-list collision fused
 * two distinct groups onto one bit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_GROUP_NAMES,
  collectSceneGroupNames,
  groupRenameError,
  formatModelStalenessWarning,
  buildGroupRenameReport,
} from '../src/dmx/group_rename_guard.js';

const scene = () => ({
  parLights: [
    { name: 'TE Sign V3 A', group: 'TE Sign' },
    { name: 'TE Sign V3 B', group: 'TE Sign' },
    { name: 'Left Back Wall 1', group: 'Left Back Wall' },
  ],
  ledStrands: [
    { name: 'Hull Left', group: 'Hull' },
    { name: 'Loose strand', group: '' },
    { name: 'Also loose' },
  ],
  traces: [
    { name: 'Right Front Wall', groupName: 'Right Front Wall' },
  ],
});

// ── collectSceneGroupNames ─────────────────────────────────────────────────

test('collects par, strand AND generator group names into one namespace', () => {
  const names = collectSceneGroupNames(scene());
  assert.deepEqual([...names].sort(),
    ['Hull', 'Left Back Wall', 'Right Front Wall', 'TE Sign']);
});

test('the Ungrouped display bucket is never a collected name', () => {
  const names = collectSceneGroupNames(scene());
  assert.equal(names.has('Ungrouped'), false,
    'a blank strand group is the display bucket, not a real group');
});

test('names are trimmed, and blank/non-string groups are ignored', () => {
  const names = collectSceneGroupNames({
    parLights: [{ group: '  Padded  ' }, { group: '   ' }, { group: 42 }, {}],
    ledStrands: [null],
    traces: [{ groupName: null }],
  });
  assert.deepEqual([...names], ['Padded']);
});

test('an empty scene yields an empty namespace (not a throw)', () => {
  assert.equal(collectSceneGroupNames({}).size, 0);
});

test('a malformed scene bag throws rather than reporting an empty namespace', () => {
  // Under-reporting collisions is worse than not running (codex P0).
  assert.throws(() => collectSceneGroupNames(null), /scene bag must be an object/);
  assert.throws(() => collectSceneGroupNames('nope'), /scene bag must be an object/);
});

// ── groupRenameError ───────────────────────────────────────────────────────

test('a free name is accepted', () => {
  assert.equal(groupRenameError('Bow Sign', {
    currentName: 'TE Sign', takenNames: collectSceneGroupNames(scene()),
  }), null);
});

test('renaming a group to its own name is a no-op, not a collision', () => {
  assert.equal(groupRenameError('TE Sign', {
    currentName: 'TE Sign', takenNames: collectSceneGroupNames(scene()),
  }), null);
});

test('an empty or whitespace-only name is refused', () => {
  const taken = collectSceneGroupNames(scene());
  assert.match(groupRenameError('', { currentName: 'TE Sign', taken2: 0, takenNames: taken }),
    /cannot be empty/);
  assert.match(groupRenameError('   ', { currentName: 'TE Sign', takenNames: taken }),
    /cannot be empty/);
  assert.match(groupRenameError(null, { currentName: null, takenNames: taken }),
    /cannot be empty/);
});

test('the reserved Ungrouped bucket is refused in either direction', () => {
  assert.deepEqual(RESERVED_GROUP_NAMES, ['Ungrouped']);
  assert.match(groupRenameError('Ungrouped', {
    currentName: 'TE Sign', takenNames: collectSceneGroupNames(scene()),
  }), /reserved group name/);
});

test('a PAR group cannot be renamed onto a live LED STRAND group (the hole)', () => {
  const err = groupRenameError('Hull', {
    currentName: 'TE Sign', takenNames: collectSceneGroupNames(scene()),
  });
  assert.match(err, /already exists/);
  assert.match(err, /scene-wide/, 'the message must explain WHY, not just refuse');
});

test('an LED STRAND group cannot be renamed onto a live par group (the reverse)', () => {
  assert.match(groupRenameError('TE Sign', {
    currentName: 'Hull', takenNames: collectSceneGroupNames(scene()),
  }), /already exists/);
});

test('no group can be renamed onto a GENERATOR group name', () => {
  // config.js re-stamps `traceGenerated` on a groupName match, so this collision
  // silently converts hand-placed fixtures into generated ones at the next load.
  assert.match(groupRenameError('Right Front Wall', {
    currentName: 'Hull', takenNames: collectSceneGroupNames(scene()),
  }), /already exists/);
});

test('a NEW group (currentName null) is checked against everything', () => {
  const taken = collectSceneGroupNames(scene());
  assert.match(groupRenameError('TE Sign', { currentName: null, takenNames: taken }),
    /already exists/);
  assert.equal(groupRenameError('Brand New', { currentName: null, takenNames: taken }), null);
});

test('the proposed name is trimmed before comparison', () => {
  assert.match(groupRenameError('  Hull  ', {
    currentName: 'TE Sign', takenNames: collectSceneGroupNames(scene()),
  }), /already exists/);
});

test('takenNames may be an Array as well as a Set', () => {
  assert.match(groupRenameError('Hull', { currentName: 'X', takenNames: ['Hull'] }),
    /already exists/);
});

test('a missing takenNames throws rather than accepting everything', () => {
  assert.throws(() => groupRenameError('Anything', { currentName: null }),
    /takenNames must be a Set or Array/);
  assert.throws(() => groupRenameError('Anything'),
    /takenNames must be a Set or Array/);
});

// ── The loud half ──────────────────────────────────────────────────────────

test('the model-staleness warning names both groups, the count, and the action', () => {
  const line = formatModelStalenessWarning('TE Sign', 'Bow Sign', 2);
  assert.match(line, /ENGINE MODEL now STALE/);
  assert.match(line, /2 member\(s\)/);
  assert.match(line, /"TE Sign"/);
  assert.match(line, /"Bow Sign"/);
  assert.match(line, /Re-export/);
  // The one thing an operator would otherwise assume covers this.
  assert.match(line, /stale-model banner does NOT catch this/);
});

test('the staleness warning refuses a bogus member count', () => {
  assert.throws(() => formatModelStalenessWarning('a', 'b', -1), /integer >= 0/);
  assert.throws(() => formatModelStalenessWarning('a', 'b', 1.5), /integer >= 0/);
  assert.throws(() => formatModelStalenessWarning('a', 'b', '2'), /integer >= 0/);
});

test('the rename report separates CARRIED display state from UNTOUCHED mapping', () => {
  const lines = buildGroupRenameReport({
    oldName: 'TE Sign', newName: 'Bow Sign', memberCount: 2, kind: 'Par',
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\[Rename\] Par group "TE Sign" → "Bow Sign": 2 member\(s\) moved\./);
  assert.match(lines[1], /CARRIED \(display state\)/);
  assert.match(lines[1], /view-mask bit/);
  assert.match(lines[1], /2D Pixel Map selector/);
  assert.match(lines[2], /UNTOUCHED \(mapping\)/);
  assert.match(lines[2], /nothing was unmapped/);
  assert.match(lines[3], /ENGINE MODEL now STALE/);
});

test('the report never claims a rename unmapped something', () => {
  // A group rename is NOT a fixture rename: fixture names are the mapping join
  // key, group membership is not. Saying "UNMAPPED" here would be the same lie
  // the trace rename used to tell ("channels freed").
  const text = buildGroupRenameReport({
    oldName: 'Hull', newName: 'Port Hull', memberCount: 5, kind: 'LED strand',
  }).join('\n');
  assert.doesNotMatch(text, /channels freed/);
  assert.doesNotMatch(text, /INVALIDATED/);
  assert.match(text, /LED strand group/);
});

test('the report kind is required (no anonymous "group" wording)', () => {
  assert.throws(() => buildGroupRenameReport({
    oldName: 'a', newName: 'b', memberCount: 0, kind: '',
  }), /kind must be a non-empty string/);
});

test('a zero-member rename still reports — silence is never an outcome', () => {
  const lines = buildGroupRenameReport({
    oldName: 'a', newName: 'b', memberCount: 0, kind: 'Par',
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /0 member\(s\) moved/);
});
