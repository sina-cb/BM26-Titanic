/**
 * pixel_map_capture.cjs — repeatable screenshots of the 2D Pixel Map multiview
 * shell (slice S3). Mounts the REAL Preact multiview panel
 * (pixel_map_multiview_panel.js) with a MOCK data plane (synthetic clusters +
 * animated color buffer) so the pane grid, headers, view-binding dropdowns,
 * draggable dividers, tmux zoom, and the loud error-banner state can all be
 * captured before S1/S2/S4 wire the real frame source. Output prefix s3_*.
 *
 * The harness runs on the dev-server origin (same-origin module + vendor
 * resolution via an import map pointing at the vendored preact/htm builds), so
 * no served harness file is added to the tree.
 *
 * Usage:  node pixel_map_capture.cjs [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
// A confirmed 200 same-origin page so setContent inherits a real http origin
// (needed for localStorage — a 404 goto yields an opaque origin that blocks it).
const BOOT_URL = `${ORIGIN}/`;
const SIM = `${ORIGIN}/simulation`;
const OUTPUT_DIR = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP_ALIVE = process.argv.includes('--keep-alive');
const VIEWPORT = { width: 1440, height: 810 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMPORTMAP = {
  imports: {
    preact: `${SIM}/vendor/preact/preact.mjs`,
    'preact/hooks': `${SIM}/vendor/preact/hooks.mjs`,
    htm: `${SIM}/vendor/htm/htm.mjs`,
    'htm/preact': `${SIM}/vendor/htm/htm_preact.mjs`,
    '@preact/signals': `${SIM}/vendor/preact_signals/signals.mjs`,
  },
};

function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">${JSON.stringify(IMPORTMAP)}</script>
<style>html,body{margin:0;height:100%;background:#070910}
#host{position:absolute;inset:0}</style>
</head><body><div id="host"></div>
<script type="module">
import { mountPixelMapMultiview } from '${SIM}/src/gui/modern/pixel_map_multiview_panel.js';
import { createState, splitPane, bindView, saveLayout, clearLayout }
  from '${SIM}/src/gui/pixel_map/pixel_map_pane_tree.js';

const DESIGN = { w: 900, h: 520 };
const N = 1200, COLS = 44;
const pixels = [];
for (let i = 0; i < N; i++) {
  pixels.push({ gi: i, cx: (i % COLS) * 20 + 12, cy: Math.floor(i / COLS) * 16 + 12,
    sizeX: 12, sizeY: 12, shape: (i % 7 === 0) ? 'circle' : 'square', rot: 0,
    fixKey: 'F' + Math.floor(i / 14) });
}
const list = pixels.map((p) => ({ name: p.fixKey }));
const colorBuf = new Float32Array(3 * N);
function animate(t) {
  for (let i = 0; i < N; i++) {
    const ph = t * 0.002 + i * 0.05;
    colorBuf[3 * i] = 0.5 + 0.5 * Math.sin(ph);
    colorBuf[3 * i + 1] = 0.5 + 0.5 * Math.sin(ph + 2.1);
    colorBuf[3 * i + 2] = 0.5 + 0.5 * Math.sin(ph + 4.2);
  }
}

const VIEWS = [
  { id: 'top_down', label: 'Top-Down', panels: [ { id: 'main', weight: 3 }, { id: 'stacks', label: 'Smoke Stacks', weight: 1 } ] },
  { id: 'front', label: 'Front', panels: [ { id: 'main', weight: 1 } ] },
  { id: 'strands', label: 'Strands', panels: [ { id: 'main', weight: 1 } ] },
  { id: 'te_sign', label: 'TE Sign', panels: [ { id: 'main', weight: 1 } ] },
  { id: 'broken', label: 'Broken (demo)', panels: [ { id: 'main', weight: 1 } ] },
];
const painters = [];
let topoFn = null;

const deps = {
  scene: 'harness',
  listViews: () => VIEWS.map((v) => ({ id: v.id, label: v.label })),
  getViewDef: (id) => VIEWS.find((v) => v.id === id) || null,
  resolveView: (viewDef, clusters, l) => {
    if (viewDef.id === 'broken') throw new Error("unknown selector key 'colour'");
    return { panels: viewDef.panels.map((def) => ({ def, clusters, placements: new Map(), styles: {} })) };
  },
  seedPanel: () => new Map(),
  expandPanel: (def) => (def.id === 'stacks' ? pixels.slice(0, 240) : pixels),
  onTopology: (fn) => { topoFn = fn; setTimeout(() => fn([], list, 1), 0); return () => { topoFn = null; }; },
  registerPanePainter: (fn) => { painters.push(fn); return () => { const i = painters.indexOf(fn); if (i >= 0) painters.splice(i, 1); }; },
  currentTopology: () => ({ clusters: [], list, version: 1 }),
  canvasSize: () => DESIGN,
};

function loop(t) { animate(t); for (const fn of painters) fn(colorBuf, list, 1); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

let unmount = null;
function mount(state) {
  if (unmount) unmount();
  clearLayout('harness');
  if (state) saveLayout('harness', state);
  const host = document.getElementById('host');
  host.innerHTML = '';
  unmount = mountPixelMapMultiview(host, deps);
}

window.__pmv = {
  single: () => mount(createState('top_down')),
  quad: () => {
    let s = createState('top_down');
    s = splitPane(s, '', 'v');            // a | b
    s = splitPane(s, 'a', 'h');           // aa/ab | b
    s = splitPane(s, 'b', 'h');           // aa/ab | ba/bb
    s = bindView(s, 'front', 'ab');
    s = bindView(s, 'strands', 'ba');
    s = bindView(s, 'te_sign', 'bb');
    s = { ...s, focus: 'aa' };
    mount(s);
  },
  errorState: () => { let s = splitPane(createState('front'), '', 'v'); s = bindView(s, 'broken', 'b'); mount(s); },
};
window.__pmvReady = true;
</script></body></html>`;
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const out = path.join(OUTPUT_DIR, `s3_${name}_${ts}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
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

  console.log('\n2D Pixel Map multiview — shell captures (mock data plane)\n');
  await page.evaluate(() => window.__pmv.single());
  await sleep(900);
  await shot(page, 'multiview_single');

  await page.evaluate(() => window.__pmv.quad());
  await sleep(1100);
  await shot(page, 'multiview_4pane');

  await page.evaluate(() => window.__pmv.errorState());
  await sleep(900);
  await shot(page, 'multiview_error_banner');

  if (KEEP_ALIVE) {
    console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
    await new Promise(() => {});
  }
  await browser.close();
  console.log('\ndone.');
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
