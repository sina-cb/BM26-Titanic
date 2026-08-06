/**
 * universe_router.test.js — `UniverseRouter` + `UniverseFrameBuffer`
 * (catalog 20260805_161 gap G5, rank 6): the merge core that decides both
 * what the sim RENDERS and what bytes `sacn_in` relays to real controllers
 * (`animate.js:732` `getFullFrame` feeds `sendUniverse`). ZERO tests existed
 * on either module before this file.
 *
 * `performance.now()` is monkeypatched to a controllable fake clock so
 * `SOURCE_STALE_MS` (2000 ms) boundary behavior is exact and instant, never a
 * real wait.
 */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { UniverseRouter } from '../src/dmx/universe_router.js';
import { UniverseFrameBuffer } from '../src/dmx/universe_frame_buffer.js';

const realNow = globalThis.performance.now.bind(globalThis.performance);
let fakeNow = 0;
function useFakeClock() {
  fakeNow = 0;
  globalThis.performance.now = () => fakeNow;
}
function restoreClock() {
  globalThis.performance.now = realNow;
}

function fullBuffer(value) { return new Uint8Array(512).fill(value); }

beforeEach(() => useFakeClock());
after(() => restoreClock());

test('G5: source_lock — the highest-priority ACTIVE source owns the entire universe', () => {
  const r = new UniverseRouter('highest_priority_source_lock');
  r.addUniverse(1);
  r.submitFrame('low', 100, 1, fullBuffer(17));
  r.submitFrame('high', 200, 1, fullBuffer(255));
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(255)]);

  // The high source goes stale (silent); the low one keeps submitting.
  fakeNow += 2500;
  r.submitFrame('low', 100, 1, fullBuffer(17));
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(17)],
    'once the high-priority source is stale, the next-highest ACTIVE source takes over');
});

test('G5: stale boundary is STRICT — exactly 2000ms is inactive, 1999ms is still active', () => {
  const r = new UniverseRouter();
  r.addUniverse(1);
  r.submitFrame('src', 100, 1, fullBuffer(9));

  fakeNow = 1999;
  assert.equal(r.isSourceActive('src'), true);
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(9)], 'still active at 1999ms — merges');

  fakeNow = 0;
  const r2 = new UniverseRouter();
  r2.addUniverse(1);
  r2.submitFrame('src', 100, 1, fullBuffer(9));
  fakeNow = 2000;
  assert.equal(r2.isSourceActive('src'), false, 'exactly 2000ms IS stale — the check is `< 2000`');
  r2.processFrame();
  assert.deepEqual([...r2.getFullFrame(1)], [...fullBuffer(0)],
    'a stale source contributes nothing to a frame that was never otherwise written');
});

test('G5: hold-last-frame — all sources stale ⇒ the read buffer keeps its last frame, write buffer stays zero',
  () => {
    const r = new UniverseRouter();
    r.addUniverse(1);
    r.submitFrame('src', 100, 1, fullBuffer(42));
    r.processFrame();
    assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(42)]);

    fakeNow += 5000; // now stale; no further submitFrame
    r.processFrame(); // buffer never dirtied this pass ⇒ swap() is a no-op
    assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(42)],
      'hold-last-frame: the read buffer must retain the last valid merge, not go dark or garbage');
  });

test('G5: htp merges per-channel MAX across overlapping partial writes; a lone channel keeps its ' +
  'only source\'s value', () => {
  const r = new UniverseRouter('htp');
  r.addUniverse(1);
  const a = new Uint8Array(10).fill(50);   // channels 1-10
  const b = new Uint8Array(10).fill(200);  // channels 6-15, overlaps 6-10
  b[9] = 30; // channel 15's overlap-adjacent lone value stays legible
  r.submitFrame('a', 100, 1, a, 1);
  r.submitFrame('b', 100, 1, b, 6);
  r.processFrame();
  const frame = r.getFullFrame(1);
  for (let ch = 1; ch <= 5; ch += 1) assert.equal(frame[ch - 1], 50, `ch${ch} only 'a' wrote it`);
  for (let ch = 6; ch <= 10; ch += 1) assert.equal(frame[ch - 1], 200, `ch${ch} htp max(50,200)`);
  assert.equal(frame[14], 30, 'ch15 only "b" wrote it — kept as-is, no other source to max against');
});

test('G5: highest_priority_per_patch is CURRENTLY identical to source_lock (per-patch routing ' +
  'is unimplemented) — characterization', () => {
  const r = new UniverseRouter('highest_priority_per_patch');
  r.addUniverse(1);
  r.submitFrame('low', 100, 1, fullBuffer(17));
  r.submitFrame('high', 200, 1, fullBuffer(255));
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(255)],
    'characterization: this mode does NOT yet do per-patch ownership — if it ever does, THIS ' +
    'test must be rewritten (not silently deleted) to prove the per-patch behavior instead');
});

test('G5: write() bounds — a full 512 fills exactly; write(500, 20) clips at channel 512, no throw',
  () => {
    const buf = new UniverseFrameBuffer(1);
    buf.write(1, new Uint8Array(512).fill(5));
    buf.swap();
    assert.deepEqual([...buf.getReadBuffer()], [...fullBuffer(5)]);

    const buf2 = new UniverseFrameBuffer(2);
    assert.doesNotThrow(() => buf2.write(500, new Uint8Array(20).fill(7)));
    buf2.swap();
    const frame = buf2.getReadBuffer();
    for (let ch = 500; ch <= 512; ch += 1) assert.equal(frame[ch - 1], 7);
    assert.equal(frame[512], undefined, 'a 512-length Uint8Array has no index 512 — no overflow');
  });

test('G5: getSlice clamps at the buffer end — a 512-footprint request at 510 yields a 3-byte view',
  () => {
    const buf = new UniverseFrameBuffer(1);
    buf.write(1, new Uint8Array(512).fill(1));
    buf.swap();
    const slice = buf.getSlice(510, 10);
    assert.equal(slice.length, 3,
      'subarray clamps to the buffer end — a future "pad to footprint" change must be deliberate');
  });

test('G5: getSlice returns a LIVE view — it reflects the buffer after the next swap()', () => {
  const buf = new UniverseFrameBuffer(1);
  buf.write(136, new Uint8Array(10).fill(1));
  buf.swap();
  const view = buf.getSlice(136, 10);
  assert.equal(view[0], 1);
  buf.write(136, new Uint8Array(10).fill(99));
  buf.swap();
  assert.equal(view[0], 99, 'the SAME view object must show the new frame — fixture runtimes rely on this');
});

test('G5: equal priorities — the FIRST-SUBMITTED source (by first-ever use, not last update) wins',
  () => {
    const r = new UniverseRouter();
    r.addUniverse(1);
    r.submitFrame('A', 100, 1, fullBuffer(11));
    r.submitFrame('B', 100, 1, fullBuffer(22));
    r.processFrame();
    assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(11)],
      'stable sort + Map insertion order: A was submitted first and stays first among equals');
  });

test('G5: submitFrame updates a source\'s priority on every call; clear() zeroes both buffers', () => {
  const r = new UniverseRouter();
  r.addUniverse(1);
  r.submitFrame('A', 100, 1, fullBuffer(1));
  r.submitFrame('B', 50, 1, fullBuffer(2));
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(1)], 'A (100) beats B (50)');

  r.submitFrame('B', 999, 1, fullBuffer(2)); // B re-priorities itself above A
  r.processFrame();
  assert.deepEqual([...r.getFullFrame(1)], [...fullBuffer(2)], 'B now outranks A');

  const buf = r.getUniverse(1);
  buf.clear();
  assert.deepEqual([...buf.getReadBuffer()], [...fullBuffer(0)]);
  assert.equal(buf._dirty, false);
});
