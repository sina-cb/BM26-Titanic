#!/usr/bin/env node
/**
 * MarsinEngine CLI — Multichannel Pixelblaze rendering engine
 *
 * Renders PB-compatible patterns against the simulation pixel model,
 * maps to DMX via patch table, and sends sACN to the sim bridge.
 *
 * Usage:
 *   node engine.js --pattern rainbow [--fps 40] [--priority 100]
 *   node engine.js --list
 *   node engine.js --pattern fire --dry-run
 */

import fs from 'fs';

import { createWasmRuntime } from './lib/marsin_wasm_runtime.js';
import { startApiServer } from './lib/api_server.js';
import { IntensityController } from './lib/intensity_controller.js';
import { GlobalEffectsController } from './lib/global_effects_controller.js';
import { mapPixelsToSacn } from '../simulation/src/dmx/sacn_mapper.js';
import { UniverseRouter } from '../simulation/src/dmx/universe_router.js';
import { createSacnOutput } from './lib/sacn_output.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    if (fs.existsSync(configPath)) {
      return yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
    }
  } catch (e) {
    console.warn(`[Config] Failed to load config.yaml: ${e.message}`);
  }
  return {};
}

// ── CLI Argument Parser ───────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const cSacn = config.sacn || {};
  const cEngine = config.engine || {};
  const cServer = config.server || {};

  const opts = {
    pattern: null,
    modelName: null,
    fps: cEngine.fps || 40,
    priority: cSacn.priority || 100,
    dryRun: false,
    list: false,
    destinations: cSacn.destinations || (cSacn.destination ? [cSacn.destination] : ['127.0.0.1']),
    sourceName: cSacn.sourceName || 'MarsinEngine',
    port: cServer.port || 6968,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--pattern': case '-p':  opts.pattern = args[++i]; break;
      case '--model': case '-m':    opts.modelName = args[++i]; break;
      case '--fps':                 opts.fps = parseInt(args[++i], 10) || 40; break;
      case '--priority':            opts.priority = parseInt(args[++i], 10) || 100; break;
      case '--port':                opts.port = parseInt(args[++i], 10) || 6968; break;
      case '--dry-run':             opts.dryRun = true; break;
      case '--list': case '-l':     opts.list = true; break;
      case '--dest':                opts.destinations = [args[++i]]; break;
      case '--help': case '-h':
        console.log(`
  MarsinEngine — Multichannel Pixelblaze Rendering Engine

  Usage:
    node engine.js --pattern <name> --model <name> [options]

  Options:
    --pattern, -p <name>   Pattern to render (required)
    --model, -m <name>     Model file to load (required)
    --fps <n>              Target framerate (default: 40)
    --priority <n>         sACN priority (default: 100)
    --dry-run              Load and compile only, no sACN output
    --list, -l             List available patterns
    --dest <ip>            sACN destination IP (default: 127.0.0.1)
    --help, -h             Show this help
`);
        process.exit(0);
    }
  }
  return opts;
}

// ── Pattern Discovery ─────────────────────────────────────────────────────
function listPatterns() {
  const dir = path.join(__dirname, 'patterns');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''));
}

function loadPattern(name) {
  const filePath = path.join(__dirname, 'patterns', `${name}.js`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Pattern not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// ── Model Loader ──────────────────────────────────────────────────────────
async function loadModel(modelName) {
  const modelPath = path.join(__dirname, 'models', `${modelName}.js`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}\nRun the simulation and save the model first.`);
  }
  // Dynamic ESM import
  const modelUrl = 'file://' + modelPath;
  const mod = await import(modelUrl);
  return { pixelCount: mod.pixelCount, pixels: mod.pixels };
}

// ── Render Loop ───────────────────────────────────────────────────────────
function createRenderLoop(runtime, model, dmxRouter, universeIds, sacnOut, fps, intensityController, globalEffectsController, statsCallback) {
  let running = false;
  let timer = null;
  let frameCount = 0;
  let windowFrames = 0;
  let startTime = 0;
  let lastStatsTime = 0;
  const intervalMs = Math.round(1000 / fps);
  const pixelCount = model.pixels.length;

  // We need metadata arrays for 6ch WASM call
  // We can just construct them lazily the first time or pass 0 for null (if memory isn't used)
  const metaBuf = null;

  function tick() {
    if (!running) return;

    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // seconds

    // Render all pixels in one WASM call (batch)
    runtime.beginFrame(elapsed);

    // Call 6-channel function. 
    // Wait, the runtime needs metaPtr? We can just pass 0 if none.
    // In marsin_wasm_runtime.js, renderAll6ch() allocates internally if coords are set!
    const outBuf = runtime.renderAll6ch();

    // Reattach results directly onto model pixels so they have `.r`, `.g`, etc for sacn_mapper
    for (let i = 0; i < pixelCount; i++) {
      const off = i * 6;
      model.pixels[i].r = outBuf[off] / 255;
      model.pixels[i].g = outBuf[off + 1] / 255;
      model.pixels[i].b = outBuf[off + 2] / 255;
      model.pixels[i].w = outBuf[off + 3] / 255;
      model.pixels[i].a = outBuf[off + 4] / 255;
      model.pixels[i].u = outBuf[off + 5] / 255;
    }

    // Apply global DMX-override level effects (Vintage .w boost, UV boost)
    if (globalEffectsController) globalEffectsController.applyPixels(model.pixels);

    // Apply any hardware blackout or section intensity scaling from the API (Master cutoffs)
    if (intensityController) intensityController.apply(model.pixels);

    // Map to DMX (writes directly into dmxRouter's _read buffer via getFullFrame)
    mapPixelsToSacn(model.pixels, dmxRouter);

    // Collect sACN outbound buffer
    const dmxBuffers = {};
    for (const u of universeIds) {
      const frame = dmxRouter.getFullFrame(u);
      if (frame) dmxBuffers[u] = frame;
    }

    // Apply explicit raw-hardware bypasses directly onto the payload arrays (like Fogger)
    if (globalEffectsController) globalEffectsController.applyDmx(dmxBuffers);

    // Send sACN using the _read buffers
    sacnOut.sendFrame(dmxBuffers);

    frameCount++;
    windowFrames++;

    // Stats every 1 second (silently updating the UI without spamming standard output)
    if (now - lastStatsTime > 1000) {
      const windowSec = (now - lastStatsTime) / 1000;
      const windowFps = Math.round(windowFrames / windowSec);
      
      let patchedCount = 0;
      for (const px of model.pixels) if (px.patch && px.patch.universe) patchedCount++;

      lastStatsTime = now;
      windowFrames = 0;

      if (statsCallback) {
        statsCallback({ fps: windowFps, patched: patchedCount });
      }
    }
  }

  function start() {
    running = true;
    startTime = performance.now();
    lastStatsTime = startTime;
    frameCount = 0;
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, get frameCount() { return frameCount; } };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log(`
  ╔══════════════════════════════════════════╗
  ║       🔥 MarsinEngine v2.0 (WASM VM)    ║
  ║    Multichannel Rendering Pipeline       ║
  ╚══════════════════════════════════════════╝
`);

  // List patterns
  if (opts.list) {
    const patterns = listPatterns();
    console.log('  Available patterns:');
    patterns.forEach(p => console.log(`    • ${p}`));
    console.log(`\n  ${patterns.length} pattern(s) found.\n`);
    process.exit(0);
  }

  if (!opts.pattern) {
    console.error('  ❌ No pattern specified. Use --pattern <name> or --list');
    process.exit(1);
  }

  if (!opts.modelName) {
    console.error('  ❌ No model specified. Use --model <name>');
    process.exit(1);
  }

  // 1. Load model
  console.log('  Loading model...');
  let model;
  try {
    model = await loadModel(opts.modelName);
    console.log(`  ✅ Model loaded: ${model.pixelCount} pixels`);
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
    process.exit(1);
  }

  // 2. Load pattern
  console.log(`  Loading pattern: ${opts.pattern}`);
  let patternCode;
  try {
    patternCode = loadPattern(opts.pattern);
    console.log(`  ✅ Pattern loaded (${patternCode.length} bytes)`);
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
    process.exit(1);
  }

  // 3. Create WASM runtime and compile
  console.log(`  Initializing WASM runtime...`);
  let runtime;
  try {
    runtime = await createWasmRuntime(model.pixelCount);
    console.log(`  ✅ WASM MarsinVM loaded (real compiler + VM)`);
  } catch (err) {
    console.error(`  ❌ Failed to load WASM runtime: ${err.message}`);
    process.exit(1);
  }

  console.log(`  Compiling pattern...`);
  const result = runtime.compile(patternCode);
  if (!result.ok) {
    console.error(`  ❌ Compile error: ${result.error}`);
    process.exit(1);
  }
  console.log('  ✅ Pattern compiled via MarsinCompiler (bytecode)');

  // Set pixel coordinates for batch rendering
  runtime.setCoords(model.pixels);

  // Set V2 metadata for batch rendering, mapping abbreviation keys
  const metaArray = model.pixels.map(px => ({
    controllerId: px.cId || 0,
    sectionId: px.sId || 0,
    fixtureId: px.fId || 0,
    viewMask: px.vMask || 0
  }));
  runtime.setPixelMeta(metaArray);

  // 4. Create global DMX mapper (reusing simulation architecture!)
  const dmxRouter = new UniverseRouter('highest_priority_source_lock');
  const universeIds = [];
  
  // Force include global effect universes so hardware triggers work even if no pixels are mapped
  const engConfig = loadConfig();
  if (engConfig.global_effects && engConfig.global_effects.fogger) {
    const fogU = engConfig.global_effects.fogger.universe;
    if (fogU && !universeIds.includes(fogU)) {
      universeIds.push(fogU);
      dmxRouter.addUniverse(fogU);
    }
  }

  let patchedPixelCount = 0;
  for (const px of model.pixels) {
    if (px.patch && px.patch.universe) {
      if (!universeIds.includes(px.patch.universe)) {
        universeIds.push(px.patch.universe);
        dmxRouter.addUniverse(px.patch.universe);
      }
      patchedPixelCount++;
    }
  }
  console.log(`  ✅ Shared DMX mapper: ${patchedPixelCount}/${model.pixelCount} pixels patched across ${universeIds.length} universe(s) [${universeIds.join(', ')}]`);

  if (patchedPixelCount === 0) {
    console.warn('  ⚠️  No patched pixels found in model. Running in render-only mode.');
    console.warn('     Re-export the model from the simulation after adding DMX patches.');
  }

  // 5. Dry run check
  if (opts.dryRun) {
    console.log('\n  🏁 Dry run complete. Pattern loads and compiles OK.\n');
    runtime.beginFrame(0);
    const rgbBuf = runtime.renderAll6ch();
    console.log(`  Test render pixel 0: RGBWAU(${rgbBuf[0]}, ${rgbBuf[1]}, ${rgbBuf[2]}, ${rgbBuf[3]}, ${rgbBuf[4]}, ${rgbBuf[5]})`);
    for (let i = 0; i < model.pixels.length; i++) {
        const off = i * 6;
        model.pixels[i].r = rgbBuf[off] / 255;
        model.pixels[i].g = rgbBuf[off + 1] / 255;
        model.pixels[i].b = rgbBuf[off + 2] / 255;
        model.pixels[i].w = rgbBuf[off + 3] / 255;
        model.pixels[i].a = rgbBuf[off + 4] / 255;
        model.pixels[i].u = rgbBuf[off + 5] / 255;
    }
    mapPixelsToSacn(model.pixels, dmxRouter);
    process.exit(0);
  }

  // 6. Create sACN output
  const sacnOut = createSacnOutput({
    universes: universeIds,
    priority: opts.priority,
    destinations: opts.destinations,
    sourceName: opts.sourceName,
  });
  sacnOut.start();

  // 7. Start API Server & Render Loop
  const broadcastStatsRef = { publish: () => {} };
  const intensityController = new IntensityController();
  const globalEffectsController = new GlobalEffectsController(loadConfig());
  const apiServer = startApiServer(opts, runtime, './patterns', broadcastStatsRef, intensityController, globalEffectsController);

  const loop = createRenderLoop(runtime, model, dmxRouter, universeIds, sacnOut, opts.fps, intensityController, globalEffectsController, (stats) => {
    broadcastStatsRef.publish(stats);
  });
  console.log(`  ▶ Rendering "${opts.pattern}" at ${opts.fps} fps → sACN [${universeIds.join(', ')}] (WASM MarsinVM)\n`);
  loop.start();

  // 8. Graceful shutdown
  function shutdown() {
    console.log('\n\n  ⏹ Stopping...');
    loop.stop();

    // Send blackout frame
    for (let i = 0; i < model.pixels.length; i++) {
        model.pixels[i].r = 0;
        model.pixels[i].g = 0;
        model.pixels[i].b = 0;
        model.pixels[i].w = 0;
        model.pixels[i].a = 0;
        model.pixels[i].u = 0;
    }
    mapPixelsToSacn(model.pixels, dmxRouter);

    const blackBuffers = {};
    for (const u of universeIds) {
      blackBuffers[u] = dmxRouter.getFullFrame(u);
    }

    sacnOut.sendFrame(blackBuffers).then(() => {
      sacnOut.stop();
      runtime.destroy();
      console.log(`  ✅ Shutdown complete (${loop.frameCount} frames rendered)\n`);
      process.exit(0);
    });

    // Force exit after 2s
    setTimeout(() => process.exit(0), 2000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
