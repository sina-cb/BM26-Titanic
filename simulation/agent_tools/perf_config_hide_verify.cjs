/**
 * perf_config_hide_verify — report `_283`.
 *
 * Operator, 2026-08-16:
 *   (1) "please hide the config from the performance UI — just make sure the
 *        EXIT PERFORMANCE MODE is possible using the UI even if the engine is
 *        not connected, so I can go into edit and go to config to select a new
 *        server or sth"
 *   (2) "in the performance mode, allow playlist changing in the deck and
 *        mixer too."
 *
 * Drives a FRESH DIST of CaptainPad against an ISOLATED, auth-DISABLED engine
 * and asserts:
 *
 *   V1  EDIT mode: CONFIG owns a rail slot.
 *   V2  PERFORMANCE mode: CONFIG (and its sub-views) are gone from the rail,
 *       while Deck / Mixer / Live Touch / Events remain.
 *   V3  V2 again in PORTRAIT — the reversal is orientation-independent.
 *   V4  PERFORMANCE mode: the deck + mixer playlist dropdowns are still
 *       tappable, the library opens, LOADING switches the engine's playlist,
 *       and the library's CRUD rows (NEW / duplicate / delete) are hidden.
 *   V5  THE HARD GATE: with the engine KILLED mid-show, the exit still works
 *       from the UI, in bounded time, and lands somewhere CONFIG is reachable.
 *   V6  A pad that boots having NEVER reached an engine reaches CONFIG with
 *       ZERO taps (the trap the `_250` reversal would otherwise have opened).
 *
 * Every assertion leaves a screenshot behind. NEVER touches ports 6966-6972 —
 * a request interceptor aborts any stray :69xx call.
 *
 * Usage:
 *   node perf_config_hide_verify.cjs --pad 7181 --engine 17968 --engine-pid <pid>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const PAD_PORT = Number(arg('--pad', '7181'));
const ENGINE_PORT = Number(arg('--engine', '17968'));
const ENGINE_PID = arg('--engine-pid', null);
const HOME = process.env.HOME || process.env.USERPROFILE;
const OUT = arg('--out', path.join(HOME, 'tmp', 'perf_config_hide', 'shots'));

const BASE = `http://127.0.0.1:${PAD_PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
/** A black hole: TEST-NET-1 (RFC 5737), reserved and never routed. */
const DEAD_ENGINE = 'http://192.0.2.9:6968';

fs.mkdirSync(OUT, { recursive: true });

async function engine(method, route, body) {
  const res = await fetch(`${ENGINE}${route}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const failures = [];
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`        shot: ${file}`);
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

/**
 * The RAIL is the fixed 112px-wide sidebar at x=0, so a tab label is exactly a
 * short text node whose box starts inside it. Reading geometry (not the DOM
 * tree) keeps this honest if the rail is ever restructured.
 */
async function railLabels(page) {
  return page.evaluate(() => {
    const KNOWN = ['Deck', 'Mixer', 'Live Touch', 'Events', 'Audio', 'Timeline',
      'Scheduler', 'Dimmer Rack', 'Config', 'Studio', 'MIDI', 'OSC', '2D Simulator'];
    const out = new Set();
    for (const el of document.querySelectorAll('div,span')) {
      if (el.children.length !== 0) continue;
      const t = (el.textContent || '').trim();
      if (!KNOWN.includes(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < 112) out.add(t);
    }
    return [...out].sort();
  });
}

async function padState(page) {
  return page.evaluate(() => {
    const body = document.body.innerText || '';
    return {
      engineOfflineBadge: /ENGINE OFFLINE/.test(body),
      localViewBadge: /LOCAL VIEW/.test(body),
      // The mode chip's own label.
      chipEdit: /(^|\n)EDIT(\n|$)/.test(body),
      chipPerf: /(^|\n)(PERF|PERFORMANCE)(\n|$)/.test(body),
      libraryOpen: /PLAYLIST LIBRARY/.test(body),
      switchOnlyHint: /SWITCH ONLY/.test(body),
      hasNewButton: [...document.querySelectorAll('div,span,button')]
        .some((el) => el.children.length === 0 && (el.textContent || '').trim() === 'NEW'),
      // A locked playlist header renders a non-pressable "(locked)" label.
      playlistLocked: /\(locked\)/.test(body),
    };
  });
}

async function newPad(browser, { apiBase = ENGINE, settle = 16000, viewport } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport || { width: 1440, height: 980, deviceScaleFactor: 1 });
  // HARD ISOLATION from the operator's live stack on 6966-6972.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const stray = /:(69[0-9]{2}|5568)\//.test(url) && !url.includes(String(ENGINE_PORT));
    if (stray) return req.abort();
    return req.continue();
  });
  await page.evaluateOnNewDocument((base) => {
    window.localStorage.setItem('API_BASE', base);
    // A console firehose starves the compositor and the capture times out.
    console.log = console.debug = console.info = () => {};
  }, apiBase);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, settle));
  return page;
}

/** Wait until `predicate(state)` holds, returning ms elapsed (or null). */
async function waitFor(page, predicate, timeoutMs = 30000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await padState(page);
    const rail = await railLabels(page);
    if (predicate(s, rail)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`        (timed out waiting for ${label})`);
  return null;
}

(async () => {
  console.log(`Engine ${ENGINE}  ·  Pad ${BASE}  ·  Out ${OUT}`);
  // Start from edit mode.
  const st = await engine('GET', '/performance-mode');
  if (st.data.active) await engine('POST', '/performance-mode', { active: false, exitAction: 'keep' });

  // Two playlists so V4 has something real to switch BETWEEN.
  await engine('POST', '/playlists', { name: 'show_alpha', entries: [
    { id: 'sa_1', pattern: '01_cylon_sweep', label: 'Alpha one', defaults: {} },
    { id: 'sa_2', pattern: '13_sparkle', label: 'Alpha two', defaults: {} },
  ] });
  await engine('POST', '/playlists', { name: 'show_bravo', entries: [
    { id: 'sb_1', pattern: '13_sparkle', label: 'Bravo one', defaults: {} },
  ] });
  await engine('POST', '/deck/playlist', { name: 'show_alpha' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const pad = await newPad(browser);

    // ── V1: EDIT mode shows CONFIG ──────────────────────────────────────
    let rail = await railLabels(pad);
    await shoot(pad, 'v1_edit_mode_config_present');
    check('V1 CONFIG owns a rail slot in edit mode', rail.includes('Config'), rail.join(','));
    check('V1 the edit rail also carries the authoring surfaces',
      rail.includes('Timeline') && rail.includes('Audio'), rail.join(','));

    // ── V2: PERFORMANCE mode hides CONFIG ───────────────────────────────
    await engine('POST', '/performance-mode', { active: true });
    await new Promise((r) => setTimeout(r, 3500));
    rail = await railLabels(pad);
    await shoot(pad, 'v2_performance_mode_config_hidden_landscape');
    check('V2 CONFIG is GONE from the performance rail', !rail.includes('Config'), rail.join(','));
    check('V2 the CONFIG sub-views are gone too',
      !rail.includes('Studio') && !rail.includes('MIDI') && !rail.includes('OSC'), rail.join(','));
    check('V2 the performance surfaces remain',
      ['Deck', 'Mixer', 'Live Touch', 'Events'].every((t) => rail.includes(t)), rail.join(','));
    check('V2 the authoring surfaces stay frozen out',
      !rail.includes('Timeline') && !rail.includes('Audio'), rail.join(','));

    // ── V3: same, PORTRAIT ──────────────────────────────────────────────
    await pad.setViewport({ width: 834, height: 1194, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    rail = await railLabels(pad);
    await shoot(pad, 'v3_performance_mode_config_hidden_portrait');
    check('V3 CONFIG is hidden in portrait too', !rail.includes('Config'), rail.join(','));
    check('V3 the performance surfaces remain in portrait',
      ['Deck', 'Mixer'].every((t) => rail.includes(t)), rail.join(','));
    await pad.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 2500));

    // ── V4: playlist CHANGING during the show ───────────────────────────
    const beforeSwap = await engine('GET', '/deck/playlist');
    let s = await padState(pad);
    await shoot(pad, 'v4a_perf_deck_playlist_dropdown');
    check('V4 the deck playlist header is NOT the "(locked)" label',
      !s.playlistLocked, JSON.stringify({ locked: s.playlistLocked }));

    const opened = await clickText(pad, 'show_alpha', { settle: 2500 });
    s = await padState(pad);
    await shoot(pad, 'v4b_perf_playlist_library_open');
    check('V4 the playlist library OPENS during a show', opened && s.libraryOpen,
      JSON.stringify({ opened, libraryOpen: s.libraryOpen }));
    check('V4 the library hides its CRUD rows while live',
      !s.hasNewButton, JSON.stringify({ newButton: s.hasNewButton }));
    check('V4 the library says WHY the editing rows are gone', s.switchOnlyHint);

    await clickText(pad, 'show_bravo', { settle: 3500 });
    const afterSwap = await engine('GET', '/deck/playlist');
    await shoot(pad, 'v4c_perf_playlist_switched');
    check('V4 the deck playlist actually SWITCHED during the show',
      beforeSwap.data && beforeSwap.data.name === 'show_alpha'
      && afterSwap.data && afterSwap.data.name === 'show_bravo',
      JSON.stringify({ before: beforeSwap.data && beforeSwap.data.name,
        after: afterSwap.data && afterSwap.data.name }));
    check('V4 the show lock is STILL on after the switch',
      (await engine('GET', '/performance-mode')).data.active === true);
    check('V4 playlist CRUD is still refused by the engine',
      (await engine('POST', '/playlists', { name: 'nope_during_show' })).status === 409);

    // ── V5: THE HARD GATE — exit with the engine DEAD ───────────────────
    console.log('\n  --- V5: killing the engine mid-show ---');
    const stillLocked = await engine('GET', '/performance-mode');
    check('V5 precondition: the show lock is on before the kill',
      stillLocked.data.active === true);
    if (!ENGINE_PID) throw new Error('V5 needs --engine-pid');
    execFileSync('taskkill', ['/F', '/PID', String(ENGINE_PID)], { stdio: 'ignore' });

    const tOffline = await waitFor(pad, (st2) => st2.engineOfflineBadge, 40000, 'ENGINE OFFLINE');
    await shoot(pad, 'v5a_engine_dead_perf_face_config_hidden');
    rail = await railLabels(pad);
    check('V5 the pad NOTICES the engine is gone', tOffline !== null,
      tOffline === null ? 'never showed ENGINE OFFLINE' : `${tOffline} ms`);
    check('V5 CONFIG is still hidden on the offline PERFORMANCE face',
      !rail.includes('Config'), rail.join(','));

    // THE EXIT. One tap on the mode chip — no engine, no request, no passcode.
    const tapAt = Date.now();
    await clickText(pad, 'EDIT', { exact: true, settle: 300 });
    const tExit = await waitFor(pad, (st2, r2) => r2.includes('Config'), 30000, 'CONFIG in rail');
    const exitMs = tExit === null ? null : Date.now() - tapAt;
    rail = await railLabels(pad);
    s = await padState(pad);
    await shoot(pad, 'v5b_offline_exit_config_reachable');
    check('V5 EXIT PERFORMANCE works with the engine DEAD', tExit !== null,
      exitMs === null ? 'CONFIG never appeared' : `${exitMs} ms`);
    check('V5 the exit did not hang', exitMs !== null && exitMs < 5000, `${exitMs} ms`);
    check('V5 the pad is HONEST about being offline', s.engineOfflineBadge && s.localViewBadge,
      JSON.stringify({ offline: s.engineOfflineBadge, local: s.localViewBadge }));
    check('V5 the full edit rail came back', rail.includes('Config') && rail.includes('Timeline'),
      rail.join(','));

    // …and CONFIG actually MOUNTS (a visible tab over a blank screen is no fix).
    await clickText(pad, 'Config', { exact: true, settle: 4000 });
    const configBody = await pad.evaluate(() => document.body.innerText || '');
    await shoot(pad, 'v5c_offline_config_screen_mounted');
    check('V5 the CONFIG screen MOUNTS offline (not a blank guard)',
      /ENGINE|CONNECTION|SERVER|ADDRESS/i.test(configBody) && configBody.trim().length > 200,
      `body length ${configBody.trim().length}`);

    // ── V6: a pad that NEVER reached an engine ──────────────────────────
    console.log('\n  --- V6: cold boot against a black hole ---');
    const cold = await newPad(browser, { apiBase: DEAD_ENGINE, settle: 20000 });
    const coldRail = await railLabels(cold);
    const coldState = await padState(cold);
    await shoot(cold, 'v6_cold_boot_black_hole_config_reachable');
    check('V6 a never-connected pad reaches CONFIG with ZERO taps',
      coldRail.includes('Config'), coldRail.join(','));
    check('V6 it still says the engine is offline', coldState.engineOfflineBadge);
    await cold.goto(`${BASE}/config`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 14000));
    const coldConfigBody = await cold.evaluate(() => document.body.innerText || '');
    await shoot(cold, 'v6b_cold_boot_config_deep_link_mounts');
    check('V6 a CONFIG deep link MOUNTS on a never-connected pad',
      coldConfigBody.trim().length > 200, `body length ${coldConfigBody.trim().length}`);

    console.log(`\n  TIMING  offline-detect ${tOffline} ms  ·  UI exit ${exitMs} ms`);
  } finally {
    await browser.close();
  }

  console.log(failures.length === 0
    ? '\nALL CHECKS PASSED'
    : `\n${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
