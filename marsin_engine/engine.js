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

import { WasmHost } from './lib/wasm_host.js';
import { PatternMixer } from './lib/pattern_mixer.js';
import { ChannelParamRouter } from './lib/channel_param_router.js';
import { startApiServer } from './lib/api_server.js';
import { IntensityController } from './lib/intensity_controller.js';
import { GlobalEffectsController } from './lib/global_effects_controller.js';
import { ParamCenter } from './lib/param_center.js';
import { OscListener } from './lib/osc_listener.js';
import { AudioCapture } from './lib/audio_capture.js';
import { AudioAnalyzer } from './lib/audio_analyzer.js';
import { BpmSpeedSync } from './lib/bpm_speed_sync.js';
import { mergeAudioConfig, pickLiveFields } from './lib/audio_config.js';
import {
  loadSceneAudio, saveSceneAudio,
} from './lib/audio_config_store.js';
import { parseEngineFlags } from './lib/engine_cli_flags.js';
import { handleAudioCliFlags } from './lib/audio_mic_chooser.js';
import { resolveFfmpegPath } from './lib/ffmpeg_resolver.js';
import { mapPixelsToSacn } from '../simulation/src/dmx/sacn_mapper.js';
import { UniverseRouter } from '../simulation/src/dmx/universe_router.js';
import { createSacnOutput } from './lib/sacn_output.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { execSync } from 'child_process';

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

  const effectsPath = path.join(__dirname, 'models', `${modelName}.effects.js`);
  let specialEffects = [];
  try {
    if (fs.existsSync(effectsPath)) {
      const effectsUrl = 'file://' + effectsPath;
      const effectsMod = await import(effectsUrl);
      specialEffects = effectsMod.specialEffects || [];
    }
  } catch (err) {
    console.warn(`[Model] Could not load companion effects model: ${err.message}`);
  }

  return { pixelCount: mod.pixelCount, pixels: mod.pixels, specialEffects };
}

// ── Render Loop ───────────────────────────────────────────────────────────
function createRenderLoop(mixer, model, dmxRouter, universeIds, sacnOut, fps, intensityController, globalEffectsController, paramCenter, statsCallback) {
  let running = false;
  let timer = null;
  let frameCount = 0;
  let windowFrames = 0;
  let startTime = 0;
  let lastStatsTime = 0;
  let lastVisTime = 0;
  const intervalMs = Math.round(1000 / fps);
  const pixelCount = model.pixels.length;

  // We need metadata arrays for 6ch WASM call
  // We can just construct them lazily the first time or pass 0 for null (if memory isn't used)
  const metaBuf = null;

  function tick() {
    if (!running) return;

    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // seconds

    // Flush pending shared parameters (CPC) to all active VMs before frame compute
    if (paramCenter) paramCenter.flushDirty(mixer.wasmHost);

    // Render all pixels in one WASM call (batch)
    mixer.beginFrame(elapsed);

    // Call 6-channel function. 
    // Wait, the runtime needs metaPtr? We can just pass 0 if none.
    // In marsin_wasm_runtime.js, renderAll6ch() allocates internally if coords are set!
    const outBuf = mixer.renderAll6ch();

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

    // Vis data broadcast at ~10fps (every 100ms)
    if (now - lastVisTime > 100) {
      lastVisTime = now;
      if (statsCallback) {
        const visData = mixer.getVisData();
        const visPayload = {};
        for (const [key, rgb] of Object.entries(visData)) {
          visPayload[key] = rgb ? Buffer.from(rgb).toString('base64') : null;
        }
        // `master` is set by pattern_mixer from the pre-dimmer composition,
        // so the UI sees what the show is producing — not the dimmed-down
        // rig output. Section dimmers are still applied to sACN, but they
        // would otherwise wash the UI preview out to near-black.
        //
        // For anyone who wants the post-processed signal (blackout +
        // section dimmers + global rig FX), broadcast it as `rig` so the
        // hardware-truth preview is available too without clobbering the
        // composition view.
        const rigBuffer = new Uint8Array(pixelCount * 6);
        for (let i = 0; i < pixelCount; i++) {
          const off = i * 6;
          const px = model.pixels[i];
          rigBuffer[off] = Math.min(255, Math.max(0, Math.round(px.r * 255)));
          rigBuffer[off + 1] = Math.min(255, Math.max(0, Math.round(px.g * 255)));
          rigBuffer[off + 2] = Math.min(255, Math.max(0, Math.round(px.b * 255)));
          rigBuffer[off + 3] = Math.min(255, Math.max(0, Math.round(px.w * 255)));
          rigBuffer[off + 4] = Math.min(255, Math.max(0, Math.round(px.a * 255)));
          rigBuffer[off + 5] = Math.min(255, Math.max(0, Math.round(px.u * 255)));
        }
        visPayload['rig'] = Buffer.from(rigBuffer).toString('base64');
        statsCallback({ type: 'vis', vis: visPayload, pixelCount });
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

  // ── Audio CLI flags (mic discovery / selection) ─────────────────────────
  // Handled BEFORE the engine boots so --list_mics / --choose_mic /
  // --clear_mic short-circuit cleanly and don't kill the operator's
  // running show by accident. `--mic` and `--choose_mic --start` fall
  // through and continue normal boot.
  //
  // Mutating audio flags require --model because mic selection now lives
  // inside the scene's audio_state.yaml (one source of truth — see
  // docs/25 §7). --list_mics is read-only and works without --model.
  const audioFlags = parseEngineFlags(process.argv.slice(2));
  const _bootCfgForAudio = loadConfig();
  const _earlySceneDir = opts.modelName
    ? path.join(__dirname, 'states', opts.modelName)
    : null;
  const rawFfmpegPath = _bootCfgForAudio?.audio?.capture?.ffmpegPath || 'ffmpeg';
  const resolvedFfmpegPath = await resolveFfmpegPath(rawFfmpegPath);
  const audioCliResult = await handleAudioCliFlags(audioFlags, {
    sceneDir: _earlySceneDir,
    ffmpegPath: resolvedFfmpegPath,
    platform: process.platform,
  });
  if (audioCliResult.shouldExit) {
    process.exit(audioCliResult.exitCode || 0);
  }

  console.log(`
  ╔══════════════════════════════════════════╗
  ║       🔥 MarsinEngine v2.0 (WASM VM)    ║
  ║    Multichannel Rendering Pipeline       ║
  ╚══════════════════════════════════════════╝
`);

  // Kill existing ports
  const engineConfig = loadConfig();
  const portsToKill = [];
  if (engineConfig.server && engineConfig.server.port) portsToKill.push(engineConfig.server.port);
  if (engineConfig.client && engineConfig.client.web && engineConfig.client.web.port) portsToKill.push(engineConfig.client.web.port);
  
  if (portsToKill.length > 0) {
    try {
      execSync(`npx -y kill-port ${portsToKill.join(' ')}`, { stdio: 'ignore', shell: process.platform === 'win32' });
    } catch (e) {
      // Ignore errors if ports are already free
    }
  }

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
    console.log(`  ✅ Model loaded: ${model.pixelCount} pixels` + (model.specialEffects?.length ? ` (${model.specialEffects.length} special effects)` : ''));
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
  console.log(`  Initializing WASM host...`);
  let wasmHost;
  try {
    wasmHost = new WasmHost();
    await wasmHost.init(model.pixelCount);
    console.log(`  ✅ WASM MarsinVM loaded (real compiler + VM)`);
  } catch (err) {
    console.error(`  ❌ Failed to load WASM host: ${err.message}`);
    process.exit(1);
  }

  console.log(`  Compiling pattern...`);
  const result = wasmHost.compile(patternCode);
  if (!result.ok) {
    console.error(`  ❌ Compile error: ${result.error}`);
    process.exit(1);
  }
  console.log('  ✅ Pattern compiled via MarsinCompiler (bytecode)');

  // 3a. Instantiate CPC.
  //
  // `osc.gainMax` (config.yaml) reshapes the per-stem gain ranges
  // before the CPC store is seeded. Default is 2 — matches the
  // registry's literal range — so omitting the config is a no-op.
  // Clamping inside ParamCenter ensures the override default never
  // exceeds the new max even if someone writes a tiny gainMax.
  const gainMax = Number((engineConfig.osc || {}).gainMax) || 2;
  const stemGainOverride = { range: [0, gainMax], default: Math.min(1, gainMax) };
  const paramCenter = new ParamCenter(null, {
    registryOverrides: {
      stemsVocalsGain: stemGainOverride,
      stemsBassGain:   stemGainOverride,
      stemsDrumsGain:  stemGainOverride,
      // Mic-derived bands use the same per-band gain contract as
      // stems, so they share the gainMax override.
      micLowGain:  stemGainOverride,
      micMidGain:  stemGainOverride,
      micHighGain: stemGainOverride,
      micKickGain: stemGainOverride,
    },
  });

  const mixer = new PatternMixer({ wasmHost, pixelCount: model.pixelCount });
  mixer.patternsDir = path.join(__dirname, 'patterns');
  mixer.onChannelRemoved = (channelId) => paramCenter.unregisterChannel(channelId);
  const paramRouter = new ChannelParamRouter(mixer, paramCenter);
  
  paramCenter.registerChannel('ch_base', result.handle, wasmHost.getExports(result.handle));
  wasmHost.beginFrame(result.handle, 0);
  paramCenter.applySnapshot(wasmHost);
  
  mixer.addChannel({
    id: 'ch_base',
    name: 'Base',
    pattern: opts.pattern,
    handle: result.handle,
    mode: 'blend_screen',
    fader: 1.0,
    enabled: true
  });

  // Set pixel coordinates for batch rendering
  wasmHost.setCoords(model.pixels);

  // Set V2 metadata for batch rendering, mapping abbreviation keys
  const metaArray = model.pixels.map(px => ({
    controllerId: px.cId || 0,
    sectionId: px.sId || 0,
    fixtureId: px.fId || 0,
    viewMask: px.vMask || 0
  }));
  wasmHost.setPixelMeta(metaArray);

  // 4. Create global DMX mapper (reusing simulation architecture!)
  const dmxRouter = new UniverseRouter('highest_priority_source_lock');
  const universeIds = [];
  
  // Force include global effect universes so hardware triggers work even if no pixels are mapped
  let patchedPixelCount = 0;
  
  const registerUniverse = (patch) => {
    if (patch && patch.universe) {
      if (!universeIds.includes(patch.universe)) {
        universeIds.push(patch.universe);
        dmxRouter.addUniverse(patch.universe);
      }
    }
  };

  for (const px of model.pixels) {
    if (px.patch) {
      registerUniverse(px.patch);
      patchedPixelCount++;
    }
  }
  
  for (const fx of (model.specialEffects || [])) {
    if (fx.patch) {
      registerUniverse(fx.patch);
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
    mixer.beginFrame(0);
    const rgbBuf = mixer.renderAll6ch();
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
  globalEffectsController.initFromModel(model.specialEffects || model.pixels);
  
  // 7a. Audio analysis state (filled below). Passed by reference into
  //     engineCore so api_server's /audio routes can reach the live
  //     analyzer for reconfigure / status without circular wiring.
  const audioState = {
    capture: null,
    analyzer: null,
    config: null,
    lastStatus: { enabled: false, error: null },
    lastKickAt: 0,
  };

  const engineCore = { mixer, wasmHost, paramRouter, paramCenter, model, audioState };
  const apiServer = startApiServer(opts, engineCore, './patterns', broadcastStatsRef, intensityController, globalEffectsController);

  const loop = createRenderLoop(mixer, model, dmxRouter, universeIds, sacnOut, opts.fps, intensityController, globalEffectsController, paramCenter, (stats) => {
    broadcastStatsRef.publish(stats);
  });
  console.log(`  ▶ Rendering "${opts.pattern}" at ${opts.fps} fps → sACN [${universeIds.join(', ')}] (WASM MarsinVM)\n`);

  loop.start();

  // 7b. BPM → speed sync. Attaches to the CPC subscriber list, so it
  // works whether BPM arrives via OSC (`/lx/tempo/bpm`), a future
  // mic-derived detector, or REST. Operator gates the behaviour via
  // the `bpmSpeedSync` CPC param (default off).
  const bpmSync = new BpmSpeedSync(paramCenter);
  bpmSync.attach();

  // 7c. Microphone audio listener. Disabled by default — opt in via
  // config.yaml `audio.enabled: true`. A bad config / missing
  // ffmpeg / device-permission error logs and disables the listener
  // but never crashes the engine (same posture as the OSC listener).
  const baseAudioCfg = engineConfig.audio || {};

  // Audio config merge order (docs/25 §7):
  //
  //   config.yaml (portable defaults)
  //     < states/<model>/audio_state.yaml (per-scene EVERYTHING)
  //
  // One file per scene now holds mic selection + analyzer tuning +
  // enabled flag. Trade-off: running the same scene on a different rig
  // means re-running `--choose_mic --model <scene>` once on that rig.
  // The win: a single source of truth, no hidden machine-local file.
  const sceneStateDir  = path.join(__dirname, 'states', opts.modelName);
  const sceneAudioOv   = loadSceneAudio(sceneStateDir);
  audioState.sceneDir  = sceneStateDir;
  // `defaults` is what the operator gets back when they hit "Reset to
  // defaults" in the Audio Analysis tab — the portable `config.yaml`
  // audio block, BEFORE any per-scene overrides. Stored once at boot
  // so the reset endpoint doesn't have to re-read disk on every call.
  audioState.defaults = baseAudioCfg;
  audioState.config = mergeAudioConfig(baseAudioCfg, sceneAudioOv);

  // Lifecycle helper so /audio/config PATCH can hot-restart the
  // analyzer with new band/kick settings without juggling state by
  // hand. Defined here so it closes over paramCenter + broadcasts.
  async function buildAndStartAudio() {
    const cfg = audioState.config;
    if (!cfg || !cfg.enabled) {
      audioState.lastStatus = { enabled: false, error: null };
      broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
      return;
    }
    try {
      const resolvedFfmpeg = await resolveFfmpegPath(cfg.capture.ffmpegPath || 'ffmpeg');
      audioState.analyzer = new AudioAnalyzer({
        sampleRate: cfg.capture.sampleRate,
        fftSize:    cfg.fftSize,
        hopSize:    cfg.hopSize,
        bands:      cfg.bands,
        kick:       cfg.kick,
        onAnalysis: ({ low, mid, high, kick }) => {
          if (kick > 0.95) audioState.lastKickAt = Date.now();
          paramCenter.setMany([
            { kind: 'scalar', key: 'micLow',  value: low  },
            { kind: 'scalar', key: 'micMid',  value: mid  },
            { kind: 'scalar', key: 'micHigh', value: high },
            { kind: 'scalar', key: 'micKick', value: kick },
          ], 'audio', 'audio:mic');
        },
      });
      audioState.capture = new AudioCapture({
        backend:      cfg.capture.backend,
        ffmpegPath:   resolvedFfmpeg,
        platform:     cfg.capture.platform || process.platform,
        device:       cfg.capture.device,
        deviceLabel:  cfg.capture.deviceLabel,
        deviceId:     cfg.capture.deviceId,
        sampleRate:   cfg.capture.sampleRate,
        channels:     cfg.capture.channels,
        inputFormat:  cfg.capture.inputFormat || undefined,
        frameSamples: cfg.hopSize,
        stopTimeoutMs:        cfg.capture.stopTimeoutMs,
        stderrWarnIntervalMs: cfg.capture.stderrWarnIntervalMs,
        onFrame:  (i16) => audioState.analyzer.pushSamples(i16),
        onStatus: (s)   => {
          audioState.lastStatus = { ...s, error: s.error || null, lastKickMs: audioState.lastKickAt };
          broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
        },
      });
      audioState.capture.start();
      // Log the RESOLVED device (capture.device on the instance), not the
      // raw config — `null` in config.yaml is legal and means "use the
      // platform default" (mac :0, linux default, win throws).
      const dev = audioState.capture.device;
      const label = audioState.capture.deviceLabel ? ` "${audioState.capture.deviceLabel}"` : '';
      console.log(`  🎙  audio listener on ${dev}${label} ` +
        `(${cfg.capture.sampleRate} Hz, ${cfg.capture.channels} ch, fft=${cfg.fftSize})`);
    } catch (err) {
      console.error(`  ⚠️  audio listener disabled at boot: ${err.message}`);
      audioState.capture = null;
      audioState.analyzer = null;
      audioState.lastStatus = { enabled: false, error: err.message };
      broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    }
  }

  /** Hot-reconfigure live-tunable analyzer fields; returns updated cfg. */
  audioState.applyLiveUpdate = function applyLiveUpdate(partial) {
    const next = mergeAudioConfig(audioState.config, partial);
    if (audioState.analyzer) {
      // Throws on invalid combinations — caller (api_server) catches
      // and returns 400 with the message so the operator gets useful
      // feedback in the Audio Analysis tab.
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick });
    }
    audioState.config = next;
    // Persist the per-scene subset (enabled / fftSize / hopSize /
    // bands / kick) but MERGE on top of the existing file so we don't
    // wipe a mic selection that was saved by `--choose_mic`.
    try {
      const onDisk = loadSceneAudio(audioState.sceneDir);
      saveSceneAudio(audioState.sceneDir, { ...onDisk, ...pickLiveFields(next) });
    } catch (e) { console.warn(`[audio] failed to persist scene audio state: ${e.message}`); }
    broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    return next;
  };

  /**
   * Wipe the live-tunable subset (bands + kick + enabled / fftSize /
   * hopSize) from the scene state and re-apply the boot defaults from
   * config.yaml. Preserves `capture.*` so the operator's mic choice
   * survives the reset — only the analyzer tuning gets rolled back.
   *
   * Used by POST /audio/config/reset (CaptainPad "Reset to defaults").
   */
  audioState.resetToDefaults = function resetToDefaults() {
    const defaults = audioState.defaults || {};
    // Rebuild the live snapshot as if no scene-state override existed
    // for bands / kick / etc. Keep capture.* from the current config
    // so the running mic doesn't get pulled out from under the engine.
    const next = mergeAudioConfig(defaults, {
      capture: audioState.config?.capture,
    });
    if (audioState.analyzer) {
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick });
    }
    audioState.config = next;
    try {
      // Strip the live-tunable subset off disk and keep ONLY capture.*.
      // This way a future `audio.lowMaxHz = 222` change in config.yaml
      // actually wins next boot, instead of being shadowed by a stale
      // operator-tuned scene file.
      const onDisk = loadSceneAudio(audioState.sceneDir);
      const stripped = {};
      if (onDisk?.capture) stripped.capture = onDisk.capture;
      saveSceneAudio(audioState.sceneDir, stripped);
    } catch (e) { console.warn(`[audio] failed to reset scene audio state: ${e.message}`); }
    broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    return next;
  };

  await buildAndStartAudio();

  // 1-Hz audioStatus heartbeat so CaptainPad's Audio Analysis tab
  // shows a live captureFps + lastKickMs even between explicit
  // lifecycle events from the capture layer. Cheap and unconditional
  // — when audio is disabled the payload is just `{ enabled: false }`.
  const audioStatusTimer = setInterval(() => {
    const live = audioState.capture
      ? { ...audioState.lastStatus, captureFps: audioState.capture.getCaptureFps?.() ?? 0, lastKickMs: audioState.lastKickAt }
      : audioState.lastStatus;
    broadcastStatsRef.publish({ type: 'audioStatus', ...live });
  }, 1000);
  if (audioStatusTimer.unref) audioStatusTimer.unref();

  // 7d. OSC listener (binds LAST, after CPC + API/WS + render loop
  // are all live). A bad config or port-bind failure disables OSC
  // but never breaks the engine — every other subsystem stays
  // running. See docs/24_osc_integration.md §12.1.
  let oscListener = null;
  const oscCfg = engineConfig.osc || {};
  if (oscCfg.enabled) {
    try {
      oscListener = new OscListener({
        port:           oscCfg.port,
        host:           oscCfg.host || '0.0.0.0',
        bindings:       oscCfg.bindings || {},
        allowedSenders: oscCfg.allowedSenders || [],
        paramCenter,
        onStats:        (s) => broadcastStatsRef.publish(s),
      });
      oscListener.start();
      console.log(`  📡 OSC listener on ${oscListener.host}:${oscListener.port} ` +
        `(${oscListener._bindingsCount} binding(s), ${oscListener._allowedCount} allowedSender(s))`);
      // Push first status now so a CaptainPad connecting before
      // the 1-second timer fires sees the correct pill state.
      broadcastStatsRef.publish({ type: 'oscStats', ...oscListener.getStatus() });
    } catch (err) {
      console.error(`  ⚠️  OSC disabled at boot: ${err.message}`);
      oscListener = null;
      broadcastStatsRef.publish({
        type: 'oscStats',
        enabled: false, port: oscCfg.port || null, host: oscCfg.host || null,
        allowedSendersCount: 0, bindingsCount: 0,
        rxMessagesPerSec: 0, mappedMessagesPerSec: 0,
        droppedMessagesPerSec: 0, invalidMessagesPerSec: 0,
        lastSeenMs: 0, lastSender: null,
        now: Date.now(),
      });
    }
  } else {
    // Listener intentionally off — publish the "disabled" snapshot
    // once so CaptainPad's pill paints "OSC OFF" immediately.
    broadcastStatsRef.publish({
      type: 'oscStats',
      enabled: false, port: null, host: null,
      allowedSendersCount: 0, bindingsCount: 0,
      rxMessagesPerSec: 0, mappedMessagesPerSec: 0,
      droppedMessagesPerSec: 0, invalidMessagesPerSec: 0,
      lastSeenMs: 0, lastSender: null,
      now: Date.now(),
    });
  }

  // 8. Graceful shutdown
  function shutdown() {
    console.log('\n\n  ⏹ Stopping...');
    // Stop external input sources FIRST so an in-flight packet or
    // audio frame can't sneak a CPC write in after we've decided to
    // go dark. Audio first (it's the noisier source), then OSC.
    // See docs/24 §12.2 / docs/25 §3.3.
    if (audioState.capture) {
      try { audioState.capture.stop(); } catch (_) { /* ignore */ }
    }
    if (oscListener) {
      try { oscListener.stop(); } catch (_) { /* ignore */ }
    }
    try { bpmSync.detach(); } catch (_) { /* ignore */ }
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
      mixer.destroy();
      wasmHost.shutdown();
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
