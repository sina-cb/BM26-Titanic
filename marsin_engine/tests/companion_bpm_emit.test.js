// Tests for the Companion's BUILT-IN BPM output + the BPM→SPEED sync source
// (2026-06-17 contract):
//   1. emitDerivedBpm() — reads audioBpm from a paramCenter and sends it over
//      OSC at /marsin/audio/bpm, guarded so only a finite/sane tempo goes out
//      (fail SAFE — a 0/non-finite/absurd BPM is dropped, never sent wrong).
//   2. THE FULL PATH — a companion-style /marsin/audio/bpm OSC packet lands as
//      audioBpm in CPC AND, with bpmSpeedSync on, drives the global `speed`.
//
// Run:  cd marsin_engine && node --test tests/companion_bpm_emit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import * as osc from 'osc-min';

import {
  emitDerivedBpm, isSaneBpm, BPM_OSC_ADDRESS, BPM_MAX,
} from '../audio/companion/bpm_emit.js';
import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';
import { BpmSpeedSync } from '../lib/bpm_speed_sync.js';

// ── 1) emitDerivedBpm guard ──────────────────────────────────────────────────

/** A paramCenter stub that only needs get(audioBpm). */
function pcWithBpm(bpm) {
  return { get: (k) => (k === 'audioBpm' ? bpm : undefined) };
}
/** Capture sendOsc calls. */
function sender() {
  const sent = [];
  return { fn: (address, value) => sent.push({ address, value }), sent };
}

test('BPM_OSC_ADDRESS matches the curated contract', () => {
  assert.equal(BPM_OSC_ADDRESS, '/marsin/audio/bpm');
});

test('isSaneBpm accepts a finite tempo in (0, BPM_MAX]', () => {
  assert.equal(isSaneBpm(128), true);
  assert.equal(isSaneBpm(1), true);
  assert.equal(isSaneBpm(BPM_MAX), true);
});

test('isSaneBpm rejects 0 / negative / non-finite / over-max', () => {
  for (const bad of [0, -10, NaN, Infinity, -Infinity, BPM_MAX + 1, 9999]) {
    assert.equal(isSaneBpm(bad), false, `${bad} should be rejected`);
  }
});

test('emitDerivedBpm sends a sane tempo to /marsin/audio/bpm', () => {
  const s = sender();
  const ok = emitDerivedBpm(pcWithBpm(128), s.fn);
  assert.equal(ok, true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].address, '/marsin/audio/bpm');
  assert.equal(s.sent[0].value, 128);
});

test('emitDerivedBpm drops a 0/absent BPM (fail safe — no packet)', () => {
  const s = sender();
  assert.equal(emitDerivedBpm(pcWithBpm(0), s.fn), false);
  assert.equal(emitDerivedBpm(pcWithBpm(undefined), s.fn), false);
  assert.equal(emitDerivedBpm(pcWithBpm(NaN), s.fn), false);
  assert.equal(s.sent.length, 0, 'nothing sent for an invalid tempo');
});

// ── 2) THE FULL PATH: companion BPM packet → CPC audioBpm → bpmSpeedSync ─────

test('a companion /marsin/audio/bpm packet lands as audioBpm AND drives speed', async () => {
  const pc = new ParamCenter(null);
  // Turn the sync ON and set a known [min,max] so 120 BPM maps to a known speed.
  pc.set('bpmSpeedSync', 1, 'test');
  pc.set('bpmSpeedMin', 60, 'test');
  pc.set('bpmSpeedMax', 180, 'test');

  const sync = new BpmSpeedSync(pc);
  sync.attach();

  const port = 41000 + Math.floor(Math.random() * 3000);
  const listener = new OscListener({ port, host: '127.0.0.1', paramCenter: pc });
  await listener.startAsync();
  const sock = dgram.createSocket('udp4');
  try {
    // Encode EXACTLY as the companion's sendOsc() does: single float arg.
    const buf = osc.toBuffer({ address: '/marsin/audio/bpm', args: [{ type: 'float', value: 120 }] });
    const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    await new Promise((res, rej) => sock.send(sendBuf, port, '127.0.0.1', (e) => e ? rej(e) : res()));
    const t0 = Date.now();
    while (Math.abs(pc.get('audioBpm') - 120) > 1e-3 && Date.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(Math.abs(pc.get('audioBpm') - 120) < 1e-2, `audioBpm landed as ${pc.get('audioBpm')}`);
    // 120 in [60,180] → (120-60)/120 = 0.5 — the sync drove SPEED off audioBpm.
    assert.ok(Math.abs(pc.get('speed') - 0.5) < 1e-2, `speed driven to ${pc.get('speed')}`);
  } finally {
    sync.detach();
    sock.close();
    listener.stop();
  }
});
