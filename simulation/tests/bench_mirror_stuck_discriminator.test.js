/**
 * bench_mirror_stuck_discriminator.test.js — the STUCK discriminator must be
 * able to answer "NOT stuck" (report 20260815_233, from the forensics in
 * 20260815_229).
 *
 * THE INCIDENT. A 3h43m armed session produced 975 `frame NOT WHOLE` lines and
 * 48 `BENCH MIRROR STUCK` lines telling the operator to **RESTART THE ENGINE**.
 * All 48 were false. The bench was mirroring normally the entire time: the
 * engine writes all 38 universes in ONE synchronous burst, a libuv poll phase
 * that delivers part of that burst leaves the destination reading `{N+1, N, N}`
 * for a millisecond, and the destination composed a whole frame between every
 * single tear (`count in this run` was 1 in all 975 lines, never 2).
 *
 * The old discriminator could not see that. It normalised offsets against the
 * MOST ADVANCED source — which gives the leader 0 and every other source < 0 by
 * construction — and then asked "did every source reach lag 0 while torn?". A
 * source that is merely systematically last in the send burst never can, so six
 * consecutive torn flushes were enough to declare a FIXED sender offset.
 *
 * So this file drives the exact shapes that produced the false alarms and
 * requires SILENCE, and drives a genuine offset and requires the alarm. The
 * negative direction is the point: a watchdog that cannot say "not stuck" is
 * not a watchdog.
 *
 * ZERO PACKETS, ZERO PORTS — the fake-module harness, like every other bench
 * mirror spec. The operator's live stack owns 6966-6972 and UDP 5568.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { GATEWAY, connect, armFrom, disarmFrom, settle, inbound,
  sends, sendsTo, captureConsole, releaseConsole, logs } = H;

/** `MIRROR_FIXED_OFFSET_FLUSHES` in the bridge — the persistence window. */
const FIXED_OFFSET_FLUSHES = 6;

const stuckLines = () => logs.filter((l) => /BENCH MIRROR STUCK/.test(l));
const notWholeLines = () => logs.filter((l) => /BENCH MIRROR frame NOT WHOLE/.test(l));

/** The composed gateway's distinct source universes, and one systematic leader. */
function sourcesOf() {
  const sources = [...new Set(GATEWAY.slices.map((s) => s.sourceUniverse))];
  assert.ok(sources.length > 2, 'the gateway must compose from several sources');
  return sources;
}

let ws;
let seq = 0;
const nextSeq = () => { seq = (seq + 1) % 256; return seq; };

test('arm the mirror', async () => {
  ws = connect();
  const armed = await armFrom(ws, 'test_bench');
  assert.ok(armed.armed, 'nothing below means anything unless the mirror is armed');
});

test('_233 F1/F3: a source that is ALWAYS last in the burst is never called STUCK', async () => {
  // THE FALSE POSITIVE, EXACTLY. One source's datagram always lands in the poll
  // phase before its siblings', so it leads on every torn flush and they trail
  // on every torn flush — the shape the old detector read as "these sources
  // never catch up, therefore FIXED offset". Each cycle tears for more than
  // `MIRROR_FIXED_OFFSET_FLUSHES` consecutive flushes (the whole trigger the 48
  // false lines fired on) and then composes a whole frame, which is what a real
  // burst tear does and a real sender offset never does.
  const sources = sourcesOf();
  const leader = sources[0];
  const trailing = sources.slice(1);
  logs.length = 0;
  sends.length = 0;
  captureConsole();
  try {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      let s = 0;
      // The leader runs ahead for more flushes than the persistence window.
      for (let k = 0; k < FIXED_OFFSET_FLUSHES + 2; k += 1) {
        s = nextSeq();
        inbound(leader, { 1: 5, 2: 9 }, s);
        await settle(1);                 // each of these is a TORN flush
      }
      // …then the rest of the burst lands and the frame composes whole.
      for (const u of trailing) inbound(u, { 1: 5, 2: 9 }, s);
      await settle(2);
    }
  } finally {
    releaseConsole();
  }

  assert.equal(stuckLines().length, 0,
    'a systematically-late source that composes whole frames between tears is NOT stuck — ' +
    `this is the shape that produced 48 false alarms in one session:\n${stuckLines()[0] || ''}`);
  assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length >= 15,
    'and the destination must have kept emitting throughout — the tears cost single frames');
});

test('_233 F2: even a LONG tear is not STUCK while whole frames keep composing', async () => {
  // Half a second of continuous tearing — past the settling grace, past the
  // persistence window — but the destination composes a whole frame before the
  // no-whole-frame window elapses. That is a mirror dropping frames, which is
  // worth a line, and it is NOT a mirror that is stuck, which is worth an ❌.
  const sources = sourcesOf();
  const leader = sources[0];
  const trailing = sources.slice(1);
  logs.length = 0;
  sends.length = 0;
  const start = Date.now();
  let s = 0;
  captureConsole();
  try {
    while (Date.now() - start < 500) {
      s = nextSeq();
      inbound(leader, { 1: 5, 2: 9 }, s);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (const u of trailing) inbound(u, { 1: 5, 2: 9 }, s);
    await settle(4);
  } finally {
    releaseConsole();
  }

  assert.equal(stuckLines().length, 0, 'a tear that recovers is never STUCK');
  const notWhole = notWholeLines();
  assert.ok(notWhole.length > 0,
    'but a tear that outlives the settling grace must still be named — silence there would hide ' +
    'real frame loss');
  assert.match(notWhole[0], /frame\(s\) in this run/,
    'and must report the run, so the operator can see it is not a one-off');
  assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length > 0,
    'emission resumes the moment the burst completes — the gate is a refusal, not a latch');
});

test('_233 F4: sub-grace tears are not printed one line at a time', async () => {
  // 975 immediate `⚠` lines for a 0.6 % tear rate is what buried the real
  // signal. A tear the next frame erases now costs nothing on screen; it is
  // counted, and the cumulative total rides every line that does print.
  const sources = sourcesOf();
  const leader = sources[0];
  const trailing = sources.slice(1);
  logs.length = 0;
  captureConsole();
  try {
    for (let i = 0; i < 30; i += 1) {
      const s = nextSeq();
      inbound(leader, { 1: 5, 2: 9 }, s);
      await settle(1);                   // one torn flush…
      for (const u of trailing) inbound(u, { 1: 5, 2: 9 }, s);
      await settle(2);                   // …erased by the next arrival
    }
  } finally {
    releaseConsole();
  }
  assert.equal(notWholeLines().length, 0,
    `30 single-frame burst tears must not print 30 warnings:\n${notWholeLines()[0] || ''}`);
  assert.equal(stuckLines().length, 0);
});

test('_233 F2: a GENUINE fixed offset — zero whole frames — still declares STUCK', async () => {
  // The other direction, and the one that must never be lost: sources that are
  // permanently apart compose NOTHING, so the destination is dark and the
  // operator has to hear about it. Large constant offset, every frame, no whole
  // frame ever — held past the no-whole-frame window in real time, because that
  // window is the discriminator.
  const sources = sourcesOf();
  const laggard = sources[sources.length - 1];
  const OFFSET = 70;
  logs.length = 0;
  sends.length = 0;
  captureConsole();
  try {
    const start = Date.now();
    while (Date.now() - start < 1400) {
      const s = nextSeq();
      for (const u of sources) {
        inbound(u, { 1: 5, 2: 9 }, u === laggard ? (s - OFFSET + 256) % 256 : s);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await settle(4);
  } finally {
    releaseConsole();
  }

  const stuck = stuckLines();
  assert.ok(stuck.length > 0, 'a destination that has composed NOTHING must be diagnosed');
  assert.match(stuck[0], new RegExp(`U\\d+ at [-+]${OFFSET}\\b`), 'and the offset named');
  assert.match(stuck[0], /NO whole frame has composed/,
    'the line must state the measurement that separates this from a burst tear');
  assert.ok(!/RESTART THE ENGINE/.test(stuck[0]),
    'and must NOT repeat the instruction that was wrong 48 times out of 48');
  assert.equal(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length, 0,
    'nothing may go out while the frame cannot be composed whole');
});

test('_233: the alarm CLEARS on its own once the sources agree again', async () => {
  // A stuck diagnosis is a refusal, not a latch: no restart, no re-arm.
  const sources = sourcesOf();
  sends.length = 0;
  logs.length = 0;
  captureConsole();
  try {
    for (let i = 0; i < 12; i += 1) {
      const s = nextSeq();
      for (const u of sources) inbound(u, { 1: 5, 2: 9 }, s);
      await settle(2);
    }
  } finally {
    releaseConsole();
  }
  assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length > 0,
    'the destination must resume emitting the moment its sources agree');
  assert.equal(stuckLines().length, 0, 'and stop being called stuck');
});

test('disarm', async () => {
  const status = await disarmFrom(ws);
  assert.equal(status.armed, false);
});
