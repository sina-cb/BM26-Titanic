/**
 * pixel_map_geometry_probe.cjs — cold-debug geometry instrument for 2D Pixels.
 * Uses operator sidecar + production-like bare URL. No sidecar writes.
 *
 * Usage (from simulation/agent_tools, sim on :7869):
 *   BM26_VALIDATION_ORIGIN=http://127.0.0.1:7869 node pixel_map_geometry_probe.cjs [--viewport 1440x900|1024x768]
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ORIGIN = process.env.BM26_VALIDATION_ORIGIN || 'http://127.0.0.1:7869';
const REPO = path.resolve(__dirname, '../..');
const OUT = process.env.BM26_RENDER_DIR || path.join(REPO, '.agent_renders');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const vpArg = args.find((a) => a.startsWith('--viewport='))?.split('=')[1]
  || (args.includes('--viewport') ? args[args.indexOf('--viewport') + 1] : '1440x900');
const [vpW, vpH] = vpArg.split('x').map(Number);

// Production-like bare URL (canonicalizes to 2d_pixels per url_canonicalization.js)
const BARE_URL = `${ORIGIN}/simulation/?scene=titanic`;
const EDIT_URL = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl&pixelmap=edit`;

function countOffsets(yamlPath) {
  const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
  const top = doc.views.find((v) => v.id === 'top_down');
  const offsets = top?.offsets || {};
  return { count: Object.keys(offsets).length, framing: top?.framing, offsets };
}

async function probePage(page, url, label) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('.pmv-canvas'), { timeout: 120_000 });
  await sleep(4000);

  const shotPath = path.join(OUT, `pixel_map_probe_${label}_${vpW}x${vpH}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });

  const diag = await page.evaluate(async (origin) => {
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
    const dpr = window.devicePixelRatio || 1;

    const view = storeMod.store.views.views.find((v) => v.id === 'top_down');
    const framing = view.framing || { zoom: 1, panX: 0, panY: 0 };
    const r0 = views.resolveView(view, storeMod.store.clusters, storeMod.store.list,
      { viewRegistry: storeMod.store.viewRegistry });
    const panelDef = r0.panels[0];
    const panelId = pane.panels[0]?.id;

    const authoritative = layout.expandPanel(
      panelDef.def, panelDef.clusters, storeMod.store.list,
      layout.seedPanel(panelDef.def, panelDef.clusters, storeMod.store.list, 900, 520, panelDef.styles),
      panelDef.styles, view.offsets || {},
    );
    const noOffsets = layout.expandPanel(
      panelDef.def, panelDef.clusters, storeMod.store.list,
      layout.seedPanel(panelDef.def, panelDef.clusters, storeMod.store.list, 900, 520, panelDef.styles),
      panelDef.styles, {},
    );
    const bareByGi = new Map(noOffsets.map((p) => [p.gi, p]));

    const sub = { id: panelDef.def.id, x: 0, y: 0, w: rect.width, h: rect.height };
    const xf = paneViewMod.panelTransform({ w: 900, h: 520 }, sub, framing.zoom,
      { x: framing.panX, y: framing.panY });

    const panePixels = pane.panels[0]?.pixels || [];
    const paneGiSet = new Set(panePixels.map((p) => p.gi));
    const authGiSet = new Set(authoritative.map((p) => p.gi));

    const toCss = (p) => ({
      gi: p.gi,
      fixKey: p.fixKey,
      x: p.cx * xf.scale + xf.ox,
      y: p.cy * xf.scale + xf.oy,
    });

    const authCss = authoritative.map(toCss);
    const paneCss = panePixels.map(toCss);

    const idsMatch = authoritative.length === panePixels.length
      && authoritative.every((p, i) => {
        const q = panePixels[i];
        return q && q.gi === p.gi && Math.abs(q.cx - p.cx) < 0.01 && Math.abs(q.cy - p.cy) < 0.01;
      });

    const sample = (x, y) => {
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
      const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], lum: d[0] + d[1] + d[2] };
    };

    let staleBezel = 0;
    let liveBright = 0;
    let offCanvasAuth = 0;
    let offCanvasPane = 0;
    const offsetMismatches = [];

    for (const p of authoritative) {
      const bare = bareByGi.get(p.gi);
      const live = toCss(p);
      const tru = bare ? toCss(bare) : live;
      if (live.x < 0 || live.y < 0 || live.x > rect.width || live.y > rect.height) offCanvasAuth++;
      if (Math.hypot(live.x - tru.x, live.y - tru.y) > 4 && view.offsets?.[p.fixKey]) {
        const ll = sample(live.x, live.y);
        const lt = sample(tru.x, tru.y);
        if (ll && ll.lum > 80) liveBright++;
        if (lt && lt.lum >= 55 && lt.lum <= 85) staleBezel++;
        offsetMismatches.push({
          fixKey: p.fixKey, gi: p.gi,
          live, true: tru, sep: Math.hypot(live.x - tru.x, live.y - tru.y),
          lumLive: ll?.lum, lumTrue: lt?.lum,
        });
      }
    }
    for (const p of paneCss) {
      if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) offCanvasPane++;
    }

    // Cluster detection: find bright pixels outside expected auth bounds
    const authBounds = authCss.reduce((b, p) => ({
      minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
      minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const foreignClusters = [];
    const step = 8;
    for (let y = 0; y < rect.height; y += step) {
      for (let x = 0; x < rect.width; x += step) {
        const s = sample(x, y);
        if (!s || s.lum < 100) continue;
        const nearAuth = authCss.some((p) => Math.hypot(p.x - x, p.y - y) < 20);
        if (!nearAuth) foreignClusters.push({ x, y, lum: s.lum });
      }
    }

    const pmvCanvases = [...document.querySelectorAll('.pmv-canvas')];
    const allCanvases = [...document.querySelectorAll('canvas')];
    const webgl = allCanvases.filter((c) => !c.classList.contains('pmv-canvas'));

    // Count lit vs dark from authoritative positions
    let litAtAuth = 0;
    let darkBezelAtAuth = 0;
    for (const p of authCss) {
      const s = sample(p.x, p.y);
      if (!s) continue;
      if (s.lum > 80) litAtAuth++;
      else if (s.lum >= 40 && s.lum <= 75) darkBezelAtAuth++;
    }

    // Total mapped across all presets
    let totalMappedAllPresets = 0;
    for (const v of storeMod.store.views.views) {
      try {
        const rv = views.resolveView(v, storeMod.store.clusters, storeMod.store.list,
          { viewRegistry: storeMod.store.viewRegistry });
        for (const pan of rv.panels) {
          const px = layout.expandPanel(pan.def, pan.clusters, storeMod.store.list,
            layout.seedPanel(pan.def, pan.clusters, storeMod.store.list, 900, 520, pan.styles),
            pan.styles, v.offsets || {});
          totalMappedAllPresets += px.length;
        }
      } catch (_) { /* skip broken views */ }
    }

    return {
      url: location.href,
      mode: storeMod.store.mode.value,
      fixtureCount: storeMod.store.fixtureCount.value,
      pixelCount: storeMod.store.pixelCount.value,
      totalMappedAllPresets,
      authoritativeCount: authoritative.length,
      panePixelCount: panePixels.length,
      idsMatch,
      paneGiMatchAuth: paneGiSet.size === authGiSet.size
        && [...paneGiSet].every((g) => authGiSet.has(g)),
      framing,
      transform: xf,
      canvas: {
        cssW: rect.width, cssH: rect.height,
        backingW: canvas.width, backingH: canvas.height, dpr,
      },
      canvases: { pmv: pmvCanvases.length, total: allCanvases.length,
        webglVisible: webgl.some((c) => getComputedStyle(c).display !== 'none') },
      painters: frameMod._painterCount(),
      epoch: { geom: pane._geomEpoch, static: pane._staticEpoch, match: pane._staticEpoch === pane._geomEpoch },
      offsetCount: Object.keys(view.offsets || {}).length,
      offCanvasAuth, offCanvasPane,
      staleBezel, liveBright, litAtAuth, darkBezelAtAuth,
      authBounds,
      foreignClusterCount: foreignClusters.length,
      foreignClusters: foreignClusters.slice(0, 20),
      offsetMismatches: offsetMismatches.slice(0, 10),
      staticCanvas: pane.static ? { w: pane.static.width, h: pane.static.height } : null,
    };
  }, ORIGIN);

  return { label, shotPath, diag };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sidecar = path.join(REPO, 'simulation/scenes/titanic/pixel_map_views.yaml');
  const offsetInfo = countOffsets(sidecar);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: vpW, height: vpH });

  const bare = await probePage(page, BARE_URL, 'bare');
  const edit = await probePage(page, EDIT_URL, 'edit');

  const report = {
    viewport: `${vpW}x${vpH}`,
    sidecarOffsets: offsetInfo,
    bare: bare.diag,
    edit: edit.diag,
    screenshots: { bare: bare.shotPath, edit: edit.shotPath },
  };

  const outPath = path.join(OUT, `pixel_map_geometry_probe_${vpW}x${vpH}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
