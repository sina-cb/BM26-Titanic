/**
 * pixel_map_edit_persistence.test.js — the 2D Pixel Map EDIT tab's arrangement
 * must SURVIVE a save + a server reload, and must auto-save itself (report
 * 20260725_66).
 *
 * Operator report, 2026-07-30: "I edited the arrangement in the 2d pixels and
 * saved all the way but the reload of server ruined them again!"
 *
 * Root cause these tests pin shut: `params.pixelMapViews` had NO YAML wiring at
 * either end — `src/core/config.js` (reconstructYAML / extractParams) only ever
 * knew the retired `pixelMap2d` key — so the layout never reached disk and the
 * next boot re-seeded the four shipped defaults over it. The fix gives the map
 * its own scene sidecar (`pixel_map_views.yaml`) plus a SCOPED, debounced
 * auto-save that never triggers a full scene save.
 *
 * What is covered:
 *   1. round-trip — edit → serialize → YAML → deserialize → identical offsets;
 *   2. the boot path never re-derives or clobbers a persisted layout;
 *   3. the auto-save is debounced, coalescing, and loud on failure;
 *   4. SCOPING — a pixel-map edit does not mark the scene dirty and does not
 *      call `debounceAutoSave`, so the operator's `autoSave: false` stands;
 *   5. client and server agree on the endpoint, the filename and the payload;
 *   6. the sidecar is inside the pre-save snapshot set (recoverable).
 *
 * Pure logic + source-contract scans — no DOM, no canvas, no live server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import {
  createViewsContainer, addView, findView, toParams,
} from '../src/gui/pixel_map/pixel_map_views.js';
import { seedDefaultViews, DEFAULT_VIEWS } from '../src/gui/pixel_map/pixel_map_view_defaults.js';
import sceneBackup from '../server/scene_backup.cjs';

const SRC = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Drop comments so a "must not call X" scan reads CODE, not prose about X.
 *  (`[^:]` before `//` keeps `http://` inside string literals intact.) */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const STORE_SRC = SRC('../src/gui/pixel_map/pixel_map_store.js');
const SAVE_SERVER_SRC = SRC('../server/save-server.js');
const MAIN_SRC = SRC('../main.js');
const CONFIG_SRC = SRC('../src/core/config.js');
const PANEL_SRC = SRC('../src/gui/modern/pixel_map_panel.js');

// ── A fake browser, installed before the persist module is imported ─────────
// The module reads `window` / `fetch` / `navigator` lazily at call time, so a
// plain global stub is enough — and it keeps this file free of any DOM.
const calls = { fetch: [], toast: [], beacon: [] };

globalThis.window = {
  __activeScene: 'titanic',
  serverConfig: { save_port: 6970 },
  location: { protocol: 'http:', hostname: 'localhost' },
  showSaveToast: (msg, isError) => calls.toast.push({ msg, isError }),
  addEventListener: () => {},
};
// `navigator` is a getter-only global in Node ≥ 21 — redefine rather than assign.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { sendBeacon: (url, blob) => { calls.beacon.push({ url, blob }); return true; } },
});

let fetchStatus = 200;
globalThis.fetch = async (url, opts) => {
  calls.fetch.push({ url, opts });
  return { ok: fetchStatus >= 200 && fetchStatus < 300, status: fetchStatus };
};

const persist = await import('../src/gui/pixel_map/pixel_map_persist.js');
const {
  PIXEL_MAP_VIEWS_FILE, PIXEL_MAP_VIEWS_ENDPOINT, AUTOSAVE_DEBOUNCE_MS,
  setPixelMapViewsSource, schedulePixelMapViewsSave, savePixelMapViewsNow,
  flushPixelMapViewsBeacon, pixelMapViewsSavePending,
} = persist;

function resetCalls() {
  calls.fetch.length = 0;
  calls.toast.length = 0;
  calls.beacon.length = 0;
  fetchStatus = 200;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A container holding one projected view the operator has moved fixtures in. */
function editedContainer() {
  const c = createViewsContainer(undefined);
  addView(c, {
    id: 'top_down',
    label: 'Top-Down',
    panels: [{ id: 'main', select: [{}], layout: 'spatial', projection: 'top' }],
  });
  const v = findView(c, 'top_down');
  v.offsets = {
    'Left Front Wall 1': { dx: 56, dy: 24 },
    'Left Front Wall 2': { dx: 56, dy: 24 },
    'Right SmokeStack A': { dx: -12.5, dy: 3.25 },
  };
  v.framing = { zoom: 0.914, panX: -178.5, panY: -57.2 };
  return c;
}

// ─── 1. Round-trip: edit → serialize → deserialize → identical ─────────────

test('an edited layout survives serialize → deserialize with identical offsets', () => {
  const before = editedContainer();
  const tree = toParams(before);

  const after = createViewsContainer(tree);
  const v = findView(after, 'top_down');
  assert.deepEqual(v.offsets, findView(before, 'top_down').offsets);
  assert.deepEqual(v.framing, findView(before, 'top_down').framing);
  // And a second round-trip is a fixed point — no drift on repeated saves.
  assert.deepEqual(toParams(after), tree);
});

test('the layout survives the YAML the sidecar is actually written as', () => {
  const tree = toParams(editedContainer());
  // Exactly what save-server.js does with the POSTed JSON body.
  const onDisk = yaml.dump(JSON.parse(JSON.stringify(tree)), { lineWidth: -1 });
  // Exactly what main.js does with the fetched file.
  const reloaded = createViewsContainer(yaml.load(onDisk));

  const v = findView(reloaded, 'top_down');
  assert.deepEqual(v.offsets, {
    'Left Front Wall 1': { dx: 56, dy: 24 },
    'Left Front Wall 2': { dx: 56, dy: 24 },
    'Right SmokeStack A': { dx: -12.5, dy: 3.25 },
  });
  assert.deepEqual(v.framing, { zoom: 0.914, panX: -178.5, panY: -57.2 });
});

test('fixKeys with YAML-hostile characters round-trip verbatim', () => {
  // Offsets are keyed by fixture NAME; a name with a colon/space/quote must not
  // be reshaped by the dump, or the key would drift and the move would be lost.
  const c = createViewsContainer(undefined);
  addView(c, { id: 'v', label: 'v', panels: [{ id: 'main', select: [{}], layout: 'spatial' }] });
  const keys = ['TE Sign: A', "Left 'Front' Wall 1", 'Right SmokeStack~2', 'Par #3'];
  findView(c, 'v').offsets = Object.fromEntries(keys.map((k, i) => [k, { dx: i + 1, dy: -i }]));

  const reloaded = createViewsContainer(yaml.load(yaml.dump(toParams(c), { lineWidth: -1 })));
  assert.deepEqual(Object.keys(findView(reloaded, 'v').offsets), keys);
});

// ─── 2. The boot path must not re-derive over a persisted layout ───────────

test('seeding the shipped defaults NEVER clobbers a persisted layout', () => {
  const tree = toParams(editedContainer());
  const container = createViewsContainer(tree);      // what boot loads

  const seeded = seedDefaultViews(container);        // what boot then calls
  assert.equal(seeded, false, 'a container with views must not be re-seeded');
  assert.equal(container.views.length, 1);
  assert.deepEqual(findView(container, 'top_down').offsets,
    findView(createViewsContainer(tree), 'top_down').offsets);
});

test("a persisted view keeps ITS values even when it shadows a shipped default id", () => {
  // top_down IS a shipped default. The persisted copy must win outright — a
  // merge with the default would be exactly the "fit re-runs on load" class of
  // bug that eats operator moves.
  const shipped = DEFAULT_VIEWS.find((v) => v.id === 'top_down');
  assert.ok(shipped, 'top_down must still be a shipped default for this test to mean anything');
  assert.equal(shipped.offsets, undefined, 'the shipped default carries no offsets');

  const container = createViewsContainer(toParams(editedContainer()));
  seedDefaultViews(container);
  const v = findView(container, 'top_down');
  assert.equal(v.offsets['Left Front Wall 1'].dx, 56);
  assert.equal(v.framing.zoom, 0.914);
});

test('the boot loader seeds ONLY on an empty container', () => {
  // Pin the guard itself: this single `length > 0` check is what stands between
  // the operator's arrangement and the shipped defaults on every reload.
  const empty = createViewsContainer(undefined);
  assert.equal(seedDefaultViews(empty), true);
  assert.equal(empty.views.length, DEFAULT_VIEWS.length);
  assert.equal(seedDefaultViews(empty), false, 'a second seed must be a no-op');
});

// ─── 3. Auto-save: debounced, coalescing, loud ─────────────────────────────

test('a burst of edits coalesces into exactly ONE debounced write', async () => {
  resetCalls();
  setPixelMapViewsSource(() => toParams(editedContainer()));

  for (let i = 0; i < 5; i++) schedulePixelMapViewsSave();   // drag + 4 nudges
  assert.equal(pixelMapViewsSavePending(), true);
  assert.equal(calls.fetch.length, 0, 'nothing may be written before the debounce elapses');

  await sleep(AUTOSAVE_DEBOUNCE_MS + 250);
  assert.equal(calls.fetch.length, 1, 'the burst must produce exactly one write');
  assert.equal(pixelMapViewsSavePending(), false);

  const { url, opts } = calls.fetch[0];
  assert.equal(url, `http://localhost:6970${PIXEL_MAP_VIEWS_ENDPOINT}?scene=titanic`);
  assert.equal(opts.method, 'POST');
  const body = JSON.parse(opts.body);
  assert.deepEqual(body.views[0].offsets['Left Front Wall 1'], { dx: 56, dy: 24 });
});

test('the debounced write sends the LATEST layout, not the one that armed it', async () => {
  resetCalls();
  let dx = 1;
  setPixelMapViewsSource(() => {
    const c = editedContainer();
    findView(c, 'top_down').offsets['Left Front Wall 1'] = { dx, dy: 0 };
    return toParams(c);
  });

  schedulePixelMapViewsSave();
  dx = 99;                                   // he keeps dragging
  schedulePixelMapViewsSave();
  await sleep(AUTOSAVE_DEBOUNCE_MS + 250);

  const body = JSON.parse(calls.fetch[0].opts.body);
  assert.equal(body.views[0].offsets['Left Front Wall 1'].dx, 99);
});

test('a failed persist is LOUD — error toast, no silent success', async () => {
  resetCalls();
  setPixelMapViewsSource(() => toParams(editedContainer()));
  fetchStatus = 500;

  const res = await savePixelMapViewsNow();
  assert.equal(res.ok, false);
  assert.match(res.reason, /500/);
  assert.equal(calls.toast.length, 1);
  assert.equal(calls.toast[0].isError, true);
  assert.match(calls.toast[0].msg, /PIXEL MAP LAYOUT NOT SAVED/);
});

test('a missing views source THROWS through as a loud failure, never a quiet skip', async () => {
  resetCalls();
  setPixelMapViewsSource(() => null);          // wiring broken
  const res = await savePixelMapViewsNow();
  assert.equal(res.ok, false);
  assert.match(res.reason, /views source returned no/);
  assert.equal(calls.fetch.length, 0, 'garbage must never be written over a good layout');
  assert.equal(calls.toast[0].isError, true);
});

test('setPixelMapViewsSource refuses a non-function (fail loud at wiring time)', () => {
  assert.throws(() => setPixelMapViewsSource(null), /needs a function/);
  assert.throws(() => setPixelMapViewsSource({}), /needs a function/);
});

test('a pending write is flushed on unload via sendBeacon', async () => {
  resetCalls();
  setPixelMapViewsSource(() => toParams(editedContainer()));

  schedulePixelMapViewsSave();
  const flushed = flushPixelMapViewsBeacon();
  assert.equal(flushed, true);
  assert.equal(pixelMapViewsSavePending(), false, 'the flush must disarm the debounce');
  assert.equal(calls.beacon.length, 1);
  assert.equal(calls.beacon[0].url,
    `http://localhost:6970${PIXEL_MAP_VIEWS_ENDPOINT}?scene=titanic`);
  assert.equal(await calls.beacon[0].blob.text(),
    JSON.stringify(toParams(editedContainer())));

  // Nothing was armed → nothing to flush (and no stray beacon).
  assert.equal(flushPixelMapViewsBeacon(), false);
  assert.equal(calls.beacon.length, 1);

  await sleep(AUTOSAVE_DEBOUNCE_MS + 100);
  assert.equal(calls.fetch.length, 0, 'the flushed write must not also fire as a fetch');
});

// ─── 4. SCOPING: no full scene save, no scene-dirty ────────────────────────

test('commitViews persists the layout SCOPED — no debounceAutoSave, no scene dirty', () => {
  const src = stripComments(STORE_SRC);
  const at = src.indexOf('export function commitViews');
  assert.ok(at > 0, 'pixel_map_store.js must still export commitViews');
  const body = src.slice(at, src.indexOf('\n}', at));

  assert.match(body, /schedulePixelMapViewsSave\(\)/,
    'commitViews must trigger the scoped pixel-map save');
  assert.doesNotMatch(body, /debounceAutoSave/,
    'a pixel-map edit must NOT trigger a full scene save — the operator runs autoSave:false');
  assert.doesNotMatch(body, /_setSceneDirty/,
    'the layout no longer rides scene_config.yaml, so it must not mark the SCENE dirty');
});

test('the whole pixel_map module never reaches for the full-scene save path', () => {
  const dir = new URL('../src/gui/pixel_map/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = stripComments(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.doesNotMatch(src, /window\.debounceAutoSave|window\.exportConfig/,
      `${f} must not trigger a full scene save`);
  }
});

// ─── 5. Client ↔ server ↔ boot agreement ──────────────────────────────────

test('the save server serves exactly the endpoint the client posts to', () => {
  assert.match(SAVE_SERVER_SRC,
    new RegExp(`pathname === '${PIXEL_MAP_VIEWS_ENDPOINT}'`),
    'save-server.js must route the endpoint pixel_map_persist.js posts to');
  assert.match(SAVE_SERVER_SRC, new RegExp(PIXEL_MAP_VIEWS_FILE.replace('.', '\\.')),
    'save-server.js must write the filename the client/boot path agrees on');
  // Validate-then-snapshot-then-write: a malformed body is a 400 that touches
  // nothing, and a good body is snapshotted before it overwrites.
  assert.match(SAVE_SERVER_SRC, /filesForPixelMapViews\(backupScene\), 'save-pixel-map-views'/);
  assert.match(SAVE_SERVER_SRC, /writeFileAtomic\(outPath, yaml\.dump\(tree/);
});

test('boot fetches the sidecar and loads it into params.pixelMapViews', () => {
  assert.match(MAIN_SRC, /_pixelMapViewsPath/,
    'main.js must fetch the pixel map layout sidecar at boot');
  assert.match(MAIN_SRC, /params\.pixelMapViews = pmTree/,
    'the parsed sidecar must land in params.pixelMapViews before the panel loads it');
  assert.match(MAIN_SRC, /createViewsContainer\(pmTree\)/,
    'a corrupt sidecar must be detected at boot, not silently replaced by defaults');
  assert.match(MAIN_SRC, /fatalBootError\(\s*`\$\{_pixelMapViewsPath\}/,
    'a corrupt sidecar must HALT the boot (booting on would auto-save defaults over it)');
});

test('the panel arms the unload flush at init', () => {
  assert.match(PANEL_SRC, /installPixelMapPersistence\(\)/);
});

test('config.js still has no pixelMapViews wiring — the sidecar is the ONE path', () => {
  // The original bug was a params key with no YAML wiring. Now it deliberately
  // has none in the scene tree either: two writers for one layout is how the
  // next silent clobber would arrive.
  assert.doesNotMatch(CONFIG_SRC, /pixelMapViews/,
    'the pixel map layout must persist ONLY through its own sidecar');
});

// ─── 6. The sidecar is recoverable ────────────────────────────────────────

test('the sidecar is inside both the scoped and the full-save snapshot sets', () => {
  assert.deepEqual(sceneBackup.filesForPixelMapViews('titanic'),
    ['scenes/titanic/pixel_map_views.yaml']);
  assert.ok(sceneBackup.filesForSave('titanic').includes('scenes/titanic/pixel_map_views.yaml'),
    'a scene snapshot must capture the layout too, or a restore mixes eras');
});

test('a scoped write snapshots the previous layout before overwriting it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-persist-'));
  const roots = sceneBackup.deriveRoots(root);
  const sceneDir = path.join(roots.scenesRoot, 'titanic');
  fs.mkdirSync(sceneDir, { recursive: true });
  const live = path.join(sceneDir, 'pixel_map_views.yaml');
  fs.writeFileSync(live, yaml.dump(toParams(editedContainer()), { lineWidth: -1 }));

  const id = sceneBackup.snapshotBeforeWrite(
    'titanic', sceneBackup.filesForPixelMapViews('titanic'), 'save-pixel-map-views', roots);

  const backed = path.join(roots.backupsRoot, 'titanic', id,
    'scenes', 'titanic', 'pixel_map_views.yaml');
  assert.ok(fs.existsSync(backed), 'the previous layout must be recoverable');
  const restored = createViewsContainer(yaml.load(fs.readFileSync(backed, 'utf8')));
  assert.equal(findView(restored, 'top_down').offsets['Left Front Wall 1'].dx, 56);

  fs.rmSync(root, { recursive: true, force: true });
});
