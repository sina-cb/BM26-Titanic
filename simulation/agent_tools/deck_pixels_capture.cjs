/**
 * deck_pixels_capture — screenshots of the Deck PIXELS window (reports _225,
 * _239).
 *
 * Captures a fresh dist on a scratch port (NEVER the operator's :6967) at a
 * wide and a narrow viewport, with the workspace layout pre-seeded through the
 * SAME AsyncStorage key the app persists, so the run is deterministic.
 *
 * Usage:
 *   node deck_pixels_capture.cjs [--out <dir>] [--port 7167] [--prefix 225]
 *                                [--api-base http://127.0.0.1:17235]
 *                                [--views] [--perf]
 *
 *   --api-base  seed the app's engine address (AsyncStorage key API_BASE), so
 *               the capture can run against an OFFLINE test engine instead of
 *               the live rig. The simulator origin is still derived as
 *               host:6969 (read-only GET of the pixel-map artifact).
 *   --views     one wide capture per AUTHORED VIEW (Top-Down / Front / LED
 *               Strands / TE Sign), clicking the window's own view chips.
 *   --perf      report canvas draw cost per frame + the caption, measured in
 *               the page (see the instrumentation note below).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg('--port', '7167'));
const PREFIX = arg('--prefix', '225');
const API_BASE = arg('--api-base', null);
const WANT_VIEWS = args.includes('--views');
const WANT_PERF = args.includes('--perf');
const OUT = arg('--out', path.join(process.env.HOME || process.env.USERPROFILE, 'tmp', `fix_${PREFIX}`));
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_KEY = 'deck_workspace_layout_v1';
const ALL_WINDOWS = ['patterns', 'parameters', 'autopilot', 'colors', 'pixels'];

fs.mkdirSync(OUT, { recursive: true });

/** AsyncStorage's web backend writes through localStorage; the key it uses is
 *  the raw key, so seeding it directly is exactly what a prior session left. */
function seedScript(closed) {
  const value = JSON.stringify({ closed, known: ALL_WINDOWS });
  let js = `window.localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(value)});`;
  if (API_BASE) js += `window.localStorage.setItem('API_BASE', ${JSON.stringify(API_BASE)});`;
  return js;
}

/**
 * Canvas draw-cost instrumentation, installed BEFORE the app boots.
 *
 * The PIXELS window paints imperatively out of the vis subscriber, so there is
 * no React commit to hook. Every paint begins with exactly one `setTransform`
 * (pixel_view_window.tsx), so a frame is "setTransform → the last drawing call
 * before the next setTransform" and its cost is the wall-clock span between
 * them. Counting the fill calls at the same time gives the per-frame draw-call
 * budget the report quotes.
 */
const PERF_SCRIPT = `
(() => {
  const P = { frames: [], calls: 0, start: null, last: null };
  window.__pixelPerf = P;
  const proto = CanvasRenderingContext2D.prototype;
  const close = () => {
    if (P.start !== null && P.last !== null) {
      P.frames.push({ ms: P.last - P.start, calls: P.calls });
    }
  };
  const origSet = proto.setTransform;
  proto.setTransform = function (...a) {
    close();
    P.start = performance.now();
    P.last = P.start;
    P.calls = 0;
    return origSet.apply(this, a);
  };
  for (const name of ['fill', 'fillRect', 'arc', 'ellipse', 'beginPath']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      const r = orig.apply(this, a);
      P.last = performance.now();
      if (name === 'fill' || name === 'fillRect') P.calls += 1;
      return r;
    };
  }
})();
`;

function summarisePerf(frames) {
  const drawn = frames.filter((f) => f.calls > 0);
  if (!drawn.length) return null;
  const ms = drawn.map((f) => f.ms).sort((a, b) => a - b);
  const calls = drawn.map((f) => f.calls).sort((a, b) => a - b);
  const pick = (arr, q) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * q))].toFixed(2);
  return {
    frames: drawn.length,
    ms: { min: pick(ms, 0), median: pick(ms, 0.5), p95: pick(ms, 0.95), max: pick(ms, 0.999) },
    fillCalls: { min: calls[0], median: calls[Math.floor(calls.length / 2)], max: calls[calls.length - 1] },
  };
}

async function openDeck(browser, { width, height, closed, settle = 15000 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // Muting console BEFORE boot — a console firehose starves the compositor and
  // the capture times out (see the captainpad-screenshot-technique memory).
  await page.evaluateOnNewDocument(() => {
    console.log = console.debug = console.info = () => {};
  });
  if (WANT_PERF) await page.evaluateOnNewDocument(PERF_SCRIPT);
  await page.evaluateOnNewDocument(seedScript(closed));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Let the artifact fetch, the WS connect and a few vis frames land.
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

/** Report what the deck actually thinks it is showing, so a blank capture is
 *  diagnosable without another run. */
async function probeDeck(page) {
  return page.evaluate(() => {
    const wins = [...document.querySelectorAll('[data-deckwindow]')]
      .map((el) => `${el.getAttribute('data-deckwindow')}:${el.getAttribute('data-deckwindowopen')}`);
    const canvases = [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`);
    const body = document.body.innerText || '';
    const caption = (body.match(/\d+ PX · [^\n]+/) || [])[0] || null;
    return { wins, canvases, caption };
  });
}

async function shoot(browser, opts) {
  const page = await openDeck(browser, opts);
  const file = path.join(OUT, `${opts.name}.png`);
  await page.screenshot({ path: file });
  const probe = await probeDeck(page);
  if (WANT_PERF) {
    probe.perf = summarisePerf(await page.evaluate(() => window.__pixelPerf.frames));
  }
  console.log(`  ${opts.name}.png  windows=[${probe.wins.join(' ')}] canvas=[${probe.canvases.join(' ')}] caption=${probe.caption}`
    + (probe.perf ? `\n      draw: ${JSON.stringify(probe.perf)}` : ''));
  await page.close();
  return probe;
}

/** The PIXELS canvas alone, at 2× — glow bloom, crisp cores, per-pixel colour. */
async function shootCanvasZoom(browser, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => { console.log = console.debug = console.info = () => {}; });
  await page.evaluateOnNewDocument(seedScript(opts.closed));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, opts.settle || 15000));
  const probe = await probeDeck(page);
  if (!probe.caption) throw new Error('zoom page never got a vis frame — nothing lit to zoom into');
  console.log(`      (zoom page caption: ${probe.caption})`);
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!box) throw new Error('no canvas on the page — is the PIXELS window open?');
  const file = path.join(OUT, `${opts.name}.png`);
  await page.screenshot({ path: file, clip: box });
  console.log(`  ${opts.name}.png  canvas clip ${Math.round(box.width)}x${Math.round(box.height)} @2x`);
  await page.close();
}

/** One capture per AUTHORED view, driving the window's own view chips. */
async function shootEachView(browser, opts) {
  const page = await openDeck(browser, opts);
  const labels = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
    .map((el) => el.getAttribute('aria-label'))
    .filter((l) => l && l.startsWith('Show the ') && l.endsWith(' pixel view'))
    .map((l) => l.slice('Show the '.length, -' pixel view'.length)));
  if (!labels.length) throw new Error('no view chips found — is the PIXELS window open and the artifact loaded?');
  const results = [];
  for (const label of labels) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const clicked = await page.evaluate((want) => {
      const el = [...document.querySelectorAll('[aria-label]')]
        .find((n) => n.getAttribute('aria-label') === `Show the ${want} pixel view`);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }, label);
    if (!clicked) throw new Error(`view chip '${label}' vanished mid-run`);
    await new Promise((r) => setTimeout(r, 3500));
    if (WANT_PERF) await page.evaluate(() => { window.__pixelPerf.frames.length = 0; });
    await new Promise((r) => setTimeout(r, 3500));
    const file = path.join(OUT, `${opts.name}_${slug}.png`);
    await page.screenshot({ path: file });
    const probe = await probeDeck(page);
    if (WANT_PERF) {
      probe.perf = summarisePerf(await page.evaluate(() => window.__pixelPerf.frames));
    }
    probe.view = label;
    results.push(probe);
    console.log(`  ${opts.name}_${slug}.png  view=${label} caption=${probe.caption}`
      + (probe.perf ? `\n      draw: ${JSON.stringify(probe.perf)}` : ''));
  }
  await page.close();
  return results;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    console.log(`Capturing ${BASE} → ${OUT}${API_BASE ? ` (engine ${API_BASE})` : ''}`);
    if (WANT_VIEWS) {
      // _239: one wide capture per AUTHORED view. PIXELS gets the widest track
      // available so a multi-panel view (front, te_sign) has room to show BOTH
      // of its columns.
      await shootEachView(browser, {
        name: `${PREFIX}_view`,
        width: 1440, height: 900,
        closed: ['colors', 'parameters', 'autopilot'],
      });
      // …and the same views in the tightest wide row, to prove the auto-fit is
      // measured from the glyphs and not tuned to one window size.
      await shoot(browser, { name: `${PREFIX}_wide_all_open`, width: 1440, height: 900, closed: [] });
      await shootCanvasZoom(browser, {
        name: `${PREFIX}_canvas_zoom`,
        width: 1440, height: 900,
        closed: ['colors', 'parameters', 'autopilot'],
      });
      return;
    }
    // 1. WIDE, PIXELS open beside the default three.
    await shoot(browser, { name: '225_wide_pixels_open', width: 1440, height: 900, closed: ['colors'] });
    // 2. WIDE, every window open — the five-track row at its tightest.
    await shoot(browser, { name: '225_wide_all_open', width: 1440, height: 900, closed: [] });
    // 3. WIDE, default layout — PIXELS on the HIDDEN rail (the upgrade case).
    await shoot(browser, { name: '225_wide_default_rail', width: 1440, height: 900, closed: ['colors', 'pixels'] });
    // 4. NARROW, PIXELS open in the stack.
    await shoot(browser, { name: '225_narrow_pixels_open', width: 834, height: 1150, closed: ['colors'] });
    // 5. NARROW, PATTERNS alone — the _217 fullscreen path still holds, and the
    //    second playlist should sit as a COLUMN TO THE RIGHT (_225 order 2).
    await shoot(browser, {
      name: '225_narrow_patterns_fullscreen',
      width: 834, height: 1150,
      closed: ['parameters', 'autopilot', 'colors', 'pixels'],
    });
    // 6. NARROW with the optional windows open — stack order + side-by-side B.
    await shoot(browser, {
      name: '225_narrow_stack_with_optionals',
      width: 834, height: 1150, closed: [],
    });
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('CAPTURE FAILED:', err);
  process.exit(1);
});
