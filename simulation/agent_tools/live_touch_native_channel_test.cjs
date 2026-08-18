/**
 * Live Touch native-equivalent channel regression.
 *
 * This test owns a disposable Titanic engine and a raw repository static
 * server on random high ports. It serves every source byte unchanged, then
 * drives the real panel through the ReactNativeWebView bridge, the explicit
 * engine-origin/protocol query contract, the control WebSocket ARM lease, the
 * real pattern dropdown, the retained A/B transition route, and /ws/viz.
 *
 * Do not run this against a live stack. The harness always creates its own
 * config, state, playlists, ports, browser, and TEST-NET sACN destination.
 *
 * Usage (only after the page-side query protocol is integrated):
 *   node agent_tools/live_touch_native_channel_test.cjs
 */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const yaml = require('js-yaml');
const puppeteer = require('puppeteer');
const WebSocket = require('ws');

const SIMULATION_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SIMULATION_ROOT, '..');
const ENGINE_DIR = path.join(REPO_ROOT, 'marsin_engine');
const TITANIC_PLAYLISTS_DIR = path.join(
  SIMULATION_ROOT,
  'scenes',
  'titanic',
  'playlists',
);
const PAGE_PATH = '/docs/ui/touch_control.html';
const ENGINE_ORIGIN_PARAM = 'captainpad_engine_origin';
const PROTOCOL_PARAM = 'captainpad_live_touch_protocol';
const PROTOCOL_VERSION = '1';
const TEST_OWNER_PASSWORD = 'live-touch-native-channel-owner';
const BLACKHOLE_HOST = '192.0.2.9';
const TEMP_PREFIX = 'live-touch-native-channel-';
const HIGH_PORT_MIN = 30_000;
const HIGH_PORT_MAX = 59_999;
const LIVE_PORTS = new Set([6967, 6968, 6969, 6970, 6971, 6972]);
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.fbx': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.yaml': 'text/yaml; charset=utf-8',
};
const INSTRUMENT_PATTERNS = {
  '128': '128_five_colour_prism',
  '129': '129_five_colour_stations',
  '130': '130_spatial_paint',
};
const NATIVE_THEME = {
  text: '#f5f7ff',
  background: '#080b14',
  tint: '#80d8ff',
  icon: '#d6e6ff',
  surface: '#121827',
  surfaceContainerLow: '#0d1220',
  surfaceContainerLowest: '#060812',
  surfaceContainerHigh: '#202a3d',
  primary: '#80d8ff',
  onPrimary: '#00131d',
  secondary: '#aab7cf',
  tertiary: '#79e6b3',
  error: '#ff6f79',
  ghostBorder: '#4d5b73',
  ambientShadow: 'rgba(0, 0, 0, 0.45)',
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function traceEvent(trace, label, data = {}) {
  trace.events.push({
    at: new Date().toISOString(),
    label,
    ...data,
  });
}

function createArtifactDir() {
  const traceDir = path.join(os.homedir(), 'tmp');
  fs.mkdirSync(traceDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const artifactDir = path.join(traceDir, `live_touch_native_channel_${stamp}`);
  fs.mkdirSync(artifactDir);
  return artifactDir;
}

async function capturePanel(page, artifactDir, label, trace) {
  const screenshotPath = path.join(artifactDir, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  traceEvent(trace, 'representative_screenshot', {
    label,
    path: screenshotPath,
    viewport: '1280x720',
  });
  return screenshotPath;
}

async function reserveHighPort(excluded) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = crypto.randomInt(HIGH_PORT_MIN, HIGH_PORT_MAX + 1);
    if (excluded.has(port)) continue;
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      excluded.add(port);
      return port;
    } catch (error) {
      if (server.listening) {
        await new Promise(resolve => server.close(() => resolve()));
      }
      if (error && error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('could not reserve a random high loopback port');
}

async function waitFor(predicate, label, timeoutMs = 20_000, intervalMs = 50) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`${label} timed out${suffix}`);
}

async function request(base, method, route, body, sessionToken = null) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(sessionToken ? { 'X-CaptainPad-Session': sessionToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${route} returned non-JSON status ${response.status}`);
    }
  }
  return { status: response.status, data };
}

function writeIsolatedConfig(tempRoot) {
  const source = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8'));
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('engine config did not parse as an object');
  }
  const config = structuredClone(source);
  delete config.controllers;
  config.sacn = {
    ...(config.sacn || {}),
    destinations: [BLACKHOLE_HOST],
    multicast: false,
  };
  config.fire_sync = { ...(config.fire_sync || {}), enabled: false };
  config.osc = { ...(config.osc || {}), enabled: false };
  config.web_client = { ...(config.web_client || {}), enabled: false };
  config.audio = { ...(config.audio || {}), enabled: false };
  config.vsn1 = {
    ...(config.vsn1 || {}),
    deployLayout: false,
    deployOnBoot: false,
  };
  if ('controllers' in config) {
    throw new Error('isolated config retained a controller block');
  }
  if (config.sacn.destinations.some(destination => destination !== BLACKHOLE_HOST)) {
    throw new Error('isolated config can reach a non-TEST-NET sACN destination');
  }
  const configPath = path.join(tempRoot, 'config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
  return configPath;
}

function copyIsolatedPlaylists(playlistsDir) {
  const entries = fs.readdirSync(TITANIC_PLAYLISTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name) !== '.yaml') continue;
    fs.copyFileSync(
      path.join(TITANIC_PLAYLISTS_DIR, entry.name),
      path.join(playlistsDir, entry.name),
    );
  }
  if (!fs.existsSync(path.join(playlistsDir, 'ambient.yaml'))) {
    throw new Error('isolated playlists are missing ambient.yaml');
  }
}

function createStaticServer() {
  return http.createServer((incoming, response) => {
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('read-only static server');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(incoming.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('invalid URL');
      return;
    }
    if (pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    let requestedPath = pathname === '/' ? PAGE_PATH : pathname;
    if (requestedPath === '/simulation/' || requestedPath === '/simulation') {
      requestedPath = '/simulation/index.html';
    }
    const filePath = path.resolve(REPO_ROOT, `.${requestedPath}`);
    const relative = path.relative(REPO_ROOT, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('outside repository');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME[path.extname(filePath).toLowerCase()]
          || 'application/octet-stream',
      });
      response.end(body);
    });
  });
}

async function assertRawStaticSource(staticPort) {
  const route = '/docs/ui/touch_control_wire.js';
  const response = await fetch(`http://127.0.0.1:${staticPort}${route}`);
  assert(response.status === 200, `raw wire request returned ${response.status}`);
  const served = Buffer.from(await response.arrayBuffer());
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'ui', 'touch_control_wire.js'),
  );
  assert(served.equals(source), 'static server rewrote touch_control_wire.js');
  return crypto.createHash('sha256').update(served).digest('hex');
}

function assertPageEndpointContractIntegrated() {
  const wirePath = path.join(REPO_ROOT, 'docs', 'ui', 'touch_control_wire.js');
  const endpointPath = path.join(REPO_ROOT, 'docs', 'ui', 'touch_control_endpoint.js');
  const htmlPath = path.join(REPO_ROOT, 'docs', 'ui', 'touch_control.html');
  const wireSource = fs.readFileSync(wirePath, 'utf8');
  const endpointSource = fs.readFileSync(endpointPath, 'utf8');
  const htmlSource = fs.readFileSync(htmlPath, 'utf8');
  assert(endpointSource.includes(ENGINE_ORIGIN_PARAM),
    `endpoint parser has no ${ENGINE_ORIGIN_PARAM} contract; refusing to launch`);
  assert(endpointSource.includes(PROTOCOL_PARAM),
    `endpoint parser has no ${PROTOCOL_PARAM} contract; refusing to launch`);
  assert(/PROTOCOL_VERSION\s*=\s*1\s*;/.test(endpointSource),
    'endpoint parser protocol version is not exactly 1; refusing to launch');
  const parserIndex = htmlSource.indexOf('touch_control_endpoint.js');
  const wireIndex = htmlSource.indexOf('touch_control_wire.js');
  assert(parserIndex >= 0 && wireIndex > parserIndex,
    'Live Touch page does not load its endpoint parser before the wire');
  assert(wireSource.includes('window.TouchControlEndpoint'),
    'Live Touch wire does not consume the validated endpoint; refusing to launch');
  assert(wireSource.includes('ENDPOINT.engineOrigin')
    && wireSource.includes('ENDPOINT.webSocketOrigin'),
  'Live Touch wire does not consume both validated transport origins');
  assert(!/location\.hostname[^\n]*6968/.test(wireSource),
    'page source still derives engine port 6968 from location.hostname; refusing to launch');
  assert(!/location\.hostname[^\n]*6968/.test(htmlSource),
    'page source still derives a preset-store port 6968; refusing to launch');
  assert(htmlSource.includes('TouchControlEndpoint.engineOrigin'),
    'page preset store does not consume the validated engine origin');
  return crypto.createHash('sha256')
    .update(endpointSource)
    .update(htmlSource)
    .update(wireSource)
    .digest('hex');
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function closeChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function cleanupStep(errors, label, action) {
  try {
    await action();
  } catch (error) {
    errors.push({ label, error: error.stack || error.message });
  }
}

function removeTempRoot(tempRoot) {
  if (!tempRoot) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(tempBase, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(resolved).startsWith(TEMP_PREFIX)) {
    throw new Error(`refusing to remove unexpected temp path ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function installNativeHost(page) {
  return page.evaluateOnNewDocument((theme) => {
    window.__nativeBridgeMessages = [];
    window.__nativeColorAutopilotEvents = [];
    document.addEventListener('colorautopilot', event => {
      window.__nativeColorAutopilotEvents.push(event.detail);
    });
    window.__nativePixelStartDocumentId = null;
    window.__nativeHostDeliver = function (message) {
      Promise.resolve().then(function () {
        if (typeof window.__captainpadDeliver !== 'function') {
          throw new Error('native host tried to deliver before the page hook existed');
        }
        window.__captainpadDeliver(message);
      });
    };
    window.ReactNativeWebView = {
      postMessage: function (raw) {
        const message = JSON.parse(raw);
        window.__nativeBridgeMessages.push(message);
        if (message.type === 'touch-control-theme-ready') {
          window.__nativeHostDeliver({
            type: 'captainpad-theme',
            version: 1,
            requestId: 'native-channel-theme-1',
            themeId: 'midnight',
            resolvedThemeId: 'midnight',
            scheme: 'dark',
            palette: theme,
          });
        }
        if (message.type === 'touch-control-theme-applied') {
          window.__nativeHostDeliver({
            type: 'captainpad-surface-focus',
            version: 1,
            requestId: 'native-channel-focus-1',
          });
        }
        if (message.type === 'touch-control-pixel-verifier-ready'
            && window.__nativePixelStartDocumentId === null) {
          window.__nativePixelStartDocumentId = message.documentId;
          window.__nativeHostDeliver({
            type: 'captainpad-pixel-verification-start',
            version: 1,
            documentId: message.documentId,
            requestId: 'native-channel-pixel-1',
          });
        }
      },
    };
  }, NATIVE_THEME);
}

async function installLivePortGuards(page, trace, pageLabel) {
  trace.livePortGuard = trace.livePortGuard || { blockedPorts: [...LIVE_PORTS], events: [] };
  await page.setRequestInterception(true);
  page.on('request', request_ => {
    let port = null;
    try {
      port = Number(new URL(request_.url()).port);
    } catch {
      request_.abort('blockedbyclient');
      return;
    }
    if (LIVE_PORTS.has(port)) {
      trace.livePortGuard.events.push({
        at: new Date().toISOString(),
        page: pageLabel,
        layer: 'network_interception',
        method: request_.method(),
        url: request_.url(),
      });
      request_.abort('blockedbyclient');
      return;
    }
    request_.continue();
  });
  await page.evaluateOnNewDocument(ports => {
    const blockedPorts = new Set(ports.map(String));
    window.__livePortGuardEvents = [];
    const blocked = (value) => {
      try {
        return blockedPorts.has(new URL(String(value), window.location.href).port);
      } catch {
        return false;
      }
    };
    const record = (kind, value) => {
      window.__livePortGuardEvents.push({ kind, url: String(value) });
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, argsList) {
        if (!blocked(argsList[0])) return new Target(...argsList);
        record('websocket', argsList[0]);
        const stub = new EventTarget();
        stub.readyState = NativeWebSocket.CLOSED;
        stub.url = String(argsList[0]);
        stub.protocol = '';
        stub.extensions = '';
        stub.binaryType = 'blob';
        stub.bufferedAmount = 0;
        stub.send = function () {};
        stub.close = function () {};
        stub.onopen = null;
        stub.onclose = null;
        stub.onerror = null;
        stub.onmessage = null;
        return stub;
      },
    });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const value = input && input.url ? input.url : input;
      if (!blocked(value)) return nativeFetch(input, init);
      record('fetch', value);
      return Promise.reject(new Error(`test guard blocked live port URL ${value}`));
    };
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (blocked(url)) {
        record('xmlhttprequest', url);
        throw new Error(`test guard blocked live port URL ${url}`);
      }
      return nativeOpen.call(this, method, url, ...rest);
    };
    Object.defineProperty(window, '__readonlyMode', {
      get: () => true,
      set: () => {},
      configurable: true,
    });
  }, [...LIVE_PORTS]);
}

async function collectLivePortGuardEvents(page, trace, pageLabel) {
  const events = await page.evaluate(() => window.__livePortGuardEvents || []);
  for (const event of events) {
    trace.livePortGuard.events.push({
      at: new Date().toISOString(),
      page: pageLabel,
      layer: 'page_constructor_guard',
      ...event,
    });
  }
  return events;
}

async function loadTitanicSimulation(page, staticPort, trace) {
  const simUrl = `http://127.0.0.1:${staticPort}/simulation/`
    + '?scene=titanic&profile=full&renderer=webgl';
  await page.goto(simUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return true;
    const style = window.getComputedStyle(overlay);
    return style.display === 'none'
      || style.opacity === '0'
      || style.visibility === 'hidden';
  }, { timeout: 120_000 });
  await page.waitForFunction(() => (
    typeof window.animateCamera === 'function'
    && window.__gpuAdapter
  ), { timeout: 30_000 });
  const installation = await page.evaluate(async () => {
    const [animateModule, stateModule, blendModule, previewModule, threeModule] =
      await Promise.all([
        import(`${location.origin}/simulation/src/core/animate.js`),
        import(`${location.origin}/simulation/src/core/state.js`),
        import(`${location.origin}/simulation/src/core/rgbwau_blend.js`),
        import(`${location.origin}/simulation/src/core/sim_preview.js`),
        import(`${location.origin}/simulation/vendor/three/build/three.webgpu.min.js`),
      ]);
    const dotMeshes = stateModule.scene.children.filter(object => object.isInstancedMesh);
    if (dotMeshes.length !== 1) {
      throw new Error(`expected one Titanic pixel-dot mesh, found ${dotMeshes.length}`);
    }
    const dotMesh = dotMeshes[0];
    const color = new threeModule.Color();
    window.__nativeRigFrame = null;
    window.__nativeRigFrameHash = null;
    window.__nativeRigAppliedHash = null;
    window.__nativeRigApplyCount = 0;
    window.__nativeRigPixelCount = null;
    window.__setNativeRigFrame = function (base64, hash) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      if (bytes.length === 0 || bytes.length % 6 !== 0) {
        throw new Error(`rig frame byte length ${bytes.length} is not RGBWAU`);
      }
      window.__nativeRigFrame = bytes;
      window.__nativeRigFrameHash = hash;
      window.__nativeRigAppliedHash = null;
    };
    animateModule.onPixelFrame(list => {
      const bytes = window.__nativeRigFrame;
      if (!bytes) return;
      if (!Array.isArray(list) || bytes.length !== list.length * 6) {
        throw new Error(
          `rig frame has ${bytes.length / 6} pixels; Titanic renderer has ${list?.length}`,
        );
      }
      window.__nativeRigPixelCount = list.length;
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const offset = index * 6;
        entry.r = bytes[offset] / 255;
        entry.g = bytes[offset + 1] / 255;
        entry.b = bytes[offset + 2] / 255;
        entry.w = bytes[offset + 3] / 255;
        entry.a = bytes[offset + 4] / 255;
        entry.u = bytes[offset + 5] / 255;
        if (entry._ledWirePreview) entry._ledWirePreview = null;
        const mixed = blendModule.blendEntryRgbwau(entry);
        if (entry.apply) entry.apply(mixed[0], mixed[1], mixed[2]);
        const preview = previewModule.scaleSimulationPreviewRgb(
          mixed[0],
          mixed[1],
          mixed[2],
        );
        color.setRGB(preview[0], preview[1], preview[2]);
        dotMesh.setColorAt(index, color);
      }
      if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true;
      window.__nativeRigAppliedHash = window.__nativeRigFrameHash;
      window.__nativeRigApplyCount += 1;
    });
    const hiddenIds = [
      'hud-frame',
      'info-panel',
      'pattern-editor-panel',
      'sacn-in-monitor-panel',
      'sacn-out-monitor-panel',
      'view-presets',
      'gui-panel',
      'unpatched-warning',
      'pixel-map-panel',
    ];
    for (const id of hiddenIds) {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    }
    document.querySelectorAll('.marsin-gui').forEach(element => {
      element.style.display = 'none';
    });
    if (typeof window.setTraceObjectsVisibility === 'function') {
      window.setTraceObjectsVisibility(false);
    }
    window.animateCamera('dramatic');
    return {
      renderer: window.__gpuAdapter,
      rendererMode: window.__rendererMode,
      canvasCount: document.querySelectorAll('canvas').length,
      initialDotCount: dotMesh.count,
    };
  });
  await delay(3_000);
  traceEvent(trace, 'isolated_titanic_simulation_ready', {
    simUrl,
    viewport: '1280x720',
    ...installation,
  });
  return installation;
}

async function captureModelOutput(
  page,
  artifactDir,
  label,
  frame,
  correlation,
  trace,
) {
  assert(frame && frame.rig && frame.rigBase64,
    `${label} has no full rig frame for Titanic rendering`);
  assert(frame.rig.pixelStride === 6, `${label} rig frame is not RGBWAU`);
  assert(frame.rigPixelCount === frame.modelPixelCount,
    `${label} /ws/viz rig frame is sampled instead of full-model`);
  assert(frame.rig.bytes === frame.modelPixelCount * 6,
    `${label} /ws/viz rig byte count does not match the Titanic model`);
  const applyCount = await page.evaluate(() => window.__nativeRigApplyCount);
  await page.evaluate((base64, hash) => {
    window.__setNativeRigFrame(base64, hash);
  }, frame.rigBase64, frame.rig.hash);
  await page.waitForFunction((hash, previousCount) => (
    window.__nativeRigAppliedHash === hash
    && window.__nativeRigApplyCount > previousCount
  ), { timeout: 3_000 }, frame.rig.hash, applyCount);
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const screenshotPath = path.join(artifactDir, `model_${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const proof = {
    label,
    path: screenshotPath,
    frameAt: new Date(frame.at).toISOString(),
    frameHash: frame.rig.hash,
    frameVariance: frame.rig.variance,
    frameDistinctPixels: frame.rig.distinctPixels,
    framePixelCount: frame.rigPixelCount,
    pattern: correlation.pattern,
    transition: correlation.transition || null,
    requestedOption: correlation.requestedOption || null,
    phase: correlation.phase,
  };
  trace.modelScreenshots = trace.modelScreenshots || [];
  trace.modelScreenshots.push(proof);
  traceEvent(trace, 'actual_titanic_model_screenshot', proof);
  return proof;
}

function observePatternResponses(page, trace) {
  const responses = [];
  page.on('response', async response => {
    let parsedUrl;
    try {
      parsedUrl = new URL(response.url());
    } catch {
      return;
    }
    const request_ = response.request();
    if (request_.method() !== 'PUT'
        || parsedUrl.pathname !== '/layers/live_touch/pattern') return;
    try {
      const rawRequest = request_.postData();
      const requestBody = rawRequest ? JSON.parse(rawRequest) : null;
      const rawResponse = await response.text();
      const responseBody = rawResponse ? JSON.parse(rawResponse) : null;
      const event = {
        status: response.status(),
        request: requestBody,
        response: responseBody,
      };
      responses.push(event);
      traceEvent(trace, 'pattern_http_response', event);
    } catch (error) {
      traceEvent(trace, 'pattern_http_capture_failed', { error: error.message });
    }
  });
  return responses;
}

function observeLiveControlResponses(page, trace) {
  const responses = [];
  page.on('response', async response => {
    let parsedUrl;
    try {
      parsedUrl = new URL(response.url());
    } catch {
      return;
    }
    const request_ = response.request();
    if (request_.method() !== 'POST'
        || parsedUrl.pathname !== '/layers/live_touch/control') return;
    try {
      const rawRequest = request_.postData();
      const requestBody = rawRequest ? JSON.parse(rawRequest) : null;
      const event = {
        status: response.status(),
        request: requestBody,
      };
      responses.push(event);
      traceEvent(trace, 'live_control_http_response', event);
    } catch (error) {
      traceEvent(trace, 'live_control_http_capture_failed', { error: error.message });
    }
  });
  return responses;
}

function frameRecord(message, key) {
  if (!message || !message.vis || typeof message.vis[key] !== 'string') return null;
  const bytes = Buffer.from(message.vis[key], 'base64');
  let nonzero = 0;
  let sum = 0;
  let sumSquares = 0;
  for (const value of bytes) {
    if (value !== 0) nonzero += 1;
    sum += value;
    sumSquares += value * value;
  }
  const pixelStride = key === 'rig' ? 6 : 3;
  const pixels = new Set();
  for (let offset = 0; offset + pixelStride <= bytes.length; offset += pixelStride) {
    pixels.add(bytes.subarray(offset, offset + pixelStride).toString('hex'));
  }
  const mean = bytes.length > 0 ? sum / bytes.length : 0;
  const variance = bytes.length > 0
    ? Math.max(0, (sumSquares / bytes.length) - (mean * mean))
    : 0;
  return {
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    nonzero,
    bytes: bytes.length,
    pixelStride,
    distinctPixels: pixels.size,
    variance: Number(variance.toFixed(6)),
  };
}

async function connectViz(enginePort, trace) {
  const frames = [];
  const socket = new WebSocket(`ws://127.0.0.1:${enginePort}/ws/viz`);
  socket.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || message.type !== 'vis') return;
    const frame = {
      at: Date.now(),
      liveTouch: frameRecord(message, 'live_touch'),
      rig: frameRecord(message, 'rig'),
      rigPixelCount: message.pixelCounts && message.pixelCounts.rig,
      modelPixelCount: message.modelPixelCount,
    };
    Object.defineProperty(frame, 'rigBase64', {
      value: message.vis.rig,
      enumerable: false,
    });
    frames.push(frame);
    traceEvent(trace, 'viz_frame', frame);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return { frames, socket };
}

async function waitForMotion(frames, startIndex, label) {
  return waitFor(() => {
    const window = frames.slice(startIndex).filter(frame => frame.liveTouch && frame.rig);
    const liveFrames = window.filter(frame => frame.liveTouch.nonzero > 0);
    const rigFrames = window.filter(frame => frame.rig.nonzero > 0);
    const liveHashes = new Set(liveFrames.map(frame => frame.liveTouch.hash));
    const rigHashes = new Set(rigFrames.map(frame => frame.rig.hash));
    if (liveHashes.size < 2 || rigHashes.size < 2) return null;
    return {
      label,
      frameCount: window.length,
      liveDistinct: liveHashes.size,
      rigDistinct: rigHashes.size,
      liveHashes: [...liveHashes],
      rigHashes: [...rigHashes],
      liveMaxDistinctPixels: Math.max(
        ...liveFrames.map(frame => frame.liveTouch.distinctPixels),
      ),
      rigMaxDistinctPixels: Math.max(...rigFrames.map(frame => frame.rig.distinctPixels)),
    };
  }, `${label} /ws/viz motion`, 6_000, 100);
}

async function waitForVizFrame(frames, startIndex, label) {
  return waitFor(() => {
    const frame = frames.slice(startIndex).find(candidate => (
      candidate.liveTouch && candidate.rig
    ));
    return frame || null;
  }, `${label} /ws/viz frame`, 3_000, 25);
}

async function enumerateAuthoritativeDropdown(page) {
  return page.evaluate(patterns => {
    const select = document.getElementById('patternSel');
    if (!select) throw new Error('real pattern dropdown is missing');
    return Array.from(select.options)
      .filter(option => !option.disabled && option.value)
      .map(option => ({
        value: option.value,
        optionId: option.dataset.entryId || option.value,
        pattern: option.dataset.pattern || patterns[option.value] || null,
        playlist: option.dataset.playlist || null,
        label: option.textContent.trim(),
        group: option.parentElement && option.parentElement.label
          ? option.parentElement.label
          : null,
      }));
  }, INSTRUMENT_PATTERNS);
}

function assertOptionRequest(event, option) {
  assert(event.request && event.request.pattern === option.pattern,
    `${option.value} request did not name ${option.pattern}`);
  if (option.playlist) {
    assert(event.request.playlist === option.playlist,
      `${option.value} request lost playlist ${option.playlist}`);
    assert(event.request.entryId === option.optionId,
      `${option.value} request lost entry id ${option.optionId}`);
  } else {
    assert(!Object.prototype.hasOwnProperty.call(event.request, 'playlist'),
      `${option.value} instrument request unexpectedly named a playlist`);
    assert(!Object.prototype.hasOwnProperty.call(event.request, 'entryId'),
      `${option.value} instrument request unexpectedly named an entry id`);
  }
}

function optionProof(option, before, selection, landed, motion) {
  assertOptionRequest(selection.acknowledgement, option);
  return {
    requested: option,
    before: {
      pattern: before.liveTouch.pattern,
      sessionRevision: before.liveTouch.sessionRevision,
    },
    accepted202: {
      status: selection.acknowledgement.status,
      actualPattern: selection.acknowledgement.response.pattern,
      targetPattern: selection.acknowledgement.response.targetPattern,
      transitionId: selection.acknowledgement.response.transitionId,
      sessionRevision: selection.acknowledgement.response.sessionRevision,
      localControls: selection.acknowledgement.response.localControls,
    },
    exact500msState: selection.readback.liveTouch.patternTransition,
    landed: {
      pattern: landed.liveTouch.pattern,
      transition: landed.liveTouch.patternTransition,
      sessionRevision: landed.liveTouch.sessionRevision,
    },
    motion: {
      classification: 'nonzero_temporal_motion',
      ...motion,
    },
  };
}

function assertTransitionAck(event, fromPattern, toPattern) {
  assert(event.status === 202, `expected transition 202, received ${event.status}`);
  const payload = event.response;
  assert(payload && payload.status === 'transitioning', 'transition response is not pending');
  assert(payload.pattern === fromPattern,
    `transition actual A mismatch: expected ${fromPattern}, received ${payload.pattern}`);
  assert(payload.targetPattern === toPattern,
    `transition target B mismatch: expected ${toPattern}, received ${payload.targetPattern}`);
  assert(payload.transition && payload.transition.id === payload.transitionId,
    'transition response has no correlated transition id');
  assert(payload.transition.fromPattern === fromPattern, 'transition fromPattern mismatch');
  assert(payload.transition.toPattern === toPattern, 'transition toPattern mismatch');
  assert(payload.transition.mode === 'trans_crossfade', 'transition mode is not trans_crossfade');
  assert(payload.transition.durationMs === 500, 'transition duration is not exactly 500 ms');
  assert(Number.isInteger(payload.sessionRevision), 'transition has no session revision');
}

async function waitForPatternResponse(responses, startIndex, pattern, status) {
  return waitFor(() => responses.slice(startIndex).find(event => (
    event.status === status
    && event.request
    && event.request.pattern === pattern
  )), `${pattern} HTTP ${status} response`, 4_000, 25);
}

async function assertTransitionReadback(engineBase, acknowledgement) {
  return waitFor(async () => {
    const layer = await request(engineBase, 'GET', '/layers/state');
    const transition = layer.data
      && layer.data.liveTouch
      && layer.data.liveTouch.patternTransition;
    if (layer.status !== 200 || !transition) return null;
    if (transition.id !== acknowledgement.response.transitionId) return null;
    assert(transition.fromPattern === acknowledgement.response.pattern,
      'layer readback changed transition A');
    assert(transition.toPattern === acknowledgement.response.targetPattern,
      'layer readback changed transition B');
    assert(transition.mode === 'trans_crossfade', 'layer readback changed transition mode');
    assert(transition.durationMs === 500, 'layer readback changed transition duration');
    return layer.data;
  }, 'authoritative A/B transition readback', 450, 20);
}

async function waitForPatternLanding(engineBase, pattern) {
  return waitFor(async () => {
    const layer = await request(engineBase, 'GET', '/layers/state');
    if (layer.status !== 200 || !layer.data || !layer.data.liveTouch) return null;
    return layer.data.active === 'live_touch'
      && layer.data.target === 'live_touch'
      && layer.data.transition === null
      && layer.data.liveTouch.pattern === pattern
      && layer.data.liveTouch.patternTransition === null
      ? layer.data
      : null;
  }, `${pattern} authoritative landing`, 6_000, 50);
}

async function waitForDropdownSettlement(page, pattern) {
  await page.waitForFunction(expected => {
    const select = document.getElementById('patternSel');
    return window.__wire
      && window.__wire.channelPattern === expected
      && select
      && select.dataset.confirmedPattern === expected
      && select.getAttribute('aria-busy') !== 'true';
  }, { timeout: 6_000 }, pattern);
}

async function selectThroughDropdown(
  page,
  responses,
  engineBase,
  value,
  targetPattern,
  fromPattern,
) {
  assert(typeof targetPattern === 'string' && targetPattern.length > 0,
    `selector value ${value} has no authoritative pattern`);
  const startIndex = responses.length;
  const selected = await page.select('#patternSel', value);
  assert(selected.length === 1 && selected[0] === value,
    `actual dropdown did not select ${value}`);
  const acknowledgement = await waitForPatternResponse(
    responses,
    startIndex,
    targetPattern,
    202,
  );
  assertTransitionAck(acknowledgement, fromPattern, targetPattern);
  const readback = await assertTransitionReadback(engineBase, acknowledgement);
  return { acknowledgement, readback, targetPattern };
}

async function sendRapidOverlap(page, targetPattern) {
  return page.evaluate(async (engineParam, pattern) => {
    const engineOrigin = new URL(window.location.href).searchParams.get(engineParam);
    if (!engineOrigin) throw new Error('native page lost its declared engine origin');
    if (!window.__wire || typeof window.__wire.ownerId !== 'string') {
      throw new Error('native page has no Live Touch owner');
    }
    const response = await fetch(`${engineOrigin}/layers/live_touch/pattern`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Touch-Control-Owner': window.__wire.ownerId,
      },
      body: JSON.stringify({
        pattern,
        transition: { mode: 'trans_crossfade', durationMs: 500 },
      }),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }, ENGINE_ORIGIN_PARAM, targetPattern);
}

async function browserOwnerRequest(page, method, route, body) {
  return page.evaluate(async (engineParam, requestMethod, requestRoute, requestBody) => {
    const engineOrigin = new URL(window.location.href).searchParams.get(engineParam);
    if (!engineOrigin) throw new Error('native page lost its declared engine origin');
    if (!window.__wire || typeof window.__wire.ownerId !== 'string') {
      throw new Error('native page has no Live Touch owner');
    }
    const response = await fetch(`${engineOrigin}${requestRoute}`, {
      method: requestMethod,
      cache: requestMethod === 'GET' ? 'no-store' : undefined,
      headers: {
        ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Touch-Control-Owner': window.__wire.ownerId,
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`${requestMethod} ${requestRoute} returned non-JSON`);
      }
    }
    return { status: response.status, body: parsed };
  }, ENGINE_ORIGIN_PARAM, method, route, body);
}

async function assertNoGlobalFixedColorOverrides(page, label) {
  const response = await browserOwnerRequest(
    page,
    'GET',
    '/group-fixed-colors',
  );
  assert(response.status === 200 && response.body,
    `${label} fixed-color readback returned ${response.status}`);
  assert(Array.isArray(response.body.groups) && response.body.groups.length > 0,
    `${label} fixed-color readback has no authoritative groups`);
  const overrides = response.body.overrides;
  assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides),
    `${label} fixed-color readback has no overrides object`);
  assert(Object.keys(overrides).length === 0,
    `${label} GLOBAL groups gained implicit fixed-color overrides`);
  return {
    label,
    ownerScoped: true,
    exercisedScope: 'GLOBAL',
    explicitOwnExercised: false,
    groupCount: response.body.groups.length,
    groups: response.body.groups,
    overrides,
  };
}

function nearlyEqual(actual, expected) {
  return typeof actual === 'number'
    && typeof expected === 'number'
    && Math.abs(actual - expected) < 1e-6;
}

function assertHsv(actual, expected, label) {
  assert(actual && expected, `${label} HSV value is missing`);
  for (const key of ['h', 's', 'v']) {
    assert(nearlyEqual(actual[key], expected[key]),
      `${label}.${key} expected ${expected[key]}, received ${actual[key]}`);
  }
}

async function ensureColorPanelOpen(page) {
  const docked = await page.$eval(
    '#colorHubPanel',
    panel => panel.classList.contains('is-docked'),
  );
  if (docked) {
    await page.click('[data-workspace-panel="colorhub-panel"]');
  }
  await page.waitForFunction(() => {
    const panel = document.getElementById('colorHubPanel');
    return panel && !panel.classList.contains('is-docked');
  }, { timeout: 2_000 });
  await page.click('#chTabs [data-card="two"]');
  await page.waitForFunction(() => {
    const card = document.getElementById('chCardTwo');
    return card && !card.hidden;
  }, { timeout: 2_000 });
}

async function clickChipByText(page, selector, textValue) {
  const clicked = await page.evaluate((containerSelector, expectedText) => {
    const container = document.querySelector(containerSelector);
    if (!container) throw new Error(`missing chip container ${containerSelector}`);
    const chip = Array.from(container.querySelectorAll('.ch-chip'))
      .find(candidate => candidate.textContent.trim() === expectedText);
    if (!chip) return false;
    chip.click();
    return true;
  }, selector, textValue);
  assert(clicked, `${selector} has no ${textValue} chip`);
}

async function stageFiveColorScheme(
  page,
  controlResponses,
  instrumentValue,
) {
  await ensureColorPanelOpen(page);
  const exportsResponse = await browserOwnerRequest(
    page,
    'GET',
    '/layers/live_touch/exports',
  );
  assert(exportsResponse.status === 200 && Array.isArray(exportsResponse.body),
    `${instrumentValue} exports readback failed`);
  const exportIds = Object.fromEntries(
    exportsResponse.body.map(entry => [entry.name, entry.id]),
  );
  const localNames = [];
  for (const slot of [3, 4, 5]) {
    localNames.push(`sliderHue${slot}`, `sliderVal${slot}`);
  }
  for (const name of localNames) {
    assert(Number.isInteger(exportIds[name]),
      `${instrumentValue} is missing authoritative export ${name}`);
  }

  const paramBefore = await browserOwnerRequest(page, 'GET', '/param-center');
  assert(paramBefore.status === 200 && paramBefore.body,
    `${instrumentValue} private param-center preflight failed`);
  const responseStart = controlResponses.length;
  await page.click('#chSchemeActionsTwo [data-scheme="contrast"]');
  const slots = await waitFor(() => page.evaluate(() => {
    const host = document.getElementById('slots');
    if (!host) return null;
    let palette;
    try {
      palette = JSON.parse(host.dataset.palette || '[]');
    } catch {
      return null;
    }
    if (palette.length !== 5) return null;
    const distinct = new Set(palette.map(slot => JSON.stringify(slot)));
    return distinct.size === 5 ? palette : null;
  }), `${instrumentValue} five-color page palette`, 3_000, 25);

  const paramCenter = await waitFor(async () => {
    const response = await browserOwnerRequest(page, 'GET', '/param-center');
    if (response.status !== 200 || !response.body || !response.body.params) return null;
    const palette1 = response.body.params.colorPalette1
      && response.body.params.colorPalette1.value;
    const palette2 = response.body.params.colorPalette2
      && response.body.params.colorPalette2.value;
    try {
      assertHsv(palette1, slots[0], `${instrumentValue} palette slot 1`);
      assertHsv(palette2, slots[1], `${instrumentValue} palette slot 2`);
    } catch {
      return null;
    }
    return response.body;
  }, `${instrumentValue} private palette slots 1-2`, 3_000, 25);
  const localWrites = await waitFor(() => {
    const captured = controlResponses.slice(responseStart).filter(event => (
      event.status === 200
      && event.request
      && localNames.some(name => exportIds[name] === event.request.id)
    ));
    const byId = new Map(captured.map(event => [event.request.id, event]));
    return localNames.every(name => byId.has(exportIds[name])) ? byId : null;
  }, `${instrumentValue} pattern-local palette writes`, 3_000, 25);

  const localControls = {};
  for (const slot of [3, 4, 5]) {
    const hueName = `sliderHue${slot}`;
    const valueName = `sliderVal${slot}`;
    const hue = localWrites.get(exportIds[hueName]).request.v0;
    const value = localWrites.get(exportIds[valueName]).request.v0;
    assert(nearlyEqual(hue, slots[slot - 1].h),
      `${instrumentValue} ${hueName} did not stage palette hue`);
    assert(nearlyEqual(value, slots[slot - 1].v),
      `${instrumentValue} ${valueName} did not stage palette value`);
    localControls[hueName] = hue;
    localControls[valueName] = value;
  }

  return {
    instrument: instrumentValue,
    scheme: 'contrast',
    pagePaletteSlots: slots,
    privateParamCenter: {
      revisionBefore: paramBefore.body.revision,
      revision: paramCenter.revision,
      colorPalette1: paramCenter.params.colorPalette1.value,
      colorPalette2: paramCenter.params.colorPalette2.value,
    },
    patternLocalControls: localControls,
    saturationContract: 'slots 3-5 expose hue/value; pattern saturation is fixed',
  };
}

function assertNonflatFrame(frame, label) {
  for (const key of ['liveTouch', 'rig']) {
    const record = frame[key];
    assert(record && record.nonzero > 0, `${label} ${key} frame is black`);
    assert(record.distinctPixels > 1, `${label} ${key} frame is spatially flat`);
    assert(record.variance > 0, `${label} ${key} frame has zero variance`);
  }
}

async function exerciseColorCrossfade(page, vizFrames) {
  await ensureColorPanelOpen(page);
  await page.click('#chSchemeActionsTwo [data-scheme="contrast"]');
  await page.waitForFunction(() => {
    const ring = document.querySelectorAll('#chRingTwo .ch-swatch-btn');
    return ring.length === 5;
  }, { timeout: 2_000 });
  await page.click('#chArmBTwo');
  await page.click('#chRingTwo .ch-swatch-btn:nth-child(5)');
  await page.click('#chArmATwo');
  await page.click('#chRingTwo .ch-swatch-btn:nth-child(2)');
  const selection = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#chRingTwo .ch-swatch-btn'));
    return {
      a: buttons.findIndex(button => button.classList.contains('is-a')),
      b: buttons.findIndex(button => button.classList.contains('is-b')),
      palette: JSON.parse(document.getElementById('slots').dataset.palette || '[]'),
    };
  });
  assert(selection.a === 1 && selection.b === 4,
    `Color A/B selection did not land on slots 2/5: ${JSON.stringify(selection)}`);
  await clickChipByText(page, '#chHoldChipsTwo', 'CONT');
  await clickChipByText(page, '#chFadeChipsTwo', '0.4s');
  const stagedParamCenter = await waitFor(async () => {
    const response = await browserOwnerRequest(page, 'GET', '/param-center');
    if (response.status !== 200 || !response.body || !response.body.params) return null;
    try {
      assertHsv(
        response.body.params.colorPalette1.value,
        selection.palette[0],
        'Color background palette slot 1',
      );
      assertHsv(
        response.body.params.colorPalette2.value,
        selection.palette[1],
        'Color background palette slot 2',
      );
    } catch {
      return null;
    }
    return response.body;
  }, 'Color background private palette staging', 3_000, 25);

  const baselineStart = vizFrames.length;
  const baseline = await waitForVizFrame(vizFrames, baselineStart, 'Color baseline');
  const eventStart = await page.evaluate(() => window.__nativeColorAutopilotEvents.length);
  await page.click('#chRunTwo');
  const started = await waitFor(async () => {
    const response = await browserOwnerRequest(page, 'GET', '/deck/color-autopilot');
    const state = response.body;
    return response.status === 200
      && state
      && state.active === true
      && state.mode === 'palettes'
      && state.transitionMs === 400
      && state.delay_s === 0
      && Array.isArray(state.palettes)
      && state.palettes.length === 2
      ? state
      : null;
  }, 'Color crossfade engine start readback', 4_000, 25);
  assertHsv(started.palettes[0].c1, selection.palette[1], 'Color active pair 1A');
  assertHsv(started.palettes[0].c2, selection.palette[4], 'Color active pair 1B');
  assertHsv(started.palettes[1].c1, selection.palette[4], 'Color active pair 2A');
  assertHsv(started.palettes[1].c2, selection.palette[1], 'Color active pair 2B');
  await page.waitForFunction(() => (
    document.getElementById('chRunTwo').textContent.trim() === 'STOP'
  ), { timeout: 4_000 });

  let frameStart = vizFrames.length;
  const start = await waitForVizFrame(vizFrames, frameStart, 'Color fade start');
  await delay(200);
  frameStart = vizFrames.length;
  const mid = await waitForVizFrame(vizFrames, frameStart, 'Color fade midpoint');
  await delay(250);
  frameStart = vizFrames.length;
  const end = await waitForVizFrame(vizFrames, frameStart, 'Color fade end');
  for (const [label, frame] of Object.entries({ baseline, start, mid, end })) {
    assertNonflatFrame(frame, `Color ${label}`);
  }
  const liveHashes = new Set([start, mid, end].map(frame => frame.liveTouch.hash));
  const rigHashes = new Set([start, mid, end].map(frame => frame.rig.hash));
  assert(liveHashes.size >= 2 && rigHashes.size >= 2,
    'Color start/mid/end did not produce nonidentical Live Touch and rig frames');

  await page.click('#chRunTwo');
  const stopped = await waitFor(async () => {
    const response = await browserOwnerRequest(page, 'GET', '/deck/color-autopilot');
    return response.status === 200 && response.body && response.body.active === false
      ? response.body
      : null;
  }, 'Color crossfade engine stop readback', 4_000, 25);
  await page.waitForFunction(() => (
    document.getElementById('chRunTwo').textContent.trim() === 'RUN CROSSFADE'
  ), { timeout: 4_000 });
  frameStart = vizFrames.length;
  const afterStop = await waitForVizFrame(vizFrames, frameStart, 'Color stop');
  assertNonflatFrame(afterStop, 'Color after STOP');
  const broadcasts = await page.evaluate(startIndex => (
    window.__nativeColorAutopilotEvents.slice(startIndex)
  ), eventStart);
  assert(broadcasts.some(event => event && event.active === true),
    'native browser channel missed the active colorAutopilot broadcast');
  assert(broadcasts.some(event => event && event.active === false),
    'native browser channel missed the stopped colorAutopilot broadcast');
  return {
    ordinaryBackground: true,
    controls: {
      card: 'two-colour',
      scheme: 'contrast',
      selectedAIndex: selection.a,
      selectedBIndex: selection.b,
      selectedAOrdinal: selection.a + 1,
      selectedBOrdinal: selection.b + 1,
      holdSeconds: 0,
      fadeSeconds: 0.4,
      paletteSlots: selection.palette,
      stagedParamCenter,
    },
    engineReadback: { started, stopped },
    nativeColorAutopilotBroadcasts: broadcasts,
    viz: { baseline, start, mid, end, afterStop },
  };
}

function writeTrace(trace, artifactDir) {
  const tracePath = path.join(artifactDir, 'trace.json');
  fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return tracePath;
}

async function main() {
  const trace = {
    schemaVersion: 1,
    test: 'live_touch_native_channel',
    startedAt: new Date().toISOString(),
    result: 'running',
    events: [],
  };
  const excludedPorts = new Set(LIVE_PORTS);
  let tempRoot = null;
  let artifactDir = null;
  let engine = null;
  let staticServer = null;
  let browser = null;
  let simulationBrowser = null;
  let page = null;
  let simulationPage = null;
  let vizSocket = null;
  let tracePath = null;
  const engineLogs = [];
  const browserErrors = [];
  const expectedBrowserDiagnostics = [];
  trace.browserErrors = browserErrors;
  trace.expectedBrowserDiagnostics = expectedBrowserDiagnostics;

  try {
    const endpointContractSourceSha256 = assertPageEndpointContractIntegrated();
    traceEvent(trace, 'page_endpoint_contract_source_preflight', {
      endpointContractSourceSha256,
      engineOriginParam: ENGINE_ORIGIN_PARAM,
      protocolParam: PROTOCOL_PARAM,
      protocolVersion: PROTOCOL_VERSION,
    });
    artifactDir = createArtifactDir();
    trace.artifactDir = artifactDir;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    const enginePort = await reserveHighPort(excludedPorts);
    const staticPort = await reserveHighPort(excludedPorts);
    const engineBase = `http://127.0.0.1:${enginePort}`;
    trace.isolation = {
      enginePort,
      staticPort,
      sAcnDestination: BLACKHOLE_HOST,
      configRoot: tempRoot,
    };

    const stateDir = path.join(tempRoot, 'states');
    const playlistsDir = path.join(tempRoot, 'playlists');
    const secretsPath = path.join(tempRoot, 'secrets.yaml');
    fs.mkdirSync(stateDir);
    fs.mkdirSync(playlistsDir);
    copyIsolatedPlaylists(playlistsDir);
    fs.writeFileSync(secretsPath, [
      `SinaAuth: ${TEST_OWNER_PASSWORD}`,
      'MishaAuth: live-touch-native-channel-collaborator',
      'MARITIME_TERM_FOR_SAILIOR_PASS: live-touch-native-channel-bringup',
      '',
    ].join('\n'));
    const configPath = writeIsolatedConfig(tempRoot);

    engine = spawn(process.execPath, [
      'engine.js',
      '--pattern', '13_sparkle',
      '--model', 'titanic',
      '--port', String(enginePort),
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

    await waitFor(async () => {
      const status = await request(engineBase, 'GET', '/status');
      return status.status === 200 ? status : null;
    }, 'isolated engine readiness');
    traceEvent(trace, 'isolated_engine_ready', { engineBase });

    const login = await request(engineBase, 'POST', '/captainpad/auth/login', {
      passphrase: TEST_OWNER_PASSWORD,
      remember30: false,
    });
    assert(login.status === 200 && login.data && typeof login.data.token === 'string',
      `test authentication failed: ${JSON.stringify(login)}`);
    const performance = await request(
      engineBase,
      'POST',
      '/performance-mode',
      { active: true },
      login.data.token,
    );
    if (performance.status === 400
        && performance.data
        && performance.data.code === 'PERFORMANCE_MODE_ALREADY_ACTIVE') {
      const currentPerformance = await request(engineBase, 'GET', '/performance-mode');
      assert(currentPerformance.status === 200 && currentPerformance.data.active === true,
        'isolated engine claimed Performance was active without readback: '
          + JSON.stringify(currentPerformance));
    } else {
      assert(performance.status === 200 && performance.data.active === true,
        `failed to enter isolated Performance Mode: ${JSON.stringify(performance)}`);
    }
    traceEvent(trace, 'performance_mode_enabled');

    staticServer = createStaticServer();
    await new Promise((resolve, reject) => {
      staticServer.once('error', reject);
      staticServer.listen(staticPort, '127.0.0.1', resolve);
    });
    const rawWireSha256 = await assertRawStaticSource(staticPort);
    traceEvent(trace, 'raw_repository_static_server_ready', {
      staticPort,
      rawWireSha256,
    });

    const viz = await connectViz(enginePort, trace);
    vizSocket = viz.socket;
    const vizFrames = viz.frames;
    traceEvent(trace, 'viz_socket_open');

    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240_000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-angle=swiftshader',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await installLivePortGuards(page, trace, 'native_panel');
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const messageText = message.text();
      if (/Failed to load resource:.*status of 409 \(Conflict\)/.test(messageText)) {
        expectedBrowserDiagnostics.push(messageText);
        return;
      }
      browserErrors.push(messageText);
    });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) {
        traceEvent(trace, 'browser_http_error', {
          status: response.status(),
          method: response.request().method(),
          url: response.url(),
        });
      }
    });
    await installNativeHost(page);
    const patternResponses = observePatternResponses(page, trace);
    const controlResponses = observeLiveControlResponses(page, trace);

    const panelUrl = new URL(`http://127.0.0.1:${staticPort}${PAGE_PATH}`);
    panelUrl.searchParams.set('captainpad_embed', 'native');
    panelUrl.searchParams.set(ENGINE_ORIGIN_PARAM, engineBase);
    panelUrl.searchParams.set(PROTOCOL_PARAM, PROTOCOL_VERSION);
    panelUrl.searchParams.set('captainpad_document', 'native-channel-regression');
    await page.goto(panelUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    const queryContract = await page.evaluate((engineParam, protocolParam) => {
      const params = new URL(window.location.href).searchParams;
      return {
        engineOrigins: params.getAll(engineParam),
        protocols: params.getAll(protocolParam),
        embed: params.getAll('captainpad_embed'),
      };
    }, ENGINE_ORIGIN_PARAM, PROTOCOL_PARAM);
    assert(queryContract.engineOrigins.length === 1
      && queryContract.engineOrigins[0] === engineBase,
    'browser did not preserve the exact CaptainPad engine origin');
    assert(queryContract.protocols.length === 1
      && queryContract.protocols[0] === PROTOCOL_VERSION,
    'browser did not preserve the exact Live Touch protocol version');
    assert(queryContract.embed.length === 1 && queryContract.embed[0] === 'native',
      'browser did not preserve the native embed declaration');
    traceEvent(trace, 'native_query_contract_verified', queryContract);

    await page.waitForFunction(() => {
      const messages = window.__nativeBridgeMessages || [];
      return window.__wire
        && window.__wire.online
        && window.TouchPixelViews
        && window.TouchPixelViews.canArm()
        && messages.some(message => (
          message.type === 'touch-control-theme-applied'
          && message.requestId === 'native-channel-theme-1'
        ))
        && messages.some(message => (
          message.type === 'touch-control-pixel-verification'
          && message.requestId === 'native-channel-pixel-1'
          && message.status === 'ready'
        ));
    }, { timeout: 20_000 });
    const nativeMessages = await page.evaluate(() => window.__nativeBridgeMessages.slice());
    traceEvent(trace, 'native_bridge_and_pixel_verifier_ready', {
      messageTypes: nativeMessages.map(message => message.type),
      pixelDocumentId: await page.evaluate(() => window.__nativePixelStartDocumentId),
    });

    simulationBrowser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240_000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--enable-webgl',
        '--enable-webgl2',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=swiftshader',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--window-size=1320,840',
      ],
    });
    simulationPage = await simulationBrowser.newPage();
    await simulationPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await installLivePortGuards(simulationPage, trace, 'titanic_simulation');
    await loadTitanicSimulation(simulationPage, staticPort, trace);

    await page.evaluate(() => {
      const select = document.getElementById('patternSel');
      if (!select) throw new Error('real pattern dropdown is missing');
      select.value = '130';
      if (select.value !== '130') throw new Error('real pattern dropdown has no 130 option');
    });
    const stageStart = patternResponses.length;
    await page.click('#arm');
    const staged = await waitForPatternResponse(
      patternResponses,
      stageStart,
      INSTRUMENT_PATTERNS['130'],
      200,
    );
    assert(staged.response && staged.response.status === 'ok',
      'ARM did not stage instrument 130 through the real page');
    const armed = await waitFor(async () => {
      const layer = await request(engineBase, 'GET', '/layers/state');
      return layer.status === 200
        && layer.data.active === 'live_touch'
        && layer.data.target === 'live_touch'
        && layer.data.transition === null
        && layer.data.liveTouch.armed === true
        && layer.data.liveTouch.pattern === INSTRUMENT_PATTERNS['130']
        ? layer.data
        : null;
    }, 'native owner ARM landing');
    await page.waitForFunction(() => (
      document.getElementById('armState').textContent === 'ARMED'
      && window.__wire.phase === 'armed'
    ), { timeout: 15_000 });
    const ownerId = await page.evaluate(() => window.__wire.ownerId);
    assert(armed.liveTouch.ownerId === ownerId,
      'WS ARM owner, page owner, and layer owner do not match');
    traceEvent(trace, 'native_ws_owner_armed', {
      ownerId,
      pattern: armed.liveTouch.pattern,
      sessionRevision: armed.liveTouch.sessionRevision,
    });
    const fixedColorsAfterArm = await assertNoGlobalFixedColorOverrides(
      page,
      'after ARM',
    );
    trace.globalFixedColorChecks = [fixedColorsAfterArm];
    traceEvent(trace, 'global_fixed_colors_zero_after_arm', fixedColorsAfterArm);
    const authoritativeOptions = await enumerateAuthoritativeDropdown(page);
    assert(authoritativeOptions.length > Object.keys(INSTRUMENT_PATTERNS).length,
      'authoritative dropdown did not contain background and instrument options');
    assert(authoritativeOptions.every(option => (
      typeof option.pattern === 'string' && option.pattern.length > 0
    )), 'authoritative dropdown contains an option without a pattern');
    assert(new Set(authoritativeOptions.map(option => option.value)).size
      === authoritativeOptions.length,
    'authoritative dropdown contains duplicate option values');
    const optionByValue = new Map(
      authoritativeOptions.map(option => [option.value, option]),
    );
    for (const value of Object.keys(INSTRUMENT_PATTERNS)) {
      assert(optionByValue.has(value), `authoritative dropdown is missing instrument ${value}`);
    }
    traceEvent(trace, 'authoritative_dropdown_enumerated_after_arm', {
      optionCount: authoritativeOptions.length,
      options: authoritativeOptions,
    });
    const allOptionProofs = [];
    const motionStart = vizFrames.length;
    traceEvent(trace, 'instrument_motion', await waitForMotion(
      vizFrames,
      motionStart,
      INSTRUMENT_PATTERNS['130'],
    ));

    let modelFrameStart = vizFrames.length;
    const model128Before = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '128 actual-model before',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '128_before',
      model128Before,
      {
        requestedOption: '128',
        phase: 'before',
        pattern: INSTRUMENT_PATTERNS['130'],
      },
      trace,
    );
    await capturePanel(page, artifactDir, '128_before', trace);
    const option128 = optionByValue.get('128');
    const to128 = await selectThroughDropdown(
      page,
      patternResponses,
      engineBase,
      '128',
      INSTRUMENT_PATTERNS['128'],
      INSTRUMENT_PATTERNS['130'],
    );
    traceEvent(trace, 'transition_readback', {
      from: INSTRUMENT_PATTERNS['130'],
      to: to128.targetPattern,
      transition: to128.readback.liveTouch.patternTransition,
    });

    const overlap = await sendRapidOverlap(page, INSTRUMENT_PATTERNS['129']);
    assert(overlap.status === 409 && overlap.body && overlap.body.code === 'EBUSY',
      `rapid overlap did not return EBUSY: ${JSON.stringify(overlap)}`);
    assert(overlap.body.current
      && overlap.body.current.liveTouch
      && overlap.body.current.liveTouch.pattern === INSTRUMENT_PATTERNS['130']
      && overlap.body.current.liveTouch.patternTransition
      && overlap.body.current.liveTouch.patternTransition.toPattern
        === INSTRUMENT_PATTERNS['128'],
    'EBUSY response did not preserve authoritative A/B state');
    traceEvent(trace, 'rapid_overlap_refused_ebusy', overlap);
    await capturePanel(page, artifactDir, '128_during', trace);
    await delay(100);
    modelFrameStart = vizFrames.length;
    const model128During = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '128 actual-model during',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '128_during',
      model128During,
      {
        requestedOption: '128',
        phase: 'during',
        pattern: INSTRUMENT_PATTERNS['130'],
        transition: to128.readback.liveTouch.patternTransition,
      },
      trace,
    );

    const landed128 = await waitForPatternLanding(
      engineBase,
      INSTRUMENT_PATTERNS['128'],
    );
    await waitForDropdownSettlement(page, INSTRUMENT_PATTERNS['128']);
    await capturePanel(page, artifactDir, '128_after', trace);
    const palette128 = await stageFiveColorScheme(page, controlResponses, '128');
    const motion128Start = vizFrames.length;
    const motion128 = await waitForMotion(
      vizFrames,
      motion128Start,
      INSTRUMENT_PATTERNS['128'],
    );
    assert(motion128.liveMaxDistinctPixels > 1 && motion128.rigMaxDistinctPixels > 1,
      '128 five-color scheme output was spatially flat');
    modelFrameStart = vizFrames.length;
    const model128After = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '128 actual-model after',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '128_after',
      model128After,
      {
        requestedOption: '128',
        phase: 'after',
        pattern: landed128.liveTouch.pattern,
      },
      trace,
    );
    const proof128 = optionProof(option128, armed, to128, landed128, motion128);
    proof128.fiveColorScheme = palette128;
    allOptionProofs.push(proof128);
    traceEvent(trace, 'representative_pattern_capture_128', proof128);

    modelFrameStart = vizFrames.length;
    const model129Before = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '129 actual-model before',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '129_before',
      model129Before,
      {
        requestedOption: '129',
        phase: 'before',
        pattern: INSTRUMENT_PATTERNS['128'],
      },
      trace,
    );
    await capturePanel(page, artifactDir, '129_before', trace);
    const option129 = optionByValue.get('129');
    const to129 = await selectThroughDropdown(
      page,
      patternResponses,
      engineBase,
      '129',
      INSTRUMENT_PATTERNS['129'],
      INSTRUMENT_PATTERNS['128'],
    );
    traceEvent(trace, 'post_ebusy_recovery_transition', {
      from: INSTRUMENT_PATTERNS['128'],
      to: to129.targetPattern,
      transition: to129.readback.liveTouch.patternTransition,
    });
    await capturePanel(page, artifactDir, '129_during', trace);
    await delay(100);
    modelFrameStart = vizFrames.length;
    const model129During = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '129 actual-model during',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '129_during',
      model129During,
      {
        requestedOption: '129',
        phase: 'during',
        pattern: INSTRUMENT_PATTERNS['128'],
        transition: to129.readback.liveTouch.patternTransition,
      },
      trace,
    );
    const landed129 = await waitForPatternLanding(
      engineBase,
      INSTRUMENT_PATTERNS['129'],
    );
    await waitForDropdownSettlement(page, INSTRUMENT_PATTERNS['129']);
    await capturePanel(page, artifactDir, '129_after', trace);
    const palette129 = await stageFiveColorScheme(page, controlResponses, '129');
    const motion129Start = vizFrames.length;
    const motion129 = await waitForMotion(
      vizFrames,
      motion129Start,
      INSTRUMENT_PATTERNS['129'],
    );
    assert(motion129.liveMaxDistinctPixels > 1 && motion129.rigMaxDistinctPixels > 1,
      '129 five-color scheme output was spatially flat');
    modelFrameStart = vizFrames.length;
    const model129After = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '129 actual-model after',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '129_after',
      model129After,
      {
        requestedOption: '129',
        phase: 'after',
        pattern: landed129.liveTouch.pattern,
      },
      trace,
    );
    const proof129 = optionProof(option129, landed128, to129, landed129, motion129);
    proof129.fiveColorScheme = palette129;
    allOptionProofs.push(proof129);
    traceEvent(trace, 'representative_pattern_capture_129', proof129);

    modelFrameStart = vizFrames.length;
    const model130Before = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '130 actual-model before',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '130_before',
      model130Before,
      {
        requestedOption: '130',
        phase: 'before',
        pattern: INSTRUMENT_PATTERNS['129'],
      },
      trace,
    );
    await capturePanel(page, artifactDir, '130_before', trace);
    const option130 = optionByValue.get('130');
    const to130 = await selectThroughDropdown(
      page,
      patternResponses,
      engineBase,
      '130',
      INSTRUMENT_PATTERNS['130'],
      INSTRUMENT_PATTERNS['129'],
    );
    traceEvent(trace, 'final_transition', {
      from: INSTRUMENT_PATTERNS['129'],
      to: to130.targetPattern,
      transition: to130.readback.liveTouch.patternTransition,
    });
    await capturePanel(page, artifactDir, '130_during', trace);
    await delay(100);
    modelFrameStart = vizFrames.length;
    const model130During = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '130 actual-model during',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '130_during',
      model130During,
      {
        requestedOption: '130',
        phase: 'during',
        pattern: INSTRUMENT_PATTERNS['129'],
        transition: to130.readback.liveTouch.patternTransition,
      },
      trace,
    );
    const landed130 = await waitForPatternLanding(
      engineBase,
      INSTRUMENT_PATTERNS['130'],
    );
    await waitForDropdownSettlement(page, INSTRUMENT_PATTERNS['130']);
    await capturePanel(page, artifactDir, '130_after', trace);
    const palette130 = await stageFiveColorScheme(page, controlResponses, '130');
    const motion130Start = vizFrames.length;
    const motion130 = await waitForMotion(
      vizFrames,
      motion130Start,
      INSTRUMENT_PATTERNS['130'],
    );
    assert(motion130.liveMaxDistinctPixels > 1 && motion130.rigMaxDistinctPixels > 1,
      '130 five-color scheme output was spatially flat');
    modelFrameStart = vizFrames.length;
    const model130After = await waitForVizFrame(
      vizFrames,
      modelFrameStart,
      '130 actual-model after',
    );
    await captureModelOutput(
      simulationPage,
      artifactDir,
      '130_after',
      model130After,
      {
        requestedOption: '130',
        phase: 'after',
        pattern: landed130.liveTouch.pattern,
      },
      trace,
    );
    const proof130 = optionProof(option130, landed129, to130, landed130, motion130);
    proof130.fiveColorScheme = palette130;
    allOptionProofs.push(proof130);
    traceEvent(trace, 'representative_pattern_capture_130', proof130);

    const representativeValues = new Set(Object.keys(INSTRUMENT_PATTERNS));
    let currentLanding = landed130;
    let colorInteraction = null;
    for (const option of authoritativeOptions) {
      if (representativeValues.has(option.value)) continue;
      const selection = await selectThroughDropdown(
        page,
        patternResponses,
        engineBase,
        option.value,
        option.pattern,
        currentLanding.liveTouch.pattern,
      );
      const landed = await waitForPatternLanding(engineBase, option.pattern);
      await waitForDropdownSettlement(page, option.pattern);
      const optionMotionStart = vizFrames.length;
      const motion = await waitForMotion(
        vizFrames,
        optionMotionStart,
        `${option.optionId}:${option.pattern}`,
      );
      const proof = optionProof(option, currentLanding, selection, landed, motion);
      allOptionProofs.push(proof);
      traceEvent(trace, 'authoritative_dropdown_option_proved', proof);
      currentLanding = landed;
      if (!colorInteraction && option.playlist) {
        colorInteraction = await exerciseColorCrossfade(page, vizFrames);
        colorInteraction.backgroundOption = option;
        trace.colorInteraction = colorInteraction;
        traceEvent(trace, 'native_color_crossfade_start_mid_end_stop', colorInteraction);
        for (const phase of ['start', 'mid', 'end']) {
          await captureModelOutput(
            simulationPage,
            artifactDir,
            `color_${phase}`,
            colorInteraction.viz[phase],
            {
              requestedOption: option.value,
              phase,
              pattern: landed.liveTouch.pattern,
              transition: {
                kind: 'colorAutopilot',
                active: true,
                mode: colorInteraction.engineReadback.started.mode,
                transitionMs: colorInteraction.engineReadback.started.transitionMs,
                delaySeconds: colorInteraction.engineReadback.started.delay_s,
              },
            },
            trace,
          );
        }
        const fixedColorsAfterColor = await assertNoGlobalFixedColorOverrides(
          page,
          'after Color interactions',
        );
        trace.globalFixedColorChecks.push(fixedColorsAfterColor);
        traceEvent(trace, 'global_fixed_colors_zero_after_color', fixedColorsAfterColor);
      }
    }
    assert(colorInteraction,
      'authoritative dropdown had no ordinary background for Color channel proof');

    const provedValues = new Set(allOptionProofs.map(proof => proof.requested.value));
    assert(provedValues.size === authoritativeOptions.length,
      `proved ${provedValues.size}/${authoritativeOptions.length} dropdown options`);
    for (const option of authoritativeOptions) {
      assert(provedValues.has(option.value),
        `authoritative dropdown option ${option.optionId} was not exercised`);
    }
    trace.authoritativeDropdown = {
      enumerated: authoritativeOptions,
      proofs: allOptionProofs,
      staticClassifications: [],
    };
    traceEvent(trace, 'authoritative_dropdown_complete', {
      optionCount: authoritativeOptions.length,
      proofCount: allOptionProofs.length,
      staticClassifications: [],
    });

    const panelGuardEvents = await collectLivePortGuardEvents(
      page,
      trace,
      'native_panel',
    );
    const simulationGuardEvents = await collectLivePortGuardEvents(
      simulationPage,
      trace,
      'titanic_simulation',
    );
    const simulationReadOnly = await simulationPage.evaluate(() => window.__readonlyMode);
    assert(simulationReadOnly === true,
      'Titanic simulation lost its no-save/no-output readonly guard');
    assert(!LIVE_PORTS.has(trace.isolation.enginePort)
      && !LIVE_PORTS.has(trace.isolation.staticPort),
    'isolated harness selected a live stack port');
    trace.livePortGuard.result = 'all live-port attempts refused before connection';
    trace.livePortGuard.panelPageEvents = panelGuardEvents.length;
    trace.livePortGuard.simulationPageEvents = simulationGuardEvents.length;
    trace.livePortGuard.simulationReadOnly = simulationReadOnly;
    traceEvent(trace, 'live_ports_and_simulation_writes_blocked', {
      blockedPorts: [...LIVE_PORTS],
      panelPageEvents: panelGuardEvents.length,
      simulationPageEvents: simulationGuardEvents.length,
      simulationReadOnly,
    });

    await page.click('#arm');
    await waitFor(async () => {
      const layer = await request(engineBase, 'GET', '/layers/state');
      return layer.status === 200
        && layer.data.active === 'deck'
        && layer.data.transition === null
        && layer.data.liveTouch.armed === false;
    }, 'native owner disarm handback');
    const performanceAfter = await request(engineBase, 'GET', '/performance-mode');
    assert(performanceAfter.status === 200 && performanceAfter.data.active === true,
      'Live Touch changed the global Performance Mode lock');
    assert(browserErrors.length === 0,
      `native browser reported errors: ${browserErrors.join(' | ')}`);
    traceEvent(trace, 'native_channel_disarmed_cleanly');
    trace.result = 'pass';
    console.log('Live Touch native-equivalent channel PASS');
  } catch (error) {
    trace.result = 'fail';
    trace.error = error.stack || error.message;
    if (page && !page.isClosed()) {
      try {
        await collectLivePortGuardEvents(page, trace, 'native_panel_failure');
      } catch (guardError) {
        trace.panelGuardCaptureError = guardError.message;
      }
    }
    if (simulationPage && !simulationPage.isClosed()) {
      try {
        await collectLivePortGuardEvents(
          simulationPage,
          trace,
          'titanic_simulation_failure',
        );
      } catch (guardError) {
        trace.simulationGuardCaptureError = guardError.message;
      }
    }
    if (page && !page.isClosed()) {
      try {
        trace.pageFailureState = await page.evaluate(() => ({
          armState: document.getElementById('armState')?.textContent,
          wirePhase: window.__wire?.phase,
          wireError: window.__wire?.lastError,
          errorToast: document.getElementById('wireStatus')?.textContent,
          pattern: document.getElementById('patternSel')?.value,
        }));
        await page.screenshot({
          path: path.join(artifactDir, 'failure_page.png'),
          fullPage: true,
        });
      } catch (captureError) {
        trace.failureCaptureError = captureError.message;
      }
    }
    process.exitCode = 1;
    console.error(error.stack || error.message);
  } finally {
    const cleanupErrors = [];
    await cleanupStep(cleanupErrors, 'viz socket', async () => {
      if (vizSocket) vizSocket.close();
    });
    await cleanupStep(cleanupErrors, 'browser', async () => {
      if (browser) await browser.close();
    });
    await cleanupStep(cleanupErrors, 'simulation browser', async () => {
      if (simulationBrowser) await simulationBrowser.close();
    });
    await cleanupStep(cleanupErrors, 'static server', async () => {
      if (staticServer) await closeServer(staticServer);
    });
    await cleanupStep(cleanupErrors, 'engine', async () => closeChild(engine));
    await cleanupStep(cleanupErrors, 'temp root', async () => removeTempRoot(tempRoot));
    if (cleanupErrors.length > 0) {
      trace.result = 'fail';
      trace.cleanupErrors = cleanupErrors;
      process.exitCode = 1;
      console.error(`Live Touch cleanup failed: ${JSON.stringify(cleanupErrors)}`);
    }
    trace.finishedAt = new Date().toISOString();
    trace.engineLogTail = engineLogs.join('').split(/\r?\n/).slice(-80);
    try {
      tracePath = writeTrace(trace, artifactDir);
      console.log(`Live Touch native channel trace: ${tracePath}`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`could not write Live Touch trace: ${error.message}`);
    }
  }
}

main().catch(error => {
  process.exitCode = 1;
  console.error(error.stack || error.message);
});
