// Tests for lib/mask_registry.js + the members-based view-selection path
// in compileViewSelectionMask (Tier A, report 20260618_2). Proves named
// masks are unbounded for host-side selection (no viewMask bit cost) and
// that the legacy bit path stays back-compatible.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMaskRegistry, MaskRegistry } from '../../lib/mask_registry.js';
import { compileViewSelectionMask } from '../../lib/pattern_mixer.js';

function pixels4() {
  return [
    { i: 0, group: 'Wall', vMask: 0 },
    { i: 1, group: 'Wall', vMask: 0 },
    { i: 2, group: 'Floor', vMask: 0 },
    { i: 3, group: 'Floor', vMask: 0 },
  ];
}

// ── buildMaskRegistry ─────────────────────────────────────────────

test('buildMaskRegistry: groups become members; ids dense in declaration order', () => {
  const reg = buildMaskRegistry({
    pixels: pixels4(),
    pixelCount: 4,
    groupBits: { Wall: 0x01, Floor: 0x02 },
    viewMasks: [],
  });
  assert.ok(reg instanceof MaskRegistry);
  assert.equal(reg.get('Wall').id, 0);
  assert.equal(reg.get('Floor').id, 1);
  assert.deepEqual(Array.from(reg.get('Wall').members), [1, 1, 0, 0]);
  assert.deepEqual(Array.from(reg.get('Floor').members), [0, 0, 1, 1]);
  // Group masks carry their bit (still resident in the in-VM cache).
  assert.equal(reg.get('Wall').bit, 0x01);
});

test('buildMaskRegistry: composite preset unions group members', () => {
  const reg = buildMaskRegistry({
    pixels: pixels4(),
    pixelCount: 4,
    groupBits: { Wall: 0x01, Floor: 0x02 },
    viewMasks: [{ name: 'Everything', groups: ['Wall', 'Floor'] }],
  });
  assert.deepEqual(Array.from(reg.get('Everything').members), [1, 1, 1, 1]);
  assert.equal(reg.get('Everything').kind, 'composite');
});

test('buildMaskRegistry: a bit-LESS named mask is registered (Tier A, no bit)', () => {
  const reg = buildMaskRegistry({
    pixels: pixels4(),
    pixelCount: 4,
    groupBits: { Wall: 0x01, Floor: 0x02 },
    // No `bit` field — host-only mask, the whole point of lifting the cap.
    viewMasks: [{ name: 'WallOnly', groups: ['Wall'] }],
  });
  const entry = reg.get('WallOnly');
  assert.equal(entry.bit, 0, 'bit-less mask should carry bit 0');
  assert.deepEqual(Array.from(entry.members), [1, 1, 0, 0]);
});

test('buildMaskRegistry: pixelSet membership from pixelIndices', () => {
  const reg = buildMaskRegistry({
    pixels: pixels4(),
    pixelCount: 4,
    groupBits: {},
    viewMasks: [{ name: 'Corners', pixelIndices: [0, 3], bit: 0x04 }],
  });
  assert.deepEqual(Array.from(reg.get('Corners').members), [1, 0, 0, 1]);
  assert.equal(reg.get('Corners').kind, 'pixelSet');
});

test('buildMaskRegistry: duplicate group/preset name does not double-register', () => {
  // A composite reusing a base-group name is skipped (group owns it).
  const reg = buildMaskRegistry({
    pixels: pixels4(),
    pixelCount: 4,
    groupBits: { Wall: 0x01 },
    viewMasks: [{ name: 'Wall', groups: ['Wall'] }],
  });
  assert.equal(reg.names().length, 1);
  assert.equal(reg.get('Wall').kind, 'group');
});

// ── Unbounded host-side selection (the headline) ──────────────────

test('buildMaskRegistry: supports far more than 31 bit-less named masks', () => {
  // 50 single-pixel masks on a 50-pixel model — impossible under the
  // 31-bit ceiling, trivial with members[].
  const N = 50;
  const px = [];
  for (let i = 0; i < N; i++) px.push({ i, group: `G${i}`, vMask: 0 });
  const viewMasks = [];
  for (let i = 0; i < N; i++) viewMasks.push({ name: `Mask${i}`, pixelIndices: [i] });
  const reg = buildMaskRegistry({ pixels: px, pixelCount: N, groupBits: {}, viewMasks });
  assert.equal(reg.names().length, N);
  // The 33rd mask (past the old bit ceiling) resolves and is selectable.
  assert.equal(reg.get('Mask32').members[32], 1);
});

// ── compileViewSelectionMask via registry (members path) ──────────

test('compileViewSelectionMask: resolves a bit-less mask by name via registry', () => {
  const px = pixels4();
  const reg = buildMaskRegistry({
    pixels: px, pixelCount: 4, groupBits: { Wall: 0x01, Floor: 0x02 },
    viewMasks: [{ name: 'FloorOnly', groups: ['Floor'] }], // no bit
  });
  const mask = compileViewSelectionMask({
    pixels: px, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'FloorOnly' },
    maskRegistry: reg,
  });
  assert.deepEqual(Array.from(mask), [0, 0, 1, 1]);
});

test('compileViewSelectionMask: invert works on the registry members path', () => {
  const px = pixels4();
  const reg = buildMaskRegistry({
    pixels: px, pixelCount: 4, groupBits: { Wall: 0x01, Floor: 0x02 },
    viewMasks: [],
  });
  const mask = compileViewSelectionMask({
    pixels: px, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'Wall', invert: true },
    maskRegistry: reg,
  });
  assert.deepEqual(Array.from(mask), [0, 0, 1, 1]);
});

test('compileViewSelectionMask: unknown name via registry THROWS naming known masks', () => {
  const px = pixels4();
  const reg = buildMaskRegistry({
    pixels: px, pixelCount: 4, groupBits: { Wall: 0x01 }, viewMasks: [],
  });
  assert.throws(() => compileViewSelectionMask({
    pixels: px, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'Ghost' },
    maskRegistry: reg,
  }), /Unknown viewMask name 'Ghost'.*Wall/s);
});

test('compileViewSelectionMask: integer-bit target still uses the legacy bit path', () => {
  const px = [
    { i: 0, vMask: 0b001 },
    { i: 1, vMask: 0b010 },
    { i: 2, vMask: 0b001 },
    { i: 3, vMask: 0b100 },
  ];
  // Even with a registry present, a numeric target resolves by bit.
  const reg = new MaskRegistry();
  const mask = compileViewSelectionMask({
    pixels: px, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 0b001 },
    maskRegistry: reg,
  });
  assert.deepEqual(Array.from(mask), [1, 0, 1, 0]);
});
