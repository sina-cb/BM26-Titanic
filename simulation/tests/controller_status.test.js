/**
 * controller_status.test.js — the PURE model behind the controller pane's
 * reachability dot and its LED binding-grade badge (report 20260725_96).
 *
 * The two facts must stay independent and both must stay honest: a probe we
 * never performed renders UNKNOWN (never OFFLINE), and a PROVISIONAL card that
 * is OFFLINE is the normal healthy shape of the feature, not an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controllerProbeTargets,
  controllerStatusModel,
  ledBindingBadgeModel,
  mergeProbeResults,
  shouldAttemptFirstContact,
  canMarkProvisional,
  PROBE_STATE_ONLINE,
  PROBE_STATE_OFFLINE,
  PROBE_STATE_UNKNOWN,
  PROBE_STATE_CHECKING,
  PLACEHOLDER_IP,
} from '../src/dmx/controller_status.js';
import {
  createControllerRegistry,
  markControllerProvisional,
  CONTROLLER_TYPE_LED,
  CONTROLLER_TYPE_DMX,
  LED_BINDING_PROVISIONAL,
  LED_BINDING_VERIFIED,
} from '../src/dmx/controller_registry.js';

function mixedRegistry() {
  return createControllerRegistry({
    nextControllerId: 5,
    controllers: [
      { id: 1, name: 'Bow DMX', ip: '10.9.9.5', type: CONTROLLER_TYPE_DMX,
        ports: [{ port: 1, universe: 2, chain: [] }] },
      { id: 2, name: 'RightRightRopes', ip: '10.9.9.207', type: CONTROLLER_TYPE_LED,
        led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 36, chain: [] }],
        device: { vendor: 'marsinled', provisional: true } },
      { id: 3, name: 'LeftLeftRopes', ip: '10.9.9.201', type: CONTROLLER_TYPE_LED,
        led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 30, chain: [] }],
        device: { vendor: 'marsinled', controllerId: 'titanic_201', boardId: 'angio4' } },
      { id: 4, name: 'TeSigns-PLACEHOLDER', ip: PLACEHOLDER_IP, type: CONTROLLER_TYPE_DMX,
        ports: [{ port: 1, universe: 38, chain: [] }] },
    ],
  });
}

// ── Probe targets ───────────────────────────────────────────────────────────

test('probe targets: one per card, in pane order, typed', () => {
  const targets = controllerProbeTargets(mixedRegistry());
  assert.deepEqual(targets.map((t) => [t.id, t.type]),
    [[1, 'DMX'], [2, 'LED'], [3, 'LED'], [4, 'DMX']]);
});

test('probe targets INCLUDE the placeholder and the IP-less — the server answers UNKNOWN', () => {
  const targets = controllerProbeTargets(mixedRegistry());
  const placeholder = targets.find((t) => t.id === 4);
  assert.equal(placeholder.ip, PLACEHOLDER_IP,
    'filtering it out here would leave that card with a blank dot and no explanation');
});

test('probe targets on an empty/absent registry is []', () => {
  assert.deepEqual(controllerProbeTargets(null), []);
  assert.deepEqual(controllerProbeTargets({ controllers: [] }), []);
});

// ── Merging verdicts ────────────────────────────────────────────────────────

test('mergeProbeResults folds by controller id and drops ids the pane no longer has', () => {
  const cache = new Map();
  mergeProbeResults(cache, {
    results: [
      { id: 1, state: PROBE_STATE_ONLINE },
      { id: 99, state: PROBE_STATE_ONLINE },
    ],
  }, new Set([1, 2, 3, 4]));
  assert.equal(cache.size, 1);
  assert.equal(cache.get(1).state, PROBE_STATE_ONLINE);
});

test('mergeProbeResults on a malformed response changes nothing', () => {
  const cache = new Map([[1, { state: PROBE_STATE_ONLINE }]]);
  mergeProbeResults(cache, null);
  mergeProbeResults(cache, {});
  assert.equal(cache.size, 1);
  assert.equal(cache.get(1).state, PROBE_STATE_ONLINE,
    'a broken sweep must never overwrite a verdict we legitimately have');
});

// ── The status dot ──────────────────────────────────────────────────────────

test('no verdict yet renders UNKNOWN and says so — never a guessed OFFLINE', () => {
  const reg = mixedRegistry();
  const model = controllerStatusModel(reg.controllers[0], null);
  assert.equal(model.state, PROBE_STATE_UNKNOWN);
  assert.equal(model.cls, 'cm-status-unknown');
  assert.match(model.title, /No probe has answered/);
});

test('mid-sweep with no verdict renders CHECKING, not UNKNOWN', () => {
  const reg = mixedRegistry();
  const model = controllerStatusModel(reg.controllers[0], null, { sweeping: true });
  assert.equal(model.state, PROBE_STATE_CHECKING);
});

test('the dot carries the PER-TYPE probe explanation', () => {
  const reg = mixedRegistry();
  assert.match(controllerStatusModel(reg.controllers[1], null).title,
    /do not answer ICMP/, 'an LED card must explain why it is probed over HTTP');
  assert.match(controllerStatusModel(reg.controllers[0], null).title,
    /refused connection is itself proof/, 'a DMX card must explain the TCP verdict');
});

test('every dot states that reachability is NOT proof of sACN frames', () => {
  const reg = mixedRegistry();
  for (const c of reg.controllers) {
    assert.match(controllerStatusModel(c, { state: PROBE_STATE_ONLINE, at: '2026-07-31T00:00:00Z' }).title,
      /does NOT prove sACN frames/);
  }
});

test('online / offline render distinctly and carry the probe detail', () => {
  const reg = mixedRegistry();
  const online = controllerStatusModel(reg.controllers[2],
    { state: PROBE_STATE_ONLINE, detail: 'MarsinLED titanic_201 (angio4)', at: '2026-07-31T00:00:00Z', rttMs: 8 });
  assert.equal(online.label, 'ONLINE');
  assert.equal(online.cls, 'cm-status-online');
  assert.match(online.title, /MarsinLED titanic_201/);
  assert.match(online.title, /8 ms/);

  const offline = controllerStatusModel(reg.controllers[2],
    { state: PROBE_STATE_OFFLINE, detail: 'ETIMEDOUT — no answer on :80', at: '2026-07-31T00:00:00Z' });
  assert.equal(offline.label, 'OFFLINE');
  assert.equal(offline.cls, 'cm-status-offline');
  assert.match(offline.title, /ETIMEDOUT/);
});

// ── The binding-grade badge ─────────────────────────────────────────────────

test('a PROVISIONAL card shows a loud, explicit badge (never a hidden flag)', () => {
  const reg = mixedRegistry();
  const badge = ledBindingBadgeModel(reg.controllers[1]);
  assert.equal(badge.grade, LED_BINDING_PROVISIONAL);
  assert.equal(badge.label, '⚑ PROVISIONAL');
  assert.equal(badge.cls, 'cm-binding-provisional');
  assert.match(badge.title, /patched exactly as if it were verified/);
  assert.match(badge.title, /promotes this card to VERIFIED/);
});

test('a VERIFIED card names the fingerprint it is bound to', () => {
  const reg = mixedRegistry();
  const badge = ledBindingBadgeModel(reg.controllers[2]);
  assert.equal(badge.grade, LED_BINDING_VERIFIED);
  assert.match(badge.title, /titanic_201/);
  assert.match(badge.title, /identity is the controllerId, not the IP/);
});

test('DMX cards and unbound LED cards get NO grade badge', () => {
  const reg = mixedRegistry();
  assert.equal(ledBindingBadgeModel(reg.controllers[0]), null);
  const unbound = createControllerRegistry({
    controllers: [{ id: 1, name: 'L', ip: '10.9.9.9', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 40, chain: [] }] }],
  }).controllers[0];
  assert.equal(ledBindingBadgeModel(unbound), null);
});

test('PROVISIONAL + OFFLINE is a coherent, expected pair (the whole point of the feature)', () => {
  const reg = mixedRegistry();
  const card = reg.controllers[1];
  const status = controllerStatusModel(card, { state: PROBE_STATE_OFFLINE, detail: 'ETIMEDOUT' });
  const badge = ledBindingBadgeModel(card);
  assert.equal(status.state, PROBE_STATE_OFFLINE);
  assert.equal(badge.grade, LED_BINDING_PROVISIONAL);
  // The two never merge into one verdict: reachability says nothing about the
  // binding, and the binding says nothing about reachability.
  assert.notEqual(status.cls, badge.cls);
});

// ── First contact trigger ───────────────────────────────────────────────────

test('first contact fires for a PROVISIONAL card that came back ONLINE with a fingerprint', () => {
  const reg = mixedRegistry();
  assert.equal(shouldAttemptFirstContact(reg.controllers[1], {
    state: PROBE_STATE_ONLINE, device: { controllerId: 'titanic_207' },
  }), true);
});

test('first contact does NOT fire on an ONLINE answer with no fingerprint', () => {
  const reg = mixedRegistry();
  assert.equal(shouldAttemptFirstContact(reg.controllers[1],
    { state: PROBE_STATE_ONLINE, device: null, unrecognized: true }), false,
  'somebody else answering on :80 must not raise a reconcile dialog');
});

test('first contact does NOT fire for offline, unknown, verified or DMX cards', () => {
  const reg = mixedRegistry();
  const dev = { controllerId: 'titanic_207' };
  assert.equal(shouldAttemptFirstContact(reg.controllers[1], { state: PROBE_STATE_OFFLINE, device: dev }), false);
  assert.equal(shouldAttemptFirstContact(reg.controllers[1], { state: PROBE_STATE_UNKNOWN, device: dev }), false);
  assert.equal(shouldAttemptFirstContact(reg.controllers[1], null), false);
  assert.equal(shouldAttemptFirstContact(reg.controllers[2], { state: PROBE_STATE_ONLINE, device: dev }), false);
  assert.equal(shouldAttemptFirstContact(reg.controllers[0], { state: PROBE_STATE_ONLINE, device: dev }), false);
});

// ── The "patch without the board" gate ──────────────────────────────────────

test('canMarkProvisional: a typed IP on an unbound LED card is allowed', () => {
  const c = createControllerRegistry({
    controllers: [{ id: 1, name: 'L', ip: '10.9.9.207', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 36, chain: [] }] }],
  }).controllers[0];
  assert.deepEqual(canMarkProvisional(c), { allowed: true, reason: '' });
});

test('canMarkProvisional: refuses with a REASON in every blocked case', () => {
  const reg = mixedRegistry();
  assert.match(canMarkProvisional(reg.controllers[0]).reason, /only LED controllers/);
  assert.match(canMarkProvisional(reg.controllers[1]).reason, /already provisional/);
  assert.match(canMarkProvisional(reg.controllers[2]).reason, /already VERIFIED/);

  const noIp = createControllerRegistry({
    controllers: [{ id: 1, name: 'L', ip: '', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 36, chain: [] }] }],
  }).controllers[0];
  assert.match(canMarkProvisional(noIp).reason, /type the controller IP first/);

  noIp.ip = PLACEHOLDER_IP;
  assert.match(canMarkProvisional(noIp).reason, /placeholder sentinel/);
});

test('canMarkProvisional and markControllerProvisional agree (the gate is not decorative)', () => {
  const c = createControllerRegistry({
    controllers: [{ id: 1, name: 'L', ip: '10.9.9.207', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW' }, ports: [{ port: 1, output: 1, universe: 36, chain: [] }] }],
  }).controllers[0];
  assert.equal(canMarkProvisional(c).allowed, true);
  markControllerProvisional(c);
  assert.equal(canMarkProvisional(c).allowed, false);
  assert.equal(ledBindingBadgeModel(c).grade, LED_BINDING_PROVISIONAL);
});
