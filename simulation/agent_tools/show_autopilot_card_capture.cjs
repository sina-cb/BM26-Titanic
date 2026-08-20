/**
 * show_autopilot_card_capture — SPECIAL EVENTS tab captures for report `_240`.
 *
 * Proves two operator-visible changes on a real dist build:
 *
 *   1. the SHOW AUTOPILOT card is the simplified three-control card
 *      (NOW PLAYING name · PLAY/PAUSE · 1/5/10/15 MINUTE pills), not the deck's
 *      full AUTOPILOT PATTERNS panel;
 *   2. the quick-effect chip row carries NO `FLASH ALL WHITE`.
 *
 * Usage (from repo root):
 *   node simulation/agent_tools/show_autopilot_card_capture.cjs \
 *     --base http://127.0.0.1:7172 \
 *     --api-base http://127.0.0.1:17239 \
 *     --out ~/tmp/fix_240
 *
 * The engine at --api-base must already have a show ARMED and a stage FIRED —
 * this script only drives the browser. Never point it at the live 6966-6972
 * stack; it is a read-only renderer either way, but the pad talks to whatever
 * engine it is seeded with.
 *
 * Console is muted before boot: in-page log spam starves the compositor and
 * naive captures time out (~30 s). See the captainpad-screenshot-technique note.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('--base', 'http://127.0.0.1:7172');
const API_BASE = arg('--api-base', null);
const OUT = path.resolve(arg('--out', path.join(os.homedir(), 'tmp', 'fix_240'))
  .replace(/^~(?=$|[/\\])/, os.homedir()));

fs.mkdirSync(OUT, { recursive: true });

/** AsyncStorage's web backend writes through localStorage. */
function seedScript() {
  let js = '';
  if (API_BASE) js += `window.localStorage.setItem('API_BASE', ${JSON.stringify(API_BASE)});`;
  return new Function(js);
}

async function shoot(browser, { name, width, height }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    console.log = console.debug = console.info = () => {};
  });
  await page.evaluateOnNewDocument(seedScript());
  await page.goto(`${BASE}/special_events`, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  // Give the tab its first engine round trip + a render settle.
  await new Promise((r) => setTimeout(r, 6000));

  // Read back what the screen actually says, so the capture is self-verifying
  // rather than "a picture was taken".
  const probe = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const has = (s) => text.toUpperCase().includes(s);
    return {
      hasShowAutopilot: has('SHOW AUTOPILOT'),
      hasNowPlaying: has('NOW PLAYING'),
      hasMinutes: has('MINUTES'),
      hasPlayOrPause: has('PLAY') || has('PAUSE'),
      hasFlashAllWhite: has('FLASH ALL WHITE'),
      // The deck panel's own vocabulary — must be absent from this card now.
      hasDeckPanelChrome: has('AUTOPILOT PATTERNS') || has('DECK TX')
        || has('SHUFFLE STYLE') || has('GROUP'),
      excerpt: text.replace(/\s+/g, ' ').slice(0, 600),
    };
  });

  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  console.log(`  ${name}.png`);
  console.log(`     SHOW AUTOPILOT card : ${probe.hasShowAutopilot ? 'yes' : 'NO'}`);
  console.log(`     NOW PLAYING line    : ${probe.hasNowPlaying ? 'yes' : 'NO'}`);
  console.log(`     PLAY/PAUSE          : ${probe.hasPlayOrPause ? 'yes' : 'NO'}`);
  console.log(`     MINUTES pill bar    : ${probe.hasMinutes ? 'yes' : 'NO'}`);
  console.log(`     FLASH ALL WHITE     : ${probe.hasFlashAllWhite ? '*** STILL PRESENT ***' : 'gone'}`);
  console.log(`     deck panel chrome   : ${probe.hasDeckPanelChrome ? '*** STILL PRESENT ***' : 'gone'}`);
  console.log(`     text: ${probe.excerpt}`);
  return probe;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    console.log(`Capturing ${BASE}/special_events → ${OUT}`
      + `${API_BASE ? ` (engine ${API_BASE})` : ''}`);
    await shoot(browser, { name: '240_show_autopilot_card', width: 1440, height: 1000 });
    await shoot(browser, { name: '240_quick_effects_no_flash_all_white', width: 1024, height: 1366 });
  } finally {
    await browser.close();
  }
})();
