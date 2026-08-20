/**
 * patched_dot_scale_capture.cjs — before/after for the scene-wide instanced-dot
 * mesh ignoring the per-type render multiplier (report 20260725_74).
 *
 * WHAT IT PROVES
 * animate.js draws ONE InstancedMesh over every pixel in the show. It used to
 * place and size each dot from the pixel map's PHYSICAL `x/y/z` + `pixelSize`,
 * so it never saw fixture_model_scale.js: a 2.5x Vintage LED drew its six heads
 * at pre-scale size, huddled at pre-scale spacing inside a housing that had
 * grown 2.5x around them. Every UNPATCHED dot is forced black (or flat red under
 * the unpatched-red overlay) by the colour flush, so the pre-scale dots were
 * visible on exactly the PATCHED fixtures — the Left Front Rails, and nothing
 * else. That is the whole "it's only Left Front Rails" asymmetry.
 *
 * Captured in the `pixel_mapping` profile, where the per-fixture bulb/halo
 * meshes are NOT built and the dot mesh is the only emitter on screen — so the
 * comparison shows the defect and nothing else.
 *
 * HOW "BEFORE" IS PRODUCED WITHOUT REVERTING THE SOURCE
 * The pre-fix recipe is stated exactly (verified against the previous HEAD):
 *     position = pixel.x / y / z          (PHYSICAL world position)
 *     radius   = (pixel.pixelSize || 14) * 0.001 * params.globalPixelScale
 * so the harness writes those instance matrices itself, in the page, for the
 * live dot mesh. Nothing is written to disk; window.updatePixelInstancedScale()
 * afterwards restores the shipped (fixed) geometry.
 *
 * LIVE-SESSION SAFETY (hardware is cabled; the operator's own stack is running)
 *   GUARD 1 — no sACN output, ever. `window.__readonlyMode` is installed as an
 *     ACCESSOR before any page script runs: the getter always returns true so
 *     animate.js never enables the output client, and the setter swallows
 *     main.js's `window.__readonlyMode = false` (a non-writable property would
 *     THROW in that strict-mode module and break the boot).
 *   GUARD 2 — the sACN-out bridge socket on :6972 is refused at the WebSocket
 *     constructor, belt-and-braces behind GUARD 1.
 *   GUARD 3 — no saves. Every request to the save server on :6970 is counted;
 *     the run FAILS LOUDLY if any non-GET reaches it.
 *   GUARD 4 — no GUI controller is touched and no param is written, so nothing
 *     can reach debounceAutoSave. Only instance matrices change, in memory.
 *
 * Usage (servers must already be running — never start them from here):
 *   node patched_dot_scale_capture.cjs [--viewport 1280x720]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

const ORIGIN = 'http://127.0.0.1:6969';
// pixel_mapping: mappingEnabled with emitterMode 'none' — the scene-wide dot
// mesh is the ONLY emitter, which is what this capture is about.
const SIM_URL = `${ORIGIN}/simulation/?scene=titanic&profile=pixel_mapping&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'patched_dot_scale');

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

const UI_PANEL_IDS = [
  'hud-frame', 'info-panel', 'pattern-editor-panel', 'sacn-in-monitor-panel',
  'sacn-out-monitor-panel', 'view-presets', 'gui-panel', 'unpatched-warning',
  'pixel-map-panel',
];

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
        throw new Error('[patched_dot_scale_capture] blocked: sACN OUT bridge socket (:6972)');
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

async function setTraceOverlay(page, visible) {
  await page.evaluate((v) => {
    if (typeof window.setTraceObjectsVisibility === 'function') window.setTraceObjectsVisibility(v);
  }, visible);
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

// The scene-wide dot mesh is the only InstancedMesh parented DIRECTLY to the
// scene (every fixture/strand batch lives under its own group).
const findDotMesh = () => import(`${location.origin}/simulation/src/core/state.js`).then((st) => {
  const hits = st.scene.children.filter((o) => o.isInstancedMesh);
  if (hits.length !== 1) {
    throw new Error(`expected exactly ONE scene-level InstancedMesh (the dot mesh), found ${hits.length}`);
  }
  window.__dotMesh = hits[0];
  return { count: hits[0].count, pixelScale: st.params.globalPixelScale };
});

// Overwrite every dot's instance matrix with the PRE-FIX recipe: PHYSICAL
// position, PHYSICAL size x the global slider, no render multiplier.
const applyPreFixDots = () => Promise.all([
  import(`${location.origin}/simulation/src/core/state.js`),
  import(`${location.origin}/simulation/src/dmx/pixelblaze_model_exporter.js`),
]).then(([st, exp]) => {
  const mesh = window.__dotMesh;
  const { pixels } = exp.generatePixelMap();
  if (pixels.length !== mesh.count) {
    throw new Error(`pixel map (${pixels.length}) does not match the dot mesh (${mesh.count})`);
  }
  const scale = st.params.globalPixelScale || 1.0;
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const s = (p.pixelSize || 14) * 0.001 * scale; // pre-fix: no p.renderScale
    mesh.instanceMatrix.array.set(
      [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, p.x, p.y, p.z, 1], i * 16); // pre-fix: physical x/y/z
  }
  mesh.instanceMatrix.needsUpdate = true;
  return pixels.length;
});

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: false, defaultViewport: VP, protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
  const page = (await browser.pages())[0];

  const errors = [];
  const sacnOutLines = [];
  const saveServerHits = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    if (/\[sACN Out\]\s+Enabling/i.test(t)) sacnOutLines.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    if (/:6970(\/|$)/.test(r.url())) saveServerHits.push(`${r.method()} ${r.url()}`);
  });
  page.on('dialog', async (d) => { await d.accept(); });

  await installGuards(page);

  try {
    console.log(`📡 ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => {
      const o = document.getElementById('loading-overlay');
      if (!o) return true;
      const s = window.getComputedStyle(o);
      return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
    }, { timeout: 120000 });
    await sleep(7000);

    const survey = await page.evaluate(() => {
      const vintage = [];
      (window.parFixtures || []).forEach((f, i) => {
        if (!f || !f.config || f.config.fixtureType !== 'VintageLed') return;
        vintage.push({
          i, name: f.config.name, group: f.config.group,
          x: f.hitbox.position.x, y: f.hitbox.position.y, z: f.hitbox.position.z,
          patched: !!(f.config.dmxUniverse >= 1 && f.config.dmxAddress >= 1),
          hasBulbInst: !!f.bulbInst,
        });
      });
      return { vintage, patchesActive: !!window._patchesActive };
    });
    const patched = survey.vintage.filter((v) => v.patched);
    console.log(`🔦 vintage: ${survey.vintage.length} (patched: ${patched.length}), ` +
      `_patchesActive=${survey.patchesActive}, per-fixture emitters built=${survey.vintage[0]?.hasBulbInst}`);
    if (!patched.length) throw new Error('no PATCHED vintage fixtures in the live scene');

    const target = patched.sort((a, b) => a.y - b.y)[0];
    console.log(`🎯 ${target.group} / ${target.name} @ (${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)})`);

    const eye = { x: target.x - 1.6, y: target.y + 0.9, z: target.z + 2.0 };
    const look = { x: target.x, y: target.y + 0.45, z: target.z };
    await page.evaluate((e, t) => {
      if (typeof window.animateCameraToPose !== 'function') throw new Error('animateCameraToPose missing');
      window.animateCameraToPose(e, t, 900);
    }, eye, look);
    await sleep(3000);
    await hideUI(page);
    await setTraceOverlay(page, false);
    await sleep(800);

    const mesh = await page.evaluate(findDotMesh);
    console.log(`⚪ dot mesh: ${mesh.count} instances, Global Pixel Size ${mesh.pixelScale}`);

    const captured = [];
    captured.push(await shot(page, 'after_fixed_dots'));

    const n = await page.evaluate(applyPreFixDots);
    console.log(`  ↩︎ pre-fix dot geometry applied to ${n} instances`);
    await sleep(1200);
    captured.push(await shot(page, 'before_prefix_dots'));

    // Restore the shipped geometry (the fixed recipe, from the live params).
    await page.evaluate(() => import(`${location.origin}/simulation/src/core/state.js`)
      .then((st) => window.updatePixelInstancedScale(st.params.globalPixelScale || 1.0)));
    await sleep(1200);
    captured.push(await shot(page, 'after_restored'));

    await setTraceOverlay(page, true);

    console.log('\n── guards ──');
    console.log(`  sACN OUT enable lines: ${sacnOutLines.length} (must be 0)`);
    console.log(`  save-server (:6970) requests: ${saveServerHits.length} → ${JSON.stringify(saveServerHits)}`);
    console.log(`  page errors: ${errors.length}`);
    errors.slice(0, 8).forEach((e) => console.log(`    • ${e}`));
    const nonGet = saveServerHits.filter((h) => !h.startsWith('GET '));
    if (sacnOutLines.length || nonGet.length) {
      throw new Error(`GUARD VIOLATION — sACN out: ${sacnOutLines.length}, save writes: ${nonGet.length}`);
    }
    console.log(`\n✅ ${captured.length} captures in ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
