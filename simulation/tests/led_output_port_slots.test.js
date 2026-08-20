/**
 * LED output-port SLOT semantics (report 20260725_52, operator 2026-07-29:
 * "I can remove, but not add one back in").
 *
 * On an LED controller a port IS a physical device output — `derivePerOutputPlan`
 * keys the pushed plan by `port.port - 1`. `addPort` used to mint `max(port) + 1`
 * unconditionally, so deleting output 2 of [1,2,3] and pressing `+port` produced
 * port 4: on a 4-output board that addresses the FOURTH output while output 2
 * stayed permanently unreachable. There was no way back.
 *
 * DMX controllers keep the append-only numbering: their port numbers are chain
 * labels, not hardware output indices.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createControllerRegistry,
  addController,
  addPort,
  removePort,
  setControllerType,
  nextLedOutputPortNumber,
  LED_MAX_OUTPUTS,
  CONTROLLER_TYPE_LED,
  DEFAULT_PORT_COUNT,
} from '../src/dmx/controller_registry.js';

// `addController` seeds DEFAULT_PORT_COUNT ports. These tests are about the
// numbering rule, so they start from a known-empty port list.
function bareController(registry, opts) {
  const controller = addController(registry, opts);
  controller.ports.length = 0;
  return controller;
}

function ledController(registry, name = 'MarsinLED probe') {
  const controller = bareController(registry, { name, ip: '10.1.1.201' });
  setControllerType(controller, CONTROLLER_TYPE_LED);
  return controller;
}

const portNums = (controller) => controller.ports.map((p) => p.port);

// ── The pure slot picker ───────────────────────────────────────────────────

test('the next LED output slot is the LOWEST free one, not max + 1', () => {
  assert.equal(nextLedOutputPortNumber({ ports: [] }), 1);
  assert.equal(nextLedOutputPortNumber({ ports: [{ port: 1 }, { port: 2 }, { port: 3 }] }), 4);
  assert.equal(nextLedOutputPortNumber({ ports: [{ port: 1 }, { port: 3 }] }), 2);
  assert.equal(nextLedOutputPortNumber({ ports: [{ port: 2 }, { port: 3 }, { port: 4 }] }), 1);
});

test('a full controller REFUSES loudly instead of minting a dead output', () => {
  const ports = [];
  for (let n = 1; n <= LED_MAX_OUTPUTS; n++) ports.push({ port: n });
  assert.throws(() => nextLedOutputPortNumber({ ports, name: 'Full board' }), (err) => {
    assert.match(err.message, /Full board/);
    assert.match(err.message, new RegExp(`all ${LED_MAX_OUTPUTS} output`));
    assert.match(err.message, /docs\/41/, 'the ceiling must cite where it comes from');
    assert.match(err.message, /Delete an output before adding one/);
    return true;
  });
});

test('the ceiling is the device contract: 16 outputs (docs/41 §4.2)', () => {
  assert.equal(LED_MAX_OUTPUTS, 16);
});

test('a malformed controller throws rather than guessing slot 1', () => {
  assert.throws(() => nextLedOutputPortNumber(null), /ports must be an array/);
  assert.throws(() => nextLedOutputPortNumber({}), /ports must be an array/);
});

// ── addPort, wired ─────────────────────────────────────────────────────────

test('remove-then-add gives the REMOVED LED output slot back', () => {
  const registry = createControllerRegistry();
  const controller = ledController(registry);
  addPort(registry, controller);
  addPort(registry, controller);
  addPort(registry, controller);
  assert.deepEqual(portNums(controller), [1, 2, 3]);

  const port2 = controller.ports.find((p) => p.port === 2);
  removePort(registry, controller, port2);
  assert.deepEqual(portNums(controller), [1, 3]);

  const readded = addPort(registry, controller);
  assert.equal(readded.port, 2, 'the operator gets output 2 back, not a phantom output 4');
  assert.deepEqual(portNums(controller), [1, 2, 3], 'and it sits in hardware order');
});

test('the re-added output gets a fresh universe and an empty chain', () => {
  const registry = createControllerRegistry();
  const controller = ledController(registry);
  addPort(registry, controller);
  addPort(registry, controller);
  const removed = controller.ports.find((p) => p.port === 1);
  removed.chain.push('Some Strand');
  const freed = removePort(registry, controller, removed);
  assert.deepEqual(freed, ['Some Strand'], 'removal reports what it unmapped');

  const readded = addPort(registry, controller);
  assert.equal(readded.port, 1);
  assert.deepEqual(readded.chain, [], 'a re-added output never inherits the old chain');
  assert.equal(readded.startAddress, 1);
  assert.ok(Number.isInteger(readded.universe) && readded.universe >= 1);
});

test('a fresh LED controller still numbers its outputs 1..n in order', () => {
  const registry = createControllerRegistry();
  const controller = ledController(registry);
  for (let i = 0; i < DEFAULT_PORT_COUNT; i++) addPort(registry, controller);
  assert.deepEqual(portNums(controller), [1, 2, 3, 4]);
});

test('a controller created by addController still seeds ports 1..DEFAULT_PORT_COUNT', () => {
  const registry = createControllerRegistry();
  const dmx = addController(registry, { name: 'Seeded DMX', ip: '10.1.1.13' });
  assert.deepEqual(portNums(dmx), [1, 2, 3, 4]);
  const led = addController(registry,
    { name: 'Seeded LED', ip: '10.1.1.202', type: CONTROLLER_TYPE_LED });
  assert.deepEqual(portNums(led), [1, 2, 3, 4],
    'the gap-fill rule must not change the create-from-device seeding');
});

test('addPort on a FULL LED controller throws — no silent clamp', () => {
  const registry = createControllerRegistry();
  const controller = ledController(registry);
  for (let n = 1; n <= LED_MAX_OUTPUTS; n++) addPort(registry, controller);
  assert.equal(controller.ports.length, LED_MAX_OUTPUTS);
  assert.throws(() => addPort(registry, controller), new RegExp(`all ${LED_MAX_OUTPUTS} output`));
  assert.equal(controller.ports.length, LED_MAX_OUTPUTS, 'the refusal mutates nothing');
});

// ── DMX is deliberately unchanged ──────────────────────────────────────────

test('DMX controllers keep append-only port numbering (holes stay holes)', () => {
  const registry = createControllerRegistry();
  const controller = bareController(registry, { name: "DMX node", ip: "10.1.1.10" });
  addPort(registry, controller);
  addPort(registry, controller);
  addPort(registry, controller);
  removePort(registry, controller, controller.ports.find((p) => p.port === 2));
  assert.deepEqual(portNums(controller), [1, 3]);
  assert.equal(addPort(registry, controller).port, 4,
    'DMX port numbers are chain labels, not hardware output indices');
});

test('DMX controllers have no 16-port ceiling', () => {
  const registry = createControllerRegistry();
  const controller = bareController(registry, { name: "Big node", ip: "10.1.1.11" });
  for (let n = 0; n <= LED_MAX_OUTPUTS; n++) addPort(registry, controller);
  assert.equal(controller.ports.length, LED_MAX_OUTPUTS + 1);
});

test('switching a controller to LED makes the NEXT add fill gaps', () => {
  const registry = createControllerRegistry();
  const controller = bareController(registry, { name: "Converted", ip: "10.1.1.12" });
  addPort(registry, controller);
  addPort(registry, controller);
  removePort(registry, controller, controller.ports.find((p) => p.port === 1));
  assert.equal(addPort(registry, controller).port, 3, 'still DMX → append');
  removePort(registry, controller, controller.ports.find((p) => p.port === 3));
  setControllerType(controller, CONTROLLER_TYPE_LED);
  assert.equal(addPort(registry, controller).port, 1, 'now LED → fill the lowest free slot');
});
