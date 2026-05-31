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
 *   node engine.js --pattern fire --force-osc-port
 */

import fs from 'fs';

import { WasmHost } from './lib/wasm_host.js';
import { PatternMixer } from './lib/pattern_mixer.js';
import { ChannelParamRouter } from './lib/channel_param_router.js';
import { startApiServer } from './lib/api_server.js';
import { ModulationController } from './lib/modulation_controller.js';
import { IntensityController } from './lib/intensity_controller.js';
import { GlobalEffectsController } from './lib/global_effects_controller.js';
import { GlobalEffectSlotManager, DEFAULT_SLOT_CONFIG, validateSlotsConfig } from './lib/global_effect_slot_manager.js';
import { ParamCenter } from './lib/param_center.js';
import { OscListener } from './lib/osc_listener.js';
import { AudioCapture } from './lib/audio_capture.js';
import { AudioAnalyzer } from './lib/audio_analyzer.js';
import { BpmSpeedSync } from './lib/bpm_speed_sync.js';
import { mergeAudioConfig, pickLiveFields } from './lib/audio_config.js';
import {
  loadSceneAudio, saveSceneAudio,
} from './lib/audio_config_store.js';
import { listAudioDevices, findConfiguredDevice } from './lib/audio_devices.js';
import { SignalPostProcessor, KNOWN_SIGNALS } from './lib/signal_post_processor.js';
import { parseEngineFlags } from './lib/engine_cli_flags.js';
import { handleAudioCliFlags } from './lib/audio_mic_chooser.js';
import { resolveFfmpegPath } from './lib/ffmpeg_resolver.js';
import { mapPixelsToSacn, suppressNativeStrobes } from '../simulation/src/dmx/sacn_mapper.js';
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
async function loadModel(modelName, bustCache = false) {
  const modelPath = path.join(__dirname, 'models', `${modelName}.js`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}\nRun the simulation and save the model first.`);
  }
  // Dynamic ESM import
  const modelUrl = 'file://' + modelPath + (bustCache ? `?t=${Date.now()}` : '');
  const mod = await import(modelUrl);

  const effectsPath = path.join(__dirname, 'models', `${modelName}.effects.js`);
  let specialEffects = [];
  try {
    if (fs.existsSync(effectsPath)) {
      const effectsUrl = 'file://' + effectsPath + (bustCache ? `?t=${Date.now()}` : '');
      const effectsMod = await import(effectsUrl);
      specialEffects = effectsMod.specialEffects || [];
    }
  } catch (err) {
    console.warn(`[Model] Could not load companion effects model: ${err.message}`);
  }

  // Optional named view-mask dictionary the model author declared.
  // Two sources are honored, in priority order:
  //
  //   1. Model file inline export:
  //        export const viewMasks = [{ name: 'MainShow', bit: 2 }, ...]
  //
  //   2. Sidecar file `<model>.viewmasks.js`:
  //        export const viewMasks = [
  //          { name: 'MainShow', bit: 2, pixelIndices: [0,1,2,...] },
  //          ...
  //        ];
  //      The sidecar is the preferred path because the model file is
  //      auto-regenerated from the simulator and would clobber any
  //      hand-edited `viewMasks`. The sidecar `pixelIndices` (optional
  //      per entry) is OR-merged into the corresponding `pixels[i].vMask`
  //      at load time so view-mask selection actually matches pixels
  //      even though the auto-generated model has `vMask: 0` everywhere.
  //
  // Used by the engine to resolve {type:'viewMask', target:'<name>'}
  // view selections in compileViewSelectionMask. Models that haven't
  // declared either source get an empty array — view-mask selections
  // by name then no-op and CaptainPad hides the "VIEW MASKS" section
  // of the picker. See docs/27 §3.1 and docs/13 §4.
  const GROUP_TO_BIT = {
    'TriangleEdges': 0x01,
    'ParLights': 0x01,
    'TowerBars': 0x01,
    'DJ Lights': 0x01,
    'DJLights': 0x01,
    'TrianglePars': 0x02,
    'TowerVintageLights': 0x02,
    'BarLights': 0x04,
    'WallVintageLights': 0x04,
    'WallVintageLightsTop': 0x04,
    'LedBarsWall': 0x04,
    'VintageLights': 0x08,
    'Redwoods1': 0x08,
  };

  for (const px of mod.pixels) {
    if (!px) continue;
    px.vMask = px.vMask ?? 0;
    px.viewMask = px.viewMask ?? 0;
    if (px.group && GROUP_TO_BIT[px.group] !== undefined) {
      const bit = GROUP_TO_BIT[px.group];
      px.vMask |= bit;
      px.viewMask |= bit;
    }
  }

  let viewMasks = [];
  const viewMasksPath = path.join(__dirname, 'models', `${modelName}.viewmasks.js`);
  if (fs.existsSync(viewMasksPath)) {
    try {
      const vmUrl = 'file://' + viewMasksPath;
      const vmMod = await import(vmUrl);
      if (Array.isArray(vmMod.viewMasks)) {
        viewMasks = vmMod.viewMasks;
        console.log(`[Model] Loaded ${viewMasks.length} view-mask preset(s) from ${path.basename(viewMasksPath)}`);
      }
    } catch (err) {
      console.warn(`[Model] Failed to load viewmasks sidecar ${viewMasksPath}: ${err.message}`);
    }
  } else if (Array.isArray(mod.viewMasks)) {
    viewMasks = mod.viewMasks;
  }

  // OR-merge each entry's pixelIndices into the pixel's existing
  // vMask. Cheap O(sum(pixelIndices)). Done in-place because the
  // pixels array is the model's source of truth for the rest of
  // the engine (mapPixelsToSacn, vis, etc.) and the merge is
  // additive (never zeroes a bit). Works for both inline viewMasks
  // and loaded sidecar presets.
  if (viewMasks.length > 0) {
    for (const entry of viewMasks) {
      if (!entry || !Number.isInteger(entry.bit) || entry.bit <= 0 || !Array.isArray(entry.pixelIndices)) continue;
      // Skip composite presets (which combine multiple bits) when OR-merging into pixel.vMask.
      // Base groups have exactly one bit set (are powers of 2).
      if ((entry.bit & (entry.bit - 1)) !== 0) continue;

      for (const idx of entry.pixelIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= mod.pixels.length) continue;
        const px = mod.pixels[idx];
        if (!px) continue;
        // Mirror both the abbrev (vMask) and full (viewMask) keys —
        // the rest of the engine reads vMask, but pattern code may
        // still read viewMask per docs/13.
        const cur = (px.vMask ?? px.viewMask ?? 0) | entry.bit;
        px.vMask = cur;
        px.viewMask = cur;
      }
    }
  }

  return { pixelCount: mod.pixelCount, pixels: mod.pixels, specialEffects, viewMasks };
}

// ── Render Loop ───────────────────────────────────────────────────────────
function createRenderLoop(mixer, model, dmxRouter, universeIds, sacnOut, fps, intensityController, globalEffectsController, paramCenter, statsCallback, visConfig, hooks = {}) {
  let running = false;
  let timer = null;
  let frameCount = 0;
  // Optional pre-frame hook for ModulationController (Phase 1B). Runs
  // AFTER paramCenter.flushDirty (so CPC sources are current) and
  // BEFORE mixer.beginFrame (so modulated control writes participate
  // in this frame's render).
  const beforeFrameHook = typeof hooks.beforeFrame === 'function' ? hooks.beforeFrame : null;
  let windowFrames = 0;
  let startTime = 0;
  let lastStatsTime = 0;
  let lastVisTime = 0;
  const intervalMs = Math.round(1000 / fps);
  const pixelCount = model.pixels.length;

  // ── Vis broadcast budget (config.yaml → `vis:`) ───────────────────────
  // The vis broadcast feeds CaptainPad's PixelStrip previews. It is
  // ADVISORY only — never affects sACN. Two knobs:
  //   * broadcastHz: how often we ship a fresh frame. Default 1 Hz; the
  //     operator only needs a "what's playing" preview, not a live
  //     waveform. Higher rates force the iPad to atob() + re-render N
  //     pixel <View>s per channel N times per second; with 4 mixer
  //     channels open at 10 Hz the iPad UI thread starves and the
  //     operator perceives playlist switches as slow.
  //   * maxPixels: upper bound on per-channel pixel count. Larger
  //     models are sampled uniformly down to this cap; smaller models
  //     are sent verbatim. 100 keeps the per-frame payload small even
  //     for rigs with thousands of pixels (where the full RGBWAU
  //     buffer would otherwise dwarf every other broadcast).
  const visBroadcastHz = (visConfig && visConfig.broadcastHz) > 0
    ? Number(visConfig.broadcastHz) : 1;
  const visMaxPixels = (visConfig && visConfig.maxPixels) > 0
    ? Math.max(1, Math.floor(Number(visConfig.maxPixels))) : 100;
  const visIntervalMs = Math.max(1, Math.round(1000 / visBroadcastHz));
  // Sampling index table: built once at boot for this model. `null`
  // means "no subsampling, copy the whole buffer".
  let visSampleIdx = null;
  if (pixelCount > visMaxPixels) {
    visSampleIdx = new Int32Array(visMaxPixels);
    for (let i = 0; i < visMaxPixels; i++) {
      visSampleIdx[i] = Math.floor(i * pixelCount / visMaxPixels);
    }
  }
  const visPxOut = visSampleIdx ? visMaxPixels : pixelCount;
  // Hot-path scratch buffers — avoid `new Uint8Array(...)` on every
  // broadcast (allocations are visible at 1 Hz too, especially under
  // mass channel adds).
  const visScratch6 = new Uint8Array(visPxOut * 6);
  function subsampleVis(full6ch) {
    if (!visSampleIdx) return full6ch;
    for (let i = 0; i < visMaxPixels; i++) {
      const src = visSampleIdx[i] * 6;
      const dst = i * 6;
      visScratch6[dst]     = full6ch[src];
      visScratch6[dst + 1] = full6ch[src + 1];
      visScratch6[dst + 2] = full6ch[src + 2];
      visScratch6[dst + 3] = full6ch[src + 3];
      visScratch6[dst + 4] = full6ch[src + 4];
      visScratch6[dst + 5] = full6ch[src + 5];
    }
    return visScratch6;
  }
  console.log(`  📊 Vis broadcast: ${visBroadcastHz} Hz · ` +
    `${visPxOut} px/strip` +
    (visSampleIdx ? ` (subsampled from ${pixelCount})` : ` (model fits under cap)`));

  // We need metadata arrays for 6ch WASM call
  // We can just construct them lazily the first time or pass 0 for null (if memory isn't used)
  const metaBuf = null;

  // ── Engine-level global SPEED accumulator ─────────────────────────────
  //
  // Global `speed` used to be injected into every pattern as a `var
  // speed` shared variable, which forced each pattern to re-implement
  // `globalMult = pow(2.0, (speed - 0.5) * 4.0)` and multiply its own
  // clock by it. That had two problems:
  //
  //   1. Any pattern that did `time(...) * globalMult` (or similar
  //      absolute-elapsed style) phase-jumped on every speed change.
  //   2. Every new pattern needed boilerplate to be CPC-aware.
  //
  // The engine now owns the global clock instead. We accumulate a
  // monotonic `patternClockSeconds` by scaling each wall-clock delta
  // by the current global multiplier, then pass THAT into
  // mixer.beginFrame(). The WASM runtime computes its frame `delta`
  // off the elapsed we pass in, so patterns automatically receive a
  // pre-scaled delta and never see the global speed knob themselves.
  //
  // The CPC still owns `speed` for UI / OSC / persistence; it's just
  // flagged `engineOwned: true` so it's no longer bound to a pattern
  // function export (see lib/param_center.js).
  let patternClockSeconds = 0;
  let lastWallNow = 0;
  const SPEED_MIN_MULT = 0.25; // speed=0   → 0.25× wall clock
  const SPEED_MAX_MULT = 4.0;  // speed=1   → 4×    wall clock  (0.5 → 1× exactly)
  function globalSpeedMultiplier() {
    const all = paramCenter ? paramCenter.getAll() : null;
    const s = (all && typeof all.speed === 'number') ? all.speed : 0.5;
    const clamped = Math.max(0, Math.min(1, s));
    return SPEED_MIN_MULT * Math.pow(SPEED_MAX_MULT / SPEED_MIN_MULT, clamped);
  }

  // ── Engine-level global SIZE (spatial scale) ──────────────────────────
  //
  // Same story as speed — instead of injecting a per-pattern `size`
  // var, we own a coordinate rescale at the engine level. WasmHost
  // caches the original (nx, ny, nz) at boot and rewrites the live
  // coord buffer with `coord * (1 / sizeMult)` whenever the operator
  // changes the SIZE fader. Patterns just see scaled coords arrive on
  // `render3D(index, x, y, z)`.
  //
  // Range echo'd from the CPC fader (0..1). 0.5 = identity, fan out
  // exponentially the same way speed does so the slider feels
  // consistent across the two.
  const SIZE_MIN_MULT = 0.25;
  const SIZE_MAX_MULT = 4.0;
  function globalSizeMultiplier() {
    const all = paramCenter ? paramCenter.getAll() : null;
    const s = (all && typeof all.size === 'number') ? all.size : 0.5;
    const clamped = Math.max(0, Math.min(1, s));
    return SIZE_MIN_MULT * Math.pow(SIZE_MAX_MULT / SIZE_MIN_MULT, clamped);
  }

  function tick() {
    if (!running) return;

    const now = performance.now();

    // ── Global clock accumulator (see render-loop preamble) ─────────
    if (lastWallNow === 0) lastWallNow = now;
    const wallDelta = Math.max(0, (now - lastWallNow) / 1000);
    lastWallNow = now;
    patternClockSeconds += wallDelta * globalSpeedMultiplier();
    const elapsed = patternClockSeconds;

    // ── Global size: cheap no-op when scale unchanged. ──────────────
    mixer.wasmHost.applySizeScale(globalSizeMultiplier());

    // Flush pending shared parameters (CPC) to all active VMs before frame compute
    if (paramCenter) paramCenter.flushDirty(mixer.wasmHost);

    // ModulationController: evaluate per-playlist-item audio modulations
    // and write modulated control values to the deck channel's WASM.
    // Runs in between CPC flush and beginFrame so the modulated value
    // is the one this frame's pattern.render() actually sees.
    if (beforeFrameHook) {
      try {
        beforeFrameHook(now);
      } catch (err) {
        console.warn(`[engine] beforeFrame hook threw: ${err.message}`);
      }
    }

    // Render all pixels in one WASM call (batch)
    mixer.beginFrame(elapsed);

    // Tell the mixer whether this frame will produce a vis broadcast.
    // The per-channel vis pre-pass inside renderAll6ch() runs N extra
    // WASM patterns (one per channel) just to populate _visData — that
    // work is wasted on the (broadcastHz/fps - 1) frames out of every
    // fps where no broadcast is pending. Compositing renders below
    // still run every frame (they drive the sACN output and the
    // visible deck/mixer buffer), so engine output is unaffected.
    // With 4 channels at 40 fps and 1 Hz vis this skips the per-channel
    // pre-pass on 39 of every 40 frames.
    mixer.wantVisThisFrame = (now - lastVisTime > visIntervalMs);

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

    // NEW: Apply Global Effect Macros (color wash, feedback trails,
    // drop hit envelopes, software sync strobe). Runs before
    // intensity / blackout per docs/28 §2.2 so master dimmers and
    // safety blackout always have the final say.
    if (globalEffectsController && globalEffectsController.applyMacros) {
      globalEffectsController.applyMacros({
        pixels: model.pixels,
        frameIndex: frameCount,
        nowMs: now,
      });
    }

    // Apply any hardware blackout or section intensity scaling from the API (Master cutoffs)
    if (intensityController) intensityController.apply(model.pixels);

    // Map to DMX (writes directly into dmxRouter's _read buffer via getFullFrame)
    mapPixelsToSacn(model.pixels, dmxRouter);

    // NEW: Suppress native strobe channels per docs/28 §2.1 so the
    // physical fixture's oscillators don't fight our software strobe.
    suppressNativeStrobes(model.pixels, dmxRouter);

    // Collect sACN outbound buffer
    const dmxBuffers = {};
    for (const u of universeIds) {
      const frame = dmxRouter.getFullFrame(u);
      if (frame) dmxBuffers[u] = frame;
    }

    // Apply explicit raw-hardware bypasses directly onto the payload arrays (like Fogger).
    // Pass blackout so the DMX-only fixtures (fogger / horn / fire) are
    // also silenced — pixel-level blackout alone wouldn't touch them.
    if (globalEffectsController) {
      globalEffectsController.applyDmx(dmxBuffers, {
        blackout: !!(intensityController && intensityController.blackoutActive),
      });
    }

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

    // Vis data broadcast at `visBroadcastHz` (default 1 Hz, see top of
    // createRenderLoop). Per-channel buffers come pre-rendered from
    // mixer._visData; each one is subsampled down to `visMaxPixels`
    // here before base64-encoding so a 500-px rig doesn't push a
    // 3 KB/strip payload at the iPad.
    if (now - lastVisTime > visIntervalMs) {
      lastVisTime = now;
      if (statsCallback) {
        const visData = mixer.getVisData();
        const visPayload = {};
        for (const [key, rgb] of Object.entries(visData)) {
          if (!rgb) { visPayload[key] = null; continue; }
          // subsampleVis returns the shared scratch buffer; we MUST
          // base64-encode immediately (still synchronous here) before
          // the next call overwrites it.
          visPayload[key] = Buffer.from(subsampleVis(rgb)).toString('base64');
        }
        // `master` is set by pattern_mixer from the pre-dimmer composition,
        // so the UI sees what the show is producing — not the dimmed-down
        // rig output. Section dimmers are still applied to sACN, but they
        // would otherwise wash the UI preview out to near-black.
        //
        // For anyone who wants the post-processed signal (blackout +
        // section dimmers + global rig FX), broadcast it as `rig` so the
        // hardware-truth preview is available too without clobbering the
        // composition view. We build the full-rig buffer (sampling
        // model.pixels), then subsample/encode in one shot.
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
        visPayload['rig'] = Buffer.from(subsampleVis(rigBuffer)).toString('base64');
        // `pixelCount` in the message is the number of pixels the iPad
        // should actually expect in each base64 buffer — that's the
        // SAMPLED count, not the model's true pixelCount. PixelStrip
        // already does Math.min(propPixelCount, bytes.length/6) so the
        // strip never tries to draw past the data.
        statsCallback({ type: 'vis', vis: visPayload, pixelCount: visPxOut });
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
  const engineConfig = loadConfig();

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

  if (!opts.dryRun) {
    // Kill existing ports
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

  const mixer = new PatternMixer({
    wasmHost,
    pixelCount: model.pixelCount,
    // Default 3 to match CaptainPad iPad layout — overridable in
    // config.yaml `mixer.maxChannels`.
    maxChannels: engineConfig?.mixer?.maxChannels ?? 3,
    // Model pixels are required for view-selection mask compilation
    // (per-channel `viewSelection` → `compiledPixelMask`). PatternMixer
    // validates length + index alignment at construction; corrupted
    // pixel ordering would silently mis-map masks, so we fail at boot.
    pixels: model.pixels,
    // Named view-mask presets the model declared. Empty array is fine —
    // bitmask-by-name lookups just won't resolve and the picker UI
    // hides the section. See loadModel() above.
    viewMasks: model.viewMasks || [],
  });
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
  // Pass fps so the macro controller can quantize strobe timing to
  // the engine's actual frame grid.
  const globalEffectsController = new GlobalEffectsController({
    engine: { fps: opts.fps },
  });
  globalEffectsController.initFromModel(model.specialEffects || model.pixels);
  // Slot manager owns the 6 performance-slot bindings. Default config
  // satisfies the boot validation rule from docs/28 §4.3.
  const globalEffectSlotManager = new GlobalEffectSlotManager(
    globalEffectsController,
    DEFAULT_SLOT_CONFIG,
  );
  
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

  // ModulationController (Phase 1B): evaluates per-playlist-item audio
  // modulations each frame. Constructed here so it's available to
  // api_server (which pushes deck-swap + REST CRUD updates into it)
  // AND to the render loop's beforeFrame hook. The broadcast publisher
  // is a deferred ref filled in by api_server once broadcastWs is
  // in scope — same pattern as broadcastStatsRef above.
  const modulationBroadcastRef = { publish: () => {} };
  const modulationController = new ModulationController({
    mixer,
    paramCenter,
    broadcast: (msg) => modulationBroadcastRef.publish(msg),
  });

  // SignalPostProcessor (docs/29 Phase 2): per-signal node chain that
  // sits between the analyzer/OSC source and CPC writes. Default
  // chains are seeded at construction; the per-scene `audio_state.yaml`
  // `chains:` block (if present) is merged on top below, after the
  // file is loaded. Broadcast is a deferred ref filled by api_server.
  const signalPostProcessorBroadcastRef = { publish: () => {} };
  const signalPostProcessor = new SignalPostProcessor({
    scenePath: path.join(__dirname, 'states', opts.modelName),
    paramCenter,
    broadcast: (msg) => signalPostProcessorBroadcastRef.publish(msg),
  });

  const engineCore = {
    mixer, wasmHost, paramRouter, paramCenter, model, audioState,
    globalEffectSlotManager,
    modulationController,
    modulationBroadcastRef,
    signalPostProcessor,
    signalPostProcessorBroadcastRef,
    // Expose the live frame counter as a getter so API routes can
    // pass the engine's true frame index to dispatchSlotAction
    // (strobe phase needs that to start at the right cycle).
    getFrameIndex: () => 0,
    // Curated color-pair presets surfaced by GET /color-palettes →
    // CaptainPad's COLORS picker (Presets tab). Curated in config.yaml
    // under `colorPalettes:` so the operator can edit the rig's house
    // palette without code changes. See docs/27_color_palettes.md.
    colorPalettes: Array.isArray(engineConfig.colorPalettes) ? engineConfig.colorPalettes : [],
  };
  const apiServer = startApiServer(opts, engineCore, './patterns', broadcastStatsRef, intensityController, globalEffectsController);

  const loop = createRenderLoop(mixer, model, dmxRouter, universeIds, sacnOut, opts.fps, intensityController, globalEffectsController, paramCenter, (stats) => {
    broadcastStatsRef.publish(stats);
  }, engineConfig.vis || {}, {
    beforeFrame: (nowMs) => modulationController.applyFrame(nowMs),
  });
  // Now that the loop exists, give engineCore a way to read the live
  // frame counter (used by /global-effect-slots/:id/activate so the
  // strobe phase anchors to the right frame).
  engineCore.getFrameIndex = () => loop.frameCount;
  console.log(`  ▶ Rendering "${opts.pattern}" at ${opts.fps} fps → sACN [${universeIds.join(', ')}] (WASM MarsinVM)\n`);

  // 7a. Smart Model Hot Reload
  let modelReloadTimer = null;
  const modelsDir = path.join(__dirname, 'models');
  if (fs.existsSync(modelsDir)) {
    fs.watch(modelsDir, (eventType, filename) => {
      if (!filename || (!filename.endsWith(`${opts.modelName}.js`) && !filename.endsWith(`${opts.modelName}.effects.js`) && !filename.endsWith(`${opts.modelName}.viewmasks.js`))) return;
      if (modelReloadTimer) clearTimeout(modelReloadTimer);
      modelReloadTimer = setTimeout(async () => {
        try {
          const newModel = await loadModel(opts.modelName, true);
          
          const oldStr = JSON.stringify({ p: model.pixels, e: model.specialEffects, v: model.viewMasks });
          const newStr = JSON.stringify({ p: newModel.pixels, e: newModel.specialEffects, v: newModel.viewMasks });
          if (oldStr === newStr) return; // No meaningful change
          
          console.log(`\n  🔄 Model changed on disk. Hot-reloading...`);
          if (newModel.pixelCount !== model.pixelCount) {
             console.log(`  ⚠️ Pixel count changed (${model.pixelCount} -> ${newModel.pixelCount}). Hot reload ignored. Please restart the engine.`);
             return;
          }

          // Apply new data in place
          for(let i = 0; i < model.pixelCount; i++) {
             Object.assign(model.pixels[i], newModel.pixels[i]);
          }
          model.specialEffects = newModel.specialEffects;
          model.viewMasks = newModel.viewMasks;

          wasmHost.setCoords(model.pixels);
          wasmHost.setPixelMeta(model.pixels.map(px => ({
            controllerId: px.cId || 0,
            sectionId: px.sId || 0,
            fixtureId: px.fId || 0,
            viewMask: px.vMask || 0
          })));
          
          globalEffectsController.initFromModel(model.specialEffects || model.pixels);
          
          const registerUniverse = (patch) => {
            if (patch && patch.universe) {
              if (!universeIds.includes(patch.universe)) {
                universeIds.push(patch.universe);
                dmxRouter.addUniverse(patch.universe);
                sacnOut.addUniverse(patch.universe);
              }
            }
          };
          for (const px of model.pixels) if (px.patch) registerUniverse(px.patch);
          for (const fx of (model.specialEffects || [])) if (fx.patch) registerUniverse(fx.patch);
          
          console.log(`  ✅ Model hot-reloaded seamlessly.`);
        } catch (err) {
          console.warn(`  ⚠️ Model hot-reload failed: ${err.message}`);
        }
      }, 250);
    });
  }

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

  // docs/29: load the per-scene `chains:` block, if any, on top of
  // the processor's compiled-in DEFAULT_CHAINS. Validation runs
  // atomically — any malformed entry throws and the boot logs it,
  // preserving the default chains so the show can still light up.
  if (sceneAudioOv && sceneAudioOv.chains !== undefined) {
    try {
      signalPostProcessor.loadChains(sceneAudioOv.chains);
      console.log('  🔧 signal chains: loaded from audio_state.yaml');
    } catch (e) {
      console.error(`  ⚠️  signal chains: ignoring malformed chains block (${e.message}) — using defaults`);
    }
  }

  // Lifecycle helper so /audio/config PATCH can hot-restart the
  // analyzer with new band/kick settings without juggling state by
  // hand. Defined here so it closes over paramCenter + broadcasts.
  async function buildAndStartAudio() {
    const cfg = audioState.config;
    if (!cfg || !cfg.enabled) {
      audioState.lastStatus = { enabled: false, error: null };
      broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
      const savedDev = cfg?.capture?.device || null;
      const savedLabel = cfg?.capture?.deviceLabel ? ` "${cfg.capture.deviceLabel}"` : '';
      if (savedDev) {
        console.log(`  🔇 audio analysis: disabled (saved mic ${savedDev}${savedLabel} — enable in Audio tab or set audio.enabled: true)`);
      } else {
        console.log(`  🔇 audio analysis: disabled (no mic configured — run \`node engine.js --choose_mic --model ${opts.modelName}\`)`);
      }
      return;
    }
    try {
      const resolvedFfmpeg = await resolveFfmpegPath(cfg.capture.ffmpegPath || 'ffmpeg');

      // Cross-machine portability guard: if the operator EXPLICITLY
      // selected a mic on a different rig (e.g. ":2 Amazon USB" on Mac
      // A) and we're now booting on Mac B where that index doesn't
      // exist, ffmpeg would crash with a cryptic stderr. Enumerate
      // first and fail with a clear status the iPad can banner.
      //
      // Skipped when `cfg.capture.device == null` — that's "use platform
      // default", a legitimate config.yaml state that AudioCapture
      // resolves at start() time.
      //
      // Codex P0: NO silent fallback to the platform default mic. The
      // operator's selection IS the truth — if it's missing, surface.
      const sel = cfg.capture || {};
      if (sel.device || sel.deviceId) {
        let enumResult;
        try {
          enumResult = await listAudioDevices({
            ffmpegPath: resolvedFfmpeg,
            platform:   sel.platform || process.platform,
            inputFormat: sel.inputFormat || undefined,
          });
        } catch (enumErr) {
          // The enumeration itself failed (ffmpeg missing, unsupported
          // platform, etc.). Don't paper over — surface and disable.
          audioState.capture = null;
          audioState.analyzer = null;
          audioState.lastStatus = {
            enabled: false,
            error: 'device_enumeration_failed',
            enumerationError: { code: enumErr.code || 'unknown', message: enumErr.message },
          };
          console.error(`  ⚠️  audio device enumeration failed (${enumErr.code || 'unknown'}): ${enumErr.message} — audio disabled`);
          broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
          return;
        }
        const match = findConfiguredDevice(
          { deviceId: sel.deviceId, device: sel.device, deviceLabel: sel.deviceLabel },
          enumResult.devices || [],
        );
        if (!match) {
          // Saved mic not on this machine. Build a status payload whose
          // `availableDevices` shape mirrors what /audio/devices serves
          // so the iPad can reuse fetchAudioDevices' types directly.
          audioState.capture = null;
          audioState.analyzer = null;
          audioState.lastStatus = {
            enabled: false,
            error: 'configured_mic_not_found',
            missingDevice: {
              device:      sel.device      ?? null,
              deviceLabel: sel.deviceLabel ?? null,
              deviceId:    sel.deviceId    ?? null,
              platform:    sel.platform    ?? process.platform,
            },
            availableDevices: enumResult.devices || [],
            platform:    enumResult.platform,
            inputFormat: enumResult.inputFormat,
          };
          const human = sel.deviceLabel || sel.device || sel.deviceId;
          console.warn(`  ⚠️  configured mic '${human}' not found on this machine — pick a new mic from the AUDIO tab in CaptainPad (saw ${enumResult.devices?.length || 0} alternative devices)`);
          broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
          return;
        }
      }

      // docs/29 Phase 2: the analyzer emits RAW post-envelope band
      // values. We route each through `signalPostProcessor.process()`
      // (which runs the per-signal node chain — Gain via paramKey,
      // then any operator-added LPF / Envelope / Schmitt / Hold).
      // Both raw + post are then written to CPC so the iPad can
      // show pre/post side-by-side. The chain's Gain op reads its
      // `*Gain` CPC param live each call, preserving the operator's
      // existing slider-as-source-of-truth contract.
      let lastAnalysisAtMs = 0;
      audioState.analyzer = new AudioAnalyzer({
        sampleRate: cfg.capture.sampleRate,
        fftSize:    cfg.fftSize,
        hopSize:    cfg.hopSize,
        bands:      cfg.bands,
        kick:       cfg.kick,
        onAnalysis: ({ low, mid, high, kick }) => {
          const nowMs = Date.now();
          const dt = lastAnalysisAtMs === 0 ? 0 : Math.max(0, (nowMs - lastAnalysisAtMs) / 1000);
          lastAnalysisAtMs = nowMs;
          const lowPost  = signalPostProcessor.process('micLow',  low,  dt);
          const midPost  = signalPostProcessor.process('micMid',  mid,  dt);
          const highPost = signalPostProcessor.process('micHigh', high, dt);
          const kickPost = signalPostProcessor.process('micKick', kick, dt);
          if (kickPost > 0.95) audioState.lastKickAt = nowMs;
          // Single setMany so the downstream onChange fan-out fires
          // ONCE per hop for the full 8-key bundle (post + raw), not
          // twice. CaptainPad SIGNAL DIAGNOSTICS uses the *Raw keys
          // to render the raw row of the diagnostics strip.
          paramCenter.setMany([
            { kind: 'scalar', key: 'micLow',     value: lowPost  },
            { kind: 'scalar', key: 'micMid',     value: midPost  },
            { kind: 'scalar', key: 'micHigh',    value: highPost },
            { kind: 'scalar', key: 'micKick',    value: kickPost },
            { kind: 'scalar', key: 'micLowRaw',  value: low      },
            { kind: 'scalar', key: 'micMidRaw',  value: mid      },
            { kind: 'scalar', key: 'micHighRaw', value: high     },
            { kind: 'scalar', key: 'micKickRaw', value: kick     },
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
      const ffmpegSrc = resolvedFfmpeg.includes('ffmpeg-static') ? 'bundled'
        : (resolvedFfmpeg === 'ffmpeg' ? 'PATH' : resolvedFfmpeg);
      console.log(`  🎙  audio analysis: ENABLED — listening on ${dev}${label}`);
      console.log(`     ${cfg.capture.sampleRate} Hz · ${cfg.capture.channels} ch · fft=${cfg.fftSize} · hop=${cfg.hopSize} · ffmpeg=${ffmpegSrc}`);
      console.log(`     bands: low<${cfg.bands.lowMaxHz}Hz · mid<${cfg.bands.midMaxHz}Hz · high≤${Math.floor(cfg.capture.sampleRate / 2)}Hz · kick ${cfg.kick.minHz}-${cfg.kick.maxHz}Hz`);
    } catch (err) {
      console.error(`  ⚠️  audio listener disabled at boot: ${err.message}`);
      audioState.capture = null;
      audioState.analyzer = null;
      audioState.lastStatus = { enabled: false, error: err.message };
      broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    }
  }

  /**
   * Hot-reconfigure live-tunable analyzer fields. When `enabled` or
   * `capture.*` change we tear down ffmpeg and respawn — the analyzer
   * can't swap mics or sample rates in place. Returns updated cfg.
   *
   * Caller (api_server PATCH /audio/config) passes the second arg as
   * a hint when validation detected a capture-affecting change.
   */
  audioState.applyLiveUpdate = async function applyLiveUpdate(partial, opts = {}) {
    const prev = audioState.config;
    const next = mergeAudioConfig(prev, partial);
    const captureRestart = !!opts.requiresCaptureRestart
      || (partial && (partial.enabled !== undefined || partial.capture));

    if (captureRestart) {
      // Stop the current capture cleanly before swapping config so we
      // don't briefly run two ffmpeg processes on the same device.
      if (audioState.capture) {
        try { await audioState.capture.stop(); }
        catch (e) { console.warn(`[audio] capture.stop() threw: ${e.message}`); }
        audioState.capture  = null;
        audioState.analyzer = null;
      }
      audioState.config = next;
      // Rebuild from scratch — buildAndStartAudio reads audioState.config.
      await buildAndStartAudio();
    } else if (audioState.analyzer) {
      // Hot reconfigure path — bands/kick only. Throws on invalid
      // combinations; caller catches and returns 400.
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick });
      audioState.config = next;
    } else {
      audioState.config = next;
    }

    // Persist the per-scene subset (enabled / fftSize / hopSize /
    // bands / kick / capture mic-selection fields). MERGE on top of
    // the existing file so we don't wipe orthogonal sections.
    try {
      const onDisk = loadSceneAudio(audioState.sceneDir);
      saveSceneAudio(audioState.sceneDir, { ...onDisk, ...pickLiveFields(audioState.config) });
    } catch (e) { console.warn(`[audio] failed to persist scene audio state: ${e.message}`); }
    broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    return audioState.config;
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
    // for bands / kick / etc. Keep capture.* AND the master enabled
    // flag from the current config so the running mic doesn't get
    // pulled out from under the engine (operator review May 2026 #12
    // — "make the defaults not change the on/off state of the audio
    // analysis, but the BPM mapping is fair game"). Only the tunable
    // analyzer numbers (bands, kick, fft size) snap back to the
    // baseline.
    const next = mergeAudioConfig(defaults, {
      capture: audioState.config?.capture,
      enabled: audioState.config?.enabled,
    });
    if (audioState.analyzer) {
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick });
    }
    audioState.config = next;
    try {
      // Strip the live-tunable subset off disk and keep capture.* and
      // enabled. (See May 2026 #12 above — enabled is sticky across
      // reset so the operator's mic stays whatever it was.) A future
      // `audio.lowMaxHz = 222` change in config.yaml still wins next
      // boot for the tunable analyzer settings.
      const onDisk = loadSceneAudio(audioState.sceneDir);
      const stripped = {};
      if (onDisk?.capture) stripped.capture = onDisk.capture;
      if (typeof onDisk?.enabled === 'boolean') stripped.enabled = onDisk.enabled;
      else if (typeof audioState.config?.enabled === 'boolean') stripped.enabled = audioState.config.enabled;
      saveSceneAudio(audioState.sceneDir, stripped);
    } catch (e) { console.warn(`[audio] failed to reset scene audio state: ${e.message}`); }
    broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
    return next;
  };

  // Boot-write the per-scene audio_state.yaml so a fresh scene (or one
   // that was hand-edited to a partial state) ends up containing the
   // FULL pickLiveFields snapshot — capture, enabled, fftSize, hopSize,
   // bands, kick — alongside any pre-existing orthogonal sections
   // (currently just `chains:`). Operator request: the file should
   // reflect ground truth from boot, not "after the first PATCH".
   //
   // Fires unconditionally — even when `cfg.enabled === false` — so a
   // scene with audio off still surfaces the analyzer config for the
   // operator to inspect / hand-tune before flipping enabled on.
   //
   // Same merge pattern as applyLiveUpdate: load → merge → save. Any
   // future top-level sections (e.g. signal routing) are preserved.
   try {
     const onDisk = loadSceneAudio(audioState.sceneDir);
     saveSceneAudio(audioState.sceneDir, { ...onDisk, ...pickLiveFields(audioState.config) });
   } catch (e) {
     console.warn(`[audio] failed to boot-write scene audio state: ${e.message}`);
   }

   await buildAndStartAudio();

  /**
   * Persist the current per-signal chain map into the scene's
   * `audio_state.yaml` under a top-level `chains:` block. Called on
   * every successful PUT / PATCH / reset (the api_server route hands
   * back to this helper so persistence stays consistent with how
   * applyLiveUpdate handles bands/kick).
   */
  audioState.persistChains = function persistChains() {
    try {
      const onDisk = loadSceneAudio(audioState.sceneDir);
      const next = { ...onDisk, chains: signalPostProcessor.getAllChains() };
      saveSceneAudio(audioState.sceneDir, next);
    } catch (e) {
      console.warn(`[audio] failed to persist chains: ${e.message}`);
    }
  };

  // 5 Hz signalChain preview broadcast — emits ONE message per signal
  // per tick (so ~35 small frames/s when subscribed, ~0 when not).
  // The processor's `snapshotForEditor` returns zero-cost stubs when
  // `setEditorSubscribed(false)` so this timer still pays nothing on
  // the wire when the AUDIO tab isn't open.
  const signalChainTimer = setInterval(() => {
    if (!signalPostProcessor._editorSubscribed) return;
    for (const sig of KNOWN_SIGNALS) {
      const snap = signalPostProcessor.snapshotForEditor(sig);
      if (snap) signalPostProcessorBroadcastRef.publish(snap);
    }
  }, 200);
  if (signalChainTimer.unref) signalChainTimer.unref();

  // 1-Hz audioStatus heartbeat so CaptainPad's Audio Analysis tab
  // shows a live captureFps + lastKickMs even between explicit
  // lifecycle events from the capture layer. Cheap and unconditional
  // — when audio is disabled the payload is just `{ enabled: false }`.
  const audioStatusTimer = setInterval(() => {
    if (audioState.capture) {
      // Keep `lastStatus` in sync with the live fps + lastFrame so that
      // GET /audio/status (which reads `lastStatus` directly) doesn't
      // serve a stale snapshot frozen at the first `phase: 'running'`
      // event. Capture lifecycle events still override these fields via
      // _emitStatus, so we just patch the time-varying ones here.
      audioState.lastStatus = {
        ...audioState.lastStatus,
        captureFps:     audioState.capture.getCaptureFps?.() ?? 0,
        lastFrameAtMs:  audioState.capture._lastFrameAtMs ?? audioState.lastStatus.lastFrameAtMs ?? null,
        lastKickMs:     audioState.lastKickAt,
      };
    }
    broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
  }, 1000);
  if (audioStatusTimer.unref) audioStatusTimer.unref();

  // 7d. OSC listener (binds LAST, after CPC + API/WS + render loop
  // are all live). A bad config or port-bind failure disables OSC
  // but never breaks the engine — every other subsystem stays
  // running. See docs/24_osc_integration.md §12.1.
  //
  // `oscState` is exposed on engineCore so api_server's /osc routes
  // can re-spawn the listener live when the operator flips enabled
  // or edits allowedSenders from the iPad — same posture as audio.
  const oscState = {
    listener: null,
    config: { ...(engineConfig.osc || {}) },
  };
  engineCore.oscState = oscState;

  function publishOscDisabled(cfg) {
    broadcastStatsRef.publish({
      type: 'oscStats',
      enabled: false,
      port: cfg?.port ?? null,
      host: cfg?.host ?? null,
      allowedSendersCount: Array.isArray(cfg?.allowedSenders) ? cfg.allowedSenders.length : 0,
      bindingsCount: 0,
      rxMessagesPerSec: 0, mappedMessagesPerSec: 0,
      droppedMessagesPerSec: 0, invalidMessagesPerSec: 0,
      lastSeenMs: 0, lastSender: null,
      now: Date.now(),
    });
  }

  // CLI override: --force-osc-port kills any process holding the UDP
  // port at startup so the new engine can bind cleanly. Off by default
  // because killing other processes is a footgun if the operator has
  // another OSC service intentionally co-resident. Logged loudly when
  // it does fire.
  const forceOscPort = process.argv.includes('--force-osc-port');

  /**
   * Best-effort: find any PIDs holding the UDP port via `lsof` and
   * send them SIGKILL. Synchronous + bounded; if `lsof` isn't
   * installed (Windows, minimal Linux) we just bail. Returns the list
   * of killed PIDs for logging.
   */
  function forceKillUdpPort(port) {
    try {
      // `lsof -nP -iUDP:<port> -t` lists process ids using the port
      // without DNS lookup. We exclude the current engine pid in case
      // `lsof` happens to see our own socket race.
      const raw = execSync(`lsof -nP -iUDP:${port} -t || true`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
        encoding: 'utf8',
      }).trim();
      if (!raw) return [];
      const pids = raw.split(/\s+/)
        .map(s => parseInt(s, 10))
        .filter(p => Number.isInteger(p) && p > 0 && p !== process.pid);
      if (pids.length === 0) return [];
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL'); } catch (_) { /* already dead */ }
      }
      return pids;
    } catch (_) {
      return [];
    }
  }

  /**
   * Bind the OSC listener with bounded retry. Most "port already in
   * use" cases on hot-restart resolve in < 500 ms because the kernel
   * releases the UDP socket as soon as the prior process exits — but
   * if the previous engine crashed in a state where the FD lingered,
   * the retry loop gives the OS a chance to GC before we surrender.
   *
   * With `--force-osc-port` we additionally invoke `forceKillUdpPort`
   * on the second attempt onwards.
   */
  async function startOscListenerWithRetry(cfg, { attempts = 4, baseDelayMs = 250 } = {}) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      const listener = new OscListener({
        port:           cfg.port,
        host:           cfg.host || '0.0.0.0',
        bindings:       cfg.bindings || {},
        allowedSenders: cfg.allowedSenders || [],
        paramCenter,
        signalPostProcessor,
        onStats:        (s) => broadcastStatsRef.publish(s),
      });
      try {
        await listener.startAsync();
        console.log(`  📡 OSC listener on ${listener.host}:${listener.port} ` +
          `(${listener._bindingsCount} binding(s), ${listener._allowedCount} allowedSender(s))`);
        broadcastStatsRef.publish({ type: 'oscStats', ...listener.getStatus() });
        return listener;
      } catch (err) {
        lastErr = err;
        const isAddrInUse = err && (err.code === 'EADDRINUSE' || /EADDRINUSE/.test(err.message || ''));
        if (!isAddrInUse) break; // anything else is a real config error
        if (i === 0) {
          console.warn(`  ⚠️  OSC port ${cfg.port} busy — retrying (attempt ${i + 1}/${attempts})…`);
        }
        if (forceOscPort && i >= 1) {
          const killed = forceKillUdpPort(cfg.port);
          if (killed.length > 0) {
            console.warn(`  ☠️  --force-osc-port killed stale PIDs holding ${cfg.port}: ${killed.join(', ')}`);
          }
        }
        await new Promise(r => setTimeout(r, baseDelayMs * (i + 1)));
      }
    }
    console.error(`  ⚠️  OSC disabled after ${attempts} attempts: ${lastErr ? lastErr.message : 'unknown'}`);
    if (!forceOscPort) {
      console.error(`     (rerun with --force-osc-port to SIGKILL stale processes on ${cfg.port})`);
    }
    publishOscDisabled(cfg);
    return null;
  }

  // Synchronous façade kept for callers that don't care about the
  // async lifecycle (REST /osc/config PATCH path below). Internally
  // it kicks off the retry loop and returns the listener once it
  // settles; the boot path awaits it directly.
  function startOscListener(cfg) {
    try {
      // Config-error path (bad bindings, invalid port) throws from
      // the constructor — surface that as "disabled" immediately
      // without spinning the retry loop on a misconfig.
      new OscListener({
        port:           cfg.port,
        host:           cfg.host || '0.0.0.0',
        bindings:       cfg.bindings || {},
        allowedSenders: cfg.allowedSenders || [],
        paramCenter,
        signalPostProcessor,
        onStats:        (s) => broadcastStatsRef.publish(s),
      });
    } catch (err) {
      console.error(`  ⚠️  OSC disabled: ${err.message}`);
      publishOscDisabled(cfg);
      return null;
    }
    // Kick off retry-bind in the background and adopt the resulting
    // listener (or null) into oscState.listener so REST /osc/config
    // callers see the eventual outcome.
    startOscListenerWithRetry(cfg).then((l) => {
      if (l) oscState.listener = l;
    });
    // Return a placeholder so the caller's
    // `oscState.listener = startOscListener(...)` write doesn't blow
    // away whatever the async settle assigns. The actual handle is
    // installed by the .then above.
    return null;
  }

  oscState.restart = function restart(nextCfg) {
    if (nextCfg && typeof nextCfg === 'object') {
      oscState.config = { ...oscState.config, ...nextCfg };
    }
    if (oscState.listener) {
      try { oscState.listener.stop(); } catch (_) { /* already dead */ }
      oscState.listener = null;
    }
    if (oscState.config.enabled) {
      startOscListener(oscState.config);
    } else {
      publishOscDisabled(oscState.config);
    }
    return oscState.config;
  };

  if (oscState.config.enabled) {
    startOscListener(oscState.config);
  } else {
    publishOscDisabled(oscState.config);
  }
  // Helper: read the LIVE listener handle out of oscState every time
  // we need it. The async retry-bind path can install the handle long
  // after this boot block finishes, so a stale local `let` would
  // strand the shutdown handler (UDP socket leaks into the next
  // engine restart and causes the EADDRINUSE the operator saw).
  const getOscListener = () => oscState.listener;

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
    const lOsc = getOscListener();
    if (lOsc) {
      try { lOsc.stop(); } catch (_) { /* ignore */ }
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
