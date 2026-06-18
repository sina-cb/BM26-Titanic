/**
 * capture_seq.cjs — frame-burst capturer for short BM26 Titanic sim clips.
 *
 * Companion to agent_render.cjs (single still). Reuses the same headed-Chromium
 * + SwiftShader flags and the sim load / UI-hide / view-navigation logic, but
 * instead of one screenshot it captures a BURST of N frames into a directory as
 * f_0000.png, f_0001.png, … — which ffmpeg then stitches into an MP4/GIF.
 * See .agent/01_skills/09_capture_sim_video.md.
 *
 * Usage (run from simulation/agent_tools/; wrap in `xvfb-run -a` if headless):
 *   node capture_seq.cjs --view dramatic --frames 24 --interval 0 \
 *       --viewport 640x360 --url "<full sim url>" --out ~/tmp/vid/frames
 *
 * Flags:
 *   --view <key>     Camera preset from scenes/<scene>/cameras.yaml (omit = current view)
 *   --frames N       Number of frames to capture (default 24)
 *   --interval MS    Extra delay between frames (default 0; screenshot cost dominates)
 *   --viewport WxH   Resolution (default 854x480; lower = faster per frame)
 *   --url <url>      Full sim URL (default titanic/full/webgl)
 *   --out <dir>      Frame output dir (wiped + recreated each run; keep under ~/tmp/)
 *
 * Dev-only preview tool (like agent_render.cjs) — NOT part of the deployed playa
 * stack, so the codex offline-readiness rules don't apply here.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

function flag(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}
function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const DEFAULT_SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl';
const SIM_URL = (() => {
  const v = flag('url', DEFAULT_SIM_URL);
  if (!/^https?:\/\//.test(v)) { console.error('❌ Invalid --url, expected a full http(s) URL.'); process.exit(1); }
  return v;
})();
const VIEW = flag('view', null);
const FRAMES = parseInt(flag('frames', '24'), 10);
const INTERVAL = parseInt(flag('interval', '0'), 10);
const VIEWPORT = (() => {
  const m = /^(\d+)x(\d+)$/.exec(flag('viewport', '854x480'));
  if (!m) { console.error('❌ Invalid --viewport, expected WxH (e.g. 640x360).'); process.exit(1); }
  return { width: Number(m[1]), height: Number(m[2]) };
})();
const OUT_DIR = expandHome(flag('out', path.join(os.homedir(), 'tmp', 'vid', 'frames')));
const WINDOW_SIZE = { width: VIEWPORT.width + 192, height: VIEWPORT.height + 108 };
const CAMERA_SETTLE_MS = 3000;

const UI_PANEL_IDS = [
  'hud-frame', 'info-panel', 'pattern-editor-panel', 'sacn-in-monitor-panel',
  'sacn-out-monitor-panel', 'view-presets', 'gui-panel', 'unpatched-warning',
];

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--ignore-gpu-blocklist', '--enable-gpu', '--enable-webgl', '--enable-webgl2',
      '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${WINDOW_SIZE.width},${WINDOW_SIZE.height}`,
    ],
  });
}

async function loadSimulation(page) {
  page.on('pageerror', err => console.error(`  [page error] ${err.message}`));
  console.log(`📡 Navigating to ${SIM_URL}`);
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  const webglOk = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  });
  console.log(`🖥️  WebGL status: ${webglOk ? '✅ Working' : '❌ Failed'}`);
  console.log('⏳ Waiting for simulation to finish loading...');
  try {
    await page.waitForFunction(() => {
      const overlay = document.getElementById('loading-overlay');
      if (!overlay) return true;
      const s = window.getComputedStyle(overlay);
      return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
    }, { timeout: 90000 });
    console.log('✅ Loading complete.');
  } catch (e) {
    console.warn('⚠️  Loading overlay did not disappear in 90s, continuing anyway...');
  }
  console.log('🎨 Waiting for render to settle...');
  await new Promise(r => setTimeout(r, 5000));
}

async function hideUI(page) {
  await page.evaluate((ids) => {
    for (const id of ids) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = 'none'; });
  }, UI_PANEL_IDS);
}

async function clickView(page, viewName) {
  const ok = await page.evaluate((vn) => {
    if (typeof window.animateCamera === 'function') { window.animateCamera(vn); return true; }
    return false;
  }, viewName);
  if (!ok) { console.warn(`   ⚠️ View preset "${viewName}" not found or API missing.`); return false; }
  await new Promise(r => setTimeout(r, CAMERA_SETTLE_MS));
  return true;
}

async function main() {
  // Wipe + recreate the output dir so old frames never leak into the encode.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  const browser = await launchBrowser();
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport(VIEWPORT);

  try {
    await loadSimulation(page);
  } catch (e) {
    console.error(`❌ Failed to load simulation: ${e.message}`);
    await browser.close();
    process.exit(1);
  }

  await hideUI(page);
  if (VIEW) {
    console.log(`🎥 Navigating to "${VIEW}"...`);
    await clickView(page, VIEW);
  }

  console.log(`📸 Capturing ${FRAMES} frames → ${OUT_DIR}`);
  for (let i = 0; i < FRAMES; i++) {
    const name = `f_${String(i).padStart(4, '0')}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, name), type: 'png' });
    if ((i + 1) % 8 === 0 || i === FRAMES - 1) console.log(`   ${i + 1}/${FRAMES}`);
    if (INTERVAL > 0) await new Promise(r => setTimeout(r, INTERVAL));
  }

  await browser.close();
  console.log(`\n🎉 Done. ${FRAMES} frames in ${OUT_DIR} (encode with ffmpeg — see skill 09).`);
}

main().catch(err => { console.error('❌ Fatal error:', err); process.exit(1); });
