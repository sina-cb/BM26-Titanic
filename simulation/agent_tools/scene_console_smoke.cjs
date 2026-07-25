/**
 * scene_console_smoke.cjs — Loads a scene, opens the mapping split, and reports
 * every console error + page error over a short window. Verifies Slices 3+4
 * introduced no new console noise on titanic + test_bench.
 *
 * Usage:  node scene_console_smoke.cjs <scene>
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');

const SCENE = process.argv[2] || 'titanic';
const SIM_URL = `http://127.0.0.1:6969/simulation/?scene=${SCENE}&profile=pixel_mapping&renderer=webgl`;
const VIEWPORT = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      `--window-size=${VIEWPORT.width + 40},${VIEWPORT.height + 120}`,
    ],
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`Loading ${SIM_URL}`);
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered'));
  await page.waitForFunction(() => typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 30000 });
  await sleep(3000);

  // Exercise: open the map (engage split), auto-patch, select in 3D, close.
  await page.evaluate(() => { const p = document.getElementById('controller-map-panel'); if (p.classList.contains('hidden')) window.toggleControllerMapPanel(); });
  await sleep(800);
  await page.evaluate(() => { const b = document.querySelector('.cm-test-autopatch'); if (b) b.click(); });
  await sleep(1000);
  await page.evaluate(async () => {
    const st = await import('/simulation/src/core/state.js');
    st.selectedFixtureIndices.clear();
    if ((window.parFixtures || [])[0]) st.selectedFixtureIndices.add(0);
    if (window.syncControllerMapSelection) window.syncControllerMapSelection();
    const chip = document.querySelector('#cm-body .cm-chip[data-cm-fixture]');
    if (chip) chip.click();
  });
  await sleep(1200);
  await page.evaluate(() => { const p = document.getElementById('controller-map-panel'); if (!p.classList.contains('hidden')) window.toggleControllerMapPanel(); });
  await sleep(600);

  // Known-unrelated noise: the marsin_engine ws bridge (:6968) is not running.
  const filtered = errors.filter((e) => !/6968|WebSocket|ws:\/\//i.test(e));
  console.log(`\n── ${SCENE}: ${errors.length} error line(s), ${filtered.length} after dropping :6968 ws noise ──`);
  for (const e of filtered) console.log(`  ${e}`);
  if (filtered.length === 0) console.log('  ✅ no scene/mapping console errors');

  await browser.close();
  process.exit(0);
}
main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
