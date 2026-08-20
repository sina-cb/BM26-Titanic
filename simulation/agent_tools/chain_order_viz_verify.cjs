/**
 * chain_order_viz_verify.cjs — live proof for the 3D CHAIN-ORDER OVERLAY
 * (report 20260725_43; the deferred item (b) of 20260725_42 §6). Renderer-only
 * (see_the_world skill): launches its OWN Chromium against the ALREADY-RUNNING
 * stack on :6969 and NEVER starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same as generator_splits_verify):
 * (1) params.autoSave = false, (2) window.debounceAutoSave stubbed, (3) EVERY
 * request to the save server (:6970) aborted at the network layer. A pristine
 * deep-clone of params.{parLights,traces} is captured at start and restored at
 * exit. Browser closed on exit; the operator's own browser is never touched.
 *
 * Proves, through the REAL GUI, on a synthetic 5-light LINE trace whose path
 * positions sit at known x coordinates (-10, -5, 0, 5, 10):
 *   BASE     — no splits → ONE run, numbers 1..5 over path positions 1..5.
 *   OPERATOR — the 4→5 / 3→2 / 1→1 case → THREE runs in three distinct
 *              colours, chain numbers 1..5 landing on path positions
 *              4,5,3,2,1 (design 20260725_41 §4's table), 2 dashed jumps and
 *              4 arrowheads (count−1 cable steps).
 *   SWAP     — ⇄ Swap start/end flips the overlay to one reversed run live.
 *   HIDDEN   — with "Show Generators" off, a SCENE CENSUS finds ZERO objects
 *              carrying userData.isChainViz: the overlay is disposed, not
 *              merely made invisible (perf contract, memory
 *              sim-perf-per-object-explosion + report 20260725_38).
 *   TOGGLE   — the ⛓ Show Chain Order switch disposes/rebuilds on its own,
 *              leaving the rest of the trace visuals untouched.
 *   INVALID  — invalid splits draw NO chain (the card's red badge is the loud
 *              channel) rather than a plausible-looking lie.
 *   COST     — object counts with the overlay on vs off, reported for the
 *              titanic scene as a whole.
 *
 * Usage:  node chain_order_viz_verify.cjs [--keep-alive]
 * Screenshots: ~/tmp/chain_viz/
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'chain_viz');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GROUP = 'ZZ Chain Viz Probe';
const POSITION_X = [-10, -5, 0, 5, 10];
const OPERATOR_SPLITS = [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }];
// design 20260725_41 §4: fixture number j+1 → path position
const EXPECTED_TABLE = [4, 5, 3, 2, 1];

let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const p = path.join(OUT, `${String(shotIndex).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false, defaultViewport: VP, protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) {
      const s = getComputedStyle(o);
      if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false;
    }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0
      && !!window.renderGeneratorGUI && Array.isArray(window.traceGuiFolders)
      && typeof window.refreshAllChainOrderViz === 'function';
  }, { timeout: 90000 });
  await sleep(3000);
}

/**
 * Independent scene census of the overlay: walks the WHOLE scene graph looking
 * for `userData.isChainViz`, so it cannot be fooled by this feature's own
 * bookkeeping. Also totals the scene's objects, for the cost figure.
 */
function census(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    let sceneObjects = 0;
    let chainObjects = 0;
    let chainVisible = 0;
    const byType = {};
    scene.traverse((o) => {
      sceneObjects += 1;
      if (!o.userData || !o.userData.isChainViz) return;
      chainObjects += 1;
      byType[o.type] = (byType[o.type] || 0) + 1;
      let visible = o.visible;
      let p = o.parent;
      while (visible && p) { visible = p.visible; p = p.parent; }
      if (visible) chainVisible += 1;
    });
    return { sceneObjects, chainObjects, chainVisible, byType };
  });
}

/** Everything the overlay knows about one trace, read straight off traceObjects. */
function readViz(page, traceIdx) {
  return page.evaluate((idx) => {
    const viz = (window.traceObjects || [])[idx] && window.traceObjects[idx].chainViz;
    if (!viz) return null;
    const hex = (c) => `#${c.getHexString()}`;
    // Distinct run colours, read off the LINE's vertex colours (the actual
    // pixels on screen), not off the plan that produced them.
    const runColors = [];
    if (viz.runLine) {
      const attr = viz.runLine.geometry.getAttribute('color');
      for (let v = 0; v < attr.count; v++) {
        const r = attr.getX(v); const g = attr.getY(v); const b = attr.getZ(v);
        const max = Math.max(r, g, b) || 1;   // undo the comet ramp
        runColors.push([r / max, g / max, b / max].map((x) => Math.round(x * 100) / 100).join(','));
      }
    }
    return {
      count: viz.count,
      topologyKey: viz.topologyKey,
      objects: viz.objects.length,
      runSteps: viz.runSteps.length,
      jumpSteps: viz.jumpSteps.length,
      hasRunLine: !!viz.runLine,
      hasJumpLine: !!viz.jumpLine,
      arrowInstances: viz.arrows ? viz.arrows.count : 0,
      labels: viz.labels.map((l) => ({
        number: l.sprite.userData.chainNumber,
        color: hex(l.sprite.material.color),
        pathPosition: l.pathPosition,
        y: Math.round(l.sprite.position.y * 100) / 100,
        // The guide is INDEX-ONLY by operator ruling (2026-07-29): the sprite
        // is a plain square glyph, never a stretched name plate.
        scaleX: Math.round(l.sprite.scale.x * 100) / 100,
        scaleY: Math.round(l.sprite.scale.y * 100) / 100,
      })),
      distinctRunColors: [...new Set(runColors)].length,
      distinctLabelColors: [...new Set(viz.labels.map((l) => hex(l.sprite.material.color)))].length,
    };
  }, traceIdx);
}

/** Click a button inside the trace card whose text matches `re`. */
function clickCardButton(page, traceIdx, reSource) {
  return page.evaluate((idx, src) => {
    const re = new RegExp(src);
    const el = window.traceGuiFolders[idx].domElement;
    const btn = [...el.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
    if (!btn) throw new Error(`button matching ${src} not found`);
    btn.click();
    return btn.textContent;
  }, traceIdx, reSource);
}

/**
 * Frame the probe trace directly. `flyToTrace` backs off to `max(10, radius*3)`
 * which puts the whole ship in shot — too wide to read a chain number by eye.
 * The probe is a known line (x −10..10 at y=6, z=0), so the camera is placed
 * explicitly instead.
 */
async function lookAtProbe(page, view = 'three-quarter') {
  await page.evaluate((v) => {
    const positions = {
      'three-quarter': [11, 12, 17],
      'front': [0, 8.5, 17],
      'top': [0, 20, 0.01],
    };
    const [x, y, z] = positions[v];
    window.__camera.position.set(x, y, z);
    window.__controls.target.set(0, 6, 0);
    window.__controls.update();
  }, view);
  await sleep(900);
}

// Same panel list agent_render.cjs hides (see_the_world step 5).
const UI_PANEL_IDS = ['hud-frame', 'info-panel', 'pattern-editor-panel',
  'sacn-in-monitor-panel', 'sacn-out-monitor-panel', 'view-presets', 'gui-panel',
  'unpatched-warning', 'pixel-map-panel'];

/** Hide every GUI panel so the capture is pure 3D. */
async function hideUi(page, hidden) {
  await page.evaluate((hide, ids) => {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = hide ? 'none' : '';
    });
  }, hidden, UI_PANEL_IDS);
  await sleep(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  const dialogs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

  // GUARD 3: abort every save-server request so nothing can write the scene.
  await page.setRequestInterception(true);
  let abortedSaves = 0;
  page.on('request', (req) => {
    if (/:6970(\/|$)/.test(req.url())) { abortedSaves += 1; req.abort(); return; }
    req.continue();
  });

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  // GUARDS 1+2 + pristine snapshot + scene handle for the census.
  const gpu = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__scene = state.scene;
    window.__camera = state.camera;
    window.__controls = state.controls;
    window.__params.autoSave = false;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      traces: clone(window.__params.traces),
      generatorsVisible: window.__params.generatorsVisible,
      chainOrderVisible: window.__params.chainOrderVisible,
      traceVisualsOperatorChoice: window.__params.traceVisualsOperatorChoice,
    };
    // This verifier runs in the `full` profile, where trace visuals are hidden
    // by DEFAULT since 20260725_81 (their preview dots read as coloured rings
    // on the fixtures). Replay what the operator flipping "Show Generators"
    // does, so the overlay under test is actually drawn. Restored at the end.
    window.__params.traceVisualsOperatorChoice = true;
    if (window.applyTraceVisualsVisibility) window.applyTraceVisualsVisibility();
    return window.__gpuAdapter || null;
  }, ORIGIN);
  // Ops rule 20260725_39: record the adapter next to every observation.
  console.log(`\n[gpu] ${JSON.stringify(gpu)}`);

  // ── COST on the real scene, overlay ON vs OFF ─────────────────────────────
  const sceneOn = await census(page);
  await page.evaluate(() => {
    window.__params.chainOrderVisible = false;
    window.refreshAllChainOrderViz();
  });
  await sleep(400);
  const sceneOff = await census(page);
  await page.evaluate(() => {
    window.__params.chainOrderVisible = true;
    window.refreshAllChainOrderViz();
  });
  await sleep(400);
  console.log(`\n[cost] titanic scene, chain overlay ON : ${sceneOn.sceneObjects} scene objects` +
    ` (${sceneOn.chainObjects} chain: ${JSON.stringify(sceneOn.byType)})`);
  console.log(`[cost] titanic scene, chain overlay OFF: ${sceneOff.sceneObjects} scene objects` +
    ` (${sceneOff.chainObjects} chain)`);
  const costOk = sceneOff.chainObjects === 0
    && sceneOn.chainObjects > 0
    && sceneOn.sceneObjects - sceneOff.sceneObjects === sceneOn.chainObjects;

  // ── Synthetic 5-light LINE trace ──────────────────────────────────────────
  const traceIdx = await page.evaluate((group) => {
    const p = window.__params;
    if (!Array.isArray(p.traces)) p.traces = [];
    p.traces.push({
      name: group, groupName: group, shape: 'line',
      startX: -10, startY: 6, startZ: 0,
      endX: 10, endY: 6, endZ: 0,
      count: 5,
      aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 0,
      lightColor: '#ffaa44', lightIntensity: 10, lightAngle: 30,
      fixtureType: 'UkingPar', controllerIp: '', generated: false,
    });
    window.renderGeneratorGUI();
    window.rebuildTraceObjects();
    return p.traces.length - 1;
  }, GROUP);
  console.log(`Synthetic 5-light line trace "${GROUP}" at index ${traceIdx}`);
  await lookAtProbe(page, 'three-quarter');

  // ── BASE: no splits → one run, numbers over path positions 1..5 ───────────
  const base = await readViz(page, traceIdx);
  console.log('\n[BASE] viz:', JSON.stringify({
    objects: base.objects, runSteps: base.runSteps, jumpSteps: base.jumpSteps,
    arrows: base.arrowInstances, distinctRunColors: base.distinctRunColors,
    labels: base.labels.map((l) => `p${l.pathPosition}`).join(' '),
  }));
  await hideUi(page, true);
  await shot(page, 'base_single_run');
  await hideUi(page, false);
  // The topology key carries the GROUP NAME as well as the splits, because the
  // labels read `"<group> <n>"` — a rename must rebuild the overlay instead of
  // leaving the old name floating over every light.
  const baseOk = base !== null
    && base.count === 5
    && base.topologyKey === 'path-order'
    && base.runSteps === 4 && base.jumpSteps === 0
    && base.arrowInstances === 4
    && base.hasRunLine === true && base.hasJumpLine === false
    && base.distinctRunColors === 1
    && base.labels.length === 5
    && base.labels.every((l, j) => l.pathPosition === j + 1);

  // ── OPERATOR: 4→5 / 3→2 / 1→1 ────────────────────────────────────────────
  await page.evaluate((idx, splits) => {
    window.__params.traces[idx].chainSplits = splits;
    window.renderGeneratorGUI();
  }, traceIdx, OPERATOR_SPLITS);
  await sleep(500);
  const op = await readViz(page, traceIdx);
  console.log('\n[OPERATOR] viz:', JSON.stringify({
    objects: op.objects, runSteps: op.runSteps, jumpSteps: op.jumpSteps,
    arrows: op.arrowInstances, distinctRunColors: op.distinctRunColors,
    distinctLabelColors: op.distinctLabelColors,
    labels: op.labels.map((l) => `${l.pathPosition}:${l.color}`).join(' '),
  }));
  await lookAtProbe(page, 'three-quarter');
  await shot(page, 'operator_case_with_card');
  await hideUi(page, true);
  await shot(page, 'operator_three_runs');
  await lookAtProbe(page, 'front');
  await shot(page, 'operator_front_on');
  await lookAtProbe(page, 'top');
  await shot(page, 'operator_top_down');
  await hideUi(page, false);
  await lookAtProbe(page, 'three-quarter');
  // Chain number j+1 must sit on path position EXPECTED_TABLE[j].
  const labelByNumber = {};
  op.labels.forEach((l, j) => { labelByNumber[j + 1] = l.pathPosition; });
  const opOk = op.count === 5
    && op.runSteps === 2 && op.jumpSteps === 2   // (2-1)+(2-1)+(1-1) runs, 2 jumps
    && op.arrowInstances === 4                   // count − 1 cable steps
    && op.hasRunLine === true && op.hasJumpLine === true
    && op.distinctRunColors === 2                // split 3 is a single light: no line
    && op.distinctLabelColors === 3              // …but it still gets its own colour
    && op.labels.length === 5
    && op.labels.every((l, j) => l.pathPosition === EXPECTED_TABLE[j]);

  // ── INDEX-ONLY guides (operator ruling, 2026-07-29) ──────────────────────
  // "I don't like the names on the generator guides too messy, just the index
  // is enough." A names-in-3D build was tried and measured at ~7.6× wider than
  // tall per label — it crowded the ring. This pins the guide back to a plain
  // square number glyph: one label per light, numbers 1..N, no name plate.
  const indexOnlyOk = op.labels.every((l) => l.scaleX === l.scaleY)
    && op.labels.map((l) => l.number).join(',') === '1,2,3,4,5'
    && op.labels.every((l) => l.text === undefined);
  console.log('\n[INDEX-ONLY] labels:', op.labels
    .map((l) => `${l.number}@p${l.pathPosition}`).join(' '),
    `— sprite ${op.labels[0].scaleX}×${op.labels[0].scaleY} (square)`);
  await lookAtProbe(page, 'three-quarter');
  await hideUi(page, true);
  await shot(page, 'index_only_guides');
  await lookAtProbe(page, 'front');
  await shot(page, 'index_only_front_on');
  await hideUi(page, false);
  await lookAtProbe(page, 'three-quarter');

  // ── SWAP: the overlay follows the card live ──────────────────────────────
  await page.evaluate((idx) => {
    if (window.openTraceFolder) window.openTraceFolder(idx);
    const card = window.traceGuiFolders[idx];
    card.open();
    const chain = (card.folders || []).find((f) =>
      /Chain Order/.test((f.$title && f.$title.textContent) || ''));
    if (!chain) throw new Error('⛓ Chain Order folder not found on the card');
    chain.open();
    chain.domElement.scrollIntoView({ block: 'center' });
  }, traceIdx);
  await sleep(400);
  // What the operator actually sees: the ⛓ Chain Order card next to the
  // "Show Generators" / "⛓ Show Chain Order" switches that gate the overlay.
  await page.evaluate(() => {
    const panel = document.getElementById('gui-panel');
    const toggle = [...panel.querySelectorAll('.controller .name')]
      .find((n) => /Show Chain Order/.test(n.textContent || ''));
    if (!toggle) throw new Error('⛓ Show Chain Order toggle not found in the GUI');
    toggle.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await shot(page, 'operator_controls');
  await clickCardButton(page, traceIdx, 'Swap start/end');
  await sleep(800);
  const swapped = await readViz(page, traceIdx);
  console.log('\n[SWAP] viz:', JSON.stringify({
    runSteps: swapped.runSteps, jumpSteps: swapped.jumpSteps,
    arrows: swapped.arrowInstances, topologyKey: swapped.topologyKey,
    labels: swapped.labels.map((l) => `p${l.pathPosition}`).join(' '),
  }));
  await lookAtProbe(page, 'three-quarter');
  await hideUi(page, true);
  await shot(page, 'swap_reversed_run');
  await hideUi(page, false);
  const swapOk = swapped.runSteps === 4 && swapped.jumpSteps === 0
    && swapped.arrowInstances === 4
    && swapped.distinctRunColors === 1
    && swapped.topologyKey === JSON.stringify([{ from: 5, to: 1 }])
    && swapped.labels.every((l, j) => l.pathPosition === 5 - j);

  // Back to the operator's case for the remaining checks.
  await clickCardButton(page, traceIdx, 'Restore path order');
  await sleep(700);
  await page.evaluate((idx, splits) => {
    window.__params.traces[idx].chainSplits = splits;
    window.renderGeneratorGUI();
  }, traceIdx, OPERATOR_SPLITS);
  await sleep(500);

  // ── HIDDEN: generators off → the overlay is DISPOSED, not hidden ─────────
  const beforeHide = await census(page);
  await page.evaluate(() => {
    window.__params.generatorsVisible = false;
    window.setTraceObjectsVisibility(false);
  });
  await sleep(500);
  const hidden = await census(page);
  const hiddenViz = await readViz(page, traceIdx);
  console.log(`\n[HIDDEN] generators off → chain objects in scene: ${hidden.chainObjects}` +
    ` (was ${beforeHide.chainObjects}); tObj.chainViz = ${hiddenViz === null ? 'null' : 'PRESENT'}`);
  await hideUi(page, true);
  await shot(page, 'generators_hidden_no_chain');
  await hideUi(page, false);
  const hiddenOk = hidden.chainObjects === 0 && hidden.chainVisible === 0 && hiddenViz === null
    && beforeHide.chainObjects > 0;

  await page.evaluate(() => {
    window.__params.generatorsVisible = true;
    window.setTraceObjectsVisibility(true);
  });
  await sleep(500);
  const reshown = await census(page);
  const reshownOk = reshown.chainObjects === beforeHide.chainObjects;
  console.log(`[RESHOWN] generators on  → chain objects back to ${reshown.chainObjects}`);

  // ── TOGGLE: ⛓ Show Chain Order disposes on its own ───────────────────────
  await page.evaluate(() => {
    window.__params.chainOrderVisible = false;
    window.refreshAllChainOrderViz();
  });
  await sleep(400);
  const toggledOff = await census(page);
  const traceStillThere = await page.evaluate((idx) => {
    const t = window.traceObjects[idx];
    return { groupVisible: t.group.visible, dots: (t.visuals || []).length, handles: (t.handles || []).length };
  }, traceIdx);
  await hideUi(page, true);
  await shot(page, 'chain_toggle_off_trace_intact');
  await hideUi(page, false);
  await page.evaluate(() => {
    window.__params.chainOrderVisible = true;
    window.refreshAllChainOrderViz();
  });
  await sleep(400);
  const toggledOn = await census(page);
  console.log(`\n[TOGGLE] off → ${toggledOff.chainObjects} chain objects, trace visuals intact` +
    ` ${JSON.stringify(traceStillThere)}; on → ${toggledOn.chainObjects}`);
  const toggleOk = toggledOff.chainObjects === 0
    && toggledOn.chainObjects === reshown.chainObjects
    && traceStillThere.groupVisible === true
    && traceStillThere.dots > 0 && traceStillThere.handles > 0;

  // ── INVALID: no chain is drawn at all ────────────────────────────────────
  await page.evaluate((idx) => {
    window.__params.traces[idx].chainSplits = [{ from: 3, to: 5 }];   // 1,2 uncovered
    window.renderGeneratorGUI();
  }, traceIdx);
  await sleep(500);
  const invalidViz = await readViz(page, traceIdx);
  const invalidCensus = await census(page);
  console.log(`\n[INVALID] tObj.chainViz = ${invalidViz === null ? 'null' : 'PRESENT'};` +
    ` chain objects scene-wide: ${invalidCensus.chainObjects} (the other traces keep theirs)`);
  await lookAtProbe(page, 'three-quarter');
  await hideUi(page, true);
  await shot(page, 'invalid_splits_no_chain_drawn');
  await hideUi(page, false);
  // Only THIS trace loses its chain — the rest of the scene is unaffected.
  const invalidOk = invalidViz === null && invalidCensus.chainObjects > 0;

  // ── Restore pristine (deterministic zero residue). ───────────────────────
  const residue = await page.evaluate((group) => {
    const p = window.__params;
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    p.parLights = clone(window.__pristine.parLights);
    p.traces = clone(window.__pristine.traces);
    p.generatorsVisible = window.__pristine.generatorsVisible;
    p.chainOrderVisible = window.__pristine.chainOrderVisible;
    if (window.__pristine.traceVisualsOperatorChoice === undefined) delete p.traceVisualsOperatorChoice;
    else p.traceVisualsOperatorChoice = window.__pristine.traceVisualsOperatorChoice;
    if (window.rebuildParLights) window.rebuildParLights(true);
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    if (window.renderParGUI) window.renderParGUI();
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      parLightsMatch: eq(p.parLights, window.__pristine.parLights),
      tracesMatch: eq(p.traces, window.__pristine.traces),
      noProbeGroup: !p.parLights.some((l) => l.group === group),
      noProbeTrace: !p.traces.some((t) => (t.groupName || t.name) === group),
    };
  }, GROUP);
  console.log('\n[restore]', JSON.stringify(residue));

  // ── Summary ──────────────────────────────────────────────────────────────
  const noise = errors.filter((e) =>
    /gui_builder|chain_order_visual|generator_chain_order|chainViz|TypeError|is not a function/i.test(e)
    && !/\[chainSplits\]/.test(e));
  const results = {
    'cost_zero_objects_when_overlay_off': costOk,
    'base_no_splits_is_one_run_numbered_along_the_path': baseOk,
    'operator_case_three_runs_three_colours_two_jumps': opOk,
    'guides_are_index_only_no_name_plates': indexOnlyOk,
    'swap_flips_the_overlay_live': swapOk,
    'generators_hidden_disposes_the_overlay_entirely': hiddenOk,
    'generators_reshown_rebuilds_it': reshownOk,
    'chain_toggle_is_independent_of_the_trace_visuals': toggleOk,
    'invalid_splits_draw_no_chain': invalidOk,
    'restore_zero_residue': residue.parLightsMatch && residue.tracesMatch
      && residue.noProbeGroup && residue.noProbeTrace,
    'no_unexpected_console_errors': noise.length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  console.log(`  (save-server requests aborted this run: ${abortedSaves})`);
  console.log(`  (gpu adapter: ${JSON.stringify(gpu)})`);
  if (noise.length) { console.log('  console errors:'); noise.slice(0, 15).forEach((e) => console.log('   •', e.slice(0, 200))); }
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Screenshots: ${OUT}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
