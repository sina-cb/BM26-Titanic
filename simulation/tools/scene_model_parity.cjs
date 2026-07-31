#!/usr/bin/env node
/**
 * scene_model_parity.cjs — the scene ↔ engine-model parity gate (CLI).
 *
 * Plan 20260725_33 §4. Answers, offline and in about a second: does
 * `marsin_engine/models/<scene>.js` (+ its sidecars) say EXACTLY what
 * `simulation/scenes/<scene>/*.yaml` says, and is what they say
 * electrically sendable?
 *
 *   node simulation/tools/scene_model_parity.cjs test_bench
 *   node simulation/tools/scene_model_parity.cjs titanic --strict
 *   node simulation/tools/scene_model_parity.cjs titanic --bench test_bench
 *   node simulation/tools/scene_model_parity.cjs test_bench titanic --json
 *
 * Modes:
 *   default   mapping-valid for the sim audit. Placeholder controllers
 *             (ip 0.0.0.0) and unpatched strands are listed loudly and pass.
 *   --strict  the HARDWARE gate. Every placeholder becomes an error: a
 *             sentinel IP means the real wiring is still unknown, so the rig
 *             must not be deployed off this mapping.
 *
 * Exit codes: 0 = pass · 1 = parity errors · 2 = the validator could not run
 * (missing scene, missing model, unparseable YAML) — never a silent skip.
 *
 * This process touches NOTHING at runtime: no ports, no engine, no sim. It
 * reads committed files only, so it is safe to run against the operator's
 * live stack.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const yaml = require('js-yaml');

const { checkSceneModelParity, SEVERITY } = require('../lib/scene_model_parity.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCENES_DIR = path.join(REPO_ROOT, 'simulation', 'scenes');
const MODELS_DIR = path.join(REPO_ROOT, 'marsin_engine', 'models');
const FIXTURE_DEFS_DIR = path.join(REPO_ROOT, 'simulation', 'dmx', 'fixtures');
const SIM_CONFIG = path.join(REPO_ROOT, 'simulation', 'config.yaml');

const MAX_PER_CODE = 10;

const USAGE = `Usage: node simulation/tools/scene_model_parity.cjs <scene> [<scene> ...] [options]

Options:
  --strict          hardware-ready mode: placeholder controllers (0.0.0.0) and
                    unpatched strands become errors
  --bench <scene>   source scene for the 'TB ' bench-block parity check
                    (default: test_bench)
  --json            emit the full finding list as JSON instead of a report
  --quiet           summary lines only

Exit: 0 pass · 1 parity errors · 2 the validator could not run`;

// ── Loading ─────────────────────────────────────────────────────────────

/** Loud stop: the validator could not RUN (as distinct from a parity
 *  failure). Throws so the loaders stay reusable from tests; `main()` turns
 *  it into exit 2. */
function fail(message) {
  throw new Error(message);
}

function loadYaml(file, { required = true } = {}) {
  if (!fs.existsSync(file)) {
    if (required) fail(`missing required file: ${file}`);
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  const parsed = yaml.load(text);
  if (parsed === undefined || parsed === null) return {};
  if (typeof parsed !== 'object') fail(`${file} did not parse to an object`);
  return parsed;
}

/**
 * The fixture-type catalog, loaded straight from the definition YAMLs the sim
 * fetches at boot (`simulation/dmx/fixtures/<family>/model_*.yaml`). This is
 * where a fixture's channel footprint and its pixel roster come from, so the
 * validator can predict the exported pixel map exactly, offline.
 */
function loadFixtureDefs() {
  if (!fs.existsSync(FIXTURE_DEFS_DIR)) fail(`missing fixture definitions dir: ${FIXTURE_DEFS_DIR}`);
  const defs = {};
  const sources = {};
  for (const family of fs.readdirSync(FIXTURE_DEFS_DIR)) {
    const familyDir = path.join(FIXTURE_DEFS_DIR, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const file of fs.readdirSync(familyDir)) {
      if (!file.startsWith('model_') || !file.endsWith('.yaml')) continue;
      const full = path.join(familyDir, file);
      const doc = yaml.load(fs.readFileSync(full, 'utf8'));
      const model = doc && doc.model;
      if (!model || !model.fixture_type) {
        fail(`${full} has no \`model.fixture_type\` — the sim's fixture registry would skip it`);
      }
      const type = model.fixture_type;
      if (defs[type]) {
        fail(`fixture_type '${type}' is declared by BOTH ${sources[type]} and ${full} — the ` +
          'sim registry keeps only one, so the footprint a fixture exports is ambiguous');
      }
      const pixels = Array.isArray(model.pixels) ? model.pixels : [];
      let maxChannel = 0;
      for (const px of pixels) {
        for (const ch of Object.values(px.channels || {})) {
          if (typeof ch === 'number' && ch > maxChannel) maxChannel = ch;
        }
      }
      defs[type] = {
        fixtureType: type,
        footprint: model.channel_mode || maxChannel,
        bus: model.bus || 'dmx',
        pixels: pixels.map((px) => ({ id: px.id, channels: px.channels || null })),
      };
      sources[type] = full;
    }
  }
  return defs;
}

async function loadModelModule(file, { required = true } = {}) {
  if (!fs.existsSync(file)) {
    if (required) {
      fail(`missing generated model: ${file}\n  The scene has never been exported. Open it in ` +
        'the sim and save (💾) to generate it.');
    }
    return null;
  }
  return import(pathToFileURL(file).href);
}

async function loadScene(scene) {
  const dir = path.join(SCENES_DIR, scene);
  if (!fs.existsSync(dir)) fail(`unknown scene '${scene}' (no directory ${dir})`);
  const model = await loadModelModule(path.join(MODELS_DIR, `${scene}.js`));
  const viewmasks = await loadModelModule(path.join(MODELS_DIR, `${scene}.viewmasks.js`),
    { required: false });
  const effects = await loadModelModule(path.join(MODELS_DIR, `${scene}.effects.js`),
    { required: false });
  return {
    scene,
    sceneConfig: loadYaml(path.join(dir, 'scene_config.yaml')),
    controllers: loadYaml(path.join(dir, 'controllers.yaml'), { required: false }) || {},
    patches: loadYaml(path.join(dir, 'patches.yaml'), { required: false }) || {},
    views: loadYaml(path.join(dir, 'views.yaml'), { required: false }) || {},
    model: { pixelCount: model.pixelCount, pixels: model.pixels },
    viewmasks: viewmasks ? { groupBits: viewmasks.groupBits, viewMasks: viewmasks.viewMasks } : null,
    effects: effects ? { specialEffects: effects.specialEffects } : null,
  };
}

function loadBenchSource(scene) {
  const dir = path.join(SCENES_DIR, scene);
  if (!fs.existsSync(dir)) return null;
  return {
    scene,
    sceneConfig: loadYaml(path.join(dir, 'scene_config.yaml')),
    controllers: loadYaml(path.join(dir, 'controllers.yaml'), { required: false }) || {},
    patches: loadYaml(path.join(dir, 'patches.yaml'), { required: false }) || {},
  };
}

// ── Reporting ───────────────────────────────────────────────────────────

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const SEVERITY_LABEL = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };

function printReport(result, options) {
  const { findings, stats } = result;
  console.log('');
  console.log(`── scene '${stats.scene}' ${options.strict ? '[STRICT / hardware gate]' : '[default / sim-audit]'}`);
  console.log(`   scene:  ${stats.sceneFixtures} DMX fixture(s), ${stats.sceneStrands} LED ` +
    `strand(s), ${stats.controllers} controller(s)`);
  console.log(`   model:  ${stats.modelPixels} pixel(s) (scene implies ${stats.expectedPixels})`);

  if (!options.quiet) {
    const sorted = [...findings].sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.check.localeCompare(b.check) || a.code.localeCompare(b.code));
    const shown = new Map();
    for (const f of sorted) {
      const key = `${f.severity}/${f.code}`;
      const n = (shown.get(key) || 0) + 1;
      shown.set(key, n);
      if (n > MAX_PER_CODE) continue;
      console.log('');
      console.log(`   ${SEVERITY_LABEL[f.severity]} ${f.check}/${f.code} — ${f.where}`);
      console.log(`          ${wrap(f.message, 10)}`);
    }
    for (const [key, n] of shown) {
      if (n > MAX_PER_CODE) {
        console.log('');
        console.log(`   … and ${n - MAX_PER_CODE} more ${key} finding(s) (use --json for all)`);
      }
    }
  }

  console.log('');
  const verdict = result.ok ? 'PASS' : 'FAIL';
  console.log(`   RESULT ${verdict} — ${stats.errors} error(s), ${stats.warnings} warning(s), ` +
    `${stats.infos} info`);
}

function wrap(text, indent) {
  const width = 88;
  const pad = ' '.repeat(indent);
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length > 0 && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line.length === 0 ? w : `${line} ${w}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join(`\n${pad}`);
}

// ── Main ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { scenes: [], strict: false, json: false, quiet: false, bench: 'test_bench' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
    else if (arg === '--bench') {
      i += 1;
      if (i >= argv.length) fail('--bench needs a scene name');
      options.bench = argv[i];
    } else if (arg.startsWith('-')) {
      fail(`unknown option '${arg}'\n${USAGE}`);
    } else {
      options.scenes.push(arg);
    }
  }
  if (options.scenes.length === 0) fail(`no scene named.\n${USAGE}`);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixtureDefs = loadFixtureDefs();
  const simConfig = loadYaml(SIM_CONFIG, { required: false }) || {};
  const pins = simConfig.global_effects || {};

  const results = [];
  for (const scene of options.scenes) {
    const loaded = await loadScene(scene);
    const benchScene = scene === options.bench ? null : loadBenchSource(options.bench);
    results.push(checkSceneModelParity({
      ...loaded, fixtureDefs, pins, benchScene, strict: options.strict,
    }));
  }

  if (options.json) {
    console.log(JSON.stringify({
      strict: options.strict,
      scenes: results.map((r) => ({ stats: r.stats, ok: r.ok, findings: r.findings })),
    }, null, 2));
  } else {
    for (const result of results) printReport(result, options);
    console.log('');
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.stats.scene);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[scene_model_parity] ${err && err.message ? err.message : err}`);
    process.exit(2);
  });
}

module.exports = { SEVERITY, loadScene, loadBenchSource, loadFixtureDefs, loadYaml, SIM_CONFIG };
