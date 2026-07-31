/**
 * pixel_map_view_tuning_verify.cjs — live proof + screenshots for the 2D
 * Pixel Map default-view tuning of report 20260725_48 (operator's three
 * orders: front view = front lights only & readable, top-down = room for the
 * par rings + both small smoke stacks, TE sign rotated 90° CCW).
 *
 * Renderer-only (see_the_world skill): launches its OWN Chromium against the
 * ALREADY-RUNNING stack on :6969 and NEVER starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same shape as
 * name_index_parity_verify.cjs): (1) params.autoSave = false, (2)
 * window.debounceAutoSave stubbed, (3) EVERY request to the save server
 * (:6970) aborted at the network layer. The pane layout is driven through the
 * pane_tree's own localStorage layout (scene-scoped) and cleared at exit.
 *
 * Usage:  node pixel_map_view_tuning_verify.cjs [--label before|after] [--keep-alive]
 * Screenshots: ~/tmp/pixel_map_views/<label>_<view>.png
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Defaults to the operator's live stack. `--origin http://127.0.0.1:PORT` points
// it at a READ-ONLY STATIC server instead (plain file serving: no save server on
// :6970, no sACN bridges on :6971/:6972), for when his stack is down and a
// capture must not bring one up on the standard ports.
const ORIGIN = (() => {
  const i = process.argv.indexOf('--origin');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'http://127.0.0.1:6969';
})();
// `profile=2d_pixels` because `showPixelMap` refuses to show the map under any
// other lighting profile — the 2D map IS that profile's viewport.
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=2d_pixels&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'pixel_map_views');
const KEEP = process.argv.includes('--keep-alive');
// `--adjust` also captures the per-view adjustment inspector (report 20260725_54).
const ADJUST = process.argv.includes('--adjust');
// `--fit` exercises the pane's fit-to-visible button with chrome left ON.
const FIT = process.argv.includes('--fit');
// `--edit` exercises EDIT-mode move + right-click group selection (report _55).
const EDIT = process.argv.includes('--edit');
const LABEL = (() => {
  const i = process.argv.indexOf('--label');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'after';
})();
const VP = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS = ['front', 'top_down', 'te_sign'];

// ⚠ MIRRORS of constants in `src/gui/pixel_map/pixel_map_view_defaults.js`.
// This harness is CommonJS and that module is ESM, so they cannot be imported
// here — if you re-point a group name there after an operator rename, re-point
// it here too, or this harness reports the wrong verdict while the views are
// fine. (The group names below were last checked against the operator's
// 16:38:58 save on 2026-07-29.)
const SMALL_STACKS = ['Left Small SmokeStack', 'Right Small SmokeStack'];
// Orphaned fixtures (no generator trace backs them; their coordinates duplicate
// a real group's exactly), which must NOT pollute a default view.
// 2026-07-30: 'Left Back Wall' REMOVED from this list. The operator deleted the
// 5 ghost bars and renamed his real generator to that exact name, so the entry
// had started excluding his REAL back wall from every default view — the trap
// report `20260725_51` §4 predicted. 2026-07-30 later: 'Left Center
// Auditorium' gone too — the operator deleted its ghosts (hand + `_76` UI).
const ORPHAN_GROUPS = [];
// A group the operator's fix turned from ghost into real — the harness asserts
// it is now PRESENT on Top-Down, which is the whole point of the change.
const UN_ORPHANED_GROUP = 'Left Back Wall';

// Everything the sim floats over the viewport EXCEPT the Pixel Map itself —
// the operator's own live banners (UNSAVED CHANGES / ENGINE MODEL STALE) and
// the Lighting Controls panel otherwise cover a third of the pane. Hidden for
// the capture only; this browser closes at exit and never touches his session.
const CHROME_IDS = [
  'hud-frame', 'info-panel', 'pattern-editor-panel', 'sacn-in-monitor-panel',
  'sacn-out-monitor-panel', 'view-presets', 'gui-panel', 'unpatched-warning',
  'engine-blackout-warning', 'gpu-adapter-warning', 'multi-client-warning',
  'dirty-indicator',
];

// `--legacy-views` re-injects the PRE-TUNING view definitions as DATA (no code
// is reverted) so the before/after screenshots are framed identically and can
// be compared side by side. Honesty note for the report: the layout module's
// new paint order still applies in this mode — only the view data is old.
//
// ⚠ FROZEN HISTORICAL SNAPSHOT — do NOT re-point these group names after an
// operator rename. They are the literal definitions as they shipped before
// report 20260725_48, which is the whole point. Consequence: on today's scene
// 'Left Top Chimney Generator' below resolves to 0 clusters (he renamed it
// 'Left SmokeStack' at 16:38), so a fresh `--legacy-views` run no longer
// reproduces the original before-shots. The captures taken while it was still
// live are in ~/tmp/pixel_map_views/before_clean_*.png.
const LEGACY = process.argv.includes('--legacy-views');
const LEGACY_VIEWS = [
  {
    id: 'top_down',
    label: 'Top-Down',
    panels: [{
      id: 'main',
      label: 'Bars + Strands + Stacks',
      select: [
        { fixtureType: 'ShehdsBar' }, { kind: 'led' },
        { group: 'Left Top Chimney Generator' }, { group: 'Right SmokeStacks' },
      ],
      exclude: [{ fixtureType: 'TeSignV3A40' }, { fixtureType: 'TeSignV3B34' }],
      projection: 'top', layout: 'spatial',
    }],
    typeStyles: { UkingPar: { sizeX: 13, sizeY: 13 } },
  },
  {
    id: 'front',
    label: 'Front',
    panels: [{
      id: 'main',
      select: [{ fixtureType: 'ShehdsBar' }, { fixtureType: 'VintageLed' }],
      projection: 'front', layout: 'spatial',
    }],
  },
  {
    id: 'te_sign',
    label: 'TE Sign',
    panels: [{
      id: 'main',
      select: [{ fixtureType: 'TeSignV3A40' }, { fixtureType: 'TeSignV3B34' }],
      layout: 'planar',
    }],
  },
];

async function hideChrome(page) {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = 'none'; });
    const map = document.getElementById('pixel-map-panel');
    if (map) { map.style.display = ''; map.style.inset = '0'; }
  }, CHROME_IDS);
}

async function shot(page, name) {
  const p = path.join(OUT, `${LABEL}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

/**
 * GUARD 4 — NO sACN OUTPUT, EVER.
 *
 * `animate.js` lazily enables the sACN output client on every non-readonly sim
 * client (`if (window.dmxRouter && params.parLights && !window.__readonlyMode)`),
 * which would put a second transmitter on the wire while the operator is
 * live-mapping real hardware. `?readonly=1` would stop that, but it also skips
 * `initPixelMapPanel()` — the very panel this harness captures.
 *
 * So `__readonlyMode` is installed as an ACCESSOR before any page script runs:
 * the getter always returns true (animate.js never enables output), and the
 * setter swallows `main.js`'s `window.__readonlyMode = false`. A no-op setter,
 * not a frozen value — a plain non-writable property would make that assignment
 * THROW in main.js's strict-mode module and break the boot. `main.js` reads the
 * URL param directly for the panel wiring, so the Pixel Map still mounts.
 */
async function installOutputGuard(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, '__readonlyMode', {
      get: () => true,
      set: () => {},
      configurable: true,
    });
  });
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

async function bindPaneToView(page, viewId) {
  await page.evaluate(async (origin, id) => {
    const tree = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_tree.js`);
    const scene = window.__activeScene || 'default';
    tree.clearLayout(scene);
    tree.saveLayout(scene, tree.createState(id));
    window.showPixelMap2d(false);
  }, ORIGIN, viewId);
  await sleep(500);
  await page.evaluate(() => { window.showPixelMap2d(true); });
  await sleep(2500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  const sacnOutLines = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    // Proof for GUARD 4: the output client logs this the instant it enables.
    if (/\[sACN Out\]\s+Enabling/i.test(t)) sacnOutLines.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', async (d) => { await d.accept(); });

  await installOutputGuard(page);

  // GUARD 3: abort every save-server request so nothing can write the scene.
  await page.setRequestInterception(true);
  let abortedSaves = 0;
  page.on('request', (req) => {
    if (/:6970(\/|$)/.test(req.url())) { abortedSaves += 1; req.abort(); return; }
    req.continue();
  });

  console.log(`Loading ${SIM}  (label=${LABEL})`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) {
      const s = getComputedStyle(o);
      if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false;
    }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0
      && typeof window.showPixelMap2d === 'function';
  }, { timeout: 90000 });
  await sleep(3000);

  // GUARDS 1+2.
  const gpu = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    state.params.autoSave = false;
    window.debounceAutoSave = () => {};
    return window.__gpuAdapter || null;
  }, ORIGIN);
  console.log(`[gpu] ${JSON.stringify(gpu)}`);

  // Open the map once so the data plane fills `store.list`.
  await page.evaluate(() => { window.showPixelMap2d(true); });
  await page.waitForFunction(async () => {
    const store = await import('/simulation/src/gui/pixel_map/pixel_map_store.js');
    return !!store.store.list && store.store.list.length > 0;
  }, { timeout: 60000 });
  await sleep(1500);

  if (LEGACY) {
    // Overwrite the three tuned views in the LIVE store with their pre-tuning
    // definitions. Nothing is persisted: autoSave is off, debounceAutoSave is a
    // no-op, and every :6970 request is aborted.
    const swapped = await page.evaluate(async (origin, legacy) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const done = [];
      for (const lv of legacy) {
        const live = store.store.views.views.find((v) => v.id === lv.id);
        if (!live) throw new Error(`legacy swap: no live view '${lv.id}'`);
        live.panels = JSON.parse(JSON.stringify(lv.panels));
        live.typeStyles = JSON.parse(JSON.stringify(lv.typeStyles || {}));
        live.placements = {};
        done.push(lv.id);
      }
      store.commitViews();
      return done;
    }, ORIGIN, LEGACY_VIEWS);
    console.log(`[legacy] restored pre-tuning definitions for: ${swapped.join(', ')}`);
    await sleep(1500);
  }

  // ── The operator adjustment surface (report 20260725_54) ─────────────────
  // Opens the Views manager, expands Top-Down's Adjust panel, and captures it.
  // Read-only: it clicks the toggle (pure UI state), never a control that
  // writes, so nothing is committed and the guards stay untested-but-intact.
  if (ADJUST) {
    await bindPaneToView(page, 'top_down');
    const opened = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      store.store.managerOpen.value = true;
      return true;
    }, ORIGIN);
    await sleep(900);
    // The Adjust toggle of the first row (top_down).
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('.pm-adj-toggle');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(900);
    const shape = await page.evaluate(() => {
      const adj = document.querySelector('.pm-adj');
      if (!adj) return null;
      return {
        rows: [...adj.querySelectorAll('.pm-adj-label')].map((l) => l.textContent.trim()),
        panels: [...adj.querySelectorAll('.pm-adj-panel-head code')].map((c) => c.textContent.trim()),
        hasReset: !!adj.querySelector('.pm-adj-foot .pm-del'),
        numbers: [...adj.querySelectorAll('.pm-adj-num')].map((i) => i.value),
      };
    });
    console.log(`
[ADJUST UI] manager opened: ${opened}, Adjust clicked: ${clicked}`);
    console.log(`[ADJUST UI] ${JSON.stringify(shape)}`);
    await shot(page, 'adjust_ui');
    await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      store.store.managerOpen.value = false;
    }, ORIGIN);
    await sleep(400);
  }

  // ── Fit to the visible area, with the Lighting Controls panel DOCKED ─────
  // Operator order 2026-07-30: "fit to the area not under any menu, active".
  // Chrome is deliberately LEFT VISIBLE here — the whole point is that the
  // Lighting Controls panel really does overlap the pane and the fit must
  // dodge it. Clicking the pane's ⤢ button writes the view's framing through
  // the same validated path a pan does; nothing else is touched.
  if (FIT) {
    await bindPaneToView(page, 'top_down');
    const before = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      return store.getViewFraming('top_down');
    }, ORIGIN);
    const measured = await page.evaluate(() => {
      const canvas = document.querySelector('.pmv-canvas');
      if (!canvas) return null;
      const pr = canvas.getBoundingClientRect();
      const btn = [...document.querySelectorAll('.pmv-btn')].find((b) => b.textContent.trim() === '⤢');
      if (!btn) return { error: 'no fit button in the pane header' };
      btn.click();
      return { pane: { w: Math.round(pr.width), h: Math.round(pr.height) } };
    });
    await sleep(1200);
    const after = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      return store.getViewFraming('top_down');
    }, ORIGIN);
    console.log(`
[FIT] pane ${JSON.stringify(measured)}`);
    console.log(`[FIT] framing before: ${JSON.stringify(before)}`);
    console.log(`[FIT] framing after : ${JSON.stringify(after)}  (persisted = ${!!after})`);
    await shot(page, 'fit_to_visible');
    // Put his framing back exactly as it was — this harness never leaves state.
    await page.evaluate(async (origin, prev) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      if (prev) store.setViewFraming('top_down', prev); else store.clearViewFraming('top_down');
    }, ORIGIN, before);
    await sleep(300);
  }

  // ── EDIT mode: move + right-click group selection (report 20260725_55) ───
  if (EDIT) {
    await bindPaneToView(page, 'top_down');
    await hideChrome(page);
    await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      store.store.mode.value = 'edit';
    }, ORIGIN);
    await sleep(900);

    // Right-click a pixel → its whole GROUP selects.
    const grp = await page.evaluate(() => {
      const canvas = document.querySelector('.pmv-canvas');
      const r = canvas.getBoundingClientRect();
      // Find a lit-or-not pixel by probing the pane's own geometry.
      const pane = window.__pmPane;
      return { w: Math.round(r.width), h: Math.round(r.height), hasPane: !!pane };
    });
    // Drive through the REAL handlers: synthesise pointer events on the canvas
    // at a pixel's own screen position, taken from the pane's expanded geometry.
    const result = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const canvas = document.querySelector('.pmv-canvas');
      const rect = canvas.getBoundingClientRect();
      // Reach the pane instance the shell created, via its painter registry.
      const view = store.store.views.views.find((v) => v.id === 'top_down');
      const before = view.offsets ? JSON.parse(JSON.stringify(view.offsets)) : null;

      // Screen position of a known fixture's first pixel: recompute the panel
      // the same way the pane does, then map design → client px.
      const layout = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`);
      const views = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`);
      const paneView = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_view.js`);
      const r = views.resolveView(view, store.store.clusters, store.store.list,
        { viewRegistry: store.store.viewRegistry });
      const panel = r.panels[0];
      const px = layout.expandPanel(panel.def, panel.clusters, store.store.list,
        layout.seedPanel(panel.def, panel.clusters, store.store.list, 900, 520, panel.styles),
        panel.styles, view.offsets);
      const target = px.find((q) => q.fixKey === 'Left Front Wall 1') || px[0];
      const sub = paneView.panelSubRects([{ id: panel.def.id }], rect.width, rect.height, 0)[0];
      const xf = paneView.panelTransform({ w: 900, h: 520 }, sub, 1, { x: 0, y: 0 });
      return {
        before,
        fixKey: target.fixKey,
        client: { x: rect.left + target.cx * xf.scale + xf.ox, y: rect.top + target.cy * xf.scale + xf.oy },
      };
    }, ORIGIN);

    const fire = async (type, x, y, button, shift) => {
      await page.evaluate((t, cx, cy, b, sh) => {
        const canvas = document.querySelector('.pmv-canvas');
        canvas.dispatchEvent(new PointerEvent(t, {
          clientX: cx, clientY: cy, button: b, buttons: b === 2 ? 2 : 1,
          shiftKey: !!sh, bubbles: true, cancelable: true,
        }));
      }, type, x, y, button, shift);
    };

    // 1) RIGHT-click → group selection.
    await fire('pointerdown', result.client.x, result.client.y, 2, false);
    await sleep(600);
    const afterRight = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const sel = [...(store.store.selection.value || [])];
      return { count: sel.length, sample: sel.slice(0, 6) };
    }, ORIGIN);
    await shot(page, 'edit_right_click_group');

    // 2) DRAG the selection 90 px right / 40 px down.
    await fire('pointerdown', result.client.x, result.client.y, 0, false);
    await fire('pointermove', result.client.x + 45, result.client.y + 20, 0, false);
    await fire('pointermove', result.client.x + 90, result.client.y + 40, 0, false);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    await sleep(900);
    await shot(page, 'edit_after_move');

    const afterMove = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const v = store.store.views.views.find((x) => x.id === 'top_down');
      return { offsets: v.offsets ? JSON.parse(JSON.stringify(v.offsets)) : null,
        moved: store.movedCount('top_down') };
    }, ORIGIN);

    // 3) PERSISTENCE across a rebind: bind the pane away and back, then read
    //    the rendered geometry to prove the move survived (framing-style).
    await bindPaneToView(page, 'front');
    await sleep(500);
    await bindPaneToView(page, 'top_down');
    await sleep(800);
    const afterRebind = await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      const v = store.store.views.views.find((x) => x.id === 'top_down');
      return v.offsets ? JSON.parse(JSON.stringify(v.offsets)) : null;
    }, ORIGIN);

    console.log(`
[EDIT] target fixture: ${result.fixKey}`);
    console.log(`[EDIT] right-click selected ${afterRight.count} fixture(s): ${afterRight.sample.join(', ')}`);
    console.log(`[EDIT] offsets before: ${JSON.stringify(result.before)}`);
    console.log(`[EDIT] offsets after move: ${JSON.stringify(afterMove.offsets)} (movedCount ${afterMove.moved})`);
    console.log(`[EDIT] offsets after rebind: ${JSON.stringify(afterRebind)}`);
    console.log(`[EDIT] survived rebind: ${JSON.stringify(afterMove.offsets) === JSON.stringify(afterRebind)}`);

    // Restore: drop the probe's moves and go back to VIEW mode.
    await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      try { store.clearViewOffsets('top_down'); } catch (e) { /* nothing to clear */ }
      store.store.selection.value = new Set();
      store.store.mode.value = 'view';
    }, ORIGIN);
    await sleep(400);
  }

  // ── Screenshots, one pane per view ───────────────────────────────────────
  for (const v of VIEWS) {
    await bindPaneToView(page, v);
    await hideChrome(page);
    await sleep(600);
    await shot(page, v);
  }

  if (LEGACY) {
    // Put the shipped defaults back and leave: the facts dump below always
    // describes the SHIPPED views, so running it here would mislabel them.
    await page.evaluate(async (origin) => {
      const store = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`);
      store.loadViewsFromParams();
      const tree = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_tree.js`);
      tree.clearLayout(window.__activeScene || 'default');
      window.showPixelMap2d(false);
    }, ORIGIN);
    console.log(`\n(legacy-views run — no facts dump; save-server requests aborted: ${abortedSaves})`);
    console.log(`Screenshots: ${OUT}`);
    if (!KEEP) await browser.close();
    process.exit(0);
  }

  // ── Structural assertions against the REAL resolved default views ────────
  const facts = await page.evaluate(async (origin, smallStacks, orphanGroups, unOrphaned) => {
    const [defaults, layout, views, store] = await Promise.all([
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_view_defaults.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_layout.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_views.js`),
      import(`${origin}/simulation/src/gui/pixel_map/pixel_map_store.js`),
    ]);
    const list = store.store.list;
    const clusters = store.store.clusters || layout.buildClusters(list);
    const out = { sceneGroups: [...new Set(clusters.map((c) => c.group))].sort(), views: {} };
    for (const v of defaults.DEFAULT_VIEWS) {
      const r = views.resolveView(v, clusters, list, { viewRegistry: store.store.viewRegistry });
      out.views[v.id] = r.panels.map((p) => {
        if (p.error) return { panel: p.def.id, error: p.error };
        const placements = layout.seedPanel(p.def, p.clusters, list, 900, 520, p.styles);
        const px = layout.expandPanel(p.def, p.clusters, list, placements, p.styles);
        let bb = [Infinity, -Infinity, Infinity, -Infinity];
        for (const q of px) {
          bb[0] = Math.min(bb[0], q.cx); bb[1] = Math.max(bb[1], q.cx);
          bb[2] = Math.min(bb[2], q.cy); bb[3] = Math.max(bb[3], q.cy);
        }
        // Closest neighbouring PAR (each UkingPar cluster is a single pixel),
        // in design units — the operator's "make the par LEDs show
        // individually and not overlap much" is exactly this number vs the
        // par disc diameter.
        const pars = px.filter((q) => {
          const c = p.clusters.find((cc) => cc.fixKey === q.fixKey);
          return c && c.fixtureType === 'UkingPar';
        });
        let parMin = Infinity;
        for (let i = 0; i < pars.length; i++) {
          for (let j = i + 1; j < pars.length; j++) {
            parMin = Math.min(parMin, Math.hypot(pars[i].cx - pars[j].cx, pars[i].cy - pars[j].cy));
          }
        }
        // Closest par↔non-par pair — "room for the par lights in the middle
        // of the LED strands" is this clearance.
        const others = px.filter((q) => !pars.includes(q));
        let mixMin = Infinity;
        for (const a of pars) {
          for (const b of others) {
            mixMin = Math.min(mixMin, Math.hypot(a.cx - b.cx, a.cy - b.cy));
          }
        }
        const parStyle = layout.styleFor('UkingPar', p.styles);
        return {
          panel: p.def.id,
          label: p.def.label || p.def.id,
          layout: p.def.layout,
          rotate: p.def.rotate || 0,
          clusters: p.clusters.length,
          pixels: px.length,
          groups: [...new Set(p.clusters.map((c) => c.group))].sort(),
          bbox: bb.map((n) => Math.round(n * 10) / 10),
          fillFracX: Math.round(((bb[1] - bb[0]) / 900) * 1000) / 1000,
          fillFracY: Math.round(((bb[3] - bb[2]) / 520) * 1000) / 1000,
          parDiameter: parStyle.sizeX,
          parMinSpacing: Number.isFinite(parMin) ? Math.round(parMin * 10) / 10 : null,
          parToOtherMin: Number.isFinite(mixMin) ? Math.round(mixMin * 10) / 10 : null,
          orphansPresent: p.clusters.some((c) => orphanGroups.includes(c.group)),
          smallStacksPresent: smallStacks.filter((g) => p.clusters.some((c) => c.group === g)),
          // The de-orphaned group must now be DRAWN, not excluded (2026-07-30).
          unOrphanedClusters: p.clusters.filter((c) => c.group === unOrphaned).length,
        };
      });
    }
    // TE sign: each sign's own aspect + extreme-point bearing, PER PANEL, so a
    // 90° CCW rotation is provable and not eyeballed. Measured per panel because
    // the view now carries one panel per sign — averaging two signs 34 world
    // units apart would report a meaningless centroid.
    const teView = defaults.DEFAULT_VIEWS.find((v) => v.id === 'te_sign');
    const teResolved = views.resolveView(teView, clusters, list, { viewRegistry: store.store.viewRegistry });
    out.teSign = teResolved.panels.map((tp, i) => {
      if (tp.error) return { panel: tp.def.id, error: tp.error };
      const tpx = layout.expandPanel(tp.def, tp.clusters, list,
        layout.seedPanel(tp.def, tp.clusters, list, 900, 520, tp.styles), tp.styles);
      const cx = tpx.reduce((a, q) => a + q.cx, 0) / tpx.length;
      const cy = tpx.reduce((a, q) => a + q.cy, 0) / tpx.length;
      let far = tpx[0], farD = -1;
      for (const q of tpx) {
        const d = Math.hypot(q.cx - cx, q.cy - cy);
        if (d > farD) { farD = d; far = q; }
      }
      const bb = out.views.te_sign[i].bbox;
      return {
        panel: tp.def.id,
        groups: [...new Set(tp.clusters.map((c) => c.group))],
        clusters: tp.clusters.length,
        // screen bearing of the shape's extreme point, degrees CCW from +X with
        // screen-Y DOWN converted to maths-Y up (0 = right, 90 = up, 180 = left).
        extremeBearingDeg: Math.round(Math.atan2(-(far.cy - cy), far.cx - cx) * 180 / Math.PI),
        widthOverHeight: Math.round(((bb[1] - bb[0]) / (bb[3] - bb[2])) * 100) / 100,
      };
    });
    return out;
  }, ORIGIN, SMALL_STACKS, ORPHAN_GROUPS, UN_ORPHANED_GROUP);

  fs.writeFileSync(path.join(OUT, `${LABEL}_facts.json`), JSON.stringify(facts, null, 2));
  console.log('\n=== resolved default views ===');
  for (const [id, panels] of Object.entries(facts.views)) {
    for (const p of panels) {
      if (p.error) { console.log(`  ${id}/${p.panel}: ERROR ${p.error}`); continue; }
      console.log(`  ${id}/${p.panel} '${p.label}' [${p.layout}${p.rotate ? ` rot${p.rotate}` : ''}] ` +
        `${p.clusters} clusters / ${p.pixels}px  fill=${p.fillFracX}×${p.fillFracY}  ` +
        `parØ=${p.parDiameter} parGap=${p.parMinSpacing} par↔other=${p.parToOtherMin} ` +
        `orphans=${p.orphansPresent} smallStacks=[${p.smallStacksPresent.join(', ')}] ` +
        `'${UN_ORPHANED_GROUP}'=${p.unOrphanedClusters}`);
      console.log(`      groups: ${p.groups.join(', ')}`);
    }
  }
  console.log(`\n=== TE sign === ${JSON.stringify(facts.teSign)}`);
  const td = facts.views.top_down[0];
  const unOrphanOk = !!td && td.unOrphanedClusters > 0 && !td.orphansPresent;
  console.log(`\n[ORPHAN FIX] Top-Down draws '${UN_ORPHANED_GROUP}': ` +
    `${td ? td.unOrphanedClusters : 0} clusters; remaining ghosts excluded: ` +
    `${!!td && !td.orphansPresent}  => ${unOrphanOk ? 'PASS ✅' : 'FAIL ❌'}`);

  // ── Restore: drop the harness pane layout, hide the map. ─────────────────
  await page.evaluate(async (origin) => {
    const tree = await import(`${origin}/simulation/src/gui/pixel_map/pixel_map_pane_tree.js`);
    tree.clearLayout(window.__activeScene || 'default');
    window.showPixelMap2d(false);
  }, ORIGIN);

  const noise = errors.filter((e) => /pixel_map|PixelMap|TypeError|is not a function/i.test(e));
  const outputGuardHeld = await page.evaluate(() => window.__readonlyMode === true);
  console.log(`\n[GUARD 4] sACN output suppressed: ${outputGuardHeld && sacnOutLines.length === 0 ? 'YES ✅' : 'NO ❌'}` +
    ` (__readonlyMode=${outputGuardHeld}, '[sACN Out] Enabling' lines: ${sacnOutLines.length})`);
  console.log(`(save-server requests aborted this run: ${abortedSaves})`);
  if (noise.length) { console.log('console errors:'); noise.slice(0, 15).forEach((e) => console.log('  •', e.slice(0, 220))); }
  console.log(`Screenshots + facts: ${OUT}`);
  if (!KEEP) await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
