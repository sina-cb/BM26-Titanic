/**
 * jitter_buffer.test.js — the steady-clock smoothing buffer (docs/37 §13).
 * Deterministic: the clock is injected via pull(nowMs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JitterBuffer } from '../audio/capture/jitter_buffer.js';

const HOP = 512, SR = 44100;
const HOP_MS = (HOP / SR) * 1000;            // ≈ 11.61
const frame = (v = 0) => Int16Array.from({ length: HOP }, () => v);

test('constructor validates inputs (fail loud)', () => {
  assert.throws(() => new JitterBuffer(), /requires options/);
  assert.throws(() => new JitterBuffer({ hopSamples: 0, sampleRate: SR }), /hopSamples/);
  assert.throws(() => new JitterBuffer({ hopSamples: HOP, sampleRate: 0 }), /sampleRate/);
});

test('does not drain until prefill is reached', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 4 });
  jb.push(frame()); jb.push(frame()); jb.push(frame());      // 3 < prefill 4
  assert.deepEqual(jb.pull(0), []);
  assert.deepEqual(jb.pull(100), []);                         // time passing alone won't start it
  jb.push(frame());                                           // now 4 → armed on next pull
  const first = jb.pull(0);
  assert.equal(first.length, 1, 'emits the first hop once prefill is met');
});

test('releases ONE hop per nominal hop period (steady cadence)', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 2, maxHops: 50 });
  for (let i = 0; i < 20; i++) jb.push(frame(i));
  let t = 0, emitted = 0;
  jb.pull(t);                                                 // arm + emit hop #0
  emitted += 1;
  // advance in hopMs steps; expect exactly one hop each step.
  for (let i = 0; i < 10; i++) { t += HOP_MS; const out = jb.pull(t); assert.equal(out.length, 1); emitted += out.length; }
  assert.equal(emitted, 11);
  assert.equal(jb.underruns, 0);
});

test('smooths a BURST: many-in-at-once → one-out-per-hop', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 3, maxHops: 50 });
  // A burst of 8 hops arrives at t=0 (the "super-chunk").
  for (let i = 0; i < 8; i++) jb.push(frame(i));
  const atStart = jb.pull(0);
  assert.equal(atStart.length, 1, 'only one hop leaves at t=0, not the whole burst');
  // Drain at the hop cadence — the backlog feeds out evenly.
  let seen = atStart.length;
  for (let i = 1; i <= 7; i++) { const out = jb.pull(i * HOP_MS); assert.equal(out.length, 1); seen += 1; }
  assert.equal(seen, 8, 'all 8 hops eventually released, one per period');
});

test('catch-up: a long pull gap releases the hops that came due (bounded by availability)', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 2, maxHops: 50 });
  for (let i = 0; i < 6; i++) jb.push(frame(i));
  jb.pull(0);                                                 // arm, emit #0
  const out = jb.pull(3 * HOP_MS);                            // 3 periods elapsed → 3 due
  assert.equal(out.length, 3);
});

test('underrun: due hops with an empty queue are SKIPPED, never zero-filled', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 2, maxHops: 50 });
  jb.push(frame()); jb.push(frame());
  jb.pull(0);                                                 // arm, emit hop #0
  jb.pull(HOP_MS);                                            // emit hop #1 → queue now empty
  const out = jb.pull(6 * HOP_MS);                            // 4 more periods, nothing buffered
  assert.equal(out.length, 0, 'no fabricated audio');
  assert.ok(jb.underruns >= 3, `underruns counted; got ${jb.underruns}`);
});

test('maxHops cap drops the oldest to bound latency', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 2, maxHops: 5 });
  for (let i = 0; i < 9; i++) jb.push(frame(i));              // 4 over the cap
  assert.equal(jb.depthHops, 5);
  assert.equal(jb.dropped, 4);
});

test('reset clears state', () => {
  const jb = new JitterBuffer({ hopSamples: HOP, sampleRate: SR, prefillHops: 2 });
  jb.push(frame()); jb.push(frame()); jb.pull(0);
  jb.reset();
  assert.equal(jb.depthHops, 0);
  assert.equal(jb.underruns, 0);
  assert.deepEqual(jb.pull(0), []);
});
