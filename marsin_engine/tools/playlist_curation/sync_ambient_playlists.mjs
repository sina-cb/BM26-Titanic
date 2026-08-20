import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const SCENES = ['titanic', 'test_bench'];
const DIAGNOSTIC_PLAYLISTS = new Set(['calibration.yaml', 'dirty_probe.yaml', 'mix_show.yaml']);

// Canonical Ambient is the only curated static nighttime playlist. The former
// sea/shore/stars/burn/Titanic/tidal subsets duplicated it without creating a
// distinct operator experience, so the synchronizer must never recreate them.
export const THEMES = Object.freeze({});

function playlistDir(scene) {
  return path.join(REPO_ROOT, 'simulation', 'scenes', scene, 'playlists');
}

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function serialize(document) {
  return yaml.dump(document, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
}

function assertCanonicalAmbient(ambient) {
  if (ambient?.schemaVersion !== 1 || ambient?.name !== 'ambient'
      || !Array.isArray(ambient.entries) || ambient.entries.length === 0) {
    throw new Error('Titanic ambient.yaml is not a non-empty schemaVersion 1 playlist');
  }
  const ids = new Set();
  const patterns = new Set();
  for (const entry of ambient.entries) {
    if (!entry?.id || ids.has(entry.id)) throw new Error(`ambient duplicate/missing id: ${entry?.id}`);
    if (!entry?.pattern || patterns.has(entry.pattern)) {
      throw new Error(`ambient duplicate/missing pattern: ${entry?.pattern}`);
    }
    if (!entry.defaults || Object.keys(entry.defaults).length === 0) {
      throw new Error(`ambient/${entry.pattern}: canonical defaults must be explicit`);
    }
    ids.add(entry.id);
    patterns.add(entry.pattern);
  }
}

function buildTheme(name, patterns, byPattern) {
  return {
    schemaVersion: 1,
    name,
    entries: patterns.map((pattern, index) => {
      const source = byPattern.get(pattern);
      if (!source) throw new Error(`${name}: ${pattern} is not in canonical ambient`);
      return {
        id: `e_${name}_${String(index).padStart(2, '0')}_${pattern}`,
        pattern,
        label: null,
        defaults: clone(source.defaults),
        modulations: [],
        midiMappings: [],
        notes: null,
      };
    }),
  };
}

function buildReactive(ambient, currentReactive) {
  if (currentReactive?.name !== 'ambient_sound_reactive'
      || !Array.isArray(currentReactive.entries)) {
    throw new Error('ambient_sound_reactive is not a playlist');
  }
  const byPattern = new Map();
  for (const entry of currentReactive.entries) {
    if (!entry?.pattern || byPattern.has(entry.pattern)) {
      throw new Error(`ambient_sound_reactive duplicate/missing pattern: ${entry?.pattern}`);
    }
    byPattern.set(entry.pattern, entry);
  }
  return {
    schemaVersion: 1,
    name: 'ambient_sound_reactive',
    entries: ambient.entries.map((source) => {
      const reactive = byPattern.get(source.pattern);
      if (!reactive) throw new Error(`ambient_sound_reactive missing ${source.pattern}`);
      const entry = clone(source);
      entry.modulations = clone(reactive.modulations ?? []);
      entry.midiMappings = clone(reactive.midiMappings ?? []);
      if (entry.modulations.length < 1 || entry.modulations.length > 3) {
        throw new Error(`${source.pattern}: expected one to three reactive mappings`);
      }
      for (const modulation of entry.modulations) {
        const target = modulation?.target?.parameter;
        if (!Object.hasOwn(entry.defaults, target)) {
          throw new Error(`${source.pattern}: reactive target ${target} is not a saved Ambient control`);
        }
        if (!Array.isArray(modulation.range) || modulation.range.length !== 2) {
          throw new Error(`${source.pattern}/${target}: invalid reactive range`);
        }
        modulation.range[0] = entry.defaults[target];
        if (!(modulation.range[1] > modulation.range[0] && modulation.range[1] <= 1)) {
          throw new Error(`${source.pattern}/${target}: upper range must exceed locked Ambient value`);
        }
      }
      return entry;
    }),
  };
}

function deriveExisting(document, byPattern) {
  let changed = false;
  if (!Array.isArray(document?.entries)) return { document, changed };
  for (const entry of document.entries) {
    const source = byPattern.get(entry.pattern);
    if (!source) continue;
    entry.defaults = clone(source.defaults);
    entry.modulations = [];
    entry.midiMappings = [];
    changed = true;
  }
  return { document, changed };
}

function recordOutput(outputs, filePath, content) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (current !== content) outputs.set(filePath, content);
}

export function planAmbientSync() {
  const titanicDir = playlistDir('titanic');
  const ambientPath = path.join(titanicDir, 'ambient.yaml');
  const reactivePath = path.join(titanicDir, 'ambient_sound_reactive.yaml');
  const ambientRaw = fs.readFileSync(ambientPath, 'utf8');
  const ambient = readYaml(ambientPath);
  const reactive = readYaml(reactivePath);
  assertCanonicalAmbient(ambient);
  const reactiveRaw = serialize(buildReactive(ambient, reactive));
  const byPattern = new Map(ambient.entries.map((entry) => [entry.pattern, entry]));
  const outputs = new Map();

  for (const scene of SCENES) {
    const directory = playlistDir(scene);
    recordOutput(outputs, path.join(directory, 'ambient.yaml'), ambientRaw);
    recordOutput(outputs, path.join(directory, 'ambient_sound_reactive.yaml'), reactiveRaw);

    for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.yaml'))) {
      if (DIAGNOSTIC_PLAYLISTS.has(filename)
          || filename === 'ambient.yaml'
          || filename === 'ambient_sound_reactive.yaml') continue;
      const filePath = path.join(directory, filename);
      const derived = deriveExisting(readYaml(filePath), byPattern);
      if (derived.changed) recordOutput(outputs, filePath, serialize(derived.document));
    }

    for (const [name, patterns] of Object.entries(THEMES)) {
      const filePath = path.join(directory, `${name}.yaml`);
      recordOutput(outputs, filePath, serialize(buildTheme(name, patterns, byPattern)));
    }
  }
  return outputs;
}

function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length > 0) throw new Error(`unknown arguments: ${unknown.join(' ')}`);

  const outputs = planAmbientSync();
  if (check && outputs.size > 0) {
    throw new Error(`ambient playlist drift:\n${[...outputs.keys()].join('\n')}`);
  }
  for (const [filePath, content] of outputs) {
    fs.writeFileSync(filePath, content, 'utf8');
    process.stdout.write(`SYNCED ${path.relative(REPO_ROOT, filePath)}\n`);
  }
  process.stdout.write(check ? 'AMBIENT_PLAYLIST_SYNC_OK\n' : `AMBIENT_PLAYLIST_SYNCED ${outputs.size}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
