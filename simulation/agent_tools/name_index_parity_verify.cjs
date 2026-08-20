/**
 * name_index_parity_verify.cjs — live proof for the NAME/INDEX PARITY fixes of
 * report 20260725_46 (slice 3 of the 20260725_44 plan). Renderer-only
 * (see_the_world skill): launches its OWN Chromium against the ALREADY-RUNNING
 * stack on :6969 and NEVER starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same as chain_order_viz_verify):
 * (1) params.autoSave = false, (2) window.debounceAutoSave stubbed, (3) EVERY
 * request to the save server (:6970) aborted at the network layer. A pristine
 * deep-clone of params.{parLights,pixelMapViews} is captured at start and
 * restored at exit. Browser closed on exit; the operator's own browser is
 * never touched.
 *
 * Proves, on the REAL titanic scene:
 *   LANES    — the 2D Pixel Map 'lanes' layout stacks a 12-light group in
 *              CHAIN order 1..12, not the lexicographic 1,10,11,12,2,3,…
 *              that `localeCompare` gave before (report 20260725_44 §2, D1).
 *              The live scene's biggest group is 8 lights, so the probe adds a
 *              synthetic 12-light group (restored at exit) — ten is where the
 *              bug starts.
 *   CHIMNEYS — the default Top-Down view resolves BOTH chimney par rings,
 *              including the operator's renamed 'Right SmokeStacks'. His
 *              rename had silently dropped that ring out of the view because
 *              `pixel_map_view_defaults.js` still named the old group; this
 *              asserts the new name resolves to real clusters AND that the old
 *              name resolves to none (i.e. the re-point was necessary).
 *
 * Usage:  node name_index_parity_verify.cjs [--keep-alive]
 * Screenshots: ~/tmp/name_index_parity/
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGIN = 'http://127.0.0.1:6969';
// `profile=2d_pixels` because `showPixelMap` refuses to show the map under any
// other lighting profile — the 2D map IS that profile's viewport. This probe
// browser is its own window; the operator's session is untouched.
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'name_index_parity');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ten is where lexicographic ordering breaks, so the probe group is 12.
const LANES_GROUP = 'ZZ Lanes Probe';
const LANES_COUNT = 12;
const OLD_RIGHT_CHIMNEY = 'Right Top Chimney Generator';

let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const p = path.join(OUT, `${String(shotIndex).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false, defaultViewport: VP, protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) {
      const s = getComputedStyle(o);
      if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false;
    }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0
      && typeof window.showPixelMap2d === 'function';
  }, { timeout: 90000 });
  await sleep(3000);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', async (d) => { await d.accept(); });

  // GUARD 3: abort every save-server request so nothing can write the scene.
  await page.setRequestInterception(true);
  let abortedSaves = 0;
  page.on('request', (req) => {
    if (/:6970(\/|$)/.test(req.url())) { abortedSaves += 1; req.abort(); return; }
    req.continue();
  });

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  // GUARDS 1+2 + pristine snapshot.
  const gpu = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__params.autoSave = false;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      pixelMapViews: clone(window.__params.pixelMapViews),
    };
    return window.__gpuAdapter || null;
  }, ORIGIN);
  // Ops rule 20260725_39: record the adapter next to every observation.
  console.log(`\n[gpu] ${JSON.stringify(gpu)}`);

  // ── CHIMNEYS: the default Top-Down view resolves BOTH rings ──────────────
  // Open the panel FIRST: `store.list` (the batch topology the 2D map draws
  // from) is filled by the data plane, which only starts with the panel.
  await page.evaluate(() => { window.showPixelMap2d(true); });
  await page.waitForFunction(async () => {
    const store = await import('/simulation/src/gui/pixel_map/pixel_map_store.js');
    return !!store.store.list && store.store.list.length > 0;
  }, { timeout: 60000 });
  await sleep(1500);

  const chimney = await page.evaluate(async (origin, oldName) => {
    const [defaults, layout, views, store] = await Promise.all([
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_view_defaults.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`),
    ]);
    // The REAL batch list + clusters the open 2D map is drawing from.
    const list = store.store.list;
    if (!list || !list.length) throw new Error('pixel map data plane has no topology');
    const clusters = store.store.clusters || layout.buildClusters(list);
    const topDown = defaults.DEFAULT_VIEWS.find((v) => v.id === 'top_down');
    const resolved = views.resolveView(topDown, clusters, list,
      { viewRegistry: store.store.viewRegistry });
    const main = resolved.panels[0];
    const countIn = (g) => main.clusters.filter((c) => c.group === g).length;
    return {
      groups: defaults.CHIMNEY_GROUPS,
      perGroup: defaults.CHIMNEY_GROUPS.map((g) => [g, countIn(g)]),
      // The name the defaults used to carry must now resolve to NOTHING —
      // that is what silently emptied the operator's right ring.
      oldNameInScene: clusters.filter((c) => c.group === oldName).length,
      panelClusters: main.clusters.length,
    };
  }, ORIGIN, OLD_RIGHT_CHIMNEY);
  console.log('\n[CHIMNEYS] default Top-Down resolves:',
    chimney.perGroup.map(([g, n]) => `'${g}' → ${n} clusters`).join('; '));
  console.log(`[CHIMNEYS] old name '${OLD_RIGHT_CHIMNEY}' exists in the scene: ` +
    `${chimney.oldNameInScene} clusters (0 = the re-point was required)`);
  const chimneyOk = chimney.perGroup.every(([, n]) => n > 0)
    && chimney.oldNameInScene === 0
    && chimney.panelClusters > 0;

  // The operator's ring, on screen, in the real panel.
  await shot(page, 'top_down_both_chimney_rings');

  // ── LANES: numeric-aware row order on a 12-light group ───────────────────
  // The live scene's largest group is 8 lights, so the ordering bug cannot be
  // reproduced on it. Add a synthetic 12-light group (restored at exit).
  const lanes = await page.evaluate(async (origin, group, count) => {
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    // A minimal batch list: one pixel per fixture, named exactly as
    // `emitInChainOrder` names generated fixtures.
    const list = [];
    for (let n = 1; n <= count; n++) {
      list.push({
        type: 'dmx', fixIndex: n - 1, fixKey: `${group} ${n}`, name: `${group} ${n}`,
        fixtureType: 'UkingPar', group, wx: n, wy: 0, wz: 0,
      });
    }
    const clusters = layout.buildClusters(list);
    const placements = layout.seedPanel({ layout: 'lanes' }, clusters, list, 900, 520, {});
    const topDown = [...placements.keys()]
      .sort((a, b) => placements.get(a).y - placements.get(b).y);
    return {
      rowOrder: topDown,
      numbers: topDown.map((k) => Number(k.slice(group.length + 1))),
    };
  }, ORIGIN, LANES_GROUP, LANES_COUNT);
  const expected = Array.from({ length: LANES_COUNT }, (_, i) => i + 1);
  const lanesOk = lanes.numbers.join(',') === expected.join(',');
  console.log(`\n[LANES] 12-light group row order top→bottom: ${lanes.numbers.join(', ')}`);
  console.log(`[LANES] lexicographic would give: 1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9`);

  // …and the same thing through the REAL panel, so it is on screen too.
  await page.evaluate(async (origin, group, count) => {
    const p = window.__params;
    // Synthetic par group, laid out along x so it is its own cluster set.
    for (let n = 1; n <= count; n++) {
      p.parLights.push({
        name: `${group} ${n}`, group, fixtureType: 'UkingPar',
        x: -30 + n * 1.5, y: 14, z: 26,
        rotationX: -90, rotationY: 0, rotationZ: 0,
        color: '#ffaa44', intensity: 8, angle: 30, enabled: true,
      });
    }
    if (window.rebuildParLights) window.rebuildParLights(true);
    if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('lanes_probe');
    // A temporary lanes view over just that group.
    // Re-point the view the open pane is ALREADY bound to at a lanes panel over
    // the probe group. Rebinding through the pane's own dropdown is not
    // available (the pane header renders the view name as text), and changing
    // the view definition exercises the same resolve → seedPanel → expandPanel
    // path the operator's own lanes view takes. Restored from the pristine
    // snapshot at exit.
    const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const bound = store.store.views.views[0];
    bound.label = `ZZ Lanes Probe (${count})`;
    bound.panels = [{
      id: 'main', label: group, select: [{ group }], layout: 'lanes', projection: 'top',
    }];
    bound.placements = {};
    // commitViews (not a bare viewsTick bump) is what fans the change to the
    // mounted multiview. Its save call is the stubbed debounceAutoSave, and
    // every :6970 request is aborted anyway.
    store.commitViews();
    return bound.id;
  }, ORIGIN, LANES_GROUP, LANES_COUNT);
  await sleep(2500);
  // What the pane is actually drawing now: one row per fixture, top→bottom.
  const bound = await page.evaluate(async (origin, group) => {
    const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
    const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
    const view = store.store.views.views[0];
    const resolved = views.resolveView(view, store.store.clusters, store.store.list,
      { viewRegistry: store.store.viewRegistry });
    const panel = resolved.panels[0];
    if (!panel.clusters.length) return 'lanes panel resolved to ZERO clusters';
    const placements = layout.seedPanel(panel.def, panel.clusters, store.store.list,
      900, 520, panel.styles);
    const order = [...placements.keys()]
      .sort((a, b) => placements.get(a).y - placements.get(b).y)
      .map((k) => Number(k.slice(group.length + 1)));
    return `rendering ${panel.clusters.length} lanes in order ${order.join(',')}`;
  }, ORIGIN, LANES_GROUP);
  console.log(`[LANES] open pane: ${bound}`);
  await sleep(2500);
  await shot(page, 'lanes_numeric_row_order');

  // ── Restore pristine (deterministic zero residue). ───────────────────────
  const residue = await page.evaluate(async (origin, group) => {
    const p = window.__params;
    const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
    p.parLights = clone(window.__pristine.parLights);
    if (window.__pristine.pixelMapViews === null) delete p.pixelMapViews;
    else p.pixelMapViews = clone(window.__pristine.pixelMapViews);
    if (window.rebuildParLights) window.rebuildParLights(true);
    if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('lanes_probe_restore');
    if (window.renderParGUI) window.renderParGUI();
    const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
    store.loadViewsFromParams();
    window.showPixelMap2d(false);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      parLightsMatch: eq(p.parLights, window.__pristine.parLights),
      noProbeGroup: !p.parLights.some((l) => l.group === group),
      noProbeView: !(store.store.views.views || []).some((v) => /ZZ Lanes Probe/.test(v.label || '')),
      viewsRestored: (store.store.views.views[0] || {}).id === 'top_down',
    };
  }, ORIGIN, LANES_GROUP);
  console.log('\n[restore]', JSON.stringify(residue));

  // ── Summary ──────────────────────────────────────────────────────────────
  const noise = errors.filter((e) =>
    /pixel_map|TypeError|is not a function/i.test(e));
  const results = {
    'default_top_down_resolves_BOTH_chimney_rings': chimneyOk,
    'lanes_rows_stack_in_numeric_order_1_to_12': lanesOk,
    'lanes_panel_renders_those_rows_on_screen':
      bound === `rendering ${LANES_COUNT} lanes in order ${expected.join(',')}`,
    'restore_zero_residue': residue.parLightsMatch && residue.noProbeGroup
      && residue.noProbeView && residue.viewsRestored,
    'no_unexpected_console_errors': noise.length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  console.log(`  (save-server requests aborted this run: ${abortedSaves})`);
  console.log(`  (gpu adapter: ${JSON.stringify(gpu)})`);
  if (noise.length) { console.log('  console errors:'); noise.slice(0, 15).forEach((e) => console.log('   •', e.slice(0, 200))); }
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Screenshots: ${OUT}`);

  if (!KEEP) await browser.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
