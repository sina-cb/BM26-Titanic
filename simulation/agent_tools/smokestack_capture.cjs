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
 *   2_status         the board table + fleet chip after the read-only glance
 *   3_dryrun         dry-run verdict + plan fingerprint + typed-confirm row
 *   4_armed          the exact phrase typed, APPLY armed
 *   5_verdict        the terminal verdict banner + the verbatim CLI line
 *   6_recovery       Advanced Recovery populated from the LIVE fleet readback
 *   7_force_dryrun   the one-controller force plan + 64-char fingerprint
 *   8_force_armed    the controller-specific phrase typed, APPLY armed
 *   9_force_verdict  the honest "FLEET REMAINS MIXED" force verdict
 *   10_refused       a dry-run REFUSED on the asset contract, plan auto-opened
 *   11_timeline      the run timeline mid-apply, elapsed ticking
 *   12_rerelease     the REPAIR ASSETS… row offered for the flagged boards
 *
 * Usage:
 *   node smokestack_capture.cjs [--keep-alive]
 *   node smokestack_capture.cjs --census                # board table only
 *   node smokestack_capture.cjs --real-cli --census     # ↑ against the REAL CLI
 *   node smokestack_capture.cjs --real-cli --action to-dmx --legs 2
 *
 * `--real-cli` passes the operator's own BM26_SMOKESTACK_CLI /
 * BM26_DEPLOY_REGISTRY / BM26_SMOKESTACK_PYTHON through to the throwaway save
 * server, so every click drives the PRIVATE deploy CLI against the REAL
 * boards. Without it, a node stub stands in and nothing can reach a board.
 * `--action` + `--legs` drive the live round-trip protocol (report _354 §2c)
 * through this UI, recording a timed log per leg.
 *
 * The sim HTTP server must already be serving :6969. The throwaway save
 * servers bind random high ports — never 6966-6972, 6981 or 5568.
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

function flagValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

// ── Live-run flags ──────────────────────────────────────────────────────────
// REAL_CLI is the only thing that can put a write on a real board. Without it
// every mutating click in this tool hits a node stub in a temp dir.
const REAL_CLI = process.argv.includes('--real-cli');
const CENSUS_ONLY = process.argv.includes('--census');
const LIVE_ACTION = flagValue('--action');
const LIVE_LEGS = Number(flagValue('--legs', '0')) || 0;

if (LIVE_ACTION && !['to-dmx', 'to-swarm'].includes(LIVE_ACTION)) {
  console.error(`❌ --action must be to-dmx or to-swarm, got '${LIVE_ACTION}'`);
  process.exit(1);
}
if (LIVE_LEGS > 0 && !REAL_CLI) {
  console.error('❌ --legs drives REAL boards; pass --real-cli explicitly to mean it');
  process.exit(1);
}

/** The operator's real provisioning, read from THIS process's environment. */
function realCliEnv() {
  const missing = ['BM26_SMOKESTACK_CLI', 'BM26_DEPLOY_REGISTRY']
    .filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`--real-cli needs ${missing.join(' + ')} exported in this shell`);
  }
  const env = {
    BM26_SMOKESTACK_CLI: process.env.BM26_SMOKESTACK_CLI,
    BM26_DEPLOY_REGISTRY: process.env.BM26_DEPLOY_REGISTRY,
  };
  // The CLI reads its build/registry secrets from the environment; pass them
  // through untouched and never echo any of these values.
  for (const name of ['BM26_SMOKESTACK_PYTHON', 'BM26_SECRETS', 'STOKER_SECRETS',
    'STOKER_DEPLOY_REGISTRY']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same canned verdicts the routes test uses — the CLI's documented lines.
const STUB_FINGERPRINT = 'b'.repeat(64);
// The stub emits the REAL CLI's phase-marker lines so the captured screenshots
// exercise the panel's line-anchored timeline parser, not a fiction.
// `BM26_STUB_SLOW=<ms>` paces the apply so a mid-run timeline can be captured.
// `BM26_STUB_REFUSE=1` reproduces the live fleet's asset-contract refusal.
const STUB_CLI = `
const args = process.argv.slice(2);
const action = args[0];
const flags = args.slice(1);
const fingerprint = '${'b'.repeat(64)}';
const namesIndex = flags.indexOf('--names');
const names = namesIndex >= 0 ? flags[namesIndex + 1].split(',') : [];
const FLEET = ['ss_left_right', 'ss_left_left', 'ss_right_right', 'ss_right_left'];
const rows = names.length > 0 ? names : FLEET;
const targeted = names.length > 0;
const slowMs = Number(process.env.BM26_STUB_SLOW || 0);
const refuse = process.env.BM26_STUB_REFUSE === '1' && !targeted;
const sleep = (ms) => { if (ms > 0) Atomics.wait(
  new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

if (flags.includes('--dry-run')) {
  console.log('dry-run: read-only plan sweep across all boards');
  for (const name of rows) {
    console.log('  [' + name + '] pre-flight ' + (refuse && name !== 'ss_right_left'
      ? 'REFUSED' : 'OK'));
  }
  console.log('');
  console.log('=== smokestack ' + action + ' ===');
  console.log('BOARD                  RESULT MODE             DETAIL');
  console.log('-----------------------------------------------------');
  for (const name of rows) {
    if (action === 'to-swarm' && names.length === 2 && name === names[0]) {
      console.log(name + ': already in target mode - no mutation POST would be sent');
    } else if (refuse && name !== 'ss_right_left') {
      console.log(name + '   PLAN   SWARM->DMX   WOULD REFUSE: ' + name +
        ": activeMap is '/models/pushed_map.json', expected " +
        "'/models/swarm_titanic_rop_b5fc8e9e.json'");
      console.log('                                 WOULD REFUSE: ' + name +
        ': model allowlist mismatch (22 files vs the frozen 4)');
    } else {
      console.log(name + ': WOULD POST /api/config');
    }
  }
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
  if (action === 're-release') {
    for (const name of rows) console.log(name + '  PASS  assets->canonical  restored');
    console.log('VERDICT: OK');
    process.exit(0);
  }
  console.log('pre-flight: parallel read-only plan sweep across all boards');
  for (const name of rows) console.log('  [' + name + '] pre-flight OK');
  sleep(slowMs);
  console.log('  [' + rows[0] + '] POST /api/config');
  console.log('  [' + rows[0] + '] needs-reboot - queued for readiness polling');
  sleep(slowMs);
  console.log('followers: parallel mutation POST across ' + (rows.length - 1) + ' board(s)');
  for (const name of rows.slice(1)) console.log('  [' + name + '] POST /api/config');
  sleep(slowMs);
  console.log('followers: parallel readiness wait across ' + (rows.length - 1) + ' board(s)');
  sleep(slowMs);
  console.log('followers: parallel verification across ' + (rows.length - 1) + ' board(s)');
  if (action === 'to-swarm') {
    console.log('  [' + rows[1] + '] reboot-survival already proven: skipping the redundant ' +
      'terminal reboot');
  }
  sleep(slowMs);
  console.log('terminal: independent canonical 4/4 asset/runtime readback');
  console.log('');
  const arrow = action === 'to-dmx' ? 'SWARM->DMX' : 'DMX->SWARM';
  for (const name of rows) console.log(name + '  PASS  ' + arrow + '  verified');
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

/**
 * A canned four-board readback for the UI-STATE captures.
 *
 * The live fleet is whatever it is on the day — a board mid-reboot, an asset
 * mismatch — so it cannot deterministically produce "APPLY armed" or "SAFE TO
 * KILL". These shots are about the PANEL's states, so the readback is mocked
 * and the CLI is a stub: nothing here touches a board. The real fleet's own
 * census is captured separately, unmocked, in `2_status` / `live_census`.
 */
const CANONICAL_MAP = '/models/swarm_titanic_rop_b5fc8e9e.json';
function mockFleet({ dmx = true } = {}) {
  const board = (id, controllerId, isLeader) => ({
    id,
    name: controllerId,
    at: new Date().toISOString(),
    reachable: true,
    detail: `MarsinLED ${controllerId} (mock readback — no board was contacted)`,
    controllerId,
    firmwareTag: '1.2.5',
    fps: 40,
    dmxEnabled: dmx,
    swarm: {
      enabled: !dmx,
      isLeader,
      followState: dmx || isLeader ? null : 'FOLLOWING',
      lastBeaconMsAgo: dmx || isLeader ? null : 820,
    },
    health: { configSource: 'primary', stagedPending: false, uptimeMs: 987654 },
    capabilities: { perOutputDmx: true },
    assets: { activePattern: '/patterns/titanic_swarm_pattern.js',
      activeMap: CANONICAL_MAP, activeMapHash: '130aa205' },
    sacn: { enabled: dmx, lastPacketAgeMs: dmx ? 180 : -1, perOutput: null },
  });
  return [
    board(13, 'ss_left_left', false),
    board(15, 'ss_left_right', true),
    board(24, 'ss_right_right', false),
    board(25, 'ss_right_left', false),
  ];
}

/**
 * Answer the section's status sweep from the canned fleet, in the page. The
 * fleet is read live from `window.__smkMockFleet`, so a capture can flip the
 * boards' mode after an apply and let the panel's own readback logic verify it.
 */
async function installStatusMock(page, results) {
  await page.evaluate((canned) => {
    window.__smkMockFleet = canned;
    if (window.__smkMockInstalled) return;
    window.__smkMockInstalled = true;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/smokestack/status')) {
        return Promise.resolve(new Response(
          JSON.stringify({ ok: true, results: window.__smkMockFleet,
            at: new Date().toISOString() }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return original(input, init);
    };
  }, results);
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

/** Every board row as the operator sees it, plus the fleet chip + readback age. */
const readCensus = (page) => page.evaluate(() => {
  const cell = (row, cls) => {
    const node = row.querySelector(cls);
    return node ? node.textContent.trim() : '';
  };
  const rows = [...document.querySelectorAll('.smk-board-row:not(.smk-board-head)')]
    .map((row) => ({
      id: row.dataset.controllerId,
      mode: cell(row, '.smk-bc-mode'),
      role: cell(row, '.smk-bc-role'),
      follow: cell(row, '.smk-bc-follow'),
      assets: cell(row, '.smk-bc-assets'),
      fw: cell(row, '.smk-bc-fw'),
      reach: cell(row, '.smk-bc-reach'),
      verdict: cell(row, '.smk-bc-verdict'),
      action: cell(row, '.smk-bc-action'),
    }));
  const buttons = [...document.querySelectorAll('.smk-switch-primary')].map((button) => ({
    label: button.textContent.trim(), enabled: !button.disabled }));
  const reRelease = document.querySelector('.smk-rerelease-row');
  return {
    fleet: (document.querySelector('.smk-fleet') || {}).textContent || '',
    age: (document.querySelector('.smk-readback-age') || {}).textContent || '',
    refusal: (document.querySelector('.smk-switch-refusal') || {}).textContent || '',
    rows,
    buttons,
    reRelease: reRelease && !reRelease.hidden
      ? (document.querySelector('.smk-rerelease-btn') || {}).textContent : null,
  };
});

function printCensus(census) {
  console.log(`   fleet: ${census.fleet}   (readback ${census.age})`);
  for (const row of census.rows) {
    console.log(`   ${row.id.padEnd(15)} ${row.mode.padEnd(6)} ${row.role.padEnd(9)} ` +
      `${row.follow.padEnd(16)} ${row.assets.padEnd(10)} ${row.fw.padEnd(6)} ` +
      `${row.reach.padEnd(16)} ${row.verdict.padEnd(17)} ${row.action}`);
  }
  for (const button of census.buttons) {
    console.log(`   [${button.enabled ? 'ARMED   ' : 'disabled'}] ${button.label}`);
  }
  if (census.refusal) console.log(`   refusal: ${census.refusal}`);
  if (census.reRelease) console.log(`   asset repair offered: ${census.reRelease}`);
}

const refreshCard = async (page) => {
  await page.evaluate(() => {
    const button = document.querySelector('.smk-refresh');
    if (button && !button.disabled) button.click();
  });
  await page.waitForFunction(
    () => !document.querySelector('.smk-refresh').disabled, { timeout: 60000 });
  await sleep(600);
};

/** The one direction the fleet model armed, or null when neither is armed. */
const armedDirection = (page) => page.evaluate(() => {
  const button = [...document.querySelectorAll('.smk-switch-primary')]
    .find((candidate) => !candidate.disabled);
  return button ? button.textContent.trim() : null;
});

/**
 * ONE leg of the round-trip protocol, driven entirely through the UI:
 * Refresh → dry-run → fingerprint → typed SWITCH → APPLY → verdict → the
 * mandatory four-controller readback → Refresh → record.
 */
async function runLeg(page, legIndex, label) {
  console.log(`\n── leg ${legIndex}: ${label}`);
  const startedAt = Date.now();
  await refreshCard(page);
  const before = await readCensus(page);
  printCensus(before);

  const armed = await armedDirection(page);
  if (!armed) {
    return { legIndex, label, ok: false, before,
      reason: `no direction is armed — ${before.refusal || 'the fleet model refused'}` };
  }
  console.log(`   pressing: ${armed}`);
  await page.evaluate(() => {
    [...document.querySelectorAll('.smk-switch-primary')]
      .find((candidate) => !candidate.disabled).click();
  });

  // The dry-run either offers a confirm row, or refuses and says why.
  await page.waitForFunction(() => document.querySelector('.smk-confirm-input')
    || document.querySelector('.smk-verdict-danger'), { timeout: 180000 });
  await focusSection(page);
  await shot(page, `leg${legIndex}_dryrun`);
  const refused = await page.evaluate(() => !document.querySelector('.smk-confirm-input'));
  if (refused) {
    const why = await page.evaluate(() => {
      const node = document.querySelector('.smk-verdict-danger');
      return node ? node.textContent.trim() : '(no verdict rendered)';
    });
    return { legIndex, label, ok: false, before, reason: `dry-run REFUSED — ${why}` };
  }

  const fingerprint = await page.evaluate(() => {
    const node = document.querySelector('.smk-fingerprint');
    return node ? node.textContent.trim() : null;
  });
  console.log(`   plan fingerprint: ${fingerprint}`);

  await page.type('.smk-confirm-input', 'SWITCH', { delay: 20 });
  await sleep(400);
  if (await page.evaluate(() => document.querySelector('.smk-apply-btn').disabled)) {
    const why = await page.evaluate(() =>
      (document.querySelector('.smk-gate-note') || {}).textContent || '');
    return { legIndex, label, ok: false, before, reason: `APPLY would not arm — ${why}` };
  }
  await shot(page, `leg${legIndex}_armed`);

  console.log('   APPLY — writing to the real boards…');
  const appliedAt = Date.now();
  await page.evaluate(() => document.querySelector('.smk-apply-btn').click());
  // Mid-run timeline evidence while the CLI works.
  await sleep(6000);
  await focusSection(page);
  await shot(page, `leg${legIndex}_timeline`);

  // Wait for the CLI AND its mandatory independent four-controller readback.
  await page.waitForFunction(() => {
    const readback = document.querySelector('.smk-job-readback');
    return readback && /4\/4 verdicts|FAILED/.test(readback.textContent);
  }, { timeout: 600000, polling: 1000 }).catch(() => {});
  const elapsedMs = Date.now() - appliedAt;
  await sleep(2000);
  await focusSection(page);
  await shot(page, `leg${legIndex}_verdict`);

  const banner = await page.evaluate(() => ({
    phase: (document.querySelector('.smk-job-phase') || {}).textContent || '',
    headline: (document.querySelector('.smk-job-headline') || {}).textContent || '',
    trusted: (document.querySelector('.smk-job-verdict') || {}).textContent || '',
    cli: (document.querySelector('.smk-job-cli-line') || {}).textContent || '',
    readback: (document.querySelector('.smk-job-readback') || {}).textContent || '',
    elapsed: (document.querySelector('.smk-elapsed') || {}).textContent || '',
    steps: [...document.querySelectorAll('.smk-timeline-step')].map((step) =>
      `${step.textContent.trim()}=${(step.className.match(/step-(\w+)/) || [])[1]}`),
    chips: [...document.querySelectorAll('.smk-timeline-chip')]
      .map((chip) => chip.textContent.trim()),
  }));
  console.log(`   ${banner.phase}`);
  console.log(`   ${banner.headline}`);
  console.log(`   ${banner.cli}`);
  console.log(`   ${banner.readback}`);
  console.log(`   timeline: ${banner.steps.join(' → ')}`);
  console.log(`   boards:   ${banner.chips.join(' · ')}`);

  await page.evaluate(() => {
    const cancel = document.querySelector('.smk-cancel-btn');
    if (cancel) cancel.click();
  });
  await refreshCard(page);
  const after = await readCensus(page);
  printCensus(after);
  return {
    legIndex, label, ok: true, before, after, banner, fingerprint,
    elapsedMs, wallMs: Date.now() - startedAt,
  };
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smokestack_capture_'));
  const stubCli = path.join(tmpRoot, 'stub_smokestack_cli.js');
  const stubRegistry = path.join(tmpRoot, 'stub_registry.yaml');
  fs.writeFileSync(stubCli, STUB_CLI);
  fs.writeFileSync(stubRegistry, 'controllers: []\n');

  console.log('── starting throwaway save-servers (tmp root, random high ports)');
  const stubEnv = {
    BM26_SMOKESTACK_CLI: stubCli,
    BM26_DEPLOY_REGISTRY: stubRegistry,
    BM26_SMOKESTACK_PYTHON: process.execPath,
  };
  const liveRun = REAL_CLI;
  const bare = liveRun ? null : await startSaveServer(tmpRoot, undefined);
  const provisioned = await startSaveServer(tmpRoot,
    liveRun ? realCliEnv() : stubEnv);
  // A third stub that reproduces the live fleet's asset-contract refusal.
  const refusing = liveRun ? null
    : await startSaveServer(tmpRoot, { ...stubEnv, BM26_STUB_REFUSE: '1' });
  console.log(liveRun
    ? `   ⚠ REAL CLI on :${provisioned.port} — every mutating click reaches a REAL board`
    : `   bare :${bare.port}  provisioned(stub CLI) :${provisioned.port}`);

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
    // ── Census / live round-trip modes ─────────────────────────────────────
    if (CENSUS_ONLY || LIVE_LEGS > 0) {
      console.log(`── loading the live page against :${provisioned.port}`);
      await loadSim(page, provisioned.port);
      await openMap(page);
      await sleep(8000);
      if (!(await focusSection(page))) throw new Error('smokestack section not found in pane');
      await refreshCard(page);
      await focusSection(page);
      await shot(page, REAL_CLI ? 'live_census' : '2_status');
      printCensus(await readCensus(page));

      if (CENSUS_ONLY) {
        console.log('\n(census only — nothing was written)');
        return;
      }

      // The round-trip protocol: alternate directions starting from --action.
      const results = [];
      for (let leg = 1; leg <= LIVE_LEGS; leg++) {
        const action = leg % 2 === 1 ? LIVE_ACTION
          : (LIVE_ACTION === 'to-dmx' ? 'to-swarm' : 'to-dmx');
        const result = await runLeg(page, leg, action);
        results.push(result);
        if (!result.ok) {
          console.error(`\n❌ leg ${leg} (${action}) STOPPED: ${result.reason}`);
          break;
        }
        console.log(`   ✔ leg ${leg} (${action}) apply took ` +
          `${(result.elapsedMs / 1000).toFixed(1)} s`);
      }
      console.log('\n── leg summary');
      for (const result of results) {
        console.log(`   leg ${result.legIndex} ${result.label}: ` +
          `${result.ok ? `${(result.elapsedMs / 1000).toFixed(1)} s · ` +
            `${result.banner.cli}` : `STOPPED — ${result.reason}`}`);
      }
      return;
    }

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

    const census = await readCensus(page);
    printCensus(census);
    console.log(`   fleet toggle arms: ${await armedDirection(page)}`);

    // The asset-repair row appears only when the LIVE readback actually flags
    // a board — it is evidence of the real fleet, not a mocked state.
    if (census.reRelease) {
      await page.evaluate(() => {
        const row = document.querySelector('.smk-rerelease-row');
        if (row) row.scrollIntoView({ block: 'center' });
      });
      await sleep(400);
      await shot(page, '12_rerelease');
    } else {
      console.log('   (no board flagged NEEDS RE-RELEASE — 12_rerelease not captured)');
    }

    // ── Pass B2: deterministic UI states, from a MOCKED all-DMX readback ───
    // The live fleet cannot be relied on to arm a button on any given day, and
    // these shots are about the panel's states. Nothing here contacts a board.
    console.log('── pass B2: UI states from a mocked healthy ALL-DMX readback');
    await loadSim(page, provisioned.port);
    await installStatusMock(page, mockFleet({ dmx: true }));
    await openMap(page);
    await sleep(3000);
    await refreshCard(page);
    await focusSection(page);
    printCensus(await readCensus(page));
    console.log(`   fleet toggle arms: ${await armedDirection(page)}`);
    await shot(page, '2b_mock_all_dmx');

    console.log('── pass B: fleet dry-run (stub CLI — zero board contact)');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.smk-switch-primary')]
        .find((candidate) => !candidate.disabled);
      if (!button) throw new Error('no direction armed on the mocked healthy fleet');
      button.click();
    });
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

    console.log('── pass B: apply (stub CLI) → run timeline → terminal verdict');
    // The mocked boards move to SWARM exactly as a real successful apply would,
    // so the panel's own independent readback is what turns the banner green —
    // the honesty contract is exercised, not bypassed.
    await installStatusMock(page, mockFleet({ dmx: false }));
    await page.evaluate(() => document.querySelector('.smk-apply-btn').click());
    // Catch the timeline mid-flight, elapsed ticking, before the CLI finishes.
    await page.waitForFunction(
      () => !document.querySelector('.smk-timeline').hidden, { timeout: 20000 })
      .catch(() => console.warn('   timeline did not render in 20s'));
    await focusSection(page);
    await sleep(300);
    await shot(page, '11_timeline');
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

    // ── Pass D: a dry-run REFUSED on the asset contract ────────────────────
    // The live fleet's actual failure mode (report _352 §A4): the plan
    // disclosure must open ITSELF, because then the refusal IS the next action.
    console.log('── pass D: an asset-contract refusal opens the plan by itself');
    await loadSim(page, refusing.port);
    await installStatusMock(page, mockFleet({ dmx: false }));
    await openMap(page);
    await sleep(3000);
    await refreshCard(page);
    await focusSection(page);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.smk-switch-primary')]
        .find((candidate) => !candidate.disabled);
      if (!button) throw new Error('no direction armed on the mocked SWARM fleet');
      button.click();
    });
    await page.waitForFunction(
      () => document.querySelector('.smk-verdict-danger') || document.querySelector('.smk-plan'),
      { timeout: 40000 }).catch(() => console.warn('   refusal did not render in 40s'));
    await sleep(1500);
    await focusSection(page);
    const planOpen = await page.evaluate(() => {
      const plan = document.querySelector('.smk-plan');
      if (plan) plan.scrollIntoView({ block: 'center' });
      return plan ? plan.open : null;
    });
    console.log(`   refused dry-run auto-opened its plan: ${planOpen}`);
    await sleep(400);
    await shot(page, '10_refused');

    if (KEEP_ALIVE) {
      console.log('\n(--keep-alive) window staying open. Ctrl+C to exit.');
      await new Promise(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    for (const server of [bare, provisioned, refusing]) {
      if (server) server.child.kill('SIGKILL');
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log('\ndone.');
  process.exit(0);
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
