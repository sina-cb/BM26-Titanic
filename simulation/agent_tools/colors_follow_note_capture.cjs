/**
 * colors_follow_note_capture — screenshots of the Deck COLORS window's FOLLOW
 * NOTE card and of LIVE RETUNE on a running rotation (report _248, docs/59).
 *
 * Captures a fresh dist on a scratch port (NEVER the operator's :6967) against
 * an OFFLINE engine on a scratch port, and drives that engine directly over
 * HTTP to put the rig into the state each shot is supposed to prove. Follows
 * colors_dial_capture.cjs — same console-mute-before-boot rule (a console
 * firehose starves the compositor and the capture times out), same raw
 * localStorage seeding of the workspace layout.
 *
 * THE POINT OF THE TOOL is the two-frame retune shot. Live retune's whole
 * contract is "the rotation keeps running through a knob change" — the failure
 * it replaces was a visible restart — and the only way to photograph the
 * ABSENCE of a restart is to hold the camera on a running fade, change the
 * cadence underneath it, and show two consecutive frames that are still walking
 * the same arc. A static screenshot of a pill cannot say that.
 *
 * The note is INJECTED through the engine's `POST /param-center` (the
 * hil_audio_reactive_profile trick). The microphone is never opened and the
 * live audio companion is never contacted.
 *
 * Usage:
 *   node colors_follow_note_capture.cjs [--out <dir>] [--port 7177]
 *                                       [--api-base http://127.0.0.1:17248]
 *                                       [--prefix 248]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(arg('--port', '7177'));
const PREFIX = arg('--prefix', '248');
const API_BASE = arg('--api-base', 'http://127.0.0.1:17248');
const OUT = arg('--out', path.join(process.env.HOME || process.env.USERPROFILE, 'tmp', `fix_${PREFIX}`));
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_KEY = 'deck_workspace_layout_v1';
const ALL_WINDOWS = ['patterns', 'parameters', 'autopilot', 'colors', 'pixels'];
const ONLY_COLORS = ['patterns', 'parameters', 'autopilot', 'pixels'];

fs.mkdirSync(OUT, { recursive: true });

// ── the engine side ─────────────────────────────────────────────────────────

async function eng(method, url, body) {
  const res = await fetch(API_BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* some routes return no body */ }
  return { status: res.status, data };
}

async function cpc(key) {
  const r = await eng('GET', '/param-center');
  const params = r.data && (r.data.params || r.data);
  const slot = params && params[key];
  if (slot === undefined) return undefined;
  return (slot && typeof slot === 'object' && 'value' in slot) ? slot.value : slot;
}

const setNote = (pc, hue) => eng('POST', '/param-center', { audioNote: pc, audioNoteHue: hue });
const setSilence = (v) => eng('POST', '/param-center', { audioSilence: v });

// ── the browser side ────────────────────────────────────────────────────────

function seedScript(closed) {
  const value = JSON.stringify({ closed, known: ALL_WINDOWS });
  let js = `window.localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(value)});`;
  js += `window.localStorage.setItem('API_BASE', ${JSON.stringify(API_BASE)});`;
  return js;
}

async function openDeck(browser, { width, height, closed = ONLY_COLORS, settle = 15000 }) {
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

/** Press a control by its accessibility label, with REAL pointer events — a
 *  synthetic click lands on the DOM node and a TouchableOpacity ignores it. */
async function press(page, label) {
  const find = (want) => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find((n) => n.getAttribute('aria-label') === want);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  // A control can take an extra beat to mount once the engine starts pushing WS
  // frames, so wait for it rather than failing the whole run on a slow boot.
  let seen = null;
  for (let i = 0; i < 20 && !seen; i++) {
    seen = await page.evaluate(find, label);
    if (!seen) await new Promise((r) => setTimeout(r, 500));
  }
  if (!seen) throw new Error(`no control labelled '${label}'`);
  await new Promise((r) => setTimeout(r, 400));
  const at = await page.evaluate(find, label);
  await page.mouse.click(at.x, at.y);
  await new Promise((r) => setTimeout(r, 900));
}

/**
 * Press the control labelled `label` that belongs to the pill row headed by
 * `rowLabel`.
 *
 * Scoping matters: the deck screen carries several TimerPillBars, and the deck
 * TRANSITION duration row has a "3s" pill too. A bare
 * `querySelectorAll('[aria-label]').find(...)` takes the FIRST in DOM order —
 * which silently pressed the transition pill and left the crossfade's fade at
 * 8 s while the run reported success. Anchor on the row's own label and walk up
 * only until an ancestor contains the pill.
 */
async function pressInRow(page, rowLabel, label) {
  const find = ([row, want]) => {
    const head = [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === row);
    if (!head) return null;
    let scope = head.parentElement;
    let hit = null;
    while (scope && !hit) {
      hit = scope.querySelector(`[aria-label="${want}"]`);
      if (!hit) scope = scope.parentElement;
    }
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center' });
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  if (!await page.evaluate(find, [rowLabel, label])) {
    throw new Error(`no '${label}' pill under the '${rowLabel}' row`);
  }
  await new Promise((r) => setTimeout(r, 400));
  const at = await page.evaluate(find, [rowLabel, label]);
  await page.mouse.click(at.x, at.y);
  await new Promise((r) => setTimeout(r, 900));
}

/** Scroll the element whose text matches `re` into view, and report it. */
async function scrollToText(page, source) {
  const ok = await page.evaluate((src) => {
    const re = new RegExp(src);
    const el = [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && re.test(n.textContent || ''));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    return el.textContent;
  }, source);
  if (ok === null) throw new Error(`nothing on the page matching /${source}/`);
  await new Promise((r) => setTimeout(r, 700));
  return ok;
}

/** The card's state line, read straight off the glass. */
const readStateLine = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('*')]
    .find((n) => n.children.length === 0 && /^(NOTE IS DRIVING|FOLLOW NOTE —)/.test(n.textContent || ''));
  return el ? el.textContent : null;
});

const FOLLOW = {
  active: true,
  mode: 'followNote',
  followNote: {
    schemes: ['complement', 'contrast', 'analogous', 'triadic', 'split', 'tetrad', 'golden'],
    methodHoldS: 30, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false,
  },
};
const CROSSFADE = {
  active: true, mode: 'palettes',
  palettes: [{ c1: 0.08, c2: 0.62 }, { c1: 0.62, c2: 0.08 }],
  delay_s: 0, transitionMs: 8000,
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${PREFIX}_${name}.png`) });
  try {
    console.log(`Capturing ${BASE} → ${OUT}  (engine ${API_BASE})`);
    await eng('POST', '/param-center/source-lock', {
      mode: 'allow', keys: { audioNote: 'api', audioNoteHue: 'api', audioSilence: 'api' },
    });

    // ── 1. THE CARD, PARKED ────────────────────────────────────────────────
    await eng('POST', '/deck/color-autopilot', { active: false });
    {
      const page = await openDeck(browser, { width: 1440, height: 1100 });
      await press(page, 'Follow note mode');
      await scrollToText(page, 'Methods in the cycle');
      await shot(page, 'follow_note_parked');
      console.log(`  ${PREFIX}_follow_note_parked.png   "${await readStateLine(page)}"`);
      await page.close();
    }

    // ── 2. RUNNING: the note is driving, a method is on the rig ─────────────
    {
      await setSilence(0);
      await setNote(4, 0.25);
      const page = await openDeck(browser, { width: 1440, height: 1100 });
      await press(page, 'Follow note mode');
      await eng('POST', '/deck/color-autopilot', FOLLOW);
      await new Promise((r) => setTimeout(r, 1500));
      await setNote(7, 0.61803);                 // a real note change, mid-shot
      await new Promise((r) => setTimeout(r, 1500));
      await scrollToText(page, 'NOTE IS DRIVING');
      await shot(page, 'follow_note_running');
      console.log(`  ${PREFIX}_follow_note_running.png  "${await readStateLine(page)}"`);

      // …and the METHOD CYCLING, photographed one advance later.
      await eng('PATCH', '/deck/color-autopilot', { followNote: { method: 'tetrad' } });
      await new Promise((r) => setTimeout(r, 3500));
      await scrollToText(page, 'NOTE IS DRIVING');
      await shot(page, 'follow_note_method_changed');
      console.log(`  ${PREFIX}_follow_note_method_changed.png  "${await readStateLine(page)}"`
        + `  rig c2.h=${JSON.stringify((await cpc('colorPalette2')).h)}`);
      await page.close();
    }

    // ── 3. SILENCE: the card SAYS it is holding, the rig does not move ──────
    {
      await setSilence(1);
      await new Promise((r) => setTimeout(r, 600));
      const held = await cpc('colorPalette1');
      const page = await openDeck(browser, { width: 1440, height: 1100 });
      await press(page, 'Follow note mode');
      await scrollToText(page, 'HOLDING LAST NOTE');
      await shot(page, 'follow_note_silence_hold');
      const still = await cpc('colorPalette1');
      console.log(`  ${PREFIX}_follow_note_silence_hold.png  "${await readStateLine(page)}"`);
      console.log(`      rig held: ${JSON.stringify(held)} → ${JSON.stringify(still)}`
        + `  ${held.h === still.h ? 'UNMOVED ✓' : 'MOVED ✗'}`);
      await page.close();
      await setSilence(0);
    }

    // ── 4. LIVE RETUNE, two frames across a mid-fade pill change ───────────
    //     A continuous 8 s crossfade is running. We photograph it, tap a
    //     DIFFERENT fade pill mid-fade, and photograph it again. The proof is
    //     that frame B is further along the SAME arc than frame A — the fade
    //     kept walking. A restart would have snapped it back to an endpoint.
    {
      await eng('POST', '/deck/color-autopilot', CROSSFADE);
      const page = await openDeck(browser, { width: 1440, height: 1100 });
      await new Promise((r) => setTimeout(r, 2500));
      const a = await cpc('colorPalette1');
      await scrollToText(page, 'ENGINE: FADE');
      await shot(page, 'retune_before');
      console.log(`  ${PREFIX}_retune_before.png  live c1.h=${a.h.toFixed(6)}`
        + `  "${await scrollToText(page, 'ENGINE: FADE')}"`);

      // FADE 8 s → 3 s, MID-FADE. By the pill's own accessibility label, not by
      // its text: the pill rows live in a horizontal ScrollView and the label is
      // what the operator's screen reader (and this tool) can address reliably.
      await pressInRow(page, 'Fade · one step', 'Set to 3s');
      await new Promise((r) => setTimeout(r, 1200));
      const b = await cpc('colorPalette1');
      const cfg = (await eng('GET', '/deck/color-autopilot')).data;
      await scrollToText(page, 'ENGINE: FADE');
      await shot(page, 'retune_after');
      console.log(`  ${PREFIX}_retune_after.png   live c1.h=${b.h.toFixed(6)}`
        + `  transitionMs now ${cfg.transitionMs}  "${await scrollToText(page, 'ENGINE: FADE')}"`);
      if (cfg.transitionMs !== 3000) {
        throw new Error(`the FADE pill did not land: transitionMs is still ${cfg.transitionMs}`);
      }
      const moved = Math.abs(b.h - a.h);
      const snapped = Math.abs(b.h - 0.08) < 1e-6 || Math.abs(b.h - 0.62) < 1e-6;
      console.log(`      arc walked ${moved.toFixed(6)} in hue; landed on an endpoint? ${snapped ? 'YES ✗' : 'NO ✓'}`);
      await page.close();
    }

    // ── 5. NARROW: the card in the single-column deck ──────────────────────
    {
      await eng('POST', '/deck/color-autopilot', FOLLOW);
      await setNote(2, 0.44);
      const page = await openDeck(browser, { width: 820, height: 1180 });
      await press(page, 'Follow note mode');
      await scrollToText(page, 'Methods in the cycle');
      await shot(page, 'follow_note_narrow');
      console.log(`  ${PREFIX}_follow_note_narrow.png  820 px  "${await readStateLine(page)}"`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
