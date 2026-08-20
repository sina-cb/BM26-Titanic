/**
 * pixel_map_perf_test.cjs — per-frame draw-cost probe for the 2D Pixel Map
 * multiview pane painter (design §3 perf budget, slice S3).
 *
 * WHY: the operator tunes patterns against the big model in this vis, so N live
 * panes must stay inside a 60 FPS budget (vis adds ≤ 4 ms/frame on real GPU).
 * This tool measures the ACTUAL per-frame hot path — `PixelMapPaneView.paint()`
 * fed by a shared color buffer — for 1 / 2 / 4 / 6 panes on a full-titanic-sized
 * pixel set (~1200 px), exactly the frame-source → pane-painter contract (§5).
 * It does NOT need S1/S2/S4: a mock frame source drives synthetic geometry +
 * an animated color buffer through the real pane painter.
 *
 * Gates:
 *   - relative (SwiftShader-safe, the enforced one): 6-pane per-pane average
 *     draw cost must stay ≤ 1.5× the single-pane cost — i.e. adding panes stays
 *     ~linear, no superlinear blowup. Exit 1 on regression.
 *   - absolute (reported, authoritative on real GPU at S4 integration): total
 *     vis ms/frame at 6 panes vs the ≤ 4 ms budget.
 *
 * Usage:  node pixel_map_perf_test.cjs [--frames N] [--pixels N]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');

const ORIGIN = 'http://127.0.0.1:6969';
const BOOT_URL = `${ORIGIN}/`;   // confirmed 200 same-origin page (real http origin)
const MODULE_URL = `${ORIGIN}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`;
const VIEWPORT = { width: 1280, height: 720 };
const FRAMES = argN('--frames', 150);
const PIXELS = argN('--pixels', 1200);
const PANE_COUNTS = [1, 2, 4, 6];
const REL_LIMIT = 1.5;    // 6-pane per-pane cost must be ≤ this × single-pane
const ABS_BUDGET_MS = 4;  // design §3 vis add budget (real-GPU target)

function argN(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : dflt;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">${JSON.stringify({ imports: {} })}</script>
<style>html,body{margin:0;background:#070910}#grid{display:grid;gap:2px;width:100vw;height:100vh}
canvas{width:100%;height:100%;display:block;background:#0b0d12}</style>
</head><body><div id="grid"></div>
<script type="module">
import { PixelMapPaneView } from '${MODULE_URL}';

const DESIGN = { w: 900, h: 520 };
const N = ${PIXELS};
const COLS = 44;
const pixels = [];
for (let i = 0; i < N; i++) {
  pixels.push({
    gi: i,
    cx: (i % COLS) * 20 + 12,
    cy: Math.floor(i / COLS) * 16 + 12,
    sizeX: 12, sizeY: 12,
    shape: (i % 7 === 0) ? 'circle' : 'square',
    rot: 0,
    fixKey: 'F' + Math.floor(i / 14),
  });
}
const list = pixels.map((p) => ({ name: p.fixKey }));
const colorBuf = new Float32Array(3 * N);

let panes = [];
function build(n) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
  panes = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    grid.appendChild(c);
    const pv = new PixelMapPaneView();
    pv.attach(c);
    pv.setPanels([{ id: 'main', label: 'main', design: DESIGN, weight: 1, pixels }]);
    pv.resize();
    panes.push(pv);
  }
}

function animate(t) {
  for (let i = 0; i < N; i++) {
    const ph = t * 0.003 + i * 0.05;
    colorBuf[3 * i] = 0.5 + 0.5 * Math.sin(ph);
    colorBuf[3 * i + 1] = 0.5 + 0.5 * Math.sin(ph + 2.1);
    colorBuf[3 * i + 2] = 0.5 + 0.5 * Math.sin(ph + 4.2);
  }
}

function measure(frames) {
  return new Promise((resolve) => {
    const draws = [];
    let f = 0;
    const t0 = performance.now();
    function tick(now) {
      animate(now);
      const d0 = performance.now();
      for (const pv of panes) pv.paint(colorBuf, list, 1);
      draws.push(performance.now() - d0);
      if (++f < frames) requestAnimationFrame(tick);
      else {
        const wall = performance.now() - t0;
        draws.sort((a, b) => a - b);
        const median = draws[Math.floor(draws.length / 2)];
        const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
        resolve({ frames, panes: panes.length, wallMs: wall,
          fps: (frames / wall) * 1000, drawMedianMs: median, drawMeanMs: mean });
      }
    }
    requestAnimationFrame(tick);
  });
}

window.__pmvPerf = { build, measure };
window.__pmvReady = true;
</script></body></html>`;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${VIEWPORT.width + 40},${VIEWPORT.height + 120}`,
    ],
  });
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport(VIEWPORT);
  page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`  [console] ${m.text()}`); });

  await page.goto(BOOT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.setContent(harnessHtml(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__pmvReady === true, { timeout: 20000 });

  console.log(`\n2D Pixel Map multiview — pane painter perf (${PIXELS}px, ${FRAMES} frames/pass)\n`);
  const results = {};
  for (const n of PANE_COUNTS) {
    await page.evaluate((c) => window.__pmvPerf.build(c), n);
    await sleep(300);
    await page.evaluate((f) => window.__pmvPerf.measure(Math.min(20, f)), FRAMES); // warm-up
    const r = await page.evaluate((f) => window.__pmvPerf.measure(f), FRAMES);
    results[n] = r;
    const perPane = r.drawMedianMs / n;
    console.log(`  ${n} pane(s): ${r.fps.toFixed(1)} FPS · draw median ${r.drawMedianMs.toFixed(2)}ms `
      + `(mean ${r.drawMeanMs.toFixed(2)}ms) · per-pane ${perPane.toFixed(2)}ms`);
  }

  const single = results[1].drawMedianMs / 1;
  const six = results[6].drawMedianMs / 6;
  const ratio = six / single;
  const totalSix = results[6].drawMedianMs;
  console.log('\n── gates ──');
  console.log(`  relative (enforced): 6-pane per-pane ${six.toFixed(2)}ms vs single ${single.toFixed(2)}ms `
    + `→ ${ratio.toFixed(2)}× (limit ${REL_LIMIT}×)`);
  console.log(`  absolute (real-GPU target, reported): 6-pane total vis ${totalSix.toFixed(2)}ms vs `
    + `${ABS_BUDGET_MS}ms budget  [SwiftShader here is software-rendered — not authoritative]`);

  const pass = ratio <= REL_LIMIT;
  console.log(`\n  ${pass ? 'PASS' : 'FAIL'} — per-pane cost stays ${pass ? 'linear' : 'SUPERLINEAR'}\n`);

  await browser.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
