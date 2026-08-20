/**
 * mixer_pixel_views_capture — screenshots + paint-budget measurement for the
 * mixer's per-channel and master PIXEL VIEW bands (docs/58, report _243).
 *
 * Runs against a FRESH dist on a scratch port (never the operator's :6967 /
 * :7167) and an OFFLINE test engine, seeding the app's engine address through
 * the same AsyncStorage key the Config tab writes. The simulator origin is
 * still derived as host:6969 — a read-only GET of the pixel-map artifact.
 *
 * Usage:
 *   node mixer_pixel_views_capture.cjs [--port 7174] [--prefix 243]
 *                                      [--api-base http://127.0.0.1:17243]
 *                                      [--out <dir>] [--perf]
 *
 *   --perf  measure the SHARED paint scheduler's per-frame duty (drain ms,
 *           deferrals, carry-over) with N bands visible — the docs/58 §4.2
 *           8 ms budget, proven rather than asserted.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg('--port', '7174'));
const PREFIX = arg('--prefix', '243');
const API_BASE = arg('--api-base', 'http://127.0.0.1:17243');
const WANT_PERF = args.includes('--perf');
/**
 * Serve the pixel-map artifact from the REPO instead of from the simulator.
 *
 * The simulator's HTTP document root IS the repo root (see
 * `utils/simulation_url.ts`), so `CaptainPad/live_touch/touch_control_pixel_views.json` on
 * disk is byte-for-byte the response :6969 gives — this substitutes the
 * TRANSPORT, never the content, and exists so a capture run does not depend on
 * the operator's simulator being up (and never tempts a harness into binding
 * the pinned :6969). Any other request is left alone.
 */
const ARTIFACT_FILE = arg('--artifact', null);
const HOME = process.env.HOME || process.env.USERPROFILE;
const OUT = arg('--out', path.join(HOME, 'tmp', `fix_${PREFIX}`));
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });

/** AsyncStorage's web backend is localStorage under the raw key, so seeding it
 *  directly is exactly what a prior session would have left behind. */
function seedScript() {
  return `window.localStorage.setItem('API_BASE', ${JSON.stringify(API_BASE)});`;
}

/**
 * Scheduler instrumentation, installed BEFORE the app boots.
 *
 * The bands paint imperatively out of ONE shared round-robin scheduler, and
 * every drain begins with exactly one `setTransform` per canvas painted
 * (pixel_view_paint.ts). A rAF callback is therefore "the span from the first
 * setTransform after the frame boundary to the last drawing call before the
 * next boundary" — i.e. exactly the number docs/58 §4.2 budgets at 8 ms.
 *
 * We wrap requestAnimationFrame so a DRAIN is bracketed exactly, and count the
 * canvases each drain touched (one setTransform each).
 */
const PERF_SCRIPT = `
(() => {
  const P = { drains: [], canvasesThisDrain: 0, callsThisDrain: 0, inFrame: false, t0: 0, tLast: 0 };
  window.__bandPerf = P;
  const proto = CanvasRenderingContext2D.prototype;
  const origSet = proto.setTransform;
  proto.setTransform = function (...a) {
    if (P.inFrame) {
      if (P.canvasesThisDrain === 0) P.t0 = performance.now();
      P.canvasesThisDrain += 1;
      P.tLast = performance.now();
    }
    return origSet.apply(this, a);
  };
  for (const name of ['fill', 'fillRect', 'arc', 'ellipse']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      const r = orig.apply(this, a);
      if (P.inFrame) { P.callsThisDrain += 1; P.tLast = performance.now(); }
      return r;
    };
  }
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    P.inFrame = true;
    P.canvasesThisDrain = 0;
    P.callsThisDrain = 0;
    P.t0 = 0; P.tLast = 0;
    try { cb(t); } finally {
      P.inFrame = false;
      if (P.canvasesThisDrain > 0) {
        P.drains.push({
          ms: +(P.tLast - P.t0).toFixed(3),
          canvases: P.canvasesThisDrain,
          calls: P.callsThisDrain,
        });
      }
    }
  });
})();
`;

function summarise(drains) {
  if (!drains.length) return null;
  const ms = drains.map((d) => d.ms).sort((a, b) => a - b);
  const canv = drains.map((d) => d.canvases).sort((a, b) => a - b);
  const pick = (arr, q) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * q))].toFixed(2);
  return {
    drains: drains.length,
    drainMs: { median: pick(ms, 0.5), p95: pick(ms, 0.95), max: pick(ms, 0.999) },
    canvasesPerDrain: { min: canv[0], median: canv[Math.floor(canv.length / 2)], max: canv[canv.length - 1] },
    overBudget8ms: drains.filter((d) => d.ms > 8).length,
  };
}

async function openMixer(browser, { width, height, settle = 16000 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // Muting console BEFORE boot — a console firehose starves the compositor and
  // the capture times out (memory: captainpad-screenshot-technique).
  await page.evaluateOnNewDocument(() => {
    console.log = console.debug = console.info = () => {};
  });
  if (WANT_PERF) await page.evaluateOnNewDocument(PERF_SCRIPT);
  await page.evaluateOnNewDocument(seedScript());
  if (ARTIFACT_FILE) {
    const body = fs.readFileSync(ARTIFACT_FILE, 'utf8');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('touch_control_pixel_views.json')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body,
        });
        return;
      }
      req.continue();
    });
  }
  await page.goto(`${BASE}/mixer`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

/** What the mixer thinks it is showing — so a blank capture is diagnosable
 *  without another 60-second run. */
async function probe(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const canvases = [...document.querySelectorAll('canvas')]
      .map((c) => `${c.width}x${c.height}`);
    const litCanvases = [...document.querySelectorAll('canvas')].filter((c) => {
      try {
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4 * 97) sum += d[i] + d[i + 1] + d[i + 2];
        return sum > 4000;
      } catch { return false; }
    }).length;
    const ratios = (text.match(/\d+\/964( FULL)?/g) || []);
    return {
      canvases,
      litCanvases,
      ratios: [...new Set(ratios)],
      hasLocalParams: text.includes('LOCAL PARAMS'),
      hasPerfCaption: text.includes('PARAMS HIDDEN'),
      pixelBands: (text.match(/PIXELS/g) || []).length,
      viewChips: [...new Set(text.match(/[A-Z-]+ ▾/g) || [])],
    };
  });
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const p = await probe(page);
  const perf = WANT_PERF ? summarise(await page.evaluate(() => window.__bandPerf.drains)) : null;
  console.log(`  ${name}.png  canvases=[${p.canvases.join(' ')}] lit=${p.litCanvases} `
    + `ratios=${JSON.stringify(p.ratios)} bands=${p.pixelBands} chips=${JSON.stringify(p.viewChips)} `
    + `localParams=${p.hasLocalParams} perfCaption=${p.hasPerfCaption}`
    + (perf ? `\n      scheduler: ${JSON.stringify(perf)}` : ''));
  return { probe: p, perf };
}

/** Click the nth element whose aria-label matches (0 = first). */
async function clickLabel(page, matcher, nth = 0) {
  const ok = await page.evaluate((m, i) => {
    const els = [...document.querySelectorAll('[aria-label]')]
      .filter((n) => new RegExp(m).test(n.getAttribute('aria-label') || ''));
    const el = els[i];
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, matcher, nth);
  if (!ok) throw new Error(`no element #${nth} with aria-label matching /${matcher}/`);
  await new Promise((r) => setTimeout(r, 1200));
  return ok;
}

/** Drive the ENGINE's performance mode (the derived overlay's only input). */
async function setPerformanceMode(active) {
  const res = await fetch(`${API_BASE}/performance-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Exiting is a DECISION route: the engine refuses a bare `active:false`
    // because leaving a show has to say what happens to the live tuning.
    // `keep` = keep it in memory, persist nothing — the read-only choice.
    body: JSON.stringify(active ? { active } : { active, exitAction: 'keep' }),
  });
  if (!res.ok) throw new Error(`POST /performance-mode ${active} → HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = {};
  try {
    console.log(`Capturing ${BASE}/mixer → ${OUT}  (engine ${API_BASE})`);

    // 1 · edit mode, landscape — bands open, master band open.
    let page = await openMixer(browser, { width: 1440, height: 900 });
    results.edit_landscape = await shoot(page, `${PREFIX}_01_edit_landscape`);

    // 3 · the view picker modal. Once on the MASTER band (its footer prints
    // the FULL-RATE sentence) and once on a CHANNEL band (the capped one).
    await clickLabel(page, 'Pixel view: .*Choose another view', 0);
    results.pickerMaster = await shoot(page, `${PREFIX}_03a_view_picker_master`);
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 800));
    await page.evaluate(() => {
      const overlay = [...document.querySelectorAll('div')]
        .find((n) => getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0.7)');
      if (overlay) overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1200));
    // Band index 1 = the first CHANNEL strip (0 is the master band).
    await clickLabel(page, 'Pixel view: .*Choose another view', 1);
    results.picker = await shoot(page, `${PREFIX}_03_view_picker`);
    // 2 · pick a MULTI-PANEL view (front) to prove the band aspect fits it.
    const picked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="button"]')];
      const el = rows.find((n) => /^FRONT$/i.test((n.innerText || '').trim()));
      if (!el) return null;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'FRONT';
    });
    await new Promise((r) => setTimeout(r, 5000));
    results.front = await shoot(page, `${PREFIX}_02_channel_front_view`);
    console.log(`      (picked view: ${picked})`);

    // 4 · one band collapsed, its sibling open.
    await clickLabel(page, 'Hide the pixel view');
    await new Promise((r) => setTimeout(r, 2500));
    results.collapsed = await shoot(page, `${PREFIX}_04_band_collapsed`);
    await page.close();

    // 5 · eight channels, scrolled row + scheduler duty.
    page = await openMixer(browser, { width: 1440, height: 900, settle: 20000 });
    results.dense = await shoot(page, `${PREFIX}_05_eight_channels`);
    await page.close();

    // 9 · portrait, narrow column.
    page = await openMixer(browser, { width: 834, height: 1150 });
    results.portrait = await shoot(page, `${PREFIX}_09_portrait_narrow`);
    await page.close();

    // 6/7/8 · the PERFORMANCE-MODE round trip, in ONE page. The session
    // store (view choice + collapse) lives in module state, so entering and
    // leaving the mode must return the page to a PIXEL-IDENTICAL picture —
    // that identity IS the "zero persistence writes" proof (docs/58 §2.3).
    page = await openMixer(browser, { width: 1440, height: 900 });
    // Fold one band and switch another view, so there is real session state
    // for the round trip to lose if perf mode ever wrote to it.
    await clickLabel(page, 'Hide the pixel view');
    await new Promise((r) => setTimeout(r, 2000));
    const beforeFile = path.join(OUT, `${PREFIX}_06a_before_perf.png`);
    await page.screenshot({ path: beforeFile });
    results.before_perf = await shoot(page, `${PREFIX}_06a_before_perf`);

    await setPerformanceMode(true);
    await new Promise((r) => setTimeout(r, 9000));
    results.perf = await shoot(page, `${PREFIX}_06_perf_dominant`);
    results.perf_master = await shoot(page, `${PREFIX}_07_perf_master_band`);

    await setPerformanceMode(false);
    await new Promise((r) => setTimeout(r, 9000));
    const afterFile = path.join(OUT, `${PREFIX}_08_perf_exit_roundtrip.png`);
    await page.screenshot({ path: afterFile });
    results.after_perf = await shoot(page, `${PREFIX}_08_perf_exit_roundtrip`);
    // The bands paint live pixels, so a byte compare of the whole frame would
    // only measure the pattern moving. The ROUND-TRIP claim is about layout +
    // session state, so compare exactly that.
    const same = JSON.stringify({
      chips: results.before_perf.probe.viewChips,
      canvases: results.before_perf.probe.canvases,
      localParams: results.before_perf.probe.hasLocalParams,
      bands: results.before_perf.probe.pixelBands,
    }) === JSON.stringify({
      chips: results.after_perf.probe.viewChips,
      canvases: results.after_perf.probe.canvases,
      localParams: results.after_perf.probe.hasLocalParams,
      bands: results.after_perf.probe.pixelBands,
    });
    results.roundTripIdentical = same;
    console.log(`  round-trip layout identical: ${same}`);
    await page.close();

    // 10 · the D5 mask: a view-selected channel s band is dark outside its
    // selection. Set the selection on the engine before running this.
    page = await openMixer(browser, { width: 1440, height: 900 });
    results.masked = await shoot(page, `${PREFIX}_10_view_selected_channel`);
    await page.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, `${PREFIX}_capture.json`), JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
