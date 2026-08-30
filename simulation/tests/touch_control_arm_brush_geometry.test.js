/*
 * `_302` W1 — ARM brush geometry is canvas-independent WITHOUT weakening
 * verification (`_301` §5 fix contract, §6 regression spec items 2-6).
 *
 * The native failure was that ARM staged its initial spatial brush through the
 * SCREEN projection, which only exists once the Spatial canvas has a nonzero
 * box. With the panel docked (`display:none`, persisted per device) a fully
 * verified page aborted ARM with a message that falsely indicted verification.
 *
 * `worldBrushRadii()` answers the same question from the canonical design-space
 * reprojection instead, gated on the SAME two booleans that gate `canArm()`.
 *
 * This file mounts the real runtime singleton, so it lives apart from
 * `touch_control_pixel_views.test.js` (which exercises the pure projection
 * helpers and must not inherit mounted state).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { pixels as titanicPixels } from '../../marsin_engine/models/titanic_normalized.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const RUNTIME_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.js');
const PROJECTION_PATH = path.join(REPO_ROOT, 'CaptainPad/shared/pixel_view_projection.js');
const ARTIFACT_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.json');

/* The runtime fetches its artifact and the resolver sources it fingerprints. */
const FETCHABLE = new Map([
  ['touch_control_pixel_views.json', 'CaptainPad/live_touch/touch_control_pixel_views.json'],
  ['/simulation/scenes/titanic_normalized/pixel_map_views.yaml', 'simulation/scenes/titanic_normalized/pixel_map_views.yaml'],
  ['/simulation/scenes/titanic_normalized/cameras.yaml', 'simulation/scenes/titanic_normalized/cameras.yaml'],
  ['/simulation/src/gui/pixel_map/pixel_map_layout.js', 'simulation/src/gui/pixel_map/pixel_map_layout.js'],
  ['/simulation/src/gui/pixel_map/pixel_map_views.js', 'simulation/src/gui/pixel_map/pixel_map_views.js'],
]);

const rafQueue = [];
function flushRaf() {
  while (rafQueue.length) rafQueue.shift()();
}

globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
globalThis.fetch = async (url) => {
  const relative = FETCHABLE.get(String(url));
  if (!relative) throw new Error(`unexpected fetch: ${url}`);
  const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};

let resizeCallback = null;
globalThis.ResizeObserver = class {
  constructor(callback) { resizeCallback = callback; }
  observe() {}
  disconnect() {}
};

function stubContext() {
  const noop = () => {};
  return {
    setTransform: noop, clearRect: noop, beginPath: noop, ellipse: noop,
    save: noop, translate: noop, rotate: noop, rect: noop, restore: noop,
    fill: noop, stroke: noop, drawImage: noop,
    lineWidth: 1, strokeStyle: '', fillStyle: '',
  };
}

function stubCanvas() {
  const context = stubContext();
  return {
    clientWidth: 0, clientHeight: 0, width: 0, height: 0,
    getContext: () => context,
    addEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    },
  };
}

globalThis.document = {
  createElement: () => stubCanvas(),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const canvas = stubCanvas();
const pad = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, dispatchEvent() {},
  getBoundingClientRect() {
    return { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight };
  },
};

const require = createRequire(import.meta.url);
globalThis.DeckPixelProjection = require(PROJECTION_PATH);
const runtime = require(RUNTIME_PATH);
const DESIGN = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8')).design;

/* `brushPadFrac()` in touch_control.html with #brushSize at its M default. */
const DEFAULT_FRACTION = 0.035;

const LIVE_LAYOUT = {
  scene: 'titanic_normalized',
  model: 'titanic_normalized',
  pixelCount: titanicPixels.length,
  returnedCount: titanicPixels.length,
  pixels: titanicPixels,
};

function resize(width, height) {
  canvas.clientWidth = width;
  canvas.clientHeight = height;
  resizeCallback();
  flushRaf();
}

/* What the VISIBLE pad would stage: a fraction of the pad's WIDTH in screen
   pixels, converted through the on-screen projection (touch_control.html's
   `padBrushWorld`). */
function screenRadii(width, height) {
  const per = runtime.padWorldPerPx(width, height);
  const radiusPixels = DEFAULT_FRACTION * width;
  return {
    x: Math.max(0.01, Math.min(1, radiusPixels * per.x)),
    y: Math.max(0.01, Math.min(2, radiusPixels * per.y)),
  };
}

function messageOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

/* Mount once, hidden, exactly as the persisted native layout leaves it. */
test('mounts and verifies its source artifact with the canvas never rendered', async () => {
  await runtime.mount({ canvas, pad, errorElement: { hidden: true, textContent: '' }, viewId: 'top_down' });
  flushRaf();
  const state = runtime.state();
  assert.equal(state.staticVerified, true);
  assert.equal(state.readyStatus, 'fulfilled');
  assert.equal(state.staticRenderCount, 0,
    'a docked Spatial panel never reaches its first animation-frame projection');
});

test('the canonical brush refuses on each verification gate with its own message', () => {
  /* Engine topology has not been verified yet — and that gate is the one that
     must still hold, or canvas independence would have bought safety with
     verification. */
  assert.equal(runtime.canArm(), false);
  assert.equal(
    messageOf(() => runtime.worldBrushRadii(DEFAULT_FRACTION)),
    'pixel-view engine topology is not verified',
  );
  /* `_301` §5.A.1: the screen helper must no longer claim verification failed
     when the truth is that nothing has been rendered. */
  assert.equal(
    messageOf(() => runtime.padWorldPerPx(1, 1)),
    'pixel view has no rendered display projection',
  );
});

test('ARM proceeds on the real 964-pixel topology while Spatial stays hidden', async () => {
  await runtime.verifyEngineLayout(LIVE_LAYOUT);
  flushRaf();
  assert.equal(runtime.canArm(), true);
  assert.equal(runtime.state().staticRenderCount, 0,
    'live topology verification must not require or trigger a render');

  const radii = runtime.worldBrushRadii(DEFAULT_FRACTION);
  assert.ok(Number.isFinite(radii.x) && radii.x > 0, 'hidden ARM stages a real x radius');
  assert.ok(Number.isFinite(radii.y) && radii.y > 0, 'hidden ARM stages a real y radius');
  assert.deepEqual(runtime.worldBrushRadii(DEFAULT_FRACTION), radii, 'repeated calls agree');
});

test('the canonical brush is identical at every viewport size and across hide/show', () => {
  const hidden = runtime.worldBrushRadii(DEFAULT_FRACTION);
  const seen = new Set();
  for (const [width, height] of [[1024, 520], [1194, 606], [834, 424], [1440, 731]]) {
    resize(width, height);
    const radii = runtime.worldBrushRadii(DEFAULT_FRACTION);
    seen.add(`${radii.x}|${radii.y}`);
  }
  assert.equal(seen.size, 1, 'the canonical radius must not depend on the viewport');

  resize(0, 0);
  assert.deepEqual(runtime.worldBrushRadii(DEFAULT_FRACTION), hidden,
    'hiding Spatial again must not reuse stale display geometry');
  resize(1024, 520);
  assert.deepEqual(runtime.worldBrushRadii(DEFAULT_FRACTION), hidden,
    'revealing Spatial must not change what ARM would stage');
  resize(0, 0);
});

/* `_301` §6.6 asked for canonical-vs-screen parity "at default fit". Measured,
   EXACT parity holds only at the DESIGN viewport, and that is the strongest
   form the contract can take: the screen radius is a fraction of the PAD's
   width, while the canonical radius is a fraction of the DESIGN width, and the
   projection is height-limited once the pad is wider than the design aspect
   (900x520). At the operator's 1024x520-class pad the canonical radius is
   ~4.9% smaller — deterministic and intended (`_301` §5 semantic note), and
   re-asserted screen-true by the first stroke.
   Exact equality AT the design viewport is what proves both paths share one
   extent helper, which is the drift this pin exists to catch. */
test('canonical and screen brush geometry share one extent helper', () => {
  resize(DESIGN.width, DESIGN.height);
  const screen = screenRadii(DESIGN.width, DESIGN.height);
  const canonical = runtime.worldBrushRadii(DEFAULT_FRACTION);
  assert.equal(canonical.x, screen.x,
    'at the design viewport the canonical radius must equal the screen radius exactly');
  assert.equal(canonical.y, screen.y,
    'at the design viewport the canonical radius must equal the screen radius exactly');

  /* Away from the design aspect the pad-derived radius tracks the same
     projection helper but uses the live pad width. At the old XL-sized
     default the min(1, …) clamp masked a slight wide-aspect inversion;
     at the M default the true ratio is visible and stays bounded. */
  resize(1024, 520);
  const wideScreen = screenRadii(1024, 520);
  assert.equal(runtime.worldBrushRadii(DEFAULT_FRACTION).x, canonical.x,
    'canonical radius must stay viewport-independent');
  assert.ok(wideScreen.x / canonical.x > 0.85 && wideScreen.x / canonical.x < 1.15,
    'the pad-derived radius must stay in the same ballpark as the canonical radius');
  resize(0, 0);
});

test('a real topology mismatch still refuses ARM loudly', async () => {
  await assert.rejects(
    runtime.verifyEngineLayout({
      ...LIVE_LAYOUT,
      pixelCount: titanicPixels.length - 1,
      returnedCount: titanicPixels.length - 1,
      pixels: titanicPixels.slice(0, -1),
    }),
    /pixel layout is incomplete/,
  );
  assert.equal(runtime.canArm(), false);
  assert.equal(
    messageOf(() => runtime.worldBrushRadii(DEFAULT_FRACTION)),
    'pixel-view engine topology is not verified',
    'canvas independence must never survive a failed topology verification',
  );

  /* Not just a wrong count — a single moved pixel must also refuse. */
  const perturbed = titanicPixels.map((pixel, index) => (
    index === 400 ? { ...pixel, nx: pixel.nx + 0.05 } : pixel
  ));
  await assert.rejects(
    runtime.verifyEngineLayout({ ...LIVE_LAYOUT, pixels: perturbed }),
    /topology does not match/,
  );
  assert.equal(runtime.canArm(), false);
  assert.equal(
    messageOf(() => runtime.worldBrushRadii(DEFAULT_FRACTION)),
    'pixel-view engine topology is not verified',
  );

  await runtime.verifyEngineLayout(LIVE_LAYOUT);
  flushRaf();
  assert.equal(runtime.canArm(), true);
});

test('the canonical brush refuses a fraction it cannot honour instead of clamping it', () => {
  assert.equal(messageOf(() => runtime.worldBrushRadii(Number.NaN)), 'brush fraction must be finite');
  assert.equal(messageOf(() => runtime.worldBrushRadii(0)), 'brush fraction must be positive');
  assert.equal(messageOf(() => runtime.worldBrushRadii(-1)), 'brush fraction must be positive');
});
