/**
 * led_blackout_verify.cjs — live proof that an OFF LED group master OR the
 * global "Master Enabled" toggle blacks out LED strands on EVERY path:
 *   • the per-strand bulb + halo InstancedMeshes (setLedColorRGB),
 *   • the global V2 instanced-dot flush + the 2D Pixel Map + the sACN output
 *     map — all of which read the RAW _batchRenderList entry color, which the
 *     new last-layer gate (_applyLedOutputGate) must zero.
 *
 * Renderer-only (see_the_world): launches its OWN Chromium against the
 * ALREADY-RUNNING stack on :6969; NEVER starts/stops a server. autosave is
 * stubbed so nothing writes the operator's scene. Closes the browser at the end.
 *
 * Usage:  node led_blackout_verify.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `ledblk_${stamp()}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false, defaultViewport: VP,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) { const s = getComputedStyle(o); if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false; }
    return Array.isArray(window.ledStrandFixtures) && window.ledStrandFixtures.length > 0
      && Array.isArray(window.parFixtures) && window.parFixtures.length > 0;
  }, { timeout: 90000 });
  await sleep(3000);
}

/**
 * Read a full-scene LED snapshot from the LIVE app (in-page). Returns, for the
 * chosen display group:
 *  - maxEntry: the largest RGBWAU magnitude across the group's _batchRenderList
 *    entries (0 ⇒ every consumer that reads raw entry color is black — 2D map,
 *    global dot flush, sACN out).
 *  - maxBulb / maxHalo: the largest per-strand bulb/halo instanceColor magnitude
 *    (0 ⇒ the 3D per-strand meshes are black).
 *  - groupVisible: whether ANY member strand's THREE group is still visible.
 */
async function snapshot(page, group) {
  return page.evaluate((group) => {
    const list = window.__ledBatchTap || null;
    const p = window.__params;
    // Entry magnitude for LED entries in this display group + the 2D-map decode.
    const patchesActive = !!window._patchesActive;
    const showUnpatchedRed = !!(p && p.showUnpatchedRed);
    let maxEntry = 0, ledEntryCount = 0, max2dDecode = 0;
    if (list) {
      for (const e of list) {
        if (!e || e.type !== 'led') continue;
        if (e.displayGroup !== group) continue;
        ledEntryCount++;
        const m = (e.r || 0) + (e.g || 0) + (e.b || 0) + (e.w || 0) + (e.a || 0) + (e.u || 0);
        if (m > maxEntry) maxEntry = m;
        // The 2D Pixel Map's own per-pixel color (frame_source uses this exact fn).
        if (window.__entryDisplayRgb) {
          const [dr, dg, db] = window.__entryDisplayRgb(e, patchesActive, showUnpatchedRed);
          const dm = dr + dg + db;
          if (dm > max2dDecode) max2dDecode = dm;
        }
      }
    }
    // Per-strand bulb/halo instanceColor magnitude for members of this group.
    const disp = (s) => (s.group && s.group.trim()) ? s.group.trim() : 'Ungrouped';
    let maxBulb = 0, maxHalo = 0, groupVisible = false, memberCount = 0;
    (window.ledStrandFixtures || []).forEach((f) => {
      if (!f || disp(f.config) !== group) return;
      memberCount++;
      if (f.group && f.group.visible) groupVisible = true;
      const scan = (inst) => {
        if (!inst || !inst.instanceColor) return 0;
        const a = inst.instanceColor.array; let mx = 0;
        for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
        return mx;
      };
      maxBulb = Math.max(maxBulb, scan(f.bulbInst));
      maxHalo = Math.max(maxHalo, scan(f.haloInst));
    });
    return {
      maxEntry: +maxEntry.toFixed(4), ledEntryCount, max2dDecode: +max2dDecode.toFixed(4),
      maxBulb: +maxBulb.toFixed(4), maxHalo: +maxHalo.toFixed(4),
      groupVisible, memberCount,
      strandsEnabled: p.strandsEnabled,
      override: (p.ledGroupOverrides || {})[group] || null,
    };
  }, group);
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  // Reach the REAL params singleton + subscribe a batch tap (onPixelFrame gives
  // the live _batchRenderList each frame — the exact list the 2D map, the global
  // dot flush and mapPixelsToSacn read). Stub autosave so NOTHING writes the scene.
  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    const animate = await import(`${origin}/simulation/src/core/animate.js`);
    // The EXACT decode the 2D Pixel Map frame source runs per pixel — proving the
    // 2D map renders these pixels black is proving entryDisplayRgb(entry) == 0.
    const blend = await import(`${origin}/simulation/src/core/rgbwau_blend.js`);
    window.__entryDisplayRgb = blend.entryDisplayRgb;
    window.__params = state.params;
    window.__origAutoSave = window.debounceAutoSave;
    window.debounceAutoSave = () => {};
    // Force a deterministic paint source so LED entries carry non-zero color:
    // gradient mode (no external engine needed). Local to THIS probe browser.
    state.params.lightingMode = 'gradient';
    if (state.setLightingMode) state.setLightingMode('gradient');
    window.__ledBatchTap = null;
    animate.onPixelFrame((list) => { window.__ledBatchTap = list; });
  }, ORIGIN);
  await sleep(1500);

  // Determine the display group under test — the first strand's display group
  // (the titanic show scene: all strands are Ungrouped ⇒ the 'Ungrouped' bucket).
  const group = await page.evaluate(() => {
    const s = (window.__params.ledStrands || [])[0];
    if (!s) return null;
    return (s.group && s.group.trim()) ? s.group.trim() : 'Ungrouped';
  });
  console.log(`\nLED display group under test: ${JSON.stringify(group)}`);
  if (!group) { console.error('No LED strands in scene — cannot verify.'); if (!KEEP) await browser.close(); process.exit(1); }

  // Ensure a clean baseline: group ON, master ON.
  await page.evaluate((group) => {
    const p = window.__params;
    p.strandsEnabled = true;
    (window.ledStrandFixtures || []).forEach((f) => f.setVisibility(true));
    if (!p.ledGroupOverrides) p.ledGroupOverrides = {};
    p.ledGroupOverrides[group] = { enabled: true, brightness: 100 };
    if (window.rebuildLedStrands) window.rebuildLedStrands();
  }, group);
  await sleep(1200);
  const on = await snapshot(page, group);
  console.log('[ON ] group on + master on:', JSON.stringify(on));
  await shot(page, 'group_on');

  // ── (1) GROUP master OFF ⇒ black everywhere ──────────────────────────────
  await page.evaluate((group) => {
    const p = window.__params;
    p.ledGroupOverrides[group] = { enabled: false, brightness: 100 };
    // Mirror the GUI onChange: rebuild the group's static visuals immediately.
    (window.ledStrandFixtures || []).forEach((f) => {
      const disp = (f.config.group && f.config.group.trim()) ? f.config.group.trim() : 'Ungrouped';
      if (disp === group && typeof f.rebuildVisuals === 'function') f.rebuildVisuals();
    });
  }, group);
  await sleep(1200);
  const groupOff = await snapshot(page, group);
  console.log('[OFF] GROUP master off :', JSON.stringify(groupOff));
  await shot(page, 'group_off');

  // ── (2) restore, then GLOBAL Master Enabled OFF ⇒ black everywhere ───────
  await page.evaluate((group) => {
    const p = window.__params;
    p.ledGroupOverrides[group] = { enabled: true, brightness: 100 };
    (window.ledStrandFixtures || []).forEach((f) => { if (typeof f.rebuildVisuals === 'function') f.rebuildVisuals(); });
  }, group);
  await sleep(900);
  const reOn = await snapshot(page, group);
  console.log('[ON ] restored          :', JSON.stringify(reOn));

  await page.evaluate((group) => {
    const p = window.__params;
    p.strandsEnabled = false;                                   // Master Enabled OFF
    (window.ledStrandFixtures || []).forEach((f) => f.setVisibility(false));
  }, group);
  await sleep(1200);
  const masterOff = await snapshot(page, group);
  console.log('[OFF] MASTER Enabled off:', JSON.stringify(masterOff));
  await shot(page, 'master_off');

  // Restore master for a clean exit (probe-local only).
  await page.evaluate(() => {
    const p = window.__params;
    p.strandsEnabled = true;
    (window.ledStrandFixtures || []).forEach((f) => f.setVisibility(true));
  });

  // ── Verdict ──────────────────────────────────────────────────────────────
  const isBlack = (s) => s.maxEntry === 0 && s.max2dDecode === 0 && s.maxBulb === 0 && s.maxHalo === 0;
  const groupOffBlack = isBlack(groupOff);
  const masterOffBlack = isBlack(masterOff);
  const onWasLit = on.maxEntry > 0 && on.max2dDecode > 0; // sanity: not always-black

  console.log('\n=== SUMMARY ===');
  console.log(`ON baseline lit (entry & 2D >0)   : ${onWasLit}  (entry=${on.maxEntry} 2dDecode=${on.max2dDecode})`);
  console.log(`GROUP OFF ⇒ BLACK on every path   : ${groupOffBlack}`);
  console.log(`   entry=${groupOff.maxEntry} 2dDecode=${groupOff.max2dDecode} bulb=${groupOff.maxBulb} halo=${groupOff.maxHalo}`);
  console.log(`MASTER OFF ⇒ BLACK on every path  : ${masterOffBlack}`);
  console.log(`   entry=${masterOff.maxEntry} 2dDecode=${masterOff.max2dDecode} bulb=${masterOff.maxBulb} halo=${masterOff.maxHalo} groupVisible=${masterOff.groupVisible}`);
  const noise = errors.filter((e) => /gui_builder|group_lock|animate|exporter|TypeError|is not a function|undefined is not/i.test(e));
  console.log('console errors (filtered):', noise.length);
  noise.slice(0, 15).forEach((e) => console.log('  •', e.slice(0, 160)));
  console.log(`\nRESULT: ${onWasLit && groupOffBlack && masterOffBlack ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
