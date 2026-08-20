/**
 * bench_mirror_stuck_longevity.test.js — the ARMED bridge must OUTLIVE an
 * indefinitely stuck mirror, still shouting (report 20260814_212).
 *
 * INCIDENT, 2026-08-14. An engine model reload while the mirror was armed left
 * one universe's sACN sender at a permanent sequence offset from its siblings,
 * so the composition proof ("all my regions carry the SAME engine frame")
 * refused every frame. That is the design working — a mixed frame would leave
 * those fixtures on a STEADY WRONG COLOUR. But the bridge then sat in that state
 * for ~20 minutes, and at the end of it the sacn-in process exited code=1.
 *
 * The exit turned out NOT to be the stuck mirror (it was a force-kill from
 * outside — on Windows that is exactly code=1 with no output). But nothing in
 * the suite proved that, and "20 minutes of refusing frames" is a state the
 * router must survive indefinitely: while armed it is the ONLY writer to the
 * rig, and if it dies every mirrored box freezes on its last frame with no
 * blackout — a lit ship that looks alive and is not.
 *
 * So this file pins the property the incident could not distinguish: under a
 * SUSTAINED fixed-offset stall the bridge keeps refusing, keeps NAMING it, does
 * not accumulate per-flush state, and is still fully functional afterwards.
 *
 * The stall is synthetic and ACCELERATED — thousands of flushes with no timers
 * — so it costs a second rather than twenty minutes. Zero packets, zero ports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { GATEWAY, connect, armFrom, disarmFrom, optionsFrom, settle, inbound,
  sends, sendsTo, captureConsole, releaseConsole, logs } = H;

/** How far behind the laggard universe sits — constant, so it never catches up. */
const FIXED_OFFSET = 70;
/** Sustained stall length. 20 min at 40 fps is ~48k frames; this is the shape. */
const STUCK_FRAMES = 4000;

/**
 * One engine frame in which a single source universe carries a PERMANENTLY
 * offset sequence — the exact shape a model reload leaves behind.
 */
function stuckFrame(sources, laggard, seq) {
  for (const u of sources) {
    const s = u === laggard ? (seq - FIXED_OFFSET + 256) % 256 : seq;
    inbound(u, { 1: 5, 2: 9 }, s);
  }
}

test('a SUSTAINED fixed-offset stall never kills the bridge, and never stops being named',
  async () => {
    const ws = connect();
    const armed = await armFrom(ws, 'test_bench');
    assert.ok(armed.armed, 'the mirror must be armed for this test to mean anything');

    const sources = [...new Set(GATEWAY.slices.map((s) => s.sourceUniverse))];
    assert.ok(sources.length > 1, 'the gateway must compose from several sources');
    const laggard = sources[sources.length - 1];

    sends.length = 0;
    logs.length = 0;

    // ── Drive the stall ────────────────────────────────────────────────────
    let seq = 0;
    const heapAfterWarmup = { value: 0 };
    captureConsole();
    try {
      for (let i = 0; i < STUCK_FRAMES; i += 1) {
        seq = (seq + 1) % 256;
        stuckFrame(sources, laggard, seq);
        // Let the scheduled flush actually run, or nothing is being tested.
        if (i % 8 === 0) await settle(1);
        // REAL TIME, once, in the middle (report 20260815_233 F2). STUCK is now
        // gated on "this destination has composed NO whole frame for
        // MIRROR_STUCK_NO_WHOLE_MS" — the one property a burst-torn read can
        // never satisfy. 4000 synthetic frames otherwise fly past in ~300 ms of
        // wall clock, which is not a stall by that definition and must not be
        // diagnosed as one. A genuine offset has no trouble reaching it: at
        // 40 fps this is a single dark second.
        if (i === Math.floor(STUCK_FRAMES / 2)) {
          await new Promise((resolve) => setTimeout(resolve, 1300));
        }
        // Baseline the heap AFTER the caches and JIT have settled, so the
        // growth assertion measures accumulation and not warm-up.
        if (i === Math.floor(STUCK_FRAMES / 4)) {
          heapAfterWarmup.value = process.memoryUsage().heapUsed;
        }
      }
      await settle(8);
    } finally {
      releaseConsole();
    }

    // ── 1. It refused, for the whole stall ────────────────────────────────
    assert.equal(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length, 0,
      'a destination whose sources are at a fixed offset must emit NOTHING — a mixed frame ' +
      'would leave those fixtures on a steady wrong colour');

    // ── 2. It is still SHOUTING at the end, not quietly wedged ────────────
    const stuck = logs.filter((l) => /BENCH MIRROR STUCK/.test(l));
    assert.ok(stuck.length > 0, 'the fixed offset must be diagnosed by name');
    // Which universe gets named is the modular reading of the skew (a 70-frame
    // offset one way is 186 the other, and `offsetSignature` reports whichever
    // is smaller), so the property pinned here is that the offset is still
    // being named at the END of the stall — a watchdog that goes quiet after
    // the first minute is how a stuck mirror gets mistaken for a working one.
    // The sign depends on which side of the anchor the laggard sits (offsets are
    // measured against the LOWEST-numbered source since report 20260815_233 F3);
    // the magnitude is the fixed skew and must still be named at the END.
    assert.match(stuck[stuck.length - 1], new RegExp(`U\\d+ at [-+]${FIXED_OFFSET}\\b`),
      'the LAST stuck line must still name the fixed offset, not fall silent');
    assert.ok(stuck[stuck.length - 1].includes('sending NOTHING'),
      'and must still say the destination is dark, so the state is never mistaken for healthy');
    // The remedy must be named — but NOT the one that was wrong 48 times out of
    // 48 (`_229` §6). `_212` made "the engine's senders drifted apart" impossible
    // by construction, so the line now states the measurement and points at the
    // causes that remain.
    assert.match(stuck[0], /NO whole frame has composed/,
      'the stuck line must state what was MEASURED, not a guess at the cause');
    assert.match(stuck[0], /DO NOT restart the engine/);
    assert.match(stuck[0], /SECOND WRITER|DISARM and re-arm/,
      'the remedy must be named, not just the symptom');

    // ── 3. The naming is THROTTLED, not one line per refused frame ────────
    const misaligned = logs.filter((l) => /BENCH MIRROR (STUCK|frame NOT WHOLE)/.test(l));
    assert.ok(misaligned.length < STUCK_FRAMES / 4,
      `a sustained stall must not log once per frame — ${misaligned.length} lines for ` +
      `${STUCK_FRAMES} frames`);

    // ── 4. Nothing accumulated ────────────────────────────────────────────
    // Every per-gather structure is keyed by DESTINATION, so a stall of any
    // length must cost the same as a stall of one frame. A per-flush leak (a
    // pending-frame list, a growing counter map, a buffered log) would show as
    // heap growth proportional to STUCK_FRAMES.
    const grew = process.memoryUsage().heapUsed - heapAfterWarmup.value;
    assert.ok(grew < 24 * 1024 * 1024,
      `the stuck path must be O(1) in the stall's length — heap grew ${Math.round(grew / 1048576)} MB ` +
      `over ${STUCK_FRAMES} refused frames, which is per-flush accumulation`);

    // ── 5. Still ALIVE and functional — the whole point ───────────────────
    // A request that makes the bridge re-read scene data from disk and reply:
    // proof the event loop, the WS handler and the resolver all still work
    // after thousands of refused frames.
    const options = await optionsFrom(ws, 'test_bench');
    assert.ok(options && Array.isArray(options.slots) && options.slots.length > 0,
      'the bridge must still answer a picker request after a sustained stall');

    // ── 6. And it RECOVERS the moment the offset goes away ────────────────
    // No restart, no re-arm: the stall is a refusal, not a latch.
    sends.length = 0;
    for (let i = 0; i < 12; i += 1) {
      seq = (seq + 1) % 256;
      for (const u of sources) inbound(u, { 1: 5, 2: 9 }, seq);
      await settle(2);
    }
    assert.ok(sendsTo(GATEWAY.destHost, GATEWAY.destUniverse).length > 0,
      'once the sources agree again the destination must resume emitting on its own — a stall ' +
      'that needed a re-arm to clear would be a latch, not a gate');

    await disarmFrom(ws);
  });

test('the bridge installs last-resort handlers so a defect cannot silently end the process',
  async () => {
    // The incident cost an hour because the process vanished with `code=1` and
    // nothing else in the launcher log — no way to tell an internal crash from
    // an external kill. Both halves of that gap are closed in source: escaped
    // errors are reported and survived, and an exit the process CHOSE always
    // announces itself.
    const src = await import('node:fs').then((fs) => fs.promises.readFile(
      new URL('../server/sacn_bridge.js', import.meta.url), 'utf8'));

    assert.match(src, /process\.on\('unhandledRejection'/,
      'an escaped rejection must be named, not an anonymous death');
    assert.match(src, /process\.on\('uncaughtException'/);
    assert.match(src, /process\.on\('exit'/,
      'an exit the bridge chose must say so, or a force-kill is indistinguishable from a crash');
    assert.match(src, /fs\.writeSync\(2,/,
      'the diagnostics must be SYNCHRONOUS writes — these paths end in process.exit, and an ' +
      "'exit' listener cannot queue async work");
    // Loud THEN dead, never loud-and-limping: the state is unknown by
    // definition, and a wedged-but-responsive bridge is invisible to the
    // launcher's freeze watchdog, which only kills a server that stops
    // answering. Supervision is the recovery mechanism, so preserve its
    // semantics — exit NONZERO.
    const fatalIdx = src.indexOf('function fatalEscapedError');
    assert.ok(fatalIdx > 0, 'the escaped-error path must be a named function');
    const fatalBody = src.slice(fatalIdx, src.indexOf('\n}', fatalIdx));
    assert.match(fatalBody, /process\.exit\(1\)/,
      'an escaped error must exit NONZERO so the supervisor restarts it — continuing on unknown ' +
      'state is the fallback the codex forbids');
    assert.match(fatalBody, /disarmBenchMirror/,
      'and if the mirror is armed the owned destinations must go dark deliberately, not freeze ' +
      'on their last composed frame');

    // The engine poll is an unawaited async `setInterval` callback, so anything
    // escaping the recompute it runs would become an unhandled rejection.
    assert.match(src, /guardedRecompute\('engine poll'\)/,
      'the recompute reached from the async engine poll must be guarded at the call site');

    // And the read that actually threw: a scene file caught mid-write.
    const treesIdx = src.indexOf('function readSceneTrees');
    const treesBody = src.slice(treesIdx, src.indexOf('\n}', treesIdx));
    assert.match(treesBody, /try \{/,
      'readSceneTrees parses YAML on the armed health path every poll — an editor saving a ' +
      'scene file mid-write must be a named refusal, not a throw that unwinds into a timer');
  });

test('the sACN OUTPUT bridge carries the same breadcrumb, so its silent exits are diagnosable too',
  async () => {
    // It died the same way on the same evening (code=1, no output) during
    // ordinary operation. It holds no sACN sender, no timers and no state, so
    // an internal cause was always unlikely — but nothing PROVED that. These
    // lines make the next occurrence self-diagnosing instead of arguable.
    const src = await import('node:fs').then((fs) => fs.promises.readFile(
      new URL('../server/sacn_output_bridge.js', import.meta.url), 'utf8'));

    assert.match(src, /process\.on\('exit'/,
      'an exit this process chose must announce itself');
    assert.match(src, /process\.on\('uncaughtException'/);
    assert.match(src, /process\.on\('unhandledRejection'/);
    assert.match(src, /fs\.writeSync\(2,/,
      'synchronous, or the very message that explains the exit is the one that gets lost');
    assert.match(src, /force-killed/,
      'the breadcrumb must say what its ABSENCE means, or the next reader re-derives it');
    assert.match(src, /process\.exit\(1\)/,
      'and an escaped error here must also exit NONZERO, so supervision restarts it');
  });
