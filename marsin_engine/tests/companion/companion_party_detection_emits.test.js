// Guard: the party-detection keys must actually LEAVE the companion.
//
// The companion is the sole analyzer; the engine's CPC only ever holds what the
// companion EMITS over OSC. That emit set is driven by a HAND-MAINTAINED list
// (`ENGINE_INTERNAL_DERIVED` in audio/companion/companion_server.js), while the
// CPC schema comes from the generated audio_signals registry. The two can drift
// — and they DID: `audioPartyStrong` registered fine, published fine inside the
// companion, and never reached the engine, so `timeline.mood.key` read a
// permanent 0 and party mode could never fire. It looked like a working system.
//
// This test pins the join. It is deliberately source-level (no server boot):
// the failure it guards is a missing LINE in a literal list, and reading the
// list is the cheapest honest way to check it.
//
// Run:  cd marsin_engine && node --test tests/companion/companion_party_detection_emits.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { audioRegistryEntries } from '../../audio/postproc/audio_signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'audio', 'companion', 'companion_server.js'), 'utf8');

// The R1 party-detection set (report 20260725_10). audioPartyStrong is the one
// the show director reads; the other five are the operator's live-tuning view.
const PARTY_KEYS = [
  'audioPartyStrong', 'audioLoudness', 'audioKickRate',
  'audioKickReg', 'audioBpmLocked', 'audioBpmConf',
];

/** The cpcKeys in the companion's ENGINE_INTERNAL_DERIVED emit list. */
function emitListKeys() {
  const block = SERVER_SRC.match(/const ENGINE_INTERNAL_DERIVED = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'ENGINE_INTERNAL_DERIVED literal not found — did the emit list move?');
  return [...block[1].matchAll(/cpcKey:\s*'([^']+)'/g)].map(m => m[1]);
}

test('every party-detection key is registered on the CPC with an OSC address', () => {
  const byKey = new Map(audioRegistryEntries().map(e => [e.key, e]));
  for (const k of PARTY_KEYS) {
    const e = byKey.get(k);
    assert.ok(e, `${k} is not in the audio signal registry`);
    assert.ok(typeof e.oscAddress === 'string' && e.oscAddress.length > 0,
      `${k} has no oscAddress — it can never travel companion → engine`);
    assert.equal(e.live, true, `${k} must be a live key`);
  }
});

test('every party-detection key is in the companion OSC emit list', () => {
  const emitted = new Set(emitListKeys());
  for (const k of PARTY_KEYS) {
    assert.ok(emitted.has(k),
      `${k} is NOT in ENGINE_INTERNAL_DERIVED — it would never reach the engine CPC. `
      + 'For audioPartyStrong that silently disables party detection entirely.');
  }
});

test('every key in the companion emit list is a real registered key with an address', () => {
  // The other drift direction: a typo'd or retired key in the emit list would be
  // silently dropped by the `.filter(address)` in companion_server.js — the
  // signal just never sends, with nothing to show for it.
  const byKey = new Map(audioRegistryEntries().map(e => [e.key, e]));
  for (const k of emitListKeys()) {
    const e = byKey.get(k);
    assert.ok(e, `emit list names "${k}", which is not a registered audio key`);
    assert.ok(typeof e.oscAddress === 'string' && e.oscAddress.length > 0,
      `emit list names "${k}", which has no oscAddress — the emit is silently dropped`);
  }
});
