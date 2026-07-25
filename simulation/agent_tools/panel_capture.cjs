/**
 * panel_capture.cjs — Screenshot evidence for feat/bm_readiness Slices 3+4:
 * the LEFT-docked mapping pane + drawer policy (operator ruling 2026-07-24) and
 * the reverse-link work (G5). agent_render.cjs can't open the map pane, drive
 * the split, or click chips, so this dedicated repeatable tool does.
 *
 * Boots in pixelblaze mode so the LEFT-edge Pattern Editor drawer exists (to
 * prove it yields during mapping and returns after). Output prefix panel_*.
 *
 * Usage:  node panel_capture.cjs [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SIM_URL = 'http://127.0.0.1:6969/simulation/'
  + '?scene=titanic&profile=pixel_mapping&renderer=webgl&lighting_mode=pixelblaze';
const OUTPUT_DIR = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP_ALIVE = process.argv.includes('--keep-alive');

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
    () => window.parFixtures && window.parFixtures.length > 0
      && typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 30000 });
  await sleep(4000);
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const out = path.join(OUTPUT_DIR, `panel_${name}_${ts}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
}

const openMap = (page) => page.evaluate(() => {
  const panel = document.getElementById('controller-map-panel');
  if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
  return window.__splitLayout.getState();
});
const closeMap = (page) => page.evaluate(() => {
  const panel = document.getElementById('controller-map-panel');
  if (!panel.classList.contains('hidden')) window.toggleControllerMapPanel();
});
const showPatternEditor = (page) => page.evaluate(() => {
  if (window.showPatternEditor) window.showPatternEditor(true);
});
const openLightingControls = (page) => page.evaluate(async () => {
  const cd = await import('/simulation/src/gui/control_drawer.js');
  if (cd.setDrawerCollapsed) cd.setDrawerCollapsed(false);
});
const peVisible = (page) => page.evaluate(() => {
  const pe = document.getElementById('pattern-editor-panel');
  if (!pe) return 'no-pe';
  const s = getComputedStyle(pe);
  return s.display !== 'none' && s.opacity !== '0' ? 'visible' : 'hidden';
});

async function splitAndDrawers(cls) {
  console.log(`\n══ ${cls.name} ${cls.width}x${cls.height} ══`);
  const browser = await launch(cls);
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport({ width: cls.width, height: cls.height });
  await loadSim(page);

  await page.evaluate(() => { if (window.animateCamera) window.animateCamera('front'); });
  await sleep(2500);
  await showPatternEditor(page);
  await openLightingControls(page);
  await sleep(1200);

  // (c) BEFORE mapping: Pattern Editor docked on the LEFT.
  console.log(`   pattern editor before map: ${await peVisible(page)}`);
  await shot(page, `${cls.name}_before_patterneditor_left`);

  // (a)+(b) Mapping engaged: map pane LEFT, sim RIGHT, Lighting Controls OPEN.
  const state = await openMap(page);
  console.log(`   split: mode=${state.mode} ratio=${state.ratio.toFixed(2)} mapW=${state.mapW} simW=${state.simW}`);
  await sleep(1600);
  console.log(`   pattern editor during map: ${await peVisible(page)}  (expect hidden)`);
  await shot(page, `${cls.name}_split_map_left`);

  // (c) AFTER closing: Pattern Editor restored on the LEFT.
  await closeMap(page);
  await sleep(1200);
  console.log(`   pattern editor after map: ${await peVisible(page)}  (expect visible)`);
  await shot(page, `${cls.name}_after_patterneditor_restored`);

  if (KEEP_ALIVE && cls === CLASSES[CLASSES.length - 1]) {
    console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
    await new Promise(() => {});
  }
  await browser.close();
}

// ── Reverse-link demos (laptop): 3D→chip highlight/scroll, chip→3D camera focus,
//    LED strand both directions. ─────────────────────────────────────────────
async function reverseLinkDemo() {
  const cls = { name: 'laptop', width: 1440, height: 900 };
  console.log(`\n══ reverse-link demo ${cls.width}x${cls.height} ══`);
  const browser = await launch(cls);
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport({ width: cls.width, height: cls.height });
  await loadSim(page);

  await page.evaluate(() => { if (window.animateCamera) window.animateCamera('aerial'); });
  await sleep(2500);
  await openLightingControls(page);
  await openMap(page);
  await sleep(1000);
  // Patch the whole rig so there are DMX + strand chips to exercise.
  await page.evaluate(() => { const b = document.querySelector('.cm-test-autopatch'); if (b) b.click(); });
  await sleep(1500);

  // G5 forward: select a DMX fixture in 3D → its chip highlights + scrolls into
  // view. Click the fixture at its projected screen center (real pick).
  const clickInfo = await page.evaluate(async () => {
    const st = await import('/simulation/src/core/state.js');
    const THREE = await import('three');
    const { camera, renderer } = st;
    const rect = renderer.domElement.getBoundingClientRect();
    const fixtures = window.parFixtures || [];
    // A fixture that projects into the sim pane (right of the map pane).
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const f = fixtures[i];
      if (!f || !f.hitbox) continue;
      const v = f.hitbox.position.clone().project(camera);
      if (v.z <= -1 || v.z >= 1) continue;
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      if (x > rect.left + 40 && x < rect.right - 40 && y > rect.top + 40 && y < rect.bottom - 40) {
        return { x, y, name: f.config && f.config.name, index: i };
      }
    }
    return null;
  });
  if (clickInfo) {
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.mouse.click(clickInfo.x, clickInfo.y);
    await sleep(700);
    const marked = await page.evaluate(() => document.querySelectorAll('#cm-body .cm-chip.cm-chip-selected').length);
    console.log(`   3D pick "${clickInfo.name}" → ${marked} chip(s) highlighted + scrolled into view`);
    await shot(page, 'reverse_3d_to_chip_highlight');
  } else {
    console.warn('   no in-pane fixture found for 3D→chip demo');
  }

  // G5 reverse: click a DMX fixture chip in the panel → 3D selects + camera flies.
  const camBefore = await page.evaluate(async () => {
    const st = await import('/simulation/src/core/state.js');
    const p = st.camera.position; return { x: p.x, y: p.y, z: p.z };
  });
  const chipName = await page.evaluate(() => {
    const chip = document.querySelector('#cm-body .cm-chip[data-cm-kind="fixture"]');
    if (!chip) return null;
    chip.click();
    return chip.getAttribute('data-cm-fixture');
  });
  await sleep(1400); // let the fly-to animation settle
  const camAfter = await page.evaluate(async () => {
    const st = await import('/simulation/src/core/state.js');
    const p = st.camera.position; return { x: p.x, y: p.y, z: p.z };
  });
  const moved = Math.hypot(camAfter.x - camBefore.x, camAfter.y - camBefore.y, camAfter.z - camBefore.z);
  console.log(`   chip "${chipName}" click → camera moved ${moved.toFixed(1)} units (fly-to focus)`);
  await shot(page, 'reverse_chip_to_3d_camera_focus');

  // LED strand reverse link: click a strand chip → strand selects in 3D + focus.
  const strandInfo = await page.evaluate(async () => {
    const chip = document.querySelector('#cm-body .cm-chip[data-cm-kind="strand"]');
    if (!chip) return null;
    const name = chip.getAttribute('data-cm-fixture');
    chip.click();
    return { name };
  });
  await sleep(1400);
  const strandSel = await page.evaluate(() => {
    const fixtures = window.ledStrandFixtures || [];
    return fixtures.filter((f) => f && f._selected).map((f) => f.config && f.config.name);
  });
  console.log(`   strand chip "${strandInfo && strandInfo.name}" click → 3D strand(s) selected: [${strandSel.join(', ')}]`);
  await shot(page, 'reverse_strand_chip_to_3d');

  if (KEEP_ALIVE) {
    console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
    await new Promise(() => {});
  }
  await browser.close();
}

async function main() {
  for (const cls of CLASSES) await splitAndDrawers(cls);
  await reverseLinkDemo();
  console.log('\ndone.');
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
