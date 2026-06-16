/**
 * wiring_ui_test.cjs — integration test for the in-sim "Wiring Layers" panel.
 *
 * Drives the real sim in a headless browser: loads with ?wiring=1, then clicks
 * the layer toggles and asserts that the 3D wiring geometry's visibility
 * actually changes (via window.__wiringSummary()). Also writes before/after
 * screenshots so the toggling can be eyeballed.
 *
 *   xvfb-run -a node wiring_ui_test.cjs [--url <simUrl>] [--out <dir>]
 *
 * Exit code 0 = all assertions pass, 1 = failure.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const argUrl = (() => { const i = process.argv.indexOf('--url'); return i > -1 ? process.argv[i + 1] : null; })();
const SIM_URL = argUrl || 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=edit&renderer=webgl&wiring=1';
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : '/root/tmp/wiring_ui'; })();

const VIEWPORT = { width: 1280, height: 720 };
const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`  ${cond ? '✅' : '❌'} ${name}`);
}

async function summary(page) {
  return page.evaluate(() => window.__wiringSummary());
}
async function clickToggle(page, id) {
  await page.click(`#${id}`);
  await new Promise((r) => setTimeout(r, 250));
}
async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log(`  📸 ${file}`);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('   [page error]', m.text()); });
    console.log(`📡 ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the wiring layer + panel to exist.
    await page.waitForFunction(() => window.__wiringGroup && window.__wiringSummary
      && document.getElementById('wiring-layers-panel'), { timeout: 45000 });
    // Frame the close-up wiring camera so the toggles are visibly obvious.
    await page.evaluate(() => { if (typeof window.animateCamera === 'function') window.animateCamera('wiring'); });
    await new Promise((r) => setTimeout(r, 4000)); // settle render + camera

    // 1) Baseline — everything visible.
    const base = await summary(page);
    console.log('  baseline:', JSON.stringify(base));
    check('panel present', await page.$('#wiring-layers-panel'));
    check('baseline cables == 2', base.cable === 2);
    check('baseline markers == 3', base.marker === 3);
    check('baseline labels == 5', base.label === 5);
    await shot(page, '1_all_on.png');

    // 2) Hide the e-stop route only.
    await clickToggle(page, 'wiring-toggle-route-estop');
    const noEstop = await summary(page);
    console.log('  after hide e-stop:', JSON.stringify(noEstop));
    check('e-stop hidden -> cables == 1', noEstop.cable === 1);
    check('e-stop hidden -> halos == 1', noEstop.halo === 1);
    check('e-stop hidden -> route label dropped (labels == 4)', noEstop.label === 4);
    await shot(page, '2_estop_hidden.png');
    await clickToggle(page, 'wiring-toggle-route-estop'); // restore

    // 3) Hide labels only.
    await clickToggle(page, 'wiring-toggle-labels');
    const noLabels = await summary(page);
    console.log('  after hide labels:', JSON.stringify(noLabels));
    check('labels off -> labels == 0', noLabels.label === 0);
    check('labels off -> cables still 2', noLabels.cable === 2);
    await shot(page, '3_labels_off.png');
    await clickToggle(page, 'wiring-toggle-labels'); // restore

    // 4) Hide the Power family (all demo cables are power).
    await clickToggle(page, 'wiring-toggle-family-power');
    const noPower = await summary(page);
    console.log('  after hide power family:', JSON.stringify(noPower));
    check('power family off -> cables == 0', noPower.cable === 0);
    check('power family off -> markers still 3', noPower.marker === 3);
    await shot(page, '4_power_off.png');
    await clickToggle(page, 'wiring-toggle-family-power'); // restore

    // 5) Master off — everything hidden.
    await clickToggle(page, 'wiring-toggle-master');
    const allOff = await summary(page);
    console.log('  after master off:', JSON.stringify(allOff));
    check('master off -> all hidden', allOff.cable === 0 && allOff.halo === 0
      && allOff.marker === 0 && allOff.label === 0);
    await shot(page, '5_master_off.png');
    await clickToggle(page, 'wiring-toggle-master'); // restore

    // 6) Restored to baseline.
    const restored = await summary(page);
    check('restored to baseline', restored.cable === 2 && restored.marker === 3 && restored.label === 5);
    await shot(page, '6_restored.png');
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? '❌ FAIL' : '✅ PASS'} — ${results.length - failed.length}/${results.length} checks`);
  process.exit(failed.length ? 1 : 0);
})();
