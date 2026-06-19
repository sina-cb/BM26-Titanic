/*
  gen_variations.mjs — generate STATIC + SOUND-REACTIVE gallery clips per pattern.

  DEV/REVIEW TOOL ONLY. For each show pattern, renders TWO offline clips so the
  gallery can offer them as switchable VARIATIONS of one pattern:

    STATIC  — `--synth silence`, no audio modulation. What the pattern looks
              like at rest (operator-set sliders only).
    SOUND   — `--synth <spec.synth>` driven by the pattern's AUDIO_MODULATION_V1
              block as `--mod <spec.modString>`, with the override RANGES, so it
              looks like the deployed sound-reactive engine output.

  Pipeline (all Node built-ins + the in-repo offline tools, no engine, no deps):
    pattern source --(audio_mod_spec)--> { synth, modString }
    pattern_audio_harness.mjs            -> capture JSON in ~/tmp
    tools/gallery/publish.mjs            -> wrapped widget HTML, then RENAMED to
                                            the variation widget name (below).

  ── Variation widget naming ─────────────────────────────────────────────────
  The gallery groups clips by splitting the filename on "__" and classifying
  each segment (server.mjs parseName): a known MODEL name -> model; `static` or
  `sound` -> variation; legacy unknown -> model. So we publish:

    test_bench (default model):
      <pattern>__static        static clip
      <pattern>__sound         sound clip
    other model <m>:
      <pattern>__<m>__static
      <pattern>__<m>__sound

  These coexist with the existing bare `<pattern>` and `<pattern>__<model>`
  clips (which still parse as the base / model-variant). publish.mjs forbids
  "__" in --name, so we publish under a SAFE temp name and rename the widget.

  Usage (run from marsin_engine/):
    node tools/gallery/gen_variations.mjs                 # ALL patterns × test_bench + titanic
    node tools/gallery/gen_variations.mjs --pattern 27    # just NN_* (e.g. 27_swipe), both rigs
    node tools/gallery/gen_variations.mjs --pattern 24,25,27
    node tools/gallery/gen_variations.mjs --model titanic # a SINGLE non-default rig
    node tools/gallery/gen_variations.mjs --models test_bench,titanic,summer_camp_dome
    node tools/gallery/gen_variations.mjs --seconds 10 --fps 14

  MODELS: by default we render BOTH test_bench and titanic so the gallery ships
  with both rigs. --model <one> forces a single rig; --models a,b,c an explicit
  set. Each (pattern, model) yields a STATIC and (if it has a block) a SOUND clip.

  FAIL LOUD: a compile/render error STOPS the run (codex P0 — never skip
  silently). A pattern with NO AUDIO_MODULATION_V1 block gets its STATIC clip
  and is REPORTED as "no-block" (the sound clip is genuinely absent, not a
  silent failure).
*/
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';
import { execFileSync } from 'child_process';
import { parseAudioModSpec } from '../audio_mod_spec.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');      // marsin_engine/
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const WIDGETS_DIR = path.join(HERE, 'widgets');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const PUBLISH = path.join(HERE, 'publish.mjs');
const home = process.env.USERPROFILE || process.env.HOME;
const TMP_DIR = path.join(home, 'tmp', 'gen_variations');

const DEFAULT_MODEL = 'test_bench';
// By DEFAULT we render every pattern on BOTH the bench and the ship so the
// gallery ships with both rigs out of the box. Override with --model <one> for
// a single rig, or --models a,b,c for an explicit set.
const DEFAULT_MODELS = ['test_bench', 'titanic'];
function resolveModels() {
  const single = arg('model');
  const list = arg('models');
  let models;
  if (single !== undefined) models = [single];
  else if (list !== undefined) models = list.split(',').map((s) => s.trim()).filter(Boolean);
  else models = DEFAULT_MODELS.slice();
  if (!models.length) {
    console.error('error: no models resolved (empty --models?)');
    process.exit(1);
  }
  for (const m of models) {
    if (!/^[A-Za-z0-9._-]+$/.test(m) || m.includes('__')) {
      console.error('error: model must be a bare model name (no "__"), got: ' + m);
      process.exit(1);
    }
  }
  return models;
}
const models = resolveModels();
const seconds = arg('seconds', '10');
const fps = arg('fps', '14');
const patternFilter = arg('pattern'); // e.g. "27" or "24,25,27"

// Resolve which patterns to process. Default = all top-level patterns/[0-9]*_*.js.
// --pattern NN[,NN...] filters to those leading numbers.
function listPatterns() {
  const all = fs.readdirSync(PATTERNS_DIR)
    .filter((f) => /^\d+_.*\.js$/.test(f))
    .sort();
  if (!patternFilter) return all;
  const wanted = new Set(patternFilter.split(',').map((s) => s.trim()).filter(Boolean));
  const out = all.filter((f) => {
    const m = /^(\d+)_/.exec(f);
    return m && wanted.has(m[1]);
  });
  if (!out.length) {
    console.error('error: --pattern ' + patternFilter + ' matched no patterns in ' + PATTERNS_DIR);
    process.exit(1);
  }
  return out;
}

// Run a clip: harness -> capture JSON, then publish -> widget, then rename the
// widget to the variation name. STOPS the whole run on any failure (fail loud).
//   variation : 'static' | 'sound'
//   modArgs   : extra harness flags (['--synth','silence'] or sound spec args)
// Returns the final widget basename.
function makeClip(patternFile, patternBase, model, variation, harnessFlags) {
  // Run-unique capture path so concurrent gen_variations processes (e.g. several
  // tuning agents) can't clobber each other's scratch JSON for the same clip.
  const capture = path.join(TMP_DIR,
    patternBase + '__' + model + '__' + variation + '.' + process.pid + '.json');
  const harnessArgs = [
    HARNESS,
    '--pattern', path.join('patterns', patternFile),
    '--model', model,
    '--seconds', String(seconds),
    // Record AT the requested fps so --fps actually changes the clip (the harness
    // captures at --out-fps; without this it always stored 20fps).
    '--out-fps', String(fps),
    '--out', capture,
    ...harnessFlags,
  ];
  // execFileSync throws (and we let it propagate -> non-zero exit) on harness
  // failure: COMPILE_FAIL / MOD_FAIL / SECONDS_FAIL all exit non-zero.
  execFileSync('node', harnessArgs, { cwd: ENGINE_DIR, stdio: 'inherit' });

  // Publish under a SAFE temp name (publish forbids "__" in --name), then rename
  // to the variation widget name. We publish with model=test_bench so publish
  // keeps the bare temp name (no __model suffix of its own), and add our own
  // segments in the rename — keeping publish.mjs untouched.
  const tmpName = 'genvar_tmp_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  const publishArgs = [
    PUBLISH,
    '--name', tmpName,
    '--capture', capture,
    '--fps', String(fps),
    '--model', DEFAULT_MODEL,   // force bare temp widget, no publish-side suffix
  ];
  execFileSync('node', publishArgs, { cwd: ENGINE_DIR, stdio: 'inherit' });

  const tmpWidget = path.join(WIDGETS_DIR, tmpName + '.html');
  if (!fs.existsSync(tmpWidget)) {
    throw new Error('publish did not produce expected widget: ' + tmpWidget);
  }
  // Final widget name: <pattern>[__<model>]__<variation>.
  const segs = [patternBase];
  if (model !== DEFAULT_MODEL) segs.push(model);
  segs.push(variation);
  const finalName = segs.join('__');
  const finalWidget = path.join(WIDGETS_DIR, finalName + '.html');
  fs.renameSync(tmpWidget, finalWidget);
  return finalName;
}

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(WIDGETS_DIR, { recursive: true });

const patterns = listPatterns();
console.log('gen_variations: ' + patterns.length + ' pattern(s) × ' + models.length +
  ' model(s) [' + models.join(', ') + '], ' + seconds + 's @ ' + fps + 'fps');
console.log('');

const summary = [];
for (const file of patterns) {
  const base = file.replace(/\.js$/, '');
  const src = fs.readFileSync(path.join(PATTERNS_DIR, file), 'utf8');
  // parseAudioModSpec throws on a MALFORMED block (fail loud); a missing block
  // is null (we still do the static clip + report no-block).
  const spec = parseAudioModSpec(src, base);

  console.log('── ' + base + ' ' + '─'.repeat(Math.max(0, 40 - base.length)));

  for (const model of models) {
    const tag = '[' + model + '] ';
    // STATIC clip — silence, no modulation.
    const staticName = makeClip(file, base, model, 'static', ['--synth', 'silence']);
    console.log('  ' + tag + 'static -> /w/' + staticName);

    // SOUND clip — only when the pattern has an AUDIO_MODULATION_V1 block.
    let soundName = null;
    if (spec) {
      soundName = makeClip(file, base, model, 'sound', ['--synth', spec.synth, '--mod', spec.modString]);
      console.log('  ' + tag + 'sound  -> /w/' + soundName + '   (synth=' + spec.synth + ')');
    } else {
      console.log('  ' + tag + 'sound  -> SKIPPED (no AUDIO_MODULATION_V1 block)');
    }

    summary.push({ base, model, static: true, sound: !!soundName, synth: spec ? spec.synth : null, noBlock: !spec });
  }
  console.log('');
}

// ── per-pattern summary ───────────────────────────────────────────────────────
console.log('================ SUMMARY ================');
let staticOk = 0, soundOk = 0, noBlock = 0;
for (const s of summary) {
  if (s.static) staticOk++;
  if (s.sound) soundOk++;
  if (s.noBlock) noBlock++;
  const flags = [
    s.static ? 'static✓' : 'static✗',
    s.sound ? ('sound✓(' + s.synth + ')') : (s.noBlock ? 'sound—(no-block)' : 'sound✗'),
  ].join('  ');
  console.log('  ' + (s.base + ' @' + s.model).padEnd(44) + flags);
}
console.log('----------------------------------------');
console.log('  ' + patterns.length + ' pattern(s) × ' + models.length + ' model(s) = ' +
  summary.length + ' renders: ' + staticOk + ' static, ' + soundOk + ' sound, ' + noBlock + ' no-block');
console.log('  widgets dir: ' + WIDGETS_DIR);
console.log('  serve: node tools/gallery/server.mjs   then open /');
