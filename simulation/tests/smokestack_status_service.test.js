/**
 * smokestack_status_service.test.js — the read-only DMX ⇄ swarm glance
 * (server/smokestack_status_service.cjs) behind `POST /smokestack/status`.
 *
 * Every transport is injected (`opts.io.httpGetJson`) — no test here ever
 * opens a socket or names a routable host. The promises pinned:
 *   - two GETs per board (/api/status then /api/config), ZERO other calls;
 *   - an unreadable config yields `dmxEnabled: null` (mode unknown), never a
 *     guessed mode;
 *   - an unreachable / non-MarsinLED responder is a loud `reachable: false`
 *     RESULT, never an exception;
 *   - the sweep returns one result per target, in input order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  smokestackBoardStatus,
  smokestackStatusSweep,
} = require('../server/smokestack_status_service.cjs');

// TEST-NET-1 (RFC 5737) addresses only.
const ROPE_IP = '192.0.2.61';

function marsinStatusBody(overrides = {}) {
  return {
    controllerId: 'ss_left_left',
    boardId: 'angio4-new',
    firmwareTag: '1.2.5',
    fps: 40,
    swarm: {
      enabled: true, isLeader: false,
      follow: { state: 'FOLLOWING', lastBeaconMsAgo: 800 },
    },
    health: { configSource: 'primary', stagedPending: false, uptimeMs: 4242 },
    capabilitiesExt: { perOutputDmx: true, other: true },
    ...overrides,
  };
}

/** io fake: pathMap = { '/api/status': responseOrError, '/api/config': … }.
 * A value that is an Error rejects; anything else resolves as the res. */
function fakeIo(pathMap, calls = []) {
  return {
    httpGetJson: async (ip, urlPath) => {
      calls.push({ ip, urlPath });
      const entry = pathMap[urlPath];
      if (entry instanceof Error) throw entry;
      if (entry === undefined) throw new Error(`unexpected GET ${urlPath}`);
      return entry;
    },
  };
}

function errWithCode(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

test('happy path: status + config derive identity, swarm, health, caps and mode', async () => {
  const calls = [];
  const io = fakeIo({
    '/api/status': { status: 200, json: marsinStatusBody(), rttMs: 12 },
    '/api/config': { status: 200, json: { dmx: { enabled: false } }, rttMs: 8 },
  }, calls);

  const r = await smokestackBoardStatus({ id: 13, name: 'LeftLeftRopes', ip: ROPE_IP }, { io });
  assert.equal(r.reachable, true);
  assert.equal(r.controllerId, 'ss_left_left');
  assert.equal(r.dmxEnabled, false);
  assert.deepEqual(r.swarm, {
    enabled: true, isLeader: false, followState: 'FOLLOWING', lastBeaconMsAgo: 800,
  });
  assert.deepEqual(r.health, { configSource: 'primary', stagedPending: false, uptimeMs: 4242 });
  assert.deepEqual(r.capabilities, { perOutputDmx: true });
  assert.equal(r.firmwareTag, '1.2.5');
  // Exactly the two documented GETs — this service must never grow a probe.
  assert.deepEqual(calls.map((c) => c.urlPath), ['/api/status', '/api/config']);
  assert.ok(calls.every((c) => c.ip === ROPE_IP));
});

test('readback preserves independent dmx=true + swarm=true for model invalidation', async () => {
  const io = fakeIo({
    '/api/status': { status: 200, json: marsinStatusBody(), rttMs: 1 },
    '/api/config': { status: 200, json: { dmx: { enabled: true } }, rttMs: 1 },
  });
  const r = await smokestackBoardStatus({ id: 13, name: 'x', ip: ROPE_IP }, { io });
  assert.equal(r.dmxEnabled, true);
  assert.equal(r.swarm.enabled, true);
});

test('config unreadable ⇒ dmxEnabled null with the reason appended — never a guess', async () => {
  for (const configEntry of [
    { status: 500, json: null, rttMs: 1 },
    errWithCode('ETIMEDOUT'),
  ]) {
    const io = fakeIo({
      '/api/status': { status: 200, json: marsinStatusBody(), rttMs: 1 },
      '/api/config': configEntry,
    });
    // eslint-disable-next-line no-await-in-loop
    const r = await smokestackBoardStatus({ id: 13, name: 'x', ip: ROPE_IP }, { io });
    assert.equal(r.reachable, true);
    assert.equal(r.dmxEnabled, null);
    assert.match(r.detail, /mode unknown/);
  }
});

test('unreachable board is a RESULT with the code named, never a rejection', async () => {
  const io = fakeIo({ '/api/status': errWithCode('EHOSTUNREACH') });
  const r = await smokestackBoardStatus({ id: 13, name: 'x', ip: ROPE_IP }, { io });
  assert.equal(r.reachable, false);
  assert.match(r.detail, /EHOSTUNREACH/);
});

test('a non-MarsinLED responder is loud — reachable false, "check the IP"', async () => {
  const io = fakeIo({
    '/api/status': { status: 200, json: { hello: 'printer' }, rttMs: 1 },
  });
  const r = await smokestackBoardStatus({ id: 13, name: 'x', ip: ROPE_IP }, { io });
  assert.equal(r.reachable, false);
  assert.match(r.detail, /not with a MarsinLED/);
});

test('placeholder / missing / invalid IPs are refused without any call', async () => {
  const calls = [];
  const io = fakeIo({}, calls);
  for (const ip of ['', '0.0.0.0', 'not-an-ip', '512.1.1.1']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await smokestackBoardStatus({ id: 1, name: 'x', ip }, { io });
    assert.equal(r.reachable, false, ip);
    assert.match(r.detail, /not a probeable/);
  }
  assert.equal(calls.length, 0);
});

test('sweep: one result per target, in input order, mixed outcomes intact', async () => {
  const io = {
    httpGetJson: async (ip, urlPath) => {
      if (ip === '192.0.2.61') {
        if (urlPath === '/api/status') return { status: 200, json: marsinStatusBody(), rttMs: 1 };
        return { status: 200, json: { dmx: { enabled: false } }, rttMs: 1 };
      }
      throw errWithCode('ETIMEDOUT');
    },
  };
  const out = await smokestackStatusSweep([
    { id: 13, name: 'LeftLeftRopes', ip: '192.0.2.61' },
    { id: 24, name: 'RightRightRopes', ip: '192.0.2.65' },
    { id: 99, name: 'NoAddress', ip: '' },
  ], { io });
  assert.equal(out.results.length, 3);
  assert.deepEqual(out.results.map((r) => r.id), [13, 24, 99]);
  assert.equal(out.results[0].reachable, true);
  assert.equal(out.results[1].reachable, false);
  assert.equal(out.results[2].reachable, false);
  assert.ok(out.at);
});

test('sweep: empty / non-array targets yield an empty result set', async () => {
  assert.deepEqual((await smokestackStatusSweep([], {})).results, []);
  assert.deepEqual((await smokestackStatusSweep(undefined, {})).results, []);
});
