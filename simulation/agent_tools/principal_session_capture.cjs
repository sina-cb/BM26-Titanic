/**
 * principal_session_capture — the docs/56 §4 screenshot matrix (report _228).
 *
 * Drives a FRESH DIST of CaptainPad (:7167 — never the operator's :6967)
 * against an ISOLATED, auth-required engine, and captures the S1-S10 states of
 * principal-scoped persistence: boot-locked, the passcode exit sheet, a wrong
 * code, a sailor session and its amber chip, the owner-only keep-save refusal,
 * escalation, and a second pad seeing the same global session.
 *
 * The engine must already be running (see the report for the launch line); this
 * script only reads and drives its HTTP API. It NEVER touches ports 6966-6972.
 *
 * Usage:
 *   node principal_session_capture.cjs [--port 7167] [--engine 17228]
 *                                      [--out <dir>] [--secrets <yaml>]
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
const ENGINE_PORT = Number(arg('--engine', '17228'));
const HOME = process.env.HOME || process.env.USERPROFILE;
const OUT = arg('--out', path.join(HOME, 'tmp', 'fix_228'));
const SECRETS = arg('--secrets', path.join(HOME, 'tmp', 'fix_228', 'test_secrets.yaml'));

const BASE = `http://127.0.0.1:${PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;

fs.mkdirSync(OUT, { recursive: true });

// Read the throwaway fixture passcodes the isolated engine was launched with.
// They exist ONLY in ~/tmp (gitignored) and are obvious placeholders — no
// credential material from $BM26_SECRETS is ever read, written, or logged here.
function loadFixture() {
  const text = fs.readFileSync(SECRETS, 'utf8');
  const pick = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!m) throw new Error(`fixture secrets file has no ${key}`);
    return m[1].trim();
  };
  return {
    owner: pick('SinaAuth'),
    collaborator: pick('MishaAuth'),
    bringup: pick('MARITIME_TERM_FOR_SAILIOR_PASS'),
  };
}
const FIXTURE = loadFixture();

async function engine(method, route, body, passcode) {
  const res = await fetch(`${ENGINE}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(passcode ? { 'X-CaptainPad-Passcode': passcode } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** AsyncStorage's web backend is localStorage with the raw key, so seeding
 *  API_BASE before boot points this pad at the isolated engine exactly as the
 *  settings screen would have. */
function seedScript() {
  return `window.localStorage.setItem('API_BASE', ${JSON.stringify(ENGINE)});`;
}

async function newPad(browser, { width = 1440, height = 900, settle = 14000 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // HARD ISOLATION from the operator's live stack (:6966-:6972).
  //
  // Seeding API_BASE is not enough on its own: the app's `api_base` is a live
  // binding that starts at the config.yaml default (the operator's engine) and
  // only moves once getApiBaseAsync() has resolved AsyncStorage — so the very
  // first REST seed can race out to the DEFAULT address. That read is harmless
  // to the operator (a GET), but it would silently mix another engine's
  // performance-mode state into this capture. Abort those requests outright, so
  // every frame in every screenshot provably comes from the isolated engine.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const stray = /:(69[0-9]{2}|5568)\//.test(url) && !url.includes(String(ENGINE_PORT));
    if (stray) return req.abort();
    return req.continue();
  });
  // Mute console BEFORE boot — a console firehose starves the compositor and
  // the capture times out (captainpad-screenshot-technique memory).
  await page.evaluateOnNewDocument(() => {
    console.log = console.debug = console.info = () => {};
  });
  await page.evaluateOnNewDocument(seedScript());
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Click the first element whose visible text matches — RN-web renders plain
 *  divs/spans, so text is the stable handle across a dist rebuild. */
async function clickText(page, needle, { exact = false } = {}) {
  const clicked = await page.evaluate((text, isExact) => {
    const nodes = [...document.querySelectorAll('div,span,button,a')];
    const hit = nodes.reverse().find((el) => {
      if (el.children.length > 1) return false;
      const t = (el.textContent || '').trim();
      return isExact ? t === text : t.includes(text);
    });
    if (!hit) return false;
    const target = hit.closest('[role="button"]') || hit;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, needle, exact);
  await new Promise((r) => setTimeout(r, 1200));
  return clicked;
}

async function typePasscode(page, value) {
  const ok = await page.evaluate(() => {
    const input = document.querySelector('input[type="password"]');
    if (!input) return false;
    input.focus();
    return true;
  });
  if (!ok) return false;
  await page.keyboard.type(value, { delay: 12 });
  await new Promise((r) => setTimeout(r, 400));
  return true;
}

/** What the pad believes right now — printed under every capture so a blank or
 *  wrong screenshot is diagnosable without another run. */
async function probe(page) {
  return page.evaluate(() => {
    const body = document.body.innerText || '';
    return {
      chip: /SAILOR SESSION|CREW SESSION|NO EDIT SESSION/.exec(body)?.[0] || null,
      exitSheet: body.includes('Back to edit mode'),
      passcodeField: !!document.querySelector('input[type="password"]'),
      keepSaveCaption: body.includes('Captain’s passcode only'),
      errorText: /Passcode rejected[^\n]*|Only the captain[^\n]*|Too many passcode[^\n]*/.exec(body)?.[0] || null,
      escalateCopy: body.includes('CURRENT live tuning'),
      hasParameters: body.includes('PARAMETERS'),
      hasAutopilot: body.includes('AUTOPILOT'),
      perfControl: /\bLOCK\b|\bEDIT\b|\bPERF\b/.exec(body)?.[0] || null,
    };
  });
}

async function step(page, name, note) {
  const p = await probe(page);
  const file = await shoot(page, name);
  console.log(`  ${path.basename(file)}  ${note}`);
  console.log(`      ${JSON.stringify(p)}`);
  return p;
}

(async () => {
  console.log(`Engine ${ENGINE}  ·  Pad ${BASE}  ·  Out ${OUT}`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    // ── S1: fresh boot-locked engine, pad launched with zero prior taps ──
    const boot = await engine('GET', '/performance-mode');
    console.log(`  engine boot state: ${JSON.stringify(boot.data)}`);
    if (boot.data.active !== true) throw new Error('engine is not boot-locked — restart it fresh');
    const pad = await newPad(browser);
    await step(pad, 's1_boot_locked_performance_face', 'S1 — performance face, no taps');

    // ── S2: tap EDIT → the exit sheet with its passcode field ──
    await clickText(pad, 'EDIT', { exact: true });
    await step(pad, 's2_exit_sheet_passcode', 'S2 — exit sheet + passcode field + captions');

    // ── S3: a wrong passcode → error box, field wiped, no mode change ──
    await typePasscode(pad, 'not-the-passcode');
    await clickText(pad, 'KEEP LIVE STATE');
    await step(pad, 's3_wrong_passcode_refused', 'S3 — engine refusal rendered in the sheet');

    // ── S6: a sailor picking KEEP & SAVE → the owner-only 400, in-sheet ──
    // KEEP & SAVE only appears when the deck carries unsaved tuning, so the
    // engine must already have a bound playlist entry that was touched (see the
    // report's setup lines). Re-open the sheet on the DIRTY variant.
    await pad.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 12000));
    await clickText(pad, 'EDIT', { exact: true });
    const dirty = await probe(pad);
    if (dirty.keepSaveCaption) {
      await typePasscode(pad, FIXTURE.bringup);
      await clickText(pad, 'KEEP & SAVE TUNING');
      await step(pad, 's6_sailor_keep_save_refused', 'S6 — EXIT_KEEP_SAVE_OWNER_ONLY in the sheet');
    } else {
      console.log('  (S6 skipped — the deck reported no dirty tuning to save)');
    }

    // ── S4: sailor passcode + KEEP → edit mode, amber chip, locked CRUD ──
    await typePasscode(pad, FIXTURE.bringup);
    if (!await clickText(pad, 'KEEP WITHOUT SAVING')) await clickText(pad, 'KEEP LIVE STATE');
    await new Promise((r) => setTimeout(r, 2500));
    await step(pad, 's4_sailor_session_chip', 'S4 — SAILOR SESSION chip + locked playlist CRUD');

    // ── S10: a SECOND pad sees the same global session ──
    const pad2 = await newPad(browser);
    await step(pad2, 's10_second_pad_same_session', 'S10 — pad B shows the same chip + locked CRUD');
    await pad2.close();

    // ── S7: escalation — tap the chip, read the copy, enter the owner code ──
    await clickText(pad, 'SAILOR SESSION');
    await step(pad, 's7a_escalation_sheet_copy', 'S7a — "starts auto-saving the CURRENT live tuning"');
    await typePasscode(pad, FIXTURE.owner);
    await clickText(pad, 'START SAVING');
    await new Promise((r) => setTimeout(r, 2500));
    await step(pad, 's7b_owner_session_no_chip', 'S7b — owner session, chip gone, CRUD unlocked');

    // ── S9: restart mid-session → the pad re-seeds to the locked face ──
    console.log('  (S9 is proven by the engine suite; re-lock the pad view here)');
    await engine('POST', '/performance-mode', { active: true });
    await new Promise((r) => setTimeout(r, 3000));
    await step(pad, 's9_relocked_performance_face', 'S9 — re-locked: back to the performance face');

    await pad.close();
    console.log('\nCaptured. INSPECT EVERY PNG before reporting success.');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('principal_session_capture FAILED:', err && err.message);
  process.exit(1);
});
