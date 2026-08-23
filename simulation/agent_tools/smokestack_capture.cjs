/**
 * smokestack_capture.cjs — screenshot evidence for the controller pane's
 * Smokestack DMX ⇄ swarm section (src/gui/smokestack_panel.js).
 *
 * agent_render.cjs can't open the mapping pane or drive the switch flow, so
 * this dedicated repeatable tool does. It reads the LIVE sim page (:6969) but
 * points the page's save endpoint at THROWAWAY save-server instances started
 * here on random high ports, with:
 *   - a tmp SIM_SAVE_SERVER_ROOT (no real scene file is ever written), and
 *   - a NODE STUB standing in for the private deploy CLI (BM26_SMOKESTACK_*),
 * so NOTHING in this capture can mutate a real board — the dry-run/apply
 * clicks exercised below run the stub, and the only real-network traffic is
 * the section's own read-only status glance (GET /api/status + /api/config),
 * exactly what an operator opening the pane triggers.
 *
 * Captures (→ .agent_renders/smokestack_*.png):
 *   1_unprovisioned  the honest "deployment source not provisioned" state
 *   2_status         board rows + fleet chip after the read-only glance
 *   3_dryrun         dry-run console + plan verdict + typed-confirm row
 *   4_armed          the exact phrase typed, APPLY armed
 *   5_verdict        the terminal verdict banner (stub CLI)
 *   6_recovery       Advanced Recovery populated from the LIVE fleet readback
 *   7_force_dryrun   the one-controller force plan + 64-char fingerprint
 *   8_force_armed    the controller-specific phrase typed, APPLY armed
 *   9_force_verdict  the honest "FLEET REMAINS MIXED" force verdict
 *
 * Usage:  node smokestack_capture.cjs [--keep-alive]
 * The sim HTTP server must already be serving :6969.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const SIM_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl';
const OUTPUT_DIR = path.join(__dirname, '..', '..', '.agent_renders');
const SAVE_SERVER = path.join(__dirname, '..', 'server', 'save-server.js');
const KEEP_ALIVE = process.argv.includes('--keep-alive');
const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same canned verdicts the routes test uses — the CLI's documented lines.
const STUB_FINGERPRINT = 'b'.repeat(64);
const STUB_CLI = `
const args = process.argv.slice(2);
const action = args[0];
const flags = args.slice(1);
const fingerprint = '${'b'.repeat(64)}';
const namesIndex = flags.indexOf('--names');
const names = namesIndex >= 0 ? flags[namesIndex + 1].split(',') : [];
const rows = names.length > 0 ? names
  : ['ss_left_left', 'ss_left_right', 'ss_right_right', 'ss_right_left'];
console.log('=== smokestack ' + action + ' ===');
console.log('BOARD                  RESULT MODE             DETAIL');
console.log('----------------------------------------------------------------');
for (const name of rows) {
  if (flags.includes('--dry-run') && action === 'to-swarm' && names.length === 2
      && name === names[0]) {
    console.log(name + ': already in target mode - no mutation POST would be sent');
  } else if (flags.includes('--dry-run')) {
    console.log(name + ': WOULD POST /api/config');
  } else {
    console.log(name + '  OK  plan valid (2 strands)');
  }
}
if (flags.includes('--dry-run')) {
  console.log('');
  console.log('VERDICT: DRY RUN - no changes made');
  console.log('PLAN FINGERPRINT: ' + fingerprint);
  process.exit(0);
}
if (flags.includes('--yes')) {
  const fingerprintIndex = flags.indexOf('--plan-fingerprint');
  if (fingerprintIndex < 0 || flags[fingerprintIndex + 1] !== fingerprint) {
    console.log('VERDICT: REFUSED PLAN FINGERPRINT - NO board was mutated');
    process.exit(1);
  }
  console.log('reboot-survival canary: ' + rows[rows.length - 1] + ' came back OK');
  console.log('');
  console.log(action === 'to-swarm' ? 'VERDICT: SAFE TO KILL NETWORK' : 'VERDICT: OK');
  process.exit(0);
}
process.exit(2);
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function startSaveServer(tmpRoot, extraEnv) {
  const port = await freePort();
  const env = { ...process.env, SIM_SAVE_SERVER_PORT: String(port),
    SIM_SAVE_SERVER_ROOT: tmpRoot, ...extraEnv };
  if (!extraEnv) {
    delete env.BM26_SMOKESTACK_CLI;
    delete env.BM26_DEPLOY_REGISTRY;
    delete env.BM26_SMOKESTACK_PYTHON;
  }
  const child = spawn(process.execPath, [SAVE_SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('save-server not up in 10s')), 10_000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (/listening on/.test(buf)) { clearTimeout(to); resolve(); }
    });
  });
  return { child, port };
}

async function shot(page, name) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const out = path.join(OUTPUT_DIR, `smokestack_${name}_${ts}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`   saved ${out}`);
}

async function loadSim(page, savePort) {
  // Keep the pane's own reachability auto-sweep OFF so the only traffic this
  // capture puts on the wire is the smokestack glance itself.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('bm26.map.controllerStatusAuto', '0'); } catch (e) { /* n/a */ }
  });
  page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
  await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (!o) return true;
    const s = getComputedStyle(o);
    return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
  }, { timeout: 90000 }).catch(() => console.warn('  loading overlay lingered'));
  await page.waitForFunction(
    () => typeof window.toggleControllerMapPanel === 'function' && window.serverConfig,
    { timeout: 30000 });
  // Point the page's save endpoint at the throwaway server for this pass.
  await page.evaluate((port) => { window.serverConfig.save_port = port; }, savePort);
  await sleep(2500);
}

const openMap = (page) => page.evaluate(() => {
  const panel = document.getElementById('controller-map-panel');
  if (panel.classList.contains('hidden')) window.toggleControllerMapPanel();
});

const focusSection = (page) => page.evaluate(() => {
  const section = document.querySelector('.smk-group');
  if (section) section.scrollIntoView({ block: 'center' });
  return !!section;
});

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smokestack_capture_'));
  const stubCli = path.join(tmpRoot, 'stub_smokestack_cli.js');
  const stubRegistry = path.join(tmpRoot, 'stub_registry.yaml');
  fs.writeFileSync(stubCli, STUB_CLI);
  fs.writeFileSync(stubRegistry, 'controllers: []\n');

  console.log('── starting throwaway save-servers (tmp root, random high ports)');
  const bare = await startSaveServer(tmpRoot, undefined);
  const provisioned = await startSaveServer(tmpRoot, {
    BM26_SMOKESTACK_CLI: stubCli,
    BM26_DEPLOY_REGISTRY: stubRegistry,
    BM26_SMOKESTACK_PYTHON: process.execPath,
  });
  console.log(`   bare :${bare.port}  provisioned(stub CLI) :${provisioned.port}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${VIEWPORT.width + 40},${VIEWPORT.height + 120}`,
    ],
  });
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.setViewport(VIEWPORT);

  try {
    // ── Pass A: unprovisioned save server → the honest refusal banner ──────
    console.log('── pass A: unprovisioned state');
    await loadSim(page, bare.port);
    await openMap(page);
    await sleep(5000); // provision fetch + status glance settle
    if (!(await focusSection(page))) throw new Error('smokestack section not found in pane');
    await sleep(400);
    await shot(page, '1_unprovisioned');

    // ── Pass B: provisioned (stub CLI) → glance + full switch flow ─────────
    console.log('── pass B: provisioned (stub CLI) — glance');
    await loadSim(page, provisioned.port);
    await openMap(page);
    await sleep(7000); // glance sweep: up to 2×1.2 s per board, 4 in parallel
    if (!(await focusSection(page))) throw new Error('smokestack section not found in pane');
    await sleep(400);
    await shot(page, '2_status');

    const fleetLabel = await page.evaluate(
      () => document.querySelector('.smk-switch-primary').textContent);
    console.log(`   fleet toggle offers: ${fleetLabel}`);

    console.log('── pass B: fleet dry-run (stub CLI — zero board contact)');
    await page.evaluate(() => document.querySelector('.smk-switch-primary').click());
    await page.waitForSelector('.smk-confirm-input', { timeout: 20000 });
    await focusSection(page);
    await sleep(400);
    await shot(page, '3_dryrun');

    console.log('── pass B: typed confirm arms APPLY');
    await page.type('.smk-confirm-input', 'SWITCH', { delay: 20 });
    await sleep(300);
    const armed = await page.evaluate(
      () => !document.querySelector('.smk-apply-btn').disabled);
    console.log(`   APPLY armed: ${armed}`);
    await shot(page, '4_armed');

    console.log('── pass B: apply (stub CLI) → terminal verdict');
    await page.evaluate(() => document.querySelector('.smk-apply-btn').click());
    await page.waitForFunction(() => {
      const v = document.querySelector('.smk-verdict-safe, .smk-verdict-danger, .smk-verdict-plan');
      return v && v.textContent.length > 0;
    }, { timeout: 40000 });
    await sleep(8000); // post-apply glance refresh settles
    await focusSection(page);
    await sleep(400);
    const verdictText = await page.evaluate(() => {
      const v = document.querySelector('.smk-job-headline');
      return v ? v.textContent : '(none)';
    });
    console.log(`   verdict banner: ${verdictText.slice(0, 120)}`);
    await shot(page, '5_verdict');

    // ── Pass C: Advanced Recovery — force ONE controller ───────────────────
    // Everything here is derived from the LIVE four-controller readback the
    // section just took; the CLI it drives is still the throwaway stub.
    console.log('── pass C: Advanced Recovery, populated from the live fleet');
    await page.evaluate(() => {
      const cancel = document.querySelector('.smk-cancel-btn');
      if (cancel) cancel.click();
      const details = document.querySelector('details.smk-recovery');
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      const radio = [...details.querySelectorAll('input[type=radio]')]
        .find((input) => input.value === 'ss_left_left');
      radio.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
      document.querySelector('details.smk-recovery').scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    const recoverySummary = await page.evaluate(() => {
      const card = document.querySelector('.smk-recovery-card');
      return card ? card.innerText.split('\n').join(' | ').slice(0, 400) : '(no card)';
    });
    console.log(`   card: ${recoverySummary}`);
    await shot(page, '6_recovery');

    console.log('── pass C: FORCE TO DMX dry-run (stub CLI)');
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.smk-recovery-btn')];
      buttons.find((button) => /FORCE TO DMX/.test(button.textContent)).click();
    });
    await page.waitForSelector('.smk-recovery-card .smk-confirm-input', { timeout: 40000 });
    await page.evaluate(() => {
      document.querySelector('details.smk-recovery').scrollIntoView({ block: 'center' });
    });
    await sleep(600);
    await shot(page, '7_force_dryrun');

    console.log('── pass C: the controller-specific phrase arms APPLY');
    await page.type('.smk-recovery-card .smk-confirm-input', 'FORCE DMX ss_left_left',
      { delay: 20 });
    await sleep(400);
    const forceArmed = await page.evaluate(
      () => !document.querySelector('.smk-recovery-card .smk-apply-btn').disabled);
    console.log(`   force APPLY armed: ${forceArmed}`);
    await shot(page, '8_force_armed');

    console.log('── pass C: force apply (stub CLI) → honest one-controller verdict');
    await page.evaluate(
      () => document.querySelector('.smk-recovery-card .smk-apply-btn').click());
    await page.waitForFunction(() => {
      const banner = document.querySelector('.smk-job-headline');
      return banner && /TARGET/.test(banner.textContent);
    }, { timeout: 60000 }).catch(() => console.warn('   force banner did not settle in 60s'));
    await sleep(8000);
    await page.evaluate(() => {
      document.querySelector('details.smk-recovery').scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    const forceVerdict = await page.evaluate(() => {
      const banner = document.querySelector('.smk-job-headline');
      const trusted = document.querySelector('.smk-job-verdict');
      return `${banner ? banner.textContent : '(none)'} || ${trusted ? trusted.textContent : ''}`;
    });
    console.log(`   force verdict: ${forceVerdict.slice(0, 200)}`);
    await shot(page, '9_force_verdict');

    if (KEEP_ALIVE) {
      console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
      await new Promise(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    bare.child.kill('SIGKILL');
    provisioned.child.kill('SIGKILL');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log('\ndone.');
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
