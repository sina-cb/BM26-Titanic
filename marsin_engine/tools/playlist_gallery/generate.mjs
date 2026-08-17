#!/usr/bin/env node
/*
 * Generate a permanent, offline playlist gallery from the real model compiler
 * and the playlist's exact saved parameter values.
 *
 * Usage from marsin_engine/:
 *   node tools/playlist_gallery/generate.mjs --scene titanic --playlist ambient
 *   node tools/playlist_gallery/generate.mjs --index-only
 *   node tools/playlist_gallery/generate.mjs --all-playlists
 *
 * A normal render is deliberately static-audio: it shows saved values without
 * modulators. Pass --variation sound to exercise pattern-authored audio
 * suggestions through the real offline audio harness.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

import ffmpegPath from 'ffmpeg-static';
import yaml from 'js-yaml';

import { parseAudioModSpec } from '../audio_mod_spec.mjs';
import { parsePatternDefaults } from '../../lib/pattern_defaults.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES_DIR = path.join(REPO_DIR, 'simulation', 'scenes');
const DOCS_ROOT = path.join(REPO_DIR, 'docs', 'pattern_gallery');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const GOALS_PATH = path.join(HERE, 'pattern_goals.json');
const CONFIG_PATH = path.join(ENGINE_DIR, 'config.yaml');
const SCRATCH_ROOT = path.join(os.homedir(), 'tmp', 'playlist_gallery');

const WIDTH = 1440;
const HEIGHT = 330;
const PANEL_WIDTH = WIDTH / 3;
const PLOT_TOP = 30;
const PLOT_BOTTOM = HEIGHT - 13;
const PLOT_MARGIN = 18;
const DEFAULT_SECONDS = 10;
const DEFAULT_FPS = 8;
const TITANIC_IDENTITY_SECTIONS = new Set([3, 415]);
const TITANIC_BREAK_COMPRESSION = 0.42;
const TITANIC_STACK_CHAINS = {
  'Left SmokeStack': [1, 2, 3, 4],
  'Right SmokeStacks': [5, 6, 7, 8],
};
// Chapter markers for patterns that tell a STORY over their run — seek buttons
// into named moments. The Baby show used to have three such patterns
// (`131_baby_reveal`, `132_baby_tease`, `133_baby_reveal_burst`: one 158-second
// tease with internal acts, plus an all-in-one reveal), and their chapter lists
// were hardcoded here by name.
//
// Those patterns are retired. The show is now three playlists of fifteen short
// looks each — `baby_tease`, `baby_girl`, `baby_boy` — where the dramatic
// structure lives in the SPECIAL EVENT's stages, not inside one pattern's
// clock. A ten-second loop has no chapters, so this registry is empty.
//
// It stays as a registry rather than being deleted with the rendering code
// because the mechanism is sound and generic: map a pattern id to
// `[{ time, label }]` and the gallery grows seek buttons for it. Keyed by the
// FULL pattern id, qualified subdirectory ids included.
const PATTERN_CHAPTERS = {};

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument "${token}"`);
    const name = token.slice(2);
    if (['index-only', 'skip-index', 'all-playlists', 'help'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Playlist gallery generator

Required for one gallery:
  --scene <scene> --playlist <playlist>

Options:
  --seconds <n>       clip duration (default ${DEFAULT_SECONDS})
  --fps <n>           output GIF fps (default ${DEFAULT_FPS})
  --global-speed <n>  pattern-clock scale for live-parity review (default 1)
  --variation saved   exact saved values, no audio (default)
  --variation sound   apply pattern-authored audio suggestions
  --palette <id>      apply one configured global palette to every entry
  --index-only        rebuild the complete playlist index only
  --skip-index        render the requested gallery without rebuilding the index
  --all-playlists     render every discovered playlist, then rebuild the index
`);
}

function assertSafeName(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, underscore, or hyphen`);
  }
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing unsafe generated path outside ${parent}: ${target}`);
  }
}

function readYaml(filePath) {
  const value = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error(`invalid YAML object: ${filePath}`);
  return value;
}

export function resolveGalleryPalette(config, id) {
  if (!id) return null;
  const palettes = config?.colorPalettes;
  if (!Array.isArray(palettes)) {
    throw new Error('config.colorPalettes must be an array');
  }
  const match = palettes.find((item) => item?.id === id);
  if (!match) throw new Error(`gallery palette "${id}" not found in config.colorPalettes`);
  for (const key of ['c1', 'c2']) {
    if (!Number.isFinite(match[key]) || match[key] < 0 || match[key] > 1) {
      throw new Error(`gallery palette "${id}" has invalid ${key}: ${match[key]}`);
    }
  }
  return { id, c1: match.c1, c2: match.c2 };
}

function discoverPlaylists() {
  const discovered = [];
  for (const sceneEntry of fs.readdirSync(SCENES_DIR, { withFileTypes: true })) {
    if (!sceneEntry.isDirectory()) continue;
    const playlistDir = path.join(SCENES_DIR, sceneEntry.name, 'playlists');
    if (!fs.existsSync(playlistDir)) continue;
    for (const file of fs.readdirSync(playlistDir).filter((name) => name.endsWith('.yaml')).sort()) {
      const filePath = path.join(playlistDir, file);
      const data = readYaml(filePath);
      if (!Array.isArray(data.entries)) throw new Error(`playlist has no entries array: ${filePath}`);
      discovered.push({
        scene: sceneEntry.name,
        playlist: path.basename(file, '.yaml'),
        filePath,
        entries: data.entries.length,
      });
    }
  }
  return discovered.sort((a, b) =>
    a.scene.localeCompare(b.scene) || a.playlist.localeCompare(b.playlist));
}

function patternFiles() {
  const byName = new Map();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const itemPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(itemPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const patternId = path.relative(PATTERNS_DIR, itemPath)
          .replaceAll('\\', '/')
          .replace(/\.js$/, '');
        if (byName.has(patternId)) {
          throw new Error(`duplicate pattern id "${patternId}": ${byName.get(patternId)} and ${itemPath}`);
        }
        byName.set(patternId, itemPath);
      }
    }
  };
  visit(PATTERNS_DIR);
  return byName;
}

function prettyName(value) {
  return value
    .split('/')
    .at(-1)
    .replace(/^\d+_/, '')
    .split('_')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}

function mediaStem(patternId) {
  return patternId
    .replaceAll('/', '__')
    .replace(/[^A-Za-z0-9._-]/g, '_');
}

function prettyControl(value) {
  return value
    .replace(/^slider/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function exportControls(source) {
  const controls = [];
  const regex = /export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = regex.exec(source))) controls.push(match[1]);
  return controls;
}

function codeDefaults(source) {
  const defaults = {};
  const regex = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let match;
  while ((match = regex.exec(source))) defaults[match[1]] = Number(match[2]);
  return defaults;
}

function sliderVariable(slider) {
  const suffix = slider.slice('slider'.length);
  return `${suffix[0].toLowerCase()}${suffix.slice(1)}`;
}

function fileDigest(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sourceControlDefaults(source) {
  const parsed = parsePatternDefaults(source).defaults;
  const declared = codeDefaults(source);
  const resolved = {};
  for (const control of exportControls(source)) {
    const conventional = declared[sliderVariable(control)];
    if (parsed[control] !== undefined) resolved[control] = parsed[control];
    else if (conventional !== undefined) resolved[control] = conventional;
  }
  return resolved;
}

function parameterDescription(slider, audio) {
  if (audio?.note) return audio.note;
  const name = prettyControl(slider);
  if (/Local Speed/i.test(name)) return 'Pattern-local motion rate.';
  if (/Level/i.test(name)) return 'Brightness or energy for this visual layer.';
  if (/Kick|Burst|Flash/i.test(name)) return 'Transient accent strength.';
  if (/Detail|Focus|Sharp/i.test(name)) return 'Fine structure and visual definition.';
  if (/Radius|Width|Span|Spread/i.test(name)) return 'Spatial reach or width within this pattern.';
  if (/Count|Density/i.test(name)) return 'Amount of active visual material.';
  if (/White|Jewelry/i.test(name)) return 'Native-white material or Jewelry treatment.';
  if (/UV/i.test(name)) return 'Ultraviolet contribution on capable fixtures.';
  if (/Base|Floor|Dark/i.test(name)) return 'Quiet-state floor and negative-space balance.';
  if (/Shimmer|Sparkle|Glint|Foam/i.test(name)) return 'Fine highlight texture.';
  if (/Depth|Bloom|Swell|Breath/i.test(name)) return 'Shape and intensity of the main organic motion.';
  return `${name} character control.`;
}

function controlsForEntry(source, pattern, defaults, intent = null) {
  const declared = sourceControlDefaults(source);
  const spec = parseAudioModSpec(source, pattern);
  const audioBySlider = new Map((spec?.mappings || []).map((item) => [item.slider, item]));
  const intentBySlider = new Map((intent?.controls || [])
    .map((item) => [item.exported_name, item]));
  return exportControls(source).map((name) => {
    const value = Object.hasOwn(defaults, name) ? defaults[name] : declared[name];
    if (value === undefined) throw new Error(`${pattern}: cannot resolve a default for ${name}`);
    const audio = audioBySlider.get(name) || null;
    return {
      name,
      label: prettyControl(name),
      value,
      valueSource: Object.hasOwn(defaults, name) ? 'playlist saved value' : 'code default',
      description: intentBySlider.get(name)?.behavior || parameterDescription(name, audio),
      audio,
    };
  });
}

export function validateSavedDefaults(pattern, source, defaults) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw new Error(`${pattern}: playlist defaults must be a plain object`);
  }
  const writable = new Set(exportControls(source));
  for (const [name, value] of Object.entries(defaults)) {
    if (!writable.has(name)) {
      throw new Error(`${pattern}: playlist default targets undeclared control ${name}`);
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${pattern}: playlist default ${name} must be a finite value in [0, 1]`);
    }
  }
  return defaults;
}

function savedSet(defaults) {
  return Object.entries(defaults)
    .map(([name, value]) => `${name}=${value}`)
    .join(',');
}

function capturePattern(patternPath, pattern, scene, playlist, entry, options) {
  const outputDir = path.join(SCRATCH_ROOT, scene, playlist);
  fs.mkdirSync(outputDir, { recursive: true });
  const capturePath = path.join(outputDir,
    `${String(entry.index + 1).padStart(3, '0')}_${mediaStem(pattern)}.json`);
  const source = fs.readFileSync(patternPath, 'utf8');
  const spec = parseAudioModSpec(source, pattern);
  const args = [
    HARNESS,
    '--pattern', patternPath,
    '--model', scene,
    '--seconds', String(options.seconds),
    '--out-fps', String(options.fps),
    '--time-scale', String(options.globalSpeed),
    '--gate-frames', String(Math.ceil(options.seconds * 40)),
    // Gallery projections are geometry diagnostics as well as previews. Never
    // let the harness stride pixels on long captures: doing so can remove half
    // a smoke-stack chain or deform a TE sign. Current models are <2000 px.
    '--max-cells', String(Math.ceil(options.seconds * options.fps * 2000)),
    '--out', capturePath,
  ];
  const presets = { ...(entry.defaults || {}) };
  if (options.palette) {
    for (const exportName of ['colorPalette1', 'colorPalette2']) {
      if (!new RegExp(`export\\s+function\\s+${exportName}\\s*\\(`).test(source)) {
        throw new Error(`${pattern}: --palette requires exported ${exportName}`);
      }
    }
    Object.assign(presets, {
      cp1H: options.palette.c1,
      cp1S: 1,
      cp1V: 1,
      cp2H: options.palette.c2,
      cp2S: 1,
      cp2V: 1,
    });
  }
  const set = savedSet(presets);
  if (set) args.push('--set', set);
  if (options.variation === 'sound') {
    if (!spec) throw new Error(`${pattern}: --variation sound requires AUDIO_MODULATION_V1`);
    args.push('--synth', spec.synth, '--mod', spec.modString);
  } else {
    args.push('--synth', 'silence');
  }
  execFileSync(process.execPath, args, {
    cwd: ENGINE_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return JSON.parse(fs.readFileSync(capturePath, 'utf8'));
}

function bounds(values) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum - minimum < 1e-8) return [minimum - 0.5, maximum + 0.5];
  const pad = (maximum - minimum) * 0.04;
  return [minimum - pad, maximum + pad];
}

export function compressTitanicHalves(meta, amount = TITANIC_BREAK_COMPRESSION) {
  const groups = meta.map((item) => item.nx < 0.5 ? 0 : 1);
  const counts = [0, 0];
  const meansX = [0, 0];
  const meansZ = [0, 0];
  meta.forEach((item, index) => {
    const group = groups[index];
    counts[group] += 1;
    meansX[group] += item.nx;
    meansZ[group] += item.nz;
  });
  if (counts[0] === 0 || counts[1] === 0) {
    throw new Error('titanic gallery compression requires pixels on both X halves');
  }
  for (let group = 0; group < 2; group += 1) {
    meansX[group] /= counts[group];
    meansZ[group] /= counts[group];
  }
  const midpointX = (meansX[0] + meansX[1]) / 2;
  const midpointZ = (meansZ[0] + meansZ[1]) / 2;
  return meta.map((item, index) => {
    const group = groups[index];
    return {
      ...item,
      nx: item.nx + (midpointX - meansX[group]) * amount,
      nz: item.nz + (midpointZ - meansZ[group]) * amount,
    };
  });
}

export function titanicSmokeStackIndices(meta) {
  const all = [];
  const front = [];
  for (const [group, frontNumbers] of Object.entries(TITANIC_STACK_CHAINS)) {
    const groupIndices = [];
    const frontIndices = [];
    for (let index = 0; index < meta.length; index += 1) {
      const item = meta[index];
      if (item.group !== group || item.fixtureType !== 'UkingPar') continue;
      const match = item.name.match(new RegExp(`^${group} (\\d+) - `));
      if (!match) {
        throw new Error(`titanic gallery: malformed stack pixel name '${item.name}'`);
      }
      const fixtureNumber = Number(match[1]);
      groupIndices.push(index);
      if (frontNumbers.includes(fixtureNumber)) frontIndices.push(index);
    }
    if (groupIndices.length !== 8 || frontIndices.length !== 4) {
      throw new Error(`titanic gallery: '${group}' requires 8 stack PARs and 4 ` +
        `front-facing PARs, found ${groupIndices.length} and ${frontIndices.length}`);
    }
    all.push(...groupIndices);
    front.push(...frontIndices);
  }
  return { all, front };
}

function displayCoordSpread(sourceMeta, displayMeta, coordSpread) {
  if (!coordSpread) return undefined;
  const adjusted = {};
  for (const axis of ['x', 'y', 'z']) {
    const sourceValues = sourceMeta.map((item) => item[`n${axis}`]);
    const displayValues = displayMeta.map((item) => item[`n${axis}`]);
    const sourceRange = Math.max(...sourceValues) - Math.min(...sourceValues);
    const displayRange = Math.max(...displayValues) - Math.min(...displayValues);
    if (sourceRange < 1e-8) {
      adjusted[axis] = coordSpread[axis];
      continue;
    }
    adjusted[axis] = coordSpread[axis] * displayRange / sourceRange;
  }
  return adjusted;
}

function projection(meta, axisA, axisB, panelIndex, coordSpread, boundsMeta = meta) {
  const valuesA = boundsMeta.map((item) => item[`n${axisA}`]);
  const valuesB = boundsMeta.map((item) => item[`n${axisB}`]);
  const [minimumA, maximumA] = bounds(valuesA);
  const [minimumB, maximumB] = bounds(valuesB);
  const maximumWidth = PANEL_WIDTH - PLOT_MARGIN * 2;
  const maximumHeight = PLOT_BOTTOM - PLOT_TOP;
  const physicalA = coordSpread?.[axisA] || maximumA - minimumA;
  const physicalB = coordSpread?.[axisB] || maximumB - minimumB;
  const scale = Math.min(maximumWidth / physicalA, maximumHeight / physicalB);
  const width = physicalA * scale;
  const height = physicalB * scale;
  const left = panelIndex * PANEL_WIDTH + (PANEL_WIDTH - width) / 2;
  const top = PLOT_TOP + (maximumHeight - height) / 2;
  return meta.map((item) => ({
    x: left +
      (item[`n${axisA}`] - minimumA) / (maximumA - minimumA) * width,
    y: top + height - (item[`n${axisB}`] - minimumB) /
      (maximumB - minimumB) * height,
  }));
}

function principalFeature(meta, scene) {
  const bySection = new Map();
  meta.forEach((item, index) => {
    if (!bySection.has(item.sId)) bySection.set(item.sId, []);
    bySection.get(item.sId).push(index);
  });
  if (scene === 'titanic') {
    const indices = [];
    for (const section of TITANIC_IDENTITY_SECTIONS) {
      if (!bySection.has(section)) {
        throw new Error(`titanic gallery requires Identity section ${section}`);
      }
      indices.push(...bySection.get(section));
    }
    return { label: 'IDENTITY · TE SIGNS', indices, splitSections: [3, 415] };
  }
  const sections = [...bySection.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!sections.length) throw new Error(`${scene}: capture contains no sections`);
  const [section, indices] = sections[0];
  return { label: `DETAIL · SECTION ${section}`, indices, splitSections: [section] };
}

function pcaFeaturePoints(meta, feature) {
  const allPoints = new Array(meta.length).fill(null);
  const groups = feature.splitSections.map((section) =>
    feature.indices.filter((index) => meta[index].sId === section));
  const availableWidth = PANEL_WIDTH - PLOT_MARGIN * (groups.length + 1);
  const groupWidth = availableWidth / groups.length;
  groups.forEach((indices, groupIndex) => {
    const meanX = indices.reduce((sum, index) => sum + meta[index].nx, 0) / indices.length;
    const meanZ = indices.reduce((sum, index) => sum + meta[index].nz, 0) / indices.length;
    let xx = 0;
    let zz = 0;
    let xz = 0;
    for (const index of indices) {
      const x = meta[index].nx - meanX;
      const z = meta[index].nz - meanZ;
      xx += x * x;
      zz += z * z;
      xz += x * z;
    }
    const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
    const horizontal = indices.map((index) =>
      (meta[index].nx - meanX) * Math.cos(angle) +
      (meta[index].nz - meanZ) * Math.sin(angle));
    const vertical = indices.map((index) => meta[index].ny);
    const [minimumH, maximumH] = bounds(horizontal);
    const [minimumV, maximumV] = bounds(vertical);
    const left = 2 * PANEL_WIDTH + PLOT_MARGIN * (groupIndex + 1) + groupWidth * groupIndex;
    indices.forEach((index, localIndex) => {
      allPoints[index] = {
        x: left + (horizontal[localIndex] - minimumH) / (maximumH - minimumH) * groupWidth,
        y: PLOT_BOTTOM - (vertical[localIndex] - minimumV) /
          (maximumV - minimumV) * (PLOT_BOTTOM - PLOT_TOP),
      };
    });
  });
  return allPoints;
}

function fillFrame(color) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let offset = 0; offset < frame.length; offset += 3) {
    frame[offset] = color[0];
    frame[offset + 1] = color[1];
    frame[offset + 2] = color[2];
  }
  return frame;
}

function drawRectangle(frame, x0, y0, x1, y1, color) {
  const left = Math.max(0, Math.floor(x0));
  const right = Math.min(WIDTH, Math.ceil(x1));
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(HEIGHT, Math.ceil(y1));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      frame[offset] = color[0];
      frame[offset + 1] = color[1];
      frame[offset + 2] = color[2];
    }
  }
}

function drawCircle(frame, cx, cy, radius, color, alpha) {
  const left = Math.max(0, Math.floor(cx - radius));
  const right = Math.min(WIDTH - 1, Math.ceil(cx + radius));
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = Math.min(HEIGHT - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const offset = (y * WIDTH + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        frame[offset + channel] = Math.round(
          frame[offset + channel] * (1 - alpha) + color[channel] * alpha);
      }
    }
  }
}

function drawEllipse(frame, cx, cy, radiusX, radiusY, color, alpha) {
  const left = Math.max(0, Math.floor(cx - radiusX));
  const right = Math.min(WIDTH - 1, Math.ceil(cx + radiusX));
  const top = Math.max(0, Math.floor(cy - radiusY));
  const bottom = Math.min(HEIGHT - 1, Math.ceil(cy + radiusY));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = (x - cx) / radiusX;
      const dy = (y - cy) / radiusY;
      if (dx * dx + dy * dy > 1) continue;
      const offset = (y * WIDTH + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        frame[offset + channel] = Math.round(
          frame[offset + channel] * (1 - alpha) + color[channel] * alpha);
      }
    }
  }
}

function toneColor(color) {
  return color.map((channel) =>
    Math.round(255 * Math.pow(Math.max(0, Math.min(1, channel / 255)), 0.88)));
}

function drawPointLayer(frame, points, colors, radii) {
  const order = points
    .map((point, index) => ({ point, index, peak: Math.max(...colors[index]) }))
    .filter((item) => item.point && item.peak > 2)
    .sort((a, b) => a.peak - b.peak);
  for (const item of order) {
    const color = toneColor(colors[item.index]);
    drawCircle(frame, item.point.x, item.point.y, radii.glow, color, 0.17);
  }
  for (const item of order) {
    const color = toneColor(colors[item.index]);
    drawCircle(frame, item.point.x, item.point.y, radii.mid, color, 0.48);
    drawCircle(frame, item.point.x, item.point.y, radii.core, color, 1);
  }
}

export function drawUpwardWashLayer(frame, points, colors, groupKeys = []) {
  const order = points
    .map((point, index) => ({
      point,
      index,
      peak: Math.max(...colors[index]),
      group: groupKeys[index] || 'stack',
    }))
    .filter((item) => item.point && item.peak > 2)
    .sort((a, b) => a.peak - b.peak);
  // Merge each four-PAR chain into one stack-body surface. The average source
  // line is the foot of the wash; a softly tapered field climbs to the crown.
  const groups = new Map();
  for (const item of order) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  for (const items of groups.values()) {
    const centerX = items.reduce((sum, item) => sum + item.point.x, 0) / items.length;
    const bottom = items.reduce((sum, item) => sum + item.point.y, 0) / items.length;
    const minimumX = Math.min(...items.map((item) => item.point.x));
    const maximumX = Math.max(...items.map((item) => item.point.x));
    const halfBody = Math.max(12, (maximumX - minimumX) / 2 + 7);
    const color = [0, 1, 2].map((channel) => Math.round(items.reduce((sum, item) =>
      sum + toneColor(colors[item.index])[channel], 0) / items.length));
    const height = 48;
    const top = bottom - height;
    for (let y = Math.max(0, Math.floor(top)); y <= Math.min(HEIGHT - 1, Math.ceil(bottom)); y += 1) {
      const travel = Math.max(0, Math.min(1, (bottom - y) / height));
      const halfWidth = halfBody * (1 - travel * 0.12);
      const left = Math.max(0, Math.floor(centerX - halfWidth));
      const right = Math.min(WIDTH - 1, Math.ceil(centerX + halfWidth));
      const vertical = 0.20 + (1 - travel) * 0.38;
      for (let x = left; x <= right; x += 1) {
        const lateral = Math.max(0, 1 - Math.pow(Math.abs(x - centerX) / halfWidth, 4));
        const alpha = vertical * Math.pow(lateral, 0.55);
        const offset = (y * WIDTH + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          frame[offset + channel] = Math.round(
            frame[offset + channel] * (1 - alpha) + color[channel] * alpha);
        }
      }
    }
  }
  // Paint the compact physical source last so the beam has a clear origin.
  for (const item of order) {
    const color = toneColor(colors[item.index]);
    drawCircle(frame, item.point.x, item.point.y, 4.1, color, 0.38);
    drawCircle(frame, item.point.x, item.point.y, 2.35, color, 1);
  }
}

export function encodeFramesWithFfmpeg(frames, width, height, fps, outputPath) {
  if (!frames.length) throw new Error('encodeFramesWithFfmpeg: no frames');
  const expectedLength = width * height * 3;
  if (frames.some((frame) => frame.length !== expectedLength)) {
    throw new Error(`encodeFramesWithFfmpeg: every frame must contain ${expectedLength} RGB bytes`);
  }
  const filter = '[0:v]split[a][b];' +
    '[a]palettegen=max_colors=256:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle';
  execFileSync(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s:v', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-filter_complex', filter,
    '-loop', '0',
    outputPath,
  ], {
    input: Buffer.concat(frames),
    stdio: ['pipe', 'ignore', 'inherit'],
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function encodeVideoFramesWithFfmpeg(frames, width, height, fps, outputPath) {
  if (!frames.length) throw new Error('encodeVideoFramesWithFfmpeg: no frames');
  const expectedLength = width * height * 3;
  if (frames.some((frame) => frame.length !== expectedLength)) {
    throw new Error(
      `encodeVideoFramesWithFfmpeg: every frame must contain ${expectedLength} RGB bytes`,
    );
  }
  execFileSync(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s:v', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ], {
    input: Buffer.concat(frames),
    stdio: ['pipe', 'ignore', 'inherit'],
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function renderCaptureFrames(capture, scene) {
  const feature = principalFeature(capture.meta, scene);
  // Gallery-only staging: close the Titanic's physical fracture gap enough for
  // teammates to compare both halves at a glance. Internal geometry stays at
  // full scale, and the Identity PCA view remains completely untouched.
  const overviewMeta = scene === 'titanic'
    ? compressTitanicHalves(capture.meta)
    : capture.meta;
  const overviewSpread = displayCoordSpread(capture.meta, overviewMeta,
    capture.coordSpread);
  const topPoints = projection(overviewMeta, 'x', 'z', 0, overviewSpread);
  const frontPoints = projection(overviewMeta, 'x', 'y', 1, overviewSpread);
  const featurePoints = pcaFeaturePoints(capture.meta, feature);
  const stackRoles = scene === 'titanic'
    ? titanicSmokeStackIndices(capture.meta)
    : { all: [], front: [] };
  const topStackSet = new Set(stackRoles.all);
  const frontStackSet = new Set(stackRoles.front);
  const allStackSet = new Set(stackRoles.all);
  const topBasePoints = topPoints.map((point, index) =>
    topStackSet.has(index) ? null : point);
  const topStackPoints = topPoints.map((point, index) =>
    topStackSet.has(index) ? point : null);
  const frontBasePoints = frontPoints.map((point, index) =>
    allStackSet.has(index) ? null : point);
  const frontStackPoints = frontPoints.map((point, index) =>
    frontStackSet.has(index) ? point : null);
  const frames = [];
  for (const colors of capture.frames) {
    const frame = fillFrame([4, 7, 12]);
    for (let panel = 0; panel < 3; panel += 1) {
      const left = panel * PANEL_WIDTH;
      drawRectangle(frame, left, 0, left + PANEL_WIDTH, 5, panel === 2
        ? [142, 120, 255]
        : panel === 1 ? [68, 174, 220] : [246, 189, 57]);
      drawRectangle(frame, left + 1, 6, left + PANEL_WIDTH - 1, 28, [10, 15, 24]);
      for (let line = 1; line < 4; line += 1) {
        const x = left + line * PANEL_WIDTH / 4;
        drawRectangle(frame, x, PLOT_TOP, x + 1, PLOT_BOTTOM, [12, 18, 29]);
      }
      for (let line = 1; line < 3; line += 1) {
        const y = PLOT_TOP + line * (PLOT_BOTTOM - PLOT_TOP) / 3;
        drawRectangle(frame, left, y, left + PANEL_WIDTH, y + 1, [12, 18, 29]);
      }
    }
    drawRectangle(frame, PANEL_WIDTH - 1, 0, PANEL_WIDTH + 1, HEIGHT, [37, 48, 65]);
    drawRectangle(frame, 2 * PANEL_WIDTH - 1, 0, 2 * PANEL_WIDTH + 1, HEIGHT,
      [37, 48, 65]);
    drawPointLayer(frame, topBasePoints, colors, { glow: 5.2, mid: 2.8, core: 1.35 });
    drawPointLayer(frame, topStackPoints, colors, { glow: 7, mid: 4.4, core: 2.3 });
    drawPointLayer(frame, frontBasePoints, colors, { glow: 5.2, mid: 2.8, core: 1.35 });
    drawUpwardWashLayer(frame, frontStackPoints, colors,
      capture.meta.map((item) => item.group));
    drawPointLayer(frame, featurePoints, colors, { glow: 7, mid: 4.1, core: 2.25 });
    frames.push(frame);
  }
  return {
    frames,
    width: WIDTH,
    height: HEIGHT,
    featureLabel: feature.label,
  };
}

function renderMedia(capture, scene, gifPath, videoPath) {
  const rendered = renderCaptureFrames(capture, scene);
  encodeFramesWithFfmpeg(
    rendered.frames, rendered.width, rendered.height, Number(capture.fps), gifPath);
  encodeVideoFramesWithFfmpeg(
    rendered.frames, rendered.width, rendered.height, Number(capture.fps), videoPath);
  return { featureLabel: rendered.featureLabel };
}

function loadGoals() {
  if (!fs.existsSync(GOALS_PATH)) {
    throw new Error(`pattern goals registry not found: ${GOALS_PATH}`);
  }
  return JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));
}

const INTENT_TEXT_FIELDS = [
  'concept',
  'design_intent',
  'why_exists',
  'visual_goal_titanic',
  'unique_topology',
  'distance_silhouette',
  'close_detail',
  'motion_grammar',
  'xyz_use',
  'te_sign_treatment',
  'jewelry_white',
  'palette_white_material',
  'safety_floor',
  'anti_duplication_notes',
];
const INTENT_FIXTURE_ROLES = [
  'Hull Canvas',
  'Silhouette',
  'Jewelry',
  'Organs',
  'Identity',
];
const REVIEW_STATES = new Set(['KEEP', 'TUNE', 'REJECT', 'READY FOR OPERATOR']);
const UNIQUENESS_DECISIONS = new Set(['keep', 'keep_refine', 'rethink']);
const UNIQUENESS_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const EVIDENCE_KEYS = new Set([
  'source',
  'playlist',
  'gallery',
  'capture_samples_seconds',
  'capture_observation',
  'frame_to_frame_mean_absolute_difference',
  'tune_focus',
  'capabilities',
]);
const UNIQUENESS_KEYS = new Set([
  'decision',
  'duplicated_grammar',
  'underexplored_opportunity',
  'nearest_neighbors',
  'refinement_directive',
]);
const INTENT_KEYS = new Set([
  'schema_version',
  ...INTENT_TEXT_FIELDS,
  'fixture_roles',
  'controls',
  'audio_handles',
  'review_state',
  'evidence_notes',
  'uniqueness_review',
]);

function assertExactKeys(pattern, value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${pattern}: design intent ${field} has unknown key ${key}`);
    }
  }
}

function assertIntentText(pattern, value, field) {
  if (typeof value !== 'string' || value.trim().length < 12) {
    throw new Error(`${pattern}: design intent ${field} must be a descriptive string`);
  }
}

function validateEvidenceNotes(pattern, evidence) {
  if (typeof evidence === 'string') {
    assertIntentText(pattern, evidence, 'evidence_notes');
    return;
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`${pattern}: design intent evidence_notes must be descriptive evidence`);
  }
  assertExactKeys(pattern, evidence, EVIDENCE_KEYS, 'evidence_notes');
  for (const field of [
    'source',
    'playlist',
    'gallery',
    'capture_observation',
    'tune_focus',
    'capabilities',
  ]) {
    assertIntentText(pattern, evidence[field], `evidence_notes.${field}`);
  }
  for (const field of ['capture_samples_seconds', 'frame_to_frame_mean_absolute_difference']) {
    if (!Array.isArray(evidence[field]) || evidence[field].length === 0 ||
        !evidence[field].every((value) => Number.isFinite(value))) {
      throw new Error(`${pattern}: design intent evidence_notes.${field} must be numeric evidence`);
    }
  }
}

function validateUniquenessReview(pattern, review) {
  if (review === undefined) return;
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    throw new Error(`${pattern}: design intent uniqueness_review must be an object`);
  }
  assertExactKeys(pattern, review, UNIQUENESS_KEYS, 'uniqueness_review');
  if (!UNIQUENESS_DECISIONS.has(review.decision)) {
    throw new Error(`${pattern}: design intent uniqueness_review.decision is invalid`);
  }
  for (const field of [
    'duplicated_grammar',
    'underexplored_opportunity',
    'refinement_directive',
  ]) {
    assertIntentText(pattern, review[field], `uniqueness_review.${field}`);
  }
  if (!Array.isArray(review.nearest_neighbors)) {
    throw new Error(`${pattern}: design intent uniqueness_review.nearest_neighbors must be an array`);
  }
  review.nearest_neighbors.forEach((neighbor, index) => {
    if (!neighbor || typeof neighbor !== 'object' || Array.isArray(neighbor)) {
      throw new Error(`${pattern}: uniqueness_review.nearest_neighbors[${index}] must be an object`);
    }
    assertExactKeys(
      pattern,
      neighbor,
      new Set(['id', 'reason', 'severity']),
      `uniqueness_review.nearest_neighbors[${index}]`,
    );
    if (typeof neighbor.id !== 'string' || neighbor.id.trim().length < 3) {
      throw new Error(
        `${pattern}: uniqueness_review.nearest_neighbors[${index}].id is invalid`,
      );
    }
    assertIntentText(pattern, neighbor.reason,
      `uniqueness_review.nearest_neighbors[${index}].reason`);
    if (!UNIQUENESS_SEVERITIES.has(neighbor.severity)) {
      throw new Error(
        `${pattern}: uniqueness_review.nearest_neighbors[${index}].severity is invalid`,
      );
    }
  });
}

/**
 * Validate one structured gallery intent against the current pattern source.
 *
 * @param {string} pattern Qualified pattern id.
 * @param {object} intent Structured design-intent metadata.
 * @param {string} source Current pattern source.
 * @returns {object} The validated intent.
 */
export function validatePatternIntent(pattern, intent, source) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw new Error(`${pattern}: design intent must be an object`);
  }
  assertExactKeys(pattern, intent, INTENT_KEYS, 'root');
  if (intent.schema_version !== 1) {
    throw new Error(`${pattern}: design intent schema_version must be 1`);
  }
  for (const field of INTENT_TEXT_FIELDS) {
    assertIntentText(pattern, intent[field], field);
  }
  if (intent.concept.includes('\n') || intent.concept.length > 240) {
    throw new Error(`${pattern}: concept must be one concise sentence`);
  }
  if (!intent.fixture_roles || typeof intent.fixture_roles !== 'object' ||
      Array.isArray(intent.fixture_roles)) {
    throw new Error(`${pattern}: fixture_roles must be an object`);
  }
  assertExactKeys(pattern, intent.fixture_roles, new Set(INTENT_FIXTURE_ROLES), 'fixture_roles');
  for (const role of INTENT_FIXTURE_ROLES) {
    assertIntentText(pattern, intent.fixture_roles[role], `fixture_roles.${role}`);
  }
  if (!REVIEW_STATES.has(intent.review_state)) {
    throw new Error(
      `${pattern}: review_state must be KEEP, TUNE, REJECT, or READY FOR OPERATOR`,
    );
  }
  validateEvidenceNotes(pattern, intent.evidence_notes);
  validateUniquenessReview(pattern, intent.uniqueness_review);

  const expectedControls = exportControls(source);
  const declaredDefaults = sourceControlDefaults(source);
  if (!Array.isArray(intent.controls)) {
    throw new Error(`${pattern}: design intent controls must be an array`);
  }
  const intentControls = intent.controls.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${pattern}: controls[${index}] must be an object`);
    }
    assertExactKeys(
      pattern,
      item,
      new Set(['exported_name', 'behavior', 'code_default_value']),
      `controls[${index}]`,
    );
    assertIntentText(pattern, item.behavior, `controls[${index}].behavior`);
    if (!Number.isFinite(item.code_default_value)) {
      throw new Error(`${pattern}: controls[${index}].code_default_value must be numeric`);
    }
    if (declaredDefaults[item.exported_name] !== item.code_default_value) {
      throw new Error(
        `${pattern}: controls[${index}] value ${item.code_default_value} does not match ` +
        `source default ${declaredDefaults[item.exported_name]}`,
      );
    }
    return item.exported_name;
  });
  if (JSON.stringify(intentControls) !== JSON.stringify(expectedControls)) {
    throw new Error(
      `${pattern}: intent parameter names/order do not match source controls ` +
      `(${intentControls.join(', ')} != ${expectedControls.join(', ')})`,
    );
  }

  const spec = parseAudioModSpec(source, pattern);
  const expectedAudio = spec?.mappings || [];
  for (const mapping of expectedAudio) {
    if (!expectedControls.includes(mapping.slider)) {
      throw new Error(
        `${pattern}: AUDIO_MODULATION_V1 targets undeclared control ${mapping.slider}`,
      );
    }
  }
  if (!Array.isArray(intent.audio_handles)) {
    throw new Error(`${pattern}: design intent audio_handles must be an array`);
  }
  const intentAudio = intent.audio_handles.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${pattern}: audio_handles[${index}] must be an object`);
    }
    assertExactKeys(
      pattern,
      item,
      new Set(['target', 'source', 'range', 'curve', 'intent']),
      `audio_handles[${index}]`,
    );
    assertIntentText(pattern, item.intent, `audio_handles[${index}].intent`);
    if (!Array.isArray(item.range) || item.range.length !== 2 ||
        !item.range.every((value) => Number.isFinite(value))) {
      throw new Error(`${pattern}: audio_handles[${index}].range must be two numbers`);
    }
    return {
      slider: item.target,
      signal: item.source,
      min: item.range[0],
      max: item.range[1],
      curve: item.curve,
    };
  });
  const expectedAudioContract = expectedAudio.map((item) => ({
    slider: item.slider,
    signal: item.signal,
    min: item.min,
    max: item.max,
    curve: item.curve,
  }));
  const bySlider = (left, right) => left.slider.localeCompare(right.slider) ||
    left.signal.localeCompare(right.signal);
  const sortedIntentAudio = [...intentAudio].sort(bySlider);
  const sortedExpectedAudio = [...expectedAudioContract].sort(bySlider);
  if (JSON.stringify(sortedIntentAudio) !== JSON.stringify(sortedExpectedAudio)) {
    throw new Error(
      `${pattern}: intent audio handles do not match AUDIO_MODULATION_V1 ` +
      `(${JSON.stringify(sortedIntentAudio)} != ${JSON.stringify(sortedExpectedAudio)})`,
    );
  }
  return intent;
}

function galleryGoal(pattern, goal, source) {
  if (typeof goal === 'string') return { summary: goal, intent: null };
  if (goal === undefined) return { summary: null, intent: null };
  const intent = validatePatternIntent(pattern, goal, source);
  return { summary: intent.concept, intent };
}

function galleryPath(scene, playlist) {
  return path.join(DOCS_ROOT, 'playlists', scene, playlist);
}

function patternCardHtml(item) {
  const params = item.controls.map((control) => {
    const signal = control.audio
      ? `<span class="signal">${escapeHtml(control.audio.signal.replace(/^mic/, '').toUpperCase())}</span>`
      : '';
    return `<li><div><strong>${escapeHtml(control.label)}</strong>${signal}` +
      `<span class="value">${escapeHtml(control.value)}</span></div>` +
      `<p>${escapeHtml(control.description)}</p>` +
      `<small>${escapeHtml(control.valueSource)}</small></li>`;
  }).join('');
  const intent = item.intent;
  const fixtureRoles = intent ? [
    ['Hull Canvas', intent.fixture_roles['Hull Canvas']],
    ['Silhouette', intent.fixture_roles.Silhouette],
    ['Jewelry', intent.fixture_roles.Jewelry],
    ['Organs', intent.fixture_roles.Organs],
    ['Identity', intent.fixture_roles.Identity],
    ['TE signs', intent.te_sign_treatment],
    ['Jewelry white', intent.jewelry_white],
  ].map(([label, role]) =>
    `<li><strong>${escapeHtml(label)}</strong><p>${escapeHtml(role)}</p></li>`).join('') : '';
  const audioBySlider = new Map((intent?.audio_handles || [])
    .map((audio) => [audio.target, audio]));
  const audioHandles = intent ? item.controls.filter((control) => control.audio)
    .map((control) => {
      const audio = control.audio;
      const behavior = audioBySlider.get(control.name)?.intent || audio.note;
      return `<li><strong>${escapeHtml(control.name)}</strong>` +
        `<span class="signal">${escapeHtml(audio.signal.replace(/^mic/, '').toUpperCase())}</span>` +
        `<span class="mapping">${escapeHtml(`${audio.min}..${audio.max} · ${audio.curve}`)}</span>` +
        `<p>${escapeHtml(behavior)}</p></li>`;
    }).join('') : '';
  const intentHtml = intent ? `<section class="intent-block">
    <div class="review-state">${escapeHtml(intent.review_state)}</div>
    <p class="concept"><strong>Visual concept</strong>${escapeHtml(intent.concept)}</p>
    <div class="intent-grid">
      <div><h3>Design Intent</h3><p>${escapeHtml(intent.design_intent)}</p></div>
      <div><h3>Why This Exists / How It Differs</h3><p>${escapeHtml(intent.why_exists)}</p></div>
      <div><h3>Visual Goal on Titanic</h3><p>${escapeHtml(intent.visual_goal_titanic)}</p></div>
      <div><h3>Unique Topology</h3><p>${escapeHtml(intent.unique_topology)}</p></div>
      <div><h3>Distance Silhouette</h3><p>${escapeHtml(intent.distance_silhouette)}</p></div>
      <div><h3>Close Detail</h3><p>${escapeHtml(intent.close_detail)}</p></div>
      <div><h3>Motion Grammar</h3><p>${escapeHtml(intent.motion_grammar)}</p></div>
      <div><h3>XYZ Use</h3><p>${escapeHtml(intent.xyz_use)}</p></div>
      <div><h3>Palette / White Material</h3><p>${escapeHtml(intent.palette_white_material)}</p></div>
      <div><h3>Safety Floor</h3><p>${escapeHtml(intent.safety_floor)}</p></div>
      <div><h3>Anti-Duplication</h3><p>${escapeHtml(intent.anti_duplication_notes)}</p></div>
    </div>
    <details open><summary>Fixture / instrument roles</summary><ul class="roles">${fixtureRoles}</ul></details>
    <details><summary>Suggested restrained audio mappings</summary><ul class="audio-handles">${audioHandles}</ul></details>
  </section>` : `<p class="goal">${escapeHtml(item.goal)}</p>`;
  const savedValues = escapeHtml(JSON.stringify(item.savedValues));
  const chapters = item.chapters.length
    ? `<div class="chapters" aria-label="Reveal chapters">${item.chapters.map(chapter =>
      `<button type="button" data-chapter="${escapeHtml(chapter.time)}"><span>${formatClock(chapter.time)}</span>${escapeHtml(chapter.label)}</button>`,
    ).join('')}</div>`
    : '';
  return `<article class="pattern" id="${escapeHtml(item.pattern)}">
    <header><span class="number">${String(item.index + 1).padStart(2, '0')}</span>` +
      `<div><p class="eyebrow">${escapeHtml(item.pattern)}</p>` +
      `<h2>${escapeHtml(item.title)}</h2></div></header>
    <div class="visual">
      <div class="view-labels"><span>TOP · X/Z</span><span>FRONT · X/Y</span>` +
      `<span>${escapeHtml(item.featureLabel)}</span></div>
      <div class="clip-player">
        <video src="videos/${escapeHtml(item.video)}" autoplay muted playsinline preload="metadata" loop ` +
      `aria-label="Seekable top, front, and detail render of ${escapeHtml(item.title)}"></video>
        <div class="transport">
          <button type="button" data-action="play">Play</button>
          <button type="button" data-action="restart">Restart</button>
          <button type="button" data-action="repeat" aria-pressed="true">Repeat: On</button>
          <span class="time">0:00 / ${formatClock(item.seconds)}</span>
          <input data-action="seek" type="range" min="0" max="${item.seconds}" step="0.05" value="0" ` +
      `aria-label="Seek through ${escapeHtml(item.title)}">
          <a href="gifs/${escapeHtml(item.gif)}" download>Download GIF</a>
        </div>
        ${chapters}
      </div>
    </div>
    ${intentHtml}
    <details><summary>Exact playlist values used in this capture</summary>` +
      `<p class="saved-values"><code>${savedValues}</code></p></details>
    <details><summary>Parameters · effective capture values</summary><ul class="params">${params}</ul></details>
  </article>`;
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// A chapter past the end of the clip would render a seek button that jumps
// nowhere, so the list is clipped to the rendered duration.
function chaptersForPattern(pattern, seconds) {
  const chapters = PATTERN_CHAPTERS[pattern];
  if (!chapters) return [];
  return chapters.filter(chapter => chapter.time < seconds);
}

export function galleryHtml(scene, playlist, items, options) {
  const cards = items.map(patternCardHtml).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BM26 · ${escapeHtml(scene)} / ${escapeHtml(playlist)} Gallery</title>
<style>
:root{--bg:#06090e;--panel:#0e141e;--line:#253247;--text:#edf3fb;--muted:#93a4bb;--gold:#f6bd39;--violet:#9b89ff}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -20%,#182235 0,#06090e 48%);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{width:min(1720px,100%);margin:auto;padding:34px clamp(10px,2.2vw,38px) 90px}.hero{padding:12px 4px 30px;border-bottom:1px solid var(--line)}
.back{color:var(--gold);text-decoration:none;font-weight:700}.eyebrow{margin:0;color:var(--muted);font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase}
h1{font-size:clamp(30px,4vw,56px);letter-spacing:-.035em;margin:14px 0 7px}.hero>p{max-width:920px;color:var(--muted);font-size:17px;margin:0}.facts{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.facts span{border:1px solid #33425a;border-radius:999px;padding:5px 10px;color:#cad5e3;background:#0a1018}
.pattern{margin-top:28px;padding:clamp(12px,1.5vw,24px);background:linear-gradient(145deg,#101824,#0a1018);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 55px #0008;overflow:hidden}.pattern header{display:flex;align-items:center;gap:13px;margin-bottom:14px}.number{display:grid;place-items:center;flex:0 0 48px;height:42px;border-radius:11px;background:#251e0c;color:var(--gold);font-weight:900;font-size:16px}.pattern h2{font-size:clamp(20px,2vw,27px);letter-spacing:-.02em;margin:2px 0 0}.visual{margin-inline:calc(clamp(12px,1.5vw,24px) * -1);background:#04070c;border-block:1px solid #2b3a50}.view-labels{display:grid;grid-template-columns:repeat(3,1fr);font:700 11px/1 ui-monospace,monospace;letter-spacing:.08em;color:#aebbd0;text-align:center;background:#09101a}.view-labels span{padding:10px 4px;border-right:1px solid #253247}.view-labels span:last-child{border:0}.visual video{display:block;width:100%;height:auto;background:#04070c}.transport{display:grid;grid-template-columns:auto auto auto auto minmax(160px,1fr) auto;align-items:center;gap:8px;padding:10px 12px;background:#09101a;border-top:1px solid #253247}.transport button,.transport a,.chapters button{border:1px solid #384a64;border-radius:8px;background:#101a28;color:#e6edf7;padding:7px 10px;font:700 11px system-ui,sans-serif;cursor:pointer;text-decoration:none}.transport button:hover,.transport a:hover,.chapters button:hover{border-color:var(--gold);color:#fff}.transport button[aria-pressed="true"]{background:#2a210d;border-color:#725f27;color:var(--gold)}.transport .time{font:700 11px ui-monospace,monospace;color:#b8c6d8;white-space:nowrap}.transport input{width:100%;accent-color:var(--gold)}.chapters{display:flex;gap:6px;overflow-x:auto;padding:0 12px 11px;background:#09101a}.chapters button{display:flex;gap:6px;align-items:center;white-space:nowrap;background:#0b1320}.chapters button span{color:var(--gold);font:800 10px ui-monospace,monospace}.goal{font-size:17px;max-width:1120px;margin:18px 2px 12px;color:#d9e2ef}details{border-top:1px solid #26344a;padding-top:10px}summary{cursor:pointer;color:#b9c6d7;font-weight:700}.params{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;padding:12px 0 0;margin:0;list-style:none}.params li{border:1px solid #27364c;border-radius:10px;padding:9px 10px;background:#080e16}.params li>div{display:flex;gap:6px;align-items:center}.params p{color:var(--muted);font-size:12px;margin:4px 0 0}.value{margin-left:auto;color:var(--gold);font:700 12px ui-monospace,monospace}.signal{font:800 9px ui-monospace,monospace;padding:3px 5px;border-radius:4px;background:#271f50;color:#c9beff;border:1px solid #594a9b}
.concept{font-size:17px;max-width:1180px;margin:18px 2px 12px;color:#d9e2ef}.concept strong{display:block;color:var(--gold);font:800 11px ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;margin-bottom:4px}.review-state{display:inline-block;margin-top:16px;border:1px solid #6f5c27;border-radius:999px;padding:5px 10px;color:var(--gold);background:#211b0b;font:800 11px ui-monospace,monospace;letter-spacing:.05em}.intent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:9px;margin:14px 0}.intent-grid>div{border:1px solid #27364c;border-radius:11px;background:#080e16;padding:11px}.intent-grid h3{margin:0 0 5px;color:#c9beff;font:800 11px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}.intent-grid p,.roles p,.audio-handles p{margin:0;color:var(--muted);font-size:13px}.roles,.audio-handles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;padding:11px 0 0;margin:0;list-style:none}.roles li,.audio-handles li{border:1px solid #27364c;border-radius:10px;padding:9px 10px;background:#080e16}.mapping{margin-left:6px;color:var(--gold);font:700 11px ui-monospace,monospace}.saved-values code{display:block;padding:9px;border:1px solid #27364c;border-radius:8px;background:#080e16;color:#d9e2ef;overflow-wrap:anywhere}.params small{display:block;color:#72839a;font:700 10px ui-monospace,monospace;margin-top:5px}.intent-block details,details{margin-top:10px}
@media(max-width:850px){.transport{grid-template-columns:repeat(3,auto);}.transport .time{grid-column:1}.transport input{grid-column:2/-1}.transport a{grid-column:1/-1;text-align:center}}@media(max-width:700px){main{padding-inline:6px}.pattern{border-radius:11px}.view-labels{font-size:8px}.params{grid-template-columns:1fr}}
</style></head><body><main><section class="hero"><a class="back" href="../../../index.html">← All playlists</a>
<p class="eyebrow">${escapeHtml(scene)} scene · saved playlist</p><h1>${escapeHtml(prettyName(playlist))}</h1>
<p>Offline renders compiled through the real ${escapeHtml(scene)} model at the playlist’s exact saved parameter values${options.palette ? ` with the configured ${escapeHtml(options.palette.id)} palette applied` : ''}. The three synchronized views show the same frame. Play, pause, restart, repeat, or scrub the seekable clip; the GIF remains downloadable.</p>
<div class="facts"><span>${items.length} entries</span><span>${options.seconds}s loops</span>` +
    `<span>${options.fps} fps</span><span>${Math.round(options.globalSpeed * 100)}% global clock</span>` +
    `<span>${escapeHtml(options.variation)} variation</span>` +
    `${options.palette ? `<span>palette: ${escapeHtml(options.palette.id)}</span>` : ''}</div></section>
${cards}</main><script>
const clock=value=>{const total=Math.max(0,Math.floor(Number(value)||0));return Math.floor(total/60)+':' + String(total%60).padStart(2,'0')};
for(const player of document.querySelectorAll('.clip-player')){
  const video=player.querySelector('video');
  const play=player.querySelector('[data-action="play"]');
  const restart=player.querySelector('[data-action="restart"]');
  const repeat=player.querySelector('[data-action="repeat"]');
  const seek=player.querySelector('[data-action="seek"]');
  const time=player.querySelector('.time');
  const refresh=()=>{play.textContent=video.paused?'Play':'Pause';time.textContent=clock(video.currentTime)+' / '+clock(video.duration||seek.max);if(!seek.matches(':active'))seek.value=String(video.currentTime)};
  video.addEventListener('loadedmetadata',()=>{seek.max=String(video.duration);refresh()});
  video.addEventListener('timeupdate',refresh);video.addEventListener('play',refresh);video.addEventListener('pause',refresh);video.addEventListener('ended',refresh);
  play.addEventListener('click',()=>{if(video.paused)video.play();else video.pause()});
  restart.addEventListener('click',()=>{video.currentTime=0;video.play()});
  repeat.addEventListener('click',()=>{video.loop=!video.loop;repeat.setAttribute('aria-pressed',String(video.loop));repeat.textContent=video.loop?'Repeat: On':'Repeat: Off'});
  seek.addEventListener('input',()=>{video.currentTime=Number(seek.value);refresh()});
  for(const chapter of player.querySelectorAll('[data-chapter]'))chapter.addEventListener('click',()=>{video.currentTime=Number(chapter.dataset.chapter);video.play()});
  refresh();
  const autoplay=video.play();
  if(autoplay)autoplay.catch(error=>{player.dataset.autoplay='blocked';play.textContent='Play';play.title='Autoplay was blocked by this browser; press Play to start.';console.error('Gallery autoplay blocked',error)});
}
</script></body></html>`;
}

export function publishGallery(
  stagingDir,
  outputDir,
  scratchRoot = SCRATCH_ROOT,
  outputRoot = DOCS_ROOT,
) {
  assertInside(scratchRoot, stagingDir);
  assertInside(outputRoot, outputDir);
  const backupDir = path.join(
    scratchRoot,
    'publish_backup',
    `${path.basename(outputDir)}_${process.pid}_${Date.now()}`,
  );
  assertInside(scratchRoot, backupDir);
  fs.mkdirSync(path.dirname(backupDir), { recursive: true });
  const hadOutput = fs.existsSync(outputDir);
  if (hadOutput) fs.renameSync(outputDir, backupDir);
  try {
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    fs.renameSync(stagingDir, outputDir);
  } catch (error) {
    if (hadOutput && !fs.existsSync(outputDir) && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, outputDir);
    }
    throw error;
  }
  if (hadOutput && fs.existsSync(backupDir)) {
    assertInside(scratchRoot, backupDir);
    fs.rmSync(backupDir, { recursive: true });
  }
}

export function galleryManifestMeetsCampaignContract(item, manifest) {
  const isIntentCampaign = item.scene === 'titanic' &&
    ['ambient_extra', 'white_only'].includes(item.playlist);
  if (!isIntentCampaign) return true;
  return manifest.schemaVersion === 3 && manifest.seconds >= 40 && manifest.fps >= 8 &&
    manifest.variation === 'saved' && Array.isArray(manifest.items) &&
    manifest.items.every((entry) =>
      entry.intent?.schema_version === 1 && entry.savedValues && entry.effectiveValues &&
      typeof entry.sourceDigest === 'string' && entry.sourceDigest.length === 64) &&
    typeof manifest.playlistDigest === 'string' && manifest.playlistDigest.length === 64 &&
    typeof manifest.goalsDigest === 'string' && manifest.goalsDigest.length === 64;
}

function galleryIsReady(item) {
  const dir = galleryPath(item.scene, item.playlist);
  const htmlPath = path.join(dir, 'index.html');
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(htmlPath) || !fs.existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 2 ||
        manifest.scene !== item.scene || manifest.playlist !== item.playlist ||
        manifest.items?.length !== item.entries) return false;
    if (!galleryManifestMeetsCampaignContract(item, manifest)) return false;
    const isIntentCampaign = item.scene === 'titanic' &&
      ['ambient_extra', 'white_only'].includes(item.playlist);
    if (isIntentCampaign) {
      if (manifest.playlistDigest !== fileDigest(item.filePath)) return false;
      if (manifest.goalsDigest !== fileDigest(GOALS_PATH)) return false;
      for (const entry of manifest.items) {
        const sourcePath = path.join(PATTERNS_DIR, `${entry.pattern}.js`);
        if (!fs.existsSync(sourcePath) || entry.sourceDigest !== fileDigest(sourcePath)) return false;
      }
    }
    return manifest.items.every((entry) =>
      typeof entry.gif === 'string' && typeof entry.video === 'string' &&
      fs.existsSync(path.join(dir, 'gifs', entry.gif)) &&
      fs.existsSync(path.join(dir, 'videos', entry.video)));
  } catch {
    return false;
  }
}

function buildIndex(playlists) {
  fs.mkdirSync(DOCS_ROOT, { recursive: true });
  const transitionDir = path.join(DOCS_ROOT, 'transitions');
  const transitionManifestPath = path.join(transitionDir, 'manifest.json');
  const transitionReady = fs.existsSync(path.join(transitionDir, 'index.html'))
    && fs.existsSync(transitionManifestPath);
  let transitionCount = 0;
  if (transitionReady) {
    const transitionManifest = JSON.parse(fs.readFileSync(transitionManifestPath, 'utf8'));
    if (!Array.isArray(transitionManifest.items)) {
      throw new Error(`transition gallery manifest has no items array: ${transitionManifestPath}`);
    }
    transitionCount = transitionManifest.items.length;
  }
  const transitionBody = `<strong>Deck Transitions</strong>` +
    `<small>${transitionReady ? transitionCount : 0} transition sequences</small>` +
    (transitionReady ? '<span class="ready">Gallery ready</span>' : '<span>Not rendered</span>');
  const transitionCard = transitionReady
    ? `<a class="playlist ready-card" href="transitions/index.html">${transitionBody}</a>`
    : `<div class="playlist">${transitionBody}</div>`;
  const transitionSection = `<section><h2>Transitions</h2><div class="grid">${transitionCard}</div></section>`;
  const grouped = new Map();
  for (const item of playlists) {
    if (!grouped.has(item.scene)) grouped.set(item.scene, []);
    grouped.get(item.scene).push(item);
  }
  const sceneSection = (scene, items, focus = false) => {
    const ordered = [...items].sort((first, second) => {
      if (focus) {
        const readyDelta = Number(galleryIsReady(second)) - Number(galleryIsReady(first));
        if (readyDelta !== 0) return readyDelta;
      }
      return first.playlist.localeCompare(second.playlist);
    });
    const cards = ordered.map((item) => {
      const generated = galleryIsReady(item);
      const tag = generated ? '<span class="ready">Gallery ready</span>' : '<span>Not rendered</span>';
      const body = `<strong>${escapeHtml(prettyName(item.playlist))}</strong>` +
        `<small>${item.entries} entries</small>${tag}`;
      return generated
        ? `<a class="playlist ready-card" href="playlists/${escapeHtml(item.scene)}/${escapeHtml(item.playlist)}/index.html">${body}</a>`
        : `<div class="playlist">${body}</div>`;
    }).join('');
    return `<section${focus ? ' class="focus-scene"' : ''}><h2>${escapeHtml(prettyName(scene))}</h2><div class="grid">${cards}</div></section>`;
  };
  const titanicItems = grouped.get('titanic');
  if (!titanicItems) throw new Error('playlist index requires the Titanic scene');
  const titanicSection = sceneSection('titanic', titanicItems, true);
  const otherSections = [...grouped.entries()]
    .filter(([scene]) => scene !== 'titanic')
    .map(([scene, items]) => sceneSection(scene, items))
    .join('\n');
  const hiddenScenes = otherSections.length > 0
    ? `<details class="other-scenes"><summary>Other scenes (hidden by default)</summary>${otherSections}</details>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BM26 Pattern Galleries</title><style>
:root{--bg:#070a10;--panel:#101722;--line:#28364a;--text:#edf2f8;--muted:#92a2b7;--gold:#f6bd39}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#1b2740,#070a10 48%);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1320px;margin:auto;padding:48px 20px 100px}.hero{max-width:900px;margin-bottom:38px}.eyebrow{font:800 11px ui-monospace,monospace;letter-spacing:.11em;text-transform:uppercase;color:var(--gold)}h1{font-size:clamp(38px,6vw,72px);letter-spacing:-.05em;line-height:1;margin:12px 0}.hero p{color:var(--muted);font-size:17px}section{margin-top:35px}h2{font-size:21px;border-bottom:1px solid var(--line);padding-bottom:9px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.playlist{display:flex;min-height:105px;flex-direction:column;padding:15px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(145deg,#111a27,#0b111a);color:var(--text);text-decoration:none}.playlist strong{font-size:16px}.playlist small{color:var(--muted);margin:4px 0 auto}.playlist span{font-size:11px;color:#718096}.playlist .ready{color:var(--gold);font-weight:800}.ready-card:hover{border-color:#725f27;transform:translateY(-1px)}code{color:#d8e2ef;background:#101722;border:1px solid var(--line);padding:2px 5px;border-radius:5px}@media(max-width:600px){main{padding-inline:11px}}
</style></head><body><main><div class="hero"><div class="eyebrow">BM26 · Titanic’s End</div><h1>Pattern Galleries</h1><p>Titanic is the primary review surface. Rendered galleries open below; create or refresh a playlist with <code>node tools/playlist_gallery/generate.mjs --scene &lt;scene&gt; --playlist &lt;name&gt;</code>, or transitions with <code>node tools/transition_gallery/generate.mjs</code>, from <code>marsin_engine</code>.</p></div>${titanicSection}${transitionSection}${hiddenScenes}</main></body></html>`;
  fs.writeFileSync(path.join(DOCS_ROOT, 'index.html'), html);
}

function writeReadme() {
  const readme = `# BM26 playlist galleries

This directory is generated by the offline playlist-gallery tool. Its index
discovers every saved playlist under \`simulation/scenes/*/playlists/\` and
links galleries that have been rendered.

After the branch is pushed, the teammate-shareable index is:
\`https://sina-cb.github.io/BM26-Titanic/docs/pattern_gallery/\`.

From \`marsin_engine/\`:

\`\`\`bash
node tools/playlist_gallery/generate.mjs --scene titanic --playlist ambient
node tools/playlist_gallery/generate.mjs --scene titanic --playlist deep_sea --palette baby_reveal_duet
node tools/transition_gallery/generate.mjs
node tools/playlist_gallery/generate.mjs --index-only
\`\`\`

Default clips are 10 seconds at 8 fps, a 100% pattern clock, and use exact saved values with no audio.
Use \`--global-speed 0.3\` when the operator's review target is the Ambient
30% global clock; the manifest and gallery header record that scale explicitly.
Use \`--variation sound\` only when you intentionally want the pattern-authored
audio suggestions. Use \`--palette <id>\` to apply an exact palette from
\`marsin_engine/config.yaml\`; an unknown palette or a pattern without both
palette exports fails loudly. The render is offline; it never boots the engine
or binds a show port. The bundled offline FFmpeg build emits a seekable MP4 for
interactive play, pause, restart, repeat, and scrubbing, plus a downloadable GIF.
A mild display-only tone curve keeps low-light detail legible on ordinary screens.

The interactive local review system in \`marsin_engine/tools/gallery/\` remains
the live audition tool; this directory is the permanent, teammate-shareable
playlist record.

The transition gallery under \`transitions/\` renders every Deck transition
against one fixed full-rig Baby blue-to-pink sequence. It mirrors the current
Deck compositor, including its smoothstep fader and tail-replacement behavior,
so visual defects remain visible rather than being polished out of the review
artifact.
`;
  fs.writeFileSync(path.join(DOCS_ROOT, 'README.md'), readme);
}

function generateOne(scene, playlist, options, patterns, goals) {
  assertSafeName(scene, 'scene');
  assertSafeName(playlist, 'playlist');
  const modelPath = path.join(ENGINE_DIR, 'models', `${scene}.js`);
  if (!fs.existsSync(modelPath)) throw new Error(`no engine model for scene "${scene}"`);
  const playlistPath = path.join(SCENES_DIR, scene, 'playlists', `${playlist}.yaml`);
  if (!fs.existsSync(playlistPath)) throw new Error(`playlist not found: ${playlistPath}`);
  const data = readYaml(playlistPath);
  if (!Array.isArray(data.entries)) throw new Error(`playlist has no entries array: ${playlistPath}`);
  const preparedEntries = data.entries.map((rawEntry, index) => {
    const entry = { ...rawEntry, index };
    const pattern = entry.pattern;
    const patternPath = patterns.get(pattern);
    if (!patternPath) throw new Error(`${scene}/${playlist}: pattern not found: ${pattern}`);
    const source = fs.readFileSync(patternPath, 'utf8');
    const goal = galleryGoal(pattern, goals[pattern], source);
    if (pattern.startsWith('ambient_extra/') && !goal.intent) {
      throw new Error(`${pattern}: Ambient Extra requires structured design-intent metadata`);
    }
    const savedValues = validateSavedDefaults(pattern, source, entry.defaults ?? {});
    const controls = controlsForEntry(source, pattern, savedValues, goal.intent);
    if (options.variation === 'sound' && !parseAudioModSpec(source, pattern)) {
      throw new Error(`${pattern}: --variation sound requires AUDIO_MODULATION_V1`);
    }
    if (options.palette) {
      for (const exportName of ['colorPalette1', 'colorPalette2']) {
        if (!new RegExp(`export\\s+function\\s+${exportName}\\s*\\(`).test(source)) {
          throw new Error(`${pattern}: --palette requires exported ${exportName}`);
        }
      }
    }
    return { entry, pattern, patternPath, goal, controls, savedValues };
  });

  const outputDir = galleryPath(scene, playlist);
  const stagingDir = path.join(
    SCRATCH_ROOT,
    'staging',
    `${scene}_${playlist}_${process.pid}_${Date.now()}`,
  );
  const gifDir = path.join(stagingDir, 'gifs');
  const videoDir = path.join(stagingDir, 'videos');
  assertInside(DOCS_ROOT, outputDir);
  assertInside(SCRATCH_ROOT, stagingDir);
  fs.mkdirSync(gifDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });

  const items = [];
  for (const prepared of preparedEntries) {
    const { entry, pattern, patternPath, goal, controls, savedValues } = prepared;
    const { index } = entry;
    process.stdout.write(`[${index + 1}/${preparedEntries.length}] ${pattern} ... `);
    const capture = capturePattern(patternPath, pattern, scene, playlist, entry, options);
    const mediaName = mediaStem(pattern);
    const gifName = `${String(index + 1).padStart(3, '0')}_${mediaName}.gif`;
    const videoName = `${String(index + 1).padStart(3, '0')}_${mediaName}.mp4`;
    const gifPath = path.join(gifDir, gifName);
    const videoPath = path.join(videoDir, videoName);
    const rendered = renderMedia(capture, scene, gifPath, videoPath);
    const mediaSize = fs.statSync(gifPath).size + fs.statSync(videoPath).size;
    console.log(`${(mediaSize / 1024 / 1024).toFixed(2)} MB GIF+MP4`);
    items.push({
      index,
      pattern,
      title: entry.label || prettyName(pattern),
      goal: goal.summary || `A saved ${prettyName(pattern)} look authored for ${prettyName(scene)}.`,
      intent: goal.intent,
      controls,
      savedValues,
      effectiveValues: {
        ...Object.fromEntries(controls.map((control) => [control.name, control.value])),
        ...(options.palette ? {
          cp1H: options.palette.c1,
          cp1S: 1,
          cp1V: 1,
          cp2H: options.palette.c2,
          cp2S: 1,
          cp2V: 1,
        } : {}),
      },
      gif: gifName,
      video: videoName,
      seconds: options.seconds,
      chapters: chaptersForPattern(pattern, options.seconds),
      featureLabel: rendered.featureLabel,
      sourceDigest: fileDigest(patternPath),
    });
  }
  const manifest = {
    schemaVersion: 3,
    scene,
    playlist,
    seconds: options.seconds,
    fps: options.fps,
    globalSpeed: options.globalSpeed,
    variation: options.variation,
    palette: options.palette?.id || null,
    source: path.relative(REPO_DIR, playlistPath).replaceAll('\\', '/'),
    playlistDigest: fileDigest(playlistPath),
    goalsDigest: fileDigest(GOALS_PATH),
    items,
  };
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(stagingDir, 'index.html'),
    galleryHtml(scene, playlist, items, options));
  publishGallery(stagingDir, outputDir);
  console.log(`GALLERY ${path.join(outputDir, 'index.html')}`);
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const seconds = Number(args.seconds ?? DEFAULT_SECONDS);
  const fps = Number(args.fps ?? DEFAULT_FPS);
  const globalSpeed = Number(args['global-speed'] ?? 1);
  const variation = args.variation ?? 'saved';
  const palette = resolveGalleryPalette(readYaml(CONFIG_PATH), args.palette || null);
  if (!(seconds > 0) || !(fps >= 2 && fps <= 20)
      || !(globalSpeed > 0 && globalSpeed <= 4)) {
    throw new Error('--seconds must be >0, --fps must be between 2 and 20, and --global-speed must be in (0, 4]');
  }
  if (!['saved', 'sound'].includes(variation)) {
    throw new Error('--variation must be saved or sound');
  }
  const playlists = discoverPlaylists();
  const options = { seconds, fps, globalSpeed, variation, palette };
  fs.mkdirSync(DOCS_ROOT, { recursive: true });
  if (args['index-only'] && args['skip-index']) {
    throw new Error('--index-only and --skip-index cannot be combined');
  }
  if (!args['index-only']) {
    const patterns = patternFiles();
    const goals = loadGoals();
    if (args['all-playlists']) {
      for (const item of playlists) {
        generateOne(item.scene, item.playlist, options, patterns, goals);
      }
    } else {
      if (!args.scene || !args.playlist) {
        throw new Error('provide --scene and --playlist, --index-only, or --all-playlists');
      }
      generateOne(args.scene, args.playlist, options, patterns, goals);
    }
  }
  if (!args['skip-index']) {
    buildIndex(playlists);
    writeReadme();
    console.log(`INDEX ${path.join(DOCS_ROOT, 'index.html')}`);
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`playlist_gallery: ${error.message}`);
    process.exitCode = 1;
  }
}
