// Tests for the Companion's BUILT-IN MUSIC-MOOD output (the audioParty +
// audioStructure cues the Timeline companion reads live):
//   1. emitDerivedMood() — reads audioParty + audioStructure from a paramCenter
//      and sends them over OSC at /marsin/audio/party + /marsin/audio/structure,
//      guarded so only finite/in-range values go out (fail SAFE — a NaN/out-of-
//      range value is dropped, never sent wrong). Party is snapped to 1.0/0.0.
//   2. THE FULL PATH — companion-style /marsin/audio/party + /marsin/audio/
//      structure OSC packets land as audioParty / audioStructure in the CPC.
//
// Run:  cd marsin_engine && node --test tests/companion_mood_emit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import * as osc from 'osc-min';

import {
  emitDerivedMood, isSaneParty, isSaneStructure,
  PARTY_OSC_ADDRESS, STRUCTURE_OSC_ADDRESS, PARTY_MAX, STRUCTURE_MAX,
} from '../audio/companion/mood_emit.js';
import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';

// ── 1) emitDerivedMood guard ─────────────────────────────────────────────────

/** A paramCenter stub returning the given party + structure values. */
function pcWith(party, structure) {
  return {
    get: (k) => (k === 'audioParty' ? party : k === 'audioStructure' ? structure : undefined),
  };
}
/** Capture sendOsc calls. */
function sender() {
  const sent = [];
  return { fn: (address, value) => sent.push({ address, value }), sent };
}

test('mood addresses match the curated contract', () => {
  assert.equal(PARTY_OSC_ADDRESS, '/marsin/audio/party');
  assert.equal(STRUCTURE_OSC_ADDRESS, '/marsin/audio/structure');
});

test('isSaneParty accepts a finite gate in [0, PARTY_MAX]', () => {
  assert.equal(isSaneParty(0), true);
  assert.equal(isSaneParty(1), true);
  assert.equal(isSaneParty(PARTY_MAX), true);
});

test('isSaneParty rejects negative / over-max / non-finite', () => {
  for (const bad of [-1, PARTY_MAX + 1, NaN, Infinity, -Infinity]) {
    assert.equal(isSaneParty(bad), false, `${bad} should be rejected`);
  }
});

test('isSaneStructure accepts a finite state in [0, STRUCTURE_MAX]', () => {
  assert.equal(isSaneStructure(0), true);
  assert.equal(isSaneStructure(1), true);
  assert.equal(isSaneStructure(STRUCTURE_MAX), true);
});

test('isSaneStructure rejects negative / over-max / non-finite', () => {
  for (const bad of [-1, STRUCTURE_MAX + 1, NaN, Infinity, -Infinity]) {
    assert.equal(isSaneStructure(bad), false, `${bad} should be rejected`);
  }
});

test('emitDerivedMood sends party 1.0 and structure to their curated addresses', () => {
  const s = sender();
  const n = emitDerivedMood(pcWith(1, 2), s.fn);
  assert.equal(n, 2);
  assert.equal(s.sent.length, 2);
  assert.deepEqual(s.sent[0], { address: '/marsin/audio/party', value: 1.0 });
  assert.deepEqual(s.sent[1], { address: '/marsin/audio/structure', value: 2 });
});

test('emitDerivedMood snaps party 0 to 0.0 (still emitted — calm IS a mood)', () => {
  const s = sender();
  const n = emitDerivedMood(pcWith(0, 0), s.fn);
  assert.equal(n, 2);
  assert.deepEqual(s.sent[0], { address: '/marsin/audio/party', value: 0.0 });
  assert.deepEqual(s.sent[1], { address: '/marsin/audio/structure', value: 0 });
});

test('emitDerivedMood drops a non-finite party but still emits a sane structure', () => {
  const s = sender();
  const n = emitDerivedMood(pcWith(NaN, 1), s.fn);
  assert.equal(n, 1, 'only structure emitted');
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0], { address: '/marsin/audio/structure', value: 1 });
});

test('emitDerivedMood drops a non-finite structure but still emits a sane party', () => {
  const s = sender();
  const n = emitDerivedMood(pcWith(1, Infinity), s.fn);
  assert.equal(n, 1, 'only party emitted');
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0], { address: '/marsin/audio/party', value: 1.0 });
});

test('emitDerivedMood drops EVERYTHING when both are garbage (fail safe)', () => {
  const s = sender();
  const n = emitDerivedMood(pcWith(undefined, NaN), s.fn);
  assert.equal(n, 0);
  assert.equal(s.sent.length, 0, 'nothing sent for all-invalid mood');
});

// ── 2) THE FULL PATH: companion mood packets → CPC audioParty/audioStructure ──

test('companion mood packets land as audioParty + audioStructure in CPC', async () => {
  const pc = new ParamCenter(null);
  const port = 44000 + Math.floor(Math.random() * 3000);
  const listener = new OscListener({ port, host: '127.0.0.1', paramCenter: pc });
  await listener.startAsync();
  const sock = dgram.createSocket('udp4');
  try {
    // Encode EXACTLY as the companion's sendOsc() does: single float arg.
    const send = async (address, value) => {
      const buf = osc.toBuffer({ address, args: [{ type: 'float', value }] });
      const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
      await new Promise((res, rej) => sock.send(sendBuf, port, '127.0.0.1', (e) => e ? rej(e) : res()));
    };
    await send('/marsin/audio/party', 1.0);
    await send('/marsin/audio/structure', 2.0);
    const t0 = Date.now();
    while ((Math.abs(pc.get('audioParty') - 1.0) > 1e-3
            || Math.abs(pc.get('audioStructure') - 2.0) > 1e-3)
           && Date.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(Math.abs(pc.get('audioParty') - 1.0) < 1e-2, `audioParty landed as ${pc.get('audioParty')}`);
    assert.ok(Math.abs(pc.get('audioStructure') - 2.0) < 1e-2, `audioStructure landed as ${pc.get('audioStructure')}`);
  } finally {
    sock.close();
    listener.stop();
  }
});
