/**
 * tesign_verify.cjs — live verification for the TE Sign V3 install (slice 14):
 * console cleanliness, fixture-definition registration + patch labels, 74
 * rendered pixels, the 'TE Sign' group select, and a 3D + 2D screenshot pass.
 * Renderer-only (per see_the_world skill); connects to the ALREADY-RUNNING
 * stack on :6969, never starts a server. Output prefix tesign_*.
 *
 * Usage:  node tesign_verify.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = (profile) => `${ORIGIN}/simulation/?scene=titanic&profile=${profile}&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `tesign_${stamp()}_${name}.png`);
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
    return Array.isArray(window.parFixtures) && window.parFixtures.some(f => f && f.config && /^TeSignV3/.test(f.config.fixtureType || ''));
  }, { timeout: 90000 });
  await sleep(3500);
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // ── 3D profile: registration, counts, group select, render ──────────────
  console.log(`Loading ${SIM('full')}`);
  await page.goto(SIM('full'), { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  const probe = await page.evaluate(() => {
    const models = window.fixtureModels || {};
    const signFx = (window.parFixtures || [])
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f && f.config && /^TeSignV3/.test(f.config.fixtureType || ''));
    const THREE = window.__THREE || null;
    const bboxOf = (fxs) => {
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      let count = 0;
      for (const { f } of fxs) {
        if (f.group) f.group.updateMatrixWorld(true);
        (f.pixels || []).forEach((px) => {
          count++;
          const lp = px.localPos;
          if (!lp || !f.group) return;
          const w = lp.clone().applyMatrix4(f.group.matrixWorld);
          mnx = Math.min(mnx, w.x); mxx = Math.max(mxx, w.x);
          mny = Math.min(mny, w.y); mxy = Math.max(mxy, w.y);
          mnz = Math.min(mnz, w.z); mxz = Math.max(mxz, w.z);
        });
      }
      return { count, w: mxx - mnx, h: mxy - mny, d: mxz - mnz };
    };
    return {
      registryKeys: Object.keys(models).filter(k => /TeSign/.test(k)),
      chA: models.TeSignV3A40 ? models.TeSignV3A40.channel_mode : null,
      chB: models.TeSignV3B34 ? models.TeSignV3B34.channel_mode : null,
      sign: signFx.map(({ f, i }) => ({ i, type: f.config.fixtureType, name: f.config.name, group: f.config.group, pixels: (f.pixels || []).length })),
      bbox: bboxOf(signFx),
    };
  });
  console.log('\n[check1] registry TeSign types:', probe.registryKeys, 'ch A/B:', probe.chA, '/', probe.chB);
  console.log('[check1] console errors so far:', errors.length);
  console.log('[check2] sign fixtures:', JSON.stringify(probe.sign));
  console.log('[check2] combined pixel count:', probe.bbox.count,
    `bbox ≈ ${(probe.bbox.w).toFixed(2)} m W × ${(probe.bbox.h).toFixed(2)} m H`);

  // Frame the sign (front direction, pulled in) + light it, then capture.
  await page.evaluate(() => {
    if (window.animateCamera) window.animateCamera('front');
  });
  await sleep(1400);
  await page.evaluate(() => {
    // Rainbow-by-index chase encoding + bright start marker, on both halves.
    (window.parFixtures || []).forEach((f) => {
      if (!f || !f.config || !/^TeSignV3/.test(f.config.fixtureType || '')) return;
      const n = (f.pixels || []).length;
      for (let j = 0; j < n; j++) {
        const t = n > 1 ? j / (n - 1) : 0;
        // HSV-ish ramp: start (j=0) white marker, else hue ramp.
        let r, g, b;
        if (j === 0) { r = g = b = 1; }
        else { const h = t; r = Math.max(0, 1 - Math.abs(h - 0) * 3); g = Math.max(0, 1 - Math.abs(h - 0.5) * 3); b = Math.max(0, 1 - Math.abs(h - 1) * 3); }
        if (f.setPixelColorRGB) f.setPixelColorRGB(j, r, g, b);
      }
    });
    if (window.focusCameraOnPoint) window.focusCameraOnPoint({ x: 0, y: 9, z: 17 }, { distance: 28, duration: 700 });
  });
  await sleep(1600);
  // Re-apply colors right before the shot (guards against a batch overwrite).
  await page.evaluate(() => {
    (window.parFixtures || []).forEach((f) => {
      if (!f || !f.config || !/^TeSignV3/.test(f.config.fixtureType || '')) return;
      const n = (f.pixels || []).length;
      for (let j = 0; j < n; j++) {
        const t = n > 1 ? j / (n - 1) : 0;
        let r, g, b;
        if (j === 0) { r = g = b = 1; }
        else { const h = t; r = Math.max(0, 1 - Math.abs(h - 0) * 3); g = Math.max(0, 1 - Math.abs(h - 0.5) * 3); b = Math.max(0, 1 - Math.abs(h - 1) * 3); }
        if (f.setPixelColorRGB) f.setPixelColorRGB(j, r, g, b);
      }
    });
  });
  await sleep(400);
  await shot(page, '3d_sign_chase');

  // ── Group select via the 'TE Sign' group folder Select-All button ───────
  const groupSel = await page.evaluate(() => {
    // Open Lighting Controls (right drawer) if a toggle exists.
    // Find the lil-gui folder whose title starts with "TE Sign (".
    const titles = [...document.querySelectorAll('.title')];
    const folderTitle = titles.find(t => /^TE Sign \(\d+\)/.test((t.textContent || '').trim()));
    if (!folderTitle) return { found: false, reason: 'no TE Sign group folder in DOM' };
    if (folderTitle.getAttribute('aria-expanded') === 'false' || folderTitle.closest('.lil-gui')?.classList.contains('closed')) {
      folderTitle.click();
    }
    folderTitle.click(); // ensure open
    const folder = folderTitle.parentElement; // lil-gui folder div
    const selBtn = [...folder.querySelectorAll('button')].find(b => /Select All/i.test(b.textContent || ''));
    if (!selBtn) return { found: true, clicked: false, reason: 'no Select-All button under TE Sign folder' };
    selBtn.click();
    // Selected DmxFixtureRuntime tints shellMat to 0x2288ff.
    const sel = (window.parFixtures || []).map((f) => {
      if (!f || !f.config) return null;
      const hex = f.shellMat ? f.shellMat.color.getHex() : null;
      return { name: f.config.name, type: f.config.fixtureType, group: f.config.group, selectedTint: hex === 0x2288ff };
    }).filter(Boolean);
    const sign = sel.filter(s => /^TeSignV3/.test(s.type));
    const otherSelected = sel.filter(s => !/^TeSignV3/.test(s.type) && s.selectedTint).length;
    return {
      found: true, clicked: true,
      signSelected: sign.filter(s => s.selectedTint).length,
      signTotal: sign.length,
      otherSelected,
    };
  });
  console.log('\n[check5] group select:', JSON.stringify(groupSel));
  await shot(page, 'group_selected');

  // ── Patch labels: expand a sign fixture card, read the "· NNNch" header ──
  const labels = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.title')];
    const open = (re) => { const t = titles.find(t => re.test((t.textContent || '').trim())); if (t) t.click(); return !!t; };
    open(/^TE Sign \(\d+\)/);
    open(/TE Sign V3 A/);
    open(/TE Sign V3 B/);
    const txt = document.body.innerText;
    return {
      aLabel: /TeSignV3A40[\s·-]+120ch/.test(txt),
      bLabel: /TeSignV3B34[\s·-]+102ch/.test(txt),
      rawA: (txt.match(/TeSignV3A40[^\n]{0,12}/) || [''])[0],
      rawB: (txt.match(/TeSignV3B34[^\n]{0,12}/) || [''])[0],
    };
  });
  console.log('[check1] patch labels:', JSON.stringify(labels));
  await shot(page, 'lc_patch_labels');

  // ── 2D multiview te_sign view (S4 geometry sanity) ──────────────────────
  console.log(`\nLoading ${SIM('2d_pixels')} for the 2D te_sign view`);
  await page.goto(SIM('2d_pixels'), { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await sleep(6000);
  await shot(page, '2d_multiview');

  console.log('\n=== CONSOLE ERRORS (' + errors.length + ') ===');
  const fixtureNoise = errors.filter(e => /FixtureModels|FixtureRegistry|TeSign/i.test(e));
  console.log('FixtureModels/Registry/TeSign errors:', fixtureNoise.length);
  errors.slice(0, 25).forEach(e => console.log('  •', e.slice(0, 160)));

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
