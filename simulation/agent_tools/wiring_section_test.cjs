/**
 * wiring_section_test.cjs — integration test for the 🔌 Wiring section in
 * Lighting Controls. Drives the real sim: enables the layer, adds components
 * (server + switch), adds a route (wire) between them, toggles layers, and
 * asserts the 3D geometry responds. Writes screenshots.
 *
 *   xvfb-run -a node wiring_section_test.cjs [--out <dir>]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SIM = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=edit&renderer=webgl';
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : '/root/tmp/wiring_section'; })();

const results = [];
const check = (n, c) => { results.push({ n, ok: !!c }); console.log(`  ${c ? '✅' : '❌'} ${n}`); };
const summary = (page) => page.evaluate(() => window.__wiringSummary ? window.__wiringSummary() : null);

(async () => {
  const browser = await puppeteer.launch({
    headless: false, defaultViewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.__wiringSection, { timeout: 45000 });
    await page.evaluate(() => window.animateCamera && window.animateCamera('front'));
    await new Promise((r) => setTimeout(r, 3500));
    fs.mkdirSync(OUT, { recursive: true });

    check('Wiring section present', await page.evaluate(() => !!window.__wiringSection));

    // Enable the layer + add two components (server, switch).
    const res = await page.evaluate(() => {
      const w = window.__wiringSection;
      w.setShow(true);
      const before = w.state.doc.wiring.components.length;
      const beforeRoutes = w.state.doc.wiring.routes.length;
      w.addComponentOfType('server', 'Main Server');
      w.addComponentOfType('switch', 'Switch A');
      const ids = w.state.doc.wiring.components.slice(-2).map((c) => c.id);
      return { before, beforeRoutes, after: w.state.doc.wiring.components.length, ids };
    });
    console.log('  new component ids:', JSON.stringify(res.ids));
    check('two components added (delta)', res.after === res.before + 2);
    const before = await summary(page);
    console.log('  after add components:', JSON.stringify(before));
    check('markers rendered (>=2)', before && before.marker >= 2);
    await page.screenshot({ path: path.join(OUT, '1_components.png') });

    // Add a route (ethernet wire) between the two new components.
    await page.evaluate((a, b) => window.__wiringSection.addRouteByComponentIds(a, b, 'ethernet'), res.ids[0], res.ids[1]);
    check('no validation error', await page.evaluate(() => !window.__wiringError));
    const s = await summary(page);
    console.log('  after add route:', JSON.stringify(s));
    check('cable count increased by 1', s && s.cable === before.cable + 1);
    check('route added (delta)', await page.evaluate((n) => window.__wiringSection.state.doc.wiring.routes.length === n + 1, res.beforeRoutes));
    await page.screenshot({ path: path.join(OUT, '2_route.png') });

    // Toggle the markers layer off — cables stay, markers hide.
    await page.evaluate(() => window.__wiringSection.setLayerVisible('markers', false));
    const noMarkers = await summary(page);
    console.log('  markers off:', JSON.stringify(noMarkers));
    check('markers off -> marker == 0', noMarkers.marker === 0);
    check('markers off -> cable unchanged', noMarkers.cable === s.cable);
    await page.evaluate(() => window.__wiringSection.setLayerVisible('markers', true));

    // Master hide -> everything off.
    await page.evaluate(() => window.__wiringSection.setShow(false));
    const hidden = await summary(page);
    console.log('  show off:', JSON.stringify(hidden));
    check('show off -> all hidden', hidden.cable === 0 && hidden.marker === 0 && hidden.label === 0);
    await page.evaluate(() => window.__wiringSection.setShow(true));
    await page.screenshot({ path: path.join(OUT, '3_restored.png') });

    // Save to wiring.yaml (needs the save server on :6970).
    const saved = await page.evaluate(async () => {
      const sceneName = window.__activeScene || 'titanic';
      const yaml = window.__wiringSection.state.doc;
      try {
        const res = await fetch(`http://localhost:6970/save-wiring?scene=__wiring_test`, {
          method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: JSON.stringify(yaml),
        });
        return res.ok;
      } catch { return 'no-save-server'; }
    });
    console.log('  save endpoint:', saved);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? '❌ FAIL' : '✅ PASS'} — ${results.length - failed.length}/${results.length} checks`);
  process.exit(failed.length ? 1 : 0);
})();
