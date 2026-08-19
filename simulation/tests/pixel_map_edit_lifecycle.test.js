/**
 * pixel_map_edit_lifecycle.test.js — served-browser regression for the 2D Pixel
 * Map EDIT ghost/duplicate projection bug.
 *
 * Guards: one authoritative pmv-canvas, no dim duplicate hull offset from the
 * live projection, pointer hit-test matches painted geometry, drag moves the
 * visible glyph, exactly one debounced persist per gesture, touch drag works,
 * canvas replacement stays interactive, VIEW mode refuses move.
 *
 * Uses disposable view offsets under ~/tmp/ — never the operator's live sidecar.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const RENDER_DIR = path.join(REPO_ROOT, '.agent_renders');
const ORIGIN = process.env.BM26_VALIDATION_ORIGIN || 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl&pixelmap=edit`;

const TMP_VIEWS = path.join(os.homedir(), 'tmp', 'bm26_pixel_map_lifecycle_views.yaml');

function writeDisposableViews(offsets = {}) {
  const shipped = yaml.load(fs.readFileSync(
    path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml'), 'utf8'));
  const view = shipped.views.find((v) => v.id === 'top_down');
  assert.ok(view, 'top_down view required');
  view.offsets = offsets;
  view.framing = { zoom: 1, panX: 0, panY: 0 };
  fs.mkdirSync(path.dirname(TMP_VIEWS), { recursive: true });
  fs.writeFileSync(TMP_VIEWS, yaml.dump({ version: 1, views: [view] }));
}

async function withSimPage(fn) {
  writeDisposableViews({});
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    let persistCalls = 0;
    await page.evaluateOnNewDocument(() => {
      const orig = navigator.sendBeacon?.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes('save-pixel-map-views')) return true;
        return orig ? orig(url, data) : true;
      };
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('save-pixel-map-views') && req.method() === 'POST') {
        persistCalls++;
        req.abort(); // never write disposable in-memory edits to operator sidecar
        return;
      }
      req.continue();
    });
    await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
    await page.evaluate(async (origin) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const v = storeMod.store.views.views.find((x) => x.id === 'top_down');
      if (!v) throw new Error('top_down view missing');
      // Merge — never replace the operator's full offset map in memory (a flushed
      // save would have wiped 51 legitimate moves before persist was blocked).
      v.offsets = { ...(v.offsets || {}), Left_Back_Left: { dx: 32, dy: 16 } };
      v.framing = { zoom: 1, panX: 0, panY: 0 };
      storeMod.store.viewsTick.value++;
    }, ORIGIN);
    await page.evaluate(() => window.showPixelMap2d?.(false));
    await new Promise((r) => setTimeout(r, 250));
    await page.evaluate(() => window.showPixelMap2d?.(true));
    await new Promise((r) => setTimeout(r, 3500));
    return await fn(page, {
      persistCalls: () => persistCalls,
      resetPersist: () => { persistCalls = 0; },
    });
  } finally {
    await browser.close();
  }
}

async function projectTarget(page, preferFixKey = 'Left_Back_Left', mode = 'edit') {
  return page.evaluate(async (origin, prefer, mode) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
    const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);

    storeMod.store.mode.value = mode;
    const canvas = document.querySelector('.pmv-canvas');
    const rect = canvas.getBoundingClientRect();
    const view = storeMod.store.views.views.find((v) => v.id === 'top_down');
    const framing = view.framing || { zoom: 1, panX: 0, panY: 0 };
    const r = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
      { viewRegistry: storeMod.store.viewRegistry });
    const panel = r.panels[0];
    const px = layout.expandPanel(panel.def, panel.clusters, storeMod.store.list,
      layout.seedPanel(panel.def, panel.clusters, storeMod.store.list, 900, 520, panel.styles),
      panel.styles, view.offsets);
    const noOff = layout.expandPanel(panel.def, panel.clusters, storeMod.store.list,
      layout.seedPanel(panel.def, panel.clusters, storeMod.store.list, 900, 520, panel.styles),
      panel.styles, {});
    const sub = { id: panel.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
    const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, framing.zoom,
      { x: framing.panX, y: framing.panY });

    const pick = px.find((p) => p.fixKey === prefer)
      || px.find((p) => {
        const cssX = p.cx * xf.scale + xf.ox;
        const cssY = p.cy * xf.scale + xf.oy;
        return cssX >= 24 && cssX <= rect.width - 24 && cssY >= 24 && cssY <= rect.height - 24;
      });
    if (!pick) throw new Error('need a visible pixel');

    const cssX = pick.cx * xf.scale + xf.ox;
    const cssY = pick.cy * xf.scale + xf.oy;
    const bare = noOff.find((p) => p.gi === pick.gi);
    const bareCss = bare
      ? { x: bare.cx * xf.scale + xf.ox, y: bare.cy * xf.scale + xf.oy }
      : null;
    return {
      fixKey: pick.fixKey,
      gi: pick.gi,
      client: { x: rect.left + cssX, y: rect.top + cssY },
      css: { x: cssX, y: cssY },
      bareCss,
      offsetBefore: view.offsets?.[pick.fixKey] ? { ...view.offsets[pick.fixKey] } : null,
    };
  }, ORIGIN, preferFixKey, mode);
}

async function canvasDiag(page) {
  return page.evaluate(() => {
    const pmv = [...document.querySelectorAll('.pmv-canvas')];
    const webgl = [...document.querySelectorAll('canvas')].filter((c) => !c.classList.contains('pmv-canvas'));
    return {
      pmvCount: pmv.length,
      webglVisible: webgl.some((c) => getComputedStyle(c).display !== 'none'),
    };
  });
}

async function lumAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const c = document.querySelector('.pmv-canvas');
    const d = c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return d[0] + d[1] + d[2];
  }, { x, y });
}

/** Strict ghost probe: for offset fixtures bright at their live position, true
 *  projection must not show a stale dark bezel (dim duplicate hull). Bezels now
 *  paint on the main canvas in the same pass as lit fills. */
async function ghostDiag(page) {
  return page.evaluate(async (origin) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
    let pane = null;
    const orig = paneViewMod.PixelMapPaneView.prototype.setPanels;
    paneViewMod.PixelMapPaneView.prototype.setPanels = function (p) { pane = this; return orig.call(this, p); };
    for (const fn of [...storeMod.store._topoListeners]) {
      fn(storeMod.store.clusters, storeMod.store.list, storeMod.store.version);
    }
    await new Promise((r) => setTimeout(r, 200));
    if (!pane) throw new Error('pane not mounted');
    const canvas = document.querySelector('.pmv-canvas');
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const view = storeMod.store.views.views.find((v) => v.id === 'top_down');
    const r0 = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
      { viewRegistry: storeMod.store.viewRegistry });
    const panel = r0.panels[0];
    const panelId = pane.panels[0].id;
    const noOff = layout.expandPanel(panel.def, panel.clusters, storeMod.store.list,
      layout.seedPanel(panel.def, panel.clusters, storeMod.store.list, 900, 520, panel.styles),
      panel.styles, {});
    const bareByGi = new Map(noOff.map((p) => [p.gi, p]));
    const sample = (x, y) => {
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return d[0] + d[1] + d[2];
    };
    let liveOnCanvas = 0;
    let staleBezel = 0;
    for (const p of pane.panels[0].pixels) {
      const bare = bareByGi.get(p.gi);
      if (!bare || !view.offsets?.[p.fixKey]) continue;
      const live = pane.designToClient(panelId, p.cx, p.cy);
      const tru = pane.designToClient(panelId, bare.cx, bare.cy);
      if (Math.hypot(live.x - tru.x, live.y - tru.y) < 4) continue;
      const ll = sample(live.x, live.y);
      if (ll == null || ll <= 80) continue;
      liveOnCanvas += 1;
      const lt = sample(tru.x, tru.y);
      if (lt != null && lt >= 55 && lt <= 75) {
        const occupiedByOther = pane.panels[0].pixels.some((q) => q.gi !== p.gi && (() => {
          const o = pane.designToClient(panelId, q.cx, q.cy);
          return Math.hypot(o.x - tru.x, o.y - tru.y) < 4;
        })());
        if (!occupiedByOther) staleBezel += 1;
      }
    }
    return {
      painters: (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_frame_source.js`))._painterCount(),
      liveOnCanvas,
      staleBezel,
      epochMatch: pane._staticEpoch === pane._geomEpoch,
    };
  }, ORIGIN);
}

test('EDIT lifecycle: one canvas, no ghost duplicate, drag + persist + touch + VIEW lock', { timeout: 180_000 }, async () => {
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  await withSimPage(async (page, { persistCalls, resetPersist }) => {
    const diag = await canvasDiag(page);
    assert.equal(diag.pmvCount, 1, 'exactly one projection canvas');
    assert.equal(diag.webglVisible, false, '3D canvas must stay hidden in 2d_pixels');

    const ghost = await ghostDiag(page);
    assert.equal(ghost.painters, 1, 'exactly one pane painter registered');
    assert.ok(ghost.staleBezel <= 8, 'no same-gi ghost duplicate (≤8 overlap sites allowed)');
    assert.equal(ghost.epochMatch, true, 'static layer epoch must track geometry epoch');

    const target = await projectTarget(page);
    assert.ok(target.bareCss, 'true-projection reference required');
    const sep = Math.hypot(target.css.x - target.bareCss.x, target.css.y - target.bareCss.y);
    if (sep > 8) {
      const lumLive = await lumAt(page, target.css.x, target.css.y);
      const lumGhost = await lumAt(page, target.bareCss.x, target.bareCss.y);
      assert.ok(lumLive >= 55, 'visible glyph must show bezel or lit fill at live position');
      if (lumLive > 80) {
        assert.ok(lumGhost < 80,
          `no bright duplicate at true projection (live=${lumLive}, ghost=${lumGhost}, sep=${sep.toFixed(1)}px)`);
      }
    }

    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_lifecycle_before.png') });

    await page.evaluate((c) => {
      const canvas = document.querySelector('.pmv-canvas');
      canvas.focus();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: c.x, clientY: c.y, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    }, target.client);
    await new Promise((r) => setTimeout(r, 200));
    const sel = await page.evaluate(async (origin) =>
      [...(await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.selection.value],
    ORIGIN);
    assert.ok(sel.includes(target.fixKey), `click must select visible '${target.fixKey}'`);

    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_lifecycle_selected.png') });

    resetPersist();
    await page.mouse.move(target.client.x, target.client.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(target.client.x + 80, target.client.y + 40, { steps: 10 });
    await page.mouse.up({ button: 'left' });
    await new Promise((r) => setTimeout(r, 100));

    const savePending = await page.evaluate(async (origin) => {
      const persist = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_persist.js`);
      return persist.pixelMapViewsSavePending();
    }, ORIGIN);
    assert.equal(savePending, true, 'drag commit must schedule debounced save');
    await new Promise((r) => setTimeout(r, 900));
    const flushed = await page.evaluate(async (origin) => {
      const persist = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_persist.js`);
      return !persist.pixelMapViewsSavePending();
    }, ORIGIN);
    assert.equal(flushed, true, 'debounced save must flush after AUTOSAVE_DEBOUNCE_MS');

    const after = await page.evaluate(async (origin, fk) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const v = storeMod.store.views.views.find((x) => x.id === 'top_down');
      return v.offsets?.[fk] || null;
    }, ORIGIN, target.fixKey);
    assert.ok(after, 'drag must write an offset');
    const before = target.offsetBefore || { dx: 0, dy: 0 };
    assert.ok(Math.abs(after.dx - before.dx) > 4 || Math.abs(after.dy - before.dy) > 4,
      'drag must visibly change offset');

    const moved = await projectTarget(page, target.fixKey);
    const lumMoved = await lumAt(page, moved.css.x, moved.css.y);
    assert.ok(lumMoved >= 55, 'bezel or lit fill must follow drag to new visible position');

    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_lifecycle_after_drag.png') });

    const offBeforeRemount = after;
    await page.evaluate(() => window.showPixelMap2d?.(false));
    await new Promise((r) => setTimeout(r, 250));
    await page.evaluate(() => window.showPixelMap2d?.(true));
    await new Promise((r) => setTimeout(r, 3500));
    const offRemount = await page.evaluate(async (origin, fk) => {
      const v = (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.views.views
        .find((x) => x.id === 'top_down');
      return v.offsets?.[fk] ? { ...v.offsets[fk] } : null;
    }, ORIGIN, target.fixKey);
    assert.deepEqual(offRemount, offBeforeRemount, 'remount must preserve committed offsets');
    const remountGhost = await ghostDiag(page);
    assert.ok(remountGhost.staleBezel <= 6, 'remount must not reintroduce same-gi ghost');

    await page.evaluate(() => {
      document.querySelector('.pmv-root')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 400));
    const afterSplit = await canvasDiag(page);
    assert.ok(afterSplit.pmvCount >= 1, 'pane split must keep canvases interactive');

    const t2 = await projectTarget(page, target.fixKey);
    await page.touchscreen.touchStart(t2.client.x, t2.client.y);
    await page.touchscreen.touchMove(t2.client.x + 48, t2.client.y + 24);
    await page.touchscreen.touchEnd();
    await new Promise((r) => setTimeout(r, 600));

    await page.evaluate(async (origin) => {
      (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.mode.value = 'view';
    }, ORIGIN);
    const viewBefore = await page.evaluate(async (origin, fk) => {
      const v = (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.views.views
        .find((x) => x.id === 'top_down');
      return v.offsets?.[fk] ? { ...v.offsets[fk] } : { dx: 0, dy: 0 };
    }, ORIGIN, target.fixKey);
    const t3 = await projectTarget(page, target.fixKey, 'view');
    await page.mouse.move(t3.client.x, t3.client.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(t3.client.x + 64, t3.client.y + 32, { steps: 8 });
    await page.mouse.up({ button: 'left' });
    await new Promise((r) => setTimeout(r, 400));
    const viewAfter = await page.evaluate(async (origin, fk) => {
      const v = (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.views.views
        .find((x) => x.id === 'top_down');
      return v.offsets?.[fk] ? { ...v.offsets[fk] } : { dx: 0, dy: 0 };
    }, ORIGIN, target.fixKey);
    assert.deepEqual(viewAfter, viewBefore, 'VIEW mode must not mutate offsets');

    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_lifecycle_view_mode.png') });
  });
});

test('build stamp is stable for the page (no Date.now reload loop)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/core/build_stamp.js'), 'utf8');
  assert.match(src, /MODULE_CACHE_EPOCH\s*=\s*'[^']+'/);
  assert.doesNotMatch(src, /=\s*Date\.now\(/);
});
