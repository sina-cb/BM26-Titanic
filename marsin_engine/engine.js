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
import path from 'path';
import { fileURLToPath } from 'url';
import { createRuntime } from './lib/marsin_runtime.js';
import { createDmxMapper } from './lib/dmx_mapper.js';
import { createSacnOutput } from './lib/sacn_output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI Argument Parser ───────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    pattern: null,
    fps: 40,
    priority: 100,
    dryRun: false,
    list: false,
    backend: 'auto',
    destination: '127.0.0.1',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--pattern': case '-p':  opts.pattern = args[++i]; break;
      case '--fps':                 opts.fps = parseInt(args[++i], 10) || 40; break;
      case '--priority':            opts.priority = parseInt(args[++i], 10) || 100; break;
      case '--dry-run':             opts.dryRun = true; break;
      case '--list': case '-l':     opts.list = true; break;
      case '--backend':             opts.backend = args[++i]; break;
      case '--dest':                opts.destination = args[++i]; break;
      case '--help': case '-h':
        console.log(`
  MarsinEngine — Multichannel Pixelblaze Rendering Engine

  Usage:
    node engine.js --pattern <name> [options]

  Options:
    --pattern, -p <name>   Pattern to render (required)
    --fps <n>              Target framerate (default: 40)
    --priority <n>         sACN priority (default: 100)
    --dry-run              Load and compile only, no sACN output
    --list, -l             List available patterns
    --backend <type>       Force backend: js, wasm, gpu (default: auto)
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
async function loadModel() {
  const modelPath = path.join(__dirname, 'models', 'model.js');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}\nRun the simulation and save the model first.`);
  }
  // Dynamic ESM import
  const modelUrl = 'file://' + modelPath;
  const mod = await import(modelUrl);
  return { pixelCount: mod.pixelCount, pixels: mod.pixels };
}

// ── Render Loop ───────────────────────────────────────────────────────────
function createRenderLoop(runtime, mapper, sacnOut, fps) {
  let running = false;
  let timer = null;
  let frameCount = 0;
  let windowFrames = 0;
  let startTime = 0;
  let lastStatsTime = 0;
  const intervalMs = Math.round(1000 / fps);

  function tick() {
    if (!running) return;

    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // seconds

    // Render all pixels
    runtime.beginFrame(elapsed);
    const colors = [];
    const { pixels } = runtime;
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      colors.push(runtime.renderPixel(i, px.nx, px.ny, px.nz));
    }

    // Map to DMX
    const dmxBuffers = mapper.mapFrame(colors);

    // Send sACN
    sacnOut.sendFrame(dmxBuffers);

    frameCount++;
    windowFrames++;

    // Stats every 5 seconds
    if (now - lastStatsTime > 5000) {
      const windowSec = (now - lastStatsTime) / 1000;
      const windowFps = Math.round(windowFrames / windowSec);
      const renderMs = (performance.now() - now).toFixed(1);
      process.stdout.write(`\r  ⚡ ${frameCount} frames, ${windowFps} fps, ${renderMs}ms/frame, ${mapper.patchedPixelCount} pixels`);
      lastStatsTime = now;
      windowFrames = 0;
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
  ╔══════════════════════════════════════╗
  ║       🔥 MarsinEngine v1.0          ║
  ║   Multichannel Rendering Pipeline   ║
  ╚══════════════════════════════════════╝
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

  // 1. Load model
  console.log('  Loading model...');
  let model;
  try {
    model = await loadModel();
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

  // 3. Create runtime and compile
  console.log(`  Compiling pattern (backend: ${opts.backend})...`);
  const runtime = createRuntime(model.pixelCount);
  runtime.pixels = model.pixels; // attach for coord lookup
  const result = runtime.compile(patternCode);
  if (!result.ok) {
    console.error(`  ❌ Compile error: ${result.error}`);
    process.exit(1);
  }
  console.log('  ✅ Pattern compiled successfully');

  // 4. Create DMX mapper
  const mapper = createDmxMapper(model.pixels);
  console.log(`  ✅ DMX mapper: ${mapper.patchedPixelCount}/${mapper.totalPixelCount} pixels patched across ${mapper.universeIds.length} universe(s) [${mapper.universeIds.join(', ')}]`);

  if (mapper.patchedPixelCount === 0) {
    console.warn('  ⚠️  No patched pixels found in model. Running in render-only mode.');
    console.warn('     Re-export the model from the simulation after adding DMX patches.');
  }

  // 5. Dry run check
  if (opts.dryRun) {
    console.log('\n  🏁 Dry run complete. Pattern loads and compiles OK.\n');
    // Quick render test
    runtime.beginFrame(0);
    const testColor = runtime.renderPixel(0, 0, 0, 0);
    console.log(`  Test render pixel 0: RGB(${testColor.r}, ${testColor.g}, ${testColor.b})\n`);
    process.exit(0);
  }

  // 6. Create sACN output
  const sacnOut = createSacnOutput({
    universes: mapper.universeIds,
    priority: opts.priority,
    destination: opts.destination,
  });
  sacnOut.start();

  // 7. Start render loop
  const loop = createRenderLoop(runtime, mapper, sacnOut, opts.fps);
  console.log(`\n  ▶ Rendering "${opts.pattern}" at ${opts.fps} fps → sACN [${mapper.universeIds.join(', ')}]\n`);
  loop.start();

  // 8. Graceful shutdown
  function shutdown() {
    console.log('\n\n  ⏹ Stopping...');
    loop.stop();

    // Send blackout frame
    const blackColors = model.pixels.map(() => ({ r: 0, g: 0, b: 0 }));
    const blackBuffers = mapper.mapFrame(blackColors);
    sacnOut.sendFrame(blackBuffers).then(() => {
      sacnOut.stop();
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
