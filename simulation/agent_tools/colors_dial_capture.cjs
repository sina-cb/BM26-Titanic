/**
 * colors_dial_capture — screenshots of the Deck COLORS window's HUE DIAL and
 * its preset-palette gallery (report _242).
 *
 * Captures a fresh dist on a scratch port (NEVER the operator's :6967), with
 * the workspace layout pre-seeded through the SAME AsyncStorage key the app
 * persists, so the run is deterministic. Follows deck_pixels_capture.cjs — same
 * console-mute-before-boot rule (a console firehose starves the compositor and
 * the capture times out), same raw-localStorage seeding.
 *
 * The MID-DRAG shot is the point of this tool. The dial's whole contract is
 * "touch-down changes nothing, rotation changes everything", and the only way
 * to photograph that is to actually drive the pointer around the ring — which
 * is what `--drag` does through CDP mouse events, so the picture is the real
 * PanResponder path and not a styled mock.
 *
 * Usage:
 *   node colors_dial_capture.cjs [--out <dir>] [--port 7173] [--prefix 242]
 *                                [--api-base http://127.0.0.1:17242]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg('--port', '7173'));
const PREFIX = arg('--prefix', '242');
const API_BASE = arg('--api-base', null);
const OUT = arg('--out', path.join(process.env.HOME || process.env.USERPROFILE, 'tmp', `fix_${PREFIX}`));
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_KEY = 'deck_workspace_layout_v1';
const ALL_WINDOWS = ['patterns', 'parameters', 'autopilot', 'colors', 'pixels'];

fs.mkdirSync(OUT, { recursive: true });

function seedScript(closed) {
  const value = JSON.stringify({ closed, known: ALL_WINDOWS });
  let js = `window.localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(value)});`;
  if (API_BASE) js += `window.localStorage.setItem('API_BASE', ${JSON.stringify(API_BASE)});`;
  return js;
}

async function openDeck(browser, { width, height, closed, settle = 15000 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    console.log = console.debug = console.info = () => {};
  });
  await page.evaluateOnNewDocument(seedScript(closed));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

/** The dial's bounding box, found by its accessibility label. */
async function dialBox(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => (n.getAttribute('aria-label') || '').startsWith('Colour hue dial'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** What the window says its armed slot is sitting at, straight off the glass. */
async function readDegrees(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => (n.getAttribute('aria-label') || '').startsWith('Colour hue dial'));
    const m = (el?.textContent || '').match(/(\d+)°/);
    return m ? Number(m[1]) : null;
  });
}

async function scrollToDial(page) {
  const ok = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => (n.getAttribute('aria-label') || '').startsWith('Colour hue dial'));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  });
  if (!ok) throw new Error('no hue dial on the page — is the COLORS window open?');
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * Scroll an aria-labelled control into view and press it with REAL pointer
 * events. `dispatchEvent(new MouseEvent('click'))` is not enough for a
 * TouchableOpacity: RN-web drives presses off the responder system, so a
 * synthetic click lands on the DOM node and nothing happens.
 */
async function press(page, label) {
  const box = await page.evaluate((want) => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => n.getAttribute('aria-label') === want);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!box) throw new Error(`no control labelled '${label}' on the page`);
  await new Promise((r) => setTimeout(r, 500));
  const now = await page.evaluate((want) => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => n.getAttribute('aria-label') === want);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  await page.mouse.click(now.x, now.y);
  await new Promise((r) => setTimeout(r, 900));
}

/** Bring the saved-palette gallery into frame. */
async function scrollToGallery(page) {
  const ok = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && /^Saved palettes · /.test(n.textContent || ''));
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    return true;
  });
  if (!ok) throw new Error('no "Saved palettes" heading — did the gallery fail to load?');
  await new Promise((r) => setTimeout(r, 800));
}

/** Drive a real rotation around the dial with CDP mouse events. */
async function rotate(page, box, fromTurn, toTurn, steps) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = box.w * 0.38;
  const at = (t) => ({
    x: cx + Math.sin(t * Math.PI * 2) * r,
    y: cy - Math.cos(t * Math.PI * 2) * r,
  });
  const start = at(fromTurn);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = at(fromTurn + (toTurn - fromTurn) * (i / steps));
    await page.mouse.move(p.x, p.y);
    await new Promise((rr) => setTimeout(rr, 30));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    console.log(`Capturing ${BASE} → ${OUT}${API_BASE ? ` (engine ${API_BASE})` : ''}`);

    // ── 1. The dial at rest, and the gallery beneath it ──────────────────
    {
      const page = await openDeck(browser, {
        width: 1440, height: 1000, closed: ['patterns', 'parameters', 'autopilot', 'pixels'],
      });
      await scrollToDial(page);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}_dial_idle.png`) });
      console.log(`  ${PREFIX}_dial_idle.png  armed at ${await readDegrees(page)}°`);
      await page.close();
    }

    // ── 2. THE TAP TEST + the mid-drag indicator ─────────────────────────
    {
      const page = await openDeck(browser, {
        width: 1440, height: 1000, closed: ['patterns', 'parameters', 'autopilot', 'pixels'],
      });
      await scrollToDial(page);
      const box = await dialBox(page);
      if (!box) throw new Error('dial vanished after scroll');
      const before = await readDegrees(page);

      // A PLAIN TAP on the far side of the ring — the exact gesture that used
      // to teleport the hue. The reading must not move.
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      await page.mouse.click(cx, cy + box.h * 0.38);
      await new Promise((r) => setTimeout(r, 600));
      const afterTap = await readDegrees(page);
      console.log(`  TAP on the ring: ${before}° → ${afterTap}°  ${before === afterTap ? 'UNMOVED ✓' : 'MOVED ✗'}`);

      // …then a real rotation, held mid-drag for the shot.
      await rotate(page, box, 0.0, 0.45, 14);
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: path.join(OUT, `${PREFIX}_dial_mid_drag.png`) });
      const mid = await readDegrees(page);
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 400));
      console.log(`  ${PREFIX}_dial_mid_drag.png  ${before}° → ${mid}° over 0.45 turn of finger`);
      await page.close();
    }

    // ── 3. The GALLERY: named and unnamed entries side by side ───────────
    {
      const page = await openDeck(browser, {
        width: 1440, height: 1000, closed: ['patterns', 'parameters', 'autopilot', 'pixels'],
      });
      await scrollToGallery(page);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}_preset_gallery.png`) });
      const chips = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
        .map((n) => n.getAttribute('aria-label'))
        .filter((l) => l && l.startsWith('Load ')));
      console.log(`  ${PREFIX}_preset_gallery.png  chips=${JSON.stringify(chips)}`);
      await page.close();
    }

    // ── 4. The SAVE flow: the name dialog, with the generated icon ───────
    {
      const page = await openDeck(browser, {
        width: 1440, height: 1000, closed: ['patterns', 'parameters', 'autopilot', 'pixels'],
      });
      await scrollToDial(page);
      await press(page, 'SAVE PALETTE');
      await page.screenshot({ path: path.join(OUT, `${PREFIX}_save_name_dialog.png`) });
      // The title is rendered uppercase by the sheet's `labelCaps` recipe, and
      // Chrome's innerText reflects text-transform — so the probe has to be
      // case-insensitive or it reports a visible dialog as missing.
      const seen = await page.evaluate(() => /name this palette/i.test(document.body.innerText));
      console.log(`  ${PREFIX}_save_name_dialog.png  dialog visible=${seen}`);
      await page.close();
    }

    // ── 5. NARROW — the whole window in the one-column layout ────────────
    {
      const page = await openDeck(browser, {
        width: 820, height: 1180, closed: ['patterns', 'parameters', 'autopilot', 'pixels'],
      });
      await scrollToDial(page);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}_narrow.png`), fullPage: true });
      console.log(`  ${PREFIX}_narrow.png`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
