/**
 * Tests pixel_map_frame_source.js — the single shared per-frame color decode
 * for the 2D Pixel Map multiview (report 20260724_9 §2.1/§5/§6):
 *   - the RGBWAU→display-RGB decode runs exactly ONCE per frame no matter how
 *     many panes are registered;
 *   - the buffer holds preview-brightened display RGB (matches the renderer);
 *   - a painter that throws is dropped loudly, siblings keep running;
 *   - topology bumps notify onTopology once per version change;
 *   - one injected onPixelFrame subscription serves N panes.
 *
 * The frame source imports only node-safe modules (rgbwau_blend, state) and
 * takes the onPixelFrame subscriber by injection, so it loads under node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  startFrameSource, registerPanePainter, onTopology,
  _dispatchForTest, _resetForTest, _painterCount,
} from '../src/gui/pixel_map/pixel_map_frame_source.js';
import { params } from '../src/core/state.js';

function prep() {
  _resetForTest();
  globalThis.window = globalThis.window || {};
  window._patchesActive = false;
  params.showUnpatchedRed = false;
}

// A plain lit-pixel list (no getters).
function litList(n, r = 0.2) {
  return Array.from({ length: n }, (_, i) => ({ r, g: 0, b: 0, w: 0, a: 0, u: 0, name: `p${i}` }));
}

test('decode runs exactly ONCE per frame regardless of pane count', () => {
  prep();
  const counter = { reads: 0 };
  const n = 5;
  // Getter on `r` counts how many times the decode reads each pixel.
  const list = Array.from({ length: n }, (_, i) => {
    const e = { g: 0, b: 0, w: 0, a: 0, u: 0, name: `p${i}` };
    Object.defineProperty(e, 'r', { get() { counter.reads++; return 0.2; } });
    return e;
  });

  registerPanePainter(() => {});
  registerPanePainter(() => {});
  registerPanePainter(() => {});
  assert.equal(_painterCount(), 3);

  _dispatchForTest(list, 1);
  // 3 panes but ONE decode → r read exactly n times, not 3n.
  assert.equal(counter.reads, n);
});

test('color buffer holds preview-brightened display RGB, shared by all panes', () => {
  prep();
  const list = litList(1, 0.1); // dim red → lifted by the preview gamma
  const seen = [];
  registerPanePainter((buf, l, v) => seen.push({ buf, l, v }));
  registerPanePainter((buf) => seen.push({ buf }));

  _dispatchForTest(list, 7);

  // preview gamma 0.6 on value 0.1: s = 0.1^0.6 / 0.1 ; r' = 0.1 * s = 0.1^0.6.
  const expected = Math.pow(0.1, 0.6);
  assert.ok(Math.abs(seen[0].buf[0] - expected) < 1e-6, 'red channel preview-brightened');
  assert.equal(seen[0].buf[1], 0);
  assert.equal(seen[0].buf[2], 0);
  // Both panes got the SAME buffer instance + the frame args.
  assert.equal(seen[0].buf, seen[1].buf);
  assert.equal(seen[0].l, list);
  assert.equal(seen[0].v, 7);
});

test('a painter that throws is unsubscribed loudly; siblings keep painting', () => {
  prep();
  const good = { calls: 0 };
  const bad = { calls: 0 };
  registerPanePainter(() => { good.calls++; });
  registerPanePainter(() => { bad.calls++; throw new Error('boom'); });
  assert.equal(_painterCount(), 2);

  const list = litList(2);
  _dispatchForTest(list, 1); // bad throws → dropped
  assert.equal(_painterCount(), 1);
  assert.equal(good.calls, 1);
  assert.equal(bad.calls, 1);

  _dispatchForTest(list, 1); // only good remains
  assert.equal(good.calls, 2);
  assert.equal(bad.calls, 1, 'the throwing painter never runs again');
});

test('onTopology fires once per version change, before the painters decode', () => {
  prep();
  const versions = [];
  const order = [];
  onTopology((l, v) => { versions.push(v); order.push('topology'); });
  registerPanePainter(() => order.push('paint'));

  const list = litList(1);
  _dispatchForTest(list, 5); // -2 → 5 : notify
  _dispatchForTest(list, 5); // same version : no notify
  _dispatchForTest(list, 6); // 5 → 6 : notify

  assert.deepEqual(versions, [5, 6]);
  // On a notifying frame, the topology listener runs before the painter.
  assert.deepEqual(order.slice(0, 2), ['topology', 'paint']);
});

test('one injected subscription serves N panes; last unregister tears it down', () => {
  prep();
  let subCount = 0, unsubCount = 0, captured = null;
  const fakeOnPixelFrame = (fn) => {
    subCount++;
    captured = fn;
    return () => { unsubCount++; };
  };

  startFrameSource(fakeOnPixelFrame);
  assert.equal(subCount, 0, 'no subscription until a pane registers');

  const p1 = { calls: 0 };
  const p2 = { calls: 0 };
  const un1 = registerPanePainter(() => { p1.calls++; });
  const un2 = registerPanePainter(() => { p2.calls++; });
  assert.equal(subCount, 1, 'exactly ONE onPixelFrame subscription for two panes');

  captured(litList(1), 1); // drive via the injected subscriber
  assert.equal(p1.calls, 1);
  assert.equal(p2.calls, 1);

  un1();
  assert.equal(unsubCount, 0, 'still subscribed while one pane remains');
  un2();
  assert.equal(unsubCount, 1, 'last pane gone → subscription torn down');
});

test('startFrameSource rejects a non-function subscriber (fail loud)', () => {
  prep();
  assert.throws(() => startFrameSource(null), /requires the onPixelFrame subscriber/);
  assert.throws(() => registerPanePainter(42), /requires a function/);
});
