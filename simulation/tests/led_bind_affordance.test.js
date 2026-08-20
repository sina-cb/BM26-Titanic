/**
 * led_bind_affordance.test.js — the discovery modal must always offer "Bind"
 * for a controller that is not already bound to the scanned device.
 *
 * Regression: the bind button was gated on the "already added" dedup, which
 * matches on IP as well as on the device's controllerId. A controller card the
 * operator typed by hand carries the right IP but NO device block (unbound), so
 * scanning from that card found the device and then offered nothing — leaving
 * the card permanently unbindable and invisible to every bound-only flow
 * (sync chip, push-all, gamma-all). See docs/41 §2 (bind is keyed by IP, the
 * device block is the fingerprint the scene remembers).
 *
 * Pure logic: no DOM, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldOfferBind } from '../src/gui/led_discovery_panel.js';
import {
  CONTROLLER_TYPE_LED,
  LED_DEVICE_VENDOR_MARSINLED,
} from '../src/dmx/controller_registry.js';

const DEVICE = {
  ip: '10.0.0.60',
  controllerId: 'testbench',
  boardId: 'angio4-old',
  strands: [],
};

function ledController(extra = {}) {
  return {
    id: 4,
    name: 'LeftLeftFront',
    ip: '10.0.0.60',
    type: CONTROLLER_TYPE_LED,
    ports: [{ port: 1, universe: 20, chain: [] }],
    ...extra,
  };
}

test('UNBOUND card with the SAME ip as the device still gets a Bind offer', () => {
  // The exact live case: hand-added card, correct IP, no device block.
  assert.equal(shouldOfferBind(ledController(), DEVICE), true);
});

test('card already bound to THIS device gets NO Bind offer', () => {
  const controller = ledController({
    device: {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: 'testbench',
      boardId: 'angio4-old',
    },
  });
  assert.equal(shouldOfferBind(controller, DEVICE), false);
});

test('card bound to a DIFFERENT device gets a Bind offer (rebind)', () => {
  const controller = ledController({
    ip: '10.0.0.61',
    device: {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: 'some_other_unit',
      boardId: 'angio4-old',
    },
  });
  assert.equal(shouldOfferBind(controller, DEVICE), true);
});

test('create-only mode (no controller) offers no Bind', () => {
  assert.equal(shouldOfferBind(null, DEVICE), false);
});

test('a device block without a controllerId cannot suppress the offer', () => {
  // A malformed/partial block must never silently hide the bind path.
  const controller = ledController({ device: { vendor: LED_DEVICE_VENDOR_MARSINLED } });
  assert.equal(shouldOfferBind(controller, DEVICE), true);
});
