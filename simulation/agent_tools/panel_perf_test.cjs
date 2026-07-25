/**
 * panel_perf_test.cjs — Measures the Controller-Mapping panel's per-interaction
 * latency (G2, feat/bm_readiness Slice 3).
 *
 * WHY: on every 3D-click selection the panel used to tear down and rebuild its
 * ENTIRE #cm-body DOM and recompute the DMX+LED projections 3–4× — 16–38 ms per
 * selection on a fully-patched titanic, the lag the operator feels while
 * clicking fixtures. This probe times exactly that hot path:
 *   window.refreshControllerMapPanel()   ← fired by interaction.js on every pick
 * with a fully-patched rig and the panel open. Run it BEFORE and AFTER the
 * incremental-render change with identical methodology; the headline number is
 * the median refresh cost.
 *
 * It also times one genuine selection round-trip (mutate selectedFixtureIndices
 * → refresh) so the "click a fixture" cost is measured end to end, and confirms
 * the selected chip ends up highlighted (correctness, not just speed).
 *
 * Usage:  node panel_perf_test.cjs [--iters N]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');

const SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=pixel_mapping&renderer=webgl';
const VIEWPORT = { width: 1280, height: 720 };
const WINDOW_SIZE = { width: VIEWPORT.width + 192, height: VIEWPORT.height + 108 };
const ITERS = process.argv.includes('--iters')
  ? parseInt(process.argv[process.argv.indexOf('--iters') + 1], 10) : 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  return puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${WINDOW_SIZE.width},${WINDOW_SIZE.height}`,
    ],
  });
}

async function loadSim(page) {
  page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered — continuing'));
  await page.waitForFunction(
    () => window.parFixtures && window.parFixtures.length > 0
      && typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 30000 });
  await sleep(3500);
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { min: s[0], median: q(0.5), mean, p95: q(0.95), max: s[s.length - 1] };
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(2)}ms`).join(' · ');

async function main() {
  const browser = await launch();
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport(VIEWPORT);
  console.log(`Loading ${SIM_URL}`);
  await loadSim(page);

  // Open the mapping panel and patch the WHOLE rig (Test Auto-Patch) so the DOM
  // + projections are at operator scale (84 DMX pars + strands, real controllers).
  await page.evaluate(() => {
    const panel = document.getElementById('controller-map-panel');
    if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
  });
  await sleep(600);
  const patched = await page.evaluate(() => {
    const btn = document.querySelector('.cm-test-autopatch');
    if (!btn) return 'no-autopatch-btn';
    btn.click();
    return 'clicked';
  });
  console.log(`Test Auto-Patch: ${patched}`);
  await sleep(1200);

  const domSize = await page.evaluate(() => {
    const body = document.getElementById('cm-body');
    return {
      cmNodes: body ? body.querySelectorAll('*').length : -1,
      chips: body ? body.querySelectorAll('.cm-chip').length : -1,
    };
  });
  console.log(`Panel DOM: ${domSize.cmNodes} nodes, ${domSize.chips} chips`);

  // ── Measure the selection hot path ──
  const result = await page.evaluate(async (iters) => {
    const st = await import('/simulation/src/core/state.js');
    const sel = st.selectedFixtureIndices;
    const fixtures = window.parFixtures || [];
    // Pick a mapped fixture we can toggle.
    const pickIdx = fixtures.findIndex((f) => f && f.hitbox);
    // The hook interaction.js fires on a 3D pick: the light selection-sync after
    // Slice 3, the full refresh before it. Measuring the same call both times
    // keeps before/after apples-to-apples.
    const refresh = window.syncControllerMapSelection || window.refreshControllerMapPanel;

    // Warm up.
    for (let i = 0; i < 5; i++) refresh();

    // Time N bare refresh() calls with a stable selection.
    sel.clear(); sel.add(pickIdx >= 0 ? pickIdx : 0);
    const bare = [];
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      refresh();
      bare.push(performance.now() - t0);
    }

    // Time N genuine selection round-trips (toggle selection → refresh), the
    // real "click a different fixture" cost.
    const roundTrip = [];
    for (let i = 0; i < iters; i++) {
      const idx = fixtures.length ? (i % fixtures.length) : 0;
      const t0 = performance.now();
      sel.clear();
      sel.add(idx);
      refresh();
      roundTrip.push(performance.now() - t0);
    }

    // Correctness: after selecting the pickIdx fixture, is its chip highlighted?
    sel.clear();
    if (pickIdx >= 0) sel.add(pickIdx);
    refresh();
    const name = pickIdx >= 0 && fixtures[pickIdx].config ? fixtures[pickIdx].config.name : null;
    const body = document.getElementById('cm-body');
    const selectedChips = body ? body.querySelectorAll('.cm-chip.cm-chip-selected').length : -1;

    return { bare, roundTrip, name, selectedChips };
  }, ITERS);

  console.log(`\n── refresh() bare (${ITERS}×) ──\n   ${fmt(stats(result.bare))}`);
  console.log(`── selection round-trip (${ITERS}×) ──\n   ${fmt(stats(result.roundTrip))}`);
  console.log(`\nselected fixture "${result.name}" → ${result.selectedChips} chip(s) marked cm-chip-selected`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
