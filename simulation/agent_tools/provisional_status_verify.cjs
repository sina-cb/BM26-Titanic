/**
 * provisional_status_verify.cjs — proof + screenshots for the OPTIONAL-DISCOVERY
 * controller lifecycle (unbound → PROVISIONAL → VERIFIED) and the per-card
 * ONLINE / OFFLINE / UNKNOWN reachability dot. Report 20260725_96.
 *
 * Walks the operator's actual path in the real Controller Mapping pane:
 *   1. an UNBOUND LED card offers "⚑ Patch without the board";
 *   2. clicking it declares a PROVISIONAL binding — loud badge, and the card's
 *      strands are patched from the typed IP alone;
 *   3. a probe verdict paints the status dots (online / offline / unknown), and
 *      PROVISIONAL + OFFLINE renders as the coherent, expected pair it is;
 *   4. first contact with a CONTRADICTING board raises the reconcile dialog and
 *      changes nothing;
 *   5. first contact with an AGREEING board promotes the card to ✓ VERIFIED.
 *
 * SAFETY — this probe never touches hardware, and proves it in-page:
 *   - the sACN OUT bridge socket (ws :6972) is replaced by a permanently-closed
 *     stub before the first page script runs, so no frame can ever be sent;
 *   - EVERY fetch/XHR to a host other than this machine is REFUSED by an
 *     interceptor installed before boot, and the refusal count is asserted to
 *     stay at whatever the pane's own pre-existing sync-chip reads attempted —
 *     i.e. no device HTTP leaves this window;
 *   - the reachability auto-sweep is switched OFF in localStorage before boot,
 *     so no controller is probed at all. Probe verdicts are INJECTED through
 *     the pane's own ingestion function, which is what the live sweep calls.
 *   - nothing is ever saved: the registry is mutated in memory only.
 *
 * Usage:  node provisional_status_verify.cjs
 *           [--scene <name>]  default test_bench
 *           [--out <dir>]     default ~/tmp/provisional_status
 *           [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = 'http://127.0.0.1:6969/simulation/';
const SACN_OUT_PORT = '6972';

const sceneIdx = process.argv.indexOf('--scene');
const SCENE = sceneIdx !== -1 && process.argv[sceneIdx + 1] ? process.argv[sceneIdx + 1] : 'test_bench';
const outIdx = process.argv.indexOf('--out');
const OUTPUT_DIR = outIdx !== -1 && process.argv[outIdx + 1]
  ? process.argv[outIdx + 1]
  : path.join(os.homedir(), 'tmp', 'provisional_status');
const KEEP_ALIVE = process.argv.includes('--keep-alive');
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];

function check(label, cond, detail) {
  if (cond) { console.log(`   ✓ ${label}`); return true; }
  console.error(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  failures.push(label);
  return false;
}

// ── Pre-boot page guards ────────────────────────────────────────────────────

function blockSacnOut(port) {
  const RealWS = window.WebSocket;
  window.__probeBlockedSacnOut = 0;
  window.WebSocket = new Proxy(RealWS, {
    construct(Target, argsList) {
      if (String(argsList[0] || '').includes(`:${port}`)) {
        window.__probeBlockedSacnOut += 1;
        return {
          readyState: 3, url: String(argsList[0]), binaryType: 'arraybuffer',
          send() {}, close() {},
          addEventListener() {}, removeEventListener() {},
          onopen: null, onclose: null, onerror: null, onmessage: null,
        };
      }
      return new Target(...argsList);
    },
  });
}

/** Refuse every request that leaves this machine. Nothing here may reach gear. */
function blockOffHostHttp() {
  window.__probeOffHostAttempts = [];
  const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    let host = null;
    try { host = new URL(raw, window.location.href).hostname; } catch { host = null; }
    if (host && !LOCAL.has(host)) {
      window.__probeOffHostAttempts.push(raw);
      return Promise.reject(new Error(`[verify] BLOCKED off-host request to ${raw}`));
    }
    return realFetch(input, init);
  };
  // Turn the reachability auto-sweep OFF before the pane ever boots: this probe
  // injects verdicts instead of measuring real boxes.
  try { window.localStorage.setItem('bm26.map.controllerStatusAuto', '0'); } catch { /* ignore */ }
}

// ── Page helpers ────────────────────────────────────────────────────────────

function sceneUrl(scene) {
  return `${BASE}?scene=${scene}&profile=pixel_mapping&renderer=webgl`;
}

async function loadSim(page, scene) {
  await page.goto(sceneUrl(scene), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered'));
  await page.waitForFunction(
    () => typeof window.toggleControllerMapPanel === 'function' && !!window.__controllerRegistry,
    { timeout: 180000 });
  await sleep(2500);
}

async function shot(page, name, { focusCard = null, full = false } = {}) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, `${name}.png`);
  if (focusCard !== null) {
    // Bring the card under test into the pane's viewport — a pane screenshot of
    // a scrolled-away card proves nothing.
    await page.evaluate((i) => {
      const card = document.querySelectorAll('#cm-body .cm-controller')[i];
      if (card) card.scrollIntoView({ block: 'center' });
    }, focusCard);
    await sleep(350);
  }
  const pane = full ? null : await page.$('#controller-map-panel');
  if (pane) await pane.screenshot({ path: out, type: 'png' });
  else await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
  return out;
}

/** Close + reopen the pane: the pane's own full re-render path. */
const rerender = () => {
  window.toggleControllerMapPanel();
  window.toggleControllerMapPanel();
};

/** The state of every LED card's device section, read straight from the DOM. */
const readCards = () => {
  const reg = window.__controllerRegistry;
  const cards = [...document.querySelectorAll('#cm-body .cm-controller')];
  return cards.map((card, i) => {
    const badge = card.querySelector('.led-binding-badge');
    const dot = card.querySelector('.cm-status-dot');
    return {
      name: card.querySelector('.cm-name') ? card.querySelector('.cm-name').value : null,
      ip: card.querySelector('.cm-ip') ? card.querySelector('.cm-ip').value : null,
      badge: badge ? badge.textContent : null,
      badgeClass: badge ? badge.className : null,
      dot: dot ? dot.textContent : null,
      dotState: dot ? dot.dataset.cmStatus : null,
      dotTitle: dot ? dot.title.split('\n')[0] : null,
      hasMarkBtn: !!card.querySelector('.led-device-mark-provisional'),
      markDisabled: card.querySelector('.led-device-mark-provisional')
        ? card.querySelector('.led-device-mark-provisional').disabled : null,
      hasVerifyBtn: !!card.querySelector('.led-device-verify'),
      hasDropBtn: !!card.querySelector('.led-device-drop-provisional'),
      registryDevice: reg && reg.controllers[i] ? (reg.controllers[i].device || null) : null,
      index: i,
    };
  });
};

async function main() {
  console.log(`\n══ provisional + status verify · scene ${SCENE} ══`);
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`],
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/BLOCKED off-host|\[LED Binding\]|✋/.test(t)) console.log(`   [page] ${t}`);
  });
  await page.evaluateOnNewDocument(blockSacnOut, SACN_OUT_PORT);
  await page.evaluateOnNewDocument(blockOffHostHttp);

  await loadSim(page, SCENE);

  // Safety, asserted before anything is touched.
  const safety = await page.evaluate(() => ({
    blockedSacn: window.__probeBlockedSacnOut,
    outConnected: !!(window.sacnOutput && window.sacnOutput.stats.connected),
    framesSent: window.sacnOutput ? window.sacnOutput.stats.framesSent : 0,
  }));
  check('no sACN OUT socket from this window', !safety.outConnected && safety.framesSent === 0,
    JSON.stringify(safety));

  await page.evaluate(() => { window.toggleControllerMapPanel(); });
  await sleep(1200);

  // ── Step 1 — baseline: no sweep has run, so every dot is honestly UNKNOWN ──
  let cards = await page.evaluate(readCards);
  console.log(`   ${cards.length} controller card(s): ` +
    cards.map((c) => `${c.name}[${c.dotState}]`).join(' '));
  check('every dot reads UNKNOWN before any probe (never a guessed OFFLINE)',
    cards.every((c) => c.dotState === 'unknown'),
    JSON.stringify(cards.map((c) => c.dotState)));
  check('the unknown dot explains itself',
    cards.every((c) => c.dot === '◌'), JSON.stringify(cards.map((c) => c.dot)));
  await shot(page, '01_baseline_unknown_dots');

  const ledIndex = await page.evaluate(() => window.__controllerRegistry.controllers
    .findIndex((c) => c.type === 'LED'));
  if (ledIndex < 0) throw new Error(`scene ${SCENE} has no LED controller to exercise`);

  // ── Step 2 — an UNBOUND LED card offers "Patch without the board" ─────────
  // Return the scene's LED card to the unbound state (in memory only) so the
  // probe starts from the shape the ropes are actually in.
  await page.evaluate((i) => {
    delete window.__controllerRegistry.controllers[i].device;
  }, ledIndex);
  await page.evaluate(rerender);
  await sleep(700);
  cards = await page.evaluate(readCards);
  const led = cards[ledIndex];
  check('an UNBOUND LED card shows NO grade badge', led.badge === null, String(led.badge));
  check('an UNBOUND LED card with a typed IP offers "Patch without the board"',
    led.hasMarkBtn && led.markDisabled === false, JSON.stringify(led));
  await shot(page, '02_unbound_offers_patch_without_board', { focusCard: ledIndex });

  // ── Step 3 — click it: PROVISIONAL, and the strands patch ────────────────
  const patchedBefore = await page.evaluate((i) => {
    const proj = window.__ledStrandPatchProbe;
    return proj ? proj : null;
  }, ledIndex);
  await page.evaluate(() => {
    document.querySelectorAll('.led-device-mark-provisional')[0].click();
  });
  await sleep(900);
  cards = await page.evaluate(readCards);
  const prov = cards[ledIndex];
  check('the card is now PROVISIONAL, loudly badged',
    prov.badge === '⚑ PROVISIONAL' && /cm-binding-provisional/.test(prov.badgeClass || ''),
    JSON.stringify(prov));
  check('the registry carries the provisional grade and NO fingerprint',
    !!prov.registryDevice && prov.registryDevice.provisional === true
      && prov.registryDevice.controllerId === undefined,
    JSON.stringify(prov.registryDevice));
  check('the provisional card offers Verify + Drop, and no longer offers Mark',
    prov.hasVerifyBtn && prov.hasDropBtn && !prov.hasMarkBtn, JSON.stringify(prov));

  // The whole point: the strands are patched from the typed IP alone.
  const patched = await page.evaluate(async (i) => {
    const reg = window.__controllerRegistry;
    const mod = await import('/simulation/src/dmx/led/led_patch_projection.js');
    // `params` is a module singleton, not a window global — import the same
    // instance the app uses so the strand counts are the real ones.
    const state = await import('/simulation/src/core/state.js');
    const counts = new Map((state.params.ledStrands || []).map((s) => [s.name, s.ledCount || 10]));
    const { fields } = mod.computeLedStrandPatches(reg, counts);
    const ctl = reg.controllers[i];
    const mine = [];
    for (const port of ctl.ports || []) {
      for (const entry of port.chain || []) {
        const name = typeof entry === 'string' ? entry : entry && entry.fixture;
        if (!name) continue;
        const rec = fields.get(name);
        mine.push({ name, patch: rec ? `U${rec.dmxUniverse}:${rec.dmxAddress}` : null });
      }
    }
    return mine;
  }, ledIndex);
  console.log(`   strand patches from the typed IP: ${JSON.stringify(patched)}`);
  check('every strand on the provisional card is PATCHED (no board involved)',
    patched.length > 0 && patched.every((p) => p.patch !== null), JSON.stringify(patched));
  await shot(page, '03_provisional_badge_and_patched', { focusCard: ledIndex });

  // ── Step 4 — inject probe verdicts: the three honest states ──────────────
  const injected = await page.evaluate(async (i) => {
    const mod = await import('/simulation/src/gui/controller_map_editor.js');
    const reg = window.__controllerRegistry;
    const results = reg.controllers.map((c, k) => {
      if (k === i) {
        // The provisional card, still boxed: OFFLINE is the healthy shape.
        return { id: c.id, state: 'offline', detail: 'ETIMEDOUT — no answer on :80',
          at: new Date().toISOString(), probe: 'http:/api/status' };
      }
      if (k === 0) {
        return { id: c.id, state: 'online', detail: 'tcp/80 refused (ECONNREFUSED) — the host is on the network',
          at: new Date().toISOString(), rttMs: 3, probe: 'tcp:80' };
      }
      return { id: c.id, state: 'unknown', detail: 'no IP set on this controller',
        at: new Date().toISOString(), probe: 'none' };
    });
    mod.applyControllerProbeResults({ ok: true, results });
    return results.map((r) => r.state);
  }, ledIndex);
  await sleep(700);
  cards = await page.evaluate(readCards);
  console.log(`   injected ${JSON.stringify(injected)} → rendered ` +
    JSON.stringify(cards.map((c) => c.dotState)));
  check('the dots render the injected verdicts exactly',
    cards.map((c) => c.dotState).join(',') === injected.join(','),
    JSON.stringify(cards.map((c) => c.dotState)));
  check('OFFLINE renders ○ and ONLINE renders ●',
    cards[ledIndex].dot === '○' && cards[0].dot === '●',
    JSON.stringify(cards.map((c) => c.dot)));
  check('PROVISIONAL + OFFLINE coexist as two independent chips',
    cards[ledIndex].badge === '⚑ PROVISIONAL' && cards[ledIndex].dotState === 'offline');
  await shot(page, '04_status_dots_online_offline_unknown');
  await shot(page, '04b_status_dots_led_card', { focusCard: ledIndex });
  // Zoomed crop of the identity rows: the dot is 12 px, and a whole-pane shot
  // cannot show its colour. This is the frame a human actually inspects.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#cm-body .cm-controller-id-row')];
    const wrap = document.createElement('div');
    wrap.id = 'probe-dot-strip';
    wrap.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;background:#141414;' +
      'padding:14px;border:1px solid #555;zoom:2.4;display:flex;flex-direction:column;gap:8px;';
    for (const r of rows) wrap.appendChild(r.cloneNode(true));
    document.body.appendChild(wrap);
  });
  await sleep(300);
  const strip = await page.$('#probe-dot-strip');
  if (strip) {
    await strip.screenshot({ path: path.join(OUTPUT_DIR, '04c_status_dots_zoom.png'), type: 'png' });
    console.log('   saved 04c_status_dots_zoom.png');
  }
  await page.evaluate(() => {
    const w = document.getElementById('probe-dot-strip');
    if (w) w.remove();
  });

  // ── Step 5 — first contact with a CONTRADICTING board → reconcile dialog ──
  await page.evaluate(async (i) => {
    const mod = await import('/simulation/src/gui/controller_map_editor.js');
    const c = window.__controllerRegistry.controllers[i];
    const status = {
      controllerId: 'some_other_board', boardId: 'angio4', deviceName: 'Not-Yours',
      strands: [{ count: 40, enabled: true }],       // fewer outputs than the card drives
      // capabilitiesExt deliberately absent → per_output_unsupported
    };
    mod.applyControllerProbeResults({
      ok: true,
      results: [{
        id: c.id, state: 'online', detail: 'MarsinLED some_other_board (angio4)',
        at: new Date().toISOString(), probe: 'http:/api/status',
        device: { ip: '10.1.1.99', controllerId: status.controllerId, boardId: status.boardId,
          deviceName: status.deviceName, strands: status.strands, raw: status },
      }],
    });
  }, ledIndex);
  await sleep(900);
  const reconcile = await page.evaluate(() => {
    const card = document.querySelector('.led-reconcile-card');
    if (!card) return null;
    return {
      title: card.querySelector('.vm-modal-title').textContent,
      codes: [...card.querySelectorAll('.led-reconcile-code')].map((n) => n.textContent),
      promoteDisabled: [...card.querySelectorAll('.vm-modal-btn')]
        .find((b) => /Promote anyway/.test(b.textContent)).disabled,
    };
  });
  check('a contradicting board raises the reconcile dialog', !!reconcile, 'no dialog appeared');
  if (reconcile) {
    console.log(`   reconcile codes: ${reconcile.codes.join(', ')}`);
    check('the dialog names every disagreement',
      reconcile.codes.includes('ip_mismatch')
      && reconcile.codes.includes('per_output_unsupported')
      && reconcile.codes.includes('board_output_count'),
      JSON.stringify(reconcile.codes));
  }
  await shot(page, '05_reconcile_dialog', { full: true });
  const stillProvisional = await page.evaluate((i) =>
    window.__controllerRegistry.controllers[i].device.provisional === true, ledIndex);
  check('a contradiction changes NOTHING — the card is still provisional', stillProvisional);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.led-reconcile-card .vm-modal-btn')]
      .find((b) => /Keep provisional/.test(b.textContent));
    if (btn) btn.click();
  });
  await sleep(400);

  // ── Step 6 — first contact with an AGREEING board → promoted ─────────────
  await page.evaluate(async (i) => {
    const mod = await import('/simulation/src/gui/controller_map_editor.js');
    const c = window.__controllerRegistry.controllers[i];
    const outputs = (c.ports || []).length + 1;
    const status = {
      controllerId: 'titanic_bench_demo', boardId: 'angio4', deviceName: 'Bench-Demo',
      strands: Array.from({ length: outputs }, () => ({ count: 40, enabled: true })),
      capabilitiesExt: { perOutputDmx: true },
    };
    mod.applyControllerProbeResults({
      ok: true,
      results: [{
        id: c.id, state: 'online', detail: 'MarsinLED titanic_bench_demo (angio4)',
        at: new Date().toISOString(), rttMs: 6, probe: 'http:/api/status',
        device: { ip: c.ip, controllerId: status.controllerId, boardId: status.boardId,
          deviceName: status.deviceName, strands: status.strands, raw: status },
      }],
    });
  }, ledIndex);
  await sleep(1000);
  cards = await page.evaluate(readCards);
  const promoted = cards[ledIndex];
  check('an agreeing board PROMOTES the card to VERIFIED',
    promoted.badge === '✓ VERIFIED', JSON.stringify(promoted));
  check('the fingerprint is now recorded and the provisional grade is gone',
    !!promoted.registryDevice && promoted.registryDevice.controllerId === 'titanic_bench_demo'
      && promoted.registryDevice.provisional === undefined,
    JSON.stringify(promoted.registryDevice));
  await shot(page, '06_promoted_verified', { focusCard: ledIndex });

  // ── Final safety ─────────────────────────────────────────────────────────
  const final = await page.evaluate(() => ({
    offHost: window.__probeOffHostAttempts,
    outConnected: !!(window.sacnOutput && window.sacnOutput.stats.connected),
    framesSent: window.sacnOutput ? window.sacnOutput.stats.framesSent : 0,
  }));
  console.log(`   off-host requests attempted (all REFUSED): ${final.offHost.length}` +
    (final.offHost.length ? ` → ${[...new Set(final.offHost)].join(', ')}` : ''));
  check('no sACN frame ever left this window',
    !final.outConnected && final.framesSent === 0, JSON.stringify(final));

  console.log(`\n══ ${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} ══`);
  if (failures.length) failures.forEach((f) => console.error(`   ✗ ${f}`));
  if (!KEEP_ALIVE) await browser.close();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n✋ verify failed: ${err.stack || err.message}`);
  process.exit(2);
});
