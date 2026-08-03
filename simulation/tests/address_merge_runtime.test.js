/**
 * address_merge_runtime.test.js — the WIRE side of the shared-address feature:
 * the universe buffer is the unification point (one frame per universe, and
 * animate.js emits one packet per (universe, destination IP) from it), and a
 * claimant that lost a channel to a numerically higher controller IP does not
 * write that channel — so the merged bytes no longer depend on render order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planUnifiedOutput, lostChannelIndex } from '../src/dmx/address_merge.js';
import { mapPixelsToSacn } from '../src/dmx/sacn_mapper.js';

/** A minimal stand-in for UniverseRouter: one 512-byte buffer per universe. */
function fakeRouter() {
  const buffers = new Map();
  return {
    buffers,
    addUniverse(u) { if (!buffers.has(u)) buffers.set(u, new Uint8Array(512)); },
    getFullFrame(u) { return buffers.get(u) || null; },
  };
}

/** One RGB pixel entry as generatePixelMap emits it. */
function pixel({ name, ip, universe, addr, r, g, b }) {
  return {
    name,
    type: 'dmx',
    fixtureType: 'GenericRgb',
    fixtureConfig: { name, controllerIp: ip },
    patch: { universe, addr, footprint: 3 },
    channels: { r: 1, g: 2, b: 3 },
    r, g, b, w: 0, a: 0, u: 0,
  };
}

/** Install a suppression index the way main.js publishes it, then clean up. */
function withSuppression(claims, fn) {
  const hadWindow = typeof globalThis.window !== 'undefined';
  const prev = hadWindow ? globalThis.window : undefined;
  globalThis.window = { __addressSuppressionIndex: lostChannelIndex(planUnifiedOutput(claims)) };
  try {
    return fn();
  } finally {
    if (hadWindow) globalThis.window = prev; else delete globalThis.window;
  }
}

const LOW = '10.0.0.9';    // numerically LOWER than .10 — the case string sort inverts
const HIGH = '10.0.0.10';

// Both fixtures sit at U7 ch1–3 on two different controllers.
const CONTESTED_CLAIMS = [
  { label: 'lowFixture', ip: LOW, universe: 7, start: 1, end: 3 },
  { label: 'highFixture', ip: HIGH, universe: 7, start: 1, end: 3 },
];

test('no suppression index ⇒ the write path is exactly as it was', () => {
  const router = fakeRouter();
  router.addUniverse(7);
  mapPixelsToSacn([pixel({ name: 'a', ip: LOW, universe: 7, addr: 1, r: 1, g: 0, b: 0 })], router);
  assert.deepEqual([...router.getFullFrame(7).slice(0, 3)], [255, 0, 0]);
});

test('the HIGHER IP owns the contested channels, whatever the render order', () => {
  const low = pixel({ name: 'lowFixture', ip: LOW, universe: 7, addr: 1, r: 1, g: 0, b: 0 });
  const high = pixel({ name: 'highFixture', ip: HIGH, universe: 7, addr: 1, r: 0, g: 0, b: 1 });

  for (const order of [[low, high], [high, low]]) {
    const router = fakeRouter();
    router.addUniverse(7);
    withSuppression(CONTESTED_CLAIMS, () => mapPixelsToSacn(order, router));
    assert.deepEqual([...router.getFullFrame(7).slice(0, 3)], [0, 0, 255],
      'the 10.0.0.10 fixture (blue) must win ch1–3 regardless of list order');
  }
});

test('WITHOUT the merge, render order decides — the defect this closes', () => {
  const low = pixel({ name: 'lowFixture', ip: LOW, universe: 7, addr: 1, r: 1, g: 0, b: 0 });
  const high = pixel({ name: 'highFixture', ip: HIGH, universe: 7, addr: 1, r: 0, g: 0, b: 1 });

  const a = fakeRouter(); a.addUniverse(7);
  mapPixelsToSacn([low, high], a);
  const b = fakeRouter(); b.addUniverse(7);
  mapPixelsToSacn([high, low], b);
  assert.notDeepEqual([...a.getFullFrame(7).slice(0, 3)], [...b.getFullFrame(7).slice(0, 3)],
    'precondition: with no suppression index the last writer wins');
});

test('the loser keeps every channel it did NOT lose', () => {
  // low: ch1–6, high: ch4–9 → contested ch4–6 only.
  const claims = [
    { label: 'lowFixture', ip: LOW, universe: 7, start: 1, end: 6 },
    { label: 'highFixture', ip: HIGH, universe: 7, start: 4, end: 9 },
  ];
  const low = {
    ...pixel({ name: 'lowFixture', ip: LOW, universe: 7, addr: 1, r: 1, g: 1, b: 1 }),
    patch: { universe: 7, addr: 1, footprint: 6 },
    channels: { r: 1, g: 2, b: 3 },
  };
  const lowTail = {
    ...pixel({ name: 'lowFixture', ip: LOW, universe: 7, addr: 4, r: 1, g: 1, b: 1 }),
    patch: { universe: 7, addr: 4, footprint: 3 },
  };
  const high = {
    ...pixel({ name: 'highFixture', ip: HIGH, universe: 7, addr: 7, r: 0, g: 1, b: 0 }),
    patch: { universe: 7, addr: 7, footprint: 3 },
  };
  const router = fakeRouter();
  router.addUniverse(7);
  withSuppression(claims, () => mapPixelsToSacn([low, lowTail, high], router));
  const frame = router.getFullFrame(7);
  // ch1–3: uncontested, the low claimant's own white.
  assert.deepEqual([...frame.slice(0, 3)], [255, 255, 255]);
  // ch4–6: CONTESTED and lost — the low claimant wrote nothing, and the high
  // claimant's own footprint starts at ch7, so these stay black.
  assert.deepEqual([...frame.slice(3, 6)], [0, 0, 0]);
  // ch7–9: the high claimant's own bytes.
  assert.deepEqual([...frame.slice(6, 9)], [0, 255, 0]);
});

test('a fixture on a DIFFERENT universe is never suppressed', () => {
  const claims = [
    { label: 'lowFixture', ip: LOW, universe: 7, start: 1, end: 3 },
    { label: 'highFixture', ip: HIGH, universe: 7, start: 1, end: 3 },
  ];
  const elsewhere = pixel({ name: 'lowFixture', ip: LOW, universe: 8, addr: 1, r: 1, g: 0, b: 0 });
  const router = fakeRouter();
  router.addUniverse(8);
  withSuppression(claims, () => mapPixelsToSacn([elsewhere], router));
  assert.deepEqual([...router.getFullFrame(8).slice(0, 3)], [255, 0, 0]);
});

test('a fixture with NO controller IP is never suppressed by somebody else\'s contest', () => {
  const orphan = {
    ...pixel({ name: 'orphan', ip: LOW, universe: 7, addr: 1, r: 1, g: 0, b: 0 }),
    fixtureConfig: { name: 'orphan' },   // no controllerIp at all
  };
  const router = fakeRouter();
  router.addUniverse(7);
  withSuppression(CONTESTED_CLAIMS, () => mapPixelsToSacn([orphan], router));
  assert.deepEqual([...router.getFullFrame(7).slice(0, 3)], [255, 0, 0]);
});

test('the master dimmer byte obeys the same override', () => {
  // A par's ch1 is its master dimmer, force-written to 255 by the mapper. On a
  // channel this controller LOST that write must not land either — otherwise a
  // losing par would blast the winner's fixture to full.
  const claims = [
    { label: 'lowPar', ip: LOW, universe: 7, start: 1, end: 10 },
    { label: 'highPar', ip: HIGH, universe: 7, start: 1, end: 10 },
  ];
  const losingPar = {
    name: 'lowPar',
    type: 'par',
    fixtureType: 'UkingPar',
    fixtureConfig: { name: 'lowPar', controllerIp: LOW },
    patch: { universe: 7, addr: 1, footprint: 10 },
    channels: { r: 3, g: 4, b: 5 },
    r: 1, g: 0, b: 0, w: 0, a: 0, u: 0,
  };
  const router = fakeRouter();
  router.addUniverse(7);
  withSuppression(claims, () => mapPixelsToSacn([losingPar], router));
  assert.equal(router.getFullFrame(7)[0], 0, 'the losing par must not write the master dimmer');
});

// ── The unification statement, asserted on the plan the runtime publishes ────

test('overlapping claimants on one box are still ONE destination = one packet', () => {
  const plan = planUnifiedOutput([
    { label: 'a', ip: HIGH, universe: 7, start: 1, end: 10 },
    { label: 'b', ip: HIGH, universe: 7, start: 20, end: 30 },
  ]);
  assert.equal(plan.destinations.length, 1);
  assert.equal(plan.destinations[0].claims.length, 2);
});

test('lostChannelIndex keys by universe → losing IP, and never lists the winner', () => {
  const index = lostChannelIndex(planUnifiedOutput(CONTESTED_CLAIMS));
  assert.deepEqual([...index.keys()], [7]);
  assert.deepEqual([...index.get(7).keys()], [LOW]);
  assert.equal(index.get(7).get(HIGH), undefined);
  assert.deepEqual(index.get(7).get(LOW).map((r) => [r.start, r.end, r.winnerIp]),
    [[1, 3, HIGH]]);
});
