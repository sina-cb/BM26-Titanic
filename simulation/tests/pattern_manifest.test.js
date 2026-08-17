/**
 * pattern_manifest.test.js — guards the generator behind
 * marsin_engine/patterns/manifest.json.
 *
 * WHY THIS FILE EXISTS. The save server rewrites the manifest at boot and after
 * every mutation, so the tracked file is only ever as good as the generator: any
 * id the generator cannot produce is deleted from git the next time the sim
 * starts. That is how the qualified subdirectory ids were being lost — the old
 * generator was a top-level-only `readdirSync`, so `baby/01_tease_orbit_question`
 * survived a commit but not a restart, with no error anywhere. A silent
 * truncation is exactly the fallback behaviour `.agent/codex.md` forbids.
 *
 * So the contract under test is three-part:
 *   1. The generator round-trips the TRACKED manifest exactly. If this fails,
 *      starting the sim would rewrite the file — the diff is the bug.
 *   2. Every playlist entry in every scene resolves against that manifest.
 *   3. An unclassified pattern subdirectory is a LOUD throw, never a silent
 *      omission, so a new pattern family cannot go missing quietly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_PATTERN_DIRS,
  NON_MANIFEST_PATTERN_DIRS,
  listPatterns,
} from '../server/pattern_manifest.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(REPO_DIR, 'marsin_engine', 'patterns');
const MANIFEST_PATH = path.join(PATTERNS_DIR, 'manifest.json');
const SCENES_DIR = path.join(REPO_DIR, 'simulation', 'scenes');

function trackedManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

test('the generator reproduces the tracked manifest exactly', () => {
  const generated = listPatterns(PATTERNS_DIR);
  const tracked = trackedManifest();
  // deepEqual on the arrays so ORDER is pinned too: the manifest is rewritten
  // wholesale, and an order-only difference is still a spurious commit diff
  // every time the operator starts the sim.
  assert.deepEqual(generated, tracked,
    'starting the sim would rewrite patterns/manifest.json — regenerate and commit it');
});

test('every registered subdirectory family is present, qualified, and complete', () => {
  const manifest = trackedManifest();
  for (const dir of MANIFEST_PATTERN_DIRS) {
    const full = path.join(PATTERNS_DIR, dir);
    assert.equal(fs.existsSync(full), true, `registered pattern dir is missing: ${dir}`);
    const onDisk = fs.readdirSync(full)
      .filter((name) => name.endsWith('.js') && !name.startsWith('test_'))
      .map((name) => `${dir}/${name.replace(/\.js$/, '')}`)
      .sort();
    const registered = manifest.filter((id) => id.startsWith(`${dir}/`)).sort();
    assert.deepEqual(registered, onDisk, `${dir}/ is not fully registered in the manifest`);
  }
});

test('every manifest id resolves to a source file on disk', () => {
  for (const id of trackedManifest()) {
    assert.equal(fs.existsSync(path.join(PATTERNS_DIR, `${id}.js`)), true,
      `manifest lists "${id}" but there is no such pattern source`);
  }
});

test('an unclassified pattern subdirectory fails loudly instead of vanishing', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_manifest_'));
  try {
    fs.writeFileSync(path.join(sandbox, '00_root.js'), '// pattern\n');
    // Every REGISTERED directory must exist or listPatterns throws (that is the
    // other half of the policy), so the fixture is derived from the registry
    // rather than hard-coding today's members — registering a new family must
    // not break this test.
    for (const dir of MANIFEST_PATTERN_DIRS) fs.mkdirSync(path.join(sandbox, dir));
    fs.writeFileSync(path.join(sandbox, 'baby', '01_thing.js'), '// pattern\n');
    // Baseline: the classified tree generates cleanly, root first then qualified;
    // the other registered dirs are empty and contribute nothing.
    assert.deepEqual(listPatterns(sandbox), ['00_root', 'baby/01_thing']);

    // A brand-new family nobody classified must NOT be silently dropped.
    fs.mkdirSync(path.join(sandbox, 'brand_new_family'));
    fs.writeFileSync(path.join(sandbox, 'brand_new_family', '02_thing.js'), '// pattern\n');
    assert.throws(() => listPatterns(sandbox), /unclassified pattern subdirectory: brand_new_family/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('the excluded subdirectories are classified with a stated reason', () => {
  for (const [dir, reason] of Object.entries(NON_MANIFEST_PATTERN_DIRS)) {
    assert.equal(typeof reason, 'string');
    assert.ok(reason.length > 10, `${dir}: exclusion needs a real reason, got "${reason}"`);
    assert.ok(!MANIFEST_PATTERN_DIRS.includes(dir),
      `${dir} is both registered and excluded`);
  }
  // Every directory actually on disk is accounted for one way or the other.
  for (const entry of fs.readdirSync(PATTERNS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const classified = MANIFEST_PATTERN_DIRS.includes(entry.name)
      || Object.prototype.hasOwnProperty.call(NON_MANIFEST_PATTERN_DIRS, entry.name);
    assert.ok(classified, `patterns/${entry.name}/ is neither registered nor excluded`);
  }
});

// The manifest is what the operator's pattern picker reads, so a playlist entry
// naming an unregistered pattern is an entry the operator cannot re-select after
// changing it — even when the file happens to exist on disk.
// `default.yaml` is not a curated playlist: PlaylistManager.generateDefault()
// snapshots "one entry per pattern" at whatever moment it is run, so the copies
// checked in are frozen inventories that rot as patterns are renamed and moved.
// Two of them still name the summer_camp patterns by the UNQUALIFIED ids they
// had before those sources moved into patterns/summer_camp/. That rot predates
// this work and repairing it is a separate job in scenes the Baby show does not
// touch — but it must not spread, so it is pinned by name below rather than
// waved through.
// `titanic` was on that list until its default.yaml was regenerated: its rot was
// the three deleted root `13x_baby_*` ids, and the fresh snapshot names only
// registered patterns. The pin NARROWED to match the repaired data — the
// direction the assertion message forbids is widening it.
const GENERATED_PLAYLIST = 'default.yaml';

test('every curated playlist entry in every scene names a registered pattern', () => {
  const manifest = new Set(trackedManifest());
  const unregistered = [];
  const generatedRot = new Set();
  for (const scene of fs.readdirSync(SCENES_DIR, { withFileTypes: true })) {
    if (!scene.isDirectory()) continue;
    const playlistDir = path.join(SCENES_DIR, scene.name, 'playlists');
    if (!fs.existsSync(playlistDir)) continue;
    for (const file of fs.readdirSync(playlistDir).filter((n) => n.endsWith('.yaml'))) {
      const doc = yaml.load(fs.readFileSync(path.join(playlistDir, file), 'utf8'));
      for (const entry of doc.entries || []) {
        if (typeof entry.pattern !== 'string') continue;
        if (manifest.has(entry.pattern)) continue;
        if (file === GENERATED_PLAYLIST) generatedRot.add(scene.name);
        else unregistered.push(`${scene.name}/${file}: ${entry.pattern}`);
      }
    }
  }

  assert.deepEqual(unregistered, [],
    'a curated playlist names a pattern that is not in the manifest');
  assert.deepEqual([...generatedRot].sort(), ['studio', 'summer_camp_dome'],
    'the set of scenes with a rotten generated default.yaml changed — regenerate it, do not widen this list');
});
