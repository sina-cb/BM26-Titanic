/**
 * shared_address_ui.test.js — the OPERATOR-FACING half of the shared-address
 * feature (operator emphasis 2026-07-31: *"but the UI must show that that's a
 * warning"*).
 *
 * What is pinned here:
 *  • the controller card renders a PERSISTENT ⚠ banner naming both claimants,
 *    the exact (universe, channel-range) and who wins;
 *  • the banner distinguishes the WARNING grade (resolvable, push proceeds) from
 *    the ERROR grade (unrankable, push refused) — different class, different text;
 *  • an overlap the higher-IP rule cannot rank still BLOCKS the push, with the
 *    reason named;
 *  • a controller the contest does not touch shows no banner at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planUnifiedOutput } from '../src/dmx/address_merge.js';
import {
  sharedAddressBannerModel,
  pushAllLedControllers,
} from '../src/gui/led_discovery_panel.js';
import {
  createControllerRegistry,
  CONTROLLER_TYPE_LED,
  CONTROLLER_PROTOCOL_SACN,
} from '../src/dmx/controller_registry.js';

const LOW = '10.0.0.9';
const HIGH = '10.0.0.10';

const claim = (label, ip, universe, start, end) => ({ label, ip, universe, start, end });

// ── The card banner ─────────────────────────────────────────────────────────

test('an uncontested card gets NO banner', () => {
  const plan = planUnifiedOutput([claim('a', LOW, 7, 1, 10)]);
  assert.equal(sharedAddressBannerModel(plan, { ip: LOW, name: 'A' }), null);
});

test('a card with no merge plan at all gets no banner (and does not throw)', () => {
  assert.equal(sharedAddressBannerModel(null, { ip: LOW }), null);
});

test('the WINNING card gets a warning banner that says it wins, and names the loser', () => {
  const plan = planUnifiedOutput([
    claim('LeftRail', LOW, 7, 1, 10),
    claim('BowStrand', HIGH, 7, 5, 20),
  ]);
  const model = sharedAddressBannerModel(plan, { ip: HIGH, name: 'BowBox' });
  assert.equal(model.blocking, false, 'a resolvable overlap is a WARNING, not an error');
  assert.match(model.headline, /^⚠ /);
  assert.match(model.headline, /1 shared address/);
  assert.match(model.headline, /higher IP overrides/);
  assert.equal(model.lines.length, 1);
  assert.match(model.lines[0], /U7 ch 5–10/, 'the exact contested range');
  assert.match(model.lines[0], /'LeftRail'/, 'names the other claimant');
  assert.match(model.lines[0], new RegExp(LOW.replace(/\./g, '\\.')), 'names its IP');
  assert.match(model.lines[0], /THIS card wins/);
});

test('the LOSING card gets the same banner, told from its side', () => {
  const plan = planUnifiedOutput([
    claim('LeftRail', LOW, 7, 1, 10),
    claim('BowStrand', HIGH, 7, 5, 20),
  ]);
  const model = sharedAddressBannerModel(plan, { ip: LOW, name: 'RailBox' });
  assert.equal(model.blocking, false);
  assert.match(model.lines[0], /U7 ch 5–10/);
  assert.match(model.lines[0], /'BowStrand' WINS and overrides this card/);
});

test('an UNRANKABLE overlap gets the ERROR grade — distinct headline and blocking flag', () => {
  const plan = planUnifiedOutput([
    claim('RailA', LOW, 7, 1, 10),
    claim('RailB', LOW, 7, 5, 20),   // SAME IP: nothing to rank
  ]);
  const model = sharedAddressBannerModel(plan, { ip: LOW, name: 'RailBox' });
  assert.equal(model.blocking, true);
  assert.match(model.headline, /^✋ /);
  assert.match(model.headline, /UNRESOLVABLE/);
  assert.match(model.headline, /REFUSED/);
  assert.match(model.lines[0], /SAME controller IP/);
});

test('a warning banner and an error banner are never the same headline', () => {
  const warn = sharedAddressBannerModel(planUnifiedOutput([
    claim('a', LOW, 7, 1, 10), claim('b', HIGH, 7, 5, 20),
  ]), { ip: LOW });
  const err = sharedAddressBannerModel(planUnifiedOutput([
    claim('a', LOW, 7, 1, 10), claim('b', LOW, 7, 5, 20),
  ]), { ip: LOW });
  assert.notEqual(warn.headline, err.headline);
  assert.notEqual(warn.blocking, err.blocking);
});

test('a third, uninvolved controller sees nothing', () => {
  const plan = planUnifiedOutput([
    claim('a', LOW, 7, 1, 10),
    claim('b', HIGH, 7, 5, 20),
  ]);
  assert.equal(sharedAddressBannerModel(plan, { ip: '10.0.0.77', name: 'Elsewhere' }), null);
});

// ── The push gate ───────────────────────────────────────────────────────────

function ledRegistry() {
  return createControllerRegistry({
    controllers: [{
      id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
      protocol: CONTROLLER_PROTOCOL_SACN,
      led: { order: 'RGBW', startAddr: 1 },
      device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
      ports: [{ port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] }],
    }],
  });
}

function makeCtx(registry, addressMergePlan) {
  return {
    registry: () => registry,
    strandLedCounts: () => ({ Left_Front_Left: 40 }),
    claimedUniverses: () => new Map(),
    addressMergePlan,
    mutate: (_m, fn) => fn(),
    refresh: () => {},
    showToast: () => {},
    activeScene: () => 'shared_address_ui',
  };
}

/** The device: ONE enabled output on U21, per-output-capable firmware. */
const deviceConfig = () => ({
  deviceName: 'LeftLeftFront',
  strands: [{ index: 0, enabled: true, count: 40, universe: 21, startAddress: 1 }],
});

function makeIo(calls) {
  return {
    getStatus: async () => ({
      controllerId: 'titanic_60', boardId: 'angio4', firmwareSHA: 'aa11bb22cc33',
      strands: deviceConfig().strands,
      capabilitiesExt: { perOutputDmx: true },
      sacn: {
        enabled: true,
        perOutput: calls.lastPlan
          ? Object.entries(calls.lastPlan).map(([index, universe]) =>
            ({ index: Number(index), universe, startAddress: 1, enabled: true }))
          : [],
      },
    }),
    getConfig: async () => deviceConfig(),
    pushPerOutputUniverses: async (ip, { plan }) => {
      calls.push(`push:${ip}`);
      calls.lastPlan = plan.universeByOutputIndex;
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => {},
  };
}

test('an UNRANKABLE shared address REFUSES the push, with the reason named', async () => {
  const registry = ledRegistry();
  // Two claims on this very controller's IP, on the same channels.
  const plan = planUnifiedOutput([
    claim('Left_Front_Left', '10.0.0.60', 21, 1, 160),
    claim('Ghost_Strand', '10.0.0.60', 21, 100, 200),
  ]);
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(registry, () => plan), makeIo(calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /push REFUSED/);
  assert.match(results[0].detail, /SAME controller IP 10\.0\.0\.60/);
  assert.equal(calls.includes('push:10.0.0.60'), false,
    'nothing may reach the device while the overlap has no deterministic winner');
});

test('an unrankable overlap ELSEWHERE does not hold this controller hostage', async () => {
  const registry = ledRegistry();
  const plan = planUnifiedOutput([
    claim('Other_A', '10.0.0.77', 30, 1, 10),
    claim('Other_B', '10.0.0.77', 30, 5, 20),
  ]);
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(registry, () => plan), makeIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.ok(calls.includes('push:10.0.0.60'));
});

test('a RESOLVABLE shared address pushes — the merge, not the gate, resolves it', async () => {
  const registry = ledRegistry();
  const plan = planUnifiedOutput([
    claim('Left_Front_Left', '10.0.0.60', 21, 1, 160),
    claim('Neighbour', '10.0.0.61', 21, 100, 200),
  ]);
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(registry, () => plan), makeIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.ok(calls.includes('push:10.0.0.60'));
});

test('a ctx with NO addressMergePlan still pushes (no overlap information ≠ an overlap)', async () => {
  const registry = ledRegistry();
  const calls = [];
  const results = await pushAllLedControllers(makeCtx(registry, undefined), makeIo(calls));
  assert.equal(results[0].state, 'pushed');
});

test('a MALFORMED addressMergePlan throws — never silently treated as "no overlaps"', async () => {
  const registry = ledRegistry();
  const calls = [];
  const results = await pushAllLedControllers(
    makeCtx(registry, () => ({ nonsense: true })), makeIo(calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /planUnifiedOutput result/);
  assert.equal(calls.includes('push:10.0.0.60'), false);
});
