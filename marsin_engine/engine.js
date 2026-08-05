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
 *
 * ░░ HARD, UNBREAKABLE RULE — audio is single-source-of-truth ░░
 *   All audio DSP lives in `audio/` (analyzer, postproc chains, detector,
 *   capture, config). The Audio Companion app (audio/companion/) MUST run the
 *   engine's REAL audio code by importing it from `audio/…` — it must NEVER
 *   reimplement, fork, or shadow any audio-processing logic in its own code
 *   path. Whatever the engine does, the Companion does, because it is the same
 *   code. New audio behaviour goes in `audio/…` first. (See audio/README.md.)
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
import { FireSyncListener } from './lib/fire_sync_listener.js';
import { AudioCapture } from './audio/capture/audio_capture.js';
import { AudioAnalyzer } from './audio/analyzer/audio_analyzer.js';
import { BpmSpeedSync } from './lib/bpm_speed_sync.js';
import { TempoArbiter } from './lib/tempo_arbiter.js';
import { mergeAudioConfig, pickLiveFields } from './audio/config/audio_config.js';
import {
  loadSceneAudio, saveSceneAudio,
} from './audio/config/audio_config_store.js';
import { listAudioDevices, findConfiguredDevice } from './audio/capture/audio_devices.js';
import { SignalPostProcessor, KNOWN_SIGNALS } from './audio/postproc/signal_post_processor.js';
// (2026-06-21) The Audio Companion is the SOLE analyzer: it computes the full
// derived/detector set and emits every key over OSC, which the engine receives
// via the static /marsin/audio/* bindings (audio/postproc/audio_signals.js). The
// engine no longer instantiates AudioStructureDetector / DerivedSignals — those
// calcs MOVED to the companion. The modules still exist (used BY the companion).
import { parseEngineFlags } from './lib/engine_cli_flags.js';
import { handleAudioCliFlags } from './audio/capture/audio_mic_chooser.js';
import { buildMaskConstants } from './lib/view_mask_constants.js';
import { buildFixtureTypeIds, fixtureTypeId } from './lib/fixture_type_constants.js';
import { ViewBitAllocator, isPowerOfTwoBit as isWordBit, MAX_WORD_BIT } from './lib/view_word.js';
import { appendAutoViews, buildViewTable } from './lib/view_catalog.js';
import { createBitFreeViewPromoter } from './lib/in_view_intrinsic.js';
import { derivePixelLocalIndices } from './lib/pixel_local_index.js';
import { resolveFfmpegPath } from './lib/ffmpeg_resolver.js';
import { sceneStateDir, stateOverridesActive } from './lib/state_paths.js';
import { mapPixelsToSacn, suppressNativeStrobes } from '../simulation/src/dmx/sacn_mapper.js';
import { UniverseRouter } from '../simulation/src/dmx/universe_router.js';
import { createOutputDispatch } from './lib/output_dispatch.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Shared offline-safe port cleanup (CommonJS, no extra deps) — replaces the
// old `npx kill-port` which needs the network.
const require = createRequire(import.meta.url);
const { freeStackPorts } = require('../tools/port_cleanup.cjs');
const { resolvePriorityRequest, elevateSelf } = require('../tools/process_priority.cjs');

// Build the 7-lane per-pixel meta array (the buffer WasmHost packs for the
// VM's *_with_meta render exports). Lane 6 (`viewMaskHi`) carries Tier-C
// high views. Centralized so the boot pack, the hot-reload pack, and the
// inView-promotion RE-pack stay byte-for-byte identical (a drift here would
// silently mis-map view membership). `localIndices` is the per-pixel
// localIndex array (see derivePixelLocalIndices) computed by the caller.
function buildMetaArray(pixels, localIndices) {
  return pixels.map((px, i) => ({
    controllerId: px.cId || 0,
    sectionId: px.sId || 0,
    fixtureId: px.fId || 0,
    viewMask: px.vMask || 0,
    fixtureTypeId: fixtureTypeId(px.fixtureType),
    pixelLocalIndex: localIndices[i],
    viewMaskHi: px.vMaskHi || 0 // lane 6 — Tier-C high view word (views 31..61)
  }));
}

// Re-pack the host meta buffer when a compile promoted a bit-free view to
// an in-VM bit (host.metaDirty), so the newly-set bit reaches the VM before
// the next render. A no-op when nothing was promoted. Clears the flag.
function repackMetaIfDirty(wasmHost, pixels) {
  if (!wasmHost || !wasmHost.metaDirty) return;
  wasmHost.setPixelMeta(buildMetaArray(pixels, derivePixelLocalIndices(pixels)));
  wasmHost.metaDirty = false;
}

// MARSIN_CONFIG_FILE is the ONE seam that says where the engine's config lives.
// It already governed the autopilot WRITE-BACK (lib/autopilot.js,
// lib/color_autopilot.js — see tests/helpers/setup_config_guard.mjs); as of
// report _100 it governs this BOOT READ too, so the seam means one coherent
// thing: "this file is the engine's config.yaml".
//
// Why that matters (the `_97` §4.4 trap, which cost 30 s of live sACN on the
// real rig): `--dest <ip>` overrides `sacn.destinations` ONLY. The per-controller
// `controllers:` block carries its OWN host and wins for the universes it claims,
// so an engine spawned with `--dest 127.0.0.9` still streams to the declared
// hardware. Before this change there was NO way to neutralise that block short of
// hand-editing the tracked config.yaml. Now a harness writes a black-holed copy
// and points MARSIN_CONFIG_FILE at it.
//
// An override that is set but missing/unreadable THROWS (codex P0: a silent
// fallback to the real config here is exactly the accident this prevents).
function loadConfig() {
  const override = process.env.MARSIN_CONFIG_FILE;
  if (override !== undefined) {
    if (!override || !path.isAbsolute(override)) {
      throw new Error(`MARSIN_CONFIG_FILE must be an absolute path when set, got: ${JSON.stringify(override)}`);
    }
    if (!fs.existsSync(override)) {
      throw new Error(`MARSIN_CONFIG_FILE points at a file that does not exist: ${override}`);
    }
    return yaml.load(fs.readFileSync(override, 'utf8')) || {};
  }
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
    // Per-controller output routing (sACN vs Art-Net). Optional: with no
    // `controllers:` block every universe streams sACN to `destinations`
    // (the long-standing default). A declared controller picks its
    // transport + host; see lib/output_dispatch.js.
    controllers: Array.isArray(config.controllers) ? config.controllers : null,
    // Fail loud (below) if neither config nor --port supplies a valid port —
    // never silently guess one.
    port: Number.isInteger(cServer.port) ? cServer.port : null,
    // OS process-priority request for the render loop. CLI value (may be null);
    // the config default is captured separately so main() can resolve the full
    // precedence chain (env > CLI > config > 'high'). See tools/process_priority.cjs.
    enginePriority: null,
    enginePriorityConfig: cEngine.priority ?? config.enginePriority ?? null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--pattern': case '-p':  opts.pattern = args[++i]; break;
      case '--model': case '-m':    opts.modelName = args[++i]; break;
      case '--fps':                 opts.fps = parseInt(args[++i], 10) || 40; break;
      case '--priority':            opts.priority = parseInt(args[++i], 10) || 100; break;
      case '--engine-priority':     opts.enginePriority = args[++i]; break;
      case '--port':                opts.port = parseInt(args[++i], 10); break;
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
    --engine-priority <c>  OS process priority for the render loop: high|realtime
                           (default: high · HIGH_PRIORITY_CLASS). realtime is
                           opt-in and usually needs admin; see process_priority.cjs
    --dry-run              Load and compile only, no sACN output
    --list, -l             List available patterns
    --dest <ip>            sACN destination IP (default: 127.0.0.1)
    --help, -h             Show this help
`);
        process.exit(0);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) {
    console.error('  ❌ No API port: set `server.port` in marsin_engine/config.yaml or pass --port <n>. Refusing to guess.');
    process.exit(1);
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
  //   1. Sidecar file `<model>.viewmasks.js` (preferred — the model file
  //      is auto-regenerated by the simulator and would clobber any
  //      hand-edited `viewMasks`).
  //
  //   2. Model file inline export `export const viewMasks = [...]`.
  //
  // Each entry declares its pixel membership via `groups` (preferred —
  // survives model regeneration and pixel reordering) or `pixelIndices`
  // (for sets that don't align with any group), and optionally an
  // explicit `bit`:
  //
  //   { name: 'Apex', groups: ['TriangleEdges', 'TrianglePars'] }
  //      Composite of base groups. The bit is computed below as the OR
  //      of the referenced groups' dynamically assigned bits — never
  //      hardcoded.
  //
  //   { name: 'RedwoodPARs', bit: 0x40, groups: ['Redwoods1', ...] }
  //      Same membership-by-group, but with an EXPLICIT single bit
  //      that is part of the pattern API (pattern code hardcodes it,
  //      e.g. `var MASK_REDWOOD_PARS = 64` in the Logsville patterns).
  //      The bit is reserved before base-group bit assignment and
  //      OR-merged into every pixel of the named groups.
  //
  //   { name: 'Custom', bit: 0x40, pixelIndices: [10, 11, ...] }
  //      Explicit single bit OR-merged into an arbitrary pixel list.
  //      Fragile across model regeneration — prefer `groups`.
  //
  // Used by the engine to resolve {type:'viewMask', target:'<name>'}
  // view selections in compileViewSelectionMask. Models that haven't
  // declared either source get an empty array — view-mask selections
  // by name then no-op and CaptainPad hides the "VIEW MASKS" section
  // of the picker. See docs/27 §3.1 and docs/13 §4.5.
  //
  // The sidecar may ALSO export a `groupBits` object pinning the base
  // group → bit mapping explicitly:
  //
  //   export const groupBits = { 'TowerBars': 0x01, 'DJ Lights': 0x04 };
  //
  // Declared mappings are the contract pattern code compiles against,
  // so they are strictly validated against the loaded model: a model
  // group missing from the table, a table key absent from the model,
  // a non-power-of-two/duplicate bit, or a collision with a preset's
  // explicit bit all throw. Without a declared mapping the engine
  // falls back to deterministic first-appearance assignment (fine for
  // models nothing depends on yet — pin the logged table into the
  // sidecar once patterns are written against it).
  //
  // Loaded BEFORE base-group bit assignment because explicit bits must
  // be reserved so dynamic assignment routes around them. A broken
  // sidecar throws — a model whose view presets fail to load must not
  // boot looking healthy (codex P0: no fallbacks, fail loudly).
  let declaredViewMasks = [];
  let declaredGroupBits = null;
  let viewMasksSource = null;
  const viewMasksPath = path.join(__dirname, 'models', `${modelName}.viewmasks.js`);
  if (fs.existsSync(viewMasksPath)) {
    const vmUrl = 'file://' + viewMasksPath + (bustCache ? `?t=${Date.now()}` : '');
    const vmMod = await import(vmUrl);
    if (!Array.isArray(vmMod.viewMasks)) {
      throw new Error(`Viewmasks sidecar ${viewMasksPath} must export a viewMasks array`);
    }
    declaredViewMasks = vmMod.viewMasks;
    if (vmMod.groupBits !== undefined) declaredGroupBits = vmMod.groupBits;
    viewMasksSource = path.basename(viewMasksPath);
  } else if (Array.isArray(mod.viewMasks)) {
    declaredViewMasks = mod.viewMasks;
    if (mod.groupBits !== undefined) declaredGroupBits = mod.groupBits;
    viewMasksSource = `${modelName}.js (inline)`;
  }

  // Validate every declared entry and reserve explicit bits.
  //
  // Tier-C: a preset may pin into the high view word with `word: 1` (the
  // `viewMaskHi` lane, views 31..61). Word 0 and word 1 are independent bit
  // spaces — a word-1 bit value may equal a word-0 bit value without
  // collision — so reservation is tracked per word. `reservedMask` is the
  // WORD-0 reservation that group-bit assignment below must avoid;
  // `reservedMaskHi` guards word-1 reuse.
  let reservedMask = 0;
  let reservedMaskHi = 0;
  const seenNames = new Set();
  for (const entry of declaredViewMasks) {
    if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error(`viewMasks entry without a name in ${viewMasksSource}: ${JSON.stringify(entry)}`);
    }
    if (seenNames.has(entry.name)) {
      throw new Error(`Duplicate viewMasks entry name '${entry.name}' in ${viewMasksSource}`);
    }
    seenNames.add(entry.name);

    const hasGroups = Array.isArray(entry.groups) && entry.groups.length > 0;
    const hasIndices = Array.isArray(entry.pixelIndices) && entry.pixelIndices.length > 0;
    const hasBit = entry.bit !== undefined;
    const word = entry.word === 1 ? 1 : 0;
    if (entry.word !== undefined && entry.word !== 0 && entry.word !== 1) {
      throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource}: word must be 0 or 1, got ${entry.word}`);
    }
    if (word === 1 && !hasBit) {
      throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} declares word:1 (viewMaskHi) ` +
        `and therefore needs an explicit single-bit value`);
    }
    if (hasGroups === hasIndices) {
      throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} must declare exactly one of ` +
        `groups:[...] or pixelIndices:[...] for its pixel membership`);
    }
    if (hasIndices && !hasBit) {
      throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} uses pixelIndices and ` +
        `therefore needs an explicit bit`);
    }
    if (hasBit) {
      // Per-word cap: vMask/vMaskHi are Int32 across the WASM boundary, so
      // 0x40000000 (bit 30) is the highest safe bit IN EITHER WORD.
      // 0x80000000 passes the power-of-two check via Int32 coercion but
      // ORs in a NEGATIVE value, and 2^32 silently merges as zero.
      if (!Number.isInteger(entry.bit) || entry.bit <= 0 || entry.bit > 0x40000000 ||
          (entry.bit & (entry.bit - 1)) !== 0) {
        throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource}: bit must be a positive ` +
          `power of two ≤ 0x40000000, got ${entry.bit}. Unions of base groups belong in a bit-less ` +
          `groups:[...] entry.`);
      }
      if (word === 1) {
        if ((reservedMaskHi & entry.bit) !== 0) {
          throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} reuses viewMaskHi ` +
            `bit 0x${entry.bit.toString(16)}`);
        }
        reservedMaskHi |= entry.bit;
      } else {
        if ((reservedMask & entry.bit) !== 0) {
          throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} reuses bit 0x${entry.bit.toString(16)}`);
        }
        reservedMask |= entry.bit;
      }
    }
  }

  // ── Base group → bit assignment ───────────────────────────────────
  // The sidecar's declared `groupBits` table is authoritative when
  // present (it's the contract pattern code compiles against). Without
  // one, bits are derived from the model: each distinct pixel `group`
  // gets the lowest free power-of-two bit, in order of first appearance
  // in the pixels array (stable — the simulator export writes pixels in
  // a fixed order). Bits explicitly reserved by sidecar presets are
  // skipped/refused so those stay stable for the patterns that
  // reference them.
  //
  // A hardcoded group→bit table is forbidden in the ENGINE: it silently
  // left vMask = 0 on every pixel of any model whose group names weren't
  // in the table, which killed all view-mask selection for the whole rig
  // at a deployment.
  //
  // JS bitwise ops are 32-bit signed, and vMask crosses into the WASM
  // runtime as Int32 — bit 30 (0x40000000) is the highest safe bit.
  const modelGroups = [];
  for (const px of mod.pixels) {
    if (!px) continue;
    px.vMask = px.vMask ?? 0;
    px.viewMask = px.viewMask ?? 0;
    px.vMaskHi = px.vMaskHi ?? 0; // Tier-C high view word (views 31..61)
    if (typeof px.group === 'string' && px.group.length > 0 && !modelGroups.includes(px.group)) {
      modelGroups.push(px.group);
    }
  }

  let groupBits;
  if (declaredGroupBits !== null) {
    if (typeof declaredGroupBits !== 'object' || Array.isArray(declaredGroupBits)) {
      throw new Error(`groupBits in ${viewMasksSource} must be an object mapping group name → bit`);
    }
    let usedMask = reservedMask;
    for (const [group, bit] of Object.entries(declaredGroupBits)) {
      if (!Number.isInteger(bit) || bit <= 0 || (bit & (bit - 1)) !== 0 || bit > 0x40000000) {
        throw new Error(`groupBits['${group}'] in ${viewMasksSource} must be a positive power of two ` +
          `≤ 0x40000000, got ${bit}`);
      }
      if ((usedMask & bit) !== 0) {
        throw new Error(`groupBits['${group}'] in ${viewMasksSource} reuses bit 0x${bit.toString(16)} ` +
          `(already taken by another group or an explicit preset bit)`);
      }
      usedMask |= bit;
    }
    // Strict two-way coverage: drift between the declared contract and
    // the regenerated model must be loud, not a silently dead group.
    const declaredNames = Object.keys(declaredGroupBits);
    const missing = modelGroups.filter(g => declaredGroupBits[g] === undefined);
    const stale = declaredNames.filter(g => !modelGroups.includes(g));
    if (missing.length > 0 || stale.length > 0) {
      const parts = [];
      if (missing.length > 0) parts.push(`model group(s) missing from the table: ${missing.join(', ')}`);
      if (stale.length > 0) parts.push(`table key(s) not in the model: ${stale.join(', ')}`);
      throw new Error(`groupBits in ${viewMasksSource} is out of sync with model '${modelName}' — ` +
        parts.join('; '));
    }
    groupBits = { ...declaredGroupBits };
  } else {
    groupBits = {};
    let nextCandidateBit = 1;
    for (const group of modelGroups) {
      while ((nextCandidateBit & reservedMask) !== 0) nextCandidateBit *= 2;
      if (nextCandidateBit > 0x40000000) {
        throw new Error(`Out of view-mask bits while assigning group '${group}' — a model supports ` +
          `at most 31 distinct group/preset bits`);
      }
      groupBits[group] = nextCandidateBit;
      nextCandidateBit *= 2;
    }
  }

  for (const px of mod.pixels) {
    if (!px || typeof px.group !== 'string' || px.group.length === 0) continue;
    // Mirror both the abbrev (vMask) and full (viewMask) keys — the
    // rest of the engine reads vMask, but pattern code may still
    // read viewMask per docs/13.
    px.vMask |= groupBits[px.group];
    px.viewMask = px.vMask;
  }

  const groupNames = Object.keys(groupBits);
  const bitsOrigin = declaredGroupBits !== null
    ? `pinned by ${viewMasksSource}`
    : 'derived from the model — pin them in the sidecar before writing patterns against them';
  console.log(`[Model] View-mask bits for ${groupNames.length} group(s) (${bitsOrigin}):`);
  for (const g of groupNames) {
    console.log(`[Model]   0x${groupBits[g].toString(16).padStart(8, '0')}  ${g}`);
  }

  // Resolve declared presets against the dynamic group bits and
  // OR-merge explicit-bit presets into their pixels. The merge is
  // additive (never zeroes a bit) and done in-place because the pixels
  // array is the model's source of truth for the rest of the engine
  // (mapPixelsToSacn, vis, wasm meta, etc.). Computed-bit composites
  // are NOT merged — their multi-bit value already matches via
  // `(vMask & bit) !== 0` and merging would pollute base bits.
  // Word-aware merge: word 0 → px.vMask (lane 3, legacy `viewMask`),
  // word 1 → px.vMaskHi (lane 6, Tier-C `viewMaskHi`, views 31..61).
  const mergeWordBit = (px, word, bit) => {
    if (word === 1) {
      px.vMaskHi = (px.vMaskHi ?? 0) | bit;
    } else {
      const cur = (px.vMask ?? px.viewMask ?? 0) | bit;
      px.vMask = cur;
      px.viewMask = cur;
    }
  };

  const viewMasks = declaredViewMasks.map((entry) => {
    const word = entry.word === 1 ? 1 : 0;
    if (Array.isArray(entry.groups) && entry.groups.length > 0) {
      const groupSet = new Set(entry.groups);
      for (const g of groupSet) {
        if (groupBits[g] === undefined) {
          throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} references unknown ` +
            `group '${g}' — model groups: ${groupNames.join(', ')}`);
        }
      }
      if (entry.bit !== undefined) {
        // Explicit reserved bit, membership by group: tag every pixel
        // of the named groups with the bit, in the entry's word.
        for (const px of mod.pixels) {
          if (px && groupSet.has(px.group)) mergeWordBit(px, word, entry.bit);
        }
        return { name: entry.name, bit: entry.bit, word, groups: [...groupSet] };
      }
      // Computed composite of base-group bits — always word 0 (groups are
      // word-0 only) and never merged (the base bits already are).
      let bit = 0;
      for (const g of groupSet) bit |= groupBits[g];
      return { name: entry.name, bit, word: 0, groups: [...groupSet] };
    }

    for (const idx of entry.pixelIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= mod.pixels.length) {
        throw new Error(`viewMasks entry '${entry.name}' in ${viewMasksSource} has out-of-range ` +
          `pixel index ${idx} (model has ${mod.pixels.length} pixels)`);
      }
      const px = mod.pixels[idx];
      if (px) mergeWordBit(px, word, entry.bit);
    }
    return { name: entry.name, bit: entry.bit, word, pixelIndices: [...entry.pixelIndices] };
  });

  if (viewMasksSource) {
    console.log(`[Model] Loaded ${viewMasks.length} view-mask preset(s) from ${viewMasksSource}:`);
    for (const vm of viewMasks) {
      const origin = vm.groups ? `groups: ${vm.groups.join(' | ')}` : `${vm.pixelIndices.length} pixel(s)`;
      console.log(`[Model]   0x${vm.bit.toString(16).padStart(8, '0')}  ${vm.name} (${origin})`);
    }
  }

  // ── Auto views (Tier-A, ZERO bit cost) — whole-ship view catalog ────
  // Generalizes the old strand-view derivation (report 20260619_1 §5),
  // trimmed to the operator's catalog (report 20260804_145): exhaustive
  // whole-ship LEFT/RIGHT halves + FRONT/BACK ends, per-strand groups,
  // structural WALLS/DECKS/CHIMNEYS/AUDITORIUM, typed Strands / TE Signs /
  // @PAR / @BAR / @VINTAGE, and per-controller CTRL_<cId> (once patched).
  // Every entry rides the SAME viewMasks array the mixer's MaskRegistry
  // consumes, but with bit:0 — pure per-pixel membership, NO viewMask bit
  // consumed, so they never pressure titanic's already-heavy 28/31
  // group-bit budget. Names already owned by a base group / declared
  // preset are skipped (the base group already provides that view), and a
  // STRUCTURAL band whose pixels exactly equal an authored view's is retired
  // in favour of the authored name — on titanic that is WALLS ≡ `Hull Canvas`
  // and AUDITORIUM ≡ `Auditoriums` (operator ruling, report 20260804_148).
  // The append sequence itself lives in lib/view_catalog.js so the offline
  // harnesses build a BYTE-EQUIVALENT catalog from the same code instead of
  // a hand-mirrored copy that can drift (report 20260804_147).
  const autoViews = appendAutoViews(mod.pixels, viewMasks, groupBits);
  for (const w of autoViews.warnings) console.warn(`[Model] auto-view: ${w}`);
  if (autoViews.entries.length > 0) {
    const fam = autoViews.families;
    const summary = Object.entries(fam)
      .filter(([, names]) => names.length > 0)
      .map(([family, names]) => `${family}:${names.length}`)
      .join(', ');
    console.log(`[Model] Auto views (Tier-A, no bit cost): ${autoViews.entries.length} total ` +
      `(${summary}) [${autoViews.entries.map(e => e.name).join(', ')}]`);
  }

  // ── Unpatched LED strands: LOUD, never silent (codex P0) ────────────
  // A strand pixel exported without an LED-controller binding carries
  // `unpatched:true` (patch:null). It renders in the VM but emits no sACN.
  // Surface the count + the distinct strand groups so the operator knows
  // exactly which strands are dark on hardware — never a silent skip.
  const unpatchedStrandGroups = new Set();
  let unpatchedStrandPixels = 0;
  for (const px of mod.pixels) {
    if (px && px.type === 'led' && (px.unpatched || !px.patch)) {
      unpatchedStrandPixels++;
      if (typeof px.group === 'string' && px.group.length > 0) unpatchedStrandGroups.add(px.group);
    }
  }
  if (unpatchedStrandPixels > 0) {
    console.warn(`[Model] ✋ ${unpatchedStrandPixels} LED-strand pixel(s) across ` +
      `${unpatchedStrandGroups.size} strand(s) are UNPATCHED (no LED controller binding) — ` +
      `they render but emit NO sACN: [${[...unpatchedStrandGroups].join(', ')}]. ` +
      `Bind them to an LED-type controller in the sim's Controller Mapping panel and re-export.`);
  }

  // ── Tier-B fixture-type targeting (real `fixtureType` builtin) ────
  // The rebuilt WASM exposes a per-pixel `fixtureType` integer builtin,
  // fed from the canonical fixtureTypeId lane the host packs into the
  // 6-int meta stride. So FIX_* constants are injected as the canonical
  // IDS (FIX_PAR == 2, …) and a pattern targets a type with an integer
  // equality `fixtureType == FIX_PAR` — model-independent, with no
  // viewMask-bit pressure (the Tier-A reserved-bit merge is removed and
  // those high bits are freed). Only PRESENT types are emitted, so a
  // FIX_* reference to a type a model does not carry still fails loudly
  // at compile (codex P0) rather than silently matching nothing. Works
  // on every model including titanic (ids never exhaust a bit budget).
  const fixtureConstants = buildFixtureTypeIds(mod.pixels);
  const fixtureRoles = Object.keys(fixtureConstants);
  if (fixtureRoles.length > 0) {
    console.log(`[Model] Tier-B fixture-type ids: ` +
      fixtureRoles.map(name => `${name}=${fixtureConstants[name]}`).join(', '));
  }

  // {MASK_NAME: bit} table WasmHost injects into pattern source at
  // compile time, so patterns reference masks by name instead of magic
  // numbers. Built here (and only here) so sanitized-name collisions
  // surface at model load, not at first compile.
  const maskConstants = buildMaskConstants({ groupBits, viewMasks });
  console.log(`[Model] Pattern constants: ${Object.keys(maskConstants).join(', ') || '(none)'}`);

  // AUTHORED-name -> { bit, word } table for the `inView("Name")` intrinsic
  // (see lib/in_view_intrinsic.js). Every named in-VM view is included so an
  // unknown name fails loudly and a bit-free (Tier-A) view is recognized as
  // PROMOTABLE (bit:0) rather than unknown. Base groups are word-0 views;
  // presets/auto-views carry their own bit+word. A later view name wins on a
  // (legitimately impossible — names are unique) collision. Built by the
  // shared lib/view_catalog.js primitive the offline harnesses also use.
  const viewTable = buildViewTable({ groupBits, viewMasks });

  return {
    pixelCount: mod.pixelCount, pixels: mod.pixels, specialEffects, viewMasks, groupBits,
    maskConstants, fixtureConstants, viewTable,
  };
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
  // Pre-dimmer composite snapshot for the deck/mixer master preview: the
  // composite AFTER global FX (invert / group color-locks) but BEFORE
  // the section dimmer rack + blackout. So the preview shows the effects
  // while ignoring the hardware dimmer trim. Filled only
  // on frames that broadcast vis (see the snapshot point in the render loop);
  // lazily sized to pixelCount*6.
  let preDimmerVisBuf = null;
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

    // If a compile since the last frame promoted a bit-free view to an
    // in-VM bit (inView("Name") on a Tier-A auto-view, e.g. from a newly
    // added mixer channel or a live edit), re-pack the meta buffer so the
    // newly-set bit reaches the VM. Cheap flag check; a no-op otherwise.
    repackMetaIfDirty(mixer.wasmHost, model.pixels);

    const now = performance.now();

    // ── Global clock accumulator (see render-loop preamble) ─────────
    if (lastWallNow === 0) lastWallNow = now;
    const wallDelta = Math.max(0, (now - lastWallNow) / 1000);
    lastWallNow = now;
    patternClockSeconds += wallDelta * globalSpeedMultiplier();
    const elapsed = patternClockSeconds;

    // ── Global size: cheap no-op when scale unchanged. ──────────────
    mixer.wasmHost.applySizeScale(globalSizeMultiplier());

    // Advance global color-transition ramps (docs/36) so colorPalette1/2
    // fade toward their target over `colorTransitionMs`. Marks the slewed
    // params dirty while moving; must run BEFORE flushDirty injects them.
    if (paramCenter) paramCenter.tickColorTransitions(now);

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

    // Assemble the per-frame audio/beat SIGNALS bag the macros read (B2 fix:
    // the bag was documented as "assembled in engine.js tick()" but never was,
    // so beat-reactive effects — beatPump, beat-synced waterlineSweep, strobe
    // phase-lock — silently ran at phase 0). beatPhase/barPhase derive from the
    // ARBITRATED tempo (mixer.tempoBpm, which TempoArbiter auto-follows off the
    // live DJ BPM), so the pump family grooves at the DJ's tempo with no OSC
    // plumbing. Fail-loud: audio-reactive channels (micHigh Hi-Hat density,
    // kick router, dropPulse) are NOT invented here — they stay 0 with
    // audioPresent:false until the OSC audio path is wired (follow-up: read
    // paramCenter 'micHigh'/'micKick' + Companion drop/beat when audio is live;
    // kick threshold also needs live calibration before the auto router fires).
    const tempoBpm = (typeof mixer.tempoBpm === 'number' && mixer.tempoBpm > 0)
      ? mixer.tempoBpm : 0;
    const beats = tempoBpm > 0 ? (now / 1000) * (tempoBpm / 60) : 0;
    const signals = {
      beatPhase: tempoBpm > 0 ? beats - Math.floor(beats) : 0,
      barPhase: tempoBpm > 0 ? (beats / 4) - Math.floor(beats / 4) : 0,
      audioPresent: false,
      micHigh: 0,
      kick: 0,
      dropPulse: 0,
    };

    // NEW: Apply Global Effect Macros (color wash, feedback trails,
    // drop hit envelopes, software sync strobe). Runs before
    // intensity / blackout per docs/28 §2.2 so master dimmers and
    // safety blackout always have the final say.
    if (globalEffectsController && globalEffectsController.applyMacros) {
      globalEffectsController.applyMacros({
        pixels: model.pixels,
        frameIndex: frameCount,
        nowMs: now,
        signals,
      });
    }

    // NOTE (2026-07, operator decision): the GLOBAL post-mixer hue shifter
    // was REMOVED — hue is PER-CHANNEL ONLY now (PatternChannel.hue via
    // applyHueShift6chU8 in pattern_mixer.js). No global hue stage runs here.

    // Global color Invert (docs/39 §F-invert): flip the RGB of the whole
    // post-mixer buffer (W/A/UV untouched). Runs AFTER the show macros but
    // BEFORE group color-locks + intensity/blackout, so a locked group's
    // color and the e-stop safety always have the final say. Zero-cost when
    // off.
    if (globalEffectsController && globalEffectsController.applyInvert) {
      globalEffectsController.applyInvert(model.pixels);
    }

    // Chroma stage AFTER invert (B1 fix): the E6 Palette Crush stage registers
    // on the 'postInvert' anchor, which is ONLY run by applyPostInvert() — and
    // nothing in the show loop called it (only the gem unit test did), so the
    // crush family (party-8 '2-level' etc.) never rendered live. Run it right
    // after applyInvert per the library design note ("postInvert runs right
    // after applyInvert so a crushed frame inverts crisply"). Zero-cost when
    // no postInvert-anchored effect is enabled.
    if (globalEffectsController && globalEffectsController.applyPostInvert) {
      globalEffectsController.applyPostInvert({
        pixels: model.pixels,
        frameIndex: frameCount,
        nowMs: now,
        signals,
      });
    }

    // Group fixed-color locks (docs/32): repaint operator-locked groups
    // AFTER all macros (a locked group must not flicker with the show)
    // but BEFORE intensity/blackout below, so the master cutoffs always
    // keep the final say. Single application point — replaces the
    // summer-camp djLights hack's duplicated post-intensity path.
    if (globalEffectsController) globalEffectsController.applyGroupFixedColors(model.pixels);

    // Snapshot the PRE-DIMMER composite (after all global FX, before the
    // section dimmers + blackout) for the deck/mixer master preview. Only on
    // frames that will broadcast vis (mixer.wantVisThisFrame, set above from
    // the same vis-due condition), so it costs one O(pixelCount) copy at the
    // vis cadence — not every frame. The vis block below encodes this as the
    // `preDimmer` key. Channel order matches rigBuffer: r,g,b,w,a,u.
    if (mixer.wantVisThisFrame) {
      if (!preDimmerVisBuf) preDimmerVisBuf = new Uint8Array(pixelCount * 6);
      for (let i = 0; i < pixelCount; i++) {
        const off = i * 6;
        const px = model.pixels[i];
        preDimmerVisBuf[off] = Math.min(255, Math.max(0, Math.round(px.r * 255)));
        preDimmerVisBuf[off + 1] = Math.min(255, Math.max(0, Math.round(px.g * 255)));
        preDimmerVisBuf[off + 2] = Math.min(255, Math.max(0, Math.round(px.b * 255)));
        preDimmerVisBuf[off + 3] = Math.min(255, Math.max(0, Math.round(px.w * 255)));
        preDimmerVisBuf[off + 4] = Math.min(255, Math.max(0, Math.round(px.a * 255)));
        preDimmerVisBuf[off + 5] = Math.min(255, Math.max(0, Math.round(px.u * 255)));
      }
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
        // Pre-dimmer composite (after global FX, before dimmers/blackout). The
        // deck + mixer master preview use this key so they show the effects
        // while ignoring the section dimmer rack. Encoded
        // immediately (subsampleVis returns a shared scratch buffer).
        if (preDimmerVisBuf) {
          visPayload['preDimmer'] = Buffer.from(subsampleVis(preDimmerVisBuf)).toString('base64');
        }
        // Per-channel effective-output METER levels (channel metering).
        // Plain { <visKey>: number(0..1) } keyed identically to visPayload —
        // each is the channel's intrinsic brightness scaled by its effFader
        // (fader/clamp/group/solo), so a layer sitting dark (faded out, muted
        // group, blend-mode-invisible) reads ~0 even when its pattern is
        // bright. Shipped as a tiny numeric sidecar to the base64 vis frames
        // (no per-pixel cost). Absent ⇒ client renders no meter (older engine
        // / non-vis frame) — a documented default, not a silent fallback.
        const visLevels = mixer.getVisLevels();
        const levelsPayload = {};
        for (const [key, level] of Object.entries(visLevels)) {
          levelsPayload[key] = level;
        }
        // `pixelCount` in the message is the number of pixels the iPad
        // should actually expect in each base64 buffer — that's the
        // SAMPLED count, not the model's true pixelCount. PixelStrip
        // already does Math.min(propPixelCount, bytes.length/6) so the
        // strip never tries to draw past the data.
        statsCallback({ type: 'vis', vis: visPayload, levels: levelsPayload, pixelCount: visPxOut });
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
// ── Process-level crash backstops (report _116, Family A — _108 / _109) ─────
// Design intent (codex P0): "never die silently, and never run half-alive."
// Node's DEFAULT on an uncaught exception or an unhandled promise rejection is
// to crash the process — but REGISTERING a handler SUPPRESSES that default, so
// each handler below MUST decide loudly and exit. A handler that merely logged
// and returned would leave the engine limping in an undefined state (the exact
// fallback the codex forbids). We log the full error with a NAMED reason and
// exit(1); a clean non-75 exit is what the launcher watchdog (W1-2) restarts,
// turning any surviving crash vector into a ~1 s blink rather than a dark ship.
//
// These are the LAST RESORT for a genuinely unexpected throw/rejection. The
// _108 CRITICAL (a malformed WS frame) is fixed at the socket level in
// api_server.js (per-connection `ws.on('error')`) and never reaches here — that
// is the primary fix; this is the net beneath it. Registered at module scope so
// a throw during boot (before main's own `.catch`) is still caught + diagnosed.
process.on('uncaughtException', (err, origin) => {
  console.error(`\n  ⛔ ENGINE FATAL — uncaughtException (${origin}): ` +
    `${err && err.stack ? err.stack : err}`);
  console.error('  ⛔ Exiting(1) with diagnosis rather than running half-alive — ' +
    'supervisor should restart. (No fallback masking; see report _116.)');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const detail = reason && reason.stack ? reason.stack : reason;
  console.error(`\n  ⛔ ENGINE FATAL — unhandledRejection: ${detail}`);
  console.error('  ⛔ Exiting(1) with diagnosis rather than running half-alive — ' +
    'supervisor should restart. (No fallback masking; see report _116.)');
  process.exit(1);
});

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
    ? sceneStateDir(__dirname, opts.modelName)
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

  // --audio_file <path>: stream a local audio FILE through the EXACT same
  // capture→analyzer→CPC path as a mic (deterministic e2e tests, desk
  // tuning with no speakers, docs/30 dataset validation). Force audio on
  // and pin the capture device to the `file:` URI here, in the boot-config
  // region, BEFORE AudioCapture is constructed — audio_capture.js detects
  // the `file:` prefix and builds file-input ffmpeg argv. Codex P0: this is
  // an explicit operator request, so it overrides config.yaml's audio
  // defaults loudly rather than silently falling back to a mic.
  if (audioFlags.audioFile) {
    engineConfig.audio = engineConfig.audio || {};
    engineConfig.audio.enabled = true;
    engineConfig.audio.capture = {
      ...(engineConfig.audio.capture || {}),
      device: `file:${audioFlags.audioFile}`,
    };
    console.log(`  🎵 audio file replay: ${audioFlags.audioFile} (forces audio.enabled)`);
  }

  console.log(`
  ╔══════════════════════════════════════════╗
  ║       🔥 MarsinEngine v2.0 (WASM VM)    ║
  ║    Multichannel Rendering Pipeline       ║
  ╚══════════════════════════════════════════╝
`);

  // ── Realtime priority for pattern generation (P0: never starve the show) ──
  // Elevate THIS node process above the NORMAL class Chrome sits in, so the
  // 40 fps sACN render loop keeps getting scheduled even when a browser window
  // grabs the foreground boost. This is the authoritative self-elevation
  // (belt-and-braces with the launcher's parent-side elevation). Precedence:
  //   env BM26_ENGINE_PRIORITY (set by the launcher) > --engine-priority CLI >
  //   config engine.priority/enginePriority > 'high'. ALWAYS reads the achieved
  //   class back and logs it — an un-elevated engine is loud, never silent.
  // Skipped for --list / --dry-run (they never run the loop).
  if (!opts.list && !opts.dryRun) {
    const { request } = resolvePriorityRequest([
      { value: process.env.BM26_ENGINE_PRIORITY, origin: 'env BM26_ENGINE_PRIORITY' },
      { value: opts.enginePriority, origin: '--engine-priority' },
      { value: opts.enginePriorityConfig, origin: 'config engine.priority' },
    ], { fallback: 'high', label: 'EnginePriority' });
    elevateSelf(request, { label: 'EnginePriority' });
  }

  // Test/harness state redirect (lib/state_paths.js): announce loudly so a
  // boot whose runtime state is NOT going to the tracked states/ tree is
  // unmistakable in the log.
  if (stateOverridesActive()) {
    console.log(`  🧪 state redirect active — MARSIN_STATE_DIR=${process.env.MARSIN_STATE_DIR || '(unset)'} MARSIN_PLAYLISTS_DIR=${process.env.MARSIN_PLAYLISTS_DIR || '(unset)'}`);
  }

  // Only a boot that will actually BIND the API port may clear it. `--dry-run`
  // never binds; `--list` prints and exits at its check below — but that check
  // sits AFTER this block, so pre-2026-07-07 a plain `node engine.js --list`
  // (the auto-checks spec's own command) killed a healthy live engine on
  // :6968 before exiting. Never kill what we won't replace.
  if (!opts.dryRun && !opts.list) {
    // Free OUR OWN port (the API server) of any stale engine before binding —
    // offline-safe and identity-checked (no `npx kill-port`, which needs the
    // network). We deliberately do NOT touch `web_client.port`: the engine does
    // not serve a web client (that block is reserved/unused, see
    // 07_run_marsin_engine.md), and `web_client.port` is CaptainPad's port —
    // killing it on a scene-switch restart would take CaptainPad down. (The old
    // code read a non-existent `client.web.port`, so it was silently dead.)
    //
    // MUST be `opts.port` — the port THIS boot will actually bind (--port
    // honored), NOT `engineConfig.server.port` from config.yaml. Pre-2026-07
    // this pushed the config port (:6968) even when --port picked another
    // port, so every test-spawned engine (tests/playlist_api.test.js spawns
    // three on :69xx) killed the LIVE dev-stack engine on :6968 before
    // binding its own unrelated port. Never kill what we won't replace.
    // (Pinned by tests/engine_port_kill_scope.test.js.)
    const portsToKill = [];
    if (Number.isInteger(opts.port) && opts.port > 0) portsToKill.push(opts.port);

    if (portsToKill.length > 0) {
      freeStackPorts(portsToKill, { log: (m) => console.log(`  🧹 ${m}`) });
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

  // Model-derived MASK_*/FIX_* constants must be registered before ANY
  // compile (boot pattern, mixer channels, live edits, blends). The
  // inView("Name") view table + the on-demand bit-free-view promoter are
  // registered alongside them so the intrinsic folds against the same model.
  wasmHost.setMaskConstants(model.maskConstants);
  wasmHost.setFixtureConstants(model.fixtureConstants);
  wasmHost.setViewTable(model.viewTable);
  wasmHost.setBitFreeViewPromoter(createBitFreeViewPromoter(model, wasmHost));

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
    // Group → bit table so the mixer can build its Tier-A MaskRegistry
    // (per-pixel members for unbounded host-side named-mask selection).
    groupBits: model.groupBits || {},
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

  // Set V2 metadata for batch rendering, mapping abbreviation keys.
  // Tier-B adds two lanes: fixtureTypeId (canonical FIX_* id from the
  // string fixtureType) and pixelLocalIndex (0-based per-fixture ordinal).
  // derivePixelLocalIndices PREFERS the sim exporter's authoritative
  // per-pixel `localIndex` (new models) and falls back to the (group,fId)
  // heuristic only for legacy models that lack it (see pixel_local_index.js;
  // a half-migrated model throws there rather than mis-derive).
  const bootLocalIndices = derivePixelLocalIndices(model.pixels);
  // The boot pattern compiled ABOVE; if it tested a bit-free view via
  // inView(), the promoter already set that bit on model.pixels, so this
  // first pack carries it. metaDirty is cleared here (the bit is now packed).
  const metaArray = buildMetaArray(model.pixels, bootLocalIndices);
  wasmHost.setPixelMeta(metaArray);
  wasmHost.metaDirty = false;

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

  // 6. Create network output (sACN and/or Art-Net, routed per controller)
  // `sacnOut` keeps its name — the dispatch exposes the identical sender
  // interface (start/stop/sendFrame/addUniverse/frameCount) so every call
  // site below is unchanged. With no `controllers:` config block this is a
  // single flat-destinations sACN sender, byte-identical to before.
  const sacnOut = createOutputDispatch({
    universes: universeIds,
    controllers: opts.controllers,
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
    scenePath: sceneStateDir(__dirname, opts.modelName),
    paramCenter,
    broadcast: (msg) => signalPostProcessorBroadcastRef.publish(msg),
  });

  const engineCore = {
    mixer, wasmHost, paramRouter, paramCenter, model, audioState,
    // The composite output dispatch. api_server surfaces its declared
    // per-controller routing on GET /status (`outputRouting`) so the sim's
    // sACN bridge can EXCLUDE any (universe → host) pair this engine already
    // delivers directly — without this, the bridge relayed the engine's own
    // loopback frames back to declared controllers and the hardware received
    // two interleaved sACN sources on one universe (physical flicker,
    // 2026-07-24 root cause).
    sacnOut,
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
    // The full loaded config.yaml object — api_server reads the `timeline:`
    // block off it to construct the in-engine Timeline service (docs/38 §15).
    engineConfig,
    // Model-sync status. `stale: true` means the engine REFUSED a model
    // hot reload (e.g. pixel count changed) and is still rendering the
    // old model while the sim/disk already has a newer one. Surfaced on
    // GET /status and in the mixer-state WS broadcast so operator
    // surfaces (sim warning banner, CaptainPad) can show it loudly.
    // Cleared on the next successful hot reload.
    modelSync: { stale: false, message: null },
  };

  // TEMPO ARBITER (docs/39 §tempo-arbitration): coherent arbitration of the
  // GLOBAL pattern tempo (mixer.tempoBpm) between the live OSC/audio BPM
  // (auto-follow) and the operator's manual TAP (override hold). Constructed
  // BEFORE startApiServer so the /mixer/tempo + /mixer/tempo/sync routes and
  // serializeMixerState can reach it via engineCore.tempoArbiter. attach()
  // below subscribes it to the CPC so it tracks `audioBpm` freshness. Its
  // per-frame auto-follow runs in the render loop's beforeFrame hook. NOTE: it
  // drives ONLY mixer.tempoBpm; bpm_speed_sync independently drives the SPEED
  // knob from the same audioBpm — different mechanism/target, both may be on.
  // Optional re-smoothing of the received OSC bpm (config.yaml
  // `tempo.oscBpmSmoothing: { enabled, tauMs }`). OFF unless set — the Audio
  // Companion already smooths the BPM before emitting, so this is a safety net
  // for a jumpy non-Companion OSC sender (enabling it stacks a little lag).
  const tempoArbiter = new TempoArbiter({
    mixer, paramCenter,
    smoothing: engineConfig?.tempo?.oscBpmSmoothing,
  });
  tempoArbiter.attach();
  engineCore.tempoArbiter = tempoArbiter;

  const apiServer = startApiServer(opts, engineCore, './patterns', broadcastStatsRef, intensityController, globalEffectsController);

  // View defaults to the composed MIXER buffer (PatternMixer constructor:
  // viewFader = targetViewFader = 1.0, per docs/27 §2). That is correct
  // once CaptainPad has populated the mixer overlay stack with a live
  // (enabled, fader > 0) layer — but the `--pattern` CLI flag installs
  // its pattern on the DECK channel only (setDeckChannel), and
  // startApiServer restores no view state at boot. If the mixer overlay
  // stack has no live contribution (empty, or every overlay disabled /
  // at fader 0 — e.g. the restored test_bench state ships a single
  // `15_silk_prism_ribbons` overlay at fader 0), the mixer-exclusive
  // view renders an all-zero buffer. The only thing then reaching sACN
  // is the per-fixture dimmer skeleton mapPixelsToSacn writes
  // unconditionally, so the rig shows DARK with no error. Pin the live
  // view to the deck so the boot `--pattern` actually renders (the
  // documented behaviour of the flag and of the full-stack smoke skill).
  // Once the operator adds a live overlay and selects the mixer view
  // from CaptainPad (a `view` POST), that explicit choice takes over.
  const hasLiveOverlay = mixer.getMixerChannels()
    .some(c => c.enabled && c.fader > 0.001);
  if (!hasLiveOverlay && mixer.getDeckChannel()) {
    mixer.viewFader = 0.0;
    mixer.targetViewFader = 0.0;
    console.log('  ▶ No live mixer overlay at boot — live view pinned to DECK so --pattern renders.');
  }

  // Tracks the last tempo pushed to clients via the OSC auto-follow path, so the
  // render loop broadcasts a fresh mixer state ONLY when the live OSC tempo
  // actually moves (the arbiter's tick() updates mixer.tempoBpm but never
  // broadcasts) — keeps the BPM readout tracking live OSC without per-frame churn.
  let lastBroadcastTempoBpm = mixer.tempoBpm;
  // Also track the derived tempo SOURCE so a liveness transition (e.g. OSC
  // drops while pref='osc' → 'osc'→'held') rebroadcasts even though tempoBpm
  // holds — otherwise the source/liveness badge would stay stale on the UIs
  // until the next operator action. Cheap: deriveSource() is two field reads.
  let lastBroadcastSource = tempoArbiter.deriveSource(Date.now());

  const loop = createRenderLoop(mixer, model, dmxRouter, universeIds, sacnOut, opts.fps, intensityController, globalEffectsController, paramCenter, (stats) => {
    broadcastStatsRef.publish(stats);
  }, engineConfig.vis || {}, {
    beforeFrame: (nowMs) => {
      modulationController.applyFrame(nowMs);
      // AUTO-CYCLE (round-2 #2): advance any mixer overlay whose playlist
      // autopilot is active + due. Cheap synchronous decision; the actual
      // overlay compile is dispatched off the hot path (setImmediate) inside
      // the tick so it never darkens this frame.
      if (apiServer && typeof apiServer.autoCycleTick === 'function') {
        apiServer.autoCycleTick();
      }
      // DECK OVERLAYS (deck dynamic view overrides): advance every
      // auto-advancing deck overlay in UNISON on ONE shared clock (operator
      // refinement #1). Same wall-clock source as autoCycleTick; the overlay
      // compiles are dispatched off the hot path inside the tick.
      if (apiServer && typeof apiServer.deckOverlayAutoCycleTick === 'function') {
        apiServer.deckOverlayAutoCycleTick();
      }
      // TEMPO AUTO-FOLLOW (tempo-arbitration): when a fresh OSC BPM is live and
      // no manual-tap override is in flight, continuously set mixer.tempoBpm
      // from it (clamped, only-on-change). Date.now() — NOT nowMs — because the
      // arbiter's `audioBpm` freshness timestamps are recorded with Date.now()
      // in its CPC subscription; performance.now() (what nowMs carries) is a
      // different epoch and would never compare correctly. Hot-path safe: two
      // field reads + one timestamp compare, no allocation.
      tempoArbiter.tick(Date.now());
      // When OSC auto-follow actually moved the tempo, push a fresh mixer state
      // so the BPM readout tracks the live OSC tempo (only-on-change; the
      // arbiter itself never broadcasts, and a mixer broadcast otherwise only
      // fires on operator actions — so OSC drift would look frozen).
      const curSource = tempoArbiter.deriveSource(Date.now());
      if ((mixer.tempoBpm !== lastBroadcastTempoBpm || curSource !== lastBroadcastSource)
          && apiServer && typeof apiServer.broadcastMixerState === 'function') {
        lastBroadcastTempoBpm = mixer.tempoBpm;
        lastBroadcastSource = curSource;
        apiServer.broadcastMixerState();
      }
      // BPM → SPEED sync (source-agnostic): the arbiter may have just moved
      // mixer.tempoBpm (OSC auto-follow) WITHOUT a CPC event, so re-evaluate
      // the speed mapping against the arbitrated tempo. recompute() is
      // idempotent — it only writes `speed` when the mapped value changed, so
      // this is hot-path safe (no per-frame CPC churn). Guarded like the other
      // beforeFrame callees since bpmSync is wired after loop.start().
      if (engineCore.bpmSync) {
        engineCore.bpmSync.recompute();
      }
    },
  });
  // Now that the loop exists, give engineCore a way to read the live
  // frame counter (used by /global-effect-slots/:id/activate so the
  // strobe phase anchors to the right frame).
  engineCore.getFrameIndex = () => loop.frameCount;
  console.log(`  ▶ Rendering "${opts.pattern}" at ${opts.fps} fps → sACN [${universeIds.join(', ')}] (WASM MarsinVM)\n`);

  // 7a. Smart Model Hot Reload
  let modelReloadTimer = null;
  // TEARDOWN HYGIENE (report _30 step 10): the watcher handle used to be
  // DISCARDED, so the engine always exited with a live fs.watch handle (plus
  // its threadpool work) still open. The libuv abort the operator hit —
  // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c:94
  // — can only be tripped WHILE handles are being torn down, and in a Node
  // process with zero native addons there is no steady-state path to it. So the
  // fix direction is to shrink what is still live at exit. Keep the handle and
  // close it in shutdown().
  let modelWatcher = null;
  const modelsDir = path.join(__dirname, 'models');
  if (fs.existsSync(modelsDir)) {
    modelWatcher = fs.watch(modelsDir, (eventType, filename) => {
      if (!filename || (!filename.endsWith(`${opts.modelName}.js`) && !filename.endsWith(`${opts.modelName}.effects.js`) && !filename.endsWith(`${opts.modelName}.viewmasks.js`))) return;
      if (modelReloadTimer) clearTimeout(modelReloadTimer);
      modelReloadTimer = setTimeout(async () => {
        try {
          const newModel = await loadModel(opts.modelName, true);
          
          // groupBits is part of the comparison: a sidecar edit that only
          // renumbers the pinned table changes neither pixels nor presets
          // in a detectable way here, but stale MASK_* constants would
          // keep being injected into every later compile.
          // (maskConstants derives from groupBits + viewMasks, so these
          // three fields cover it.)
          const oldStr = JSON.stringify({ p: model.pixels, e: model.specialEffects, v: model.viewMasks, g: model.groupBits });
          const newStr = JSON.stringify({ p: newModel.pixels, e: newModel.specialEffects, v: newModel.viewMasks, g: newModel.groupBits });
          if (oldStr === newStr) {
            // No meaningful change — but if a previous reload was refused
            // and the disk model now matches the running one again (e.g.
            // the operator reverted the edit), the engine is no longer
            // stale: clear the flag and tell the operator surfaces.
            if (engineCore.modelSync.stale && newModel.pixelCount === model.pixelCount) {
              engineCore.modelSync.stale = false;
              engineCore.modelSync.message = null;
              console.log(`  ✅ Model on disk matches the running model again — stale flag cleared.`);
              if (apiServer && typeof apiServer.broadcastMixerState === 'function') {
                apiServer.broadcastMixerState();
              }
            }
            return;
          }
          
          console.log(`\n  🔄 Model changed on disk. Hot-reloading...`);
          if (newModel.pixelCount !== model.pixelCount) {
             const staleMsg = `Engine model is STALE: pixel count changed (${model.pixelCount} -> ${newModel.pixelCount}), hot reload refused. Restart the engine to apply the new model.`;
             console.log(`  ⚠️ ${staleMsg}`);
             // Make the refusal loud on the operator surface, not just
             // this console line: flag it in engineCore and push it out
             // over the mixer-state WS broadcast (sim banner reads it).
             engineCore.modelSync.stale = true;
             engineCore.modelSync.message = staleMsg;
             if (apiServer && typeof apiServer.broadcastMixerState === 'function') {
               apiServer.broadcastMixerState();
             }
             return;
          }

          // Apply new data in place
          for(let i = 0; i < model.pixelCount; i++) {
             Object.assign(model.pixels[i], newModel.pixels[i]);
          }
          model.specialEffects = newModel.specialEffects;
          model.viewMasks = newModel.viewMasks;
          model.groupBits = newModel.groupBits;
          model.maskConstants = newModel.maskConstants;
          model.fixtureConstants = newModel.fixtureConstants;
          model.viewTable = newModel.viewTable;
          wasmHost.setMaskConstants(model.maskConstants);
          wasmHost.setFixtureConstants(model.fixtureConstants);
          // Refresh the inView("Name") table + re-seed the bit-free-view
          // promoter against the reloaded model (new bits/membership).
          wasmHost.setViewTable(model.viewTable);
          wasmHost.setBitFreeViewPromoter(createBitFreeViewPromoter(model, wasmHost));

          wasmHost.setCoords(model.pixels);
          // Same precedence as boot: exporter `localIndex` when present
          // (copied onto model.pixels by the Object.assign above), else the
          // legacy (group,fId) heuristic — see pixel_local_index.js.
          const reloadLocalIndices = derivePixelLocalIndices(model.pixels);
          wasmHost.setPixelMeta(buildMetaArray(model.pixels, reloadLocalIndices));
          wasmHost.metaDirty = false;
          
          globalEffectsController.initFromModel(model.specialEffects || model.pixels);

          // The mixer snapshots the view-mask dictionary at construction
          // and bakes per-channel pixel masks — refresh both, or running
          // channels keep painting the old membership and views created
          // in the sim after engine start can never be selected.
          // (mixer.pixels === model.pixels — updated in place above —
          // so the recompile sees the fresh vMask values.)
          mixer.setModelViewMasks(model.viewMasks, model.groupBits);

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

          // Universes the new mapping no longer references must go DARK,
          // not frozen: their router buffers still hold the last rendered
          // frame and sendFrame would re-transmit it forever. Zero the
          // buffer, push ONE final all-zero frame so listeners black out,
          // then drop the id so subsequent frames stop including it.
          // Sender objects stay alive — registerUniverse may revive the
          // universe on a later reload; not sending is sufficient.
          const referencedUniverses = new Set();
          for (const px of model.pixels) {
            if (px.patch && px.patch.universe) referencedUniverses.add(px.patch.universe);
          }
          for (const fx of (model.specialEffects || [])) {
            if (fx.patch && fx.patch.universe) referencedUniverses.add(fx.patch.universe);
          }
          for (let i = universeIds.length - 1; i >= 0; i--) {
            const staleU = universeIds[i];
            if (referencedUniverses.has(staleU)) continue;
            const staleFrame = dmxRouter.getFullFrame(staleU);
            if (staleFrame) {
              staleFrame.fill(0);
              // The blackout is the LAST packet this universe ever
              // gets — a single lost UDP datagram would freeze every
              // listener on the final bright frame forever. Repeat it
              // 3× per the sACN stream-termination convention.
              for (let _i = 0; _i < 3; _i++) {
                sacnOut.sendFrame({ [staleU]: staleFrame });
              }
            }
            universeIds.splice(i, 1);
            console.log(`  🧹 Universe ${staleU} no longer mapped — sent blackout, stopped transmitting`);
          }

          // Successful reload — the running model matches disk again, so
          // clear any stale flag left by an earlier refused reload.
          engineCore.modelSync.stale = false;
          engineCore.modelSync.message = null;

          // Push the refreshed mixer/deck state to connected CaptainPads
          // so open sessions re-sync without a manual reload.
          if (apiServer && typeof apiServer.broadcastMixerState === 'function') {
            apiServer.broadcastMixerState();
          }

          console.log(`  ✅ Model hot-reloaded seamlessly.`);
        } catch (err) {
          console.warn(`  ⚠️ Model hot-reload failed: ${err.message}`);
        }
      }, 250);
    });
  }

  loop.start();

  // 7b. BPM → speed sync. Attaches to the CPC subscriber list and follows
  // the ARBITRATED pattern tempo (mixer.tempoBpm) — i.e. whatever drives the
  // clock: OSC auto-follow OR a manual TAP override — so SPEED tracks the
  // tapped tempo too, not only the analyzed OSC `audioBpm`. Source-agnostic
  // via the injected `getTempoBpm` resolver. Operator gates the behaviour via
  // the `bpmSpeedSync` CPC param (default off); when the arbitrated tempo is
  // 0/absent the sync doesn't drive (fail SAFE).
  const bpmSync = new BpmSpeedSync(paramCenter, { getTempoBpm: () => mixer.tempoBpm });
  bpmSync.attach();
  engineCore.bpmSync = bpmSync;

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
  const sceneStateDirPath = sceneStateDir(__dirname, opts.modelName);
  const sceneAudioOv      = loadSceneAudio(sceneStateDirPath);
  audioState.sceneDir     = sceneStateDirPath;
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

  // (2026-06-21) Audio structure detector + derived signals are NO LONGER
  // computed here — the Audio Companion (sole analyzer) computes them and emits
  // every key over OSC; the engine receives them via the /marsin/audio/* inbound
  // bindings. The `structureDetector.*` live-config block is still accepted +
  // persisted (the operator tunes the COMPANION's detector through it; the
  // engine just stores/forwards it), and the analyzer below still writes the raw
  // mic bands for the audio.enabled (engine-mic) path.

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
      // Hoisted analyzer-publish payload (codex: allocation-free hot path). The
      // {kind,key} shapes are static; only `.value` changes each hop. Allocate
      // the 19 objects + array ONCE per analyzer build (not ~1640 obj/s at
      // 86 Hz) and mutate in place in onAnalysis. paramCenter.setMany() reads
      // each entry synchronously and never retains the array, so reuse is safe.
      const micWrites = [
        { kind: 'scalar', key: 'micLow',     value: 0 },
        { kind: 'scalar', key: 'micMid',     value: 0 },
        { kind: 'scalar', key: 'micHigh',    value: 0 },
        { kind: 'scalar', key: 'micKick',    value: 0 },
        { kind: 'scalar', key: 'micFlux',    value: 0 },
        { kind: 'scalar', key: 'micLowRaw',  value: 0 },
        { kind: 'scalar', key: 'micMidRaw',  value: 0 },
        { kind: 'scalar', key: 'micHighRaw', value: 0 },
        { kind: 'scalar', key: 'micKickRaw', value: 0 },
        { kind: 'scalar', key: 'micFluxRaw', value: 0 },
        { kind: 'scalar', key: 'micDomFreq1',   value: 0 },
        { kind: 'scalar', key: 'micDomEnergy1', value: 0 },
        { kind: 'scalar', key: 'micDomFreq2',   value: 0 },
        { kind: 'scalar', key: 'micDomEnergy2', value: 0 },
        { kind: 'scalar', key: 'micOnsetLowRaw',  value: 0 },
        { kind: 'scalar', key: 'micOnsetMidRaw',  value: 0 },
        { kind: 'scalar', key: 'micOnsetHighRaw', value: 0 },
        { kind: 'scalar', key: 'micSubRaw',       value: 0 },
        { kind: 'scalar', key: 'micTonalStabilityRaw', value: 0 },
        { kind: 'scalar', key: 'micChromaFluxRaw',     value: 0 },
        { kind: 'scalar', key: 'micChromaTiltRaw',     value: 0 },
      ];
      audioState.analyzer = new AudioAnalyzer({
        sampleRate: cfg.capture.sampleRate,
        fftSize:    cfg.fftSize,
        hopSize:    cfg.hopSize,
        bands:      cfg.bands,
        kick:       cfg.kick,
        sub:        cfg.sub,   // analyzer_features (slot 3): sub-bass chest-hit window (optional)
        onAnalysis: ({ low, mid, high, kick, flux, domFreq1, domEnergy1, domFreq2, domEnergy2,
                       onsetLow, onsetMid, onsetHigh, micSub,
                       tonalStability, chromaFlux, chromaTilt }) => {
          const nowMs = Date.now();
          const dt = lastAnalysisAtMs === 0 ? 0 : Math.max(0, (nowMs - lastAnalysisAtMs) / 1000);
          lastAnalysisAtMs = nowMs;
          const lowPost  = signalPostProcessor.process('micLow',  low,  dt);
          const midPost  = signalPostProcessor.process('micMid',  mid,  dt);
          const highPost = signalPostProcessor.process('micHigh', high, dt);
          const kickPost = signalPostProcessor.process('micKick', kick, dt);
          const fluxPost = signalPostProcessor.process('micFlux', flux, dt);
          if (kickPost > 0.95) audioState.lastKickAt = nowMs;
          // Single setMany so the downstream onChange fan-out fires
          // ONCE per hop for the full bundle (post + raw), not twice.
          // CaptainPad SIGNAL DIAGNOSTICS uses the *Raw keys to render
          // the raw row of the diagnostics strip. micFlux (docs/30) is
          // the spectral-flux primitive the structure detector reads.
          // Mutate the hoisted payload in place (order matches micWrites above):
          // post bands, raw bands, dom1/dom2 + energy, then the slot-3 RAW
          // per-band onset strengths + sub-bass energy (additive analyzer
          // outputs the band_onsets/sub_bass shapers read each hop).
          micWrites[0].value  = lowPost;
          micWrites[1].value  = midPost;
          micWrites[2].value  = highPost;
          micWrites[3].value  = kickPost;
          micWrites[4].value  = fluxPost;
          micWrites[5].value  = low;
          micWrites[6].value  = mid;
          micWrites[7].value  = high;
          micWrites[8].value  = kick;
          micWrites[9].value  = flux;
          micWrites[10].value = domFreq1;
          micWrites[11].value = domEnergy1;
          micWrites[12].value = domFreq2;
          micWrites[13].value = domEnergy2;
          micWrites[14].value = onsetLow;
          micWrites[15].value = onsetMid;
          micWrites[16].value = onsetHigh;
          micWrites[17].value = micSub;
          micWrites[18].value = tonalStability;
          micWrites[19].value = chromaFlux;
          micWrites[20].value = chromaTilt;
          paramCenter.setMany(micWrites, 'audio', 'audio:mic');
          // (2026-06-21) The structure detector + derived signals are no longer
          // ticked here — the Companion (sole analyzer) computes them and emits
          // every derived key over OSC, which arrives via the /marsin/audio/*
          // bindings. This engine-mic analyzer now writes only the RAW mic bands
          // above (the audio.enabled path); the derived layer lives in the
          // Companion. (`dt` is still consumed by the band writes; `nowMs` is the
          // analyzer clock used by the capture/visualizer.)
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
        // `loop` only applies to file: capture sources (default true so a
        // short show clip doesn't stop the meters); ignored for live mics.
        loop:         cfg.capture.loop,
        frameSamples: cfg.hopSize,
        captureBufferMs:      cfg.capture.captureBufferMs,
        jitterBufferHops:     cfg.capture.jitterBufferHops,
        stopTimeoutMs:        cfg.capture.stopTimeoutMs,
        stderrWarnIntervalMs: cfg.capture.stderrWarnIntervalMs,
        onFrame:  (i16) => audioState.analyzer.pushSamples(i16),
        onStatus: (s)   => {
          audioState.lastStatus = { ...s, error: s.error || null, lastKickMs: audioState.lastKickAt };
          broadcastStatsRef.publish({ type: 'audioStatus', ...audioState.lastStatus });
          // Terminal capture give-up (repeated ffmpeg spawn/exit failures —
          // e.g. a bogus `capture.device` restored from a polluted
          // audio_state.yaml). Same posture as the boot-throw catch below:
          // disable audio LOUDLY, broadcast the error, keep rendering. The
          // engine must never die — silently or otherwise — over a mic.
          if (s.errorCode === 'capture_failed_repeatedly') {
            console.error(
              `  ❌ audio capture PERMANENTLY disabled after repeated ffmpeg failures on ` +
              `device "${s.device}": ${s.error}\n` +
              `     Engine keeps rendering without audio. Fix the mic selection ` +
              `(states/${opts.modelName}/audio_state.yaml capture.*) or re-run ` +
              `\`node engine.js --choose_mic --model ${opts.modelName}\`.`,
            );
            // The capture already stopped its own timers and will not
            // restart; drop the refs so /audio/status + the 1 Hz heartbeat
            // report audio as OFF with the terminal error, not a zombie.
            audioState.capture = null;
            audioState.analyzer = null;
          }
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
      // Hot reconfigure path — bands/kick/sub only. Throws on invalid
      // combinations; caller catches and returns 400.
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick, sub: next.sub });
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
    // Rebroadcast the new config to EVERY /ws/control subscriber so the
    // engine stays the single source of truth: CaptainPad mirrors its
    // sliders and the Audio Companion drives its live analyzer gain /
    // smooth / device off this frame (two-way sync). Low volume,
    // operator-driven — see ws_topic_routing `audioConfig`.
    broadcastStatsRef.publish({ type: 'audioConfig', config: audioState.config });
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
      audioState.analyzer.reconfigure({ bands: next.bands, kick: next.kick, sub: next.sub });
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
    // Same single-source-of-truth rebroadcast as applyLiveUpdate so a
    // "Reset to defaults" snaps the Companion's live gain / smooth back
    // in lockstep with CaptainPad.
    broadcastStatsRef.publish({ type: 'audioConfig', config: audioState.config });
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

  // 7e. FIRE → LIGHTS SYNC listener (BM26-Stoker). Binds last, like OSC, and is
  // equally non-fatal: a bad config or a busy port disables fire sync and
  // nothing else. It receives the fire controllers' relay-edge datagrams
  // (relayed by the Stoker control panel) and drives a global effect through the
  // SAME /global-effect route CaptainPad uses. Strictly one-way — nothing here
  // can command or influence fire. See lib/fire_sync_listener.js.
  const fireSyncState = { listener: null, config: { ...(engineConfig.fire_sync || {}) } };
  engineCore.fireSyncState = fireSyncState;
  if (fireSyncState.config.enabled) {
    try {
      const fsl = new FireSyncListener({
        port:        fireSyncState.config.port,
        host:        fireSyncState.config.host || '0.0.0.0',
        effect:      fireSyncState.config.effect,
        triggerMask: fireSyncState.config.triggerMask,
        minOnMs:     fireSyncState.config.minOnMs,
        apiHost:     fireSyncState.config.apiHost || '127.0.0.1',
        apiPort:     (engineConfig.server && engineConfig.server.port) || 6968,
        onStats:     (s) => broadcastStatsRef.publish(s),
      });
      await fsl.startAsync();
      fireSyncState.listener = fsl;
      console.log(`  🔥 fire-sync listening on ${fsl.host}:${fsl.port} → ` +
        `${fsl.effect} (mask 0x${fsl.triggerMask.toString(16)}, min-ON ${fsl.minOnMs} ms)`);
    } catch (err) {
      // Loud and explicit — never a silent "the lights just don't flash tonight".
      console.error(`  ⚠️  fire-sync DISABLED: ${err && err.message}`);
      fireSyncState.listener = null;
    }
  } else {
    console.log('  🔥 fire-sync disabled (config.yaml: fire_sync.enabled: false)');
  }

  // 8. Graceful shutdown
  //
  // `afterClose` lets a caller (the scene-switch path) run AFTER every
  // listener/socket is released but BEFORE the process exits — so a
  // replacement engine can re-bind :6968 / the sACN sockets without an
  // EADDRINUSE race. Without it, shutdown exits the process as before.
  let shuttingDown = false;
  function shutdown(afterClose = null) {
    if (shuttingDown) return;
    shuttingDown = true;
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
    // Fire-sync UDP socket, same reasoning: release it before exit so a
    // replacement engine can re-bind :7703 without an EADDRINUSE race.
    if (fireSyncState.listener) {
      try { fireSyncState.listener.stop(); } catch (_) { /* ignore */ }
      fireSyncState.listener = null;
    }
    try { bpmSync.detach(); } catch (_) { /* ignore */ }
    // Close the model hot-reload watcher and cancel its debounce (report _30
    // step 10). Every live handle retired before exit is abort surface removed.
    if (modelReloadTimer) { clearTimeout(modelReloadTimer); modelReloadTimer = null; }
    if (modelWatcher) {
      try { modelWatcher.close(); } catch (e) { console.warn(`  ⚠ model watcher close failed: ${e.message}`); }
      modelWatcher = null;
    }
    // Stop the in-engine Timeline tick (docs/38 §15) before tearing the
    // render loop / API down so no late cue fires into a half-shut engine.
    try { apiServer.stopTimeline && apiServer.stopTimeline(); } catch (_) { /* ignore */ }
    loop.stop();
    // Release the HTTP/WS API socket so a replacement engine can re-bind
    // :6968 immediately (scene-switch restart). On a plain SIGINT/SIGTERM
    // the process exits anyway, but closing first is harmless.
    try { apiServer.closeNow && apiServer.closeNow(); } catch (_) { /* ignore */ }

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

    const finish = () => {
      try { sacnOut.stop(); } catch (_) { /* ignore */ }
      try { mixer.destroy(); } catch (_) { /* ignore */ }
      try { wasmHost.shutdown(); } catch (_) { /* ignore */ }
      console.log(`  ✅ Shutdown complete (${loop.frameCount} frames rendered)\n`);
      if (typeof afterClose === 'function') {
        afterClose();
      } else {
        process.exit(0);
      }
    };

    sacnOut.sendFrame(blackBuffers).then(finish).catch(finish);

    // Force exit after 2s — but ONLY when we're not handing off to a
    // restart callback (that path owns the exit after spawning the child).
    if (typeof afterClose !== 'function') {
      setTimeout(() => process.exit(0), 2000);
    }
  }

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  // Scene/model coordination hook (sim → engine, see POST /scene in
  // api_server.js). TWO callers, one mechanism:
  //   • POST /scene <other scene>  — cross-scene switch;
  //   • POST /scene/reload <active scene> — deliberate SAME-scene restart that
  //     applies a re-exported model the on-disk watcher refused (pixel-count
  //     change → `modelSync.stale`). Same argv, same ports, one engine.
  // Cross-scene model swaps change the pixel count and the
  // render loop / WASM buffers are sized once at boot, so an in-process swap
  // is impossible (the existing on-disk hot reloader refuses pixel-count
  // changes and goes STALE). The robust path is a clean restart with the new
  // --model: gracefully shut this engine down, then spawn a detached
  // replacement that re-binds the same ports with the new scene's model.
  //
  // The replacement is self-supervised (detached + unref'd) so this works
  // standalone (`node engine.js …`, the sim+engine verification path). The
  // process also exits with code 75 (EX_TEMPFAIL) to mark the restart as
  // INTENTIONAL — a parent supervisor (e.g. launcher.js, owned by the
  // launcher PR this branch merges into) can treat code 75 as "scene switch,
  // not a crash" and adopt/re-track the respawned engine instead of tearing
  // the stack down. See the merge notes in the handoff report.
  engineCore.requestSceneSwitch = (scene) => {
    const modelFile = path.join(__dirname, 'models', `${scene}.js`);
    if (!fs.existsSync(modelFile)) {
      // Mirror the API guard — never restart toward a missing model.
      console.error(`  ❌ Scene switch aborted: model not found: ${modelFile}`);
      return;
    }
    // Rebuild this engine's argv with the new model, preserving every other
    // flag the operator booted with (pattern, fps, priority, port, etc.).
    // The engine keys everything (model, state dir, /status activeScene) off
    // --model, so swapping just that flag is sufficient.
    const childArgs = [__filename];
    const src = process.argv.slice(2);
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      if (a === '--model' || a === '-m') { i++; continue; }
      childArgs.push(a);
    }
    childArgs.push('--model', scene);

    shutdown(() => {
      // Supervised mode: a parent launcher (BM26_SUPERVISED=1) owns the
      // respawn so the engine stays a tracked child. Hand it the target
      // scene via BM26_SCENE_SWITCH_FILE and exit 75 — do NOT self-spawn, or
      // there'd be two engines / an untracked orphan.
      if (process.env.BM26_SUPERVISED === '1') {
        const handoff = process.env.BM26_SCENE_SWITCH_FILE;
        if (!handoff) {
          console.error('  ❌ BM26_SUPERVISED set without BM26_SCENE_SWITCH_FILE — cannot hand off scene switch');
          process.exit(1);
        }
        try {
          fs.writeFileSync(handoff, JSON.stringify({ scene }));
        } catch (err) {
          // Fail loud and deterministically: exit as a real crash (not 75) so
          // the supervisor tears down rather than silently restarting on a
          // handoff it can't read.
          console.error(`  ❌ Failed to write scene handoff ${handoff}: ${err.message}`);
          process.exit(1);
        }
        console.log(`  🔁 Scene switch to '${scene}' — handing restart to supervisor (exit 75).`);
        process.exit(75);
      }
      // Standalone: self-supervise with a detached replacement, then exit 75.
      console.log(`  🔁 Respawning engine for scene '${scene}': node ${childArgs.join(' ')}`);
      const child = spawn(process.execPath, childArgs, {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: 'inherit',
      });
      child.unref();
      // Exit code 75 (EX_TEMPFAIL) signals an INTENTIONAL scene-switch
      // restart to any supervisor watching this process.
      process.exit(75);
    });
  };
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
