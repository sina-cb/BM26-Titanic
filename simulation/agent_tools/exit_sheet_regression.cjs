/**
 * exit_sheet_regression — report `_236`.
 *
 * Operator: "when going from perform mode to the edit mode, now the 'restore
 * pre-show' or the 'Keep live state' isn't making progress anymore."
 *
 * Drives a FRESH DIST of CaptainPad against an ISOLATED, auth-required engine
 * and ASSERTS that the performance-exit sheet always makes progress:
 *
 *   R1  an empty passcode does NOT silently swallow the tap — the choices stay
 *       tappable, the POST goes out, and the engine's 401 renders IN the sheet
 *       (the old build greyed both exits with no explanation anywhere: the tap
 *       fired nothing, said nothing, and the mode never moved);
 *   R2  a wrong passcode renders the refusal and wipes the field;
 *   R3  a refusal OUTSIDE the four edit-session codes still renders — the old
 *       build sent those to `Alert.alert`, which react-native-web implements as
 *       an empty stub, so the sheet sat there mute;
 *   R4  KEEP LIVE STATE resolves: sheet closes, engine reports edit mode;
 *   R5  RESTORE PRE-SHOW resolves the same way;
 *   R6  the CONFIG tab's BOOT MODE toggle renders and both positions persist.
 *
 * Every assertion also leaves a screenshot behind. The engine must already be
 * running; this script only reads and drives its HTTP API, and it NEVER touches
 * ports 6966-6972 (a request interceptor aborts any stray :69xx call).
 *
 * Usage:
 *   node exit_sheet_regression.cjs [--pad 7170] [--engine 17238]
 *                                  [--out <dir>] [--secrets <yaml>]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PAD_PORT = Number(arg('--pad', '7170'));
const ENGINE_PORT = Number(arg('--engine', '17238'));
const HOME = process.env.HOME || process.env.USERPROFILE;
const OUT = arg('--out', path.join(HOME, 'tmp', 'fix_236'));
const SECRETS = arg('--secrets', path.join(HOME, 'tmp', 'fix_236', 'test_secrets.yaml'));

const BASE = `http://127.0.0.1:${PAD_PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;

fs.mkdirSync(OUT, { recursive: true });

/** Throwaway fixture passcodes, obvious placeholders, living only in ~/tmp
 *  (gitignored). No material from the operator's $BM26_SECRETS is ever read. */
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

/** Put the engine back under the show lock so the next case starts clean. */
async function relock() {
  const state = await engine('GET', '/performance-mode');
  if (state.data.active === true) return;
  const entered = await engine('POST', '/performance-mode', { active: true });
  if (entered.status !== 200) throw new Error(`could not re-lock: ${JSON.stringify(entered.data)}`);
}

async function newPad(browser, { settle = 15000 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1 });
  // HARD ISOLATION from the operator's live stack: `api_base` starts at the
  // config default and only moves once getApiBaseAsync() resolves, so the very
  // first REST seed can race out to the operator's engine. Abort it outright.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const stray = /:(69[0-9]{2}|5568)\//.test(url) && !url.includes(String(ENGINE_PORT));
    if (stray) return req.abort();
    return req.continue();
  });
  await page.evaluateOnNewDocument((eng) => {
    window.localStorage.setItem('API_BASE', eng);
    // A console firehose starves the compositor and the capture times out.
    console.log = console.debug = console.info = () => {};
  }, ENGINE);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** RN-web renders plain divs/spans, so visible text is the stable handle. */
async function clickText(page, needle, { exact = false, settle = 1800 } = {}) {
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
  await new Promise((r) => setTimeout(r, settle));
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
  await page.keyboard.type(value, { delay: 15 });
  await new Promise((r) => setTimeout(r, 400));
  return true;
}

async function probe(page) {
  return page.evaluate(() => {
    const body = document.body.innerText || '';
    const choices = [...document.querySelectorAll('[role="button"]')]
      .filter((b) => /KEEP LIVE STATE|KEEP WITHOUT SAVING|KEEP & SAVE|RESTORE PRE-SHOW/i
        .test(b.textContent || ''))
      .map((b) => ({
        label: (b.textContent || '').trim().split('\n')[0].slice(0, 32),
        disabled: b.getAttribute('aria-disabled') === 'true',
        opacity: getComputedStyle(b).opacity,
      }));
    return {
      sheetOpen: /BACK TO EDIT MODE/i.test(body),
      passcodeField: !!document.querySelector('input[type="password"]'),
      passcodeHint: body.includes('requires an operator passcode'),
      // Everything the sheet's error box can say (utils/edit_session.ts).
      errorText: /(An operator passcode is required[^\n]*|Passcode rejected[^\n]*|Only the captain[^\n]*|Too many passcode[^\n]*|Performance mode is already off[^\n]*|The engine refused[^\n]*|The engine did not answer[^\n]*|The pre-show snapshot[^\n]*|Live Touch is armed[^\n]*)/
        .exec(body)?.[0] || null,
      choices,
      bootMode: /BOOT MODE/.test(body),
      hasParameters: body.includes('PARAMETERS'),
    };
  });
}

const failures = [];
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

(async () => {
  console.log(`Engine ${ENGINE}  ·  Pad ${BASE}  ·  Out ${OUT}`);
  await relock();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const pad = await newPad(browser);

    // ── R1: an EMPTY passcode must not swallow the tap ──────────────────
    await clickText(pad, 'EDIT', { exact: true });
    let p = await probe(pad);
    await shoot(pad, 'r1a_sheet_before_any_tap');
    check('R1 sheet opens with the passcode field', p.sheetOpen && p.passcodeField,
      JSON.stringify({ sheetOpen: p.sheetOpen, field: p.passcodeField }));
    check('R1 the passcode field carries a standing explanation', p.passcodeHint);
    check('R1 both exits are TAPPABLE with an empty field',
      p.choices.length === 2 && p.choices.every((c) => !c.disabled),
      JSON.stringify(p.choices));

    await clickText(pad, 'RESTORE PRE-SHOW');
    p = await probe(pad);
    await shoot(pad, 'r1b_empty_passcode_refused_loudly');
    check('R1 an empty submit earns a VISIBLE refusal', !!p.errorText, String(p.errorText));
    check('R1 the engine is still locked after the refusal',
      (await engine('GET', '/performance-mode')).data.active === true);

    // ── R2: a WRONG passcode ────────────────────────────────────────────
    await typePasscode(pad, 'not-the-passcode');
    await clickText(pad, 'KEEP LIVE STATE');
    p = await probe(pad);
    await shoot(pad, 'r2_wrong_passcode_refused');
    check('R2 a wrong passcode renders "Passcode rejected"',
      /Passcode rejected/.test(p.errorText || ''), String(p.errorText));
    check('R2 the field was wiped', await pad.evaluate(
      () => (document.querySelector('input[type="password]') || { value: '' }).value === ''));

    // ── R3: a refusal OUTSIDE the four edit-session codes ───────────────
    // Another pad (here: a direct call) leaves the lock first, so this pad's
    // exit lands on 400 PERFORMANCE_MODE_NOT_ACTIVE — the family of failure the
    // old build routed to the no-op Alert and therefore showed to nobody.
    const raced = await engine('POST', '/performance-mode',
      { active: false, exitAction: 'keep' }, FIXTURE.owner);
    if (raced.status !== 200) throw new Error(`race setup failed: ${JSON.stringify(raced.data)}`);
    await typePasscode(pad, FIXTURE.owner);
    await clickText(pad, 'RESTORE PRE-SHOW');
    p = await probe(pad);
    await shoot(pad, 'r3_non_family_refusal_visible');
    check('R3 a non-family refusal is VISIBLE in the sheet', !!p.errorText, String(p.errorText));

    // ── R4: KEEP LIVE STATE resolves ────────────────────────────────────
    await pad.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 14000));
    await relock();
    await new Promise((r) => setTimeout(r, 2500));
    await clickText(pad, 'EDIT', { exact: true });
    await shoot(pad, 'r4a_before_keep');
    await typePasscode(pad, FIXTURE.owner);
    await clickText(pad, 'KEEP LIVE STATE', { settle: 3500 });
    p = await probe(pad);
    await shoot(pad, 'r4b_after_keep');
    const afterKeep = await engine('GET', '/performance-mode');
    check('R4 KEEP closed the sheet', !p.sheetOpen);
    check('R4 KEEP left performance mode',
      afterKeep.data.active === false && afterKeep.data.editPrincipal === 'owner',
      JSON.stringify(afterKeep.data));

    // ── R5: RESTORE PRE-SHOW resolves ───────────────────────────────────
    await relock();
    await new Promise((r) => setTimeout(r, 2500));
    await clickText(pad, 'EDIT', { exact: true });
    await typePasscode(pad, FIXTURE.owner);
    await clickText(pad, 'RESTORE PRE-SHOW', { settle: 4000 });
    p = await probe(pad);
    await shoot(pad, 'r5_after_restore');
    const afterRestore = await engine('GET', '/performance-mode');
    check('R5 RESTORE closed the sheet', !p.sheetOpen);
    check('R5 RESTORE left performance mode',
      afterRestore.data.active === false, JSON.stringify(afterRestore.data));

    // ── R6: the CONFIG tab's BOOT MODE toggle ───────────────────────────
    await pad.goto(`${BASE}/config`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 12000));
    await pad.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // The card lives in a scroll view; bring it into frame by its heading.
    await pad.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')]
        .find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'BOOT MODE');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await new Promise((r) => setTimeout(r, 1200));
    p = await probe(pad);
    await shoot(pad, 'r6a_boot_mode_performance');
    check('R6 the BOOT MODE group renders on the CONFIG tab', p.bootMode);
    check('R6 the engine starts on bootMode=performance',
      (await engine('GET', '/settings')).data.bootMode === 'performance');

    await clickText(pad, 'Boots unlocked', { settle: 2500 });
    await new Promise((r) => setTimeout(r, 1200));
    await shoot(pad, 'r6b_boot_mode_edit');
    const edit = await engine('GET', '/settings');
    check('R6 tapping EDIT persists bootMode=edit', edit.data.bootMode === 'edit',
      JSON.stringify(edit.data));

    await clickText(pad, 'Boots locked', { settle: 2500 });
    const back = await engine('GET', '/settings');
    check('R6 tapping PERFORMANCE persists bootMode=performance',
      back.data.bootMode === 'performance', JSON.stringify(back.data));
  } finally {
    await browser.close();
  }

  console.log(failures.length === 0
    ? '\nALL CHECKS PASSED'
    : `\n${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
