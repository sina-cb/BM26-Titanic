/**
 * sacn_receiver_boot.test.js — the boot-time correctness of the sACN INPUT
 * Receiver (lib/sacn_receiver_boot.cjs), plus a LIVE end-to-end pin that the
 * crash it exists to kill is actually dead.
 *
 * The failure it guards is report 20260725_99: the bridge subscribed a universe
 * synchronously at boot, the `sacn` package's own join loop (deferred to the
 * socket's `listening` callback, iterating the SAME array) then joined it a
 * second time, Windows answered `addMembership EINVAL`, the package re-emitted
 * it as an unhandled `'error'` event, and the whole input bridge died before
 * relaying a single frame.
 *
 * The last test drives the REAL `sacn` Receiver through both orderings, so a
 * future refactor that moves the boot recompute back ahead of `listening` fails
 * here instead of on the playa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  listIpv4Interfaces, resolveMulticastInterface, createBootGate,
  classifyReceiverError, checkBootSubscriptionInvariant,
} = require('../lib/sacn_receiver_boot.cjs');
const { Receiver } = require('sacn');

/** A two-NIC box: one wired lighting LAN, one VPN adapter, plus loopback. */
const TWO_NIC = {
  'Ethernet': [
    { family: 'IPv4', address: '10.9.9.5', netmask: '255.255.255.0', internal: false },
    { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false },
  ],
  'VPN': [{ family: 'IPv4', address: '172.31.0.7', netmask: '255.255.0.0', internal: false }],
  'Loopback Pseudo-Interface 1': [
    { family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true },
  ],
};

// ── listIpv4Interfaces ─────────────────────────────────────────────────────

test('listIpv4Interfaces keeps external IPv4 only — no loopback, no IPv6', () => {
  const got = listIpv4Interfaces(TWO_NIC);
  assert.deepEqual(got.map(c => c.address), ['10.9.9.5', '172.31.0.7']);
  assert.deepEqual(got.map(c => c.name), ['Ethernet', 'VPN']);
});

test('listIpv4Interfaces accepts both family shapes (string and numeric)', () => {
  const got = listIpv4Interfaces({
    A: [{ family: 4, address: '10.9.9.5', netmask: '255.255.255.0', internal: false }],
  });
  assert.deepEqual(got.map(c => c.address), ['10.9.9.5']);
});

// ── resolveMulticastInterface ──────────────────────────────────────────────

test('no sacn_interface = OS default, unchanged behavior, and it SAYS so', () => {
  const r = resolveMulticastInterface({ requested: null, interfaces: TWO_NIC });
  assert.equal(r.iface, undefined, 'iface must stay undefined — that is what shipped');
  assert.equal(r.source, 'os-default');
  assert.match(r.report.join('\n'), /OS DEFAULT/);
  assert.match(r.report.join('\n'), /10\.9\.9\.5/, 'the inventory must name every candidate');
  assert.match(r.report.join('\n'), /⚠ 2 IPv4 interfaces are up/,
    'two NICs means the OS choice is a coin flip — warn');
});

test('a single-NIC box gets no multi-interface warning', () => {
  const r = resolveMulticastInterface({
    requested: '',
    interfaces: { 'Wi-Fi': [{ family: 'IPv4', address: '10.9.9.5', netmask: '255.255.255.0', internal: false }] },
  });
  assert.equal(r.iface, undefined);
  assert.equal(r.report.filter(l => l.startsWith('⚠')).length, 0);
});

test('a box with NO external IPv4 is called out — that IS the classic EINVAL condition', () => {
  const r = resolveMulticastInterface({
    requested: undefined,
    interfaces: { 'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }] },
  });
  assert.equal(r.candidates.length, 0);
  const text = r.report.join('\n');
  assert.match(text, /No external IPv4 interface is up/);
  assert.match(text, /UNICAST/, 'must state exactly what still works');
});

test('sacn_interface pins the join by address', () => {
  const r = resolveMulticastInterface({ requested: '10.9.9.5', interfaces: TWO_NIC });
  assert.equal(r.iface, '10.9.9.5');
  assert.equal(r.source, 'config');
  assert.match(r.report[0], /pinned by sacn_interface/);
});

test('sacn_interface pins the join by adapter name too', () => {
  const r = resolveMulticastInterface({ requested: ' VPN ', interfaces: TWO_NIC });
  assert.equal(r.iface, '172.31.0.7');
});

test('a sacn_interface that matches nothing THROWS — never a silent switch to another NIC', () => {
  assert.throws(
    () => resolveMulticastInterface({ requested: '10.9.9.99', interfaces: TWO_NIC }),
    (err) => /matches no external IPv4 interface/.test(err.message)
      && /10\.9\.9\.5/.test(err.message)      // inventory is in the message
      && /172\.31\.0\.7/.test(err.message),
  );
});

test('an adapter carrying two IPv4 addresses is ambiguous, not a guess', () => {
  assert.throws(() => resolveMulticastInterface({
    requested: 'Ethernet',
    interfaces: {
      'Ethernet': [
        { family: 'IPv4', address: '10.9.9.5', netmask: '255.255.255.0', internal: false },
        { family: 'IPv4', address: '10.9.9.6', netmask: '255.255.255.0', internal: false },
      ],
    },
  }), /ambiguous/);
});

// ── createBootGate ─────────────────────────────────────────────────────────

test('the boot gate holds work until it opens, then replays the held reason', () => {
  const deferred = [];
  const gate = createBootGate({ onDefer: (r) => deferred.push(r) });

  assert.equal(gate.isOpen(), false);
  assert.equal(gate.guard('boot'), false, 'nothing may subscribe before the socket listens');
  assert.deepEqual(deferred, ['boot'], 'every deferral is logged — never silent');

  assert.equal(gate.open(), 'boot', 'the held reason comes back for replay');
  assert.equal(gate.isOpen(), true);
  assert.equal(gate.guard('engine poll'), true, 'after opening, callers run inline');
  assert.deepEqual(deferred, ['boot'], 'and nothing more is deferred');
});

test('the boot gate replays the LATEST held reason and only once', () => {
  const gate = createBootGate({ onDefer: () => {} });
  gate.guard('boot');
  gate.guard('engine poll');
  assert.equal(gate.open(), 'engine poll');
  assert.equal(gate.open(), null, 'a second open has nothing left to replay');
});

test('a gate that was never guarded opens with nothing to replay', () => {
  const gate = createBootGate({ onDefer: () => { throw new Error('must not defer'); } });
  assert.equal(gate.open(), null);
});

// ── classifyReceiverError ──────────────────────────────────────────────────

test('an addMembership failure is loud but NOT fatal — it matches the runtime isolation', () => {
  const err = Object.assign(new Error('addMembership EINVAL'), { code: 'EINVAL', syscall: 'addMembership' });
  const c = classifyReceiverError(err, '10.9.9.5');
  assert.equal(c.fatal, false);
  assert.match(c.message, /Multicast JOIN FAILED/);
  assert.match(c.message, /10\.9\.9\.5/, 'the interface must be named — that is the whole diagnosis');
  assert.match(c.message, /UNICAST .*still arrives/);
  assert.match(c.message, /sacn_interface/, 'and it must say how to fix it');
});

test('any other socket error is FATAL — a bridge that receives nothing must not limp', () => {
  const err = Object.assign(new Error('bind EADDRINUSE 0.0.0.0:5568'), { code: 'EADDRINUSE', syscall: 'bind' });
  const c = classifyReceiverError(err, 'OS default');
  assert.equal(c.fatal, true);
  assert.match(c.message, /EADDRINUSE/);
  assert.match(c.message, /cannot receive a single frame/);
});

test('classifyReceiverError survives a non-Error value', () => {
  const c = classifyReceiverError('kaboom', 'OS default');
  assert.equal(c.fatal, true);
  assert.match(c.message, /kaboom/);
});

// ── checkBootSubscriptionInvariant ─────────────────────────────────────────

test('the boot invariant passes when nothing subscribed ahead of the join loop', () => {
  const r = checkBootSubscriptionInvariant(new Set([1, 2, 30]), [1, 2, 30]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.extra, []);
});

test('the boot invariant NAMES the universes that raced in', () => {
  const r = checkBootSubscriptionInvariant(new Set([1, 2]), [1, 2, 38, 39]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extra, [38, 39]);
  assert.match(r.message, /38, 39/);
  assert.match(r.message, /addMembership EINVAL/, 'the message must name the symptom it predicts');
  assert.match(r.message, /do not retry/, 'this is an ordering bug, not a transient');
});

// ── LIVE: the crash itself, against the real package ───────────────────────

/**
 * Drive a real Receiver and resolve with what happened. `subscribeEarly: true`
 * reproduces the pre-fix ordering (subscribe synchronously, before the socket
 * is listening); `false` is the fixed ordering (subscribe from `listening`).
 *
 * `port` is a HIGH throwaway port, never the E1.31 5568 the live stack owns.
 */
function driveReceiver({ port, subscribeEarly }) {
  return new Promise((resolve) => {
    const receiver = new Receiver({ universes: [1, 2], port, reuseAddr: true });
    let error = null;
    receiver.on('error', (err) => { error = err; });
    const subscribe = () => receiver.addUniverse(38);
    if (subscribeEarly) subscribe();
    else receiver.socket.on('listening', subscribe);
    setTimeout(() => {
      const universes = [...receiver.universes];
      receiver.close(() => resolve({ error, universes }));
    }, 250);
  });
}

test('LIVE: subscribing BEFORE the socket listens double-joins and errors (the 20260725_99 crash)', async () => {
  const { error } = await driveReceiver({ port: 45568, subscribeEarly: true });
  // The duplicate IP_ADD_MEMBERSHIP is EINVAL on Windows; other platforms may
  // tolerate it. Either way the assertion that matters is the one below: the
  // FIXED ordering must never produce an error.
  if (error) {
    assert.equal(error.syscall, 'addMembership');
    assert.equal(classifyReceiverError(error, 'OS default').fatal, false,
      'and this is exactly the error the bridge now handles instead of dying on');
  }
});

test('LIVE: subscribing from the listening handler joins once and never errors', async () => {
  const { error, universes } = await driveReceiver({ port: 45569, subscribeEarly: false });
  assert.equal(error, null, `the fixed ordering must not emit any receiver error (got ${error && error.message})`);
  assert.deepEqual(universes, [1, 2, 38], 'and the late universe is still subscribed');
});
