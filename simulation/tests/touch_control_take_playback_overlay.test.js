import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const OVERLAY_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_take_playback_overlay.js');
const PANEL_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html');

const panel = fs.readFileSync(PANEL_PATH, 'utf8');

function stubContext() {
  const state = { clears: 0 };
  const noop = () => {};
  return {
    state,
    setTransform: noop,
    clearRect() { state.clears += 1; },
    beginPath: noop,
    arc: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
  };
}

function buildHarness(options = {}) {
  const errors = [];
  const rafQueue = [];
  const docListeners = new Map();
  const fakeDocument = {
    hidden: false,
    getElementById: () => null,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      if (event.type === 'panelerror') errors.push(event.detail.message);
      (docListeners.get(event.type) || []).forEach((fn) => fn(event));
      return true;
    },
  };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }
  const fakeWindow = {
    document: fakeDocument,
    CustomEvent,
    devicePixelRatio: 1,
    TouchTakeBankRuntime: options.bankState ? { state: options.bankState } : undefined,
    requestAnimationFrame(fn) {
      rafQueue.push(fn);
      return rafQueue.length;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    MutationObserver: undefined,
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.CustomEvent = CustomEvent;
  const require = createRequire(import.meta.url);
  delete require.cache[OVERLAY_PATH];
  const Overlay = require(OVERLAY_PATH);

  const pad = {
    getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
  };
  const ctx = stubContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
  const runtime = Overlay.create({ pad, canvas });

  function flushRaf() {
    while (rafQueue.length) rafQueue.shift()();
  }

  function spatialplay(detail) {
    fakeDocument.dispatchEvent(new CustomEvent('spatialplay', { detail }));
  }

  function restore() {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.CustomEvent = previousCustomEvent;
    delete require.cache[OVERLAY_PATH];
  }

  return { Overlay, runtime, spatialplay, flushRaf, errors, ctx, docListeners, restore };
}

test('panel mounts the playback overlay canvas and runtime without touching take output', () => {
  assert.match(panel, /id="takePlaybackOverlay"/);
  assert.match(panel, /touch_control_take_playback_overlay\.js/);
  assert.match(panel, /TouchTakePlaybackOverlayRuntime = window\.TouchTakePlaybackOverlay\.create/);
  const takeOutputBlock = panel.match(/function takeOutputForContact[\s\S]{0,1200}/);
  assert.ok(takeOutputBlock, 'takeOutputForContact must remain on the page');
  assert.doesNotMatch(takeOutputBlock[0], /TouchTakePlaybackOverlay/);
});

test('overlay tracks one playback slot with marker and path samples', () => {
  const run = buildHarness({
    bankState: () => ({ slots: [{ index: 0, phase: 'playing' }] }),
  });
  try {
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.2, v: 0.3, down: true });
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.4, v: 0.5, down: true });
    run.flushRaf();
    const state = run.runtime.state();
    assert.equal(state[0].active, true);
    assert.equal(state[0].pathLength, 2);
    assert.equal(state[1].pathLength, 0);
  } finally {
    run.restore();
  }
});

test('two and four concurrent playback slots stay independent', () => {
  const run = buildHarness({
    bankState: () => ({
      slots: [
        { index: 0, phase: 'playing' },
        { index: 1, phase: 'playing' },
        { index: 2, phase: 'looping' },
        { index: 3, phase: 'playing' },
      ],
    }),
  });
  try {
    ['take-playback-0', 'take-playback-1', 'take-playback-2', 'take-playback-3'].forEach((contactKey, index) => {
      run.spatialplay({ kind: 'playback', contactKey, u: 0.1 * (index + 1), v: 0.2, down: true });
    });
    run.flushRaf();
    const state = run.runtime.state();
    assert.deepEqual(state.map((slot) => slot.pathLength), [1, 1, 1, 1]);
    state.forEach((slot, index) => {
      assert.ok(Math.abs(slot.u - (0.1 * (index + 1))) < 1e-9, `slot ${index} u mismatch`);
    });
  } finally {
    run.restore();
  }
});

test('loop boundary clears the prior path on the next down while looping', () => {
  const run = buildHarness({
    bankState: () => ({ slots: [{ index: 0, phase: 'looping' }] }),
  });
  try {
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.1, v: 0.2, down: true });
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.2, v: 0.3, down: false });
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.8, v: 0.1, down: true });
    run.flushRaf();
    const slot = run.runtime.state()[0];
    assert.equal(slot.pathLength, 1);
    assert.equal(slot.u, 0.8);
  } finally {
    run.restore();
  }
});

test('stop and clear remove marker and path; malformed samples fail loudly', () => {
  const run = buildHarness({
    bankState: () => ({ slots: [{ index: 0, phase: 'ready' }] }),
  });
  try {
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.2, v: 0.2, down: true });
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.3, v: 0.3, down: false });
    assert.equal(run.runtime.state()[0].pathLength, 0);
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.2, v: 0.2, down: true });
    run.runtime.clearAll('operator-clear');
    assert.deepEqual(run.runtime.state().map((slot) => slot.pathLength), [0, 0, 0, 0]);
    assert.throws(
      () => run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 2, v: 0.2, down: true }),
      /invalid normalized coordinates/,
    );
    const errorsAfterMalformed = run.errors.length;
    run.spatialplay({ kind: 'settle', contactKey: 'take-playback-0', u: 0.2, v: 0.2, down: false });
    assert.equal(run.errors.length, errorsAfterMalformed,
      'legitimate settle samples must not emit panelerror');
  } finally {
    run.restore();
  }
});

test('lifecycle cleanup clears every slot', () => {
  const run = buildHarness({
    bankState: () => ({ slots: [{ index: 0, phase: 'playing' }] }),
  });
  try {
    run.spatialplay({ kind: 'playback', contactKey: 'take-playback-0', u: 0.2, v: 0.2, down: true });
    (run.docListeners.get('spatialcontactclear') || []).forEach((fn) => fn({ type: 'spatialcontactclear' }));
    assert.equal(run.runtime.state()[0].pathLength, 0);
  } finally {
    run.restore();
  }
});
