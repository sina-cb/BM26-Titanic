/**
 * generator_splits_verify.cjs — live proof for generator chain-order splits
 * (design 20260725_41, implementation 20260725_42). Renderer-only
 * (see_the_world skill): launches its OWN Chromium against the ALREADY-RUNNING
 * stack on :6969 and NEVER starts/stops a server.
 *
 * ZERO-SCENE-WRITE GUARANTEE (triple-guarded, same as trace_rename_verify):
 * (1) params.autoSave = false, (2) window.debounceAutoSave stubbed, (3) EVERY
 * request to the save server (:6970) aborted at the network layer. A pristine
 * deep-clone of params.{parLights,traces} is captured at start and restored at
 * exit — nothing lingers, even in memory. Browser closed on exit. The
 * operator's own browser is a separate process and is never touched.
 *
 * Proves, through the REAL GUI code path, on a synthetic 5-light LINE trace
 * whose path positions are at known x coordinates (-10, -5, 0, 5, 10):
 *   BASE    — generate with no splits → names 1..5 in plain path order
 *             (backward compatibility).
 *   SPLITS  — the operator's example (4→5 / 3→2 / 1→1) → the card's status row
 *             reads "4→5, 3→2, 1 · covers 1–5 ✓", and after Regenerate the
 *             fixture number → path position table matches design §4 exactly.
 *   SWAP    — the ⇄ Swap start/end button writes the single full-reverse split,
 *             flips its own label to "⇄ Restore path order", and reverses the
 *             numbering; pressing it again restores path order.
 *   CONFIRM — with mapped fixtures present, the renumber confirm fires and
 *             states the SEMANTIC CAVEAT in as many words.
 *   INVALID — a gap in the splits turns the card red, and Regenerate REFUSES
 *             loudly (alert) without mutating a single fixture.
 *
 * Usage:  node generator_splits_verify.cjs [--keep-alive]
 * Screenshots: ~/tmp/generator_splits/
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ORIGIN = 'http://127.0.0.1:6969';
const SIM = `${ORIGIN}/simulation/?scene=titanic&profile=full&renderer=webgl`;
const OUT = path.join(os.homedir(), 'tmp', 'generator_splits');
const KEEP = process.argv.includes('--keep-alive');
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GROUP = 'ZZ Chain Order Probe';
// A line from x=-10 to x=+10 with 5 lights → path positions 1..5 sit at
// x = -10, -5, 0, 5, 10. So x identifies the path position unambiguously.
const POSITION_X = [-10, -5, 0, 5, 10];
const OPERATOR_SPLITS = [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }];
// design §4: fixture number j → path position
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
      && !!window.renderGeneratorGUI && Array.isArray(window.traceGuiFolders);
  }, { timeout: 90000 });
  await sleep(3000);
}

/** Fixture name → path position (derived from the light's x coordinate). */
function readGroupOrder(page, traceIdx) {
  return page.evaluate((group, xs) => {
    const lights = window.__params.parLights.filter((l) => l.group === group && l.traceGenerated);
    return lights.map((l) => ({
      name: l.name,
      // nearest known path-position x (float tolerance)
      position: xs.reduce((best, x, k) =>
        Math.abs(l.x - x) < Math.abs(l.x - xs[best]) ? k : best, 0) + 1,
      x: Math.round(l.x * 1000) / 1000,
    }));
  }, GROUP, POSITION_X);
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

/** Open the trace card and its ⛓ Chain Order sub-folder, scroll into view. */
async function openChainFolder(page, traceIdx) {
  await page.evaluate((idx) => {
    if (window.openTraceFolder) window.openTraceFolder(idx);
    const card = window.traceGuiFolders[idx];
    card.open();
    // Use the folder API directly — a .title click goes through openAnimated,
    // which only drops the `closed` class after its transition.
    const chain = (card.folders || []).find((f) =>
      /Chain Order/.test((f.$title && f.$title.textContent) || ''));
    if (!chain) throw new Error('⛓ Chain Order folder not found on the card');
    chain.open();
    (chain.folders || []).forEach((sf) => sf.open());
    chain.domElement.scrollIntoView({ block: 'center' });
  }, traceIdx);
  await sleep(500);
}

/** The card's read-only Order status row + the red badge line, as text. */
function readChainStatus(page, traceIdx) {
  return page.evaluate((idx) => {
    const el = window.traceGuiFolders[idx].domElement;
    const ctrl = [...el.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim() === 'Order');
    const input = ctrl && ctrl.querySelector('input');
    const badge = [...el.querySelectorAll('div')]
      .map((d) => (d.textContent || '').trim())
      .find((t) => t.startsWith('⚠ CHAIN SPLITS INVALID'));
    const swap = [...el.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .find((t) => /Swap start\/end|Restore path order/.test(t));
    const note = [...el.querySelectorAll('div')]
      .map((d) => (d.textContent || '').trim())
      .find((t) => /^⚠ \d+ mapped fixture/.test(t));
    return {
      order: input ? input.value : null, badge: badge || null,
      swapLabel: swap || null, note: note || null,
    };
  }, traceIdx);
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

  // GUARDS 1+2 + pristine snapshot.
  const gpu = await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = state.params;
    window.__params.autoSave = false;
    window.debounceAutoSave = () => {};
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    window.__pristine = {
      parLights: clone(window.__params.parLights),
      traces: clone(window.__params.traces),
    };
    return window.__gpuAdapter || null;
  }, ORIGIN);
  // Ops rule 20260725_39: record the adapter next to every number reported.
  console.log(`\n[gpu] ${JSON.stringify(gpu)}`);

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
    return p.traces.length - 1;
  }, GROUP);
  console.log(`Synthetic 5-light line trace "${GROUP}" at index ${traceIdx}`);

  // ── BASE: generate with no splits → plain path order ──────────────────────
  await openChainFolder(page, traceIdx);
  const baseStatus = await readChainStatus(page, traceIdx);
  await clickCardButton(page, traceIdx, 'Generate');
  await sleep(600);
  await openChainFolder(page, traceIdx);
  const base = await readGroupOrder(page, traceIdx);
  console.log('\n[BASE] status row:', JSON.stringify(baseStatus));
  console.log('[BASE] emitted:', base.map((f) => `${f.name}@p${f.position}`).join('  '));
  await shot(page, 'base_path_order');
  const baseOk = baseStatus.order === '1..5 (path order)'
    && baseStatus.swapLabel === '⇄ Swap start/end'
    && baseStatus.badge === null
    && base.length === 5
    && base.every((f, j) => f.name === `${GROUP} ${j + 1}` && f.position === j + 1);

  // ── SPLITS: the operator's example ────────────────────────────────────────
  await page.evaluate((idx, splits) => {
    window.__params.traces[idx].chainSplits = splits;
    window.renderGeneratorGUI();
  }, traceIdx, OPERATOR_SPLITS);
  await openChainFolder(page, traceIdx);
  const splitStatus = await readChainStatus(page, traceIdx);
  console.log('\n[SPLITS] status row:', JSON.stringify(splitStatus));
  await shot(page, 'splits_card_status');

  await clickCardButton(page, traceIdx, 'Regenerate');
  await sleep(600);
  await openChainFolder(page, traceIdx);
  const split = await readGroupOrder(page, traceIdx);
  console.log('[SPLITS] emitted:', split.map((f) => `${f.name}@p${f.position} x=${f.x}`).join('  '));
  await shot(page, 'splits_regenerated');
  const splitOk = splitStatus.order === '4→5, 3→2, 1 · covers 1–5 ✓'
    && splitStatus.badge === null
    && split.length === 5
    && split.every((f, j) => f.name === `${GROUP} ${j + 1}` && f.position === EXPECTED_TABLE[j]);

  // ── CONFIRM: mark the probe fixtures "mapped", then swap ──────────────────
  const dialogsBeforeConfirm = dialogs.length;
  await page.evaluate((group) => {
    window.__params.parLights
      .filter((l) => l.group === group && l.traceGenerated)
      .forEach((l, k) => { l.dmxUniverse = 3; l.dmxAddress = 1 + k * 10; });
    window.renderGeneratorGUI();
  }, GROUP);
  await openChainFolder(page, traceIdx);
  const mappedStatus = await readChainStatus(page, traceIdx);
  console.log('\n[MAPPED] note row:', JSON.stringify(mappedStatus.note));
  await shot(page, 'mapped_note');
  const mappedNoteOk = /^⚠ 5 mapped fixture\(s\) keep their addresses and RENUMBER on Regenerate$/
    .test(mappedStatus.note || '');

  // ── SWAP: full reverse (fires the overwrite confirm + the renumber confirm)
  await clickCardButton(page, traceIdx, 'Swap start/end');
  await sleep(700);
  await openChainFolder(page, traceIdx);
  const swapStatus = await readChainStatus(page, traceIdx);
  const swapped = await readGroupOrder(page, traceIdx);
  const confirmMsgs = dialogs.slice(dialogsBeforeConfirm);
  console.log('\n[SWAP] status row:', JSON.stringify(swapStatus));
  console.log('[SWAP] emitted:', swapped.map((f) => `${f.name}@p${f.position}`).join('  '));
  console.log('[CONFIRM] dialogs:');
  confirmMsgs.forEach((m) => console.log('   •', JSON.stringify(m.slice(0, 260))));
  await shot(page, 'swap_reversed');
  const renumberConfirm = confirmMsgs.find((m) => /Renumber/.test(m)) || '';
  const swapOk = swapStatus.order === '5→1 (reversed)'
    && swapStatus.swapLabel === '⇄ Restore path order'
    && swapped.every((f, j) => f.name === `${GROUP} ${j + 1}` && f.position === 5 - j);
  // The semantic caveat must be stated in as many words.
  const caveatOk = /physical daisy chain/.test(renumberConfirm)
    && /NOT its position along the drawn path/.test(renumberConfirm)
    && /KEEP their DMX addresses/.test(renumberConfirm);

  // ── SWAP BACK: restores path order ────────────────────────────────────────
  await clickCardButton(page, traceIdx, 'Restore path order');
  await sleep(700);
  await openChainFolder(page, traceIdx);
  const restoredStatus = await readChainStatus(page, traceIdx);
  const restored = await readGroupOrder(page, traceIdx);
  const hasField = await page.evaluate((idx) => 'chainSplits' in window.__params.traces[idx], traceIdx);
  console.log('\n[SWAP-BACK] status row:', JSON.stringify(restoredStatus),
    `| chainSplits field present? ${hasField}`);
  await shot(page, 'swap_restored');
  const swapBackOk = restoredStatus.order === '1..5 (path order)'
    && restoredStatus.swapLabel === '⇄ Swap start/end'
    && hasField === false
    && restored.every((f, j) => f.position === j + 1);

  // ── INVALID: a gap turns the card red and Regenerate refuses loudly ───────
  const before = await readGroupOrder(page, traceIdx);
  const dialogsBeforeInvalid = dialogs.length;
  await page.evaluate((idx) => {
    window.__params.traces[idx].chainSplits = [{ from: 3, to: 5 }];   // 1,2 uncovered
    window.renderGeneratorGUI();
  }, traceIdx);
  await openChainFolder(page, traceIdx);
  const badStatus = await readChainStatus(page, traceIdx);
  await shot(page, 'invalid_badge');
  await clickCardButton(page, traceIdx, 'Regenerate');
  await sleep(600);
  const after = await readGroupOrder(page, traceIdx);
  const refusal = dialogs.slice(dialogsBeforeInvalid).find((m) => /Chain Order splits are invalid/.test(m)) || '';
  console.log('\n[INVALID] status row:', JSON.stringify(badStatus));
  console.log('[INVALID] refusal alert:', JSON.stringify(refusal.slice(0, 200)));
  const invalidOk = badStatus.order === '⚠ INVALID — see below'
    && /positions \{1, 2\} not covered/.test(badStatus.badge || '')
    && /positions \{1, 2\} not covered/.test(refusal)
    && JSON.stringify(after) === JSON.stringify(before);   // nothing mutated

  // ── Restore pristine (deterministic zero residue). ────────────────────────
  const residue = await page.evaluate((group) => {
    const p = window.__params;
    const clone = (o) => JSON.parse(JSON.stringify(o || null));
    p.parLights = clone(window.__pristine.parLights);
    p.traces = clone(window.__pristine.traces);
    if (window.rebuildParLights) window.rebuildParLights(true);
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

  // ── Summary ───────────────────────────────────────────────────────────────
  const noise = errors.filter((e) =>
    /gui_builder|generator_chain_order|chainSplits|TypeError|is not a function/i.test(e)
    && !/\[chainSplits\]/.test(e));
  const results = {
    'base_no_splits_is_plain_path_order': baseOk,
    'operator_example_status_row_and_table': splitOk,
    'mapped_note_warns_before_renumbering': mappedNoteOk,
    'swap_writes_full_reverse_and_flips_label': swapOk,
    'renumber_confirm_states_the_semantic_caveat': caveatOk,
    'swap_back_clears_the_field_entirely': swapBackOk,
    'invalid_splits_red_badge_and_loud_refusal': invalidOk,
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
