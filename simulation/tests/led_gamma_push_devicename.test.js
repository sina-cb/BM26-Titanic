// Tests for the GAMMA push's deviceName repair (report 20260725_126).
//
// docs/41 §4.1.1, proved live in _124: MarsinLED's ConfigManager::update
// merges a partial POST body into the STORED config and validates the WHOLE
// merged document. A board whose stored deviceName is invalid (fresh boards
// ship with "") therefore rejects EVERY `POST /api/config` with
// `field=deviceName` — including a pure `{gamma}` body that never mentions
// the field. The per-output push learned the repair in _124; these cases pin
// the SAME doctrine at the gamma push's payload-construction seam
// (`led_gamma_service.gammaPushBody`) — no device needed.
//
// Module-system note: the service is CommonJS, the client is a browser ES
// module. The service consumes the client's decision function directly via
// Node's native require(esm) — the FIRST test proves both sides hold the very
// same function/regex objects, so there is no second implementation to drift.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  DEVICE_NAME_RE,
  deviceNameRepairForPush,
} from '../src/dmx/led/marsinled_client.js';

const require = createRequire(import.meta.url);
const {
  gammaPushBody,
  gammaRejectionError,
} = require('../server/led_gamma_service.cjs');
const clientViaRequire = require('../src/dmx/led/marsinled_client.js');

const IP = '10.0.0.60';
const GAMMA = Object.freeze({ r: 2.2, g: 2.2, b: 2.2, w: 1.0 });

// ── Sharing: one implementation, not a parallel copy ────────────────────────

test('_126: the service consumes the CLIENT\'s own repair function (no drift possible)', () => {
  // require(esm) hands back the same module instance the ESM import sees, so
  // the .cjs service and the browser client literally share one function and
  // one regex — the regex-parity guarantee is identity, not resemblance.
  assert.equal(clientViaRequire.deviceNameRepairForPush, deviceNameRepairForPush);
  assert.equal(clientViaRequire.DEVICE_NAME_RE, DEVICE_NAME_RE);
  // Canary against the firmware rule itself (docs/41 §4.2: 1–32, [A-Za-z0-9._-]).
  assert.equal(DEVICE_NAME_RE.source, '^[A-Za-z0-9._-]{1,32}$');
});

// ── The payload-construction seam ────────────────────────────────────────────

test('_126: a VALID stored name → gamma-only body, untouched, never renamed', () => {
  // controllerName is deliberately an ILLEGAL device name here — with a valid
  // stored name it must be irrelevant (a working device is never renamed).
  const { body, nameRepair } = gammaPushBody({
    ip: IP, gamma: GAMMA, storedDeviceName: 'Bench-1', controllerName: 'LED A',
  });
  assert.deepEqual(Object.keys(body), ['gamma']);
  assert.equal(body.gamma, GAMMA);              // the exact curve, by reference
  assert.equal(nameRepair, null);
});

test('_126: an ABSENT stored name → gamma-only body (a name is never invented)', () => {
  const { body, nameRepair } = gammaPushBody({
    ip: IP, gamma: GAMMA, storedDeviceName: undefined, controllerName: 'LeftLeftRopes',
  });
  assert.deepEqual(Object.keys(body), ['gamma']);
  assert.equal(nameRepair, null);
});

test('_126: an INVALID stored name + legal card name → repaired body, name VERBATIM', () => {
  // storedDeviceName '' is the live _124 failure: the fresh-board default.
  const { body, nameRepair } = gammaPushBody({
    ip: IP, gamma: GAMMA, storedDeviceName: '', controllerName: 'LeftLeftRopes',
  });
  assert.deepEqual(body, { gamma: GAMMA, deviceName: 'LeftLeftRopes' });
  assert.equal(nameRepair.from, '');
  assert.equal(nameRepair.to, 'LeftLeftRopes');  // verbatim — never sanitized
  assert.match(nameRepair.message, /reject every config write/);
});

test('_126: an INVALID stored name + unusable card name → LOUD refusal naming the rename', () => {
  const refusal = (controllerName) => {
    try {
      gammaPushBody({ ip: IP, gamma: GAMMA, storedDeviceName: '', controllerName });
      assert.fail('expected a throw');
    } catch (err) {
      assert.equal(err.kind, 'invalid');        // refused BEFORE the POST
      assert.match(err.message, /4\.1\.1/);      // the docs/41 pointer
      return err;
    }
  };
  const spaces = refusal('Left Left Ropes');
  assert.match(spaces.message, /RENAME THE CONTROLLER CARD/);
  assert.match(spaces.message, /'Left Left Ropes' is not a legal device name/);
  assert.match(spaces.message, /1-32 chars, letters\/digits\/-\._ only/);

  const tooLong = refusal('x'.repeat(33));
  assert.match(tooLong.message, /RENAME THE CONTROLLER CARD/);

  // No card name at all (the bare CLI): the refusal names the CLI escape hatch.
  const missing = refusal(undefined);
  assert.match(missing.message, /no card name was supplied/);
  assert.match(missing.message, /--device-name/);
});

// ── The rejection diagnosis (belt-and-braces for the merge quirk) ────────────

test('_126: a field=deviceName 400 on a body WITHOUT deviceName is explained, not parroted', () => {
  const reply = {
    status: 'error', error: 'config apply failed',
    field: 'deviceName', detail: '1-32 chars, letters/digits/-._ only',
  };
  const err = gammaRejectionError(IP, reply, { gamma: GAMMA });
  assert.equal(err.kind, 'rejected');
  assert.equal(err.deviceError, reply);
  assert.match(err.message, /field=deviceName/);
  assert.match(err.message, /never mentioned deviceName/);
  assert.match(err.message, /4\.1\.1/);
  assert.match(err.message, /STORED deviceName/);
});

test('_126: the quirk note appears ONLY for that exact trap', () => {
  // The body DID carry deviceName (a repair the device still refused): the
  // rejection is then genuinely about the name we sent — no quirk note.
  const nameReply = { error: 'config apply failed', field: 'deviceName', detail: 'nope' };
  const withName = gammaRejectionError(IP, nameReply,
    { gamma: GAMMA, deviceName: 'LeftLeftRopes' });
  assert.doesNotMatch(withName.message, /never mentioned deviceName/);

  // An ordinary gamma rejection: no quirk note either.
  const gammaReply = { error: 'config apply failed', field: 'gamma', detail: 'out of range' };
  const plain = gammaRejectionError(IP, gammaReply, { gamma: GAMMA });
  assert.doesNotMatch(plain.message, /never mentioned deviceName/);
  assert.match(plain.message, /field=gamma/);
});
