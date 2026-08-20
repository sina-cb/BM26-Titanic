/**
 * pick_accuracy_test.cjs — Automated raycaster pick-accuracy check for the
 * split-screen mapping layout (feat/bm_readiness, Slice 2).
 *
 * WHY: interaction.js used to compute pick NDC from window.innerWidth/Height.
 * Once the canvas shrinks to the sim pane under a split, that math mis-hits
 * every fixture — the error grows with the map-pane width, and the SAME screen
 * click lands on a DIFFERENT scene point at every pane width.
 *
 * Test invariant (the split-invariance property): clicking a fixture's own
 * projected screen center — recomputed correctly at each pane width — must
 * select the SAME fixture at every split ratio, and never nothing. With the
 * window-NDC bug the ray diverges as the pane narrows, so the selected fixture
 * drifts (or the click misses entirely). The test drives a real browser, clicks
 * a spread of fixtures across four pane widths, and fails loudly (exit 1) on any
 * drift or miss. Par hitboxes are the only pickable objects (the ship mesh is
 * not in interactiveObjects), so a click at a fixture center always resolves to
 * some par under a correct transform.
 *
 * Usage:  node pick_accuracy_test.cjs [--keep-alive]
 * Servers must already be running (cd simulation && npm start).
 */

const puppeteer = require('puppeteer');

const SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=pixel_mapping&renderer=webgl';
// 1280x720: SwiftShader (software GL on the agent path) loses the WebGL context
// on heavy/close views at higher resolutions — stay at 720p here.
const VIEWPORT = { width: 1280, height: 720 };
const WINDOW_SIZE = { width: VIEWPORT.width + 192, height: VIEWPORT.height + 108 };
const KEEP_ALIVE = process.argv.includes('--keep-alive');

// Split ratios (map-pane fraction). null = map closed (full-window control).
const RATIOS = [null, 0.30, 0.42, 0.55];
const MAX_TARGETS = 8;     // fixtures tracked across the ratios

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  return puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${WINDOW_SIZE.width},${WINDOW_SIZE.height}`,
    ],
  });
}

async function loadSim(page) {
  page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered — continuing'));
  await page.waitForFunction(
    () => window.parFixtures && window.parFixtures.length > 0
      && typeof window.toggleControllerMapPanel === 'function' && window.__splitLayout,
    { timeout: 30000 });
  await sleep(3500);

  // The map pane now docks LEFT and the right-edge Lighting Controls drawer
  // stays open during mapping (operator ruling). That drawer overlays the RIGHT
  // of the sim pane, exactly where fixtures project as the map pane widens — a
  // click there hits the panel, not the canvas. This test isolates the
  // raycaster NDC math, so collapse the drawer to clear those clicks; occlusion
  // by a floating panel is a separate concern, not an NDC error.
  await page.evaluate(async () => {
    const cd = await import('/simulation/src/gui/control_drawer.js');
    if (cd.setDrawerCollapsed) cd.setDrawerCollapsed(true);
  });
  await sleep(400);
}

/** Set the split state: null closes the map pane, a number opens + sets ratio. */
async function setSplit(page, ratio) {
  const state = await page.evaluate((r) => {
    const panel = document.getElementById('controller-map-panel');
    const open = !panel.classList.contains('hidden');
    if (r === null) {
      if (open) window.toggleControllerMapPanel();
    } else {
      if (!open) window.toggleControllerMapPanel();
      window.__splitLayout.setRatio(r);
    }
    return window.__splitLayout.getState();
  }, ratio);
  await sleep(500);
  return state;
}

/** In-page: canvas rect, each par fixture's projected screen center, and the
 *  screen positions of ALL interactive objects (for the isolation gate). */
const CLEAR_RADIUS = 26; // a target's center must be this clear of every other
                         // pickable object's screen center to be unambiguous.
async function projectAll(page) {
  return page.evaluate(async (clearR) => {
    const st = await import('/simulation/src/core/state.js');
    const THREE = await import('three');
    const { camera, renderer } = st;
    const rect = renderer.domElement.getBoundingClientRect();
    const toPx = (v) => ({
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      front: v.z > -1 && v.z < 1,
    });

    // Screen centers of every pickable object (pars, strand handles, traces).
    const objs = st.interactiveObjects || [];
    const tmp = new THREE.Vector3();
    const obstacles = [];
    for (const o of objs) {
      o.getWorldPosition(tmp);
      const p = toPx(tmp.clone().project(camera));
      if (p.front) obstacles.push(p);
    }

    const fixtures = window.parFixtures || [];
    const out = [];
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (!f || !f.hitbox) continue;
      const p = toPx(f.hitbox.position.clone().project(camera));
      const inPane = p.front
        && p.x >= rect.left + 24 && p.x <= rect.right - 24
        && p.y >= rect.top + 24 && p.y <= rect.bottom - 24;
      // Clear of every OTHER pickable object's center at this width?
      let near = 0;
      for (const ob of obstacles) {
        if (Math.hypot(ob.x - p.x, ob.y - p.y) < 0.5) continue; // itself
        if (Math.hypot(ob.x - p.x, ob.y - p.y) < clearR) { near++; break; }
      }
      out.push({ index: i, name: f.config && f.config.name, px: p.x, py: p.y, inPane, clear: near === 0 });
    }
    return { rect: { left: rect.left, right: rect.right, width: rect.width }, fixtures: out };
  }, CLEAR_RADIUS);
}

async function readSelection(page) {
  return page.evaluate(async () => {
    const st = await import('/simulation/src/core/state.js');
    return [...st.selectedFixtureIndices];
  });
}

async function main() {
  const browser = await launch();
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport(VIEWPORT);
  console.log(`Loading ${SIM_URL}`);
  await loadSim(page);

  // Frame a close, well-separated view so fixtures don't pile up on screen
  // (the far default view compresses the whole ship into a dense cluster where
  // every par overlaps a strand handle). Camera stays fixed for the whole run —
  // only the aspect changes as the pane resizes, which is exactly what we test.
  const VIEW = process.argv.includes('--view') ? process.argv[process.argv.indexOf('--view') + 1] : 'aerial';
  await page.evaluate((v) => { if (window.animateCamera) window.animateCamera(v); }, VIEW);
  await sleep(3500);
  console.log(`Camera framed at "${VIEW}"`);

  // Pick a spread of target fixtures from the widest (map-closed) state,
  // weighted to the right side where the window-vs-canvas NDC error is largest.
  await setSplit(page, null);
  const base = await projectAll(page);
  const pool = base.fixtures.filter((f) => f.inPane && f.clear).sort((a, b) => b.px - a.px);
  // Even spread across the in-pane pool.
  const targets = [];
  const step = Math.max(1, Math.floor(pool.length / MAX_TARGETS));
  for (let i = 0; i < pool.length && targets.length < MAX_TARGETS; i += step) {
    targets.push(pool[i].index);
  }
  console.log(`Tracking ${targets.length} target fixtures across ${RATIOS.length} pane widths: [${targets.join(', ')}]`);

  // selections[targetIndex] = { ratio -> selectionArray }
  const selections = new Map(targets.map((t) => [t, {}]));

  for (const ratio of RATIOS) {
    const state = await setSplit(page, ratio);
    const proj = await projectAll(page);
    const byIndex = new Map(proj.fixtures.map((f) => [f.index, f]));
    const label = ratio === null ? 'map-closed (full window)' : `map ${Math.round(ratio * 100)}%`;
    console.log(`\n── ${label} — sim pane ${Math.round(proj.rect.width)}px wide ──`);
    for (const t of targets) {
      const f = byIndex.get(t);
      if (!f || !f.inPane || !f.clear) {
        console.log(`   #${t} not cleanly clickable at this width (inPane=${f && f.inPane}, clear=${f && f.clear}) — skipped`);
        continue;
      }
      // Reset first: Escape detaches the TransformControls gizmo and clears
      // the selection. Without this, the gizmo from the PREVIOUS click sits
      // over the scene and any click grazing an axis makes onPointerDown
      // early-return (`if (transformControl.axis) return`), leaving a stale
      // selection — a test artifact, not a pick error.
      await page.keyboard.press('Escape');
      await page.mouse.move(3, Math.round(VIEWPORT.height / 2));
      await sleep(40);
      await page.mouse.click(f.px, f.py);
      await sleep(110);
      const sel = await readSelection(page);
      selections.get(t)[String(ratio)] = sel;
      console.log(`   #${t} "${f.name}" @ (${Math.round(f.px)},${Math.round(f.py)}) → selected [${sel.join(',')}]`);
    }
  }

  // Assert split-invariance: each target selects the SAME non-empty fixture at
  // every pane width where it was clickable.
  console.log('\n════ split-invariance check ════');
  let failures = 0;
  let checked = 0;
  for (const t of targets) {
    const perRatio = selections.get(t);
    const seen = Object.values(perRatio);
    if (seen.length < 2) {
      console.log(`  #${t}: only ${seen.length} clickable state(s) — insufficient, skipped`);
      continue;
    }
    checked++;
    const keys = seen.map((s) => JSON.stringify(s));
    const stable = keys.every((k) => k === keys[0]);
    const nonEmpty = seen.every((s) => s.length === 1);
    const ok = stable && nonEmpty;
    if (!ok) failures++;
    const detail = Object.entries(perRatio)
      .map(([r, s]) => `${r === 'null' ? 'full' : r}:[${s.join(',')}]`).join('  ');
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] #${t} stable=${stable} nonEmpty=${nonEmpty}  ${detail}`);
  }

  console.log(`\n════ pick-accuracy: ${checked - failures}/${checked} targets split-invariant across ${RATIOS.length} pane widths ════`);
  if (failures > 0) console.error(`❌ ${failures} target(s) drifted — raycaster NDC is WRONG for the split layout.`);
  else console.log('✅ Every tracked fixture selected the same fixture at every pane width (raycaster follows the canvas rect).');

  if (KEEP_ALIVE) {
    console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
    await new Promise(() => {});
  } else {
    await browser.close();
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
