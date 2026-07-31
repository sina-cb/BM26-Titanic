/**
 * generator_ux_verify.cjs — live BEFORE/AFTER proof for the generator editor
 * SELECT FREEZE + COLD MOVE fixes (plan 20260725_44 §4 slice 1, steps 1-7).
 *
 * Renderer-only (see_the_world skill): launches its OWN Chromium against the
 * ALREADY-RUNNING stack on :6969 and NEVER starts or stops a server. Ports
 * 6966-6972 / 5568 are untouched — this is a browser client, nothing else.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same as trace_rename_verify):
 *   (1) params.autoSave = false   → debounceAutoSave no-ops (gui_builder.js:539)
 *   (2) window.debounceAutoSave stubbed with a counter (belt)
 *   (3) EVERY request to the save server (:6970) aborted at the network layer
 * params.{parLights,traces,ledStrands} are deep-cloned at start and restored at
 * exit; the browser is closed. scenes/** is never written — the harness also
 * fingerprints nothing on disk because it cannot reach the save server at all.
 *
 * WHAT IT MEASURES (the plan's acceptance numbers; "before" from report §1 was
 * 2,719 ms select stall + ~2.4 s frame stall per drag tick + 0.4 FPS paced):
 *   A  SELECT via a REAL synthetic mouse click on a generator hitbox
 *      → max rAF gap must be < 150 ms, with ZERO batch invalidations and ZERO
 *        fixture rebuilds (the attach used to run a whole regenerate).
 *   B  SELECT via the GUI card (control — never had the attach path).
 *   C  DRAG ticks with transformControl.dragging TRUE (the real handler, rAF
 *      paced) → zero regenerates while the pointer is down.
 *   D  RELEASE (dragging → false, the real main.js seam) → EXACTLY one
 *      regenerate and one 'fixtures rebuilt' invalidation.
 *   E  PACED DRAG for 2 s → achieved FPS vs idle FPS on the same adapter.
 *   F  TRAIL REGRESSION (mandatory, report 20260725_2): after release the
 *      cached batch render list must equal a FRESH generatePixelMap() — for
 *      the dragged generator AND for a dragged LED strand handle. Stale
 *      coordinates after a drag are the move-trail bug and can never return.
 *
 * Every timing is reported next to window.__gpuAdapter; an integrated or
 * undetectable adapter INVALIDATES the run (ops rule, report 20260725_39).
 *
 * Usage:  node generator_ux_verify.cjs [--keep-alive]
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const puppeteer = require(path.join(__dirname, '..', 'node_modules', 'puppeteer'));

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'generator_ux');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const SELECT_GAP_BUDGET_MS = 150;   // plan step 7 acceptance
const PACED_FPS_TOLERANCE = 0.8;    // "within ~20 % of idle FPS"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same panel list agent_render.cjs hides — used only for the two cold-move
// comparison frames, so the operator sees the 3D divergence, not the GUI.
const UI_PANEL_IDS = ['hud-frame', 'info-panel', 'pattern-editor-panel',
  'sacn-in-monitor-panel', 'sacn-out-monitor-panel', 'view-presets', 'gui-panel',
  'unpatched-warning', 'pixel-map-panel'];

function setUiVisible(page, visible) {
  return page.evaluate((ids, show) => {
    const value = show ? '' : 'none';
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = value;
    }
    document.querySelectorAll('.marsin-gui').forEach((el) => { el.style.display = value; });
  }, UI_PANEL_IDS, visible);
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${p}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false,
    defaultViewport: VP,
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2',
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
      && Array.isArray(window.traceObjects) && window.traceObjects.length > 0
      && Array.isArray(window.traceGuiFolders) && window.traceGuiFolders.length > 0
      && typeof window._flushPendingEditorRegens === 'function';
  }, { timeout: 120000 });
  await sleep(4000); // let shadows / bloom / first batch build settle
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  const httpFailures = [];
  const dialogs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // A missing static asset is a SERVER-side fact about the operator's scene, not
  // a JS regression from this change. Record it separately WITH its URL so it is
  // reported honestly instead of hiding inside a generic console-error count.
  page.on('response', (res) => {
    if (res.status() >= 400) httpFailures.push(`${res.status()} ${res.url()}`);
  });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  // GUARD 3 — abort every save-server request at the network layer.
  let savePortAttempts = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes(':6970')) { savePortAttempts += 1; return req.abort(); }
    return req.continue();
  });

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitReady(page);

  // GUARDS 1+2, pristine clone, instrumentation.
  const setup = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    const exporter = await import(`${origin}/simulation/src/dmx/pixelblaze_model_exporter.js`);
    const animate = await import(`${origin}/simulation/src/core/animate.js`);
    window.__st = state;
    window.__generatePixelMap = exporter.generatePixelMap;
    const p = state.params;
    p.autoSave = false;                                   // guard (1)
    window.__saveCalls = 0;
    window.__origAutoSave = window.debounceAutoSave;
    window.debounceAutoSave = () => { window.__saveCalls += 1; };  // guard (2)
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    window.__pristine = {
      parLights: clone(p.parLights),
      traces: clone(p.traces),
      ledStrands: clone(p.ledStrands),
    };

    // Live handle on the cached batch render list (what the GPU/2D map/engine
    // actually read) — this is the surface the move-trail bug corrupts.
    window.__batchList = null;
    window.__batchVersion = -1;
    animate.onPixelFrame((list, version) => {
      window.__batchList = list;
      window.__batchVersion = version;
    });

    // Invalidation recorder (reason strings) — 'fixtures rebuilt' == one
    // rebuildParLights == one generator regenerate.
    window.__invalidations = [];
    const inv = window.invalidateMarsinBatchCache;
    window.invalidateMarsinBatchCache = function (reason) {
      window.__invalidations.push(reason);
      return inv.apply(this, arguments);
    };

    // Release-seam recorder: what the flush actually did, per release.
    window.__flushes = [];
    const flush = window._flushPendingEditorRegens;
    window._flushPendingEditorRegens = function () {
      const r = flush.apply(this, arguments);
      window.__flushes.push(r);
      return r;
    };

    // rAF gap monitor (a gap > 50 ms is a visible stall).
    window.__gaps = [];
    let last = performance.now();
    const tick = (now) => {
      const gap = now - last;
      if (gap > 50) window.__gaps.push(Math.round(gap));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return {
      adapter: window.__gpuAdapter || null,
      parLights: p.parLights.length,
      strands: (p.ledStrands || []).length,
      interactive: state.interactiveObjects.length,
      traces: p.traces.map((t, i) => ({
        i, name: t.name, group: t.groupName, shape: t.shape,
        count: t.count, generated: !!t.generated,
      })),
    };
  }, ORIGIN);

  const adapter = setup.adapter || {};
  const adapterValid = !!adapter.renderer && adapter.integrated === false && !adapter.detectionFailed;
  console.log(`\nADAPTER: ${adapter.renderer || 'UNKNOWN'} (integrated=${adapter.integrated}, detectionFailed=${adapter.detectionFailed})`);
  console.log(`SCENE: ${setup.parLights} parLights, ${setup.strands} strands, ${setup.interactive} interactive, ${setup.traces.length} traces`);
  if (!adapterValid) console.error('❌ ADAPTER INVALIDATES EVERY TIMING BELOW (ops: sim_auto_checks GPU Adapter Check)');

  const generated = setup.traces.filter((t) => t.generated);
  if (!generated.length) throw new Error('no generated traces on titanic — nothing to verify');
  const circles = generated.filter((t) => t.shape === 'circle');
  const target = (circles.length ? circles : generated).sort((a, b) => (b.count || 0) - (a.count || 0))[0];
  const lineTarget = generated.filter((t) => t.shape !== 'circle')
    .sort((a, b) => (b.count || 0) - (a.count || 0))[0] || null;
  console.log(`TARGET generator: #${target.i} "${target.group || target.name}" (${target.shape}, ${target.count} lights)`);
  console.log(`LINE generator:   ${lineTarget ? `#${lineTarget.i} "${lineTarget.group || lineTarget.name}" (${lineTarget.shape}, ${lineTarget.count} lights)` : 'none'}\n`);

  const readMetrics = () => page.evaluate(() => ({
    gaps: window.__gaps.splice(0),
    invalidations: window.__invalidations.splice(0),
    flushes: window.__flushes.splice(0),
    saveCalls: window.__saveCalls,
  }));

  const results = {};

  // ── A: SELECT via a REAL synthetic mouse click on the generator hitbox ──
  {
    await page.evaluate((idx) => {
      const t = window.__st.params.traces[idx];
      if (window.flyToTrace) window.flyToTrace(idx, t);
    }, target.i);
    await sleep(1800);
    const pt = await page.evaluate((idx) => {
      const st = window.__st;
      const hb = window.traceObjects[idx].hitbox;
      const v = hb.position.clone().project(st.camera);
      const rect = st.renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (v.x + 1) / 2 * rect.width,
        y: rect.top + (1 - (v.y + 1) / 2) * rect.height,
        behind: v.z > 1,
      };
    }, target.i);
    await readMetrics();
    await page.mouse.click(pt.x, pt.y);
    await sleep(2500);
    const m = await readMetrics();
    const landed = await page.evaluate((idx) => ({
      attached: window.__st.transformControl.object === window.traceObjects[idx].hitbox,
      cardSelected: !!(window.traceGuiFolders[idx]
        && window.traceGuiFolders[idx].domElement.classList.contains('gui-card-selected')),
    }), target.i);
    const maxGap = m.gaps.length ? Math.max(...m.gaps) : 0;
    const rebuilds = m.invalidations.filter((r) => r === 'fixtures rebuilt').length;
    results.select3d = {
      landed, maxGapMs: maxGap, gaps: m.gaps,
      invalidations: m.invalidations, fixtureRebuilds: rebuilds,
    };
    console.log(`[A] SELECT (real 3D click): attached=${landed.attached} card=${landed.cardSelected}`);
    console.log(`    max rAF gap ${maxGap} ms (budget ${SELECT_GAP_BUDGET_MS}) | gaps ${JSON.stringify(m.gaps)}`);
    console.log(`    invalidations ${JSON.stringify(m.invalidations)} | regenerates ${rebuilds}`);
    await shot(page, '01_select_attached');
  }

  // ── B: SELECT via the GUI card (control path — never attached) ──
  {
    await page.keyboard.press('Escape');
    await sleep(500);
    const box = await page.evaluate((idx) => {
      const el = window.traceGuiFolders[idx].domElement.querySelector('.title');
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, target.i);
    await sleep(400);
    await readMetrics();
    await page.mouse.click(box.x, box.y);
    await sleep(2000);
    const m = await readMetrics();
    results.selectCard = {
      maxGapMs: m.gaps.length ? Math.max(...m.gaps) : 0,
      invalidations: m.invalidations,
    };
    console.log(`[B] SELECT (GUI card): max gap ${results.selectCard.maxGapMs} ms | invalidations ${JSON.stringify(m.invalidations)}`);
  }

  // ── C+D: DRAG ticks with the REAL dragging flag, then the REAL release ──
  {
    await readMetrics();
    // Snapshot of "where is the generator vs where are its fixtures", the
    // divergence the operator ratified (plan §5.1): mid-drag the ring moves,
    // the fixtures do not; on release they catch up in one step.
    const census = (idx) => page.evaluate((i) => {
      const p = window.__st.params;
      const t = p.traces[i];
      const g = t.groupName || t.name;
      const members = p.parLights.filter((l) => l.traceGenerated && l.group === g);
      const meanX = members.length ? members.reduce((s, l) => s + (l.x || 0), 0) / members.length : NaN;
      return {
        traceX: Math.round((t.x || 0) * 1000) / 1000,
        fixtureMeanX: Math.round(meanX * 1000) / 1000,
        members: members.length,
      };
    }, idx);
    const beforeDrag = await census(target.i);
    const drag = await page.evaluate(async (idx) => {
      const tc = window.__st.transformControl;
      const hb = window.traceObjects[idx].hitbox;
      tc.attach(hb);
      tc.dragging = true;                      // fires dragging-changed(true) → pushUndo
      const times = [];
      for (let k = 0; k < 10; k++) {
        hb.position.x += 0.6;                  // a visible, deliberate move
        const t0 = performance.now();
        window._onTraceTransformChange(hb);
        times.push(Math.round((performance.now() - t0) * 10) / 10);
        await new Promise((r) => requestAnimationFrame(r));
      }
      const sorted = [...times].sort((a, b) => a - b);
      return { times, median: sorted[5], max: sorted[9], movedBy: 6.0 };
    }, target.i);
    await sleep(300);
    const during = await readMetrics();
    const midDrag = await census(target.i);
    await setUiVisible(page, false);
    await sleep(400);
    await shot(page, '02_middrag_fixtures_frozen');
    await setUiVisible(page, true);

    const release = await page.evaluate(async () => {
      window.__st.transformControl.dragging = false;   // the REAL main.js release seam
      for (let f = 0; f < 4; f++) await new Promise((r) => requestAnimationFrame(r));
      return true;
    });
    const afterRelease = await census(target.i);
    await sleep(800);
    const after = await readMetrics();
    const dragGapMax = during.gaps.length ? Math.max(...during.gaps) : 0;
    results.dragTicks = {
      tickJsMs: drag.times, medianMs: drag.median, maxMs: drag.max,
      maxGapDuringDragMs: dragGapMax,
      invalidationsDuringDrag: during.invalidations,
      regeneratesDuringDrag: during.invalidations.filter((r) => r === 'fixtures rebuilt').length,
      divergence: { beforeDrag, midDrag, afterRelease },
      release: {
        flushes: after.flushes,
        invalidations: after.invalidations,
        fixtureRebuilds: after.invalidations.filter((r) => r === 'fixtures rebuilt').length,
        maxGapMs: after.gaps.length ? Math.max(...after.gaps) : 0,
      },
      released: release,
    };
    console.log(`[C] DRAG 10 ticks (dragging=true): tick JS median ${drag.median} ms (max ${drag.max})`);
    console.log(`    max rAF gap during drag ${dragGapMax} ms | regenerates during drag ${results.dragTicks.regeneratesDuringDrag} (must be 0)`);
    console.log('    divergence (EXPECTED, operator-ratified §5.1) traceX / fixtureMeanX:');
    console.log(`      before  ${beforeDrag.traceX} / ${beforeDrag.fixtureMeanX} (${beforeDrag.members} fixtures)`);
    console.log(`      mid-drag ${midDrag.traceX} / ${midDrag.fixtureMeanX}  ← generator moved, fixtures frozen`);
    console.log(`      released ${afterRelease.traceX} / ${afterRelease.fixtureMeanX}  ← caught up in ONE regenerate`);
    console.log(`[D] RELEASE: flushes ${JSON.stringify(after.flushes)} | invalidations ${JSON.stringify(after.invalidations)}`);
    await setUiVisible(page, false);
    await sleep(400);
    await shot(page, '03_after_release_fixtures_caught_up');
    await setUiVisible(page, true);
  }

  // ── F1: TRAIL REGRESSION for the generator (cached list == fresh map) ──
  {
    const trail = await page.evaluate(() => {
      const fresh = window.__generatePixelMap().pixels;
      const cached = window.__batchList || [];
      const mismatches = [];
      for (let i = 0; i < Math.min(fresh.length, cached.length); i++) {
        const f = fresh[i];
        const c = cached[i];
        if (Math.abs(f.x - c.wx) > 1e-6 || Math.abs(f.y - c.wy) > 1e-6 || Math.abs(f.z - c.wz) > 1e-6) {
          mismatches.push({ i, name: f.name, fresh: [f.x, f.y, f.z], cached: [c.wx, c.wy, c.wz] });
        }
      }
      return { freshCount: fresh.length, cachedCount: cached.length, mismatches: mismatches.slice(0, 8), total: mismatches.length };
    });
    results.trailGenerator = trail;
    console.log(`[F1] TRAIL (generator): ${trail.cachedCount} cached / ${trail.freshCount} fresh pixels, ${trail.total} stale coordinates (must be 0)`);
    if (trail.total) console.log('     ', JSON.stringify(trail.mismatches, null, 1));
  }

  // ── C3: LINE start-handle drag — the OTHER tick shape report §1 measured ──
  // This branch legitimately rebuilds the polyline + preview dots every tick;
  // §1 clocked it at 23.7 ms median JS with ~2.4-3.2 s frame stalls behind it.
  if (lineTarget) {
    await readMetrics();
    const lineDrag = await page.evaluate(async (idx) => {
      const tc = window.__st.transformControl;
      const tObj = window.traceObjects[idx];
      const h = (tObj.handles || []).find((x) => x.userData.handleType === 'start');
      if (!h) return { skipped: 'no start handle' };
      tc.attach(h);
      tc.dragging = true;
      const times = [];
      for (let k = 0; k < 10; k++) {
        h.position.x += 0.2;
        const t0 = performance.now();
        window._onTraceTransformChange(h);
        times.push(Math.round((performance.now() - t0) * 10) / 10);
        await new Promise((r) => requestAnimationFrame(r));
      }
      h.position.x -= 2.0;
      window._onTraceTransformChange(h);
      const sorted = [...times].sort((a, b) => a - b);
      return { times, median: sorted[5], max: sorted[9] };
    }, lineTarget.i);
    const duringLine = await readMetrics();
    await page.evaluate(async () => {
      window.__st.transformControl.dragging = false;
      for (let f = 0; f < 4; f++) await new Promise((r) => requestAnimationFrame(r));
    });
    await sleep(500);
    const afterLine = await readMetrics();
    results.lineHandleDrag = {
      trace: lineTarget.group || lineTarget.name,
      ...lineDrag,
      maxGapDuringDragMs: duringLine.gaps.length ? Math.max(...duringLine.gaps) : 0,
      regeneratesDuringDrag: duringLine.invalidations.filter((r) => r === 'fixtures rebuilt').length,
      release: {
        flushes: afterLine.flushes,
        fixtureRebuilds: afterLine.invalidations.filter((r) => r === 'fixtures rebuilt').length,
      },
    };
    console.log(`[C3] LINE start-handle drag "${results.lineHandleDrag.trace}": tick JS median ${lineDrag.median} ms (max ${lineDrag.max})`);
    console.log(`     max gap ${results.lineHandleDrag.maxGapDuringDragMs} ms | regenerates during drag ${results.lineHandleDrag.regeneratesDuringDrag} (must be 0)`);
    console.log(`     release: flushes ${JSON.stringify(afterLine.flushes)}`);
  }

  // ── C2 + F2: LED strand handle drag → release → trail regression ──
  {
    await readMetrics();
    const strand = await page.evaluate(async () => {
      const fixtures = window.ledStrandFixtures || [];
      const f = fixtures.find((x) => x && x.startHandle);
      if (!f) return { skipped: 'no LED strand fixture in this scene' };
      const tc = window.__st.transformControl;
      const h = f.startHandle;
      tc.attach(h);
      tc.dragging = true;
      const times = [];
      for (let k = 0; k < 10; k++) {
        h.position.y += 0.15;
        const t0 = performance.now();
        window._onStrandTransformChange(h);
        times.push(Math.round((performance.now() - t0) * 10) / 10);
        await new Promise((r) => requestAnimationFrame(r));
      }
      const sorted = [...times].sort((a, b) => a - b);
      return { name: f.config.name || '(unnamed strand)', times, median: sorted[5], movedBy: 1.5 };
    });
    const duringStrand = await readMetrics();
    const strandRelease = await page.evaluate(async () => {
      window.__st.transformControl.dragging = false;
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
      const fresh = window.__generatePixelMap().pixels;
      const cached = window.__batchList || [];
      const mismatches = [];
      for (let i = 0; i < Math.min(fresh.length, cached.length); i++) {
        const f = fresh[i];
        const c = cached[i];
        if (Math.abs(f.x - c.wx) > 1e-6 || Math.abs(f.y - c.wy) > 1e-6 || Math.abs(f.z - c.wz) > 1e-6) {
          mismatches.push({ i, name: f.name, fresh: [f.x, f.y, f.z], cached: [c.wx, c.wy, c.wz] });
        }
      }
      return { freshCount: fresh.length, cachedCount: cached.length, total: mismatches.length, sample: mismatches.slice(0, 8) };
    });
    await sleep(500);
    const afterStrand = await readMetrics();
    results.strand = {
      ...strand,
      invalidationsDuringDrag: duringStrand.invalidations,
      release: {
        flushes: afterStrand.flushes,
        invalidations: afterStrand.invalidations,
        strandInvalidations: afterStrand.invalidations.filter((r) => r === 'strand_transform').length,
      },
      trail: strandRelease,
    };
    console.log(`[C2] STRAND drag "${strand.name || strand.skipped}": tick JS median ${strand.median} ms`);
    console.log(`     invalidations during drag ${JSON.stringify(duringStrand.invalidations)} (must be [])`);
    console.log(`[F2] STRAND release: flushes ${JSON.stringify(afterStrand.flushes)} | invalidations ${JSON.stringify(afterStrand.invalidations)}`);
    console.log(`     stale coordinates after release: ${strandRelease.total} (must be 0 — move-trail bug)`);
    await shot(page, '04_strand_after_release');
  }

  // ── E: PACED DRAG FPS vs idle FPS ──
  {
    // INTERLEAVED sampling. This box is shared with the operator's own sim
    // window, so whole-page FPS drifts by 2x between minutes (measured: idle
    // 18.7 → 45 FPS across runs). Idle and dragging samples are therefore
    // alternated inside one evaluate and compared by MEDIAN — a drift that hits
    // both samples equally can no longer masquerade as drag cost (or hide it).
    const paced = await page.evaluate(async (idx, rounds, sampleMs) => {
      const tc = window.__st.transformControl;
      const hb = window.traceObjects[idx].hitbox;
      const measure = async (perFrame) => {
        let frames = 0;
        const start = performance.now();
        while (performance.now() - start < sampleMs) {
          if (perFrame) perFrame();
          frames += 1;
          await new Promise((r) => requestAnimationFrame(r));
        }
        return Math.round(frames / ((performance.now() - start) / 1000) * 10) / 10;
      };
      const idleFps = [];
      const dragFps = [];
      let netMove = 0;
      for (let r = 0; r < rounds; r++) {
        idleFps.push(await measure(null));
        tc.attach(hb);
        tc.dragging = true;
        dragFps.push(await measure(() => {
          hb.position.x += 0.005;
          netMove += 0.005;
          window._onTraceTransformChange(hb);
        }));
        hb.position.x -= netMove;                 // put it back before the flush
        netMove = 0;
        window._onTraceTransformChange(hb);
        tc.dragging = false;                      // release (flushes once)
        for (let f = 0; f < 3; f++) await new Promise((res) => requestAnimationFrame(res));
      }
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      return { idleFps, dragFps, idleMedian: med(idleFps), dragMedian: med(dragFps) };
    }, target.i, 3, 1500);
    await readMetrics();
    results.pacedDrag = {
      ...paced,
      ratio: Math.round(paced.dragMedian / paced.idleMedian * 100) / 100,
    };
    console.log(`[E] PACED DRAG (interleaved x3): drag ${JSON.stringify(paced.dragFps)} vs idle ${JSON.stringify(paced.idleFps)}`);
    console.log(`    median ${paced.dragMedian} FPS dragging vs ${paced.idleMedian} FPS idle (ratio ${results.pacedDrag.ratio}, floor ${PACED_FPS_TOLERANCE})`);
  }

  // ── Restore pristine (memory only — nothing was ever saved) ──
  const restore = await page.evaluate(() => {
    const p = window.__st.params;
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    p.parLights = clone(window.__pristine.parLights);
    p.traces = clone(window.__pristine.traces);
    p.ledStrands = clone(window.__pristine.ledStrands);
    if (window.__st.transformControl) window.__st.transformControl.detach();
    if (window.rebuildParLights) window.rebuildParLights(true);
    if (window.rebuildLedStrands) window.rebuildLedStrands();
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();
    if (window.renderParGUI) window.renderParGUI();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    window.invalidateMarsinBatchCache('probe_restore');
    window.debounceAutoSave = window.__origAutoSave;
    return {
      parLightsMatch: eq(p.parLights, window.__pristine.parLights),
      tracesMatch: eq(p.traces, window.__pristine.traces),
      strandsMatch: eq(p.ledStrands, window.__pristine.ledStrands),
      saveCalls: window.__saveCalls,
    };
  });
  await sleep(1200);
  await shot(page, '05_restored');

  // ── Verdict ──
  const sel = results.select3d;
  const drag = results.dragTicks;
  const checks = {
    'A select: landed (attached + card highlighted)': sel.landed.attached && sel.landed.cardSelected,
    [`A select: max rAF gap < ${SELECT_GAP_BUDGET_MS} ms`]: sel.maxGapMs < SELECT_GAP_BUDGET_MS,
    'A select: ZERO batch invalidations': sel.invalidations.length === 0,
    'A select: ZERO fixture rebuilds (regenerates)': sel.fixtureRebuilds === 0,
    'C drag: ZERO regenerates while the pointer is down': drag.regeneratesDuringDrag === 0,
    'D release: EXACTLY one flush': drag.release.flushes.length === 1,
    'D release: EXACTLY one regenerated trace': drag.release.flushes[0] && drag.release.flushes[0].traces === 1,
    "D release: EXACTLY one 'fixtures rebuilt' invalidation": drag.release.fixtureRebuilds === 1,
    // Count equality first: a generatePixelMap() that returned nothing (mid-
    // rebuild guard) would otherwise make "0 mismatches" a false pass.
    'F1 trail: cached and fresh pixel maps are the same size (non-empty)':
      results.trailGenerator.freshCount > 0
      && results.trailGenerator.freshCount === results.trailGenerator.cachedCount,
    'F1 trail: generator batch coords == fresh pixel map': results.trailGenerator.total === 0,
    'C drag: the generator moved while its fixtures stayed put (ratified §5.1)':
      Math.abs(drag.divergence.midDrag.traceX - drag.divergence.beforeDrag.traceX) > 1
      && drag.divergence.midDrag.fixtureMeanX === drag.divergence.beforeDrag.fixtureMeanX,
    'D release: the fixtures caught up with the generator':
      Math.abs(drag.divergence.afterRelease.fixtureMeanX - drag.divergence.beforeDrag.fixtureMeanX) > 1,
    'C3 line handle: ZERO regenerates while dragging': !results.lineHandleDrag
      || results.lineHandleDrag.regeneratesDuringDrag === 0,
    'C3 line handle: EXACTLY one regenerate on release': !results.lineHandleDrag
      || results.lineHandleDrag.release.fixtureRebuilds === 1,
    'C2 strand: ZERO invalidations while dragging': !results.strand.skipped
      && results.strand.invalidationsDuringDrag.length === 0,
    'F2 strand: release invalidated the batch cache': !results.strand.skipped
      && results.strand.release.strandInvalidations === 1,
    'F2 trail: strand batch coords == fresh pixel map': !results.strand.skipped
      && results.strand.trail.freshCount > 0
      && results.strand.trail.freshCount === results.strand.trail.cachedCount
      && results.strand.trail.total === 0,
    [`E paced drag: >= ${PACED_FPS_TOLERANCE * 100}% of idle FPS`]:
      results.pacedDrag.ratio >= PACED_FPS_TOLERANCE,
    'restore: zero residue in params': restore.parLightsMatch && restore.tracesMatch && restore.strandsMatch,
    'no save-server requests reached the wire': savePortAttempts === 0,
    'GPU adapter valid (discrete, detected)': adapterValid,
  };
  // JS errors only — 'Failed to load resource' is the console echo of the HTTP
  // failures listed separately below (and the aborted :6970 saves are ours).
  const noise = errors.filter((e) => !/Failed to load resource|favicon|ERR_FAILED|net::/i.test(e));
  console.log('\n=== SUMMARY ===');
  Object.entries(checks).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  console.log(`\n  adapter: ${adapter.renderer}`);
  console.log(`  save-server requests aborted: ${savePortAttempts} | stubbed debounceAutoSave calls: ${restore.saveCalls}`);
  if (noise.length) {
    console.log('  JS console errors:');
    noise.slice(0, 12).forEach((e) => console.log('   •', e.slice(0, 180)));
  }
  if (httpFailures.length) {
    console.log('  HTTP failures (server-side, reported not swallowed):');
    [...new Set(httpFailures)].slice(0, 12).forEach((e) => console.log('   •', e));
  }

  results.adapter = adapter;
  results.restore = restore;
  results.checks = checks;
  results.consoleErrors = noise;
  results.httpFailures = [...new Set(httpFailures)];
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n  results → ${path.join(OUT, 'results.json')}`);

  const pass = Object.values(checks).every(Boolean) && noise.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!KEEP) await browser.close();
  else console.log('(keep-alive — close the window manually)');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS FAILED:', e); process.exit(1); });
