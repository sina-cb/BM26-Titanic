// Tests for dynamic registration of Audio-Companion signals into the CPC
// (POST /audio/signals/manifest). Covers the four moving parts:
//
//   1. ParamCenter.registerDynamicLiveParam / deregisterDynamicLiveParam
//      (runtime live keys appear in / disappear from getSchema()).
//   2. OscListener.addDynamicBinding / removeDynamicBinding (address→key
//      binding wired/unwired at runtime) + the FULL OSC path: a packet at
//      a freshly-bound address lands in the new CPC key.
//   3. validateSignalManifest (the request-body gate that drives the 400).
//   4. The modulation purge: a mapping SOURCED from a removed dynamic key
//      is dropped across playlists; other mappings are preserved.
//
// Run:  cd marsin_engine && node --test tests/companion_dynamic_signals.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dgram from 'node:dgram';

import * as osc from 'osc-min';

import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';
import { validateSignalManifest } from '../lib/api_server.js';
import { PlaylistManager } from '../lib/playlist_manager.js';

function makePc() {
  return new ParamCenter(null);
}

// ── 1) ParamCenter dynamic live params ──────────────────────────────────────

test('registerDynamicLiveParam adds a live key visible in getSchema()', () => {
  const pc = makePc();
  assert.equal(pc.isRegisteredKey('companionFoo'), false);
  const r = pc.registerDynamicLiveParam({
    key: 'companionFoo', oscAddress: '/marsin/companion/foo',
    label: 'Companion Foo', range: [0, 1],
  });
  assert.equal(r.status, 'added');
  assert.equal(pc.isRegisteredKey('companionFoo'), true);
  assert.equal(pc.isDynamicLiveParam('companionFoo'), true);
  const e = pc.getSchema().find(s => s.key === 'companionFoo');
  assert.ok(e, 'key present in schema');
  assert.equal(e.live, true);
  assert.equal(e.persist, false);
  assert.equal(e.dynamic, true);
  assert.equal(e.oscAddress, '/marsin/companion/foo');
  assert.deepEqual(e.range, [0, 1]);
  // get/set work like any CPC key.
  pc.set('companionFoo', 0.6, 'osc');
  assert.ok(Math.abs(pc.get('companionFoo') - 0.6) < 1e-9);
});

test('registerDynamicLiveParam refuses to override a built-in key', () => {
  const pc = makePc();
  assert.throws(
    () => pc.registerDynamicLiveParam({ key: 'micLow', oscAddress: '/x', range: [0, 1] }),
    /built-in/,
  );
});

test('deregisterDynamicLiveParam removes the key from schema + store', () => {
  const pc = makePc();
  pc.registerDynamicLiveParam({ key: 'companionBar', oscAddress: '/c/bar', range: [0, 300] });
  assert.equal(pc.getDynamicLiveParamKeys().includes('companionBar'), true);
  assert.equal(pc.deregisterDynamicLiveParam('companionBar'), true);
  assert.equal(pc.isRegisteredKey('companionBar'), false);
  assert.equal(pc.getSchema().some(s => s.key === 'companionBar'), false);
  assert.throws(() => pc.get('companionBar'), /unknown key/);
});

test('deregisterDynamicLiveParam refuses to remove a built-in key', () => {
  const pc = makePc();
  assert.throws(() => pc.deregisterDynamicLiveParam('micLow'), /built-in/);
});

// ── 2) OscListener runtime bindings + the FULL OSC path ─────────────────────

test('addDynamicBinding refuses to clobber a canonical address', () => {
  const pc = makePc();
  const l = new OscListener({ port: 47111, paramCenter: pc });
  assert.throws(() => l.addDynamicBinding('/marsin/mic/low', 'whatever'), /collides/);
});

test('a packet at a freshly-bound dynamic address lands in the new CPC key', async () => {
  const pc = makePc();
  pc.registerDynamicLiveParam({
    key: 'companionLive', oscAddress: '/marsin/companion/live', range: [0, 1],
  });
  const port = 44000 + Math.floor(Math.random() * 2000);
  const listener = new OscListener({ port, host: '127.0.0.1', paramCenter: pc });
  // Bind AFTER construction — the manifest path adds it to a running listener.
  listener.addDynamicBinding('/marsin/companion/live', 'companionLive');
  await listener.startAsync();
  const sock = dgram.createSocket('udp4');
  try {
    const buf = osc.toBuffer({ address: '/marsin/companion/live', args: [{ type: 'float', value: 0.77 }] });
    const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    await new Promise((res, rej) => sock.send(sendBuf, port, '127.0.0.1', e => e ? rej(e) : res()));
    const t0 = Date.now();
    while (Math.abs(pc.get('companionLive')) < 1e-9 && Date.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(Math.abs(pc.get('companionLive') - 0.77) < 1e-3, `landed as ${pc.get('companionLive')}`);
  } finally {
    sock.close();
    listener.stop();
  }
});

test('removeDynamicBinding unwires the address (no further writes land)', async () => {
  const pc = makePc();
  pc.registerDynamicLiveParam({ key: 'companionGone', oscAddress: '/c/gone', range: [0, 1] });
  const port = 46000 + Math.floor(Math.random() * 2000);
  const listener = new OscListener({ port, host: '127.0.0.1', paramCenter: pc });
  listener.addDynamicBinding('/c/gone', 'companionGone');
  assert.equal(listener.removeDynamicBinding('/c/gone'), true);
  assert.equal(listener.removeDynamicBinding('/c/gone'), false); // idempotent
  await listener.startAsync();
  const sock = dgram.createSocket('udp4');
  try {
    const buf = osc.toBuffer({ address: '/c/gone', args: [{ type: 'float', value: 0.9 }] });
    const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    await new Promise((res, rej) => sock.send(sendBuf, port, '127.0.0.1', e => e ? rej(e) : res()));
    await new Promise(r => setTimeout(r, 150));
    assert.equal(pc.get('companionGone'), 0, 'unbound address must not write');
  } finally {
    sock.close();
    listener.stop();
  }
});

// ── 3) Manifest validation (drives the 400) ─────────────────────────────────

test('validateSignalManifest accepts a well-formed manifest + picks ranges by type', () => {
  const r = validateSignalManifest({
    signals: [
      { cpcKey: 'a', address: '/a', type: 'intensity' },
      { cpcKey: 'b', address: '/b', type: 'frequency', label: 'B' },
      { cpcKey: 'c', address: '/c', type: 'bpm' },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.signals[0].range, [0, 1]);
  assert.deepEqual(r.signals[1].range, [0, 8000]);
  assert.deepEqual(r.signals[2].range, [0, 300]);
  assert.equal(r.signals[0].label, 'a'); // defaults to cpcKey
});

test('validateSignalManifest rejects malformed manifests', () => {
  assert.equal(validateSignalManifest(null).ok, false);
  assert.equal(validateSignalManifest({}).ok, false); // missing signals
  assert.equal(validateSignalManifest({ signals: 'nope' }).ok, false);
  assert.equal(validateSignalManifest({ signals: [{ address: '/a', type: 'intensity' }] }).ok, false); // no cpcKey
  assert.equal(validateSignalManifest({ signals: [{ cpcKey: 'a', address: 'no-slash', type: 'intensity' }] }).ok, false);
  assert.equal(validateSignalManifest({ signals: [{ cpcKey: 'a', address: '/a', type: 'bogus' }] }).ok, false);
  assert.equal(validateSignalManifest({ signals: [
    { cpcKey: 'a', address: '/a', type: 'bpm' },
    { cpcKey: 'a', address: '/b', type: 'bpm' },
  ] }).ok, false); // dup key
});

// ── 4) Modulation purge for a removed source ────────────────────────────────
//
// Mirrors api_server's purgeModulationsForSource: walk playlists, drop only
// mappings whose source.key === removedKey, save. Uses a real PlaylistManager
// over a temp dir + a real pattern on disk so save()'s strict re-validation
// runs against the SURVIVING mappings.

function makeTempPlaylistManager() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynmod_'));
  const playlistsDir = path.join(root, 'playlists');
  const patternsDir = path.join(root, 'patterns');
  fs.mkdirSync(playlistsDir, { recursive: true });
  fs.mkdirSync(patternsDir, { recursive: true });
  fs.writeFileSync(path.join(patternsDir, 'p1.js'), 'export function render(){}');
  return { pm: new PlaylistManager(playlistsDir, patternsDir), root };
}

function mapping(id, sourceKey, targetParam) {
  return {
    id, type: 'continuous', enabled: true,
    source: { scope: 'cpc', key: sourceKey },
    target: { scope: 'pattern', parameter: targetParam },
    mode: 'offset', polarity: 'unipolar', range: [0, 0.5], curve: 'linear',
  };
}

test('purge drops only mappings sourced from the removed dynamic key', () => {
  const { pm } = makeTempPlaylistManager();
  // Sources are not allow-listed, so a playlist with a mapping sourced from any
  // key validates directly — no registration needed.
  pm.save({
    name: 'show', entries: [
      {
        id: 'e1', pattern: 'p1',
        modulations: [
          mapping('m1', 'companionPunch', 'sliderA'), // sourced from the dynamic key
          mapping('m2', 'micLow', 'sliderB'),         // another source — keep
        ],
      },
    ],
  });

  // The purge (inlined here, identical to api_server.purgeModulationsForSource).
  const removedKey = 'companionPunch';
  let purged = 0;
  for (const name of pm.list()) {
    const pl = pm.load(name);
    let changed = false;
    for (const entry of pl.entries) {
      if (!Array.isArray(entry.modulations)) continue;
      const before = entry.modulations.length;
      entry.modulations = entry.modulations.filter(
        m => !(m && m.source && m.source.key === removedKey),
      );
      if (entry.modulations.length !== before) { purged += before - entry.modulations.length; changed = true; }
    }
    if (changed) pm.save(pl);
  }

  assert.equal(purged, 1, 'exactly one mapping purged');
  const after = pm.load('show').entries[0].modulations;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'm2', 'the other-sourced mapping survives');
  assert.equal(after[0].source.key, 'micLow');
});
