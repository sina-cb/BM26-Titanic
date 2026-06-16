/**
 * led_guides_test.cjs — integration test for the "Enable LED Guides" toggle
 * and the LED point representation.
 *
 * Loads the real sim, asserts the toggle control exists in the Lighting
 * Controls, then flips it and verifies the strand GUIDES (wire path + drag
 * handles) hide while the LIGHTS (LED point layers) stay visible. Writes
 * before/after screenshots.
 *
 *   xvfb-run -a node led_guides_test.cjs [--url <simUrl>] [--out <dir>]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const argUrl = (() => { const i = process.argv.indexOf('--url'); return i > -1 ? process.argv[i + 1] : null; })();
const SIM_URL = argUrl || 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl';
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : '/root/tmp/led_guides'; })();
const VIEWPORT = { width: 1280, height: 720 };

const results = [];
const check = (name, cond) => { results.push({ name, ok: !!cond }); console.log(`  ${cond ? '✅' : '❌'} ${name}`); };

function strandStats(page) {
  return page.evaluate(() => {
    const fx = window.ledStrandFixtures || [];
    let wires = 0, handles = 0, ledLayers = 0;
    for (const f of fx) {
      f.group.children.forEach((c) => {
        if (c.userData._strandPart === 'wire' && c.visible) wires++;
        if (c.userData._strandPart === 'led' && c.visible) ledLayers++;
      });
      if (f.startHandle.visible) handles++;
      if (f.endHandle.visible) handles++;
    }
    return { strands: fx.length, wires, handles, ledLayers };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false, defaultViewport: VIEWPORT,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    const page = await browser.newPage();
    console.log(`📡 ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.ledStrandFixtures && window.ledStrandFixtures.length > 0
      && typeof window.setLedGuidesVisible === 'function', { timeout: 45000 });
    await page.evaluate(() => { if (typeof window.animateCamera === 'function') window.animateCamera('side'); });
    await new Promise((r) => setTimeout(r, 4000));

    // The toggle control exists in the GUI.
    const hasControl = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.name')).some((e) => e.textContent === 'Enable LED Guides'));
    check('"Enable LED Guides" control present in Lighting Controls', hasControl);

    // Guides ON (default).
    const on = await strandStats(page);
    console.log('  guides ON:', JSON.stringify(on));
    check('strands present', on.strands > 0);
    check('guides on -> wires visible == strands', on.wires === on.strands);
    check('guides on -> handles visible == 2*strands', on.handles === on.strands * 2);
    check('guides on -> LED layers visible == 2*strands (core+glow)', on.ledLayers === on.strands * 2);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, '1_guides_on.png') });
    console.log(`  📸 ${path.join(OUT, '1_guides_on.png')}`);

    // Toggle guides OFF.
    await page.evaluate(() => window.setLedGuidesVisible(false));
    await new Promise((r) => setTimeout(r, 600));
    const off = await strandStats(page);
    console.log('  guides OFF:', JSON.stringify(off));
    check('guides off -> wires hidden (0)', off.wires === 0);
    check('guides off -> handles hidden (0)', off.handles === 0);
    check('guides off -> LIGHTS still visible (LED layers unchanged)', off.ledLayers === on.ledLayers);
    await page.screenshot({ path: path.join(OUT, '2_guides_off.png') });
    console.log(`  📸 ${path.join(OUT, '2_guides_off.png')}`);

    // Toggle back ON.
    await page.evaluate(() => window.setLedGuidesVisible(true));
    await new Promise((r) => setTimeout(r, 600));
    const back = await strandStats(page);
    check('restored -> wires + handles back', back.wires === on.wires && back.handles === on.handles);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? '❌ FAIL' : '✅ PASS'} — ${results.length - failed.length}/${results.length} checks`);
  process.exit(failed.length ? 1 : 0);
})();
