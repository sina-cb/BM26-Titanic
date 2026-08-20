/**
 * vintage_sizing_capture.cjs — before/after captures for the vintage fixture
 * sizing fix (report 20260725_53).
 *
 * WHAT IT PROVES
 * The Vintage LED Stage Light's six Edison heads (18 mm bulbs on a 75 mm pitch)
 * used to be drawn at their PHYSICAL size times the global "Global Pixel Size"
 * slider, a multiplier that never consulted the fixture's own pixel spacing. At
 * the value the titanic scene ships (5, also the slider max) each head is a core
 * 2.67x wider than the gap between heads, so the six fuse into one blob column —
 * right beside an LED strand that keeps its individual dots because its radius
 * is the absolute params.ledPixelSize and the slider cannot reach it.
 *
 * HOW "BEFORE" IS PRODUCED WITHOUT REVERTING THE SOURCE
 * The pre-fix formula is stated exactly (verified against HEAD):
 *     bulb radius = p.bulbSize * repScale * pixelScale
 *     halo radius = p.haloSize * repScale * haloScale
 * so the harness writes those instance matrices itself, in the page, for the
 * fixtures under test. Nothing is written to disk; calling updateScales()
 * afterwards restores the shipped (fixed) sizing. That keeps the comparison
 * honest AND leaves the operator's working tree alone.
 *
 * LIVE-SESSION SAFETY (he is mapping real controllers, hardware cabled)
 *   GUARD 1 — no sACN output, ever. `window.__readonlyMode` is installed as an
 *     ACCESSOR before any page script runs: the getter always returns true so
 *     animate.js never enables the output client, and the setter swallows
 *     main.js's `window.__readonlyMode = false` (a non-writable property would
 *     THROW in that strict-mode module and break the boot).
 *   GUARD 2 — the sACN-out bridge socket on :6972 is refused at the WebSocket
 *     constructor, belt-and-braces behind GUARD 1.
 *   GUARD 3 — no saves. Every request to the save server on :6970 is counted
 *     and reported; the run FAILS LOUDLY if any non-GET reaches it.
 *   GUARD 4 — params are read, changed only in memory, and restored before the
 *     browser closes. No GUI controller is touched, so nothing can reach
 *     debounceAutoSave.
 *
 * Usage (servers must already be running — never start them from here):
 *   node vintage_sizing_capture.cjs [--viewport 1280x720]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM_URL = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'vintage_fixture_sizing');

const args = process.argv.slice(2);
function parseViewport() {
  const i = args.indexOf('--viewport');
  if (i === -1) return { width: 1280, height: 720 };
  const m = /^(\d+)x(\d+)$/.exec(args[i + 1] || '');
  if (!m) throw new Error(`--viewport expects WxH, got '${args[i + 1]}'`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
const VP = parseViewport();

// The two slider positions that matter: what the operator is running right now
// (working-tree scenes/common.yaml) and what the scene ships at HEAD, which is
// also the slider maximum and deep inside the fused regime.
const SETTINGS = [
  { slug: 'sliders_1p1_0p6', pixel: 1.1, halo: 0.6, label: 'Global Pixel 1.1 / Halo 0.6' },
  { slug: 'sliders_5_4p7', pixel: 5, halo: 4.7, label: 'Global Pixel 5 / Halo 4.7' },
];

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
        throw new Error('[vintage_sizing_capture] blocked: sACN OUT bridge socket (:6972)');
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
    // Operator-state banners live outside those ids; hide any fixed toast strip
    // so it cannot cover the fixtures under test.
    document.querySelectorAll('#multi-client-warning, #engine-blackout-warning, #gpu-adapter-warning, #save-status, #shortcuts-button, #shortcuts-hint, #unsaved-indicator, #dirty-badge')
      .forEach((el) => { el.style.display = 'none'; });
    // Anything fixed-position left over (operator banners, toasts, the shortcuts
    // pill) would sit on top of the fixtures under test.
    document.querySelectorAll('body > *').forEach((el) => {
      if (el.tagName === 'CANVAS' || el.id === 'loading-overlay') return;
      const s = window.getComputedStyle(el);
      if (s.position === 'fixed' || s.position === 'absolute') el.style.display = 'none';
    });
  }, UI_PANEL_IDS);
}

/**
 * Hide the generator/trace editing overlay (rings, handles, numbered chain
 * labels). It is drawn ON TOP of the fixtures and would otherwise be the only
 * thing visible at this framing. Display state only — restored afterwards, and
 * `params.generatorsVisible` itself is never written.
 */
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

/**
 * Overwrite the bulb/halo instance matrices of the vintage fixtures with the
 * PRE-FIX formula. Page-local only — updateScales() puts the shipped sizing
 * back.
 */
const applyPreFixSizing = (pixelScale, haloScale) => {
  // A uniform-scale + translation matrix, written straight into the instance
  // buffer in THREE's column-major order — no THREE import needed, so the
  // harness can never end up holding a second copy of the library.
  const writeMatrix = (mesh, i, s, t) => {
    mesh.instanceMatrix.array.set(
      [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t.x, t.y, t.z, 1], i * 16);
  };
  let touched = 0;
  for (const f of (window.parFixtures || [])) {
    if (!f || !f.config || f.config.fixtureType !== 'VintageLed') continue;
    if (!f.bulbInst) continue;
    for (let i = 0; i < f.pixels.length; i++) {
      const p = f.pixels[i];
      writeMatrix(f.bulbInst, i, p.bulbSize * pixelScale, p.localPos);
      if (f.haloInst) writeMatrix(f.haloInst, i, p.haloSize * haloScale, p.localPos);
    }
    f.bulbInst.instanceMatrix.needsUpdate = true;
    if (f.haloInst) f.haloInst.instanceMatrix.needsUpdate = true;
    touched++;
  }
  return touched;
};

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
    if (/:6970(\/|$)/.test(r.url()) || r.url().includes('127.0.0.1:6970')) {
      saveServerHits.push(`${r.method()} ${r.url()}`);
    }
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
    await sleep(6000);

    const survey = await page.evaluate(() => {
      const vintage = [];
      (window.parFixtures || []).forEach((f, i) => {
        if (!f || !f.config || f.config.fixtureType !== 'VintageLed') return;
        vintage.push({
          i, name: f.config.name, group: f.config.group,
          x: f.hitbox.position.x, y: f.hitbox.position.y, z: f.hitbox.position.z,
          pitch: f._minPixelPitch, pixels: f.pixels.length,
        });
      });
      const strands = (window.ledStrandFixtures || []).map((f, i) => ({
        i, name: f.config.name,
        sx: f.config.startX, sy: f.config.startY, sz: f.config.startZ,
        ex: f.config.endX, ey: f.config.endY, ez: f.config.endZ,
        leds: f.config.ledCount, color: f.config.color,
      }));
      return { vintage, strands };
    });
    console.log(`🔦 vintage fixtures: ${survey.vintage.length}, strands: ${survey.strands.length}`);
    if (!survey.vintage.length) throw new Error('no VintageLed fixtures in the live scene');

    // Frame the Left Front Rails vintage column together with the
    // Left_Front_Left strand — the pair in the operator's screenshot.
    const target = survey.vintage.filter((v) => /Left Front Rails/i.test(v.group || ''))
      .sort((a, b) => a.y - b.y)[0] || survey.vintage[0];
    const strand = survey.strands.find((s) => /Left_Front_Left/i.test(s.name || '')) || survey.strands[0];
    console.log(`🎯 ${target.group} / ${target.name} @ (${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)}) pitch ${target.pitch.toFixed(4)}`);
    if (strand) console.log(`📏 reference strand ${strand.name} ${strand.leds} LEDs ${strand.color}`);

    // Camera: stand off along -x/+z from the fixture, looking at the midpoint of
    // the vintage head and the strand's lower half so both are in frame.
    const strandMid = strand
      ? { x: (strand.sx + strand.ex) / 2, y: (strand.sy + strand.ey) / 2, z: (strand.sz + strand.ez) / 2 }
      : { x: target.x, y: target.y, z: target.z };
    const look = {
      x: (target.x + strandMid.x) / 2,
      y: (target.y + strandMid.y) / 2,
      z: (target.z + strandMid.z) / 2,
    };
    const POSES = [
      {
        slug: 'pair',
        label: 'vintage column + Left_Front_Left strand in one frame',
        // Stand off outboard of the hull (-x, +z), ~8 world units away.
        eye: { x: look.x - 5.5, y: look.y + 2.2, z: look.z + 5.2 },
        look,
      },
      {
        slug: 'tight',
        label: 'one vintage fixture, close enough to count its six heads',
        eye: { x: target.x - 0.85, y: target.y + 0.45, z: target.z + 1.05 },
        look: { x: target.x, y: target.y + 0.19, z: target.z },
      },
    ];

    await page.evaluate((e, t) => {
      if (typeof window.animateCameraToPose !== 'function') throw new Error('animateCameraToPose missing');
      window.animateCameraToPose(e, t, 900);
    }, POSES[0].eye, POSES[0].look);
    await sleep(3000);
    await hideUI(page);
    await setTraceOverlay(page, false);
    await sleep(600);

    const lit = await page.evaluate(() => {
      const out = [];
      for (const f of (window.parFixtures || [])) {
        if (!f || !f.config || f.config.fixtureType !== 'VintageLed') continue;
        out.push({ name: f.config.name, c: f.pixels[0].color.getHexString() });
        if (out.length >= 4) break;
      }
      return { patchesActive: !!window._patchesActive, sample: out };
    });
    console.log(`💡 _patchesActive=${lit.patchesActive} vintage pixel colors: ${lit.sample.map((s) => `${s.name}=#${s.c}`).join(', ')}`);

    const captured = [];
    for (const pose of POSES) {
    console.log(`\n🎥 ${pose.slug} — ${pose.label}`);
    await page.evaluate((e, t) => window.animateCameraToPose(e, t, 900), pose.eye, pose.look);
    await sleep(2500);
    await hideUI(page);
    await setTraceOverlay(page, false);
    for (const s of SETTINGS) {
      console.log(`  🎚️  ${s.label}`);
      await page.evaluate((pixel, halo) => {
        // In-memory only. No GUI controller is touched, so nothing reaches the
        // autosave debounce.
        window.__savedScales = window.__savedScales || null;
        return import(`${location.origin}/simulation/src/core/state.js`).then((m) => {
          if (!window.__savedScales) {
            window.__savedScales = {
              pixel: m.params.globalPixelScale, halo: m.params.globalHaloScale,
            };
          }
          m.params.globalPixelScale = pixel;
          m.params.globalHaloScale = halo;
          for (const f of (window.parFixtures || [])) if (f && f.updateScales) f.updateScales(pixel, halo);
          for (const f of (window.dmxSceneFixtures || [])) if (f && f.updateScales) f.updateScales(pixel, halo);
          for (const f of (window.ledStrandFixtures || [])) if (f && f.applyVisualSize) f.applyVisualSize();
        });
      }, s.pixel, s.halo);
      await sleep(1200);
      captured.push(await shot(page, `${pose.slug}_after_${s.slug}`));

      const touched = await page.evaluate(applyPreFixSizing, s.pixel, s.halo);
      console.log(`    ↩︎ pre-fix sizing applied to ${touched} vintage fixture(s)`);
      await sleep(1200);
      captured.push(await shot(page, `${pose.slug}_before_${s.slug}`));

      // Put the shipped sizing back before the next setting.
      await page.evaluate((pixel, halo) => {
        for (const f of (window.parFixtures || [])) if (f && f.updateScales) f.updateScales(pixel, halo);
      }, s.pixel, s.halo);
      await sleep(400);
    }
    }

    // Wide shot at the operator's own settings, restored.
    await page.evaluate(() => import(`${location.origin}/simulation/src/core/state.js`).then((m) => {
      const s = window.__savedScales;
      if (!s) return;
      m.params.globalPixelScale = s.pixel;
      m.params.globalHaloScale = s.halo;
      for (const f of (window.parFixtures || [])) if (f && f.updateScales) f.updateScales(s.pixel, s.halo);
      for (const f of (window.dmxSceneFixtures || [])) if (f && f.updateScales) f.updateScales(s.pixel, s.halo);
      for (const f of (window.ledStrandFixtures || [])) if (f && f.applyVisualSize) f.applyVisualSize();
    }));
    await page.evaluate((e, t) => window.animateCameraToPose(e, t, 900),
      { x: look.x - 12, y: look.y + 6, z: look.z + 22 }, look);
    await sleep(3000);
    captured.push(await shot(page, 'after_wide_context'));

    // Put the operator's editing overlay back exactly as we found it.
    await setTraceOverlay(page, true);

    const restored = await page.evaluate(() => import(`${location.origin}/simulation/src/core/state.js`)
      .then((m) => ({ pixel: m.params.globalPixelScale, halo: m.params.globalHaloScale, saved: window.__savedScales })));

    console.log('\n── guards ──');
    console.log(`  sACN OUT enable lines: ${sacnOutLines.length} (must be 0)`);
    console.log(`  save-server (:6970) requests: ${saveServerHits.length} → ${JSON.stringify(saveServerHits)}`);
    console.log(`  scales restored: ${JSON.stringify(restored)}`);
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
