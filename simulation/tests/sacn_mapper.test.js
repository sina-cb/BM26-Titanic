/**
 * sacn_mapper.test.js — demap contract tests (docs/33 + operator report
 * 2026-06-11: unpatched fixtures must render BLACK in sACN-in mode, not
 * freeze at the local pattern's last colors).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { demapSacnToPixels } from '../src/dmx/sacn_mapper.js';

function mockRouter(frames) {
  return { getFullFrame: (u) => frames[u] || null };
}

function entryWithStaleColor(overrides = {}) {
  const applied = [];
  return {
    entry: {
      r: 0.8, g: 0.1, b: 0.9, w: 0, a: 0, u: 0,
      patch: null,
      channels: { r: 1, g: 2, b: 3 },
      apply: (r, g, b) => applied.push([r, g, b]),
      ...overrides,
    },
    applied,
  };
}

test('unpatched entry is repainted black instead of keeping stale colors', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  demapSacnToPixels([entry], mockRouter({}));
  assert.equal(entry.r, 0);
  assert.equal(entry.g, 0);
  assert.equal(entry.b, 0);
  assert.deepEqual(applied, [[0, 0, 0]]);
});

test('entry on a universe with no received buffer is repainted black', () => {
  const { entry, applied } = entryWithStaleColor({
    patch: { universe: 7, addr: 1, footprint: 10 },
  });
  demapSacnToPixels([entry], mockRouter({})); // no U7 buffer
  assert.equal(entry.r, 0);
  assert.deepEqual(applied, [[0, 0, 0]]);
});

test('blackout apply is skipped once the entry is already dark (steady state)', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  const router = mockRouter({});
  demapSacnToPixels([entry], router);
  demapSacnToPixels([entry], router);
  demapSacnToPixels([entry], router);
  assert.equal(applied.length, 1, 'apply(0,0,0) fires once, not per frame');
});

test('patched entry still demaps frame values at addr + channel offsets', () => {
  const frame = new Uint8Array(512);
  // fixture at addr 100, channels {r:3,g:4,b:5} → absolute 102,103,104
  frame[101] = 255; // ch 3 (r)
  frame[102] = 128; // ch 4 (g)
  frame[103] = 0;   // ch 5 (b)
  const { entry } = entryWithStaleColor({
    patch: { universe: 2, addr: 100, footprint: 10 },
    channels: { r: 3, g: 4, b: 5 },
  });
  demapSacnToPixels([entry], mockRouter({ 2: frame }));
  assert.equal(entry.r, 1);
  assert.ok(Math.abs(entry.g - 128 / 255) < 1e-9);
  assert.equal(entry.b, 0);
});

test('a fixture that loses its patch mid-session goes dark on the next frame', () => {
  const frame = new Uint8Array(512);
  frame[0] = 255; // U2:1 ch1 (r)
  const { entry, applied } = entryWithStaleColor({
    patch: { universe: 2, addr: 1, footprint: 3 },
    channels: { r: 1, g: 2, b: 3 },
  });
  const router = mockRouter({ 2: frame });
  demapSacnToPixels([entry], router);
  assert.equal(entry.r, 1, 'driven while patched');
  entry.patch = null; // mapper unmapped it (projection → unpatched)
  demapSacnToPixels([entry], router);
  assert.equal(entry.r, 0, 'dark once unpatched');
  assert.deepEqual(applied[applied.length - 1], [0, 0, 0]);
});
