/**
 * perf_config_hide_shots2 — report `_283`, second capture pass.
 *
 * Fills the two gaps the main run left:
 *   S1  EDIT mode with the rail SCROLLED so CONFIG is visibly in frame (the
 *       first pass asserted it by geometry, but it sat below the scroll fold).
 *   S2  the MIXER surface changing playlist DURING a live show — the deck half
 *       is proven in perf_config_hide_verify.cjs; this is the mixer half.
 *
 * Usage: node perf_config_hide_shots2.cjs --pad 7181 --engine 17968
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PAD_PORT = Number(arg('--pad', '7181'));
const ENGINE_PORT = Number(arg('--engine', '17968'));
const HOME = process.env.HOME || process.env.USERPROFILE;
const OUT = arg('--out', path.join(HOME, 'tmp', 'perf_config_hide', 'shots'));
const BASE = `http://127.0.0.1:${PAD_PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
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
}
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

(async () => {
  // Edit mode, deck on show_alpha, and a mixer channel to drive.
  const st = await engine('GET', '/performance-mode');
  if (st.data.active) await engine('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  for (const p of [
    { name: 'show_alpha', entries: [
      { id: 'sa_1', pattern: '01_cylon_sweep', label: 'Alpha one', defaults: {} },
      { id: 'sa_2', pattern: '13_sparkle', label: 'Alpha two', defaults: {} }] },
    { name: 'show_bravo', entries: [
      { id: 'sb_1', pattern: '13_sparkle', label: 'Bravo one', defaults: {} }] },
  ]) await engine('POST', '/playlists', p);
  await engine('POST', '/deck/playlist', { name: 'show_alpha' });

  const mix = await engine('GET', '/mixer');
  let chId = ((mix.data && mix.data.channels) || [])[0]?.id;
  if (!chId) {
    await engine('POST', '/mixer/channels', { pattern: '13_sparkle' });
    const again = await engine('GET', '/mixer');
    chId = ((again.data && again.data.channels) || [])[0]?.id;
  }
  await engine('POST', `/mixer/channels/${chId}/playlist`, { name: 'show_alpha' });
  console.log(`mixer channel ${chId} on show_alpha`);

  const browser = await puppeteer.launch({
    headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const stray = /:(69[0-9]{2}|5568)\//.test(url) && !url.includes(String(ENGINE_PORT));
      if (stray) return req.abort();
      return req.continue();
    });
    await page.evaluateOnNewDocument((eng) => {
      window.localStorage.setItem('API_BASE', eng);
      console.log = console.debug = console.info = () => {};
    }, ENGINE);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 16000));

    // ── S1: edit-mode rail scrolled so CONFIG is in frame ────────────────
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')]
        .find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Config');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await new Promise((r) => setTimeout(r, 1500));
    const configVisible = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')]
        .find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Config');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= 980 };
    });
    await shoot(page, 's1_edit_mode_config_in_frame');
    check('S1 CONFIG is visibly in frame in edit mode',
      !!configVisible && configVisible.inView && configVisible.left < 112,
      JSON.stringify(configVisible));

    // ── S2: the MIXER changing playlist during a live show ───────────────
    await clickText(page, 'Mixer', { exact: true, settle: 4000 });
    await engine('POST', '/performance-mode', { active: true });
    await new Promise((r) => setTimeout(r, 4000));
    await shoot(page, 's2a_perf_mixer_playlist_dropdown');

    const mixerLocked = await page.evaluate(() => /\(locked\)/.test(document.body.innerText || ''));
    check('S2 the mixer playlist header is NOT the "(locked)" label during a show',
      !mixerLocked, JSON.stringify({ locked: mixerLocked }));

    const before = await engine('GET', `/mixer/channels/${chId}/playlist`);
    const opened = await clickText(page, 'show_alpha', { settle: 2500 });
    const libOpen = await page.evaluate(() => /PLAYLIST LIBRARY/.test(document.body.innerText || ''));
    await shoot(page, 's2b_perf_mixer_library_open');
    check('S2 the mixer playlist library OPENS during a show', opened && libOpen,
      JSON.stringify({ opened, libOpen }));

    await clickText(page, 'show_bravo', { settle: 4000 });
    const after = await engine('GET', `/mixer/channels/${chId}/playlist`);
    await shoot(page, 's2c_perf_mixer_playlist_switched');
    check('S2 the MIXER playlist actually SWITCHED during the show',
      before.data && before.data.name === 'show_alpha'
      && after.data && after.data.name === 'show_bravo',
      JSON.stringify({ before: before.data && before.data.name, after: after.data && after.data.name }));
    check('S2 the show lock is STILL on after the mixer switch',
      (await engine('GET', '/performance-mode')).data.active === true);

    await engine('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  } finally {
    await browser.close();
  }
  console.log(failures.length === 0 ? '\nALL CHECKS PASSED'
    : `\n${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
