#!/usr/bin/env node
/**
 * bench_section_sync.cjs — derive the `TB `-prefixed test-bench block for another
 * scene, offline and idempotently (report 20260725_33 §3 option B, plan step 4).
 *
 * WHY: the engine loads exactly one model and no scene-include mechanism exists,
 * so to sanity-check looks on the real bench while the engine runs titanic, the
 * bench must appear INSIDE the titanic scene. The **test_bench scene remains the
 * single source of truth**; this tool derives the copy, and the copy is only ever
 * changed by re-deriving. Every other path is caught by the parity gate.
 *
 * NON-NEGOTIABLES (codex P0 — fail loudly, never drift silently):
 *   - test_bench is READ-ONLY here. This tool never writes to the source scene.
 *   - It refuses on any divergence it cannot reconcile, with named findings and
 *     a distinct exit code. It never "fixes up" a mismatch.
 *   - Re-running with an unchanged source produces a BYTE-IDENTICAL block.
 *   - PHASE A BOUNDARY: it does NOT inject the block into the target scene.
 *     Applying is plan step 6 (Phase B); `--apply` refuses with a pointer.
 *
 * USAGE
 *   node tools/bench_section_sync.cjs [options]
 *
 *   --source <scene>   source scene, read-only          (default: test_bench)
 *   --target <scene>   scene the block is destined for  (default: titanic)
 *   --prefix <str>     namespace prefix                 (default: "TB ")
 *   --dock <x,y,z>     dock offset beside the ship      (default: 50,0,0)
 *   --out <path>       write the block YAML here        (default: stdout)
 *   --check            compare-only: no output file; report target parity state
 *   --require-applied  under --check, an ABSENT block is a failure (Phase B gate)
 *   --strict           placeholder sentinels become failures (hardware gate)
 *   --json             machine-readable report on stdout
 *   --quiet            suppress the human summary on stderr
 *
 * EXIT CODES (distinct so CI and the parity validator can branch)
 *   0  ok
 *   1  usage / IO error
 *   2  REFUSED — source scene is internally inconsistent
 *   3  REFUSED — target's existing block diverges from the derived one
 *   4  REFUSED — target collision (namespace, reserved universe, view budget)
 *   5  REFUSED — --strict and placeholder sentinels remain
 *
 * INTEGRATION POINT for the §4 parity validator (sibling slice,
 * simulation/tools/scene_model_parity.cjs) — its check 6 should not re-implement
 * any of this; it calls the library directly:
 *
 *   const { deriveBenchSection, extractBenchSection, compareBenchSection }
 *     = require('../lib/bench_section.cjs');
 *   const { block } = deriveBenchSection({ source });           // from test_bench
 *   const actual = extractBenchSection({ ...targetYamls });     // null ⇒ not applied
 *   const { inSync, diffs } = compareBenchSection(block, actual);
 */
'use strict';

const fs = require('fs');
const path = require('path');

const yaml = require('js-yaml');

const {
  BENCH_PREFIX,
  DEFAULT_DOCK,
  SEVERITY_REFUSE,
  SEVERITY_WARN,
  checkSourceIntegrity,
  deriveBenchSection,
  compareBenchSection,
  extractBenchSection,
  checkTargetCompatibility,
} = require('../lib/bench_section.cjs');

const SIM_ROOT = path.resolve(__dirname, '..');
const SCENE_FILES = ['scene_config', 'controllers', 'patches', 'views'];

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_SOURCE_DIVERGENCE = 2;
const EXIT_TARGET_DIVERGENCE = 3;
const EXIT_TARGET_COLLISION = 4;
const EXIT_STRICT_PLACEHOLDER = 5;

// js-yaml dump options that keep emission stable: no anchors, no wrapping, and
// NO key sorting (the library already fixed a canonical order).
const YAML_DUMP_OPTS = { noRefs: true, lineWidth: -1, sortKeys: false, quotingType: '"' };

// ── CLI parsing (unknown flags are fatal — never guess at intent) ────────────

function parseArgs(argv) {
  const opts = {
    source: 'test_bench',
    target: 'titanic',
    prefix: BENCH_PREFIX,
    dock: { ...DEFAULT_DOCK },
    out: null,
    check: false,
    requireApplied: false,
    strict: false,
    json: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const need = (name) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`${name} requires a value`);
      }
      i += 1;
      return v;
    };
    switch (arg) {
      case '--source': opts.source = need('--source'); break;
      case '--target': opts.target = need('--target'); break;
      case '--prefix': opts.prefix = need('--prefix'); break;
      case '--out': opts.out = need('--out'); break;
      case '--dock': {
        const parts = need('--dock').split(',').map((n) => Number(n.trim()));
        if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
          throw new Error('--dock expects three finite numbers: x,y,z');
        }
        opts.dock = { x: parts[0], y: parts[1], z: parts[2] };
        break;
      }
      case '--check': opts.check = true; break;
      case '--require-applied': opts.requireApplied = true; break;
      case '--strict': opts.strict = true; break;
      case '--json': opts.json = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--apply':
        throw new Error(
          '--apply is NOT implemented in Phase A. Injecting the block into the target ' +
          'scene is plan step 6 (report 20260725_33 §6, Phase B) and must run against ' +
          'the live sim so the registry re-projects patches and the model is re-exported.');
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument '${arg}'`);
    }
  }
  return opts;
}

// ── Scene I/O (read-only) ───────────────────────────────────────────────────

/**
 * Read a scene's four YAMLs. Missing controllers/patches/views are tolerated as
 * EMPTY (a freshly authored scene legitimately has none) but a missing
 * scene_config.yaml is fatal — that scene does not exist.
 */
function readScene(sceneName) {
  const dir = path.join(SIM_ROOT, 'scenes', sceneName);
  if (!fs.existsSync(path.join(dir, 'scene_config.yaml'))) {
    throw new Error(`scene '${sceneName}' has no scene_config.yaml at ${dir}`);
  }
  const out = {};
  for (const base of SCENE_FILES) {
    const p = path.join(dir, `${base}.yaml`);
    const key = base === 'scene_config' ? 'sceneConfig' : base;
    if (!fs.existsSync(p)) {
      out[key] = {};
      continue;
    }
    out[key] = yaml.load(fs.readFileSync(p, 'utf8')) || {};
  }
  return out;
}

/** Serialize the block deterministically — this is the idempotency surface. */
function serializeBlock(block) {
  const header = [
    '# GENERATED — do not hand-edit.',
    '# Derived from the test_bench scene by tools/bench_section_sync.cjs',
    '# (report 20260725_33 §3B). test_bench is the single source of truth: to',
    '# change this block, change the bench scene and re-run the tool. Hand edits',
    '# are caught by the parity gate and REFUSED.',
    '#',
    '# Deliberately absent: sectionId / fixtureId / viewMask / viewMaskHi / controllerId and',
    '# controller ids (re-derived by the TARGET registry) and device.lastPush',
    '# (volatile push receipt).',
    '',
  ].join('\n');
  return `${header}${yaml.dump({ benchSection: block }, YAML_DUMP_OPTS)}`;
}

// ── Reporting ───────────────────────────────────────────────────────────────

function printFindings(findings, quiet) {
  if (quiet) return;
  for (const f of findings) {
    const tag = f.severity === SEVERITY_REFUSE ? 'REFUSE'
      : f.severity === SEVERITY_WARN ? 'WARN ' : 'INFO ';
    process.stderr.write(`  [${tag}] ${f.code} · ${f.scope}: ${f.message}\n`);
  }
}

function fail(report, opts, code, headline) {
  report.ok = false;
  report.exitCode = code;
  report.headline = headline;
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!opts.quiet) process.stderr.write(`\n✖ REFUSED: ${headline}\n`);
  return code;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`bench_section_sync: ${err.message}\n`);
    return EXIT_USAGE;
  }
  if (opts.help) {
    process.stdout.write(`${fs.readFileSync(__filename, 'utf8').split('\n')
      .filter((l) => l.startsWith(' *')).map((l) => l.slice(2)).join('\n')}\n`);
    return EXIT_OK;
  }

  let source;
  let target;
  try {
    source = readScene(opts.source);
    target = readScene(opts.target);
  } catch (err) {
    process.stderr.write(`bench_section_sync: ${err.message}\n`);
    return EXIT_USAGE;
  }

  const report = {
    tool: 'bench_section_sync',
    source: opts.source,
    target: opts.target,
    prefix: opts.prefix,
    mode: opts.check ? 'check' : 'emit',
    strict: opts.strict,
    ok: true,
    exitCode: EXIT_OK,
    findings: [],
  };

  if (!opts.quiet) {
    process.stderr.write(
      `bench_section_sync: deriving '${opts.prefix}' block from '${opts.source}' ` +
      `for '${opts.target}' (${report.mode} mode)\n`);
  }

  // 1 ── source integrity: refuse to derive from a scene that contradicts itself.
  const sourceFindings = checkSourceIntegrity(source);
  report.findings.push(...sourceFindings);
  printFindings(sourceFindings, opts.quiet);
  if (sourceFindings.some((f) => f.severity === SEVERITY_REFUSE)) {
    return fail(report, opts, EXIT_SOURCE_DIVERGENCE,
      `source scene '${opts.source}' is internally inconsistent — fix the bench scene first`);
  }

  // 2 ── derive.
  const { block } = deriveBenchSection({
    source,
    sourceScene: opts.source,
    prefix: opts.prefix,
    dock: opts.dock,
  });
  report.sourceDigest = block.sourceDigest;
  report.summary = {
    controllers: block.controllers.length,
    fixtures: block.fixtures.length,
    ledStrands: block.ledStrands.length,
    pixels: block.ledStrands.reduce((n, s) => n + (parseInt(s.ledCount, 10) || 0), 0),
    universes: block.universes,
    viewBitNames: block.viewBitNames,
  };

  // 3 ── target compatibility: can this block legally land there at all?
  const targetFindings = checkTargetCompatibility({ block, target, prefix: opts.prefix });
  report.findings.push(...targetFindings);
  printFindings(targetFindings, opts.quiet);
  if (targetFindings.some((f) => f.severity === SEVERITY_REFUSE)) {
    return fail(report, opts, EXIT_TARGET_COLLISION,
      `target scene '${opts.target}' cannot accept the block as derived`);
  }

  // 4 ── parity against whatever the target already carries.
  const applied = extractBenchSection({
    sceneConfig: target.sceneConfig,
    controllers: target.controllers,
    prefix: opts.prefix,
    sourceScene: opts.source,
  });
  if (applied === null) {
    report.parity = 'absent';
    if (opts.requireApplied) {
      return fail(report, opts, EXIT_TARGET_DIVERGENCE,
        `target scene '${opts.target}' carries no '${opts.prefix}' block but --require-applied was set`);
    }
  } else {
    const { inSync, diffs } = compareBenchSection(block, applied);
    report.parity = inSync ? 'in_sync' : 'divergent';
    report.diffs = diffs;
    if (!inSync) {
      if (!opts.quiet) {
        process.stderr.write(`  ${diffs.length} invariant field(s) diverge:\n`);
        for (const d of diffs.slice(0, 40)) {
          process.stderr.write(
            `    ${d.path}: derived=${JSON.stringify(d.expected)} target=${JSON.stringify(d.actual)}\n`);
        }
        if (diffs.length > 40) process.stderr.write(`    … ${diffs.length - 40} more\n`);
      }
      return fail(report, opts, EXIT_TARGET_DIVERGENCE,
        `the '${opts.prefix}' block in '${opts.target}' diverges from '${opts.source}' — ` +
        'the copy is DERIVED: fix the bench scene and re-derive, never hand-edit the copy');
    }
  }

  // 5 ── strict placeholder gate (the hardware-readiness gate, report §2).
  const placeholders = report.findings.filter((f) => f.code === 'BLOCK_PLACEHOLDER_IP');
  if (opts.strict && placeholders.length > 0) {
    return fail(report, opts, EXIT_STRICT_PLACEHOLDER,
      `--strict: ${placeholders.length} placeholder controller(s) still carry the sentinel IP`);
  }

  // 6 ── emit.
  const yamlText = serializeBlock(block);
  report.bytes = Buffer.byteLength(yamlText, 'utf8');
  if (!opts.check) {
    if (opts.out) {
      const outPath = path.resolve(opts.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, yamlText, 'utf8');
      report.out = outPath;
    } else if (!opts.json) {
      process.stdout.write(yamlText);
    }
  }

  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!opts.quiet) {
    const warns = report.findings.filter((f) => f.severity === SEVERITY_WARN).length;
    process.stderr.write(
      `\n✔ ${report.mode === 'check' ? 'parity' : 'derived'}: ` +
      `${report.summary.controllers} controller(s), ${report.summary.fixtures} fixture(s), ` +
      `${report.summary.ledStrands} strand(s)/${report.summary.pixels} px, ` +
      `U[${report.summary.universes.join(',')}] · parity=${report.parity} · ` +
      `digest=${report.sourceDigest.slice(0, 12)} · ${warns} warning(s)\n`);
    if (report.parity === 'absent' && !opts.check) {
      process.stderr.write(
        '  Phase A boundary: the block is NOT applied to the target scene. ' +
        'Applying is plan step 6.\n');
    }
  }
  return EXIT_OK;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, readScene, serializeBlock, SIM_ROOT };
