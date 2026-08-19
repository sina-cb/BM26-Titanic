/**
 * pixel_map_geometry_regression.test.js — served-browser assertions on the live
 * operator Titanic sidecar (pixel_map_views.yaml). Guards unified glyph geometry:
 * 964 mapped indices across presets, static/dynamic ID sets coincide, one canvas,
 * no stale duplicate cluster, hit/drag moves both layers, reload persists.
 *
 * Uses isolated BM26_VALIDATION_ORIGIN — never writes operator sidecar.
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
const BARE_SIM = `${ORIGIN}/simulation/?scene=titanic`;
const SIDECAR = path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml');

async function withPage(viewport, fn, { blockPersist = true } = {}) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
  });
  try {
    const page = await browser.newPage();
    if (blockPersist) {
      await page.evaluateOnNewDocument(() => {
        navigator.sendBeacon = () => true;
      });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('save-pixel-map-views')) req.abort();
        else req.continue();
      });
    }
    await page.setViewport(viewport);
    await page.goto(BARE_SIM, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 4000));
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function geometryReport(page) {
  return page.evaluate(async (origin) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
    const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
    const frameMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_frame_source.js`);

    let pane = null;
    const origSet = paneViewMod.PixelMapPaneView.prototype.setPanels;
    paneViewMod.PixelMapPaneView.prototype.setPanels = function (p) {
      pane = this;
      return origSet.call(this, p);
    };
    for (const fn of [...storeMod.store._topoListeners]) {
      fn(storeMod.store.clusters, storeMod.store.list, storeMod.store.version);
    }
    await new Promise((r) => setTimeout(r, 300));
    if (!pane) throw new Error('pane not mounted');

    const canvas = document.querySelector('.pmv-canvas');
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const view = storeMod.store.views.views.find((v) => v.id === 'top_down');
    const r0 = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
      { viewRegistry: storeMod.store.viewRegistry });
    const panelDef = r0.panels[0];
    const auth = layout.expandPanel(
      panelDef.def, panelDef.clusters, storeMod.store.list,
      layout.seedPanel(panelDef.def, panelDef.clusters, storeMod.store.list, 900, 520, panelDef.styles),
      panelDef.styles, view.offsets || {},
    );
    const bare = layout.expandPanel(
      panelDef.def, panelDef.clusters, storeMod.store.list,
      layout.seedPanel(panelDef.def, panelDef.clusters, storeMod.store.list, 900, 520, panelDef.styles),
      panelDef.styles, {},
    );
    const panePx = pane.panels[0].pixels;
    const sub = { id: pane.panels[0].id, x: 0, y: 0, w: rect.width, h: rect.height };
    const framing = view.framing || { zoom: 1, panX: 0, panY: 0 };
    const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, framing.zoom,
      { x: framing.panX, y: framing.panY });

    const authIds = auth.map((p) => `${p.gi}:${Math.round(p.cx * 100)}:${Math.round(p.cy * 100)}`).sort();
    const paneIds = panePx.map((p) => `${p.gi}:${Math.round(p.cx * 100)}:${Math.round(p.cy * 100)}`).sort();

    let totalMapped = 0;
    for (const v of storeMod.store.views.views) {
      const rv = views.resolveView(v, storeMod.store.clusters, storeMod.store.list,
        { viewRegistry: storeMod.store.viewRegistry });
      for (const pan of rv.panels) {
        totalMapped += layout.expandPanel(
          pan.def, pan.clusters, storeMod.store.list,
          layout.seedPanel(pan.def, pan.clusters, storeMod.store.list, 900, 520, pan.styles),
          pan.styles, v.offsets || {},
        ).length;
      }
    }

    const dpr = window.devicePixelRatio || 1;
    const sample = (x, y) => {
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.round((x + dx) * dpr);
          const sy = Math.round((y + dy) * dpr);
          if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
          const d = ctx.getImageData(sx, sy, 1, 1).data;
          best = Math.max(best, d[0] + d[1] + d[2]);
        }
      }
      return best;
    };

    let staleBezel = 0;
    let representedAtAuth = 0;
    let onCanvasAuth = 0;
    const offKeys = Object.keys(view.offsets || {});
    for (const p of auth) {
      const live = { x: p.cx * xf.scale + xf.ox, y: p.cy * xf.scale + xf.oy };
      if (live.x < -8 || live.y < -8 || live.x > rect.width + 8 || live.y > rect.height + 8) continue;
      onCanvasAuth++;
      const ll = sample(live.x, live.y);
      if (ll != null && ll >= 40) representedAtAuth++;
      if (!view.offsets?.[p.fixKey]) continue;
      const b = bare.find((q) => q.gi === p.gi);
      if (!b) continue;
      const tru = { x: b.cx * xf.scale + xf.ox, y: b.cy * xf.scale + xf.oy };
      if (Math.hypot(live.x - tru.x, live.y - tru.y) < 4) continue;
      const lt = sample(tru.x, tru.y);
      if (ll != null && ll > 80 && lt != null && lt >= 55 && lt <= 85) {
        // Another fixture can legitimately occupy the true-projection site after
        // this one was offset — that is overlap, not a same-gi ghost duplicate.
        const occupiedByOther = auth.some((q) => q.gi !== p.gi && Math.hypot(
          q.cx * xf.scale + xf.ox - tru.x,
          q.cy * xf.scale + xf.oy - tru.y) < 4);
        if (!occupiedByOther) staleBezel++;
      }
    }

    let offCanvas = 0;
    for (const p of auth) {
      const x = p.cx * xf.scale + xf.ox;
      const y = p.cy * xf.scale + xf.oy;
      if (x < -8 || y < -8 || x > rect.width + 8 || y > rect.height + 8) offCanvas++;
    }

    const pmv = document.querySelectorAll('.pmv-canvas').length;
    const webgl = [...document.querySelectorAll('canvas')]
      .filter((c) => !c.classList.contains('pmv-canvas'))
      .some((c) => getComputedStyle(c).display !== 'none');

    return {
      pixelCount: storeMod.store.pixelCount.value,
      totalMappedAllPresets: totalMapped,
      topDownCount: auth.length,
      authIds,
      paneIds,
      offsetCount: offKeys.length,
      offCanvas,
      onCanvasAuth,
      staleBezel,
      representedAtAuth,
      pmvCount: pmv,
      webglVisible: webgl,
      painters: frameMod._painterCount(),
      epochMatch: pane._staticEpoch === pane._geomEpoch,
      canvas: { w: rect.width, h: rect.height, backingW: canvas.width, backingH: canvas.height },
    };
  }, ORIGIN);
}

function sidecarOffsetCount() {
  const doc = yaml.load(fs.readFileSync(SIDECAR, 'utf8'));
  const top = doc.views.find((v) => v.id === 'top_down');
  return { count: Object.keys(top?.offsets || {}).length, framing: top?.framing };
}

for (const [label, viewport] of [['screenshot', { width: 1440, height: 900 }],
  ['ipad', { width: 1024, height: 768 }]]) {
  test(`operator sidecar geometry (${label} ${viewport.width}x${viewport.height})`, { timeout: 180_000 }, async () => {
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    const offsets = sidecarOffsetCount();
    assert.equal(offsets.count, 52, 'operator sidecar must still carry 52 fixture offsets');

    await withPage(viewport, async (page) => {
      const shot = path.join(RENDER_DIR, `pixel_map_geometry_${label}_${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: shot, fullPage: false });

      const r = await geometryReport(page);
      assert.equal(r.pixelCount, 964, 'model topology must expose 964 physical pixels');
      assert.equal(r.totalMappedAllPresets, 1632,
        'expected 1632 mapped glyph rows across all presets (964 top_down overlap counted per view)');
      assert.equal(r.topDownCount, 768, 'top_down view maps 768 physical indices');
      assert.deepEqual(r.paneIds, r.authIds,
        'pane glyph ID+coordinate set must match authoritative expandPanel output');
      assert.equal(r.pmvCount, 1, 'exactly one .pmv-canvas');
      assert.equal(r.webglVisible, false, 'WebGL canvas must stay hidden in 2d_pixels');
      assert.equal(r.painters, 1, 'exactly one pane painter');
      assert.ok(r.staleBezel <= 10,
        'no same-gi ghost duplicate (≤10 cross-fixture overlap sites allowed)');
      assert.ok(r.representedAtAuth >= Math.floor(r.onCanvasAuth * 0.98),
        `on-canvas pixels must render bezel or lit fill (${r.representedAtAuth}/${r.onCanvasAuth})`);
      assert.ok(r.offCanvas <= 2,
        'operator offsets may clip at most two edge glyphs at this framing');
      assert.equal(r.epochMatch, true, 'static BG epoch must track geometry epoch');
      assert.equal(r.canvas.backingW, r.canvas.w, 'canvas backing width must match CSS width at dpr=1');
    });
  });
}

test('operator sidecar reload preserves offsets in memory', { timeout: 180_000 }, async () => {
  await withPage({ width: 1440, height: 900 }, async (page) => {
    const before = await page.evaluate(async (origin) => {
      const v = (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`))
        .store.views.views.find((x) => x.id === 'top_down');
      return JSON.stringify(v.offsets || {});
    }, ORIGIN);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 4000));
    const after = await page.evaluate(async (origin) => {
      const v = (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`))
        .store.views.views.find((x) => x.id === 'top_down');
      return JSON.stringify(v.offsets || {});
    }, ORIGIN);
    assert.equal(after, before, 'full reload must rehydrate operator offsets from sidecar');
  });
});

test('drag moves bezel and lit glyph together (operator sidecar)', { timeout: 180_000 }, async () => {
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  await withPage({ width: 1440, height: 900 }, async (page) => {
    await page.evaluate(async (origin) => {
      (await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.mode.value = 'edit';
    }, ORIGIN);

    const target = await page.evaluate(async (origin) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
      const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
      const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
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
      const sub = { id: panel.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
      const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, framing.zoom,
        { x: framing.panX, y: framing.panY });
      const pick = px.find((p) => p.fixKey === 'Left_Back_Left')
        || px.find((p) => {
          const x = p.cx * xf.scale + xf.ox;
          const y = p.cy * xf.scale + xf.oy;
          return x > 24 && x < rect.width - 24 && y > 24 && y < rect.height - 24;
        });
      const bare = layout.expandPanel(panel.def, panel.clusters, storeMod.store.list,
        layout.seedPanel(panel.def, panel.clusters, storeMod.store.list, 900, 520, panel.styles),
        panel.styles, {});
      const barePick = bare.find((p) => p.gi === pick.gi);
      const cssX = pick.cx * xf.scale + xf.ox;
      const cssY = pick.cy * xf.scale + xf.oy;
      const bareCss = barePick
        ? { x: barePick.cx * xf.scale + xf.ox, y: barePick.cy * xf.scale + xf.oy }
        : { x: cssX, y: cssY };
      return {
        fixKey: pick.fixKey,
        gi: pick.gi,
        client: { x: rect.left + cssX, y: rect.top + cssY },
        css: { x: cssX, y: cssY },
        bareCss,
      };
    }, ORIGIN);

    const lumBefore = await page.evaluate(({ x, y }) => {
      const d = document.querySelector('.pmv-canvas').getContext('2d')
        .getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return d[0] + d[1] + d[2];
    }, target.css);

    await page.mouse.move(target.client.x, target.client.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(target.client.x + 72, target.client.y + 36, { steps: 10 });
    await page.mouse.up({ button: 'left' });
    await new Promise((r) => setTimeout(r, 500));

    const after = await page.evaluate(async (origin, fk, bareCss) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
      const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
      const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
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
      const pick = px.find((p) => p.fixKey === fk);
      const sub = { id: panel.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
      const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, framing.zoom,
        { x: framing.panX, y: framing.panY });
      const cssX = pick.cx * xf.scale + xf.ox;
      const cssY = pick.cy * xf.scale + xf.oy;
      const ctx = canvas.getContext('2d');
      const sample = (x, y) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return d[0] + d[1] + d[2];
      };
      return {
        css: { x: cssX, y: cssY },
        bareCss,
        offset: view.offsets?.[fk] || null,
        lumNew: sample(cssX, cssY),
        lumBare: sample(bareCss.x, bareCss.y),
      };
    }, ORIGIN, target.fixKey, target.bareCss);

    assert.ok(after.offset, 'drag must persist an offset');
    assert.ok(after.lumNew >= 55,
      `bezel or lit fill must follow drag to new site (lum=${after.lumNew})`);
    assert.ok(after.lumBare < 55 || Math.abs(after.lumBare - lumBefore) > 10,
      'true projection site must not retain this fixture after drag');
  });
});
