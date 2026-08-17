/**
 * Live Touch browser ARM lifecycle regression.
 *
 * Runs the real standalone panel against an isolated, auth-required engine in
 * Performance Mode. The panel itself has no privileged CaptainPad token, so
 * this proves its public performance surface can still verify its generated
 * pixel chart, acquire its owner lease, land the canonical Live layer, then
 * cleanly hand back to Deck without changing the global Performance lock.
 *
 * Usage: node agent_tools/live_touch_arm_lifecycle_test.cjs
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const yaml = require('js-yaml');
const puppeteer = require('puppeteer');

const SIMULATION_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SIMULATION_ROOT, '..');
const ENGINE_DIR = path.join(REPO_ROOT, 'marsin_engine');
const PAGE_PATH = '/docs/ui/touch_control.html';
const TEST_OWNER_PASSWORD = 'live-touch-browser-owner';
// The sACN black hole: TEST-NET-1 (RFC 5737), reserved for documentation and
// never routed, so a datagram can only be dropped. Never a 127.x address —
// the sim's sACN receiver binds every local interface and would relay it.
const BLACKHOLE_HOST = '192.0.2.9';
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function request(base, method, route, body, token) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-CaptainPad-Session': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function writeIsolatedConfig(tempRoot) {
  const config = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8')) || {};
  // The engine refuses even an empty legacy controllers block. Route every
  // test frame to a TEST-NET-1 black hole instead (RFC 5737 — reserved for
  // documentation, never routed), so this browser test never emits to a real
  // controller. A LOOPBACK destination would NOT be a black hole: the sim's
  // sACN receiver binds every local interface, so it receives frames aimed at
  // any 127.x address and relays them on to the live rig.
  delete config.controllers;
  config.sacn = { ...(config.sacn || {}), destinations: [BLACKHOLE_HOST], multicast: false };
  config.fire_sync = { ...(config.fire_sync || {}), enabled: false };
  config.osc = { ...(config.osc || {}), enabled: false };
  config.web_client = { ...(config.web_client || {}), enabled: false };
  config.audio = { ...(config.audio || {}), enabled: false };
  config.vsn1 = { ...(config.vsn1 || {}), deployLayout: false, deployOnBoot: false };
  if ('controllers' in config || config.sacn.destinations.some(destination => destination !== BLACKHOLE_HOST)) {
    throw new Error('isolated Live Touch test config could reach a controller');
  }
  const configPath = path.join(tempRoot, 'config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
  return configPath;
}

function createStaticServer(enginePort) {
  return http.createServer((request_, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request_.url, 'http://127.0.0.1').pathname);
    } catch (error) {
      response.writeHead(400).end('invalid URL');
      return;
    }
    const filePath = path.resolve(REPO_ROOT, `.${pathname === '/' ? PAGE_PATH : pathname}`);
    const relative = path.relative(REPO_ROOT, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('outside repository');
      return;
    }
    fs.readFile(filePath, 'utf8', (error, source) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      const body = pathname.endsWith('/touch_control_wire.js')
        ? source.replaceAll(':6968', `:${enginePort}`)
        : source;
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      response.end(body);
    });
  });
}

async function closeChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-touch-browser-arm-'));
  const enginePort = await reservePort();
  const stateDir = path.join(tempRoot, 'states');
  const playlistsDir = path.join(tempRoot, 'playlists');
  const secretsPath = path.join(tempRoot, 'secrets.yaml');
  fs.mkdirSync(stateDir);
  fs.mkdirSync(playlistsDir);
  fs.writeFileSync(secretsPath, [
    `SinaAuth: ${TEST_OWNER_PASSWORD}`,
    'MishaAuth: live-touch-browser-collaborator',
    'MARITIME_TERM_FOR_SAILIOR_PASS: live-touch-browser-bringup',
    '',
  ].join('\n'));
  const configPath = writeIsolatedConfig(tempRoot);
  const engineLogs = [];
  const engine = spawn(process.execPath, [
    'engine.js', '--pattern', '13_sparkle', '--model', 'titanic', '--port', String(enginePort),
    '--dest', BLACKHOLE_HOST,
  ], {
    cwd: ENGINE_DIR,
    env: {
      ...process.env,
      BM26_CAPTAINPAD_AUTH_REQUIRED: '1',
      BM26_DISABLE_CRASH_REVERT: '1',
      BM26_DISABLE_TIMELINE: '1',
      BM26_SECRETS: secretsPath,
      BM26_ARM_LEASE_MS: '10000',
      MARSIN_CONFIG_FILE: configPath,
      MARSIN_PLAYLISTS_DIR: playlistsDir,
      MARSIN_STATE_DIR: stateDir,
      MARSIN_VSN1_DEPLOY: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  engine.stdout.on('data', chunk => engineLogs.push(chunk.toString()));
  engine.stderr.on('data', chunk => engineLogs.push(chunk.toString()));
  const staticServer = createStaticServer(enginePort);
  let browser = null;

  try {
    const engineBase = `http://127.0.0.1:${enginePort}`;
    await waitFor(async () => (await request(engineBase, 'GET', '/status')).status === 200,
      'isolated engine readiness');
    const login = await request(engineBase, 'POST', '/captainpad/auth/login', {
      passphrase: TEST_OWNER_PASSWORD,
      remember30: false,
    });
    if (login.status !== 200 || typeof login.data.token !== 'string') {
      throw new Error(`test authentication failed: ${JSON.stringify(login)}`);
    }
    const performance = await request(engineBase, 'POST', '/performance-mode', { active: true }, login.data.token);
    if (performance.status !== 200 || performance.data.active !== true) {
      throw new Error(`failed to enter test Performance Mode: ${JSON.stringify(performance)}`);
    }

    await new Promise((resolve, reject) => {
      staticServer.once('error', reject);
      staticServer.listen(0, '127.0.0.1', resolve);
    });
    const staticPort = staticServer.address().port;
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${staticPort}${PAGE_PATH}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await page.waitForFunction(() => window.__wire && window.__wire.online
      && window.TouchPixelViews && window.TouchPixelViews.canArm(), { timeout: 15_000 });
    await page.click('#arm');
    await waitFor(async () => {
      const layer = await request(engineBase, 'GET', '/layers/state');
      return layer.status === 200 && layer.data.active === 'live_touch'
        && layer.data.transition === null && layer.data.liveTouch.armed === true;
    }, 'Live Touch ARM landing');
    await page.waitForFunction(() => document.getElementById('armState').textContent === 'ARMED', {
      timeout: 15_000,
    });

    await page.click('#arm');
    await waitFor(async () => {
      const [layer, brightness] = await Promise.all([
        request(engineBase, 'GET', '/layers/state'),
        request(engineBase, 'GET', '/touch-control/brightness'),
      ]);
      return layer.status === 200 && brightness.status === 200
        && layer.data.active === 'deck' && layer.data.transition === null
        && layer.data.liveTouch.armed === false && brightness.data.active === false;
    }, 'Live Touch disarm handback');
    await page.waitForFunction(() => document.getElementById('armState').textContent === 'DISARMED', {
      timeout: 15_000,
    });
    const after = await request(engineBase, 'GET', '/performance-mode');
    if (after.status !== 200 || after.data.active !== true) {
      throw new Error(`Live Touch changed the global Performance lock: ${JSON.stringify(after)}`);
    }
    console.log('Live Touch browser ARM lifecycle PASS (auth-required Performance Mode)');
  } catch (error) {
    console.error(error.stack || error.message);
    console.error(engineLogs.join(''));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (staticServer.listening) {
      await new Promise((resolve, reject) => staticServer.close(error => error ? reject(error) : resolve()));
    }
    await closeChild(engine);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
