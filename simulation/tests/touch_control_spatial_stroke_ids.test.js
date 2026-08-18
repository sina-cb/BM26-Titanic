/* Live Touch Spatial — wire stroke ids (BM26 fix wave W2).
 *
 * Root cause (already diagnosed, not re-derived here): docs/ui/touch_control_wire.js
 * used to put the RAW DOM pointerId straight on the wire as strokes[].id. In
 * iPad WKWebView, pointer ids derive from iOS touch identifiers and can be
 * huge integers (e.g. 0x80000001) or large non-integer doubles — both violate
 * the engine's setSpatialPaint contract (marsin_engine/lib/global_effects_controller.js
 * ~line 2135: `Number.isInteger(stroke.id) && stroke.id >= 0 && stroke.id <=
 * 0x7fffffff`), so real multitouch painting failed with HTTP 400.
 *
 * The fix keeps pointer.id as the raw pointerId (Map key, unchanged) and adds
 * pointer.slot — the smallest free integer in 0..9 — which is what
 * spatialPayload() now puts on the wire as strokes[].id. This suite proves
 * that compact-slot mapping end to end against the REAL page, using the
 * puppeteer + installHermeticBrowser technique from live_touch_ui_layout.test.js
 * (read for reference; not imported or modified — that file is owned by
 * another agent in this wave).
 *
 * A note on how pathological pointer ids are injected: the native
 * `PointerEvent` constructor types `pointerId` as WebIDL `long` (signed
 * 32-bit) and SILENTLY WRAPS anything outside that range or with a
 * fractional part — verified empirically against this repo's puppeteer
 * Chromium (0x80000001 -> -2147483647, 0xFFFFFFFF -> -1, 4294967296.5 -> 0).
 * That wrapping would defeat the whole point of this test. wire.js's
 * listeners only ever read `e.pointerId`/`e.clientX`/`e.clientY`/`e.pressure`/
 * `e.buttons` off whatever object is dispatched, so a plain `Event` with
 * those properties assigned directly (bypassing the PointerEvent IDL
 * dictionary entirely) delivers the EXACT numeric value to the handler —
 * this is how iOS WKWebView's real, huge/fractional ids are reproduced here.
 *
 * FOLLOW-UP FIX (BM26 _304), which this suite now also covers. W2 flagged a
 * second, pre-existing defect it deliberately left alone: pushXY() resolved
 * which spatialPointers entry to update by running the incoming id through
 * Number.isInteger and handing anything that failed to the TAKE/playback
 * sentinel. A genuinely non-integer real pointerId therefore looked up the
 * PLAYBACK entry instead of the one pointerdown had created for it, so
 * `pointer.current` was never set and that finger was silently DROPPED from
 * spatialPayload()'s strokes[] — a fallback, which AGENTS.md P0 forbids.
 *
 * The semantics chosen: identity is DECLARED, never inferred. A synthetic
 * playback sample carries `spatialPlayback: true` and resolves to the playback
 * contact; everything else resolves to its raw `e.pointerId` — the same key
 * pointerdown/pointermove/liftBrush already use — and an event that is neither
 * is refused loudly. The playback contact's key also stopped being a reserved
 * integer (`0x7ffffffe`) and became the string `'take-playback'`, so no DOM
 * pointerId (always a number) can collide with it at all. `pointer.slot`
 * remains the compact wire id and `pointer.id` remains the raw pointerId /
 * Map key — W2's mapping is untouched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pixels as titanicPixels } from '../../marsin_engine/models/titanic.js';
import { appendAutoViews } from '../../marsin_engine/lib/view_catalog.js';
import { buildMaskRegistry } from '../../marsin_engine/lib/mask_registry.js';
import { loadModelForGauge } from '../../marsin_engine/lib/model_loader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PANEL_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control.html');
const PANEL_URL = `${pathToFileURL(PANEL_PATH).href}`
  + '?captainpad_engine_origin=http%3A%2F%2F127.0.0.1%3A6968'
  + '&captainpad_live_touch_protocol=2';
const ARTIFACT = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'docs/ui/touch_control_pixel_views.json'),
  'utf8',
));
const PIXEL_VIEW_SOURCES = {
  'pixel_map_views.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml'), 'utf8'),
  'cameras.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/cameras.yaml'), 'utf8'),
  'pixel_map_layout.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_layout.js'), 'utf8'),
  'pixel_map_views.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_views.js'), 'utf8'),
};
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
let groupCatalogPromise;

/* The ENGINE's exact validation predicate (marsin_engine/lib/global_effects_controller.js
   ~line 2135), restated here so this suite pins the real contract instead of
   a guess at it. */
function isValidEngineStrokeId(id) {
  return Number.isInteger(id) && id >= 0 && id <= 0x7fffffff;
}

function groupCatalog() {
  if (groupCatalogPromise) return groupCatalogPromise;
  groupCatalogPromise = loadModelForGauge('titanic').then((model) => {
    appendAutoViews(model.pixels, model.viewMasks, model.groupBits);
    const registry = buildMaskRegistry({
      pixels: model.pixels,
      pixelCount: model.pixelCount,
      groupBits: model.groupBits,
      viewMasks: model.viewMasks,
    });
    const groupCounts = new Map();
    for (const pixel of model.pixels) {
      groupCounts.set(pixel.group, (groupCounts.get(pixel.group) || 0) + 1);
    }
    const namedViews = registry.names().map((name) => {
      const entry = registry.get(name);
      const counts = new Map();
      let memberCount = 0;
      entry.members.forEach((member, index) => {
        if (!member) return;
        memberCount += 1;
        const group = model.pixels[index].group;
        counts.set(group, (counts.get(group) || 0) + 1);
      });
      const groupNames = [];
      const partialGroupNames = [];
      for (const [group, count] of counts) {
        (count === groupCounts.get(group) ? groupNames : partialGroupNames).push(group);
      }
      return {
        name, kind: entry.kind, bit: entry.bit, memberCount,
        groupNames: groupNames.sort(), partialGroupNames: partialGroupNames.sort(),
      };
    });
    return { groups: [...groupCounts.keys()].sort(), namedViews };
  });
  return groupCatalogPromise;
}

const EFFECT_CATALOG = {
  movementTrace: {
    name: 'Movement Trace',
    category: 'movement',
    singleton: true,
    presets: Object.fromEntries([
      'pulse_slow_fade', 'every_other_repeat', 'every_other_reverse',
      'every_other_two_tone', 'one_per_color_repeat', 'one_per_color_reverse',
      'one_per_color_double', 'whole_group_repeat', 'whole_group_reverse',
    ].map((id) => [id, { label: id.replaceAll('_', ' ') }])),
  },
  strobe: { name: 'Strobe', category: 'legacy', singleton: true, presets: { sync_4hz: { label: 'sync 4hz' } } },
  beatPump: { name: 'Beat Pump', category: 'envelope', singleton: true, presets: { soft: { label: 'soft' } } },
  breath: { name: 'Breath', category: 'envelope', singleton: true, presets: { calm: { label: 'calm' } } },
  feedbackTrails: {
    name: 'Feedback Trails',
    category: 'feedback',
    singleton: false,
    presets: { soft_afterimage: { label: 'soft afterimage' }, ghost_ship: { label: 'ghost ship' } },
  },
  waterlineSweep: { name: 'Waterline Sweep', category: 'overlay', singleton: false, presets: { shadow_pass: { label: 'shadow pass' } } },
  freeze: { name: 'Freeze', category: 'time', singleton: true, presets: { hold: { label: 'hold' } } },
  kickPunch: { name: 'Kick Punch', category: 'envelope', singleton: true, presets: { punch: { label: 'punch' } } },
};

for (const effect of Object.values(EFFECT_CATALOG)) {
  effect.behaviorTypes = ['toggle'];
  for (const preset of Object.values(effect.presets)) preset.defaultBehavior = 'toggle';
}
EFFECT_CATALOG.kickPunch.behaviorTypes = ['trigger'];
EFFECT_CATALOG.kickPunch.presets.punch.defaultBehavior = 'trigger';

async function installHermeticBrowser(page) {
  await page.evaluateOnNewDocument((artifact, sourceFiles) => {
    window.__layoutTestErrors = [];
    window.addEventListener('error', (event) => window.__layoutTestErrors.push(event.message));
    window.addEventListener('unhandledrejection', (event) => window.__layoutTestErrors.push(String(event.reason)));
    const NativeResponse = window.Response;
    window.__spatialPaintWrites = [];
    window.__rejectSpatialLiftCount = 0;
    window.__holdSpatialLiftCount = 0;
    window.__heldSpatialLiftResolvers = [];
    window.fetch = (input, init = {}) => {
      const url = String(input);
      if (url.includes('touch_control_pixel_views.json')) {
        return Promise.resolve(new NativeResponse(JSON.stringify(artifact), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      const sourceName = Object.keys(sourceFiles).find((name) => url.endsWith(name));
      if (sourceName) {
        return Promise.resolve(new NativeResponse(sourceFiles[sourceName], {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }));
      }
      if (url.endsWith('/spatial-paint')) {
        const body = init.body ? JSON.parse(init.body) : null;
        window.__spatialPaintWrites.push(body);
        if (body && body.touch === false && window.__holdSpatialLiftCount > 0) {
          window.__holdSpatialLiftCount -= 1;
          return new Promise((resolve) => {
            window.__heldSpatialLiftResolvers.push(() => resolve(new NativeResponse(
              JSON.stringify({ status: 'ok' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )));
          });
        }
        if (body && body.touch === false && window.__rejectSpatialLiftCount > 0) {
          window.__rejectSpatialLiftCount -= 1;
          return Promise.resolve(new NativeResponse(JSON.stringify({ error: 'injected lift rejection' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return Promise.resolve(new NativeResponse(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.reject(new Error(`Hermetic stroke-id test blocked network request: ${url}`));
    };
    window.__hermeticSockets = [];
    window.WebSocket = class HermeticWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 3;
      constructor(url) {
        this.url = String(url);
        this.listeners = new Map();
        window.__hermeticSockets.push(this);
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
      }
      emit(type, event = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
      close() {}
      send() { throw new Error('Hermetic stroke-id test blocked WebSocket send'); }
    };
  }, ARTIFACT, PIXEL_VIEW_SOURCES);
}

async function openPanel(page, viewport) {
  await page.setViewport(viewport);
  await installHermeticBrowser(page);
  await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#workspaceScroll .workspace-chip');
  await page.evaluate(async (artifact, pixels) => {
    await window.TouchPixelViews.ready();
    await window.TouchPixelViews.verifyEngineLayout({
      scene: 'titanic',
      model: 'titanic',
      pixelCount: artifact.modelPixelCount,
      returnedCount: artifact.modelPixelCount,
      pixels,
    });
  }, ARTIFACT, titanicPixels);
  const accepted = await page.evaluate((effects) => {
    const detail = { effects };
    document.dispatchEvent(new CustomEvent('fxcatalog', { detail }));
    return detail.accepted === true && !detail.error;
  }, EFFECT_CATALOG);
  assert.equal(accepted, true, 'the production effects renderer should accept the hermetic catalog');
  const catalog = await groupCatalog();
  const groupAccepted = await page.evaluate((value) => {
    window.TouchGroupProfiles.install(value);
    return document.getElementById('groupProfileSelect').value === 'instruments';
  }, catalog);
  assert.equal(groupAccepted, true, 'the authoritative Show instruments profile should open by default');
  await page.waitForFunction(() => document.querySelectorAll('#fxGrid .fx-face').length === 16);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

/** Neutralizes real pointer capture, which requires a browser-tracked active
 *  pointer and throws for any synthetic id — wire.js already handles that
 *  throw (it deletes the just-created spatialPointers entry and reports it),
 *  which is a different code path than the one this suite is proving. */
async function stubPointerCapture(page) {
  await page.evaluate(() => {
    const pad = document.getElementById('xyPad');
    pad.setPointerCapture = () => {};
    pad.releasePointerCapture = () => {};
  });
}

/** Dispatches a synthetic spatial pointer event carrying an EXACT pointerId,
 *  including values a real `PointerEvent` constructor would silently wrap
 *  (see file header). `#xyPad`'s listeners only ever read plain properties
 *  off the event object, so a plain `Event` with those properties assigned
 *  directly is indistinguishable to wire.js from a native PointerEvent. */
async function dispatchSpatialPointer(page, type, pointerId, u, v) {
  await page.evaluate(({ type, pointerId, u, v }) => {
    const pad = document.getElementById('xyPad');
    const rect = pad.getBoundingClientRect();
    const lifted = type === 'pointerup' || type === 'pointercancel';
    const event = new Event(type, { bubbles: true, cancelable: true });
    event.pointerId = pointerId;
    event.pointerType = 'touch';
    event.isPrimary = true;
    event.clientX = rect.left + rect.width * u;
    event.clientY = rect.top + rect.height * v;
    event.pressure = lifted ? 0 : 1;
    event.buttons = lifted ? 0 : 1;
    pad.dispatchEvent(event);
  }, { type, pointerId, u, v });
}

/** The retire sweep that deletes a lifted pointer's spatialPointers entry (and
 *  releases its slot) runs inside a microtask queued by pointerup/pointercancel
 *  (sendDraw's final-sample path -> `Promise.resolve().then(run)`), not
 *  synchronously inside the DOM event dispatch. A macrotask tick reliably
 *  drains it. */
async function flushSpatialQueue(page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function spatialPayload(page) {
  return page.evaluate(() => window.__wire._spatialPayloadForTest());
}

async function spatialSlot(page, pointerId) {
  return page.evaluate((pid) => window.__wire._spatialPointerSlot(pid), pointerId);
}

/** Replays one TAKE frame through the page's own 'spatialplay' event — the
 *  synthetic path wire.js routes to the playback contact via the explicit
 *  `spatialPlayback` marker (BM26 _304). `end` is only cosmetic to the wire;
 *  `down: false` is what lifts the brush. */
async function dispatchSpatialPlay(page, u, v, down) {
  return page.evaluate(({ u, v, down }) => {
    window.__spatialPlayTestId = (window.__spatialPlayTestId || 0) + 1;
    const requestId = 'compact-slot-test-' + window.__spatialPlayTestId;
    const acknowledgement = new Promise((resolve) => {
      const accept = (event) => {
        if (!event.detail || event.detail.requestId !== requestId) return;
        document.removeEventListener('spatialplayack', accept);
        resolve(event.detail);
      };
      document.addEventListener('spatialplayack', accept);
    });
    document.dispatchEvent(new CustomEvent('spatialplay', {
      detail: {
        requestId,
        u, v, down, end: false,
      },
    }));
    return acknowledgement;
  }, { u, v, down });
}

function strokeById(payload, id) {
  return payload.strokes.find((stroke) => stroke.id === id);
}

/** The playback contact's spatialPointers key. Deliberately a STRING: a DOM
 *  pointerId is always a number, so no real finger can ever collide with it. */
const TAKE_CONTACT_KEY = 'take-playback';

const VIEWPORT = { width: 1024, height: 682, deviceScaleFactor: 1 };

test('one huge device pointer owns one compact engine slot and simultaneous extras are refused', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);

    const HUGE_INT_A = 0x80000001;   // 2147483649 — exceeds the engine's 0x7fffffff cap
    const HUGE_INT_B = 0xFFFFFFFF;   // 4294967295 — exceeds the cap by a wider margin
    const FRACTIONAL = 4294967296.5; // non-integer double, also huge

    await dispatchSpatialPointer(page, 'pointerdown', HUGE_INT_A, 0.2, 0.25);
    await dispatchSpatialPointer(page, 'pointerdown', HUGE_INT_B, 0.8, 0.25);
    await dispatchSpatialPointer(page, 'pointerdown', FRACTIONAL, 0.5, 0.8);

    const slotA = await spatialSlot(page, HUGE_INT_A);
    const slotB = await spatialSlot(page, HUGE_INT_B);
    const slotFractional = await spatialSlot(page, FRACTIONAL);

    assert.ok(Number.isInteger(slotA) && slotA >= 0 && slotA <= 9,
      `the primary pointer must get a compact slot in 0..9, got ${slotA}`);
    assert.equal(slotB, undefined, 'the second simultaneous contact must not get a wire slot');
    assert.equal(slotFractional, undefined, 'the third simultaneous contact must not get a wire slot');

    const payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 1,
      'exactly the primary contact reaches the engine payload');
    const ids = payload.strokes.map((stroke) => stroke.id);
    assert.deepEqual(ids, [slotA]);
    for (const id of ids) {
      assert.ok(isValidEngineStrokeId(id), `stroke id ${id} must satisfy the engine's exact predicate`);
      assert.notEqual(id, HUGE_INT_A);
      assert.notEqual(id, HUGE_INT_B);
      assert.notEqual(id, FRACTIONAL);
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a spatial pointer\'s wire slot is stable across pointermove', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);

    const POINTER_ID = 3000000001; // well beyond 0x7fffffff, still an integer
    await dispatchSpatialPointer(page, 'pointerdown', POINTER_ID, 0.2, 0.2);
    const slotAtDown = await spatialSlot(page, POINTER_ID);
    assert.ok(Number.isInteger(slotAtDown) && slotAtDown >= 0 && slotAtDown <= 9);

    for (const [u, v] of [[0.3, 0.3], [0.4, 0.5], [0.6, 0.7]]) {
      await dispatchSpatialPointer(page, 'pointermove', POINTER_ID, u, v);
      const slotNow = await spatialSlot(page, POINTER_ID);
      assert.equal(slotNow, slotAtDown, 'the slot must not change across pointermove samples');
      const payload = await spatialPayload(page);
      assert.equal(payload.strokes.length, 1);
      assert.equal(payload.strokes[0].id, slotAtDown, 'the wire payload keeps carrying the same stable slot');
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a spatial pointer\'s wire slot is released on pointerup and pointercancel, and is reusable', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);

    const LIFTED_BY_UP = 5100000002;
    await dispatchSpatialPointer(page, 'pointerdown', LIFTED_BY_UP, 0.85, 0.15);
    const liftedSlot = await spatialSlot(page, LIFTED_BY_UP);
    assert.ok(Number.isInteger(liftedSlot));
    await dispatchSpatialPointer(page, 'pointerup', LIFTED_BY_UP, 0.85, 0.15);
    await flushSpatialQueue(page);
    assert.equal(await spatialSlot(page, LIFTED_BY_UP), undefined,
      'pointerup must remove the spatialPointers entry and its slot claim');

    const REUSER = 5100000003;
    await dispatchSpatialPointer(page, 'pointerdown', REUSER, 0.85, 0.85);
    assert.equal(await spatialSlot(page, REUSER), liftedSlot,
      'the freed slot (not a new one) is handed to the next pointer');
    await dispatchSpatialPointer(page, 'pointerup', REUSER, 0.85, 0.85);
    await flushSpatialQueue(page);

    // pointercancel takes the same lift path (audit H14 in wire.js) — prove it
    // independently of pointerup.
    const CANCELLED = 5100000004;
    await dispatchSpatialPointer(page, 'pointerdown', CANCELLED, 0.5, 0.5);
    const cancelledSlot = await spatialSlot(page, CANCELLED);
    assert.notEqual(cancelledSlot, undefined);
    await dispatchSpatialPointer(page, 'pointercancel', CANCELLED, 0.5, 0.5);
    await flushSpatialQueue(page);
    assert.equal(await spatialSlot(page, CANCELLED), undefined,
      'pointercancel must release the slot exactly like pointerup');

    const REUSER_2 = 5100000005;
    await dispatchSpatialPointer(page, 'pointerdown', REUSER_2, 0.5, 0.6);
    assert.equal(await spatialSlot(page, REUSER_2), cancelledSlot, 'the pointercancel-freed slot is reusable too');

    await page.close();
  } finally {
    await browser.close();
  }
});

test('a replayed TAKE still paints through the synthetic-event path and lifts on pen-up (BM26 _304)', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);
    await page.evaluate(() => {
      // This focused suite proves only synthetic contact identity and compact
      // slot routing. ARM/online/lease eligibility has its own TAKE state and
      // native bridge coverage, so authorize this isolated sample explicitly.
      window.TouchTakeEligibility = () => ({ ok: true });
    });

    // The playback contact no longer travels as a reserved pointer id; it is
    // routed by the explicit `spatialPlayback` marker. This proves that path
    // is intact end to end, since the marker replaced the old `Number.isInteger`
    // proxy that used to deliver it.
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), undefined,
      'no playback contact exists before the first replayed frame');

    await dispatchSpatialPlay(page, 0.25, 0.3, true);
    const playbackSlot = await spatialSlot(page, TAKE_CONTACT_KEY);
    assert.ok(Number.isInteger(playbackSlot) && playbackSlot >= 0 && playbackSlot <= 9,
      `the playback contact must own a compact slot, got ${playbackSlot}`);

    let payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 1, 'a replayed frame paints exactly one stroke');
    assert.equal(payload.strokes[0].id, playbackSlot);
    assert.equal(payload.touch, true);
    const firstTarget = { x: payload.strokes[0].targetX, y: payload.strokes[0].targetY };

    // A later frame moves the SAME contact rather than opening a second one.
    await dispatchSpatialPlay(page, 0.7, 0.65, true);
    payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 1, 'replay keeps one contact, not one per frame');
    assert.equal(payload.strokes[0].id, playbackSlot, 'the playback slot is stable across frames');
    assert.notDeepEqual(
      { x: payload.strokes[0].targetX, y: payload.strokes[0].targetY }, firstTarget,
      'the replayed contact actually moves with the take');

    // Pen-up retires the playback contact and frees its slot.
    await dispatchSpatialPlay(page, 0.7, 0.65, false);
    await flushSpatialQueue(page);
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), undefined,
      'playback pen-up must retire the contact and release its slot');
    payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 0);
    assert.equal(payload.touch, false, 'the brush must lift when the take ends');

    assert.deepEqual(await page.evaluate(() => window.__layoutTestErrors), [],
      'the replay path must not raise page errors');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a rejected replay lift retains its slot and retries a real engine lift before clearing', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);
    await page.evaluate(() => {
      window.TouchTakeEligibility = () => ({ ok: true });
      window.__rejectSpatialLiftCount = 1;
    });

    const downAck = await dispatchSpatialPlay(page, 0.35, 0.45, true);
    assert.equal(downAck.ok, true);
    const playbackSlot = await spatialSlot(page, TAKE_CONTACT_KEY);
    assert.ok(Number.isInteger(playbackSlot));

    const rejectedUp = await dispatchSpatialPlay(page, 0.35, 0.45, false);
    assert.equal(rejectedUp.ok, false, 'the rejected engine lift must reach TAKE as a failed ACK');
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), playbackSlot,
      'the retiring contact and compact slot remain owned after rejection');

    const acceptedRetry = await dispatchSpatialPlay(page, 0.35, 0.45, false);
    assert.equal(acceptedRetry.ok, true);
    await flushSpatialQueue(page);
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), undefined,
      'only the acknowledged retry releases the contact and slot');
    const liftWrites = await page.evaluate(() => window.__spatialPaintWrites
      .filter((body) => body && body.touch === false && Array.isArray(body.strokes) && body.strokes.length === 0));
    assert.equal(liftWrites.length, 2, 'recovery performs a second real empty-stroke engine write');

    await page.close();
  } finally {
    await browser.close();
  }
});

test('a pending replay lift never produces an absence-based ACK and a retry stays ordered', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);
    await page.evaluate(() => {
      window.TouchTakeEligibility = () => ({ ok: true });
      window.__holdSpatialLiftCount = 1;
    });
    await dispatchSpatialPlay(page, 0.4, 0.5, true);
    const playbackSlot = await spatialSlot(page, TAKE_CONTACT_KEY);

    let firstSettled = false;
    let retrySettled = false;
    const firstUp = dispatchSpatialPlay(page, 0.4, 0.5, false).then((ack) => {
      firstSettled = true;
      return ack;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const retryUp = dispatchSpatialPlay(page, 0.4, 0.5, false).then((ack) => {
      retrySettled = true;
      return ack;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(firstSettled, false, 'the pending engine write has no optimistic ACK');
    assert.equal(retrySettled, false, 'retry joins the ordered draw queue instead of synthetic-ACKing');
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), playbackSlot,
      'the retiring contact remains owned while the engine write is pending');

    await page.evaluate(() => window.__heldSpatialLiftResolvers.shift()());
    assert.equal((await firstUp).ok, true);
    assert.equal((await retryUp).ok, true);
    const liftWrites = await page.evaluate(() => window.__spatialPaintWrites
      .filter((body) => body && body.touch === false && body.strokes.length === 0));
    assert.equal(liftWrites.length, 2, 'the queued retry is also an authoritative empty-stroke write');
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), undefined);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a no-entry replay up still requires an authoritative engine lift ACK', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);
    await page.evaluate(() => { window.__rejectSpatialLiftCount = 1; });

    const rejected = await dispatchSpatialPlay(page, 0.5, 0.5, false);
    assert.equal(rejected.ok, false, 'no local entry must not become a synthetic success');
    const accepted = await dispatchSpatialPlay(page, 0.5, 0.5, false);
    assert.equal(accepted.ok, true);
    const liftWrites = await page.evaluate(() => window.__spatialPaintWrites
      .filter((body) => body && body.touch === false && body.strokes.length === 0));
    assert.equal(liftWrites.length, 2, 'rejection and retry both reach the engine');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a non-integer primary pointer paints one compact stroke without opening playback', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);

    const FRACTIONAL = 8589934592.25;   // non-integer double, WKWebView-scale
    await dispatchSpatialPointer(page, 'pointerdown', FRACTIONAL, 0.85, 0.8);
    const fractionalSlot = await spatialSlot(page, FRACTIONAL);
    assert.ok(Number.isInteger(fractionalSlot) && fractionalSlot >= 0 && fractionalSlot <= 9,
      `the fractional pointer must own its own compact slot, got ${fractionalSlot}`);
    assert.equal(await spatialSlot(page, TAKE_CONTACT_KEY), undefined,
      'a real primary contact must not create or alias the playback contact');

    let payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 1,
      'the fractional primary finger paints exactly one engine stroke');
    const fractionalStroke = strokeById(payload, fractionalSlot);
    assert.ok(fractionalStroke, 'the fractional pointer must appear in strokes[]');
    assert.ok(isValidEngineStrokeId(fractionalStroke.id), 'its wire id must satisfy the engine predicate');
    assert.notEqual(fractionalStroke.id, FRACTIONAL, 'the raw fractional id must never reach the wire');

    // Moving the fractional finger moves only its own stroke.
    await dispatchSpatialPointer(page, 'pointermove', FRACTIONAL, 0.6, 0.55);
    payload = await spatialPayload(page);
    assert.equal(await spatialSlot(page, FRACTIONAL), fractionalSlot,
      'the fractional pointer keeps one stable slot across moves');
    const movedStroke = strokeById(payload, fractionalSlot);
    assert.notDeepEqual(
      { x: movedStroke.targetX, y: movedStroke.targetY },
      { x: fractionalStroke.targetX, y: fractionalStroke.targetY },
      'its own stroke tracks the finger');

    // Lifting it releases the sole accepted slot.
    await dispatchSpatialPointer(page, 'pointerup', FRACTIONAL, 0.6, 0.55);
    await flushSpatialQueue(page);
    assert.equal(await spatialSlot(page, FRACTIONAL), undefined,
      'a fractional pointer lifts like any other');
    assert.equal((await spatialPayload(page)).strokes.length, 0);

    assert.deepEqual(await page.evaluate(() => window.__layoutTestErrors), [],
      'a fractional pointer id must not raise page errors either');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('ten concurrent touches produce one primary stroke and nine refused contacts', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, VIEWPORT);
    await stubPointerCapture(page);

    const BASE = 4000000000;
    const grid = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 5; col++) grid.push([0.08 + col * 0.2, 0.15 + row * 0.6]);
    }
    const pointerIds = Array.from({ length: 10 }, (_, i) => BASE + i + 1);
    for (let i = 0; i < 10; i++) {
      await dispatchSpatialPointer(page, 'pointerdown', pointerIds[i], grid[i][0], grid[i][1]);
    }

    const payload = await spatialPayload(page);
    assert.equal(payload.strokes.length, 1, 'only the primary physical touch owns a canonical contact');
    const ids = payload.strokes.map((stroke) => stroke.id);
    assert.equal(new Set(ids).size, 1);
    for (const id of ids) {
      assert.ok(isValidEngineStrokeId(id), `stroke id ${id} must satisfy the engine's exact predicate`);
      assert.ok(id >= 0 && id <= 9, `stroke id ${id} must be a compact slot, not a raw pointerId`);
    }
    const claimed = await Promise.all(pointerIds.map((pointerId) => spatialSlot(page, pointerId)));
    assert.ok(Number.isInteger(claimed[0]), 'the first contact owns the one compact slot');
    assert.deepEqual(claimed.slice(1), Array(9).fill(undefined),
      'all simultaneous extra contacts are explicitly refused until the primary lifts');

    await page.close();
  } finally {
    await browser.close();
  }
});
