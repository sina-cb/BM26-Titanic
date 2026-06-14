/**
 * agent_render.js — Puppeteer renderer for BM26 Titanic simulation.
 *
 * Modes:
 *   node agent_render.js                  Capture all 5 preset views
 *   node agent_render.js --open           Open the sim window (no captures, stays open)
 *   node agent_render.js --current        Capture the current view without moving the camera
 *   node agent_render.js --view front     Navigate to a specific view and capture
 *
 * Flags:
 *   --keep-alive          Keep the browser window open after capturing
 *   --show-ui             Keep the menus/panels visible in captures (hidden by default)
 *   --viewport WxH        Screenshot resolution (default 1920x1080; use 1280x720 on
 *                         software-rendered/headless machines — see note at VIEWPORT)
 *   --url <url>           Override the simulation URL (default http://127.0.0.1:6969/
 *                         simulation/?scene=titanic&profile=full&renderer=webgl). Use for
 *                         non-default ports (multi-agent slots) or extra query params
 *                         (e.g. &theme=gruvbox for themed captures).
 *
 * Browser reuse: When --open is running, render commands (--current, --view, default)
 * automatically connect to the existing browser instead of launching a new one.
 *
 * Output: ../.agent_renders/{unix_seconds}_{view}.png
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// --- Config ---
const PRESET_YAML = path.join(__dirname, '..', 'scenes', 'titanic', 'cameras.yaml');
function loadPresetKeys() {
  try {
    const doc = yaml.load(fs.readFileSync(PRESET_YAML, 'utf8'));
    return (doc.presets || []).map(p => p.key);
  } catch (e) {
    console.warn('⚠️  Could not load presets from YAML, using defaults.');
    return ['front', 'side', 'aerial', 'dramatic', 'night-walk'];
  }
}
const ALL_VIEWS = loadPresetKeys();
// renderer=webgl: headless/CI machines run on SwiftShader, where the WebGPU
// backend initializes and then loses its device (black canvas). The WebGL2
// backend is stable under SwiftShader; on real GPUs the visual difference is
// acceptable for layout/regression checks.
const DEFAULT_SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl';
// --url <url>: full override for non-default ports (multi-agent worktree
// slots) or extra query params like &theme=<id>.
function parseSimUrl() {
  const i = process.argv.indexOf('--url');
  if (i === -1) return DEFAULT_SIM_URL;
  const value = process.argv[i + 1];
  if (!value || !/^https?:\/\//.test(value)) {
    console.error('❌ Invalid --url value, expected a full http(s) URL.');
    process.exit(1);
  }
  return value;
}
const SIM_URL = parseSimUrl();
const OUTPUT_DIR = path.join(__dirname, '..', '..', '.agent_renders');

// --viewport WxH: SwiftShader (software GL on headless/CI machines) loses the
// WebGL context on close-up views at 1920x1080; 1280x720 stays stable there.
function parseViewport() {
  const i = process.argv.indexOf('--viewport');
  if (i === -1) return { width: 1920, height: 1080 };
  const m = /^(\d+)x(\d+)$/.exec(process.argv[i + 1] || '');
  if (!m) {
    console.error('❌ Invalid --viewport value, expected WxH (e.g. 1280x720).');
    process.exit(1);
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}
const VIEWPORT = parseViewport();
const WINDOW_SIZE = { width: VIEWPORT.width + 192, height: VIEWPORT.height + 108 };
const CAMERA_SETTLE_MS = 3000;
const ENDPOINT_FILE = path.join(__dirname, '.puppeteer-endpoint');

// --- CLI Parsing ---
const args = process.argv.slice(2);
const KEEP_ALIVE = args.includes('--keep-alive');
const SHOW_UI = args.includes('--show-ui');
const OPEN_ONLY = args.includes('--open');
const CURRENT_ONLY = args.includes('--current');
const RELOAD = args.includes('--reload');
const RAYCAST_MODE = args.includes('--raycast');
const VIEW_INDEX = args.indexOf('--view');
const SINGLE_VIEW = VIEW_INDEX !== -1 ? args[VIEW_INDEX + 1] : null;

// --- Browser Management ---
function saveEndpoint(wsEndpoint) {
  fs.writeFileSync(ENDPOINT_FILE, wsEndpoint);
}

function clearEndpoint() {
  try { fs.unlinkSync(ENDPOINT_FILE); } catch (e) { /* ignore */ }
}

function getExistingEndpoint() {
  try {
    if (fs.existsSync(ENDPOINT_FILE)) {
      return fs.readFileSync(ENDPOINT_FILE, 'utf8').trim();
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    defaultViewport: OPEN_ONLY ? null : VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--enable-webgl',
      '--enable-webgl2',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=swiftshader',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${WINDOW_SIZE.width},${WINDOW_SIZE.height}`,
    ],
  });
}

async function connectToExisting(wsEndpoint) {
  return puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: null,
  });
}

// --- Helpers ---
async function loadSimulation(page) {
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('WebGL') && text.includes('Error')) {
      console.error(`  [WebGL ERROR] ${text}`);
    }
  });
  page.on('pageerror', err => console.error(`  [page error] ${err.message}`));

  console.log(`📡 Navigating to ${SIM_URL}`);
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('✅ Page loaded.');

  const webglOk = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return !!gl;
  });
  console.log(`🖥️  WebGL status: ${webglOk ? '✅ Working' : '❌ Failed'}`);
  if (!webglOk) {
    console.error('⚠️ WebGL not available — canvas will be blank. Continuing for DOM validation...');
    // process.exit(1);
  }

  console.log('⏳ Waiting for simulation to finish loading...');
  try {
    await page.waitForFunction(
      () => {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return true;
        const style = window.getComputedStyle(overlay);
        return style.display === 'none' || style.opacity === '0' || style.visibility === 'hidden';
      },
      { timeout: 90000 }
    );
    console.log('✅ Loading complete.');
  } catch (e) {
    console.warn('⚠️  Loading overlay did not disappear in 90s, continuing anyway...');
  }

  console.log('🎨 Waiting for render to settle...');
  await new Promise(r => setTimeout(r, 5000));
}

const UI_PANEL_IDS = [
  'hud-frame',
  'info-panel',
  'pattern-editor-panel',
  'sacn-in-monitor-panel',
  'sacn-out-monitor-panel',
  'view-presets',
  'gui-panel',
  'unpatched-warning',
];

async function hideUI(page) {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = 'none'; });
  }, UI_PANEL_IDS);
}

async function showUI(page) {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = ''; });
  }, UI_PANEL_IDS);
  await new Promise(r => setTimeout(r, 1000));
}

async function clickView(page, viewName) {
  const clicked = await page.evaluate((vn) => {
    if (typeof window.animateCamera === 'function') {
      window.animateCamera(vn);
      return true;
    }
    return false;
  }, viewName);
  
  if (!clicked) {
    console.warn(`   ⚠️ View preset "${viewName}" not found or API missing.`);
    return false;
  }
  
  await new Promise(r => setTimeout(r, CAMERA_SETTLE_MS));
  return true;
}

async function captureScreenshot(page, filename) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: outPath, type: 'png' });
  console.log(`   ✅ Saved: ${outPath}`);
  return outPath;
}

async function keepAlive(page) {
  await showUI(page);
  console.log('\n🖥️  Browser window staying open. Press Ctrl+C to close.');
  await new Promise(() => {});
}

// --- Main ---
async function main() {
  let browser;
  let page;
  let isConnected = false;

  // === MODE: --open (launch new browser, save endpoint, stay open) ===
  if (OPEN_ONLY) {
    const existing = getExistingEndpoint();
    if (existing) {
      try {
        const test = await puppeteer.connect({ browserWSEndpoint: existing, defaultViewport: null });
        const testPages = await test.pages();
        if (testPages.length > 0) {
          console.log('⚠️  Browser is already open! Use --current or --view to capture.');
          test.disconnect();
          return;
        }
        test.disconnect();
      } catch (e) {
        clearEndpoint();
      }
    }

    console.log('🚀 Launching browser...');
    browser = await launchBrowser();
    saveEndpoint(browser.wsEndpoint());

    const cleanup = () => { clearEndpoint(); process.exit(); };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => clearEndpoint());

    const bPages = await browser.pages();
    page = bPages.length > 0 ? bPages[0] : await browser.newPage();

    try {
      await loadSimulation(page);
    } catch (e) {
      console.error(`❌ Failed to load simulation: ${e.message}`);
      clearEndpoint();
      await browser.close();
      process.exit(1);
    }

    console.log('\n✅ Simulation loaded. Window is open for interactive use.');
    await keepAlive(page);
    return;
  }

  // === RENDER MODES: Try to connect to existing browser first ===
  const existingEndpoint = getExistingEndpoint();
  if (existingEndpoint) {
    try {
      console.log('🔗 Connecting to existing browser...');
      browser = await connectToExisting(existingEndpoint);
      const allPages = await browser.pages();
      page = allPages.find(p => p.url().includes('simulation')) || allPages[0];
      isConnected = true;
      console.log('✅ Connected to running instance.');
    } catch (e) {
      console.log('⚠️  Could not connect to existing browser, launching new one...');
      clearEndpoint();
      browser = null;
    }
  }

  // Fall back to launching a new browser
  if (!browser) {
    console.log('🚀 Launching browser...');
    browser = await launchBrowser();
    const bPages = await browser.pages();
    page = bPages.length > 0 ? bPages[0] : await browser.newPage();
    await page.setViewport(VIEWPORT);

    try {
      await loadSimulation(page);
    } catch (e) {
      console.error(`❌ Failed to load simulation: ${e.message}`);
      await browser.close();
      process.exit(1);
    }
  }

  // === RELOAD: Reload page from YAML without restarting browser ===
  if (RELOAD) {
    console.log('🔄 Reloading simulation from YAML...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      return window.__SCENE_LOADED === true;
    }, { timeout: 30000 }).catch(() => {
      // Fallback: just wait a bit if __SCENE_LOADED flag isn't set
    });
    await new Promise(r => setTimeout(r, 3000));
    console.log('✅ Reload complete.');
  }

  // === MODE: --raycast ===
  if (RAYCAST_MODE) {
    console.log('🔍 Running raycast utility to find port-side hull Z-coordinates...');
    
    // In raycast mode, we need to ensure the helper is available, 
    // but main.js now permanently defines window.getHullPort.
    // Let's just evaluate the points.
    const pointsToQuery = [
      { name: "Left Front Deck Start", x: 20, y: 11.5 },
      { name: "Left Front Deck End", x: 34, y: 1.8 },
      { name: "Left Front Wall Start", x: 33, y: 0.3 },
      { name: "Left Front Wall End", x: 19, y: 10.5 },
      { name: "Left Chimney Center", x: 23.2, y: 8.1 },
      { name: "Left Center Auditorium Start", x: -13, y: 11 },
      { name: "Left Center Auditorium End", x: -5, y: 9 },
      { name: "Left Back Wall Start", x: -29, y: 2 },
      { name: "Left Back Wall End", x: -13, y: 11 },
    ];

    console.log('⏳ Waiting for model meshes to populate...');
    await page.waitForFunction(() => window.modelMeshes && window.modelMeshes.length > 0, { timeout: 30000 }).catch(() => {});
    
    console.log('📏 Raycasting results:');
    const outData = {};
    for (const pt of pointsToQuery) {
      const res = await page.evaluate(({ x, y }) => {
        if (typeof window.getHullPort === 'function') {
          return window.getHullPort(x, y);
        }
        return null;
      }, pt);
      
      if (res && res.length > 0) {
        const maxZ = Number(Math.max(...res).toFixed(3));
        outData[pt.name] = { x: pt.x, y: pt.y, z: maxZ, allHits: res };
        console.log(`  ➤ ${pt.name.padEnd(30)} x: ${pt.x.toString().padStart(4)}, y: ${pt.y.toString().padStart(4)}  ==>  z: ${maxZ}`);
      } else {
        outData[pt.name] = { x: pt.x, y: pt.y, z: null, allHits: [] };
        console.log(`  ➤ ${pt.name.padEnd(30)} x: ${pt.x.toString().padStart(4)}, y: ${pt.y.toString().padStart(4)}  ==>  NO HIT`);
      }
    }
    
    fs.writeFileSync('raycast_results.json', JSON.stringify(outData, null, 2));
    console.log('💾 Saved full results to raycast_results.json');
    
    if (!isConnected) await browser.close();
    process.exit(0);
  }

  // For all capture modes, hide UI first (unless --show-ui keeps the menus)
  if (!SHOW_UI) await hideUI(page);

  // === MODE: --current ===
  if (CURRENT_ONLY) {
    console.log('📸 Capturing current view...');
    const ts = Math.floor(Date.now() / 1000);
    await captureScreenshot(page, `${ts}_current.png`);
  }

  // === MODE: --view <name> ===
  else if (SINGLE_VIEW) {
    console.log(`📸 Navigating to "${SINGLE_VIEW}" and capturing...`);
    if (await clickView(page, SINGLE_VIEW)) {
      const ts = Math.floor(Date.now() / 1000);
      await captureScreenshot(page, `${ts}_${SINGLE_VIEW}.png`);
    } else {
      console.error(`❌ View "${SINGLE_VIEW}" not found in DOM. Available: ${ALL_VIEWS.join(', ')}`);
      if (!isConnected) await browser.close();
      process.exit(1);
    }
  }

  // === MODE: default (all preset views) ===
  else {
    const ts = Math.floor(Date.now() / 1000);
    for (const viewName of ALL_VIEWS) {
      console.log(`📸 Rendering "${viewName}" view...`);
      if (await clickView(page, viewName)) {
        await captureScreenshot(page, `${ts}_${viewName}.png`);
      }
    }
  }

  // Restore UI if connected to existing browser, otherwise close
  if (isConnected) {
    await showUI(page);
    browser.disconnect();
    console.log('\n🎉 All done! Browser still running.');
  } else if (KEEP_ALIVE) {
    console.log('\n🎉 Renders complete!');
    await keepAlive(page);
  } else {
    await browser.close();
    console.log('\n🎉 All done! Files saved to .agent_renders/');
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
