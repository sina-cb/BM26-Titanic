/*
 * companion_party_capture.cjs — screenshot the Audio Companion's PARTY tab.
 *
 * Verification tool for report 20260725_19: opens the companion UI (default the
 * show machine's :6966), clicks the PARTY nav button, waits for the 10 Hz
 * partyState broadcast to paint real values, and writes a full-page PNG.
 *
 * Usage:
 *   node companion_party_capture.cjs [--url http://10.1.1.151:6966]
 *                                    [--out <dir>] [--wait 6000]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const URL = argOf('--url', 'http://10.1.1.151:6966');
const OUT_DIR = argOf('--out', path.join(process.env.USERPROFILE || process.env.HOME, 'tmp', 'companion_party_tab'));
const WAIT_MS = parseInt(argOf('--wait', '6000'), 10);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
  // Mute page console BEFORE boot — a chatty page otherwise stalls the capture.
  await page.evaluateOnNewDocument(() => {
    console.log = () => {}; console.info = () => {}; console.debug = () => {};
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.nav-btn[data-page="party"]', { timeout: 15000 });
  await page.click('.nav-btn[data-page="party"]');
  await new Promise((r) => setTimeout(r, WAIT_MS));

  // Read back what the tab is actually showing, so the capture is checkable
  // without eyeballing the PNG alone.
  const readout = await page.evaluate(() => {
    const t = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; };
    return {
      gate: t('party-gate-pill'),
      arm: t('party-arm-pill'),
      loudness: t('pm-loud-val'),
      loudThr: t('pm-loud-thr'),
      kickRate: t('pm-kr-val'),
      kickReg: t('pm-reg-val'),
      lowShare: t('pm-low-val'),
      highShare: t('pm-high-val'),
      debounce: t('pm-deb-label'),
      effectiveState: t('psx-eff'),
      playlist: t('psx-playlist'),
      dwell: t('psx-dwell'),
      duration: t('psx-dur'),
      cooldown: t('psx-cool'),
      mood: t('psx-mood'),
      editors: document.querySelectorAll('#party-editors .pe-row').length,
      sessionError: (() => { const e = document.getElementById('psx-err'); return e && e.style.display !== 'none' ? e.textContent : null; })(),
    };
  });

  const file = path.join(OUT_DIR, 'party_tab.png');
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();

  console.log(JSON.stringify({ url: URL, file, readout, pageErrors: errors }, null, 2));
  if (errors.length) process.exitCode = 1;
})().catch((e) => {
  console.error('companion_party_capture failed:', e && e.message);
  process.exit(1);
});
