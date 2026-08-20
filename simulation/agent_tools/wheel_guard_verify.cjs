/**
 * wheel_guard_verify.cjs — live proof that the mouse wheel SCROLLS the sim GUI
 * and NEVER edits a value (operator order 2026-07-29, report `_52` addendum).
 *
 * Renderer-only (see_the_world skill): launches its OWN Chromium against the
 * ALREADY-RUNNING stack on :6969 and NEVER starts/stops a server.
 *
 * GUARD 1 — no sACN output, ever. `window.__readonlyMode` is installed as an
 * accessor before any page script runs (getter always true, setter swallows
 * main.js's `= false`), so animate.js never enables the output client while the
 * operator is live-mapping real hardware. A plain non-writable property would
 * make main.js's strict-mode assignment THROW and break the boot.
 * GUARD 2 — the sACN OUT WebSocket (:6972) is refused in the constructor.
 * Request interception does not cover WebSockets, so this is the only place to
 * stop one; a probe browser must never become a second writer for a universe
 * (memory: sACN route ownership).
 * GUARD 3/4/5 — params.autoSave off, window.debounceAutoSave stubbed, and every
 * :6970 request aborted at the network layer. No value is ever written; the
 * browser is closed on exit.
 *
 * WHY REAL CDP WHEELS AND NOT `dispatchEvent(new WheelEvent(...))`: half of this
 * bug is Chrome's own stepping of a FOCUSED `<input type="number">`, which is a
 * DEFAULT ACTION. A synthetic, untrusted event has no default action, so it
 * would "pass" against a completely unguarded build. Every wheel below is
 * dispatched through `Input.dispatchMouseEvent {type:'mouseWheel'}` — a real
 * browser wheel with real default actions.
 *
 * WHY A WITNESS AND NOT AN AIM (this is the whole point of the harness):
 * "wheel over a slider, assert the value did not change" passes VACUOUSLY on an
 * UNGUARDED build, because the panel scrolls out from under the cursor. Chrome
 * animates wheel scrolling, so a point measured before the dispatch is already
 * stale by the time the tick lands — the tick hits whatever scrolled into that
 * spot, mutates nothing, and the assertion "passes" having proved nothing.
 * So this harness does not trust its own aim. A WINDOW-capture listener (which
 * fires before the guard's document-capture listener, so it sees every tick
 * whether or not the guard stops it) records, for each real wheel event, the
 * actual `composedPath()` and whether it contained the probe's fader / probe's
 * number input, plus whether that input was focused at dispatch. Every
 * assertion below is gated on a RECORDED hit, not on where we pointed.
 *
 * Proves:
 *   (a) real wheels that provably LANDED ON the fader leave its value
 *       byte-identical;
 *   (b) a real wheel that provably LANDED ON the FOCUSED number input leaves
 *       its value byte-identical (the half no JS handler could have fixed);
 *   (c) the panel still SCROLLS while the cursor sits on that same fader
 *       (scrollTop moves) — the requirement a naive preventDefault would break;
 *   (d) a wheel over the 3D canvas still zooms (OrbitControls untouched);
 *   (e) `window.__wheelGuard.swallowed` counts the denied edits — the evidence
 *       trail;
 *   (f) the GUI engine carries no wheel listener at all any more.
 *
 * Usage:  node wheel_guard_verify.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
// Evidence dir for this order (report `_52` addendum). Outside the source tree
// per the codex temp-file rule; the run also writes a machine-readable summary.
const OUT = path.join(os.homedir(), 'tmp', 'gui_wheel_guard');
const KEEP = process.argv.includes('--keep-alive');
// NEGATIVE CONTROL: uninstall the guard at runtime, then run the same focused
// number-input tick and require the value to CHANGE. This is what turns the
// main run from "nothing happened" into "the guard is what stopped it" — it
// proves the tick really lands on the control and really can mutate it. Run it
// as `node wheel_guard_verify.cjs --negative-control`.
const NEG = process.argv.includes('--negative-control');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `wheelguard_${stamp()}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function installPageGuards(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, '__readonlyMode', {
      get: () => true, set: () => {}, configurable: true,
    });

    const NativeWebSocket = window.WebSocket;
    window.__blockedSockets = [];
    window.WebSocket = function GuardedWebSocket(url, ...rest) {
      if (/:6972(\/|$)/.test(String(url))) {
        window.__blockedSockets.push(String(url));
        throw new Error(`wheel_guard_verify: sACN OUT socket refused (${url})`);
      }
      return new NativeWebSocket(url, ...rest);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => {
      window.WebSocket[k] = i;
    });

    // ── The witness ────────────────────────────────────────────────────────
    // WINDOW capture runs before DOCUMENT capture, so this sees every wheel
    // tick even though the guard calls stopPropagation() at document level.
    // It records where the tick REALLY went; the harness asserts on that.
    const desc = (n) => {
      if (!n || n === window) return 'window';
      if (n.nodeType === 9) return 'document';
      if (n.nodeType !== 1) return String(n);
      const cls = (n.className && typeof n.className === 'string')
        ? `.${n.className.trim().split(/\s+/).join('.')}` : '';
      const type = n.getAttribute && n.getAttribute('type')
        ? `[type=${n.getAttribute('type')}]` : '';
      return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${cls}${type}`;
    };
    // Where does a CDP-dispatched pointer REALLY land? Puppeteer's
    // `defaultViewport` emulation and the OS display scale can both put CDP
    // input coordinates in a different space than CSS pixels, so a point that
    // `elementFromPoint` says is the number input can dispatch onto the row
    // label next to it — and then every assertion built on that aim is a lie.
    // The harness calibrates against this before it asserts anything.
    window.__lastPointer = null;
    window.addEventListener('mousemove', (e) => {
      window.__lastPointer = {
        clientX: e.clientX, clientY: e.clientY, target: desc(e.target),
      };
    }, { capture: true, passive: true });

    window.__wheelWitness = [];
    window.addEventListener('wheel', (e) => {
      const p = e.composedPath();
      const probe = window.__probe;
      const aim = window.__aim;
      const r = probe && probe.input ? probe.input.getBoundingClientRect() : null;
      window.__wheelWitness.push({
        trusted: e.isTrusted,
        target: desc(e.target),
        at: { x: e.clientX, y: e.clientY },
        aim: aim ? { x: aim.x, y: aim.y } : null,
        scrollTopAtDispatch: probe && probe.scroller ? probe.scroller.scrollTop : null,
        inputRectAtDispatch: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        onFader: !!(probe && probe.slider && p.includes(probe.slider)),
        onInput: !!(probe && probe.input && p.includes(probe.input)),
        inputFocusedAtDispatch: !!(probe && probe.input
          && document.activeElement === probe.input),
        inputValueAtDispatch: probe && probe.input ? probe.input.value : null,
      });
    }, { capture: true, passive: true });
  });
}

async function launch() {
  return puppeteer.launch({
    // `defaultViewport: null` on purpose — the page must use the REAL window
    // viewport. With puppeteer's emulation override active, CDP Input
    // coordinates and CSS pixels drift apart and every aimed tick lands
    // somewhere other than where it was aimed (see calibratePointer).
    headless: false, defaultViewport: null, protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
}

/**
 * A REAL browser wheel at (x, y). Default actions apply, exactly like a mouse.
 *
 * The `mouseMoved` first is required, not cosmetic: without it Chrome hit-tests
 * the wheel against its LAST known cursor position, so the tick can land on a
 * different element than the one we aimed at.
 */
async function realWheel(client, page, x, y, deltaY, ticks = 1) {
  await page.evaluate((a) => { window.__aim = a; }, { x, y });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse',
  });
  await sleep(40);
  for (let i = 0; i < ticks; i++) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse',
    });
    await sleep(60);
  }
}

/**
 * Prove that a CDP-dispatched pointer lands where we asked, BEFORE any
 * assertion depends on it.
 *
 * This is the difference between a real proof and a vacuous one: if dispatched
 * coordinates are offset or scaled, every "wheel over the slider" tick actually
 * lands somewhere else, no value could possibly change, and the whole harness
 * reports PASS against a completely unguarded build. Fails LOUD on drift.
 */
async function calibratePointer(client, page) {
  const probe = await page.evaluate(() => ({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.5),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: probe.x, y: probe.y, buttons: 0, pointerType: 'mouse',
  });
  await sleep(120);
  const got = await page.evaluate(() => window.__lastPointer);
  if (!got) throw new Error('pointer calibration: no mousemove was delivered at all');
  const dx = got.clientX - probe.x;
  const dy = got.clientY - probe.y;
  console.log(`[calib] viewport ${probe.innerWidth}x${probe.innerHeight} dpr=${probe.dpr}`
    + ` | asked (${probe.x},${probe.y}) → got (${got.clientX},${got.clientY}) | drift (${dx},${dy})`);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    throw new Error(`pointer calibration FAILED: dispatched (${probe.x},${probe.y}) arrived at `
      + `(${got.clientX},${got.clientY}). Every aimed wheel tick would land off-target and the `
      + 'value-stability assertions would be vacuous.');
  }
  return { ...probe, dx, dy };
}

/**
 * Wait for Chrome's animated wheel scrolling to come to rest.
 *
 * Without this the next aim is measured mid-animation and is stale before it is
 * used — the exact mechanism that makes a naive wheel test vacuous.
 */
async function settleScroll(page) {
  // Demand a QUIET WINDOW, not two equal samples in a row. Chrome's wheel
  // scrolling is animated and the animation does not necessarily start in the
  // same frame as the tick, so "read the same number twice" can return while
  // the scroll has not even begun — and then the next aim is measured against a
  // layout that is about to move 120px. That exact race was what made the
  // aimed-tick assertions vacuous here: the input was measured at y=356 and the
  // tick landed at y=356 on the row that had scrolled into its place, with the
  // real input by then at y=467.
  const QUIET_SAMPLES = 5;
  let last = null;
  let stable = 0;
  await sleep(150);
  for (let i = 0; i < 60; i++) {
    const top = await page.evaluate(() => window.__probe.scroller.scrollTop);
    stable = (top === last) ? stable + 1 : 0;
    last = top;
    if (stable >= QUIET_SAMPLES) return top;
    await sleep(60);
  }
  throw new Error('the panel never stopped scrolling — cannot aim a tick reliably');
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await installPageGuards(page);
  await page.setRequestInterception(true);
  let abortedSaves = 0;
  page.on('request', (req) => {
    if (/:6970(\/|$)/.test(req.url())) { abortedSaves += 1; req.abort(); return; }
    req.continue();
  });

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) { const s = getComputedStyle(o); if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false; }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0 && !!window.__wheelGuard;
  }, { timeout: 90000 });
  await sleep(3000);
  const client = await page.target().createCDPSession();

  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__params.autoSave = false;
    window.debounceAutoSave = () => {};
  }, ORIGIN);

  const calibration = await calibratePointer(client, page);

  const guardBefore = await page.evaluate(() => window.__wheelGuard.swallowed);
  const guardedSelectors = await page.evaluate(async (o) => {
    const m = await import(`${o}/simulation/src/gui/wheel_guard.js`);
    return m.GUARDED_SELECTORS;
  }, ORIGIN);
  console.log('\nwheel guard installed; swallowed so far:', guardBefore);
  console.log('GUARDED_SELECTORS served to the page:', JSON.stringify(guardedSelectors));

  // Open a couple of sections so real faders are on screen (the panel boots
  // fully collapsed). Display-only: opening a folder mutates no parameter.
  await page.evaluate(() => {
    ['🔌 LED Fixtures', '⚙ Options', 'Options'].forEach((title) => {
      const t = [...document.querySelectorAll('.title')]
        .find((e) => (e.textContent || '').trim() === title);
      if (t && t.parentElement && t.parentElement.classList.contains('closed')) t.click();
    });
  });
  await sleep(600);

  // ── Find a fader in the Lighting Controls panel + its scroll container ────
  const target = await page.evaluate(() => {
    const panel = document.getElementById('gui-panel');
    if (!panel) throw new Error('gui-panel not found');
    const scroller = [...panel.querySelectorAll('*')]
      .find((el) => el.scrollHeight > el.clientHeight + 20) || panel;
    // A fader inside a COLLAPSED folder has a zero rect — wheeling at (0,0)
    // hits the canvas and would "prove" the guard works on an unguarded build.
    // Demand a real, on-screen, hit-testable target.
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 4) return null;
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) return null;
      return { x, y };
    };
    const candidates = [...panel.querySelectorAll('.controller')].filter((c) =>
      c.querySelector('input[type=number]') && c.querySelector('.slider'));
    for (const controller of candidates) {
      const slider = controller.querySelector('.slider');
      if (!slider || slider.getBoundingClientRect().width < 8) continue;
      // Park it mid-panel so scrollTop has room to move in either direction and
      // check (c) can actually measure a scroll.
      controller.scrollIntoView({ block: 'center' });
      const at = visible(slider);
      if (!at) continue;
      const input = controller.querySelector('input[type=number]');
      const inputAt = visible(input);
      if (!inputAt) continue;
      const nameEl = controller.querySelector('.name');
      window.__probe = { slider, controller, input, scroller };
      return {
        name: nameEl ? nameEl.textContent.trim() : '(unnamed)',
        sliderRect: at,
        inputRect: inputAt,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        value: input.value,
      };
    }
    throw new Error('no VISIBLE, hit-testable fader with a number input in gui-panel');
  });
  console.log('[target] fader:', JSON.stringify(target));
  if (target.scrollHeight <= target.clientHeight) {
    throw new Error('the panel does not overflow — requirement (c) cannot be measured');
  }
  await shot(page, 'a_before_wheel');

  // ── (a)+(c) real wheels over the FADER: value stable, panel scrolls ───────
  // Settle the scroll before each aim, then let the WITNESS decide which ticks
  // actually landed on the fader. Alternating direction keeps the fader near
  // the cursor instead of walking it off the end of the panel.
  const scrollBefore = await settleScroll(page);
  const scrollSeen = new Set([scrollBefore]);
  for (let i = 0; i < 8; i++) {
    await settleScroll(page);
    const aim = await page.evaluate(() => {
      const r = window.__probe.slider.getBoundingClientRect();
      if (r.width < 8) return null;
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      if (y < 0 || y > window.innerHeight) return null;
      return { x, y };
    });
    if (!aim) continue;
    await realWheel(client, page, aim.x, aim.y, i % 2 === 0 ? 120 : -120, 1);
    scrollSeen.add(await page.evaluate(() => window.__probe.scroller.scrollTop));
  }
  await settleScroll(page);

  const faderPhase = await page.evaluate(() => ({
    witness: window.__wheelWitness.slice(),
    value: window.__probe.input.value,
    scrollTop: window.__probe.scroller.scrollTop,
    swallowed: window.__wheelGuard.swallowed,
  }));
  const faderHits = faderPhase.witness.filter((w) => w.onFader).length;
  console.log(`\n[a] wheel ticks the WITNESS recorded ON the fader: ${faderHits}`
    + ` (of ${faderPhase.witness.length} dispatched)`);
  if (faderHits === 0) {
    // Fail LOUD (codex P0): "value unchanged" without a recorded hit is vacuous.
    throw new Error('no wheel tick provably landed on the fader — the value-stability '
      + 'assertion would be meaningless');
  }
  console.log('[a] fader value  before:', JSON.stringify(target.value),
    '| after:', JSON.stringify(faderPhase.value));
  console.log('[c] panel scrollTop values seen:', [...scrollSeen].join(' → '));
  const valueStableOnFader = faderPhase.value === target.value;
  const panelScrolled = scrollSeen.size > 1;

  // ── (b) real wheel over a FOCUSED number input ────────────────────────────
  // ONE tick. Five would be worse, not better: the guard blurs on the first, so
  // ticks 2-5 test an unfocused input and prove nothing.
  // Retry until the WITNESS confirms a tick that landed on the input while it
  // was focused. One aimed tick is not enough on its own: the panel can still
  // move between the aim and the dispatch, and a tick that missed proves
  // nothing about the native-stepping half of the bug.
  let witnessMark = faderPhase.witness.length;
  let focusProbe = null;
  let afterInput = null;
  let focusedInputTicks = [];
  if (NEG) {
    const removed = await page.evaluate(() => {
      window.__wheelGuard.uninstall();
      return !document.__wheelGuardInstalled;
    });
    if (!removed) throw new Error('negative control: the guard did not uninstall');
    console.log('\n[NEG] guard UNINSTALLED — the next focused-input tick should MUTATE the value');
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    await settleScroll(page);
    witnessMark = await page.evaluate(() => window.__wheelWitness.length);
    focusProbe = await page.evaluate(() => {
      const input = window.__probe.input;
      input.focus();
      input.scrollIntoView({ block: 'center' });
      const r = input.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      return {
        focused: document.activeElement === input,
        onTarget: document.elementFromPoint(x, y) === input,
        value: input.value,
        swallowed: window.__wheelGuard.swallowed,
        x, y,
      };
    });
    if (!focusProbe.focused || !focusProbe.onTarget) continue;
    await realWheel(client, page, focusProbe.x, focusProbe.y, 120, 1);
    await sleep(250);
    afterInput = await page.evaluate((mark) => ({
      witness: window.__wheelWitness.slice(mark),
      value: window.__probe.input.value,
      stillFocused: document.activeElement === window.__probe.input,
      swallowed: window.__wheelGuard.swallowed,
    }), witnessMark);
    // The decisive record: a tick that landed on the input WHILE it was focused.
    focusedInputTicks = afterInput.witness.filter(
      (w) => w.onInput && w.inputFocusedAtDispatch);
    console.log(`\n[b] attempt ${attempt}: aim ${JSON.stringify({ x: focusProbe.x, y: focusProbe.y })}`
      + ` → witnessed on focused input: ${focusedInputTicks.length}`);
    if (focusedInputTicks.length > 0) break;
  }
  console.log('[b] focused number input:', JSON.stringify(focusProbe));
  console.log('[b] witness for this phase:', JSON.stringify(afterInput.witness));
  console.log('[b] value before:', JSON.stringify(focusProbe.value),
    '| after:', JSON.stringify(afterInput.value),
    '| still focused:', afterInput.stillFocused,
    '| guard swallowed +', afterInput.swallowed - focusProbe.swallowed);
  if (focusedInputTicks.length === 0) {
    throw new Error('no wheel tick provably landed on the FOCUSED number input — '
      + 'the native-stepping half of the bug was never exercised');
  }
  const valueStableOnInput = afterInput.value === focusProbe.value
    && focusedInputTicks.every((w) => w.inputValueAtDispatch === focusProbe.value);
  const blurredByGuard = afterInput.stillFocused === false;
  const inputTickCounted = afterInput.swallowed > focusProbe.swallowed;

  // ── (d) the 3D canvas still zooms on wheel ────────────────────────────────
  const camDist = (origin) => page.evaluate(async (o) => {
    const state = await import(`${o}/simulation/src/core/state.js`);
    return state.camera ? state.camera.position.length() : null;
  }, origin);
  const camBefore = await camDist(ORIGIN);
  await realWheel(client, page, 400, 360, -120, 4);
  await sleep(500);
  const camAfter = await camDist(ORIGIN);
  console.log('\n[d] camera distance before:', camBefore, '| after:', camAfter);
  if (camBefore === null || camAfter === null) {
    throw new Error('could not read state.camera — the canvas-zoom check cannot be trusted');
  }
  const canvasZoomWorks = Math.abs(camAfter - camBefore) > 1e-6;

  // ── (e)+(f) evidence trail + the engine carries no wheel listener ─────────
  const guardAfter = await page.evaluate(() => window.__wheelGuard.swallowed);
  const engineClean = await page.evaluate(async (origin) => {
    const src = await (await fetch(`${origin}/simulation/src/gui/modern_gui/controllers.js`)).text();
    return !/addEventListener\('wheel'/.test(src);
  }, ORIGIN);
  console.log('\n[e] wheel ticks DENIED a value edit this run:', guardAfter - guardBefore);
  console.log('[f] modern_gui/controllers.js free of wheel listeners:', engineClean);
  await shot(page, 'b_after_wheel_value_unchanged');

  const results = NEG ? {
    // With the guard removed, "value unchanged" would mean the tick MISSED.
    // Requiring a change is the proof that the aim, the dispatch and the
    // browser's native stepping are all real.
    'neg_wheel_tick_provably_landed_on_the_focused_input': focusedInputTicks.length > 0,
    'neg_UNGUARDED_value_DID_change': !valueStableOnInput,
    'no_console_errors': errors.filter((e) => /wheel_guard|controllers\.js|TypeError/i.test(e)).length === 0,
  } : {
    'a_wheel_ticks_provably_landed_on_the_fader': faderHits > 0,
    'a_fader_value_unchanged_by_wheel': valueStableOnFader,
    'a_guard_engaged_on_every_fader_tick': faderPhase.swallowed >= faderHits,
    'b_focused_number_input_unchanged': valueStableOnInput,
    'b_guard_blurred_the_focused_input': blurredByGuard,
    'b_guard_counted_that_exact_tick': inputTickCounted,
    'c_panel_still_scrolls_over_the_fader': panelScrolled,
    'd_canvas_wheel_zoom_still_works': canvasZoomWorks,
    'e_swallowed_counter_moved': guardAfter > guardBefore,
    'f_gui_engine_has_no_wheel_listener': engineClean,
    'no_console_errors': errors.filter((e) => /wheel_guard|controllers\.js|TypeError/i.test(e)).length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  const blockedSockets = await page.evaluate(() => window.__blockedSockets || []);
  console.log(`  (save-server requests aborted this run: ${abortedSaves};`
    + ` sACN OUT sockets refused: ${blockedSockets.length})`);
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);

  const evidence = {
    mode: NEG ? 'negative-control (guard uninstalled at runtime)' : 'guarded',
    result: allPass ? 'PASS' : 'FAIL',
    checks: results,
    guarded_selectors_served: guardedSelectors,
    pointer_calibration: calibration,
    fader: {
      name: target.name,
      ticks_dispatched: faderPhase.witness.length,
      ticks_witnessed_on_fader: faderHits,
      value_before: target.value,
      value_after: faderPhase.value,
      scrollTop_values_seen: [...scrollSeen],
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    },
    focused_number_input: {
      value_before: focusProbe.value,
      value_after: afterInput.value,
      ticks_witnessed_on_focused_input: focusedInputTicks.length,
      still_focused_after: afterInput.stillFocused,
      guard_swallowed_delta: afterInput.swallowed - focusProbe.swallowed,
      witness: afterInput.witness,
    },
    canvas_zoom: { camera_distance_before: camBefore, camera_distance_after: camAfter },
    guard_swallowed_total_delta: guardAfter - guardBefore,
    live_session_guards: {
      save_server_requests_aborted: abortedSaves,
      sacn_out_sockets_refused: blockedSockets,
    },
    console_errors: errors,
  };
  const evidencePath = path.join(OUT,
    `wheelguard_${stamp()}_${NEG ? 'negative_control' : 'guarded'}_summary.json`);
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`  📄 ${path.basename(evidencePath)}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
