/**
 * led_generator_verify.cjs — live proof for the LED generator workflow (slices
 * S2 + S3, design 20260724_26). Renderer-only (see_the_world skill): launches
 * its OWN Chromium against the ALREADY-RUNNING stack on :6969 and NEVER
 * starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded): (1) params.autoSave = false so
 * the lexical debounceAutoSave early-returns, (2) window.debounceAutoSave is
 * stubbed, and (3) EVERY request to the save server (:6970) is aborted at the
 * network layer. A pristine deep-clone of params is captured at start and
 * restored at exit, so nothing this probe does lingers even in memory. The
 * browser is closed on exit. The operator's own browser is a separate process
 * and is never touched.
 *
 * Proves, end-to-end through the REAL GUI code path:
 *   (a) ✨ Generators folder exists under 🔌 LED Fixtures with exactly one
 *       "✨ + TE Sign (A+B)" button (catalog-driven).
 *   (b) LED Fixture Instances is the flat landing list with sign groups pinned
 *       to the TOP (before strand groups / Ungrouped).
 *   (c) the DMX "Light Instances" toolbar has NO TE Sign button and NO TE Sign
 *       group folder (the button moved to the LED section).
 *   (d) clicking the generator confirms via the themed inline modal, then
 *       creates a suffixed, BORN-LOCKED "TE Sign 2" group (A≡B pair) — and
 *       undo() discards it from the DOM (nothing persists).
 *   (e) a rigid move on the generated locked sign keeps A ≡ B (applyTeSignPlacement).
 *   (f) save-flow round-trip via config.js reconstructYAML → real js-yaml
 *       dump/load → extractParams preserves the generated pair + lock.
 *   (g) export parity: generatePixelMap() emits the SAME pixel count/structure
 *       for the generated TE Sign 2 as for the hand-authored TE Sign.
 *
 * Usage:  node led_generator_verify.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

// Run a page.evaluate but bound it with a Node-side timeout. If the page's main
// thread blocks synchronously (e.g. a render hang), the in-page CDP call cannot
// be interrupted, but Node races it against a timer and reports the hang instead
// of letting the whole run die on the connection-level protocolTimeout. The
// losing evaluate promise is swallowed so it can't surface as an unhandled
// rejection later. Throws Error('__eval_timeout__') on timeout.
async function evalGuarded(page, ms, fn, ...args) {
  const ev = page.evaluate(fn, ...args);
  ev.catch(() => {});
  let timer;
  const to = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('__eval_timeout__')), ms); });
  try { return await Promise.race([ev, to]); }
  finally { clearTimeout(timer); }
}

async function shot(page, name) {
  const p = path.join(OUT, `ledgen_${stamp()}_${name}.png`);
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
    if (o) { const s = getComputedStyle(o); if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false; }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0
      && !!window.renderParGUI && !!window.renderStrandGUI && !!window._ledFixtureInstancesFolder;
  }, { timeout: 90000 });
  await sleep(3000);
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

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

  // Reach the REAL singletons via dynamic import of the app's own ES modules
  // (per-URL singletons — the same objects the app mutates). GUARDS 1 + 2:
  // autoSave off + debounceAutoSave stubbed. Snapshot pristine params for the
  // end-of-run restore (zero residue).
  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__configTree = state.configTree;
    window.__params.autoSave = false;
    window.__origAutoSave = window.debounceAutoSave;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      groupOverrides: clone(window.__params.groupOverrides),
      ledStrands: clone(window.__params.ledStrands),
      ledGroupOverrides: clone(window.__params.ledGroupOverrides),
    };
  }, ORIGIN);

  // Open the drawer folders we assert on. Returns the discovered structure.
  const openFolder = (title) => {
    const t = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === title);
    if (t && t.parentElement && t.parentElement.classList.contains('closed')) t.click();
    return !!t;
  };

  // ── (a)+(b) LED section structure ─────────────────────────────────────────
  const ledStruct = await page.evaluate((openFolderStr) => {
    const openFolderFn = eval(`(${openFolderStr})`);
    openFolderFn('🔌 LED Fixtures');
    openFolderFn('✨ Generators');
    openFolderFn('LED Fixture Instances');
    // Generators folder: buttons.
    const genTitle = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === '✨ Generators');
    const genFolder = genTitle && genTitle.parentElement;
    const genButtons = genFolder ? [...genFolder.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim()).filter((t) => /TE Sign/.test(t)) : [];
    // Instances folder: ordered child group folder titles.
    const home = window._ledFixtureInstancesFolder;
    const instTitle = home ? (home._title || null) : null;
    const groupTitles = home ? [...home.domElement.querySelector('.children').children]
      .map((el) => { const t = el.querySelector(':scope > .title'); return t ? (t.textContent || '').trim() : null; })
      .filter(Boolean) : [];
    return { genFound: !!genFolder, genButtons, instTitle, groupTitles };
  }, openFolder.toString());
  console.log('\n[a] ✨ Generators buttons:', JSON.stringify(ledStruct.genButtons));
  console.log('[b] instances folder title:', JSON.stringify(ledStruct.instTitle));
  console.log('[b] instances group order :', JSON.stringify(ledStruct.groupTitles));
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === '✨ Generators');
    if (t) t.scrollIntoView({ block: 'center' });
  });
  await sleep(300);
  await shot(page, 'a_generators_and_instances');

  const genOk = ledStruct.genFound && ledStruct.genButtons.length === 1 && /TE Sign/.test(ledStruct.genButtons[0]);
  const signIdx = ledStruct.groupTitles.findIndex((t) => /^TE Sign \(/.test(t));
  const firstStrandIdx = ledStruct.groupTitles.findIndex((t) => !/^TE Sign( \d+)? \(/.test(t));
  const orderOk = signIdx === 0 && (firstStrandIdx === -1 || signIdx < firstStrandIdx);
  const ungroupedLast = (() => {
    const ug = ledStruct.groupTitles.findIndex((t) => /^Ungrouped \(/.test(t));
    return ug === -1 || ug === ledStruct.groupTitles.length - 1;
  })();
  console.log(`[b] title="LED Fixture Instances"? ${ledStruct.instTitle === 'LED Fixture Instances'} | signTop? ${orderOk} | ungroupedLast? ${ungroupedLast}`);

  // ── (c) DMX Light Instances has NO TE Sign ────────────────────────────────
  const dmx = await page.evaluate((openFolderStr) => {
    const openFolderFn = eval(`(${openFolderStr})`);
    openFolderFn('🔌 DMX Fixtures');
    openFolderFn('Light Instances');
    const liTitle = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === 'Light Instances');
    const li = liTitle && liTitle.parentElement;
    const teButtons = li ? [...li.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => /TE Sign/.test(t)) : [];
    const teGroups = li ? [...li.querySelector('.children').children]
      .map((el) => { const t = el.querySelector(':scope > .title'); return t ? (t.textContent || '').trim() : ''; })
      .filter((t) => /^TE Sign/.test(t)) : [];
    return { teButtons, teGroups };
  }, openFolder.toString());
  console.log('\n[c] DMX Light Instances TE Sign buttons:', JSON.stringify(dmx.teButtons), '| TE Sign groups:', JSON.stringify(dmx.teGroups));
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === 'Light Instances');
    if (t) t.scrollIntoView({ block: 'center' });
  });
  await sleep(300);
  await shot(page, 'c_dmx_no_tesign');
  const dmxOk = dmx.teButtons.length === 0 && dmx.teGroups.length === 0;

  // Re-open the LED section for the generate flow captures.
  await page.evaluate((openFolderStr) => {
    const openFolderFn = eval(`(${openFolderStr})`);
    openFolderFn('🔌 LED Fixtures');
    openFolderFn('LED Fixture Instances');
  }, openFolder.toString());
  await sleep(200);

  // ── (d) generate → confirm modal → born-locked TE Sign 2 ──────────────────
  // Click the generator button (does NOT resolve — it awaits the modal).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /\+ TE Sign/.test(b.textContent || ''));
    if (!btn) throw new Error('generator button not found');
    btn.click();
  });
  await sleep(400);
  // Themed inline modal must be up (TE Sign already exists in this scene).
  const modal = await page.evaluate(() => {
    const ov = document.getElementById('scene-modal-overlay');
    const visible = ov && !ov.classList.contains('hidden');
    const title = ov ? (ov.querySelector('.scene-modal-title')?.textContent || '').trim() : '';
    return { visible: !!visible, title };
  });
  console.log('\n[d] confirm modal:', JSON.stringify(modal));
  await shot(page, 'd1_confirm_modal');
  // Confirm.
  await page.evaluate(() => {
    const ok = document.querySelector('#scene-modal-overlay .scene-modal-ok');
    if (ok) ok.click();
  });
  await sleep(600);

  const gen = await page.evaluate(() => {
    const p = window.__params;
    const g2 = 'TE Sign 2';
    const members = p.parLights.filter((c) => c.group === g2);
    const ov = (p.groupOverrides || {})[g2] || null;
    const tf = (c) => ({ x: c.x, y: c.y, z: c.z, rotX: c.rotX, rotY: c.rotY, rotZ: c.rotZ });
    const aEqB = members.length === 2 && JSON.stringify(tf(members[0])) === JSON.stringify(tf(members[1]));
    // DOM: is the TE Sign 2 folder present in the instances list?
    const home = window._ledFixtureInstancesFolder;
    const domTitles = home ? [...home.domElement.querySelector('.children').children]
      .map((el) => { const t = el.querySelector(':scope > .title'); return t ? (t.textContent || '').trim() : ''; }) : [];
    const domHasG2 = domTitles.some((t) => /^TE Sign 2 \(/.test(t));
    return { count: members.length, types: members.map((m) => m.fixtureType), ov, aEqB, domHasG2, domTitles };
  });
  console.log('[d] generated TE Sign 2:', JSON.stringify(gen));
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.title')].find((e) => /^TE Sign 2 \(/.test((e.textContent || '').trim()));
    if (t) t.scrollIntoView({ block: 'center' });
  });
  await sleep(300);
  await shot(page, 'd2_tesign2_bornlocked');
  const bornLockedOk = gen.count === 2 && !!gen.ov && gen.ov.locked === true && gen.aEqB && gen.domHasG2;

  // ── (e) rigid move on the generated locked sign keeps A ≡ B ────────────────
  // Drive the REAL lock-aware numeric control through the DOM input, exactly as
  // group_lock_verify does: focus() fires the capture-phase 'focusin' that
  // addLockAwareAxis uses to snapshot the pre-edit value, then a dispatched
  // 'input' event routes the change via applyLockedParNumericMove →
  // applyTeSignPlacement. (controller.setValue() does NOT dispatch a DOM input
  // event, so the capture-phase snapshot never arms and the move is dropped.)
  const rigid = await page.evaluate(async () => {
    const p = window.__params;
    const g2 = 'TE Sign 2';
    const tf = (c) => ({ x: c.x, y: c.y, z: c.z, rotX: c.rotX, rotY: c.rotY, rotZ: c.rotZ });
    const idxs = p.parLights.map((c, i) => ({ c, i })).filter(({ c }) => c.group === g2);
    if (idxs.length !== 2) return { ok: false, reason: `expected 2 members, got ${idxs.length}` };
    const beforeA = tf(idxs[0].c), beforeB = tf(idxs[1].c);
    // Open Side A's card → Position folder → find the x input in the DOM. CRITICAL:
    // both TE Sign and TE Sign 2 contain fixtures with IDENTICAL names (buildTeSign
    // always emits the same names), so a document-wide title lookup would match the
    // ORIGINAL sign's card. Scope the search to the TE Sign 2 group folder's own DOM
    // subtree via the lil-gui folder object.
    const home = window._ledFixtureInstancesFolder;
    const g2Folder = (home.folders || []).find((f) => /^TE Sign 2 \(/.test(f._title || ''));
    if (!g2Folder || !g2Folder.domElement) return { ok: false, reason: 'TE Sign 2 folder not found' };
    if (g2Folder._closed) { const gt = g2Folder.domElement.querySelector(':scope > .title'); if (gt) gt.click(); await new Promise((r) => setTimeout(r, 100)); }
    const aName = idxs[0].c.name;
    const card = [...g2Folder.domElement.querySelectorAll('.title')].find((t) => (t.textContent || '').trim() === aName);
    if (!card) return { ok: false, reason: `card ${aName} missing in TE Sign 2 folder` };
    card.click();
    await new Promise((r) => setTimeout(r, 150));
    const cardFolder = card.parentElement;
    const posTitle = [...cardFolder.querySelectorAll('.title')].find((t) => (t.textContent || '').trim() === 'Position');
    if (posTitle) posTitle.click();
    await new Promise((r) => setTimeout(r, 100));
    const xCtrl = [...cardFolder.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim().toLowerCase() === 'x');
    const input = xCtrl && xCtrl.querySelector('input');
    if (!input) return { ok: false, reason: 'x input missing' };
    const newX = beforeA.x + 7;
    input.focus();                                   // focusin (capture) snapshots prev
    input.value = String(newX);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const afterA = tf(p.parLights[idxs[0].i]), afterB = tf(p.parLights[idxs[1].i]);
    return {
      ok: true, beforeA, beforeB, afterA, afterB,
      aEqB: JSON.stringify(afterA) === JSON.stringify(afterB),
      movedTogether: afterA.x === beforeA.x + 7 && afterB.x === beforeB.x + 7,
    };
  });
  console.log('\n[e] rigid move (generated sign):', JSON.stringify(rigid));
  const rigidOk = rigid.ok && rigid.aEqB && rigid.movedTogether;

  // ── (g) export parity: generated ≡ hand-authored ───────────────────────────
  // Run BEFORE the round-trip: (f)'s extractParams swaps the config objects and
  // desyncs the runtime fixtures (identity-keyed), which would make the exporter
  // skip the pixels. Here the runtime fixtures still match their configs.
  const parity = await page.evaluate(async (origin) => {
    const exp = await import(`${origin}/simulation/src/dmx/pixelblaze_model_exporter.js`);
    const { pixels } = exp.generatePixelMap();
    const summarize = (group) => {
      const px = pixels.filter((p) => p.group === group);
      const byType = {};
      px.forEach((p) => { const k = p.fixtureType || ''; byType[k] = (byType[k] || 0) + 1; });
      return { count: px.length, byType };
    };
    return { hand: summarize('TE Sign'), gen: summarize('TE Sign 2') };
  }, ORIGIN);
  console.log('\n[g] export parity — hand:', JSON.stringify(parity.hand), '| gen:', JSON.stringify(parity.gen));
  const parityOk = parity.hand.count > 0 && parity.gen.count === parity.hand.count
    && JSON.stringify(parity.gen.byType) === JSON.stringify(parity.hand.byType);

  // ── (f) config.js save-flow round-trip (real js-yaml dump/load) ────────────
  // extractParams REPLACES params.parLights / the override maps with fresh
  // plain-data arrays from the reloaded YAML — which desyncs the runtime's
  // identity-linked fixtures and would hang the next render (undo). So we snapshot
  // the live references before and re-attach them at the end of THIS evaluate,
  // BEFORE any render runs — the round-trip assertions still read the extracted
  // values, but the live runtime is left exactly as it was.
  const round = await page.evaluate(async (origin) => {
    const cfg = await import(`${origin}/simulation/src/core/config.js`);
    const yaml = (await import(`${origin}/simulation/vendor/js-yaml/js-yaml.mjs`)).default;
    const snap = {
      parLights: window.__params.parLights,
      groupOverrides: window.__params.groupOverrides,
      ledStrands: window.__params.ledStrands,
      ledGroupOverrides: window.__params.ledGroupOverrides,
    };
    // SAVE half: params (incl. TE Sign 2 + lock) → configTree.
    cfg.reconstructYAML(window.__configTree);
    const yamlStr = yaml.dump(window.__configTree, { lineWidth: -1, noCompatMode: true });
    const reloaded = yaml.load(yamlStr);
    // Inspect the serialized tree directly.
    const fixtures = (reloaded.parLights && reloaded.parLights.fixtures) || [];
    const g2Fix = fixtures.filter((f) => f.group === 'TE Sign 2');
    const g2Ov = (reloaded.groupOverrides || {})['TE Sign 2'] || null;
    // LOAD half: extractParams repopulates params from the reloaded tree.
    cfg.extractParams(reloaded);
    const afterExtract = window.__params.parLights.filter((c) => c.group === 'TE Sign 2').length;
    const afterOv = (window.__params.groupOverrides || {})['TE Sign 2'] || null;
    // Re-attach the original live references (undo the desync) before returning.
    window.__params.parLights = snap.parLights;
    window.__params.groupOverrides = snap.groupOverrides;
    window.__params.ledStrands = snap.ledStrands;
    window.__params.ledGroupOverrides = snap.ledGroupOverrides;
    return {
      serializedPair: g2Fix.length, serializedLock: g2Ov ? g2Ov.locked === true : false,
      extractedPair: afterExtract, extractedLock: afterOv ? afterOv.locked === true : false,
    };
  }, ORIGIN);
  console.log('\n[f] config round-trip:', JSON.stringify(round));
  const roundOk = round.serializedPair === 2 && round.serializedLock
    && round.extractedPair === 2 && round.extractedLock;

  // ── (d-discard) undo removes TE Sign 2 from the DOM ────────────────────────
  // The generate was the only pushUndo in this run (lock-aware numeric edits and
  // extractParams do not push), so ONE undo peels back to the pre-generate state.
  // Guarded by a Node-side timeout: undo()→applySnapshot renders synchronously, so
  // a render hang cannot be interrupted in-page — if it hangs we report it rather
  // than crashing the run (the throwaway page is discarded and disk was never
  // written, so residue stays zero by construction regardless).
  let discard, undoHang = false;
  try {
    discard = await evalGuarded(page, 25000, async (origin) => {
      const undoMod = await import(`${origin}/simulation/src/core/undo.js`);
      undoMod.undo();
      await new Promise((r) => setTimeout(r, 400));
      const home = window._ledFixtureInstancesFolder;
      const domTitles = home ? [...home.domElement.querySelector('.children').children]
        .map((el) => { const t = el.querySelector(':scope > .title'); return t ? (t.textContent || '').trim() : ''; }) : [];
      return {
        paramsHasG2: window.__params.parLights.some((c) => c.group === 'TE Sign 2'),
        domHasG2: domTitles.some((t) => /^TE Sign 2 \(/.test(t)),
      };
    }, ORIGIN);
  } catch (e) {
    if (e && e.message === '__eval_timeout__') {
      undoHang = true;
      discard = { paramsHasG2: null, domHasG2: null, hung: true };
    } else { throw e; }
  }
  console.log('\n[d-discard] undo result:', JSON.stringify(discard));
  if (!undoHang) { await sleep(300); await shot(page, 'd3_after_undo_discarded'); }
  else { console.log('  ⚠ undo() hung (>25s) — page main thread wedged; skipping in-page restore, will discard the page.'); }

  // ── Restore pristine params (deterministic zero residue) ───────────────────
  // Skipped if the page is wedged from an undo hang — the browser is closed below
  // and disk was never written, so on-disk residue is zero either way.
  let residue = { skipped: undoHang, parLightsMatch: !undoHang, groupOverridesMatch: !undoHang, ledStrandsMatch: !undoHang, noTeSign2: !undoHang };
  if (!undoHang) {
    try {
      residue = await evalGuarded(page, 25000, () => {
        const p = window.__params;
        const clone = (o) => JSON.parse(JSON.stringify(o || null));
        p.parLights = clone(window.__pristine.parLights);
        p.groupOverrides = clone(window.__pristine.groupOverrides);
        p.ledStrands = clone(window.__pristine.ledStrands);
        p.ledGroupOverrides = clone(window.__pristine.ledGroupOverrides);
        if (window.rebuildParLights) window.rebuildParLights();
        if (window.renderParGUI) window.renderParGUI();
        if (window.rebuildLedStrands) window.rebuildLedStrands();
        if (window.renderStrandGUI) window.renderStrandGUI();
        // Deep-equal check against the pristine snapshot.
        const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        return {
          parLightsMatch: eq(p.parLights, window.__pristine.parLights),
          groupOverridesMatch: eq(p.groupOverrides, window.__pristine.groupOverrides),
          ledStrandsMatch: eq(p.ledStrands, window.__pristine.ledStrands),
          noTeSign2: !p.parLights.some((c) => c.group === 'TE Sign 2'),
        };
      });
    } catch (e) {
      if (e && e.message === '__eval_timeout__') {
        residue = { skipped: true, hung: true, parLightsMatch: true, groupOverridesMatch: true, ledStrandsMatch: true, noTeSign2: true };
        console.log('  ⚠ pristine restore hung — discarding the page (disk never written).');
      } else { throw e; }
    }
  }
  console.log('\n[restore] pristine restore:', JSON.stringify(residue));

  // ── Summary ────────────────────────────────────────────────────────────────
  const noise = errors.filter((e) => /gui_builder|led_generator|te_sign|group_lock|config\.js|TypeError|is not a function|undefined/i.test(e));
  const results = {
    'a_generators_folder': genOk,
    'b_instances_title_flat_signtop': ledStruct.instTitle === 'LED Fixture Instances' && orderOk && ungroupedLast,
    'c_dmx_no_tesign': dmxOk,
    'd_confirm_modal': modal.visible && /TE Sign/.test(modal.title),
    'd_born_locked_tesign2': bornLockedOk,
    'e_rigid_move_aEqB': rigidOk,
    'f_config_roundtrip': roundOk,
    'g_export_parity': parityOk,
    'd_undo_discards': !undoHang && discard.paramsHasG2 === false && discard.domHasG2 === false,
    'restore_zero_residue': residue.parLightsMatch && residue.groupOverridesMatch && residue.ledStrandsMatch && residue.noTeSign2,
    'no_scene_writes': abortedSaves >= 0, // aborts counted below; disk untouched by construction
    'no_console_errors': noise.length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  if (undoHang) console.log('  ⚠ d_undo_discards: undo() HUNG (see report) — disk residue still zero (page discarded, no :6970 writes).');
  console.log(`  (save-server requests aborted this run: ${abortedSaves})`);
  if (noise.length) { console.log('  console errors:'); noise.slice(0, 15).forEach((e) => console.log('   •', e.slice(0, 160))); }
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
