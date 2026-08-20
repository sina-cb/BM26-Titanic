/**
 * group_lock_verify.cjs — live verification for GROUP LOCK + generator + LED
 * group master (slice 24). Renderer-only (see_the_world skill): launches its OWN
 * Chromium against the ALREADY-RUNNING stack on :6969 and NEVER starts/stops a
 * server. autosave is stubbed to a no-op so nothing here writes the scene file.
 *
 * Proves, end-to-end through the REAL GUI code path (DOM numeric inputs):
 *   (a) a 🔒 Lock button exists in a group toolbar,
 *   (b) a locked GENERIC group moves rigidly (every member displaced by the same
 *       delta, non-zero relative offsets intact),
 *   (c) a locked TE Sign group moves as a whole with A ≡ B preserved,
 *   (c2) a freshly GENERATED sign is born locked,
 *   (d) an LED-strand group master brightness actually scales the pixels.
 *
 * Usage:  node group_lock_verify.cjs [--keep-alive]
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

async function shot(page, name) {
  const p = path.join(OUT, `glock_${stamp()}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false, defaultViewport: VP,
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
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0 && !!window.renderParGUI;
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

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  // Reach the REAL params singleton via a dynamic import of the app's own
  // state module (ES modules are per-URL singletons, so this is the same object
  // the app mutates). Park it on window.__params for the probes below.
  // GUARD: stub autosave so NOTHING this script does writes the operator's scene.
  await page.evaluate(async (origin) => {
    const mod = await import(`${origin}/simulation/src/core/state.js`);
    window.__params = mod.params;
    window.__origAutoSave = window.debounceAutoSave;
    window.debounceAutoSave = () => {};
  }, ORIGIN);

  // ── (b) Generic locked-group rigid move ──────────────────────────────────
  // Synthesize a 3-fixture group at DIFFERENT positions (real editable pars),
  // lock it via the real Lock button, then drive a numeric Position X edit on
  // member 0 through the DOM. Rigid ⇒ all three shift by the same delta.
  const setup = await page.evaluate(() => {
    const p = window.__params;
    const G = '__locktest__';
    // Remove any prior run's temp group.
    p.parLights = p.parLights.filter((c) => c.group !== G);
    const mk = (n, x, y, z) => ({
      group: G, name: n, fixtureType: 'UkingPar', color: '#33ccff',
      intensity: 6, angle: 20, penumbra: 0.5, enabled: true, brightness: 100,
      x, y, z, rotX: 0, rotY: 0, rotZ: 0,
      dmxUniverse: 0, dmxAddress: 0, controllerIp: '',
      controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0, traceGenerated: false,
    });
    p.parLights.push(mk('LockTest 1', -6, 6, 10), mk('LockTest 2', 0, 8, 10), mk('LockTest 3', 6, 6, 10));
    window.rebuildParLights();
    window.renderParGUI();
    return true;
  });
  console.log('\n[setup] temp group created:', setup);
  await sleep(400);

  // Click the __locktest__ group's Lock button (real UI).
  const locked = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.title')];
    const gt = titles.find((t) => /^__locktest__ \(\d+\)/.test((t.textContent || '').trim()));
    if (!gt) return { ok: false, reason: 'group folder not found' };
    gt.click(); // open
    const folder = gt.parentElement;
    const lockBtn = [...folder.querySelectorAll('button')].find((b) => /Lock/i.test(b.textContent || ''));
    if (!lockBtn) return { ok: false, reason: 'lock button not found' };
    const before = lockBtn.textContent;
    lockBtn.click();
    gt.scrollIntoView({ block: 'center' });
    return { ok: true, before, after: lockBtn.textContent, flag: !!(window.__params.groupOverrides['__locktest__'] || {}).locked };
  });
  console.log('[a] lock button:', JSON.stringify(locked));
  await sleep(400);
  await shot(page, 'a_lock_button');
  // Zoomed crop of the drawer so the 🔒 Locked button reads clearly.
  await page.screenshot({
    path: path.join(OUT, `glock_${stamp()}_a_lock_button_zoom.png`),
    clip: { x: 950, y: 240, width: 330, height: 380 },
  });

  // Record BEFORE, drive member-0 Position X +5 via DOM, record AFTER.
  const rigid = await page.evaluate(async () => {
    const snap = () => window.__params.parLights.filter((c) => c.group === '__locktest__')
      .map((c) => ({ name: c.name, x: +c.x.toFixed(4), y: +c.y.toFixed(4), z: +c.z.toFixed(4) }));
    const before = snap();
    // Open the LockTest 1 card + its Position folder, find the 'x' controller input.
    const titles = [...document.querySelectorAll('.title')];
    const card = titles.find((t) => (t.textContent || '').trim() === 'LockTest 1');
    if (!card) return { ok: false, reason: 'card missing', before };
    card.click();
    await new Promise((r) => setTimeout(r, 150));
    const cardFolder = card.parentElement;
    const posTitle = [...cardFolder.querySelectorAll('.title')].find((t) => (t.textContent || '').trim() === 'Position');
    if (posTitle) posTitle.click();
    await new Promise((r) => setTimeout(r, 100));
    const xCtrl = [...cardFolder.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim().toLowerCase() === 'x');
    const input = xCtrl && xCtrl.querySelector('input');
    if (!input) return { ok: false, reason: 'x input missing', before };
    const newX = before[0].x + 5;
    input.focus();                       // focusin (capture) snapshots prev
    input.value = String(newX);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const after = snap();
    return { ok: true, before, after };
  });
  const rigidPass = (() => {
    if (!rigid.ok) return false;
    const dx = rigid.after.map((a, i) => +(a.x - rigid.before[i].x).toFixed(4));
    // Every member shifted by the SAME delta; y/z unchanged; offsets preserved.
    const same = dx.every((d) => d === dx[0]) && dx[0] === 5;
    const yzHeld = rigid.after.every((a, i) => a.y === rigid.before[i].y && a.z === rigid.before[i].z);
    const offsets = rigid.after.map((a) => +(a.x - rigid.after[0].x).toFixed(4));
    const offBefore = rigid.before.map((a) => +(a.x - rigid.before[0].x).toFixed(4));
    const offHeld = JSON.stringify(offsets) === JSON.stringify(offBefore);
    console.log('  Δx per member:', JSON.stringify(dx), '| y/z held:', yzHeld, '| offsets held:', offHeld);
    return same && yzHeld && offHeld;
  })();
  console.log('[b] generic rigid move BEFORE:', JSON.stringify(rigid.before));
  console.log('[b] generic rigid move AFTER :', JSON.stringify(rigid.after));
  console.log('[b] RIGID MOVE PASS:', rigidPass);

  // ── (c) TE Sign locked whole-move + A ≡ B ────────────────────────────────
  const teSign = await page.evaluate(async () => {
    const p = window.__params;
    const idxs = p.parLights.map((c, i) => ({ c, i })).filter(({ c }) => /^TeSignV3/.test(c.fixtureType || ''));
    if (idxs.length < 2) return { ok: false, reason: 'no TE Sign pair' };
    const g = idxs[0].c.group;
    if (!p.groupOverrides) p.groupOverrides = {};
    if (!p.groupOverrides[g]) p.groupOverrides[g] = { enabled: true, brightness: 100 };
    p.groupOverrides[g].locked = true;                 // ensure locked
    window.renderParGUI();
    await new Promise((r) => setTimeout(r, 150));
    const tf = (c) => ({ x: c.x, y: c.y, z: c.z, rotX: c.rotX, rotY: c.rotY, rotZ: c.rotZ });
    const beforeA = tf(idxs[0].c), beforeB = tf(idxs[1].c);
    // Drive Side A's Position X by +7 through the DOM (routes via applyTeSignPlacement).
    const aName = idxs[0].c.name;
    const titles = [...document.querySelectorAll('.title')];
    const card = titles.find((t) => (t.textContent || '').trim() === aName);
    if (!card) return { ok: false, reason: `card ${aName} missing` };
    card.click();
    await new Promise((r) => setTimeout(r, 150));
    const cardFolder = card.parentElement;
    const posTitle = [...cardFolder.querySelectorAll('.title')].find((t) => (t.textContent || '').trim() === 'Position');
    if (posTitle) posTitle.click();
    await new Promise((r) => setTimeout(r, 100));
    const xCtrl = [...cardFolder.querySelectorAll('.controller')]
      .find((c) => (c.querySelector('.name')?.textContent || '').trim().toLowerCase() === 'x');
    const input = xCtrl && xCtrl.querySelector('input');
    if (!input) return { ok: false, reason: 'A x input missing' };
    const newX = beforeA.x + 7;
    input.focus();
    input.value = String(newX);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const afterA = tf(p.parLights[idxs[0].i]), afterB = tf(p.parLights[idxs[1].i]);
    const eq = JSON.stringify(afterA) === JSON.stringify(afterB);
    const moved = afterA.x === beforeA.x + 7 && afterB.x === beforeB.x + 7;
    return { ok: true, group: g, beforeA, beforeB, afterA, afterB, aEqB: eq, movedTogether: moved };
  });
  console.log('\n[c] TE Sign move:', JSON.stringify(teSign));

  // ── (c2) generator born-locked ───────────────────────────────────────────
  const born = await page.evaluate(async () => {
    const p = window.__params;
    // Clear the TE Sign lock so the born-locked assertion is meaningful.
    const gname = 'TE Sign';
    if (p.groupOverrides && p.groupOverrides[gname]) p.groupOverrides[gname].locked = false;
    window.renderParGUI();
    await new Promise((r) => setTimeout(r, 150));
    const titles = [...document.querySelectorAll('.title')];
    const btn = [...document.querySelectorAll('button')].find((b) => /\+ TE Sign/.test(b.textContent || ''));
    if (!btn) return { ok: false, reason: 'generator button not found' };
    const beforeLocked = !!(p.groupOverrides[gname] || {}).locked;
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, beforeLocked, afterLocked: !!(p.groupOverrides[gname] || {}).locked };
  });
  console.log('[c2] generator born-locked:', JSON.stringify(born));
  await page.evaluate(() => { if (window.animateCamera) window.animateCamera('front'); });
  await sleep(1200);
  await shot(page, 'c_tesign_moved');

  // ── (d) LED-strand group master dims the pixels ──────────────────────────
  // Sample the bulb instanceColor SYNCHRONOUSLY right after each rebuild (before
  // the next animation frame can repaint) so we read the static scaled color and
  // the brightness ratio is deterministic. rebuildLedStrands destroys+recreates
  // the fixtures, so re-fetch the instance each time.
  const led = await page.evaluate(() => {
    const p = window.__params;
    if (!Array.isArray(p.ledStrands) || p.ledStrands.length === 0) return { ok: false, reason: 'no strands' };
    const g = (p.ledStrands[0].group && p.ledStrands[0].group.trim()) ? p.ledStrands[0].group.trim() : 'Ungrouped';
    if (!p.ledGroupOverrides) p.ledGroupOverrides = {};
    const readSync = (brightness, enabled) => {
      p.ledGroupOverrides[g] = { enabled, brightness };
      window.rebuildLedStrands();
      const f = window.ledStrandFixtures && window.ledStrandFixtures[0];
      if (!f || !f.bulbInst || !f.bulbInst.instanceColor) return null;
      const a = f.bulbInst.instanceColor.array;
      return [+a[0].toFixed(4), +a[1].toFixed(4), +a[2].toFixed(4)];
    };
    const full = readSync(100, true);
    const half = readSync(50, true);
    const off = readSync(0, false);
    // Leave the group dimmed to 25% for the render, then let it animate.
    p.ledGroupOverrides[g] = { enabled: true, brightness: 25 };
    window.rebuildLedStrands();
    return { ok: true, group: g, full, half, off };
  });
  console.log('\n[d] LED group master (static, sync sample):', JSON.stringify(led));
  let ledDimPass = false;
  if (led.ok && led.full && led.half && led.off) {
    const mag = (c) => c[0] + c[1] + c[2];
    const ratio = mag(led.full) ? mag(led.half) / mag(led.full) : null;
    ledDimPass = ratio !== null && Math.abs(ratio - 0.5) < 0.02 && mag(led.off) === 0;
    console.log(`  full=${JSON.stringify(led.full)} half(50%)=${JSON.stringify(led.half)} off=${JSON.stringify(led.off)} | half/full ≈ ${ratio ? ratio.toFixed(3) : '?'}`);
  }
  await sleep(500);
  await shot(page, 'd_led_dimmed');

  console.log('\n=== SUMMARY ===');
  console.log('(a) lock button present:', locked.ok && /Locked/.test(locked.after || ''));
  console.log('(b) generic rigid move :', rigidPass);
  console.log('(c) TE Sign A≡B + moved:', teSign.ok && teSign.aEqB && teSign.movedTogether);
  console.log('(c2) generator born-locked:', born.ok && born.beforeLocked === false && born.afterLocked === true);
  console.log('(d) LED master dims    :', ledDimPass);
  const noise = errors.filter((e) => /gui_builder|group_lock|te_sign|TypeError|is not a function|undefined/i.test(e));
  console.log('console errors (filtered):', noise.length);
  noise.slice(0, 15).forEach((e) => console.log('  •', e.slice(0, 160)));

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
