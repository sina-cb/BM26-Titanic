/**
 * split_capture.cjs — Screenshots of the split-screen mapping layout
 * (feat/bm_readiness, Slice 2). agent_render.cjs can't open the mapping pane
 * or drive the split, so this dedicated (repeatable) tool does.
 *
 * Captures, per viewport class, the divider at its default position, dragged,
 * and each side maximized. Output: ../../.agent_renders/split_*.png
 *
 * Usage:  node split_capture.cjs [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=pixel_mapping&renderer=webgl';
const OUTPUT_DIR = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP_ALIVE = process.argv.includes('--keep-alive');

// Two viewport classes: laptop (single-column map) and wide/27" (multi-column).
const CLASSES = [
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'wide', width: 2560, height: 1440 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(vp) {
  return puppeteer.launch({
    headless: false,
    defaultViewport: vp,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${vp.width + 40},${vp.height + 120}`,
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
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered'));
  await page.waitForFunction(
    () => typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 30000 });
  await sleep(4000);
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const out = path.join(OUTPUT_DIR, `split_${name}_${ts}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
}

async function main() {
  for (const cls of CLASSES) {
    console.log(`\n══ ${cls.name} ${cls.width}x${cls.height} ══`);
    const browser = await launch(cls);
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    await page.setViewport({ width: cls.width, height: cls.height });
    await loadSim(page);

    // Frame the ship, then open the mapping pane (engages the split).
    await page.evaluate(() => { if (window.animateCamera) window.animateCamera('front'); });
    await sleep(2500);
    const state = await page.evaluate(() => {
      const panel = document.getElementById('controller-map-panel');
      if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
      return window.__splitLayout.getState();
    });
    console.log(`   split engaged: mode=${state.mode} ratio=${state.ratio.toFixed(2)} simW=${state.simW} mapW=${state.mapW}`);
    await sleep(1500);
    await shot(page, `${cls.name}_default`);

    // Divider dragged wider (more map).
    await page.evaluate(() => window.__splitLayout.setRatio(0.5));
    await sleep(1200);
    await shot(page, `${cls.name}_dragged`);

    // Maximize the sim (map slides to an edge tab).
    await page.evaluate(() => window.__splitLayout.setMode('simMax'));
    await sleep(1200);
    await shot(page, `${cls.name}_sim_max`);

    // Maximize the map (canvas hidden).
    await page.evaluate(() => window.__splitLayout.setMode('mapMax'));
    await sleep(1200);
    await shot(page, `${cls.name}_map_max`);

    // Back to split for a clean final frame.
    await page.evaluate(() => window.__splitLayout.setMode('split'));
    await sleep(800);

    if (KEEP_ALIVE && cls === CLASSES[CLASSES.length - 1]) {
      console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
      await new Promise(() => {});
    }
    await browser.close();
  }
  console.log('\ndone.');
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
