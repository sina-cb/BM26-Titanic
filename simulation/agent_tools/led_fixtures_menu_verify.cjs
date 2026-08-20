/**
 * led_fixtures_menu_verify.cjs — live proof for the LED Fixtures menu mapping UX
 * (report 20260725_52). Renderer-only (see_the_world skill): launches its OWN
 * Chromium against the ALREADY-RUNNING stack on :6969 and NEVER starts or stops
 * a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same contract as
 * led_generator_verify.cjs): (1) params.autoSave = false, (2) window
 * .debounceAutoSave stubbed, (3) EVERY request to the save server (:6970)
 * aborted at the network layer. Pristine deep clones of params AND the
 * controller registry are captured at start and restored at exit, so nothing
 * this probe does lingers even in memory. The browser is closed on exit. The
 * operator's own browser is a separate process and is never touched.
 *
 * It NEVER touches the operator's own groups — every mutation happens on
 * throwaway `ZZ …` probe objects it creates and then discards.
 *
 * Proves:
 *   (a) every named group folder in LED Fixture Instances carries a readable
 *       ✏ Rename button (and the reserved Ungrouped bucket does not);
 *   (b) a group rename is LOUD: the itemised report names what was CARRIED
 *       (display state), what was UNTOUCHED (names + addresses) and that the
 *       exported engine model is now STALE; a toast says the same;
 *   (c) the rename is scene-wide guarded — an LED strand group CANNOT be
 *       renamed onto a live par group's name ("TE Sign"), and vice versa;
 *   (d) the rename carries the group master + view bit and leaves every
 *       fixture/strand NAME and address untouched;
 *   (e) an LED controller card shows the same editable name box + `+port`
 *       button the DMX cards show;
 *   (f) remove-then-add on an LED controller gives the REMOVED output slot
 *       back (P2, not a phantom P5).
 *
 * Usage:  node led_fixtures_menu_verify.cjs [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const PROBE_GROUP = 'ZZ Probe LED Group';
const PROBE_RENAMED = 'ZZ Probe Renamed';
const PROBE_CTRL = 'ZZ Probe LED Controller';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `ledmenu_${stamp()}_${name}.png`);
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
      && !!window.renderParGUI && !!window.renderStrandGUI && !!window._ledFixtureInstancesFolder
      && !!window.__controllerRegistry;
  }, { timeout: 90000 });
  await sleep(3000);
}

const openFolderSrc = `(${((title) => {
  const t = [...document.querySelectorAll('.title')].find((e) => (e.textContent || '').trim() === title);
  if (t && t.parentElement && t.parentElement.classList.contains('closed')) t.click();
  return !!t;
}).toString()})`;

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  const warns = [];
  // Puppeteer names console.warn 'warning' on some builds and 'warn' on others —
  // capture EVERY non-error line and filter by text, so a version bump cannot
  // silently turn this proof into a pass-by-absence.
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else warns.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Native prompt()/alert() would wedge the run — answer them from Node.
  let promptAnswer = null;
  const alerts = [];
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(promptAnswer === null ? '' : promptAnswer);
    else { alerts.push(d.message()); await d.dismiss(); }
  });

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

  // GUARDS 1 + 2 + pristine snapshot (params AND the controller registry).
  const gpu = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__params.autoSave = false;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      groupOverrides: clone(window.__params.groupOverrides),
      ledStrands: clone(window.__params.ledStrands),
      ledGroupOverrides: clone(window.__params.ledGroupOverrides),
      controllers: clone(window.__controllerRegistry.controllers),
      nextControllerId: window.__controllerRegistry.nextControllerId,
      nextUniverse: window.__controllerRegistry.nextUniverse,
    };
    return window.__gpuAdapter || null;
  }, ORIGIN);
  console.log('GPU adapter:', JSON.stringify(gpu));

  // ── (a) every named group folder offers ✏ Rename ──────────────────────────
  const structure = await page.evaluate((openFolderStr) => {
    const openFolder = eval(openFolderStr);
    openFolder('🔌 LED Fixtures');
    openFolder('LED Fixture Instances');
    const home = window._ledFixtureInstancesFolder;
    return (home.folders || []).map((f) => ({
      title: f._title,
      hasRename: [...f.domElement.querySelectorAll('button')]
        .some((b) => /Rename/.test(b.textContent || '')),
    }));
  }, openFolderSrc);
  console.log('\n[a] group folders:', JSON.stringify(structure));
  const named = structure.filter((g) => !/^Ungrouped \(/.test(g.title));
  const ungrouped = structure.filter((g) => /^Ungrouped \(/.test(g.title));
  const renameOk = named.length > 0 && named.every((g) => g.hasRename)
    && ungrouped.every((g) => !g.hasRename);
  // Open via the lil-gui folder object (idempotent) — a DOM click TOGGLES, so a
  // folder the operator left open would close under the screenshot.
  await page.evaluate(() => {
    const home = window._ledFixtureInstancesFolder;
    const f = (home.folders || []).find((x) => /^TE Sign \(/.test(x._title || ''));
    if (f) { f.open(); f.domElement.scrollIntoView({ block: 'center' }); }
  });
  await sleep(500);
  await shot(page, 'a_groups_with_rename');

  // Measure the rename button so "it exists" also means "it is readable".
  const btnGeom = await page.evaluate(() => {
    const home = window._ledFixtureInstancesFolder;
    const f = (home.folders || []).find((x) => /^TE Sign \(/.test(x._title || ''));
    if (!f) return null;
    const b = [...f.domElement.querySelectorAll('button')].find((x) => /Rename/.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
      scrollW: b.scrollWidth, clipped: b.scrollWidth > Math.ceil(r.width) + 1, title: b.title };
  });
  console.log('[a] ✏ Rename button geometry:', JSON.stringify(btnGeom));

  // ── Seed a throwaway LED strand group (never touch the operator's own) ─────
  await page.evaluate((group) => {
    window.__params.ledStrands.push({
      name: `${group} 1`, startX: -3, startY: 5, startZ: 0, endX: 3, endY: 5, endZ: 0,
      color: '#ff8800', intensity: 1, ledCount: 10, group,
      controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0,
    });
    window.__params.ledGroupOverrides = window.__params.ledGroupOverrides || {};
    window.__params.ledGroupOverrides[group] = { enabled: true, brightness: 42, locked: true };
    window._openStrandGroups.add(group);
    if (window.rebuildLedStrands) window.rebuildLedStrands();
    window.renderStrandGUI();
  }, PROBE_GROUP);
  await sleep(400);

  const clickRename = async (groupTitleRe) => page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const home = window._ledFixtureInstancesFolder;
    const f = (home.folders || []).find((x) => re.test(x._title || ''));
    if (!f) throw new Error(`group folder matching ${reSrc} not found`);
    if (f._closed) { const t = f.domElement.querySelector(':scope > .title'); if (t) t.click(); }
    const b = [...f.domElement.querySelectorAll('button')].find((x) => /Rename/.test(x.textContent || ''));
    if (!b) throw new Error(`no Rename button on ${f._title}`);
    b.click();
  }, groupTitleRe);

  // ── (c) the scene-wide guard REFUSES a cross-list collision ───────────────
  warns.length = 0; alerts.length = 0;
  promptAnswer = 'TE Sign';   // a live PAR group — the old strand-only guard allowed this
  await clickRename(`^${PROBE_GROUP} \\(`);
  await sleep(500);
  const collision = await page.evaluate((group) => ({
    stillOldName: window.__params.ledStrands.some((s) => s.group === group),
    noNewGroup: !window.__params.ledStrands.some((s) => s.group === 'TE Sign'),
  }), PROBE_GROUP);
  console.log('\n[c] cross-list collision refusal — alert:',
    JSON.stringify((alerts[0] || '').slice(0, 120)));
  console.log('[c] state after refusal:', JSON.stringify(collision));
  const collisionOk = alerts.length === 1 && /already exists/.test(alerts[0])
    && /scene-wide/.test(alerts[0]) && collision.stillOldName && collision.noNewGroup;

  // ── (b)+(d) the real rename: loud, and mapping untouched ──────────────────
  const before = await page.evaluate((group) => ({
    names: window.__params.ledStrands.filter((s) => s.group === group).map((s) => s.name),
    override: JSON.parse(JSON.stringify(window.__params.ledGroupOverrides[group] || null)),
  }), PROBE_GROUP);
  warns.length = 0; alerts.length = 0;
  promptAnswer = PROBE_RENAMED;
  await clickRename(`^${PROBE_GROUP} \\(`);
  await sleep(700);
  const after = await page.evaluate((args) => {
    const [oldName, newName] = args;
    const p = window.__params;
    const home = window._ledFixtureInstancesFolder;
    const titles = (home.folders || []).map((f) => f._title);
    const toastEl = [...document.querySelectorAll('div')]
      .filter((d) => /Group ".*" → ".*"/.test(d.textContent || '') && d.children.length === 0)
      .map((d) => {
        const r = d.getBoundingClientRect();
        return { text: d.textContent.trim(), opacity: getComputedStyle(d).opacity,
          onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight };
      });
    return {
      names: p.ledStrands.filter((s) => s.group === newName).map((s) => s.name),
      oldGroupGone: !p.ledStrands.some((s) => s.group === oldName),
      overrideCarried: JSON.parse(JSON.stringify(p.ledGroupOverrides[newName] || null)),
      overrideOrphan: Object.prototype.hasOwnProperty.call(p.ledGroupOverrides, oldName),
      folderTitles: titles,
      toasts: toastEl,
    };
  }, [PROBE_GROUP, PROBE_RENAMED]);
  const report = warns.filter((w) => /\[Rename\]|ENGINE MODEL|CARRIED|UNTOUCHED/.test(w));
  console.log('\n[b] the report the operator sees:');
  report.forEach((line) => console.log('   ', line.replace(/\s+/g, ' ').slice(0, 200)));
  console.log('[d] before names:', JSON.stringify(before.names));
  console.log('[d] after  names:', JSON.stringify(after.names));
  console.log('[d] override before:', JSON.stringify(before.override),
    '| after:', JSON.stringify(after.overrideCarried), '| orphan?', after.overrideOrphan);
  console.log('[b] toast:', JSON.stringify(after.toasts));
  await page.evaluate((re) => {
    const t = [...document.querySelectorAll('.title')].find((e) => new RegExp(re).test((e.textContent || '').trim()));
    if (t) t.scrollIntoView({ block: 'center' });
  }, `^${PROBE_RENAMED} \\(`);
  await sleep(400);
  await shot(page, 'b_rename_loud_and_toast');

  const reportText = report.join('\n');
  const loudOk = /CARRIED \(display state\)/.test(reportText)
    && /UNTOUCHED \(mapping\)/.test(reportText)
    && /ENGINE MODEL now STALE/.test(reportText)
    && /Re-export/.test(reportText)
    && !/channels freed/.test(reportText);
  const toastOk = after.toasts.length > 0 && after.toasts.some((t) =>
    t.onScreen && Number(t.opacity) > 0.5 && /RE-EXPORT the engine model/.test(t.text));
  const mappingUntouchedOk = JSON.stringify(before.names) === JSON.stringify(after.names)
    && after.oldGroupGone && !after.overrideOrphan
    && after.overrideCarried && after.overrideCarried.brightness === 42
    && after.overrideCarried.locked === true;

  // ── (e)+(f) LED controller card: name box, +port, remove-then-re-add ───────
  const ctrl = await page.evaluate(async (args) => {
    const [origin, name] = args;
    const reg = await import(`${origin}/simulation/src/dmx/controller_registry.js`);
    const registry = window.__controllerRegistry;
    const controller = reg.addController(registry, { name, ip: '10.99.99.9' });
    reg.setControllerType(controller, reg.CONTROLLER_TYPE_LED);
    const seeded = controller.ports.map((p) => p.port);
    // Remove output 2, then ask for one back.
    const p2 = controller.ports.find((p) => p.port === 2);
    reg.removePort(registry, controller, p2);
    const afterRemove = controller.ports.map((p) => p.port);
    const readded = reg.addPort(registry, controller);
    const afterAdd = controller.ports.map((p) => p.port);
    return { seeded, afterRemove, readded: readded.port, afterAdd, id: controller.id };
  }, [ORIGIN, PROBE_CTRL]);
  console.log('\n[f] LED output slots — seeded:', JSON.stringify(ctrl.seeded),
    '| after remove P2:', JSON.stringify(ctrl.afterRemove),
    '| +port gave:', ctrl.readded, '| now:', JSON.stringify(ctrl.afterAdd));
  const slotOk = JSON.stringify(ctrl.afterRemove) === '[1,3,4]'
    && ctrl.readded === 2 && JSON.stringify(ctrl.afterAdd) === '[1,2,3,4]';

  // Render the Controllers panel so the LED card is visible, then read it.
  const card = await page.evaluate((name) => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Controllers/i.test(b.textContent || ''));
    if (btn) btn.click();
    return name;
  }, PROBE_CTRL);
  await sleep(900);
  const cardInfo = await page.evaluate((name) => {
    const cards = [...document.querySelectorAll('.cm-controller')];
    const el = cards.find((c) => {
      const i = c.querySelector('input.cm-name');
      return i && i.value === name;
    });
    if (!el) return { found: false, cardCount: cards.length };
    const nameInp = el.querySelector('input.cm-name');
    const r = nameInp.getBoundingClientRect();
    return {
      found: true,
      nameValue: nameInp.value,
      nameEditable: !nameInp.disabled && !nameInp.readOnly,
      nameWidth: Math.round(r.width),
      headRows: [...el.querySelectorAll('.cm-controller-head-row')].length,
      headButtons: [...el.querySelectorAll('.cm-controller-head button')].map((b) => b.textContent.trim()),
      hasAddPort: [...el.querySelectorAll('.cm-controller-head button')].some((b) => /\+port/.test(b.textContent || '')),
      ledConfig: !!el.querySelector('.cm-led-config'),
      portLabels: [...el.querySelectorAll('.cm-port-label')].map((p) => p.textContent.trim())
        .filter((t) => /^P\d/.test(t)),
    };
  }, PROBE_CTRL);
  console.log('\n[e] LED controller card:', JSON.stringify(cardInfo));
  await page.evaluate((name) => {
    const i = [...document.querySelectorAll('input.cm-name')].find((x) => x.value === name);
    if (i) i.scrollIntoView({ block: 'center' });
  }, PROBE_CTRL);
  await sleep(400);
  await shot(page, 'e_led_controller_card_name_and_port');
  const cardOk = cardInfo.found && cardInfo.nameEditable && cardInfo.hasAddPort
    && cardInfo.ledConfig && cardInfo.headRows === 2 && cardInfo.nameWidth > 100
    && JSON.stringify(cardInfo.portLabels.map((t) => t.replace(/\s.*/, ''))) === '["P1","P2","P3","P4"]';

  // ── Restore pristine params + registry (deterministic zero residue) ───────
  const residue = await page.evaluate(() => {
    const p = window.__params;
    const reg = window.__controllerRegistry;
    const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
    p.parLights = clone(window.__pristine.parLights);
    p.groupOverrides = clone(window.__pristine.groupOverrides);
    p.ledStrands = clone(window.__pristine.ledStrands);
    p.ledGroupOverrides = clone(window.__pristine.ledGroupOverrides);
    reg.controllers.length = 0;
    clone(window.__pristine.controllers).forEach((c) => reg.controllers.push(c));
    reg.nextControllerId = window.__pristine.nextControllerId;
    reg.nextUniverse = window.__pristine.nextUniverse;
    if (window.rebuildParLights) window.rebuildParLights();
    if (window.renderParGUI) window.renderParGUI();
    if (window.rebuildLedStrands) window.rebuildLedStrands();
    if (window.renderStrandGUI) window.renderStrandGUI();
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      parLightsMatch: eq(p.parLights, window.__pristine.parLights),
      ledStrandsMatch: eq(p.ledStrands, window.__pristine.ledStrands),
      ledOverridesMatch: eq(p.ledGroupOverrides, window.__pristine.ledGroupOverrides),
      controllersMatch: eq(reg.controllers, window.__pristine.controllers),
      noProbeGroup: !p.ledStrands.some((s) => /^ZZ Probe/.test(s.group || '')),
      noProbeController: !reg.controllers.some((c) => /^ZZ Probe/.test(c.name || '')),
    };
  });
  console.log('\n[restore] pristine restore:', JSON.stringify(residue));

  const noise = errors.filter((e) => /gui_builder|group_rename_guard|controller_registry|TypeError|is not a function|undefined/i.test(e));
  const results = {
    'a_named_groups_offer_rename': renameOk,
    'a_rename_button_readable': !!btnGeom && !btnGeom.clipped && btnGeom.w >= 40 && !!btnGeom.title,
    'b_rename_report_is_loud_and_honest': loudOk,
    'b_toast_visible_and_accurate': toastOk,
    'c_cross_list_collision_refused': collisionOk,
    'd_names_and_override_intact': mappingUntouchedOk,
    'e_led_card_has_name_and_addport': cardOk,
    'f_removed_output_slot_comes_back': slotOk,
    'restore_zero_residue': residue.parLightsMatch && residue.ledStrandsMatch
      && residue.ledOverridesMatch && residue.controllersMatch
      && residue.noProbeGroup && residue.noProbeController,
    'no_console_errors': noise.length === 0,
  };
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? '✅' : '❌'} ${k}`));
  console.log(`  (save-server requests aborted this run: ${abortedSaves})`);
  if (noise.length) { console.log('  console errors:'); noise.slice(0, 10).forEach((e) => console.log('   •', e.slice(0, 180))); }
  const allPass = Object.values(results).every(Boolean);
  console.log(`\nRESULT: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
