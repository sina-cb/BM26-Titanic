/**
 * pixel_map_edit_interaction.test.js — browser proof that EDIT-mode select,
 * drag-under-framing, and offset persistence work on the live multiview shell.
 *
 * Guards the operator report: "Edit mode cannot select or move pixels" — the
 * failure mode was stale pointer listeners on a detached canvas after Preact
 * re-rendered the pane node, plus hit probes that ignored saved view framing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { simServerSkip } from './helpers/sim_server_probe.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const RENDER_DIR = path.join(REPO_ROOT, '.agent_renders');
const ORIGIN = process.env.BM26_VALIDATION_ORIGIN || 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl&pixelmap=edit`;

// This whole suite drives a REAL browser against the sim dev server. When
// nothing is listening on :6969, SKIP WITH REASON instead of failing every
// test with net::ERR_CONNECTION_REFUSED — see sim_server_probe.mjs.
const SKIP_NO_SIM = await simServerSkip();

async function withSimPage(fn) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      navigator.sendBeacon = () => true;
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('save-pixel-map-views')) req.abort();
      else req.continue();
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
    await page.evaluate(() => window.showPixelMap2d(true));
    await new Promise((r) => setTimeout(r, 3500));
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Find a visible fixture pixel and map it to screen coords using LIVE pane framing. */
async function visibleTarget(page, viewId, preferFixKey) {
  return page.evaluate(async (origin, vid, prefer) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);

    storeMod.store.mode.value = 'edit';
    const canvas = document.querySelector('.pmv-canvas');
    const rect = canvas.getBoundingClientRect();
    const view = storeMod.store.views.views.find((v) => v.id === vid);
    if (!view) throw new Error(`view '${vid}' missing`);
    const framing = view.framing || { zoom: 1, panX: 0, panY: 0 };

    const r = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
      { viewRegistry: storeMod.store.viewRegistry });
    const panel = r.panels[0];
    const px = layout.expandPanel(panel.def, panel.clusters, storeMod.store.list,
      layout.seedPanel(panel.def, panel.clusters, storeMod.store.list, 900, 520, panel.styles),
      panel.styles, view.offsets);

    const zoom = framing.zoom;
    const pan = { x: framing.panX, y: framing.panY };
    const sub = { id: panel.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
    const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
    const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, zoom, pan);

    const pick = px.find((p) => p.fixKey === prefer)
      || px.find((p) => {
        const cssX = p.cx * xf.scale + xf.ox;
        const cssY = p.cy * xf.scale + xf.oy;
        return cssX >= 24 && cssX <= rect.width - 24 && cssY >= 24 && cssY <= rect.height - 24;
      });
    if (!pick) throw new Error('need a visible pixel');

    const cssX = pick.cx * xf.scale + xf.ox;
    const cssY = pick.cy * xf.scale + xf.oy;
    return {
      fixKey: pick.fixKey,
      offsetBefore: view.offsets?.[pick.fixKey] ? { ...view.offsets[pick.fixKey] } : null,
      client: { x: rect.left + cssX, y: rect.top + cssY },
      css: { x: cssX, y: cssY },
    };
  }, ORIGIN, viewId, preferFixKey);
}

test('EDIT mode selects and drags a fixture under saved framing (top_down)',
  { timeout: 120_000, skip: SKIP_NO_SIM }, async () => {
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  await withSimPage(async (page) => {
    const target = await visibleTarget(page, 'top_down', 'Left_Back_Left');

    const client = target.client;
    await page.evaluate(() => document.querySelector('.pmv-canvas').focus());
    await page.evaluate((c) => {
      const canvas = document.querySelector('.pmv-canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: c.x, clientY: c.y, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
    }, client);
    await new Promise((r) => setTimeout(r, 150));
    let sel = await page.evaluate(async (origin) =>
      [...(await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`)).store.selection.value],
    ORIGIN);
    assert.ok(sel.includes(target.fixKey), `pointerdown must select '${target.fixKey}', got ${JSON.stringify(sel)}`);

    await page.evaluate((c) => {
      const canvas = document.querySelector('.pmv-canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: c.x, clientY: c.y, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: c.x + 96, clientY: c.y + 48, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    }, client);
    await new Promise((r) => setTimeout(r, 600));

    const after = await page.evaluate(async (origin, fk) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const v = storeMod.store.views.views.find((x) => x.id === 'top_down');
      return v.offsets?.[fk] || null;
    }, ORIGIN, target.fixKey);

    assert.ok(after, 'drag must persist an offset');
    const before = target.offsetBefore || { dx: 0, dy: 0 };
    assert.ok(Math.abs(after.dx - before.dx) > 4 || Math.abs(after.dy - before.dy) > 4,
      `offset must change from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);

    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_edit_top_down_after_drag.png') });
  });
});

test('Front view vintage rails project four fixtures across two cy bands',
  { timeout: 120_000, skip: SKIP_NO_SIM }, async () => {
  await withSimPage(async (page) => {
    const stats = await page.evaluate(async (origin) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
      const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);

      const view = storeMod.store.views.views.find((v) => v.id === 'front');
      const r = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
        { viewRegistry: storeMod.store.viewRegistry });
      const left = r.panels.find((p) => p.def.id === 'left');
      const px = layout.expandPanel(left.def, left.clusters, storeMod.store.list,
        layout.seedPanel(left.def, left.clusters, storeMod.store.list, 900, 520, left.styles),
        left.styles, view.offsets);

      const vintageFixtures = [...new Set(
        px.filter((p) => left.clusters.find((c) => c.fixKey === p.fixKey)?.fixtureType === 'VintageLed')
          .map((p) => p.fixKey),
      )].sort();

      const centroids = vintageFixtures.map((fixKey) => {
        const pts = px.filter((p) => p.fixKey === fixKey);
        const cx = pts.reduce((a, p) => a + p.cx, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.cy, 0) / pts.length;
        return { fixKey, cx, cy, heads: pts.length };
      });

      const cyBands = [...new Set(centroids.map((c) => Math.round(c.cy / 16) * 16))].sort((a, b) => a - b);
      return { vintageFixtures, centroids, cyBands, fixtureRows: cyBands.length };
    }, ORIGIN);

    assert.equal(stats.vintageFixtures.length, 4,
      `Left Front Rails must expose four VintageLed fixtures, got ${JSON.stringify(stats.vintageFixtures)}`);
    stats.centroids.forEach((c) => assert.equal(c.heads, 6, `${c.fixKey} must carry six mapped heads`));

    const headRowCounts = await page.evaluate(async (origin) => {
      const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
      const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
      const view = storeMod.store.views.views.find((v) => v.id === 'front');
      const r = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
        { viewRegistry: storeMod.store.viewRegistry });
      const left = r.panels.find((p) => p.def.id === 'left');
      const px = layout.expandPanel(left.def, left.clusters, storeMod.store.list,
        layout.seedPanel(left.def, left.clusters, storeMod.store.list, 900, 520, left.styles),
        left.styles, view.offsets);
      const vintageFixtures = [...new Set(
        px.filter((p) => left.clusters.find((c) => c.fixKey === p.fixKey)?.fixtureType === 'VintageLed')
          .map((p) => p.fixKey),
      )];
      return vintageFixtures.map((fixKey) => {
        const pts = px.filter((p) => p.fixKey === fixKey).sort((a, b) => (a.gi || 0) - (b.gi || 0));
        return { fixKey, rows: pts.map((p) => Math.round(p.cy * 10) / 10) };
      });
    }, ORIGIN);

    for (const row of headRowCounts) {
      const ys = row.rows.sort((a, b) => a - b);
      const gap = ys[ys.length - 1] - ys[0];
      const mid = (ys[0] + ys[ys.length - 1]) / 2;
      const top = ys.filter((y) => y <= mid);
      const bot = ys.filter((y) => y > mid);
      assert.equal(top.length, 3, `${row.fixKey} must have three heads in the top row`);
      assert.equal(bot.length, 3, `${row.fixKey} must have three heads in the bottom row`);
      assert.ok(gap > 8, `${row.fixKey} rows must be separated, span=${gap}`);
    }

    await page.evaluate(async (origin) => {
      const tree = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_tree.js`);
      let s = tree.loadLayout(window.__activeScene || 'titanic') || tree.createState('front');
      s = tree.bindView(s, 'front', s.focus || '');
      tree.saveLayout(window.__activeScene || 'titanic', s);
    }, ORIGIN);
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(RENDER_DIR, 'pixel_map_front_vintage_rows.png') });
  });
});
