/**
 * shared_address_verify.cjs — LIVE proof for the shared-address feature
 * (operator order 2026-07-31, report 20260725_102):
 *
 *   "make controllers allow sending to the same address with a warning instead
 *    of an error — and for those, make sure you unify the packets and then
 *    send; if conflicting, prioritize higher IPs and override."
 *   "…but the UI must show that that's a warning."
 *
 * What it proves, in the real running sim:
 *   1. The Controller Mapping pane renders a PERSISTENT ⚠ warning banner on the
 *      affected card — naming both claimants, the exact (universe, channel
 *      range) and who wins — where the old code refused the push outright.
 *      SCREENSHOT: `2_shared_address_warning.png` (this is the operator's
 *      required evidence).
 *   2. The wire is UNIFIED: exactly ONE destination (and therefore one packet)
 *      per (universe, controller IP), never two claimants racing.
 *   3. The HIGHER IP overrides on the contested channels — asserted on the real
 *      universe buffer the sim would transmit, byte for byte, in BOTH render
 *      orders.
 *   4. An UNRANKABLE overlap (same IP) renders the ERROR grade instead, visibly
 *      different from the warning. SCREENSHOT: `3_unrankable_error.png`.
 *
 * SAFETY (service grant 2026-07-31):
 *   • The sACN OUT bridge socket (ws :6972) is blocked before the first page
 *     script runs, and the block is ASSERTED before anything is touched — this
 *     window can never put a frame on the wire.
 *   • ZERO device HTTP: the injected controllers are UNBOUND (no `device`
 *     block), nothing is pushed, no discovery is run.
 *   • ZERO scene writes: the two overlapping controllers are injected into the
 *     IN-MEMORY registry only and removed again at the end, and EVERY non-GET
 *     request to the save server on :6970 is aborted by request interception and
 *     counted (the `_89` GUARD-3 recipe). `main.js` calls `saveModelJS()` on
 *     boot, so without this a probe page load rewrites the operator-owned
 *     `marsin_engine/models/<scene>.js` export as a side effect — which is
 *     exactly what the first run of this probe did (reported in `_102` §9).
 *   • The controller IPs are reserved TEST-NET-1 documentation addresses
 *     (RFC 5737, 192.0.2.0/24) so they cannot collide with a real box on the
 *     show LAN even if something did escape.
 *
 * Usage:  node shared_address_verify.cjs [--scene test_bench] [--out <dir>] [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = 'http://127.0.0.1:6969/simulation/';
const sceneIndex = process.argv.indexOf('--scene');
const SCENE = sceneIndex !== -1 && process.argv[sceneIndex + 1] ? process.argv[sceneIndex + 1] : 'test_bench';
const VIEWPORT = { width: 1280, height: 900 };
const KEEP_ALIVE = process.argv.includes('--keep-alive');
const outIndex = process.argv.indexOf('--out');
const OUTPUT_DIR = outIndex !== -1 && process.argv[outIndex + 1]
  ? process.argv[outIndex + 1]
  : path.join(os.homedir(), 'tmp', 'shared_address');

const SACN_OUT_PORT = '6972';
const SAVE_PORT = '6970';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RFC 5737 TEST-NET-1. `.9` vs `.10` is the pair chosen on purpose: as STRINGS
// '192.0.2.9' > '192.0.2.10', so a string comparison would pick the wrong
// winner. Numerically .10 is the higher address and must win.
const IP_LOW = '192.0.2.9';
const IP_HIGH = '192.0.2.10';
const SHARED_UNIVERSE = 900;      // far above anything either real scene patches

function sceneUrl(scene) {
  return `${BASE}?scene=${scene}&profile=pixel_mapping&renderer=webgl`;
}

/** Neuter this window's sACN OUT socket before any page script runs. */
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

async function loadSim(page, scene) {
  await page.goto(sceneUrl(scene), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered'));
  await page.waitForFunction(
    () => typeof window.toggleControllerMapPanel === 'function' && window.__controllerRegistry,
    { timeout: 180000 });
  await sleep(3000);
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
  return out;
}

/**
 * Bring the first shared-address banner into the pane's viewport before a
 * capture. The banner is a PERSISTENT card element, so it can legitimately be
 * below the fold on a long controller list — but the evidence screenshot has to
 * actually show it. Returns whether a banner was found to scroll to.
 */
async function scrollBannerIntoView(page, grade) {
  const found = await page.evaluate((g) => {
    const sel = `.led-shared-address-${g}`;
    const el = document.querySelector(`#cm-body ${sel}`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }, grade);
  await sleep(500);
  return found;
}

function check(label, cond, detail) {
  if (cond) { console.log(`   ✓ ${label}`); return true; }
  console.error(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

/**
 * Inject two UNBOUND LED controllers whose port-1 universes are the SAME, and a
 * strand apiece so both actually claim channels. In memory only.
 */
const injectOverlap = ({ ipLow, ipHigh, universe, sameIp }) => {
  const reg = window.__controllerRegistry;
  window.__probeRemoved = [];
  const mk = (name, ip) => ({
    id: (reg.nextControllerId = (reg.nextControllerId || 100) + 1),
    name, ip,
    type: 'LED',              // CONTROLLER_TYPE_LED
    protocol: 'sACN',         // CONTROLLER_PROTOCOL_SACN
    // Full LED block, as createControllerRegistry's normalizeLedConfig writes it
    // — a hand-built partial one projects strands with a NaN span.
    led: { order: 'RGBW', startAddr: 1, stride: 4, baseUniverse: 0, whiteMode: 'native' },
    ports: [{ port: 1, output: 1, universe, startAddress: 1, chain: [`__probe_${name}`] }],
  });
  const a = mk('ProbeLowIp', ipLow);
  const b = mk('ProbeHighIp', sameIp ? ipLow : ipHigh);
  reg.controllers.push(a, b);
  window.__probeControllers = [a, b];

  // Two throwaway strands so the LED projection actually produces claims.
  window.__probeStrands = [];
  for (const c of [a, b]) {
    const strand = {
      name: `__probe_${c.name}`, group: '__probe', ledCount: 40,
      x1: 0, y1: 0, z1: 0, x2: 1, y2: 0, z2: 0,
    };
    window.__probeParams.ledStrands.push(strand);
    window.__probeStrands.push(strand);
  }
  return { ids: [a.id, b.id] };
};

const removeOverlap = () => {
  const reg = window.__controllerRegistry;
  const ids = new Set((window.__probeControllers || []).map((c) => c.id));
  reg.controllers = reg.controllers.filter((c) => !ids.has(c.id));
  const names = new Set((window.__probeStrands || []).map((s) => s.name));
  window.__probeParams.ledStrands =
    window.__probeParams.ledStrands.filter((s) => !names.has(s.name));
  delete window.__probeControllers;
  delete window.__probeStrands;
};

/** What the pane is SHOWING for the two probe cards, read from the live DOM. */
const readBanners = () => {
  const cards = [...document.querySelectorAll('#cm-body .cm-card, #cm-body .cm-controller-card')];
  const out = [];
  for (const card of document.querySelectorAll('#cm-body *')) {
    if (!card.classList || !card.classList.contains('led-shared-address')) continue;
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    out.push({
      grade: card.classList.contains('led-shared-address-error') ? 'error' : 'warn',
      headline: (card.querySelector('.led-shared-address-head') || {}).textContent || '',
      lines: [...card.querySelectorAll('.led-shared-address-line')].map((l) => l.textContent),
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0 && r.width > 0,
      borderLeft: cs.borderLeftColor,
      color: cs.color,
    });
  }
  return { banners: out, cardCount: cards.length };
};

/**
 * The BYTE-LEVEL proof, run inside the page against the real universe buffer:
 * paint both claimants' pixels in BOTH render orders and read back what the sim
 * would transmit on the shared universe.
 */
const probeWire = ({ universe, ipLow, ipHigh }) => {
  const router = window.dmxRouter;
  router.addUniverse(universe);
  const mk = (ip, rgb) => ({
    name: `probe_${ip}`,
    type: 'dmx',
    fixtureType: 'GenericRgb',
    fixtureConfig: { name: `probe_${ip}`, controllerIp: ip },
    patch: { universe, addr: 1, footprint: 3 },
    channels: { r: 1, g: 2, b: 3 },
    r: rgb[0], g: rgb[1], b: rgb[2], w: 0, a: 0, u: 0,
  });
  const low = mk(ipLow, [1, 0, 0]);    // RED  from the LOWER  IP
  const high = mk(ipHigh, [0, 0, 1]);  // BLUE from the HIGHER IP

  const run = (list) => {
    const buf = router.getFullFrame(universe);
    buf.fill(0);
    window.__sacnMapper.mapPixelsToSacn(list, router);
    return [...buf.slice(0, 3)];
  };
  const plan = window.__addressMergePlan;
  const dests = (plan ? plan.destinations : []).filter((d) => d.universe === universe);
  return {
    lowFirst: run([low, high]),
    highFirst: run([high, low]),
    suppression: (() => {
      const idx = window.__addressSuppressionIndex;
      const perIp = idx && idx.get(universe);
      if (!perIp) return null;
      return [...perIp.entries()].map(([ip, ranges]) =>
        ({ ip, ranges: ranges.map((r) => [r.start, r.end, r.winnerIp]) }));
    })(),
    destinationsOnUniverse: dests.map((d) => `U${d.universe}→${d.ip}`),
    overlapMessages: (plan ? plan.overlaps : []).map((o) => o.message),
    ambiguityMessages: (plan ? plan.ambiguities : []).map((a) => a.message),
  };
};

/**
 * Re-run the same two projection passes a mapping edit runs, then re-render the
 * pane. `projectLedStrandPatches` is the pass that publishes
 * `__addressMergePlan` + `__addressSuppressionIndex` (main.js), so this is
 * exactly the path a live edit takes — no probe-only shortcut.
 */
async function refreshPane(page) {
  await page.evaluate(async () => {
    const { gatherAllConfigs } = await import('/simulation/src/dmx/auto_patcher.js');
    if (window.projectControllerMappings) {
      window.projectControllerMappings(gatherAllConfigs(window.__probeParams)
        .filter((c) => c && typeof c.name === 'string' && c.name.length > 0));
    }
    if (window.projectLedStrandPatches) window.projectLedStrandPatches();
    if (window.refreshControllerMapPanel) window.refreshControllerMapPanel();
  });
  await sleep(900);
}

(async () => {
  let ok = true;
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`],
  });
  const page = (await browser.pages())[0];
  await page.setViewport(VIEWPORT);
  await page.evaluateOnNewDocument(blockSacnOut, SACN_OUT_PORT);

  // GUARD: abort every WRITE to the save server. `main.js` calls `saveModelJS()`
  // on boot, so a bare probe page load rewrites the operator-owned engine model
  // export for whatever scene it opened. Read-only probes must not do that.
  let blockedWrites = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.url().includes(`:${SAVE_PORT}`)) {
      blockedWrites += 1;
      req.abort();
      return;
    }
    req.continue();
  });

  try {
    console.log(`\n══ shared-address live verify — scene ${SCENE} ══`);
    await loadSim(page, SCENE);

    const safety = await page.evaluate(() => ({
      blocked: window.__probeBlockedSacnOut,
      outConnected: !!(window.sacnOutput && window.sacnOutput.stats.connected),
      framesSent: window.sacnOutput ? window.sacnOutput.stats.framesSent : 0,
    }));
    if (safety.outConnected || safety.framesSent > 0) {
      throw new Error(`SAFETY: probe window reached the sACN OUT bridge — ${JSON.stringify(safety)}`);
    }
    console.log(`   safety: sACN OUT sockets blocked=${safety.blocked}, framesSent=0, ` +
      `zero device HTTP, ${blockedWrites} save-server write(s) aborted`);

    // Reach the live module scope from the probe: `params` and the mapper are
    // module-level, not globals. Importing the SAME URL the page already loaded
    // returns the SAME module instance, so `__probeParams` IS the live params.
    await page.evaluate(async () => {
      window.__sacnMapper = await import('/simulation/src/dmx/sacn_mapper.js');
      window.__probeParams = (await import('/simulation/src/core/state.js')).params;
    });

    await page.evaluate(() => {
      const panel = document.getElementById('controller-map-panel');
      if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
    });
    await sleep(1200);
    await refreshPane(page);
    const before = await page.evaluate(readBanners);
    ok = check('baseline: no shared-address banner before the overlap exists',
      before.banners.length === 0, JSON.stringify(before.banners)) && ok;
    await shot(page, '1_baseline_no_overlap');

    // ── The resolvable overlap ────────────────────────────────────────────
    console.log(`\n── injecting two controllers on U${SHARED_UNIVERSE}: ${IP_LOW} vs ${IP_HIGH} ──`);
    await page.evaluate(injectOverlap,
      { ipLow: IP_LOW, ipHigh: IP_HIGH, universe: SHARED_UNIVERSE, sameIp: false });
    await refreshPane(page);

    const warned = await page.evaluate(readBanners);
    const warnBanners = warned.banners.filter((b) => b.grade === 'warn');
    ok = check('the pane shows a ⚠ WARNING banner (not an error, not silence)',
      warnBanners.length >= 1 && warnBanners.every((b) => b.visible),
      JSON.stringify(warned.banners)) && ok;
    ok = check('the banner headline says the share is ALLOWED and the higher IP overrides',
      warnBanners.some((b) => /⚠/.test(b.headline) && /higher IP overrides/.test(b.headline)),
      warnBanners.map((b) => b.headline).join(' | ')) && ok;
    ok = check('the banner names the universe, the exact channel range, both claimants and the winner',
      warnBanners.some((b) => b.lines.some((l) =>
        l.includes(`U${SHARED_UNIVERSE} ch `) && l.includes(IP_HIGH) &&
        (/THIS card wins/.test(l) || /WINS and overrides/.test(l)))),
      JSON.stringify(warnBanners.map((b) => b.lines))) && ok;
    ok = check('the ⚠ banner is reachable in the pane (scrolled into view for the capture)',
      await scrollBannerIntoView(page, 'warn')) && ok;
    await shot(page, '2_shared_address_warning');

    // ── The wire ──────────────────────────────────────────────────────────
    const wire = await page.evaluate(probeWire,
      { universe: SHARED_UNIVERSE, ipLow: IP_LOW, ipHigh: IP_HIGH });
    console.log(`   wire: ${JSON.stringify(wire, null, 1)}`);
    ok = check('ONE destination (= one packet) per (universe, controller IP)',
      wire.destinationsOnUniverse.length ===
        new Set(wire.destinationsOnUniverse).size && wire.destinationsOnUniverse.length === 2,
      JSON.stringify(wire.destinationsOnUniverse)) && ok;
    ok = check('the HIGHER IP owns the contested channels (blue, not red)',
      JSON.stringify(wire.lowFirst) === JSON.stringify([0, 0, 255]),
      JSON.stringify(wire.lowFirst)) && ok;
    ok = check('the composed frame does NOT depend on render order',
      JSON.stringify(wire.lowFirst) === JSON.stringify(wire.highFirst),
      `${JSON.stringify(wire.lowFirst)} vs ${JSON.stringify(wire.highFirst)}`) && ok;
    ok = check('the suppression names the LOSER only, with the winner recorded',
      !!wire.suppression && wire.suppression.length === 1 &&
        wire.suppression[0].ip === IP_LOW &&
        wire.suppression[0].ranges.every((r) => r[2] === IP_HIGH),
      JSON.stringify(wire.suppression)) && ok;

    // ── The unrankable overlap (still a hard error) ───────────────────────
    console.log('\n── same-IP overlap: the higher-IP rule cannot rank it ──');
    await page.evaluate(removeOverlap);
    await page.evaluate(injectOverlap,
      { ipLow: IP_LOW, ipHigh: IP_HIGH, universe: SHARED_UNIVERSE, sameIp: true });
    await refreshPane(page);
    const errored = await page.evaluate(readBanners);
    const errBanners = errored.banners.filter((b) => b.grade === 'error');
    ok = check('an unrankable overlap renders the ERROR grade, visibly distinct',
      errBanners.length >= 1 && errBanners.every((b) => b.visible),
      JSON.stringify(errored.banners)) && ok;
    ok = check('the error banner says the push is REFUSED and why',
      errBanners.some((b) => /REFUSED/.test(b.headline) && /UNRESOLVABLE/.test(b.headline)),
      errBanners.map((b) => b.headline).join(' | ')) && ok;
    ok = check('warning and error banners do not share a colour',
      warnBanners.length && errBanners.length &&
        warnBanners[0].borderLeft !== errBanners[0].borderLeft,
      `${warnBanners[0] && warnBanners[0].borderLeft} vs ${errBanners[0] && errBanners[0].borderLeft}`) && ok;
    await scrollBannerIntoView(page, 'error');
    await shot(page, '3_unrankable_error');

    // ── Clean up: the in-memory registry goes back exactly as it was ──────
    await page.evaluate(removeOverlap);
    await refreshPane(page);
    const after = await page.evaluate(readBanners);
    ok = check('cleanup: the banner is gone once the overlap is gone (nothing persisted)',
      after.banners.length === 0, JSON.stringify(after.banners)) && ok;
    await shot(page, '4_after_cleanup');

    ok = check(`NOTHING was written to disk (${blockedWrites} save-server write(s) aborted)`,
      await page.evaluate(() => !window.__probeSaved)) && ok;

    console.log(ok ? '\n✅ shared-address live verify PASSED\n' : '\n❌ shared-address live verify FAILED\n');
  } catch (err) {
    ok = false;
    console.error('\n❌ probe failed:', err.message);
    try { await shot(page, 'error_state'); } catch (_) {}
  } finally {
    if (!KEEP_ALIVE) await browser.close();
  }
  process.exit(ok ? 0 : 1);
})();
