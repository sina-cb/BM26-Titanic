/**
 * trace_rename_verify.cjs — live before/after proof for the trace-generator
 * rename orphan fix (report 20260724_37). Renderer-only (see_the_world skill):
 * launches its OWN Chromium against the ALREADY-RUNNING stack on :6969 and NEVER
 * starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same as led_generator_verify):
 * (1) params.autoSave = false, (2) window.debounceAutoSave stubbed, (3) EVERY
 * request to the save server (:6970) aborted at the network layer. A pristine
 * deep-clone of params.{parLights,groupOverrides,traces} + the view registry's
 * groupBits is captured at start and restored at exit — nothing lingers, even in
 * memory. Browser closed on exit. The operator's own browser is a separate
 * process and is never touched.
 *
 * Proves, end-to-end through the REAL GUI code path, the operator's sequence
 * ("create a group, press generate, change the name of the generator"):
 *   REPRO — reproduces the ORIGINAL bug faithfully: generate a synthetic circle
 *     trace, then set trace.groupName = <new> and click the REAL Generate button
 *     (exactly what the old handler did: `trace.groupName = trace.name;
 *     generateGroupFromTrace(i)` with no previous-name sweep) → the OLD-named set
 *     is orphaned → DUPLICATE fixtures + a stale group folder.
 *   FIX — resets, regenerates, then renames through the REAL trace-name input
 *     (focus → input → blur → onFinishChange) → a single set of instances, the
 *     old group folder gone, the group master override carried to the new key,
 *     the view-mask bit carried, and trace.groupName tracking the fixtures
 *     (config.js re-stamp intact).
 *   GUARD — renaming onto an existing group name fails loud (alert) and reverts.
 *
 * Usage:  node trace_rename_verify.cjs [--keep-alive]
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

const GROUP = 'ZZ Orphan Probe';
const RENAMED = 'ZZ Renamed Probe';

async function shot(page, name) {
  const p = path.join(OUT, `tracerename_${stamp()}_${name}.png`);
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
      && !!window.renderGeneratorGUI && !!window.renderParGUI && Array.isArray(window.traceGuiFolders);
  }, { timeout: 90000 });
  await sleep(3000);
}

function countGroup(page, group) {
  return page.evaluate((g) => window.__params.parLights.filter((l) => l.group === g && l.traceGenerated).length, group);
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  const dialogs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Auto-dismiss the fail-loud alert() from the collision guard.
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

  // GUARDS 1+2 + pristine snapshot (incl. view registry groupBits).
  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__params.autoSave = false;
    window.__origAutoSave = window.debounceAutoSave;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    const reg = window.__viewRegistry || { groupBits: {} };
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      groupOverrides: clone(window.__params.groupOverrides),
      traces: clone(window.__params.traces),
      groupBits: clone(reg.groupBits),
    };
  }, ORIGIN);

  // Add a synthetic circle trace as the LAST trace, then rebuild the generator GUI.
  const traceIdx = await page.evaluate((group) => {
    const p = window.__params;
    if (!Array.isArray(p.traces)) p.traces = [];
    p.traces.push({
      name: group, groupName: group, shape: 'circle', radius: 5, arc: 360,
      count: 4, x: 0, y: 6, z: 0, rotX: 0, rotY: 0, rotZ: 0,
      aimMode: 'lookAt', aimX: 0, aimY: 0, aimZ: 0,
      fixtureType: 'UkingPar', controllerIp: '', generated: false,
    });
    window.renderGeneratorGUI();
    return p.traces.length - 1;
  }, GROUP);
  console.log(`\nSynthetic trace "${GROUP}" added at index ${traceIdx}`);

  // Open the trace folder + click its REAL "✓ Generate" button.
  await page.evaluate((idx) => {
    if (window.openTraceFolder) window.openTraceFolder(idx);
    const el = window.traceGuiFolders[idx].domElement;
    const gen = [...el.querySelectorAll('button')].find((b) => /Generate/.test(b.textContent || ''));
    if (!gen) throw new Error('Generate button not found');
    gen.click();
  }, traceIdx);
  await sleep(500);
  const afterGen = await countGroup(page, GROUP);
  console.log(`[setup] fixtures after generate: ${afterGen} (expect 4)`);

  // ── REPRO: reproduce the ORIGINAL handler effect (set groupName + regenerate
  //    with no previous-name sweep) → old set orphaned → duplication. ──────────
  const repro = await page.evaluate((idx, group, renamed) => {
    const p = window.__params;
    // EXACTLY what the old buggy onFinishChange did (lines 1+2):
    p.traces[idx].groupName = renamed;      //   trace.groupName = trace.name
    const el = window.traceGuiFolders[idx].domElement;
    const gen = [...el.querySelectorAll('button')].find((b) => /Generate/.test(b.textContent || ''));
    gen.click();                            //   generateGroupFromTrace(i)  [no prev sweep]
    const old = p.parLights.filter((l) => l.group === group && l.traceGenerated).length;
    const neu = p.parLights.filter((l) => l.group === renamed && l.traceGenerated).length;
    return { old, neu, total: old + neu };
  }, traceIdx, GROUP, RENAMED);
  await sleep(400);
  // DOM: both group folders visible in Light Instances?
  const reproDom = await page.evaluate((group, renamed) => {
    const titles = [...document.querySelectorAll('.title')].map((t) => (t.textContent || '').trim());
    return {
      hasOld: titles.some((t) => t.startsWith(`${group} (`)),
      hasNew: titles.some((t) => t.startsWith(`${renamed} (`)),
    };
  }, GROUP, RENAMED);
  console.log(`[REPRO] old="${GROUP}"=${repro.old}  new="${RENAMED}"=${repro.neu}  total=${repro.total}`);
  console.log(`[REPRO] DOM shows old group folder? ${reproDom.hasOld}  new group folder? ${reproDom.hasNew}`);
  await page.evaluate((idx) => {
    const t = window.traceGuiFolders[idx].domElement.querySelector('.title');
    if (t) t.scrollIntoView({ block: 'center' });
  }, traceIdx);
  await sleep(200);
  await shot(page, 'repro_bug_duplicates');
  const reproOk = repro.old === 4 && repro.neu === 4 && reproDom.hasOld && reproDom.hasNew;

  // ── Reset to a clean single generated group, then set a master override +
  //    a view-mask bit so we can prove they carry across the rename. ──────────
  await page.evaluate((idx, group, renamed) => {
    const p = window.__params;
    // Drop everything the repro created and re-stamp a clean generated set.
    p.parLights = p.parLights.filter((l) => !(l.traceGenerated && (l.group === group || l.group === renamed)));
    p.traces[idx].groupName = group;
    p.traces[idx].name = group;
    p.traces[idx].generated = false;
    window.renderGeneratorGUI();
    if (window.openTraceFolder) window.openTraceFolder(idx);
    const el = window.traceGuiFolders[idx].domElement;
    const gen = [...el.querySelectorAll('button')].find((b) => /Generate/.test(b.textContent || ''));
    gen.click();
    // Seed a group master override + a view-mask bit under the OLD name.
    if (!p.groupOverrides) p.groupOverrides = {};
    delete p.groupOverrides[renamed];   // clear any default left by the repro render
    p.groupOverrides[group] = { enabled: false, brightness: 33, locked: false };
    const reg = window.__viewRegistry || (window.__viewRegistry = { groupBits: {}, custom: [] });
    reg.groupBits[group] = 4096;
  }, traceIdx, GROUP, RENAMED);
  await sleep(400);
  const beforeFix = await countGroup(page, GROUP);
  console.log(`\n[fix-setup] clean generated "${GROUP}"=${beforeFix} (expect 4), override + view bit seeded`);

  // ── FIX: rename through the REAL trace-name input (focus → input → blur). ──
  const fix = await page.evaluate(async (idx, group, renamed) => {
    const el = window.traceGuiFolders[idx].domElement;
    const nameCtrl = [...el.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim() === 'Name');
    const input = nameCtrl && nameCtrl.querySelector('input');
    if (!input) return { ok: false, reason: 'Name input not found' };
    input.focus();
    input.value = renamed;
    input.dispatchEvent(new Event('input', { bubbles: true }));  // setValue → trace.name
    input.dispatchEvent(new Event('blur'));                      // _callOnFinishChange
    await new Promise((r) => setTimeout(r, 300));
    const p = window.__params;
    const reg = window.__viewRegistry || { groupBits: {} };
    return {
      ok: true,
      old: p.parLights.filter((l) => l.group === group && l.traceGenerated).length,
      neu: p.parLights.filter((l) => l.group === renamed && l.traceGenerated).length,
      traceGroupName: p.traces[idx].groupName,
      traceName: p.traces[idx].name,
      ovOld: (p.groupOverrides || {})[group] || null,
      ovNew: (p.groupOverrides || {})[renamed] || null,
      bitOld: reg.groupBits[group],
      bitNew: reg.groupBits[renamed],
      names: p.parLights.filter((l) => l.group === renamed && l.traceGenerated).map((l) => l.name),
    };
  }, traceIdx, GROUP, RENAMED);
  await sleep(300);
  const fixDom = await page.evaluate((group, renamed) => {
    const titles = [...document.querySelectorAll('.title')].map((t) => (t.textContent || '').trim());
    return {
      hasOld: titles.some((t) => t.startsWith(`${group} (`)),
      hasNew: titles.some((t) => t.startsWith(`${renamed} (`)),
    };
  }, GROUP, RENAMED);
  console.log('[FIX]', JSON.stringify(fix));
  console.log(`[FIX] DOM old folder? ${fixDom.hasOld} (expect false)  new folder? ${fixDom.hasNew} (expect true)`);
  await page.evaluate((idx) => {
    const t = window.traceGuiFolders[idx].domElement.querySelector('.title');
    if (t) t.scrollIntoView({ block: 'center' });
  }, traceIdx);
  await sleep(200);
  await shot(page, 'fix_single_group');
  // config.js re-stamp check, SCOPED to the probe's own trace: the renamed
  // trace's generated fixtures must all map back from its (new) groupName.
  // (Scene-wide would trip on the 12 pre-existing committed orphans, report _32.)
  const restamp = await page.evaluate((renamed) => {
    const p = window.__params;
    const names = new Set(p.traces.filter((t) => t.generated).map((t) => t.groupName || t.name));
    return names.has(renamed)
      && p.parLights.filter((l) => l.traceGenerated && l.group === renamed).every((l) => names.has(l.group));
  }, RENAMED);
  const conds = {
    ok: fix.ok, old0: fix.old === 0, neu4: fix.neu === 4,
    noOldFolder: !fixDom.hasOld, hasNewFolder: fixDom.hasNew,
    traceGroupName: fix.traceGroupName === RENAMED, traceName: fix.traceName === RENAMED,
    ovOldGone: !fix.ovOld, ovNewCarried: !!fix.ovNew && fix.ovNew.brightness === 33 && fix.ovNew.enabled === false,
    bitOldGone: fix.bitOld === undefined, bitNewCarried: fix.bitNew === 4096,
    restamp,
    names: JSON.stringify(fix.names) === JSON.stringify([`${RENAMED} 1`, `${RENAMED} 2`, `${RENAMED} 3`, `${RENAMED} 4`]),
  };
  console.log('[FIX] sub-conditions:', JSON.stringify(conds));
  const fixOk = Object.values(conds).every(Boolean);

  // ── GUARD: rename onto an existing par group name must fail loud + revert. ──
  const dialogsBefore = dialogs.length;
  const guard = await page.evaluate(async (idx, renamed) => {
    const p = window.__params;
    // Pick an existing par group that is NOT this trace's group.
    const existing = [...new Set(p.parLights.map((l) => l.group))].find((g) => g && g !== renamed);
    const el = window.traceGuiFolders[idx].domElement;
    const nameCtrl = [...el.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim() === 'Name');
    const input = nameCtrl.querySelector('input');
    input.focus();
    input.value = existing;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r, 300));
    return {
      target: existing,
      traceGroupName: p.traces[idx].groupName,   // must still be renamed (reverted)
      inputValue: input.value,
      renamedStillIntact: p.parLights.filter((l) => l.group === renamed && l.traceGenerated).length,
    };
  }, traceIdx, RENAMED);
  const guardOk = guard.traceGroupName === RENAMED && guard.inputValue === RENAMED
    && guard.renamedStillIntact === 4 && dialogs.length > dialogsBefore;
  console.log('\n[GUARD]', JSON.stringify(guard), `| alert fired? ${dialogs.length > dialogsBefore}`);

  // ── Restore pristine (deterministic zero residue). ─────────────────────────
  const residue = await page.evaluate(() => {
    const p = window.__params;
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    p.parLights = clone(window.__pristine.parLights);
    p.groupOverrides = clone(window.__pristine.groupOverrides);
    p.traces = clone(window.__pristine.traces);
    const reg = window.__viewRegistry || (window.__viewRegistry = { groupBits: {}, custom: [] });
    reg.groupBits = clone(window.__pristine.groupBits);
    if (window.rebuildParLights) window.rebuildParLights(true);
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    if (window.renderParGUI) window.renderParGUI();
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      parLightsMatch: eq(p.parLights, window.__pristine.parLights),
      tracesMatch: eq(p.traces, window.__pristine.traces),
      noProbeGroups: !p.parLights.some((l) => l.group === 'ZZ Orphan Probe' || l.group === 'ZZ Renamed Probe'),
    };
  });
  console.log('\n[restore]', JSON.stringify(residue));

  // ── Summary ────────────────────────────────────────────────────────────────
  const noise = errors.filter((e) => /gui_builder|trace|config\.js|TypeError|is not a function|undefined/i.test(e));
  const results = {
    'repro_old_bug_duplicates': reproOk,
    'fix_single_group_no_orphan': fixOk,
    'guard_collision_fails_loud_and_reverts': guardOk,
    'restore_zero_residue': residue.parLightsMatch && residue.tracesMatch && residue.noProbeGroups,
    'no_console_errors': noise.length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  console.log(`  (save-server requests aborted this run: ${abortedSaves})`);
  if (noise.length) { console.log('  console errors:'); noise.slice(0, 15).forEach((e) => console.log('   •', e.slice(0, 160))); }
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
