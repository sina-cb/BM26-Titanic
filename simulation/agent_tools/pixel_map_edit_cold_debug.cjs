/**
 * Cold-debug probe for 2D Pixel Map EDIT interaction on the served sim.
 * Uses real Puppeteer mouse/touch — not synthetic dispatchEvent helpers.
 *
 * Usage (from simulation/agent_tools):
 *   BM26_VALIDATION_ORIGIN=http://127.0.0.1:7869 node pixel_map_edit_cold_debug.cjs
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORIGIN = process.env.BM26_VALIDATION_ORIGIN || 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl&pixelmap=edit`;
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.BM26_RENDER_DIR || path.join(REPO_ROOT, '.agent_renders');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const logs = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.message }));

  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
  await sleep(3500);

  const beforeShot = path.join(OUT, 'pixel_map_edit_before.png');
  await page.screenshot({ path: beforeShot, fullPage: false });

  const diag0 = await page.evaluate(async (origin) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const canvas = document.querySelector('.pmv-canvas');
    const rect = canvas.getBoundingClientRect();
    const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      mode: storeMod.store.mode.value,
      fixtureCount: storeMod.store.fixtureCount.value,
      pixelCount: storeMod.store.pixelCount.value,
      canvasSize: { w: rect.width, h: rect.height },
      topElement: topEl ? { tag: topEl.tagName, class: topEl.className, id: topEl.id } : null,
      canvasConnected: canvas.isConnected,
      canvasTabIndex: canvas.getAttribute('tabindex'),
      webglDisplay: document.querySelector('canvas:not(.pmv-canvas)')?.style?.display ?? '(no other canvas)',
    };
  }, ORIGIN);

  const target = await page.evaluate(async (origin) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
    const paneViewMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);

    storeMod.store.mode.value = 'edit';
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
    const zoom = framing.zoom;
    const pan = { x: framing.panX, y: framing.panY };
    const sub = { id: panel.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
    const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, zoom, pan);
    const pick = px.find((p) => {
      const cssX = p.cx * xf.scale + xf.ox;
      const cssY = p.cy * xf.scale + xf.oy;
      return cssX >= 24 && cssX <= rect.width - 24 && cssY >= 24 && cssY <= rect.height - 24;
    });
    if (!pick) throw new Error('no visible pixel');
    const cssX = pick.cx * xf.scale + xf.ox;
    const cssY = pick.cy * xf.scale + xf.oy;
    return {
      fixKey: pick.fixKey,
      client: { x: rect.left + cssX, y: rect.top + cssY },
      offsetBefore: view.offsets?.[pick.fixKey] ? { ...view.offsets[pick.fixKey] } : null,
    };
  }, ORIGIN);

  await page.mouse.move(target.client.x, target.client.y);
  await page.mouse.down({ button: 'left' });
  await sleep(80);
  await page.mouse.up({ button: 'left' });
  await sleep(200);

  const afterClick = await page.evaluate(async (origin) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    return { selection: [...storeMod.store.selection.value], mode: storeMod.store.mode.value };
  }, ORIGIN);

  await page.screenshot({ path: path.join(OUT, 'pixel_map_edit_selected.png') });

  await page.mouse.move(target.client.x, target.client.y);
  await page.mouse.down({ button: 'left' });
  await sleep(50);
  await page.mouse.move(target.client.x + 96, target.client.y + 48, { steps: 12 });
  await sleep(50);
  await page.mouse.up({ button: 'left' });
  await sleep(900);

  const afterDrag = await page.evaluate(async (origin, fk) => {
    const storeMod = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const v = storeMod.store.views.views.find((x) => x.id === 'top_down');
    return { selection: [...storeMod.store.selection.value], offset: v.offsets?.[fk] || null };
  }, ORIGIN, target.fixKey);

  await page.screenshot({ path: path.join(OUT, 'pixel_map_edit_after_drag.png') });

  const cacheProbe = {};
  for (const rel of [
    'simulation/main.js',
    'simulation/src/gui/pixel_map/pixel_map_interaction.js',
    'simulation/src/gui/modern/pixel_map_multiview_panel.js',
  ]) {
    const res = await fetch(`${ORIGIN}/${rel}`, { method: 'HEAD' });
    const body = await (await fetch(`${ORIGIN}/${rel}`)).text();
    cacheProbe[rel] = {
      status: res.status,
      cacheControl: res.headers.get('cache-control'),
      servedSha256: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16),
      workspaceSha256: crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(REPO_ROOT, rel))).digest('hex').slice(0, 16),
    };
  }

  const report = {
    url: SIM, diag0, target, afterClick, afterDrag, cacheProbe,
    errors: logs.filter((l) => l.type === 'error' || l.type === 'pageerror'),
  };
  const reportPath = path.join(OUT, 'pixel_map_edit_cold_debug.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
