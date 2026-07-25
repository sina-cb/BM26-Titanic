/**
 * tesign_verify2.cjs — second pass on the fast pixel_mapping profile (full
 * profile ran ~1 FPS under SwiftShader and timed out captures). Closes the gaps
 * from pass 1: identify console errors, read the patch labels, close-frame the
 * sign, and capture the 2D te_sign view. Connects to the running :6969 stack.
 *
 * Usage:  node tesign_verify2.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = (p) => `${ORIGIN}/simulation/?scene=titanic&profile=${p}&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `tesign_${stamp()}_${name}.png`);
  try { await page.screenshot({ path: p }); console.log(`  📸 ${path.basename(p)}`); }
  catch (e) { console.log(`  ⚠️ screenshot ${name} failed: ${e.message.slice(0, 80)}`); }
}

async function main() {
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`Loading ${SIM('pixel_mapping')}`);
  await page.goto(SIM('pixel_mapping'), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) { const s = getComputedStyle(o); if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false; }
    return Array.isArray(window.parFixtures) && window.parFixtures.some(f => f && f.config && /^TeSignV3/.test(f.config.fixtureType || ''));
  }, { timeout: 90000 });
  await sleep(3000);

  // ── Console errors (print immediately so a later timeout can't hide them) ──
  console.log(`\n=== CONSOLE ERRORS (${errors.length}) ===`);
  errors.forEach((e) => console.log('  •', e.slice(0, 200)));
  console.log('  TeSign/Fixture-related:', errors.filter(e => /FixtureModels|FixtureRegistry|TeSign|te_sign/i.test(e)).length);

  // ── Patch labels: open group + each half card, settle, read the header ──
  const labels = await page.evaluate(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clickTitle = (re) => {
      const t = [...document.querySelectorAll('.title')].find(t => re.test((t.textContent || '').trim()));
      if (t) t.click();
      return !!t;
    };
    clickTitle(/^TE Sign \(\d+\)/); await wait(400);
    clickTitle(/^TE Sign V3 A$/); await wait(400);
    clickTitle(/^TE Sign V3 B$/); await wait(500);
    const txt = document.body.innerText.replace(/\s+/g, ' ');
    const grab = (t) => { const m = txt.match(new RegExp(t + '[^A-Za-z0-9]{0,4}(\\d+)\\s*ch', 'i')); return m ? `${t} · ${m[1]}ch` : null; };
    return { a: grab('TeSignV3A40'), b: grab('TeSignV3B34') };
  });
  console.log('\n[check1] patch labels:', JSON.stringify(labels));
  await shot(page, 'lc_labels2');

  // ── Close-frame the sign (pixel_mapping shows dots) + index chase ──
  await page.evaluate(() => {
    (window.parFixtures || []).forEach((f) => {
      if (!f || !f.config || !/^TeSignV3/.test(f.config.fixtureType || '')) return;
      const n = (f.pixels || []).length;
      for (let j = 0; j < n; j++) {
        const t = n > 1 ? j / (n - 1) : 0;
        let r, g, b;
        if (j === 0) { r = g = b = 1; }                 // start marker = white
        else { r = Math.max(0, 1 - Math.abs(t - 0) * 3); g = Math.max(0, 1 - Math.abs(t - 0.5) * 3); b = Math.max(0, 1 - Math.abs(t - 1) * 3); }
        if (f.setPixelColorRGB) f.setPixelColorRGB(j, r, g, b);
      }
    });
    if (window.focusCameraOnPoint) window.focusCameraOnPoint({ x: 0, y: 9, z: 17 }, { distance: 28, duration: 600 });
  });
  await sleep(1500);
  await shot(page, '3d_sign_close');

  // ── 2D te_sign multiview (S4 geometry sanity) ──
  console.log(`\nLoading ${SIM('2d_pixels')}`);
  try {
    await page.goto(SIM('2d_pixels'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
    await shot(page, '2d_multiview');
    const viewNames = await page.evaluate(() => {
      const t = document.body.innerText;
      return { hasTeSign: /te.?sign/i.test(t), sample: t.slice(0, 300) };
    });
    console.log('[2d] te_sign referenced in panel:', viewNames.hasTeSign);
  } catch (e) { console.log('  ⚠️ 2D pass failed:', e.message.slice(0, 120)); }

  if (!KEEP) await browser.close();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
