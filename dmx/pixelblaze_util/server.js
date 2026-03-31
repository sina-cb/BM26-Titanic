'use strict';
/**
 * PixelBlaze Utility — Server
 *
 * Express + WebSocket server that:
 *   1. Serves the browser-based pattern editor (public/)
 *   2. Exposes /api/universes for the UI to populate the target dropdown
 *   3. Accepts pattern code + universe selection via WebSocket
 *   4. Compiles the pattern with MarsinEngine (WASM),
 *      runs a render loop, and pushes the output to physical
 *      DMX fixtures via Art-Net UDP
 *
 * Usage:
 *   cd dmx/pixelblaze_util
 *   npm install
 *   node server.js            # http://localhost:3000
 */

const fs      = require('fs');
const path    = require('path');
const http    = require('http');
const express = require('express');
const yaml    = require('js-yaml');
const { WebSocketServer } = require('ws');

const { DmxHandler, DmxRenderLoop } = require('../index');

// ── Paths ──────────────────────────────────────────────────────────────────
const UNIVERSES_YAML = path.join(__dirname, '..', 'universes.yaml');
const WASM_DIR       = path.join(__dirname, '..', '..', 'simulation', 'lib', 'marsin-engine');
const PATTERNS_DIR   = path.join(__dirname, '..', '..', 'simulation', 'pb');
const PORT           = parseInt(process.env.PORT, 10) || 3000;

// ── MarsinEngine (loaded dynamically because it's an Emscripten CJS module) ─
let MarsinEngineModule = null;
let engineReady = false;

// Internal engine state
let engineHandle = 0;
let compileFn, beginFrameFn, renderPixelFn, destroyVmFn, getErrorFn;

async function initEngine() {
  try {
    const factoryPath = path.join(WASM_DIR, 'marsin-engine.js');
    if (!fs.existsSync(factoryPath)) {
      console.error(`[Engine] WASM not found at ${factoryPath}`);
      return;
    }
    const factory = require(factoryPath);
    MarsinEngineModule = await factory({
      locateFile: (f) => f.endsWith('.wasm') ? path.join(WASM_DIR, 'marsin-engine.wasm') : f,
    });

    compileFn     = MarsinEngineModule.cwrap('marsin_compile',       'number', ['string']);
    beginFrameFn  = MarsinEngineModule.cwrap('marsin_begin_frame',   null,     ['number', 'number']);
    renderPixelFn = MarsinEngineModule.cwrap('marsin_render_pixel',  'number', ['number', 'number', 'number', 'number', 'number']);
    destroyVmFn   = MarsinEngineModule.cwrap('marsin_destroy_vm',    null,     ['number']);
    getErrorFn    = MarsinEngineModule.cwrap('marsin_get_error',     'string', []);

    engineReady = true;
    console.log('[Engine] MarsinEngine WASM loaded successfully');
  } catch (err) {
    console.error('[Engine] Failed to load WASM:', err.message);
  }
}

function compilePattern(code) {
  if (!engineReady) return { ok: false, error: 'Engine not initialized' };
  if (engineHandle) { destroyVmFn(engineHandle); engineHandle = 0; }

  engineHandle = compileFn(code);
  if (engineHandle === 0) {
    return { ok: false, error: getErrorFn() || 'Unknown compile error' };
  }
  return { ok: true };
}

// ── DmxHandler ─────────────────────────────────────────────────────────────
const dmxHandler = new DmxHandler(UNIVERSES_YAML);
let dmxInitialized = false;

async function ensureDmxInit() {
  if (dmxInitialized) return;
  await dmxHandler.init();
  dmxInitialized = true;
}

// ── Render Loop ────────────────────────────────────────────────────────────
let renderLoop = null;
let activeUniverseId = null;

/**
 * Build a flat pixel list from all fixtures in a universe.
 * Each entry: { fixture, pixelIndex, fixtureType }
 * For EndyshowBar: maps to setPixel(n, r, g, b)
 * For UkingPar:    maps to setColor(r, g, b)
 * For VintageLed:  maps to setAuxRgb(r, g, b) (global) + setHeadAuxRgb per head
 */
function buildPixelMap(universe) {
  const pixels = [];
  for (const [label, fixture] of universe.fixtures) {
    const type = fixture.constructor.name;
    if (type === 'EndyshowBar') {
      // 32 individually addressable RGB pixels
      for (let n = 1; n <= fixture._rgbPixels; n++) {
        pixels.push({ fixture, type, pixelIndex: n });
      }
    } else if (type === 'UkingPar') {
      // Single RGB pixel
      pixels.push({ fixture, type, pixelIndex: 1 });
    } else if (type === 'VintageLed') {
      // 6 heads with per-head aux RGB (33ch mode) or 1 global aux RGB
      if (fixture._is33) {
        for (let h = 1; h <= 6; h++) {
          pixels.push({ fixture, type, pixelIndex: h });
        }
      } else {
        pixels.push({ fixture, type, pixelIndex: 1 });
      }
    }
  }
  return pixels;
}

function startRenderLoop(universeId) {
  if (renderLoop) renderLoop.stop();

  const universe = dmxHandler.universe(universeId);
  activeUniverseId = universeId;
  const pixelMap = buildPixelMap(universe);
  const pixelCount = pixelMap.length;

  console.log(`[Render] Starting loop on "${universeId}" — ${pixelCount} pixels`);

  // Set fixtures to a clean state: dimmer max, strobe off, manual mode
  for (const [, fixture] of universe.fixtures) {
    const type = fixture.constructor.name;
    if (type === 'UkingPar') {
      fixture.setDimmer(255);
      fixture.setStrobe(0);
      fixture.setFunction(0);
    } else if (type === 'EndyshowBar') {
      fixture.setRgbStrobe(0);
      fixture.setRgbEffect(0);
    } else if (type === 'VintageLed') {
      fixture.setDimmer(255);
      fixture.setStrobe(0);
      fixture.setMainEffect(0);
      fixture.setAuxEffect(0);
    }
  }

  renderLoop = new DmxRenderLoop(dmxHandler);
  renderLoop.start(40, ({ elapsed }) => {
    if (!engineHandle) return;

    beginFrameFn(engineHandle, elapsed);

    for (let i = 0; i < pixelCount; i++) {
      const px   = pixelMap[i];
      const norm = pixelCount > 1 ? i / (pixelCount - 1) : 0;
      const packed = renderPixelFn(engineHandle, i, norm, 0, 0);
      const r = (packed >> 16) & 0xFF;
      const g = (packed >> 8) & 0xFF;
      const b = packed & 0xFF;

      if (px.type === 'EndyshowBar') {
        px.fixture.setPixel(px.pixelIndex, r, g, b);
      } else if (px.type === 'UkingPar') {
        px.fixture.setColor(r, g, b);
      } else if (px.type === 'VintageLed') {
        if (px.fixture._is33) {
          px.fixture.setHeadAuxRgb(px.pixelIndex, r, g, b);
        } else {
          px.fixture.setAuxRgb(r, g, b);
        }
      }
    }

    universe.send();
  });
}

function stopRenderLoop() {
  if (renderLoop) {
    renderLoop.stop();
    renderLoop = null;
  }
  if (activeUniverseId && dmxInitialized) {
    try { dmxHandler.universe(activeUniverseId).blackout(); } catch (_) {}
  }
  activeUniverseId = null;
}

// ── Preset Patterns ────────────────────────────────────────────────────────
function loadPresets() {
  const presets = [];
  if (!fs.existsSync(PATTERNS_DIR)) return presets;
  const files = fs.readdirSync(PATTERNS_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const code = fs.readFileSync(path.join(PATTERNS_DIR, file), 'utf8');
      // Skip 2D-only patterns for simplicity
      if (code.includes('render2D') && !code.includes('export function render(')) continue;
      presets.push({ name: path.basename(file, '.js'), code });
    } catch (_) {}
  }
  return presets;
}

// ── Express App ────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// GET /api/universes — list available universes
app.get('/api/universes', (req, res) => {
  try {
    const raw = fs.readFileSync(UNIVERSES_YAML, 'utf8');
    const cfg = yaml.load(raw);
    const universes = (cfg.universes || []).map(u => {
      const fixtureCount = (u.fixtures || []).length;
      return { id: u.id, name: u.name || u.id, fixtureCount };
    });
    res.json({ universes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/presets — list available preset patterns
app.get('/api/presets', (req, res) => {
  res.json({ presets: loadPresets() });
});

// ── HTTP + WebSocket Server ────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  // Send initial state
  ws.send(JSON.stringify({
    type: 'status',
    engineReady,
    running: !!renderLoop?.running,
    universe: activeUniverseId,
  }));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      case 'compile': {
        const { code, universeId } = msg;
        if (!code || !universeId) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing code or universeId' }));
          return;
        }

        // Ensure DMX is ready
        try { await ensureDmxInit(); } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: `DMX init failed: ${err.message}` }));
          return;
        }

        // Compile
        const result = compilePattern(code);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', error: result.error }));
          return;
        }

        // Start render loop on selected universe
        try {
          startRenderLoop(universeId);
          ws.send(JSON.stringify({ type: 'running', universeId }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
        break;
      }

      case 'stop': {
        stopRenderLoop();
        ws.send(JSON.stringify({ type: 'stopped' }));
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
(async () => {
  await initEngine();

  server.listen(PORT, () => {
    console.log(`\n  🎆 PixelBlaze Utility running at http://localhost:${PORT}\n`);
  });
})();

// ── Graceful Shutdown ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping…');
  stopRenderLoop();
  if (dmxInitialized) dmxHandler.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopRenderLoop();
  if (dmxInitialized) dmxHandler.close();
  process.exit(0);
});
