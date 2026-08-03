/**
 * address_merge.test.js — the shared-address feature's contract (operator order
 * 2026-07-31): overlapping claims are a WARNING, frames are UNIFIED into one
 * packet per destination, the HIGHER IP overrides on contested channels, and
 * anything the IP rule cannot rank stays a hard error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ipToNumber,
  compareClaimantIp,
  rangesOverlap,
  claimKey,
  findAddressOverlaps,
  planUnifiedOutput,
  assertResolvableOverlaps,
  suppressionIndex,
  channelIsSuppressed,
  composeUnifiedFrame,
  collectAddressClaims,
  overlapsForController,
  describeOverlapsForController,
} from '../src/dmx/address_merge.js';

const claim = (label, ip, universe, start, end, extra = {}) =>
  ({ label, ip, universe, start, end, ...extra });

// ── The IP comparison ───────────────────────────────────────────────────────

test('ipToNumber folds a dotted quad octet-wise, not as a string', () => {
  assert.equal(ipToNumber('0.0.0.1'), 1);
  assert.equal(ipToNumber('0.0.1.0'), 256);
  assert.equal(ipToNumber('10.0.0.10'), 10 * 2 ** 24 + 10);
  assert.equal(ipToNumber('255.255.255.255'), 4294967295);
});

test('ipToNumber stays UNSIGNED above 127.x (a `<< 24` shift would go negative)', () => {
  // 198.51.100.x is RFC 5737 TEST-NET-2 — a >127 first octet that is safe to
  // commit in a PUBLIC repo (the gitleaks `bm26-public-ip` rule allowlists the
  // documentation ranges, and a real routable address here would fail the gate).
  assert.ok(ipToNumber('192.168.1.1') > ipToNumber('10.0.0.254'));
  assert.ok(ipToNumber('198.51.100.1') > ipToNumber('127.0.0.1'));
  assert.ok(ipToNumber('198.51.100.1') > 0);
});

test('ipToNumber refuses everything that is not a rankable IPv4', () => {
  for (const bad of ['', '   ', '10.0.0', '10.0.0.256', '10.0.0.-1', '10.0.0.1.2',
    'controller-a', '::1', '10.0.0.01x', null, undefined, 42, '0.0.0.0']) {
    assert.equal(ipToNumber(bad), null, `expected ${JSON.stringify(bad)} to be unrankable`);
  }
});

test('the higher IP wins NUMERICALLY — the case string ordering gets backwards', () => {
  // As strings '10.0.0.9' > '10.0.0.10'. Numerically .10 is the higher address.
  assert.ok('10.0.0.9' > '10.0.0.10', 'precondition: string ordering disagrees');
  assert.equal(compareClaimantIp('10.0.0.10', '10.0.0.9'), 1);
  assert.equal(compareClaimantIp('10.0.0.9', '10.0.0.10'), -1);
});

test('compareClaimantIp returns 0 for the same address and null when unrankable', () => {
  assert.equal(compareClaimantIp('10.0.0.5', '10.0.0.5'), 0);
  assert.equal(compareClaimantIp('10.0.0.5', ''), null);
  assert.equal(compareClaimantIp('0.0.0.0', '10.0.0.5'), null);
});

test('rangesOverlap is inclusive on both ends', () => {
  assert.equal(rangesOverlap(1, 10, 10, 20), true);
  assert.equal(rangesOverlap(1, 10, 11, 20), false);
});

// ── Overlap detection ───────────────────────────────────────────────────────

test('two claims on one universe at DISJOINT channels are not an overlap', () => {
  const { overlaps, ambiguities } = findAddressOverlaps([
    claim('A', '10.0.0.5', 7, 1, 10),
    claim('B', '10.0.0.6', 7, 11, 20),
  ]);
  assert.equal(overlaps.length, 0);
  assert.equal(ambiguities.length, 0);
});

test('claims on DIFFERENT universes never contest, however they line up', () => {
  const { overlaps } = findAddressOverlaps([
    claim('A', '10.0.0.5', 7, 1, 512),
    claim('B', '10.0.0.6', 8, 1, 512),
  ]);
  assert.equal(overlaps.length, 0);
});

test('the contested region is the INTERSECTION, not either whole claim', () => {
  const { overlaps } = findAddressOverlaps([
    claim('par', '10.0.0.5', 7, 10, 13),
    claim('strand', '10.0.0.6', 7, 12, 20),
  ]);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].start, 12);
  assert.equal(overlaps[0].end, 13);
  assert.equal(overlaps[0].winner.label, 'strand');
  assert.equal(overlaps[0].loser.label, 'par');
});

test('the overlap message names both claimants, the range and the winner', () => {
  const { overlaps } = findAddressOverlaps([
    claim('par', '10.0.0.5', 7, 10, 13),
    claim('strand', '10.0.0.6', 7, 12, 20),
  ]);
  const m = overlaps[0].message;
  assert.match(m, /U7 ch 12–13/);
  assert.match(m, /'par'/);
  assert.match(m, /'strand'/);
  assert.match(m, /10\.0\.0\.6 wins/);
});

test('detection is deterministic — same claims in any input order, same result', () => {
  const claims = [
    claim('c', '10.0.0.7', 3, 30, 40),
    claim('a', '10.0.0.5', 3, 1, 35),
    claim('b', '10.0.0.6', 3, 20, 25),
  ];
  const first = findAddressOverlaps(claims).overlaps.map((o) => o.message);
  const second = findAddressOverlaps([...claims].reverse()).overlaps.map((o) => o.message);
  assert.deepEqual(second, first);
});

test('three-way contest produces one resolved pair per contesting pair', () => {
  const { overlaps } = findAddressOverlaps([
    claim('a', '10.0.0.5', 3, 1, 20),
    claim('b', '10.0.0.6', 3, 1, 20),
    claim('c', '10.0.0.7', 3, 1, 20),
  ]);
  assert.equal(overlaps.length, 3);
  // Every pair is ranked by the higher IP.
  for (const o of overlaps) {
    assert.ok(ipToNumber(o.winner.ip) > ipToNumber(o.loser.ip));
  }
});

// ── Ambiguity stays a hard error ────────────────────────────────────────────

test('two overlapping claims on the SAME IP are ambiguous, never a tie-break', () => {
  const { overlaps, ambiguities } = findAddressOverlaps([
    claim('a', '10.0.0.5', 3, 1, 20),
    claim('b', '10.0.0.5', 3, 10, 30),
  ]);
  assert.equal(overlaps.length, 0);
  assert.equal(ambiguities.length, 1);
  assert.equal(ambiguities[0].reason, 'same_ip');
  assert.match(ambiguities[0].message, /same controller IP 10\.0\.0\.5/i);
});

test('an overlapping claim with no / placeholder / malformed IP is ambiguous', () => {
  for (const bad of ['', '0.0.0.0', 'not-an-ip', undefined]) {
    const { ambiguities } = findAddressOverlaps([
      claim('good', '10.0.0.5', 3, 1, 20),
      claim('bad', bad, 3, 10, 30),
    ]);
    assert.equal(ambiguities.length, 1, `expected ${JSON.stringify(bad)} to be unrankable`);
    assert.equal(ambiguities[0].reason, 'unrankable_ip');
    assert.match(ambiguities[0].message, /'bad'/);
  }
});

test('assertResolvableOverlaps passes on resolved overlaps and THROWS on ambiguity', () => {
  const ok = planUnifiedOutput([
    claim('a', '10.0.0.5', 3, 1, 20),
    claim('b', '10.0.0.6', 3, 10, 30),
  ]);
  assert.doesNotThrow(() => assertResolvableOverlaps(ok));

  const bad = planUnifiedOutput([
    claim('a', '10.0.0.5', 3, 1, 20),
    claim('b', '10.0.0.5', 3, 10, 30),
  ]);
  assert.throws(() => assertResolvableOverlaps(bad), /UNRESOLVABLE shared address/);
  assert.throws(() => assertResolvableOverlaps(bad), /SAME controller IP/);
});

test('a structurally broken claim throws (a caller bug, not operator state)', () => {
  assert.throws(() => findAddressOverlaps([claim('a', '10.0.0.5', 0, 1, 20)]), /valid universe/);
  assert.throws(() => findAddressOverlaps([claim('a', '10.0.0.5', 3, 20, 1)]), /channel range/);
  assert.throws(() => findAddressOverlaps([claim('', '10.0.0.5', 3, 1, 20)]), /no label/);
  assert.throws(() => findAddressOverlaps('nope'), /must be an array/);
});

// ── Packet unification: ONE packet per (universe, IP) ───────────────────────

test('a destination appears EXACTLY ONCE however many claimants feed it', () => {
  const plan = planUnifiedOutput([
    claim('a', '10.0.0.5', 7, 1, 10),
    claim('b', '10.0.0.5', 7, 11, 20),
    claim('c', '10.0.0.5', 7, 21, 30),
  ]);
  assert.equal(plan.destinations.length, 1);
  assert.deepEqual(
    { universe: plan.destinations[0].universe, ip: plan.destinations[0].ip },
    { universe: 7, ip: '10.0.0.5' });
  assert.equal(plan.destinations[0].claims.length, 3);
});

test('two controllers sharing a universe are two destinations, one packet each', () => {
  const plan = planUnifiedOutput([
    claim('a', '10.0.0.5', 7, 1, 20),
    claim('b', '10.0.0.6', 7, 10, 30),
  ]);
  assert.equal(plan.destinations.length, 2);
  assert.deepEqual(plan.destinations.map((d) => `U${d.universe}→${d.ip}`),
    ['U7→10.0.0.5', 'U7→10.0.0.6']);
});

test('a placeholder / missing IP is never a destination — nothing is sent there', () => {
  const plan = planUnifiedOutput([
    claim('a', '10.0.0.5', 7, 1, 20),
    claim('unwired', '0.0.0.0', 7, 30, 40),
    claim('blank', '', 7, 50, 60),
  ]);
  assert.deepEqual(plan.destinations.map((d) => d.ip), ['10.0.0.5']);
});

// ── Byte-level: the higher IP overrides on the contested channels ───────────

test('composeUnifiedFrame: the higher IP writes LAST and owns the overlap', () => {
  const low = claim('low', '10.0.0.9', 7, 1, 4);
  const high = claim('high', '10.0.0.10', 7, 3, 6);
  const frame = composeUnifiedFrame({ universe: 7, ip: '10.0.0.99' }, [
    // Deliberately handed in "winner first" order — ordering is the function's job.
    { claim: high, bytes: Uint8Array.from([200, 201, 202, 203]) },
    { claim: low, bytes: Uint8Array.from([11, 12, 13, 14]) },
  ]);
  assert.equal(frame.length, 512);
  // ch1–2 uncontested → the low claim's own bytes.
  assert.deepEqual([...frame.slice(0, 2)], [11, 12]);
  // ch3–4 contested → the HIGHER IP (10.0.0.10) overrides.
  assert.deepEqual([...frame.slice(2, 4)], [200, 201]);
  // ch5–6 uncontested → the high claim's own bytes.
  assert.deepEqual([...frame.slice(4, 6)], [202, 203]);
  // everything else is black.
  assert.deepEqual([...frame.slice(6, 12)], [0, 0, 0, 0, 0, 0]);
});

test('composeUnifiedFrame result does not depend on contribution order', () => {
  const a = claim('a', '10.0.0.20', 2, 1, 3);
  const b = claim('b', '10.0.0.30', 2, 2, 4);
  const contributions = [
    { claim: a, bytes: [1, 2, 3] },
    { claim: b, bytes: [90, 91, 92] },
  ];
  const forwards = composeUnifiedFrame({ universe: 2, ip: 'x' }, contributions);
  const backwards = composeUnifiedFrame({ universe: 2, ip: 'x' }, [...contributions].reverse());
  assert.deepEqual([...forwards.slice(0, 5)], [...backwards.slice(0, 5)]);
  assert.deepEqual([...forwards.slice(0, 5)], [1, 90, 91, 92, 0]);
});

test('composeUnifiedFrame drops contributions for a different universe', () => {
  const here = claim('here', '10.0.0.5', 7, 1, 2);
  const elsewhere = claim('elsewhere', '10.0.0.9', 8, 1, 2);
  const frame = composeUnifiedFrame({ universe: 7, ip: '10.0.0.5' }, [
    { claim: here, bytes: [5, 6] },
    { claim: elsewhere, bytes: [77, 88] },
  ]);
  assert.deepEqual([...frame.slice(0, 2)], [5, 6]);
});

test('composeUnifiedFrame REFUSES an unrankable contributor on the write path', () => {
  assert.throws(() => composeUnifiedFrame({ universe: 7, ip: '10.0.0.5' }, [
    { claim: claim('ok', '10.0.0.5', 7, 1, 2), bytes: [1, 2] },
    { claim: claim('nope', '', 7, 1, 2), bytes: [3, 4] },
  ]), /no rankable controller IP/);
});

test('composeUnifiedFrame clamps writes to the 512-channel frame', () => {
  const spill = claim('spill', '10.0.0.5', 7, 511, 514);
  const frame = composeUnifiedFrame({ universe: 7, ip: '10.0.0.5' },
    [{ claim: spill, bytes: [1, 2, 3, 4] }]);
  assert.deepEqual([...frame.slice(510, 512)], [1, 2]);
});

// ── Suppression: the loser's side, for the shared-buffer write path ─────────

test('suppressionIndex names ONLY the contested channels of the losing claim', () => {
  const par = claim('par', '10.0.0.5', 7, 10, 13);
  const strand = claim('strand', '10.0.0.6', 7, 12, 20);
  const index = suppressionIndex(planUnifiedOutput([par, strand]));
  const ranges = index.get(claimKey(par));
  assert.ok(ranges, 'the loser must be in the index');
  assert.deepEqual(ranges.map((r) => [r.universe, r.start, r.end]), [[7, 12, 13]]);
  assert.equal(ranges[0].winnerIp, '10.0.0.6');
  // The WINNER is never suppressed.
  assert.equal(index.get(claimKey(strand)), undefined);
});

test('channelIsSuppressed answers per absolute channel, and is cheap when empty', () => {
  const par = claim('par', '10.0.0.5', 7, 10, 13);
  const strand = claim('strand', '10.0.0.6', 7, 12, 20);
  const ranges = suppressionIndex(planUnifiedOutput([par, strand])).get(claimKey(par));
  assert.equal(channelIsSuppressed(ranges, 7, 11), false);
  assert.equal(channelIsSuppressed(ranges, 7, 12), true);
  assert.equal(channelIsSuppressed(ranges, 7, 13), true);
  assert.equal(channelIsSuppressed(ranges, 7, 14), false);
  assert.equal(channelIsSuppressed(ranges, 8, 12), false, 'a different universe is never suppressed');
  assert.equal(channelIsSuppressed(undefined, 7, 12), false);
  assert.equal(channelIsSuppressed([], 7, 12), false);
});

// ── Claim collection from the two live projections ─────────────────────────

test('collectAddressClaims resolves DMX claims by STABLE id and LED claims by ORDINAL', () => {
  const controllers = [
    { id: 42, name: 'LeftFrontDeck', ip: '10.0.0.5' },   // ordinal 1, stable id 42
    { id: 7, name: 'titanic_202', ip: '10.0.0.6' },      // ordinal 2, stable id 7
  ];
  const claims = collectAddressClaims({
    dmxUniverseMaps: new Map([[23, [
      { start: 1, end: 10, name: 'ParA', controllerId: 42, controllerName: 'LeftFrontDeck', portNum: 1 },
    ]]]),
    ledClaims: new Map([[23, [
      { start: 5, end: 100, name: 'Strand1', controllerId: 2, portNum: 1, led: true },
    ]]]),
    controllers,
  });
  const dmx = claims.find((c) => c.kind === 'dmx');
  const led = claims.find((c) => c.kind === 'led');
  assert.equal(dmx.ip, '10.0.0.5', 'DMX claim must resolve through the STABLE id');
  assert.equal(led.ip, '10.0.0.6', 'LED claim must resolve through the PANEL ORDINAL');
});

test('collectAddressClaims exempts gang-firing global-effect pins', () => {
  const claims = collectAddressClaims({
    dmxUniverseMaps: new Map([[1, [
      { start: 10, end: 11, name: 'Fog A', controllerId: 1, controllerName: 'C', portNum: 1, effect: true },
      { start: 10, end: 11, name: 'Fog B', controllerId: 1, controllerName: 'C', portNum: 2, effect: true },
    ]]]),
    ledClaims: new Map(),
    controllers: [{ id: 1, name: 'C', ip: '10.0.0.5' }],
  });
  assert.equal(claims.length, 0);
  assert.equal(findAddressOverlaps(claims).ambiguities.length, 0);
});

test('collectAddressClaims fails loudly on the wrong source shapes', () => {
  assert.throws(() => collectAddressClaims(null), /sources/);
  assert.throws(() => collectAddressClaims({ dmxUniverseMaps: {}, ledClaims: new Map(), controllers: [] }),
    /dmxUniverseMaps must be a Map/);
  assert.throws(() => collectAddressClaims({ dmxUniverseMaps: new Map(), ledClaims: {}, controllers: [] }),
    /ledClaims must be a Map/);
  assert.throws(() => collectAddressClaims({ dmxUniverseMaps: new Map(), ledClaims: new Map(), controllers: null }),
    /controllers must be/);
});

// ── The per-controller view the card banner renders ────────────────────────

test('overlapsForController splits wins / loses / ambiguous from the card POV', () => {
  const plan = planUnifiedOutput([
    claim('mine', '10.0.0.6', 7, 1, 20),
    claim('lower', '10.0.0.5', 7, 10, 30),
    claim('higher', '10.0.0.9', 7, 15, 40),
    claim('unwired', '', 7, 18, 19),
  ]);
  const view = overlapsForController(plan, { ip: '10.0.0.6', name: 'mine-card' });
  assert.equal(view.wins.length, 1);
  assert.equal(view.wins[0].loser.label, 'lower');
  assert.equal(view.loses.length, 1);
  assert.equal(view.loses[0].winner.label, 'higher');
  assert.equal(view.ambiguous.length, 1);
  assert.equal(view.total, 3);
});

test('a controller with no IP is never credited with somebody else\'s overlaps', () => {
  const plan = planUnifiedOutput([
    claim('a', '10.0.0.5', 7, 1, 20),
    claim('b', '10.0.0.6', 7, 10, 30),
  ]);
  assert.equal(overlapsForController(plan, { ip: '', name: 'blank' }).total, 0);
  assert.equal(overlapsForController(plan, {}).total, 0);
});

test('describeOverlapsForController says who wins, in the card\'s own voice', () => {
  const plan = planUnifiedOutput([
    claim('mine', '10.0.0.6', 7, 1, 20),
    claim('lower', '10.0.0.5', 7, 10, 30),
    claim('higher', '10.0.0.9', 7, 15, 40),
  ]);
  const lines = describeOverlapsForController(overlapsForController(plan, { ip: '10.0.0.6' }));
  assert.ok(lines.some((l) => /THIS card wins/.test(l) && /'lower'/.test(l)));
  assert.ok(lines.some((l) => /'higher' WINS and overrides this card/.test(l)));
});
