/**
 * Tests for the LED strand metadata pass — the LED mirror of the DMX
 * projectOntoConfigs numbering (sectionId per group, fixtureId monotonic).
 *
 * The key invariants under test:
 *  - DMX-first shared counter: LED ids continue strictly after the DMX max
 *    (DMX 1..N ⇒ LED N+1..), mutually exclusive and monotonic;
 *  - one section per effective group (groupKeyForStrand), sticky + idempotent;
 *  - LED and DMX group namespaces are isolated (same name ⇒ different id);
 *  - floors track the MAX id, so gaps in DMX ids are respected;
 *  - a strand with no stable group key throws (fail loud, no fallback).
 *
 * Pure module — no DOM/globals, plain objects only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupKeyForStrand, assignLedStrandMetadata } from '../src/dmx/led/led_metadata.js';

// ── groupKeyForStrand ─────────────────────────────────────────────────

test('groupKeyForStrand: group wins over name, else name', () => {
  assert.equal(groupKeyForStrand({ name: 'LED_0', group: 'bench' }), 'bench');
  assert.equal(groupKeyForStrand({ name: 'LED_0', group: '' }), 'LED_0');
  assert.equal(groupKeyForStrand({ name: 'LED_0' }), 'LED_0');
  // Whitespace-only is not a real key — falls through to name.
  assert.equal(groupKeyForStrand({ name: 'LED_0', group: '   ' }), 'LED_0');
});

test('groupKeyForStrand: no group and no name throws (fail loud, no fallback)', () => {
  assert.throws(() => groupKeyForStrand({ name: '' }), /no stable group key/);
  assert.throws(() => groupKeyForStrand({}), /no stable group key/);
  assert.throws(() => groupKeyForStrand(null), /must be an object/);
});

// ── assignLedStrandMetadata: shared DMX-first counter ─────────────────

test('DMX 1..4 then two LED groups ⇒ sections 5 and 6 in strand order', () => {
  const dmxConfigs = [
    { name: 'Par', group: 'Par', sectionId: 1, fixtureId: 1 },
    { name: 'Vin', group: 'Vintage', sectionId: 2, fixtureId: 2 },
    { name: 'Bar', group: 'Bar', sectionId: 3, fixtureId: 3 },
    { name: 'Fx', group: 'effects', sectionId: 4, fixtureId: 4 },
  ];
  const strands = [
    { name: 'LED_A', group: 'left' },
    { name: 'LED_B', group: 'right' },
  ];

  const res = assignLedStrandMetadata(strands, dmxConfigs);

  // LED sections continue strictly after DMX max (4): 5, then 6.
  assert.equal(strands[0].sectionId, 5);
  assert.equal(strands[1].sectionId, 6);
  // fixtureId continues after DMX max (4): 5, 6.
  assert.equal(strands[0].fixtureId, 5);
  assert.equal(strands[1].fixtureId, 6);
  assert.equal(res.maxSectionId, 6);
  assert.equal(res.maxFixtureId, 6);
});

test('live test_bench shape: DMX 1..4 (fixtureIds up to 10), one LED group ⇒ sect 5, fix 11', () => {
  // Mirrors the plan's live example: DMX sections 1..4 but fixtureIds run to
  // 10 (10 DMX fixtures). LED_0 with no group keys off its name.
  const dmxConfigs = [
    { name: 'p1', group: 'Par', sectionId: 1, fixtureId: 1 },
    { name: 'p2', group: 'Par', sectionId: 1, fixtureId: 2 },
    { name: 'v1', group: 'Vintage', sectionId: 2, fixtureId: 5 },
    { name: 'b1', group: 'Bar', sectionId: 3, fixtureId: 8 },
    { name: 'fx', group: 'effects', sectionId: 4, fixtureId: 10 },
  ];
  const strands = [{ name: 'LED_0', sectionId: 0, fixtureId: 0, viewMask: 0 }];

  assignLedStrandMetadata(strands, dmxConfigs);

  assert.equal(strands[0].sectionId, 5); // group 'LED_0' → section 5
  assert.equal(strands[0].fixtureId, 11); // continues after DMX max fixtureId 10
});

test('two strands in the SAME group share one section id', () => {
  const dmxConfigs = [{ name: 'd', group: 'D', sectionId: 2, fixtureId: 2 }];
  const strands = [
    { name: 'stackL_1', group: 'left smokestacks' },
    { name: 'stackL_2', group: 'left smokestacks' },
    { name: 'stackR_1', group: 'right smokestacks' },
  ];

  assignLedStrandMetadata(strands, dmxConfigs);

  // Both 'left smokestacks' strands → section 3; 'right smokestacks' → 4.
  assert.equal(strands[0].sectionId, 3);
  assert.equal(strands[1].sectionId, 3);
  assert.equal(strands[2].sectionId, 4);
  // fixtureIds are per strand and monotonic (each strand is its own fixture).
  assert.deepEqual(strands.map(s => s.fixtureId), [3, 4, 5]);
});

test('namespace isolation: a DMX group and an LED group with the same name get different ids', () => {
  const dmxConfigs = [{ name: 'd', group: 'bench', sectionId: 1, fixtureId: 1 }];
  const strands = [{ name: 'LED_0', group: 'bench' }];

  assignLedStrandMetadata(strands, dmxConfigs);

  // The LED 'bench' group must NOT reuse the DMX 'bench' section id (1).
  assert.equal(strands[0].sectionId, 2);
});

test('gaps in DMX ids are respected: floor is the MAX, not the count', () => {
  // Only two DMX configs, but their ids jump to 7 and 9. LED must start at 10.
  const dmxConfigs = [
    { name: 'a', group: 'A', sectionId: 7, fixtureId: 3 },
    { name: 'b', group: 'B', sectionId: 9, fixtureId: 20 },
  ];
  const strands = [{ name: 'LED_0', group: 'x' }];

  assignLedStrandMetadata(strands, dmxConfigs);

  assert.equal(strands[0].sectionId, 10); // max section 9 + 1
  assert.equal(strands[0].fixtureId, 21); // max fixture 20 + 1
});

test('sticky + idempotent: pre-assigned ids survive, re-run changes nothing', () => {
  const dmxConfigs = [{ name: 'd', group: 'D', sectionId: 4, fixtureId: 4 }];
  const strands = [
    { name: 'LED_A', group: 'left' },
    { name: 'LED_B', group: 'right' },
  ];

  const first = assignLedStrandMetadata(strands, dmxConfigs);
  const snapshot = strands.map(s => ({ s: s.sectionId, f: s.fixtureId }));
  assert.deepEqual(snapshot, [{ s: 5, f: 5 }, { s: 6, f: 6 }]);

  // Re-run with the same inputs: ids are sticky, nothing renumbers.
  const second = assignLedStrandMetadata(strands, dmxConfigs);
  assert.deepEqual(strands.map(s => ({ s: s.sectionId, f: s.fixtureId })), snapshot);
  assert.equal(second.maxSectionId, first.maxSectionId);
  assert.equal(second.maxFixtureId, first.maxFixtureId);
});

test('adding a strand later continues after the existing LED max (sticky group reuse)', () => {
  const dmxConfigs = [{ name: 'd', group: 'D', sectionId: 2, fixtureId: 2 }];
  const strands = [{ name: 'LED_A', group: 'left', sectionId: 3, fixtureId: 3 }];

  // A new ungrouped strand joins; and a second strand joins the existing
  // 'left' group — it must reuse section 3, not mint a new one.
  strands.push({ name: 'LED_B', group: 'right' });
  strands.push({ name: 'LED_C', group: 'left' });

  assignLedStrandMetadata(strands, dmxConfigs);

  assert.equal(strands[0].sectionId, 3); // sticky
  assert.equal(strands[1].sectionId, 4); // new group 'right'
  assert.equal(strands[2].sectionId, 3); // reuses sticky 'left' section
  assert.deepEqual(strands.map(s => s.fixtureId), [3, 4, 5]);
});

test('no controller/DMX configs: LED numbering starts at 1', () => {
  const strands = [{ name: 'LED_0', group: 'solo' }];
  assignLedStrandMetadata(strands, []);
  assert.equal(strands[0].sectionId, 1);
  assert.equal(strands[0].fixtureId, 1);
});

test('a strand with no group key throws during assignment (fail loud)', () => {
  const strands = [{ name: '' }];
  assert.throws(() => assignLedStrandMetadata(strands, []), /no stable group key/);
});
