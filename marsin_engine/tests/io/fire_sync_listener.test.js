// Unit + socket-level tests for FireSyncListener (BM26-Stoker fire → lights sync).
//
// The effect transport is INJECTED (`setEffect`), so nothing here needs a live
// API server: these tests pin the edge classification, the seq dedupe, the
// min-ON coalescing, and the ack contract — the parts that decide what the
// lights actually do.
//
// Run:  cd marsin_engine && node --test tests/io/fire_sync_listener.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import {
  FireSyncListener,
  parseFrame,
  classifySeq,
  combinedState,
  POOFER_MASK,
  WHISTLE_BIT,
} from '../../lib/fire_sync_listener.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const evt = (side, mask, seq, prev = 0) => JSON.stringify({
  t: 'fire_evt', v: 1, side, mask, prev, seq, up_ms: 1000 + seq,
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Ask the OS for a free UDP port and hand it back. The listener deliberately
 * REFUSES port 0 (a real deployment must name its port), so the tests borrow one
 * rather than binding ephemerally.
 */
async function freePort() {
  const probe = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise(res => probe.bind(0, '127.0.0.1', res));
  const { port } = probe.address();
  await new Promise(res => probe.close(res));
  return port;
}

/**
 * Stand up a listener on a free port with a recording setEffect, plus a client
 * socket to send frames from and collect acks on. Returns a harness with
 * `send`, `calls`, `acks` and `close`.
 */
async function harness(opts = {}) {
  const calls = [];
  const acks = [];
  const listener = new FireSyncListener({
    port: await freePort(),
    host: '127.0.0.1',
    effect: 'vintageWhite',
    minOnMs: 60,                   // short so the tests stay quick
    setEffect: async (state) => { calls.push(state); },
    ...opts,
  });
  await listener.startAsync();
  const port = listener._socket.address().port;

  const client = dgram.createSocket('udp4');
  client.on('message', (buf) => { acks.push(JSON.parse(buf.toString('utf8'))); });
  await new Promise(res => client.bind(0, '127.0.0.1', res));

  const send = (payload) => new Promise((res, rej) => {
    const b = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    client.send(b, port, '127.0.0.1', (e) => (e ? rej(e) : res()));
  });

  return {
    listener, calls, acks, send,
    close() { listener.stop(); client.close(); },
  };
}

// ── Pure helpers ───────────────────────────────────────────────────────────

test('parseFrame accepts a well-formed fire_evt', () => {
  const r = parseFrame(evt('A', 3, 17, 0));
  assert.equal(r.ok, true);
  assert.deepEqual(
    { ...r.frame },
    { t: 'fire_evt', side: 'A', mask: 3, prev: 0, seq: 17, upMs: 1017 },
  );
});

test('parseFrame rejects malformed / unsupported frames without throwing', () => {
  assert.deepEqual(parseFrame('not json at all'), { ok: false, reason: 'malformed' });
  assert.deepEqual(parseFrame('[1,2,3]'), { ok: false, reason: 'malformed' });
  // Unknown message type and unsupported protocol version are the same class of
  // "not for us" — counted and dropped, never acted on.
  assert.deepEqual(parseFrame('{"t":"something_else"}'), { ok: false, reason: 'unsupported' });
  assert.deepEqual(
    parseFrame(JSON.stringify({ t: 'fire_evt', v: 2, side: 'A', mask: 1, seq: 1 })),
    { ok: false, reason: 'unsupported' },
  );
  // Present but nonsense fields must not slip through as 0/undefined.
  assert.equal(parseFrame('{"t":"fire_evt","v":1,"side":"A","mask":"3","seq":1}').ok, false);
  assert.equal(parseFrame('{"t":"fire_evt","v":1,"side":"A","mask":999,"seq":1}').ok, false);
  assert.equal(parseFrame('{"t":"fire_evt","v":1,"mask":3,"seq":1}').ok, false);
});

test('parseFrame recognises the panel reachability ping', () => {
  const r = parseFrame('{"t":"fire_ping","v":1,"seq":4}');
  assert.equal(r.ok, true);
  assert.equal(r.frame.t, 'fire_ping');
  assert.equal(r.frame.seq, 4);
});

test('classifySeq drops the 50 ms re-send and survives a controller reboot', () => {
  const seen = Object.create(null);
  assert.equal(classifySeq(seen, 'A', 5), 'accept');
  assert.equal(classifySeq(seen, 'A', 5), 'duplicate');   // the idempotent re-send
  assert.equal(classifySeq(seen, 'A', 6), 'accept');
  // Sides keep independent counters.
  assert.equal(classifySeq(seen, 'B', 1), 'accept');
  // A stoker reboot restarts its per-boot counter at 1 — that must not wedge
  // the side into permanent "duplicate".
  assert.equal(classifySeq(seen, 'A', 1), 'reboot');
  assert.equal(classifySeq(seen, 'A', 2), 'accept');
});

test('combinedState ORs the sides and excludes the whistle bit', () => {
  assert.equal(combinedState({ A: 0, B: 0 }, POOFER_MASK), false);
  assert.equal(combinedState({ A: 0, B: 4 }, POOFER_MASK), true);
  // Whistle alone is NOT flame — it must not flash the fire lights.
  assert.equal(combinedState({ A: WHISTLE_BIT, B: 0 }, POOFER_MASK), false);
  assert.equal(combinedState({ A: WHISTLE_BIT | 1, B: 0 }, POOFER_MASK), true);
});

// ── Listener behaviour over a real socket ──────────────────────────────────

test('an ON edge sets the effect and an OFF edge clears it after the min-ON hold', async () => {
  const h = await harness();
  try {
    await h.send(evt('A', 1, 1, 0));
    await sleep(30);
    assert.deepEqual(h.calls, [true], 'rising edge turns the effect on immediately');

    await h.send(evt('A', 0, 2, 1));
    await sleep(20);
    assert.deepEqual(h.calls, [true], 'still held by the min-ON window');

    await sleep(80);
    assert.deepEqual(h.calls, [true, false], 'clears once the hold elapses');
    assert.equal(h.listener.getStatus().effectState, false);
  } finally { h.close(); }
});

test('a strobing burst coalesces into ONE on/off pair', async () => {
  const h = await harness();
  try {
    // 8 fast edges inside the 60 ms min-ON window — what a native effect step
    // sequence looks like. Without coalescing this would be 8 HTTP calls (and 8
    // engine state-file writes) and an unreadable flicker.
    for (let i = 0; i < 8; i++) {
      await h.send(evt('A', i % 2 === 0 ? 1 : 0, i + 1, i % 2 === 0 ? 0 : 1));
      await sleep(6);
    }
    await sleep(120);
    assert.deepEqual(h.calls, [true, false]);
  } finally { h.close(); }
});

test('the whistle bit alone never lights the effect', async () => {
  const h = await harness();
  try {
    await h.send(evt('A', WHISTLE_BIT, 1, 0));
    await sleep(40);
    assert.deepEqual(h.calls, []);
  } finally { h.close(); }
});

test('the effect holds while EITHER side is still firing', async () => {
  const h = await harness();
  try {
    await h.send(evt('A', 1, 1, 0));
    await h.send(evt('B', 1, 1, 0));
    await sleep(30);
    assert.deepEqual(h.calls, [true]);

    await h.send(evt('A', 0, 2, 1));   // A stops, B still firing
    await sleep(120);
    assert.deepEqual(h.calls, [true], 'B keeps it lit');

    await h.send(evt('B', 0, 2, 1));
    await sleep(120);
    assert.deepEqual(h.calls, [true, false]);
  } finally { h.close(); }
});

test('duplicate and malformed datagrams are counted, not acted on', async () => {
  const h = await harness();
  try {
    await h.send(evt('A', 1, 1, 0));
    await h.send(evt('A', 1, 1, 0));     // the controller's +50 ms re-send
    await h.send('}{ not json');
    await h.send('{"t":"who_knows"}');
    await sleep(40);

    const s = h.listener.getStatus();
    assert.equal(s.applied, 1);
    assert.equal(s.duplicate, 1);
    assert.equal(s.invalid, 2);
    assert.deepEqual(h.calls, [true], 'one POST despite four datagrams');
  } finally { h.close(); }
});

test('every understood frame is acked back to its sender', async () => {
  const h = await harness();
  try {
    await h.send(evt('A', 1, 9, 0));
    await h.send('{"t":"fire_ping","v":1,"seq":42}');
    await sleep(60);
    assert.deepEqual(h.acks.map(a => a.seq).sort((x, y) => x - y), [9, 42]);
    assert.ok(h.acks.every(a => a.t === 'fire_ack' && a.v === 1));
  } finally { h.close(); }
});

test('a fire_ping never disturbs the effect state', async () => {
  const h = await harness();
  try {
    await h.send('{"t":"fire_ping","v":1,"seq":1}');
    await sleep(40);
    assert.deepEqual(h.calls, []);
  } finally { h.close(); }
});

test('a failing effect transport is counted and logged once, never thrown', async () => {
  const h = await harness({ setEffect: async () => { throw new Error('boom'); } });
  try {
    await h.send(evt('A', 1, 1, 0));
    await sleep(40);
    const s = h.listener.getStatus();
    assert.equal(s.errors, 1);
    assert.equal(s.effectState, false, 'state is not claimed when the POST failed');
    assert.match(s.lastError, /boom/);
  } finally { h.close(); }
});

// ── Constructor validation (hard-fail, osc_listener convention) ────────────

test('the constructor refuses bad config instead of running half-wired', () => {
  const base = { port: 7703, effect: 'vintageWhite', apiPort: 6968 };
  assert.throws(() => new FireSyncListener({ ...base, port: 0 }), /port/);
  assert.throws(() => new FireSyncListener({ ...base, effect: '' }), /effect/);
  assert.throws(() => new FireSyncListener({ ...base, triggerMask: 0 }), /triggerMask/);
  assert.throws(() => new FireSyncListener({ ...base, triggerMask: 999 }), /triggerMask/);
  assert.throws(() => new FireSyncListener({ ...base, minOnMs: -1 }), /minOnMs/);
  assert.throws(() => new FireSyncListener({ port: 7703, effect: 'x' }), /API port/);
});

// ── Trigger envelope: fire_cfg / cfg_ack (LIGHTS ONLY) ─────────────────────
//
// The panel owns and persists MIN HOLD / RELEASE and pushes them here. These
// tests pin the contract the panel's console renders against: bounds are
// enforced (never clamped), the ack echoes what is IN FORCE, and nothing on
// this path touches the effect state.

test('parseFrame accepts a well-formed fire_cfg and refuses out-of-range values', () => {
  const ok = parseFrame('{"t":"fire_cfg","v":1,"seq":9,"min_on":200,"release":800}');
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok.frame }, { t: 'fire_cfg', seq: 9, minOn: 200, release: 800 });
  // Out of range is MALFORMED — dropped whole. A clamped envelope would apply a
  // number nobody asked for, which is exactly what the panel refuses to do too.
  assert.equal(parseFrame('{"t":"fire_cfg","v":1,"seq":1,"min_on":5001,"release":0}').ok, false);
  assert.equal(parseFrame('{"t":"fire_cfg","v":1,"seq":1,"min_on":0,"release":5001}').ok, false);
  assert.equal(parseFrame('{"t":"fire_cfg","v":1,"seq":1,"min_on":-1,"release":0}').ok, false);
  // Missing / non-integer fields are never silently defaulted.
  assert.equal(parseFrame('{"t":"fire_cfg","v":1,"seq":1,"min_on":100}').ok, false);
  assert.equal(parseFrame('{"t":"fire_cfg","v":1,"seq":1,"min_on":"100","release":0}').ok, false);
  // Wrong protocol version is "not for us", like every other frame.
  assert.deepEqual(
    parseFrame('{"t":"fire_cfg","v":2,"seq":1,"min_on":100,"release":100}'),
    { ok: false, reason: 'unsupported' },
  );
});

test('a fire_cfg applies the envelope at runtime and is answered with cfg_ack', async () => {
  const applied = [];
  const h = await harness({ minOnMs: 150, releaseMs: 400, applyRelease: (ms) => applied.push(ms) });
  try {
    assert.deepEqual(applied, [400], 'the configured release goes in force at bind time');
    await h.send({ t: 'fire_cfg', v: 1, seq: 7, min_on: 250, release: 900 });
    await sleep(40);
    assert.equal(h.listener.minOnMs, 250);
    assert.equal(h.listener.releaseMs, 900);
    assert.deepEqual(applied, [400, 900], 'the release half is handed to the renderer');
    const ack = h.acks.find(a => a.t === 'cfg_ack');
    assert.ok(ack, 'the panel gets a cfg_ack');
    assert.deepEqual(
      { t: ack.t, v: ack.v, seq: ack.seq, min_on: ack.min_on, release: ack.release },
      { t: 'cfg_ack', v: 1, seq: 7, min_on: 250, release: 900 },
      'the ack echoes the values NOW IN FORCE',
    );
    assert.deepEqual(h.calls, [], 'a cfg frame never touches the effect state');
    const s = h.listener.getStatus();
    assert.equal(s.releaseMs, 900);
    assert.equal(s.releaseApplied, true);
    assert.equal(s.cfgSeq, 7);
  } finally { h.close(); }
});

test('an out-of-range fire_cfg changes nothing and is counted invalid', async () => {
  const applied = [];
  const h = await harness({ minOnMs: 150, releaseMs: 400, applyRelease: (ms) => applied.push(ms) });
  try {
    await h.send({ t: 'fire_cfg', v: 1, seq: 1, min_on: 99999, release: 400 });
    await sleep(40);
    assert.equal(h.listener.minOnMs, 150, 'the running envelope is untouched');
    assert.equal(h.listener.releaseMs, 400);
    assert.deepEqual(applied, [400], 'no second apply');
    assert.equal(h.acks.filter(a => a.t === 'cfg_ack').length, 0, 'nothing is acked');
    assert.equal(h.listener.getStatus().invalid, 1);
  } finally { h.close(); }
});

test('a pushed min-ON takes effect on the very next burst', async () => {
  const h = await harness({ minOnMs: 30, releaseMs: 0 });
  try {
    await h.send({ t: 'fire_cfg', v: 1, seq: 1, min_on: 300, release: 0 });
    await sleep(20);
    await h.send(evt('A', 1, 1, 0));      // rising edge
    await h.send(evt('A', 0, 2, 1));      // immediate fall — a blip
    await sleep(120);
    assert.deepEqual(h.calls, [true], 'still held: the new 300 ms MIN HOLD is in force');
    await sleep(260);
    assert.deepEqual(h.calls, [true, false], 'released once the hold expires');
  } finally { h.close(); }
});

test('a renderer that refuses a release is logged, not fatal, and the ack tells the truth', async () => {
  const h = await harness({
    releaseMs: 400,
    applyRelease: (ms) => { if (ms > 1000) throw new Error('renderer bound 0..1000'); },
  });
  try {
    await h.send({ t: 'fire_cfg', v: 1, seq: 3, min_on: 100, release: 2000 });
    await sleep(40);
    const ack = h.acks.find(a => a.t === 'cfg_ack');
    assert.ok(ack);
    assert.equal(ack.release, 400, 'the ack reports the release still IN FORCE, not the request');
    assert.equal(ack.min_on, 100);
    assert.match(h.listener.getStatus().lastError, /renderer bound/);
  } finally { h.close(); }
});
