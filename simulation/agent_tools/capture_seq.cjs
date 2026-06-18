/*
 * capture_seq.cjs — capture a burst of frames from the running sim for video.
 * Reuses the same SwiftShader-safe Chrome flags and load/hide logic as
 * agent_render.cjs. Run from simulation/agent_tools/ so node_modules resolves.
 *
 *   node capture_seq.cjs --view dramatic --frames 72 --interval 80 \
 *     --viewport 1280x720 --url "<sim url>" --out /home/user/tmp/vid/frames_dramatic
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
const die = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

const VIEW = arg('--view', 'dramatic');
const OUT = arg('--out', '/home/user/tmp/vid/frames');
const URL = arg('--url', 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl&lighting_mode=gradient');

// Validate numeric/format args loudly — codex P0: fail fast, never silently
// no-op (a NaN frame count would otherwise "succeed" having captured nothing).
const FRAMES = parseInt(arg('--frames', '72'), 10);
if (!Number.isFinite(FRAMES) || FRAMES <= 0) die('Invalid --frames, expected a positive integer.');
const INTERVAL = parseInt(arg('--interval', '80'), 10);
if (!Number.isFinite(INTERVAL) || INTERVAL < 0) die('Invalid --interval, expected a non-negative integer (ms).');
const m = /^(\d+)x(\d+)$/.exec(arg('--viewport', '1280x720'));
if (!m) die('Invalid --viewport value, expected WxH (e.g. 1280x720).');
const VP = { width: +m[1], height: +m[2] };

const UI_PANEL_IDS = ['hud-frame', 'info-panel', 'pattern-editor-panel', 'sacn-in-monitor-panel',
  'sacn-out-monitor-panel', 'view-presets', 'gui-panel', 'unpatched-warning'];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VP,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist', '--enable-gpu',
      '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
      '--use-angle=swiftshader', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      `--window-size=${VP.width},${VP.height}`],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VP);
    console.log('goto', URL);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => {
      const o = document.getElementById('loading-overlay');
      if (!o) return true;
      const s = getComputedStyle(o);
      return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
    }, { timeout: 90000 }).catch(() => console.warn('loading overlay timeout, continuing'));
    await new Promise(r => setTimeout(r, 5000));

    await page.evaluate((vn) => { if (typeof window.animateCamera === 'function') window.animateCamera(vn); }, VIEW);
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate((ids) => {
      for (const id of ids) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
      document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = 'none'; });
    }, UI_PANEL_IDS);

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    console.log(`capturing ${FRAMES} frames -> ${OUT}`);
    for (let i = 0; i < FRAMES; i++) {
      await page.screenshot({ path: path.join(OUT, `f_${String(i).padStart(4, '0')}.png`), type: 'png' });
      await new Promise(r => setTimeout(r, INTERVAL));
    }
    console.log('done');
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(`❌ capture_seq failed: ${err.message}`); process.exit(1); });
