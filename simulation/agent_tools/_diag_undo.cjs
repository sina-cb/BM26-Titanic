/* throwaway diagnostic — pinpoint the undo() hang phase after LED generate.
 * Reads-only against the running stack; aborts :6970; closes browser. */
const puppeteer = require('puppeteer');
const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new', defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 40000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = (await browser.pages())[0];
  page.on('console', (m) => { const t = m.text(); if (/^MARK-|^\[undo\]/.test(t)) console.log('  ' + t); });
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (/:6970(\/|$)/.test(req.url())) return req.abort(); req.continue(); });

  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => Array.isArray(window.parFixtures) && window.parFixtures.length > 0
    && !!window.renderParGUI && !!window._ledFixtureInstancesFolder, { timeout: 90000 });
  await sleep(3000);

  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params; window.__params.autoSave = false; window.debounceAutoSave = () => {};
  }, ORIGIN);

  await page.evaluate(() => {
    const open = (title) => { const t = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === title); if (t && t.parentElement.classList.contains('closed')) t.click(); };
    open('🔌 LED Fixtures'); open('✨ Generators');
  });
  await sleep(200);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /\+ TE Sign/.test(b.textContent || '')).click(); });
  await sleep(400);
  await page.evaluate(() => { const ok = document.querySelector('#scene-modal-overlay .scene-modal-ok'); if (ok) ok.click(); });
  await sleep(600);
  console.log('after generate:', await page.evaluate(() => window.__params.parLights.filter((c) => c.group === 'TE Sign 2').length), 'TE Sign 2 members');

  const ev = page.evaluate(async (origin) => {
    const undoMod = await import(`${origin}/simulation/src/core/undo.js`);
    const wrap = (name) => {
      const orig = window[name];
      if (typeof orig !== 'function') { console.log('MARK-ABSENT ' + name); return; }
      window[name] = function (...a) { console.log('MARK-START ' + name); const t = performance.now(); try { return orig.apply(this, a); } finally { console.log('MARK-END ' + name + ' ' + (performance.now() - t).toFixed(0) + 'ms'); } };
    };
    ['rebuildParLights', 'renderParGUI', 'rebuildLedStrands', 'renderStrandGUI', 'renderDmxGUI',
     'renderGeneratorGUI', 'projectControllerMappings', 'applyAllHandlers', '_orderLedFixtureInstances'].forEach(wrap);
    console.log('MARK-START undo()');
    undoMod.undo();
    console.log('MARK-END undo()');
    return 'undo-returned';
  }, ORIGIN);
  ev.catch(() => {});
  const res = await Promise.race([ev, sleep(30000).then(() => '__HUNG__')]);
  console.log('DIAG RESULT:', res);
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
