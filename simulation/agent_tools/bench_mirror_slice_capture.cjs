/**
 * bench_mirror_slice_capture.cjs — frame the titanic fixtures the bench stands
 * in for (report 20260725_89, `scenes/test_bench/bench_mirror.yaml`).
 *
 * WHAT IT PROVES
 * The stand-in map claims its seven source fixtures form ONE coherent region —
 * the ship's left front — so that a spatial pattern reads correctly when it is
 * replayed on a desk. This renders exactly that cluster (Left Front Wall 1-2,
 * Left Front Rails 1-2, Left Auditorium 5-8, Left_Front_Left, Left_Back_Left)
 * with everything else in frame for context, so the claim can be looked at
 * rather than asserted.
 *
 * The camera poses are read from the mirror spec's own source fixtures via the
 * generated model, so a re-aimed mirror re-aims the camera — the picture cannot
 * drift away from the map it illustrates.
 *
 * LIVE-SESSION SAFETY (the operator's stack owns 6969-6972 and the titanic
 * scene + its model export are operator-owned — this run must not write a byte)
 *   GUARD 1 — no sACN output, ever. `window.__readonlyMode` is installed as an
 *     ACCESSOR before any page script runs: the getter always returns true so
 *     animate.js never enables the prio-150 output client, and the setter
 *     swallows main.js's own assignment (a non-writable property would THROW in
 *     that strict-mode module and break the boot).
 *   GUARD 2 — the sACN-out bridge socket on :6972 is refused at the WebSocket
 *     constructor, belt-and-braces behind GUARD 1.
 *   GUARD 3 — every non-GET request to the save server on :6970 is ABORTED by
 *     request interception and counted. main.js calls `saveModelJS()` on boot,
 *     which would rewrite marsin_engine/models/titanic.js; here it never
 *     reaches the server. A non-zero count is reported, not hidden.
 *   GUARD 4 — nothing in the page is mutated except element `display`, restored
 *     when the browser closes. No GUI controller is touched, so nothing can
 *     reach debounceAutoSave.
 *
 * Usage (servers must already be running — never start them from here):
 *   node bench_mirror_slice_capture.cjs [--viewport 1280x720]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const yaml = require('js-yaml');

const SIM_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(SIM_ROOT, '..');
const ORIGIN = 'http://127.0.0.1:6969';
const SIM_URL = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(REPO_ROOT, '.agent_renders');

const UI_PANEL_IDS = [
  'hud-frame', 'info-panel', 'pattern-editor-panel', 'sacn-in-monitor-panel',
  'sacn-out-monitor-panel', 'view-presets', 'gui-panel', 'unpatched-warning',
  'pixel-map-panel',
];

const args = process.argv.slice(2);
function parseViewport() {
  const i = args.indexOf('--viewport');
  if (i === -1) return { width: 1280, height: 720 };
  const m = /^(\d+)x(\d+)$/.exec(args[i + 1] || '');
  if (!m) throw new Error(`--viewport expects WxH, got '${args[i + 1]}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
const VP = parseViewport();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The mirrored source fixtures, read from the live spec + the generated model,
 * with their world centroid — the camera target.
 */
function readMirroredCluster() {
  const { parseBenchMirrorSpec } = require('../lib/bench_mirror.cjs');
  const spec = parseBenchMirrorSpec(
    yaml.load(fs.readFileSync(path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml'), 'utf8')),
    'test_bench/bench_mirror.yaml');
  const wanted = new Set();
  for (const m of spec.mirrors) {
    for (const s of m.slices) {
      for (let a = s.sourceAddr; a < s.sourceAddr + s.length; a += 1) {
        wanted.add(`${s.sourceUniverse}/${a}`);
      }
    }
  }
  const src = fs.readFileSync(path.join(REPO_ROOT, 'marsin_engine', 'models', 'titanic.js'), 'utf8');
  const names = new Set();
  let sum = { x: 0, y: 0, z: 0, n: 0 };
  for (const line of src.split('\n')) {
    const patch = line.match(/patch: \{ universe: (\d+), addr: (\d+)/);
    const name = line.match(/name: '([^']+)'/);
    const pos = line.match(/ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+)/);
    if (!patch || !name || !pos) continue;
    if (!wanted.has(`${patch[1]}/${patch[2]}`)) continue;
    names.add(name[1].replace(/ - .*$/, ''));
    sum = { x: sum.x + Number(pos[1]), y: sum.y + Number(pos[2]), z: sum.z + Number(pos[3]), n: sum.n + 1 };
  }
  if (sum.n === 0) throw new Error('[bench_mirror_slice_capture] the mirror map matched no model pixel');
  return {
    names: [...names].sort(),
    pixels: sum.n,
    target: { x: sum.x / sum.n, y: sum.y / sum.n, z: sum.z / sum.n },
  };
}

async function installGuards(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, '__readonlyMode', {
      get: () => true,
      set: () => {},
      configurable: true,
    });
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function GuardedWebSocket(url, protocols) {
      if (typeof url === 'string' && /:6972(\/|$)/.test(url)) {
        throw new Error('[bench_mirror_slice_capture] blocked: sACN OUT bridge socket (:6972)');
      }
      return new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  });
}

async function hideUI(page) {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = 'none'; });
    document.querySelectorAll('body > *').forEach((el) => {
      if (el.tagName === 'CANVAS' || el.id === 'loading-overlay') return;
      const s = window.getComputedStyle(el);
      if (s.position === 'fixed' || s.position === 'absolute') el.style.display = 'none';
    });
  }, UI_PANEL_IDS);
}

async function main() {
  const cluster = readMirroredCluster();
  console.log(`🪞 mirrored source fixtures (${cluster.pixels} px): ${cluster.names.join(', ')}`);
  console.log(`   centroid: (${cluster.target.x.toFixed(1)}, ${cluster.target.y.toFixed(1)}, ` +
    `${cluster.target.z.toFixed(1)})`);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-webgl', '--enable-webgl2',
      `--window-size=${VP.width},${VP.height}`],
    defaultViewport: VP,
  });
  let blockedWrites = 0;
  try {
    const page = await browser.newPage();
    await installGuards(page);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.method() !== 'GET' && req.url().includes(':6970')) {
        blockedWrites += 1;
        console.log(`🛑 GUARD 3 blocked ${req.method()} ${req.url()}`);
        req.abort();
        return;
      }
      req.continue();
    });

    console.log(`📡 ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    // Same acceptance as agent_render.cjs — the overlay is faded out, not
    // removed, so `style.display` alone never becomes 'none'.
    await page.waitForFunction(
      () => {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return true;
        const s = window.getComputedStyle(overlay);
        return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
      },
      { timeout: 120000 });
    await sleep(6000);
    const adapter = await page.evaluate(() => window.__gpuAdapter || null);
    console.log(`🖥  GPU adapter: ${JSON.stringify(adapter)}`);
    await hideUI(page);

    // Two poses, both derived from the cluster centroid: a wide plate showing
    // where the slice sits on the ship, and a close plate on the cluster itself.
    const t = cluster.target;
    const poses = [
      { label: 'bench_mirror_slice_wide', cam: { x: t.x - 34, y: t.y + 16, z: t.z + 34 } },
      { label: 'bench_mirror_slice_close', cam: { x: t.x - 15, y: t.y + 5, z: t.z + 15 } },
    ];
    for (const pose of poses) {
      await page.evaluate((p, target) => {
        if (typeof window.animateCameraToPose !== 'function') {
          throw new Error('window.animateCameraToPose is missing — cannot frame the cluster');
        }
        window.animateCameraToPose(p, target);
      }, pose.cam, t);
      await sleep(4000);
      await hideUI(page);
      const file = path.join(OUT, `${Math.floor(Date.now() / 1000)}_${pose.label}.png`);
      await page.screenshot({ path: file });
      console.log(`📸 ${file}`);
    }
    const guardHeld = await page.evaluate(() => window.__readonlyMode === true);
    console.log(`🔒 GUARD 1 held: ${guardHeld} · GUARD 3 blocked ${blockedWrites} write(s) to :6970`);
    if (!guardHeld) throw new Error('readonly guard did not hold — the page may have driven hardware');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
