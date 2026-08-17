import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const SCENES = ['titanic', 'test_bench'];
const DIAGNOSTIC_PLAYLISTS = new Set(['calibration.yaml', 'dirty_probe.yaml', 'mix_show.yaml']);

export const THEMES = Object.freeze({
  ambient_sea: [
    '00_golden_hour_wash', '08_ocean_liner', '122_breathing_horizon',
    '32_caustic_shimmer', '14_lunar_current', '16_ghost_tide_uv',
    '21_pelagic_manta_rays', '45_manta_drift', '11_bioluminescence',
    '44_biolume_swell', '22_abyssal_sway_garden', '46_abyssal_fronds',
    '57_ink_diffuse', '127_grand_maelstrom', '121_spiral_wake',
    '120_crossing_beacons', '58_lighthouse_solo', '43_golden_hour_pulse',
  ],
  ambient_shore: [
    '00_golden_hour_wash', '07_shimmer', '32_caustic_shimmer',
    '14_lunar_current', '119_bow_stern_tidal_push',
    '123_mirrored_broadside_call', '16_ghost_tide_uv', '35_sparkle_rain',
    '122_breathing_horizon', '13_sparkle', '33_aurora_breath',
    '124_aurora_crown', '120_crossing_beacons', '58_lighthouse_solo',
    '08_ocean_liner', '43_golden_hour_pulse',
  ],
  ambient_stars: [
    '13_sparkle', '35_sparkle_rain', '18_deep_space_lattice',
    '20_parametric_sway_field', '118_grand_orbit_rings',
    '125_eclipse_orbit', '14_lunar_current', '33_aurora_breath',
    '124_aurora_crown', '120_crossing_beacons', '58_lighthouse_solo',
    '121_spiral_wake', '127_grand_maelstrom', '57_ink_diffuse',
    '12_breathing', '00_golden_hour_wash',
  ],
  ambient_burn: [
    '00_golden_hour_wash', '43_golden_hour_pulse', '07_shimmer',
    '13_sparkle', '35_sparkle_rain', '41_reaction_diffusion',
    '124_aurora_crown', '123_mirrored_broadside_call',
    '119_bow_stern_tidal_push', '12_breathing',
    '126_cathedral_rib_wave', '57_ink_diffuse', '125_eclipse_orbit',
    '44_biolume_swell', '33_aurora_breath', '122_breathing_horizon',
  ],
  ambient_titanic: [
    '00_golden_hour_wash', '08_ocean_liner', '58_lighthouse_solo',
    '120_crossing_beacons', '123_mirrored_broadside_call',
    '119_bow_stern_tidal_push', '126_cathedral_rib_wave',
    '02_phase_cathedral', '118_grand_orbit_rings', '121_spiral_wake',
    '127_grand_maelstrom', '14_lunar_current', '21_pelagic_manta_rays',
    '44_biolume_swell', '125_eclipse_orbit', '13_sparkle', '07_shimmer',
    '43_golden_hour_pulse',
  ],
  ambient_tidal_architecture: [
    '119_bow_stern_tidal_push', '123_mirrored_broadside_call',
    '122_breathing_horizon', '126_cathedral_rib_wave', '02_phase_cathedral',
    '19_swaying_lattice_ballet', '41_reaction_diffusion',
    '32_caustic_shimmer', '14_lunar_current', '16_ghost_tide_uv',
    '57_ink_diffuse', '12_breathing', '118_grand_orbit_rings',
    '121_spiral_wake', '20_parametric_sway_field',
    '120_crossing_beacons', '58_lighthouse_solo', '127_grand_maelstrom',
  ],
});

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
