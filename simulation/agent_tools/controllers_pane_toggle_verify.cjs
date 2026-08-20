/**
 * controllers_pane_toggle_verify.cjs — proof + screenshots for the Controllers
 * section hide/show toggle in the Controller Mapping pane.
 *
 * agent_render.cjs cannot open the mapping pane, so this dedicated tool does
 * (same recipe as split_capture.cjs). It captures EXPANDED vs COLLAPSED per
 * scene and asserts, in-page, the three things that matter:
 *   1. collapsing hides the controllers list and NOTHING below it — the
 *      unmapped tray + Save row grow into the freed space;
 *   2. the toggle does NOT rebuild the pane (the same DOM nodes survive, an
 *      in-progress tray filter keeps its text) — safe mid-mapping;
 *   3. the state survives a page reload (per-machine localStorage pref).
 *
 * It also covers the controller card's TWO-ROW header (same operator request):
 * identity (name + IP) on row 1, actions on row 2, and the name box wide enough
 * to read a full controller name at the NARROWEST split the layout allows.
 *
 * SAFETY — this probe must never reach real hardware while the operator is
 * live-mapping. `?readonly=1` is NOT usable here: main.js:802-816 skips
 * setupControllerMapEditor in observer mode, so the pane under test would not
 * exist. Instead the sACN OUT bridge socket (ws :6972) is blocked before the
 * page's first script runs — animate.js only sends when
 * `sacnOutputClient.connected`, which can never become true — and the block is
 * ASSERTED in-page before anything is clicked. The probe touches no output
 * gate, opens no LED push, and never saves.
 *
 * Usage:  node controllers_pane_toggle_verify.cjs
 *           [--scenes a,b]   default test_bench,studiodj
 *           [--out <dir>]    default ~/tmp/controllers_pane_toggle
 *           [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = 'http://127.0.0.1:6969/simulation/';
// Light scenes by default: the pane is scene-independent, and the titanic FBX
// under SwiftShader takes minutes to boot while stealing GPU from the
// operator's own sim window. Override with --scenes a,b.
const scenesIndex = process.argv.indexOf('--scenes');
const SCENES = scenesIndex !== -1 && process.argv[scenesIndex + 1]
  ? process.argv[scenesIndex + 1].split(',')
  : ['test_bench', 'studiodj'];
const VIEWPORT = { width: 1280, height: 800 }; // software GL: 1080p loses the context
const KEEP_ALIVE = process.argv.includes('--keep-alive');

const outIndex = process.argv.indexOf('--out');
const OUTPUT_DIR = outIndex !== -1 && process.argv[outIndex + 1]
  ? process.argv[outIndex + 1]
  : path.join(os.homedir(), 'tmp', 'controllers_pane_toggle');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SACN_OUT_PORT = '6972';

function sceneUrl(scene) {
  // renderer=webgl because the WebGPU backend loses its device under
  // SwiftShader. NO readonly=1 — that mode skips the pane under test.
  return `${BASE}?scene=${scene}&profile=pixel_mapping&renderer=webgl`;
}

/**
 * Neuter this window's sACN OUT socket before any page script runs. Returns a
 * permanently-CLOSED stub for the bridge URL, so SacnOutputClient never opens,
 * never reports `connected`, and animate.js never sends a frame. Any other
 * WebSocket (the sACN IN feed, the save-server link) is untouched.
 */
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
    () => typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 180000 }).catch(async (err) => {
    // Fail loudly WITH the boot state that explains it — a bare puppeteer
    // timeout says nothing about why the sim never finished booting.
    const diag = await page.evaluate(() => ({
      fatalBootError: !!window.__fatalBootError,
      activeScene: window.__activeScene,
      blockedSacnOut: window.__probeBlockedSacnOut,
      hasRegistry: !!window.__controllerRegistry,
      hasPanelEl: !!document.getElementById('controller-map-panel'),
      hasToggle: typeof window.toggleControllerMapPanel,
      hasSplit: !!window.__splitLayout,
      overlay: (() => {
        const o = document.getElementById('loading-overlay');
        return o ? `${getComputedStyle(o).display}: ${o.innerText.trim().slice(0, 200)}` : 'absent';
      })(),
    }));
    console.error('  boot diagnostics:', JSON.stringify(diag));
    throw err;
  });
  await sleep(3500);
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
  return out;
}

/** Geometry + identity of the pane's regions, read straight from the DOM. */
const readPane = () => {
  const body = document.getElementById('cm-body');
  const rect = (sel) => {
    const el = body.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const visible = getComputedStyle(el).display !== 'none' && r.height > 0;
    return { visible, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  };
  const filter = body.querySelector('.cm-tray .cm-input');
  // Overlap geometry (report 20260725_85): the Save row used to PAINT OVER the
  // tray chips once the taller MarsinLED cards squeezed the flex column. These
  // are the numbers that must stay at zero in every state.
  const box = (sel) => {
    const el = body.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const vOverlap = (a, b) =>
    (a && b ? Math.round(Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))) : 0);
  const trayBox = box('.cm-tray');
  const chipsBox = box('.cm-tray-chips');
  const saveBox = box('.vm-save');
  const hintBox = box('.cm-hint');
  return {
    saveOverTray: vOverlap(saveBox, trayBox),
    saveOverChips: vOverlap(saveBox, chipsBox),
    hintOverTray: vOverlap(hintBox, trayBox),
    // > 0 means the chip grid is painting outside the tray's own box.
    chipsEscapeTray: (chipsBox && trayBox) ? Math.round(chipsBox.bottom - trayBox.bottom) : 0,
    saveInFooter: !!body.querySelector('.cm-footer > .vm-save'),
    collapsedClass: body.classList.contains('cm-controllers-collapsed'),
    toggleGlyph: body.querySelector('.cm-controllers-toggle')?.textContent || null,
    sectionHead: rect('.cm-section-head'),
    main: rect('.cm-main'),
    tray: rect('.cm-tray'),
    chips: rect('.cm-tray-chips'),
    save: rect('.vm-save'),
    hint: rect('.cm-hint'),
    // Identity probes: set by the caller before the click, read after. If the
    // pane were re-rendered these nodes would be replaced and the marks lost.
    trayMarked: !!(filter && filter.__toggleProbe),
    sameNodes: !!(window.__probeNodes
      && window.__probeNodes.tray === body.querySelector('.cm-tray')
      && window.__probeNodes.main === body.querySelector('.cm-main')),
    filterValue: filter ? filter.value : null,
  };
};

function check(label, cond, detail) {
  if (cond) {
    console.log(`   ✓ ${label}`);
    return true;
  }
  console.error(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

async function runScene(page, scene) {
  console.log(`\n══ scene: ${scene} ══`);
  await loadSim(page, scene);

  // Prove the safety block took before touching anything: no live sACN OUT
  // socket, no frames sent from this window.
  const safety = await page.evaluate(() => ({
    blocked: window.__probeBlockedSacnOut,
    outConnected: !!(window.sacnOutput && window.sacnOutput.stats.connected),
    framesSent: window.sacnOutput ? window.sacnOutput.stats.framesSent : 0,
  }));
  if (safety.outConnected || safety.framesSent > 0) {
    throw new Error(`SAFETY: probe window reached the sACN OUT bridge — ${JSON.stringify(safety)}`);
  }
  console.log(`   safety: sACN OUT sockets blocked=${safety.blocked}, framesSent=0`);

  // Start from a known EXPANDED state (a stale pref from an earlier run must
  // not decide what the screenshots show).
  await page.evaluate(() => localStorage.setItem('bm26.map.controllersCollapsed', '0'));
  await page.evaluate(() => {
    const panel = document.getElementById('controller-map-panel');
    if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
  });
  await sleep(1500);
  await page.evaluate(() => window.refreshControllerMapPanel());
  await sleep(600);

  // Mark the live nodes. If the toggle re-rendered the pane these would be
  // replaced and the marks lost — that is the "no rebuild" proof.
  await page.evaluate(() => {
    const body = document.getElementById('cm-body');
    body.querySelector('.cm-tray .cm-input').__toggleProbe = true;
    window.__probeNodes = {
      tray: body.querySelector('.cm-tray'),
      main: body.querySelector('.cm-main'),
    };
  });

  const expanded = await page.evaluate(readPane);
  await shot(page, `${scene}_1_expanded`);

  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(700);
  const collapsed = await page.evaluate(readPane);
  await shot(page, `${scene}_2_collapsed`);

  let ok = true;
  ok = check('expanded: controllers list visible', expanded.main.visible) && ok;
  ok = check('collapsed: controllers list hidden', !collapsed.main.visible,
    JSON.stringify(collapsed.main)) && ok;
  ok = check('collapsed: section head still visible (way back)', collapsed.sectionHead.visible) && ok;
  ok = check('collapsed: glyph flips ▾ → ▸',
    expanded.toggleGlyph === '▾' && collapsed.toggleGlyph === '▸',
    `${expanded.toggleGlyph} / ${collapsed.toggleGlyph}`) && ok;
  // The tray rises into the freed space; the Save row + hint are bottom-
  // anchored, so they simply stay put and stay reachable.
  ok = check('collapsed: unmapped tray rose into the freed space',
    collapsed.tray.visible && collapsed.tray.top < expanded.tray.top,
    `${expanded.tray.top} → ${collapsed.tray.top}`) && ok;
  ok = check('collapsed: tray grew',
    collapsed.tray.height > expanded.tray.height,
    `${expanded.tray.height} → ${collapsed.tray.height}`) && ok;
  ok = check('collapsed: tray chip area grew',
    collapsed.chips.height > expanded.chips.height,
    `${expanded.chips.height} → ${collapsed.chips.height}`) && ok;
  for (const region of ['save', 'hint']) {
    ok = check(`collapsed: ${region} row still visible and in place`,
      collapsed[region].visible && collapsed[region].top === expanded[region].top,
      `${expanded[region].top} → ${collapsed[region].top}`) && ok;
  }
  // ── Save row never overlaps the tray, in EITHER state ─────────────────
  ok = check('the Save button lives in its own anchored footer row',
    expanded.saveInFooter) && ok;
  for (const [label, state] of [['expanded', expanded], ['collapsed', collapsed]]) {
    ok = check(`${label}: Save row does not overlap the tray or its chips`,
      state.saveOverTray === 0 && state.saveOverChips === 0,
      `tray ${state.saveOverTray}px / chips ${state.saveOverChips}px`) && ok;
    ok = check(`${label}: the chip grid stays inside the tray box`,
      state.chipsEscapeTray <= 0, `${state.chipsEscapeTray}px past the tray`) && ok;
    ok = check(`${label}: the hint sits clear of the tray`,
      state.hintOverTray === 0, `${state.hintOverTray}px`) && ok;
  }

  ok = check('no rebuild: the same tray + list nodes survived', collapsed.sameNodes) && ok;
  ok = check('no rebuild: the tray filter node kept its probe mark',
    collapsed.trayMarked) && ok;

  // In-progress operator state (a half-typed tray filter) must ride through a
  // hide/show cycle untouched. Done after the screenshots so the captures show
  // the unfiltered tray, and cleared again afterwards.
  await page.evaluate(() => {
    const f = document.querySelector('#cm-body .cm-tray .cm-input');
    f.value = 'half-typed';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(400);
  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(400);
  const filtered = await page.evaluate(readPane);
  ok = check('no rebuild: an in-progress tray filter survived a hide/show cycle',
    filtered.filterValue === 'half-typed', String(filtered.filterValue)) && ok;
  await page.evaluate(() => {
    const f = document.querySelector('#cm-body .cm-tray .cm-input');
    f.value = '';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  // Expand again — the list comes back exactly where it was.
  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(700);
  const reexpanded = await page.evaluate(readPane);
  ok = check('re-expanded: controllers list back', reexpanded.main.visible) && ok;
  ok = check('re-expanded: tray back to its original top',
    reexpanded.tray.top === expanded.tray.top,
    `${expanded.tray.top} vs ${reexpanded.tray.top}`) && ok;
  ok = check('re-expanded: still no rebuild',
    reexpanded.trayMarked && reexpanded.sameNodes) && ok;
  await shot(page, `${scene}_3_reexpanded`);

  // ── Tray + picker sorted by name, and the filter stays instant ─────────
  // Read with the controllers list COLLAPSED so the whole tray is on screen.
  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(600);
  const sortState = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#cm-body .cm-tray-chips .cm-tray-chip')];
    const strip = (t) => t.replace(/^[^\s]+\s/, ''); // drop the ▪ / ✨ / 💡 marker
    const fixtures = chips.filter((c) => !c.classList.contains('cm-tray-strand'))
      .map((c) => strip(c.textContent));
    const strands = chips.filter((c) => c.classList.contains('cm-tray-strand'))
      .map((c) => strip(c.textContent));
    const firstStrandIdx = chips.findIndex((c) => c.classList.contains('cm-tray-strand'));
    const lastFixtureIdx = chips.map((c) => c.classList.contains('cm-tray-strand'))
      .lastIndexOf(false);
    // The scene's own (creation) order — what the tray used to render.
    const sceneOrder = ((window.params && (window.params.dmxFixtures || {}).length
      ? window.params.dmxFixtures : (window.params || {}).parLights) || [])
      .map((f) => f && f.name).filter(Boolean);
    return {
      fixtures,
      strands,
      clustersIntact: firstStrandIdx === -1 || lastFixtureIdx < firstStrandIdx,
      sceneOrderHead: sceneOrder.slice(0, 12),
    };
  });

  const naturally = (list) => [...list]
    .sort((a, b) => new Intl.Collator(undefined, { numeric: true }).compare(a, b));
  console.log(`   tray: ${sortState.fixtures.length} fixture chips, `
    + `${sortState.strands.length} strand chips`);
  console.log(`   first 6 rendered: ${sortState.fixtures.slice(0, 6).join(' | ')}`);
  ok = check('tray: fixture chips are in natural name order',
    JSON.stringify(sortState.fixtures) === JSON.stringify(naturally(sortState.fixtures)),
    sortState.fixtures.slice(0, 8).join(' | ')) && ok;
  ok = check('tray: strand chips are in natural name order',
    JSON.stringify(sortState.strands) === JSON.stringify(naturally(sortState.strands)),
    sortState.strands.join(' | ')) && ok;
  ok = check('tray: fixture and strand clusters are NOT fused',
    sortState.clustersIntact) && ok;
  // The "2 before 10" trap, asserted on whatever the real scene provides.
  const numbered = sortState.fixtures.filter((n) => /\s\d+$/.test(n));
  const trapPairs = [];
  for (const n of numbered) {
    const m = /^(.*)\s(\d+)$/.exec(n);
    if (Number(m[2]) >= 10 && numbered.includes(`${m[1]} 2`)) trapPairs.push([`${m[1]} 2`, n]);
  }
  if (trapPairs.length === 0) {
    console.log('   note: no "<group> 2" + "<group> ≥10" pair in this scene — '
      + 'the trap is pinned in tests/natural_sort.test.js');
  } else {
    ok = check(`tray: "… 2" precedes "… 10" (${trapPairs.length} real pair(s))`,
      trapPairs.every(([a, b]) =>
        sortState.fixtures.indexOf(a) < sortState.fixtures.indexOf(b)),
      trapPairs.map((p) => p.join(' < ')).join(', ')) && ok;
  }
  await shot(page, `${scene}_9_tray_sorted`);

  // Filter speed + order preservation: type a needle one character at a time
  // and time the whole thing. This is the path that used to re-walk every
  // scene config (and would now re-sort) per keystroke.
  const filterProbe = await page.evaluate(() => {
    const f = document.querySelector('#cm-body .cm-tray .cm-input');
    const t0 = performance.now();
    for (const ch of ['l', 'e', 'f', 't', ' ', 'b']) {
      f.value += ch;
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const ms = performance.now() - t0;
    const shown = [...document.querySelectorAll('#cm-body .cm-tray-chips .cm-tray-chip')]
      .map((c) => c.textContent.replace(/^[^\s]+\s/, ''));
    f.value = '';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    return { ms: Math.round(ms), shown };
  });
  console.log(`   filter: 6 keystrokes over the whole tray in ${filterProbe.ms} ms `
    + `(${filterProbe.shown.length} chips left)`);
  ok = check('filter: 6 keystrokes stay well under one frame budget each',
    filterProbe.ms < 300, `${filterProbe.ms} ms`) && ok;
  ok = check('filter: the subset preserves the sorted order',
    JSON.stringify(filterProbe.shown) === JSON.stringify(naturally(filterProbe.shown)),
    filterProbe.shown.slice(0, 8).join(' | ')) && ok;

  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(600);

  // ── Controller card header: two rows, readable name box ────────────────
  // Squeeze the pane to the narrowest split the layout allows — the width at
  // which the old single-row header starved the name input down to a few
  // characters — and prove the name still reads in full.
  await page.evaluate(() => window.__splitLayout.setRatio(0.2));
  await sleep(900);
  const header = await page.evaluate(() => {
    const card = document.querySelector('#cm-body .cm-controller');
    const head = card.querySelector('.cm-controller-head');
    const rows = head.querySelectorAll(':scope > .cm-controller-head-row');
    const name = head.querySelector('.cm-input.cm-name');
    const ip = head.querySelector('.cm-input.cm-ip');
    const rowOf = (el) => [...rows].findIndex((r) => r.contains(el));
    // Measure against the operator's real controller name. DISPLAY ONLY: the
    // value is written and restored without dispatching a single event, so
    // `nameInp.onchange` never fires and the registry is never mutated.
    const original = name.value;
    name.value = 'LeftFrontWall';
    const probe = { width: name.clientWidth, scroll: name.scrollWidth };
    name.value = original;
    return {
      longNameFits: probe.scroll <= probe.width + 1,
      longNameProbe: probe,
      rowCount: rows.length,
      paneWidth: Math.round(document.getElementById('controller-map-panel')
        .getBoundingClientRect().width),
      nameValue: name.value,
      nameWidth: Math.round(name.getBoundingClientRect().width),
      // scrollWidth > clientWidth is exactly "the text is cut off".
      nameTruncated: name.scrollWidth > name.clientWidth + 1,
      ipWidth: Math.round(ip.getBoundingClientRect().width),
      nameRow: rowOf(name),
      ipRow: rowOf(ip),
      typeRow: rowOf(head.querySelector('.cm-type-toggle')),
      protoRow: rowOf(head.querySelector('.cm-proto-toggle')),
      portRowsIntact: card.querySelectorAll('.cm-port').length,
    };
  });
  await shot(page, `${scene}_5_header_narrow_pane`);
  console.log(`   header: pane=${header.paneWidth}px name="${header.nameValue}" ` +
    `nameBox=${header.nameWidth}px ipBox=${header.ipWidth}px rows=${header.rowCount}`);
  ok = check('header: two rows', header.rowCount === 2, String(header.rowCount)) && ok;
  ok = check('header: name + IP on row 1',
    header.nameRow === 0 && header.ipRow === 0,
    `name=${header.nameRow} ip=${header.ipRow}`) && ok;
  ok = check('header: type + transport buttons on row 2',
    header.typeRow === 1 && header.protoRow === 1,
    `type=${header.typeRow} proto=${header.protoRow}`) && ok;
  ok = check('header: name reads in full at the narrowest pane',
    !header.nameTruncated, `"${header.nameValue}" in ${header.nameWidth}px`) && ok;
  ok = check("header: a 13-char name ('LeftFrontWall') reads in full",
    header.longNameFits, JSON.stringify(header.longNameProbe)) && ok;
  ok = check('header: name box is wider than the IP box',
    header.nameWidth > header.ipWidth,
    `${header.nameWidth} vs ${header.ipWidth}`) && ok;
  ok = check('header: port rows below are intact', header.portRowsIntact > 0,
    String(header.portRowsIntact)) && ok;
  await page.evaluate(() => window.__splitLayout.setRatio(0.38));
  await sleep(700);
  await shot(page, `${scene}_6_header_default_pane`);

  // ── Picker overlap: the UNPATCHED pill must not cover the chip grid ────
  // Enter pick mode on the first port ("+ list"), then compare the pill's rect
  // against the pane and the chip grid — first with the keep-out DISABLED (a
  // faithful reproduction of the old behavior) and then with it on.
  const enteredPick = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#cm-body .cm-btn')]
      .find((b) => b.textContent === '+ list');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!enteredPick) throw new Error('no "+ list" button found — cannot test the picker overlap');
  await sleep(900);

  // The pill is only created when NOTHING is patched (patch_manager.js
  // `_updateWarning(_patchedCount === 0 && _totalCount > 0)`), which is the
  // state the operator is in mid-mapping but not the state of a saved scene.
  // When it is absent, stand up the identical element — same id, so the same
  // stylesheet rules decide its geometry, which is exactly what is under test.
  // Flagged as synthetic in the log and removed again afterwards.
  const synthetic = await page.evaluate(() => {
    if (document.getElementById('unpatched-warning')) return false;
    const el = document.createElement('div');
    el.id = 'unpatched-warning';
    el.setAttribute('role', 'status');
    el.dataset.probeSynthetic = '1';
    el.textContent = '⚠ UNPATCHED — SIM-ONLY MODE';
    document.body.appendChild(el);
    return true;
  });
  if (synthetic) {
    console.log('   note: scene is patched, so the UNPATCHED pill is stood up '
      + 'synthetically (same id → same CSS) to measure its geometry');
  }

  const readOverlap = () => {
    const pill = document.getElementById('unpatched-warning');
    if (!pill || pill.classList.contains('hidden')) return { pillShown: false };
    const p = pill.getBoundingClientRect();
    const hit = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const w = Math.min(p.right, r.right) - Math.max(p.left, r.left);
      const h = Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top);
      return Math.round(Math.max(0, w) * Math.max(0, h));
    };
    return {
      pillShown: true,
      pillLeft: Math.round(p.left),
      overPane: hit('#controller-map-panel'),
      overChips: hit('#cm-body .cm-tray-chips'),
      picking: !!document.querySelector('#cm-body .cm-tray-picking'),
    };
  };

  await page.evaluate(() => document.body.classList.remove('sim-map-docked'));
  await sleep(400);
  const pillBefore = await page.evaluate(readOverlap);
  await shot(page, `${scene}_7_picker_pill_before`);
  await page.evaluate(() => window.__splitLayout.applyLayout());
  await sleep(500);
  const pillAfter = await page.evaluate(readOverlap);
  await shot(page, `${scene}_8_picker_pill_after`);

  if (!pillBefore.pillShown) {
    throw new Error('UNPATCHED pill missing — the overlap check cannot run');
  } else {
    ok = check('picker: pick mode is actually open', pillAfter.picking) && ok;
    ok = check('picker (before fix): pill DID overlap the mapping pane',
      pillBefore.overPane > 0, JSON.stringify(pillBefore)) && ok;
    ok = check('picker (after fix): pill clears the mapping pane entirely',
      pillAfter.overPane === 0, JSON.stringify(pillAfter)) && ok;
    ok = check('picker (after fix): pill covers no chip grid pixels',
      pillAfter.overChips === 0, JSON.stringify(pillAfter)) && ok;
    ok = check('picker: the pill is still on screen (moved, never suppressed)',
      pillAfter.pillLeft > 0 && pillAfter.pillLeft < 1e4, String(pillAfter.pillLeft)) && ok;
  }

  // NEVER leave a picker open, and take the synthetic pill back out.
  await page.evaluate(() => {
    const done = [...document.querySelectorAll('#cm-body .cm-btn')]
      .find((b) => b.textContent === '✓ done');
    if (done) done.click();
    const el = document.getElementById('unpatched-warning');
    if (el && el.dataset.probeSynthetic === '1') el.remove();
  });
  await sleep(600);
  const stillPicking = await page.evaluate(
    () => !!document.querySelector('#cm-body .cm-tray-picking'));
  ok = check('picker: exited cleanly', !stillPicking) && ok;

  // Persistence across a reload of THIS window only.
  await page.evaluate(() => document.querySelector('#cm-body .cm-controllers-toggle').click());
  await sleep(400);
  await loadSim(page, scene);
  await page.evaluate(() => {
    const panel = document.getElementById('controller-map-panel');
    if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
  });
  await sleep(1500);
  const afterReload = await page.evaluate(readPane);
  ok = check('reload: collapsed state persisted',
    afterReload.collapsedClass && !afterReload.main.visible) && ok;
  await shot(page, `${scene}_4_after_reload`);

  // Leave the pref clean so no later window inherits a hidden list.
  await page.evaluate(() => localStorage.setItem('bm26.map.controllersCollapsed', '0'));
  return ok;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${VIEWPORT.width + 40},${VIEWPORT.height + 120}`,
    ],
  });
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`  [console] ${msg.text().slice(0, 300)}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) console.error(`  [http ${res.status()}] ${res.url()}`);
  });
  await page.evaluateOnNewDocument(blockSacnOut, SACN_OUT_PORT);
  await page.setViewport(VIEWPORT);

  let allOk = true;
  for (const scene of SCENES) allOk = (await runScene(page, scene)) && allOk;

  if (KEEP_ALIVE) {
    console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
    await new Promise(() => {});
  }
  await browser.close();
  console.log(allOk ? '\n✅ all checks passed' : '\n❌ checks FAILED');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
