/**
 * Grouping parity for LED-type fixtures (the TE Sign) vs DMX fixtures.
 *
 * Operator acceptance case: the two sides of the TE Sign can be grouped
 * side-by-side as ONE group ('TE Sign') and are then honored everywhere DMX
 * groups are — including the group→view-bit derivation that feeds named masks
 * and auto-views.
 *
 * The group→bit contract is driven by EXPORTED PIXELS, not fixture configs
 * (view_registry.listPixelGroups / reconcileGroupBits). The exporter emits a
 * pixel's group as `cfg.group || ''` for every par/DMX-transport fixture
 * (pixelblaze_model_exporter.js:89,152) — this is type-agnostic, so an LED-type
 * fixture (TeSignV3*) grouped like a DMX fixture derives its view bit the same
 * way. This test exercises that contract on the generator's real output, so a
 * regression that stops LED fixtures from participating in group→view masks
 * fails here without needing a browser.
 *
 * Pure module — view_registry + the generator, plain objects only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createViewRegistry,
  listPixelGroups,
  reconcileGroupBits,
  isPowerOfTwoBit,
} from '../src/dmx/view_registry.js';
import { buildTeSign } from '../src/fixtures/te_sign_generator.js';

// Emulate the exporter's per-fixture pixel group key EXACTLY
// (pixelblaze_model_exporter.js: `group: light.group || ''`). One synthetic
// pixel per fixture is enough for the group→bit contract (which keys on the
// distinct group set, not pixel counts).
function pixelsFor(configs) {
  const px = [];
  configs.forEach((cfg, i) => {
    px.push({ name: cfg.name, group: cfg.group || '', fId: i + 1 });
  });
  return px;
}

test('two TE Sign halves in one group ⇒ a single shared view group', () => {
  const pair = buildTeSign(); // [Side A, Side B], both group 'TE Sign'
  const pixels = pixelsFor(pair);

  // listPixelGroups collapses the two halves to ONE group.
  const groups = listPixelGroups(pixels);
  assert.deepEqual(groups, ['TE Sign']);

  // reconcileGroupBits assigns exactly one power-of-two bit for it — the two
  // sides share the one view bit (they "always work together").
  const registry = createViewRegistry({});
  reconcileGroupBits(registry, groups);
  assert.deepEqual(Object.keys(registry.groupBits), ['TE Sign']);
  assert.ok(isPowerOfTwoBit(registry.groupBits['TE Sign']));
});

test('LED-type TE Sign groups identically to a DMX fixture group (parity)', () => {
  const [sideA, sideB] = buildTeSign();
  // A real DMX par fixture (ShehdsBar) alongside the two LED-type halves.
  const dmxPar = { name: 'Left Back Wall 1', group: 'Left Back Wall', fixtureType: 'ShehdsBar' };

  const pixels = pixelsFor([dmxPar, sideA, sideB]);
  const groups = listPixelGroups(pixels);

  // Two distinct groups: the DMX group and the one shared TE Sign group.
  assert.deepEqual(new Set(groups), new Set(['Left Back Wall', 'TE Sign']));

  const registry = createViewRegistry({});
  reconcileGroupBits(registry, groups);
  // Each group gets exactly one distinct power-of-two bit.
  const bits = Object.values(registry.groupBits);
  assert.equal(bits.length, 2);
  assert.ok(bits.every(isPowerOfTwoBit));
  assert.notEqual(registry.groupBits['TE Sign'], registry.groupBits['Left Back Wall']);
});

test('regrouping the halves apart splits them into two view groups', () => {
  // Same generator output, but the two halves assigned to DIFFERENT groups —
  // proves the group field (not the fixture type) is what drives membership.
  const [sideA, sideB] = buildTeSign();
  sideA.group = 'TE Sign Left';
  sideB.group = 'TE Sign Right';

  const groups = listPixelGroups(pixelsFor([sideA, sideB]));
  assert.deepEqual(new Set(groups), new Set(['TE Sign Left', 'TE Sign Right']));

  const registry = createViewRegistry({});
  reconcileGroupBits(registry, groups);
  assert.equal(Object.keys(registry.groupBits).length, 2);
});

test('an ungrouped fixture contributes no view bit (DMX-parity semantics)', () => {
  // Empty group ⇒ no bit, exactly like an ungrouped DMX fixture. Grouping the
  // two sign halves under one name is precisely what creates shared membership.
  const ungrouped = { name: 'Loose Fixture', group: '' };
  const groups = listPixelGroups(pixelsFor([ungrouped]));
  assert.deepEqual(groups, []);

  const registry = createViewRegistry({});
  reconcileGroupBits(registry, groups);
  assert.deepEqual(Object.keys(registry.groupBits), []);
});
