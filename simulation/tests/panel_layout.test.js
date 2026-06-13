import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOP_MIN, clampPosition, findFreeSlot, sanitizeGeometry,
} from '../src/gui/panel_layout.js';

// Pins the pure layout-policy helpers in src/gui/panel_layout.js.
// Only the pure exports are exercised — registerPanel & co. need a DOM.

const VW = 1280;
const VH = 720;

// ── Layout contract pin ─────────────────────────────────────────────────

test('TOP_MIN is 44 (HUD exclusion strip contract)', () => {
  assert.equal(TOP_MIN, 44);
});

// ── clampPosition ───────────────────────────────────────────────────────

test('clampPosition leaves an in-bounds rect unchanged', () => {
  const rect = { left: 200, top: 100, width: 300, height: 200 };
  assert.deepEqual(clampPosition(rect, VW, VH), rect);
});

test('clampPosition raises top above the HUD strip to TOP_MIN', () => {
  const pos = clampPosition({ left: 200, top: 0, width: 300, height: 200 }, VW, VH);
  assert.equal(pos.top, TOP_MIN);
});

test('clampPosition pulls a panel past the right edge back to vw - 100', () => {
  const pos = clampPosition({ left: 5000, top: 100, width: 300, height: 200 }, VW, VH);
  assert.equal(pos.left, VW - 100);
});

test('clampPosition shrinks oversized width/height to viewport bounds', () => {
  const pos = clampPosition({ left: 0, top: 100, width: 9999, height: 9999 }, VW, VH);
  assert.equal(pos.width, VW - 20);
  assert.equal(pos.height, VH - TOP_MIN - 10);
});

test('clampPosition keeps undefined width/height undefined', () => {
  const pos = clampPosition({ left: 200, top: 100 }, VW, VH);
  assert.equal(pos.width, undefined);
  assert.equal(pos.height, undefined);
  assert.equal(pos.left, 200);
  assert.equal(pos.top, 100);
});

// ── findFreeSlot ────────────────────────────────────────────────────────

test('findFreeSlot returns the desired slot when nothing is occupied', () => {
  const desired = { left: 300, top: 200, width: 240, height: 160 };
  assert.deepEqual(findFreeSlot(desired, [], VW, VH), desired);
});

test('findFreeSlot cascades +24,+24 until clear of a fully covering rect', () => {
  const desired = { left: 100, top: 100, width: 200, height: 150 };
  const occupied = [{ left: 100, top: 100, width: 200, height: 150 }];
  const slot = findFreeSlot(desired, occupied, VW, VH);
  // Three +24 steps: 172/172 is the first offset where overlap drops
  // below the 40% threshold (≈33%).
  assert.deepEqual(slot, { left: 172, top: 172, width: 200, height: 150 });
});

test('findFreeSlot never lands a cascaded slot above TOP_MIN', () => {
  // Desired sits in the HUD strip and collides — the cascade's clamp
  // must floor every candidate at TOP_MIN.
  const desired = { left: 50, top: 10, width: 200, height: 150 };
  const occupied = [{ left: 50, top: 10, width: 200, height: 150 }];
  const slot = findFreeSlot(desired, occupied, VW, VH);
  assert.ok(slot.top >= TOP_MIN, `slot.top ${slot.top} is inside the HUD strip`);
  assert.ok(slot.left >= 0);
  assert.ok(slot.left <= VW - 100);
});

test('findFreeSlot exhausts maxTries against a wall of panels and returns the last clamped candidate', () => {
  // One huge occupied rect overlaps every candidate 100%, so all 8 default
  // tries collide. Must NOT throw; must return the final candidate, still
  // clamped on-screen.
  const desired = { left: 1100, top: 600, width: 200, height: 150 };
  const occupied = [{ left: 0, top: 0, width: 10000, height: 10000 }];
  const slot = findFreeSlot(desired, occupied, VW, VH);
  // Cascade walks +24,+24 and pins against the clamp edges.
  assert.deepEqual(slot, { left: VW - 100, top: VH - 50, width: 200, height: 150 });
  assert.ok(slot.top >= TOP_MIN);
  assert.ok(slot.left <= VW - 100, 'slot drifted off the right edge');
  assert.ok(slot.top <= VH - 50, 'slot drifted off the bottom edge');
});

test('findFreeSlot ignores overlap below the 40% threshold', () => {
  const desired = { left: 100, top: 100, width: 200, height: 100 };
  // Overlap is 40x50 = 2000px² of the candidate's 20000px² — 10%.
  const occupied = [{ left: 260, top: 150, width: 200, height: 100 }];
  assert.deepEqual(findFreeSlot(desired, occupied, VW, VH), desired);
});

// ── sanitizeGeometry ────────────────────────────────────────────────────

test('sanitizeGeometry leaves an in-bounds entry unchanged', () => {
  const entry = { x: 200, y: 100, w: 300, h: 200, collapsed: false };
  assert.deepEqual(sanitizeGeometry(entry, VW, VH), entry);
});

test('sanitizeGeometry pulls an entry off the right edge back into bounds', () => {
  const entry = { x: 5000, y: 100, w: 300, h: 200, collapsed: false };
  const out = sanitizeGeometry(entry, VW, VH);
  assert.equal(out.x, VW - 100);
  assert.equal(out.y, 100);
});

test('sanitizeGeometry pulls an entry off the bottom edge back into bounds', () => {
  const entry = { x: 200, y: 5000, w: 300, h: 200, collapsed: false };
  const out = sanitizeGeometry(entry, VW, VH);
  assert.equal(out.y, VH - 50);
  assert.equal(out.x, 200);
});

test('sanitizeGeometry raises an entry above TOP_MIN down to TOP_MIN', () => {
  const entry = { x: 200, y: 0, w: 300, h: 200, collapsed: false };
  const out = sanitizeGeometry(entry, VW, VH);
  assert.equal(out.y, TOP_MIN);
});

test('sanitizeGeometry shrinks oversized w/h to viewport bounds', () => {
  const entry = { x: 0, y: 100, w: 9999, h: 9999, collapsed: false };
  const out = sanitizeGeometry(entry, VW, VH);
  assert.equal(out.w, VW - 20);
  assert.equal(out.h, VH - TOP_MIN - 10);
});

test('sanitizeGeometry preserves the collapsed flag and omits absent w/h', () => {
  const entry = { x: 200, y: 100, collapsed: true };
  const out = sanitizeGeometry(entry, VW, VH);
  assert.equal(out.collapsed, true);
  assert.equal('w' in out, false);
  assert.equal('h' in out, false);
  assert.equal(out.x, 200);
  assert.equal(out.y, 100);
});
