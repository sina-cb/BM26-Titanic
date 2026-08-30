/**
 * Resolve Titanic's authored simulation pixel-map views into a deterministic,
 * offline artifact for Live Touch. The simulation resolver remains the only
 * layout implementation; this exporter serializes its result and fingerprints
 * every authoritative input so the surface can refuse stale geometry.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { pixels as modelPixels } from '../../marsin_engine/models/titanic_normalized.js';
import { createViewRegistry } from '../src/dmx/view_registry.js';
import {
  DEFAULT_CANVAS,
  buildClusters,
  expandPanel,
  seedPanel,
} from '../src/gui/pixel_map/pixel_map_layout.js';
import {
  createViewsContainer,
  resolveView,
} from '../src/gui/pixel_map/pixel_map_views.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PIXEL_MAP_PATH = path.join(REPO_ROOT, 'simulation/scenes/titanic_normalized/pixel_map_views.yaml');
const CAMERAS_PATH = path.join(REPO_ROOT, 'simulation/scenes/titanic_normalized/cameras.yaml');
const VIEW_REGISTRY_PATH = path.join(REPO_ROOT, 'simulation/scenes/titanic_normalized/views.yaml');
const MODEL_PATH = path.join(REPO_ROOT, 'marsin_engine/models/titanic_normalized.js');
const RESOLVER_PATHS = [
  path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_layout.js'),
  path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_views.js'),
];
const OUTPUT_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.json');
const ARTIFACT_SCHEMA_VERSION = 4;
const VIEW_AXIS_PAIRS = Object.freeze({
  top_down: Object.freeze(['nx', 'nz']),
  front: Object.freeze(['nx', 'ny']),
  back: Object.freeze(['nx', 'ny']),
  strands: Object.freeze(['nx', 'nz']),
  te_sign: Object.freeze(['nz', 'ny']),
});

const FRONT_MIRROR_GROUPS = Object.freeze([
  'Left Back Wall', 'Left Back Rails', 'Left_Back_Left', 'Left_Back_Right',
  'Right Back Wall', 'Right Back Rails', 'Right_Back_Left', 'Right_Back_Right',
]);

function frontPaintPixelIndices(visible, batchList) {
  const paint = new Set(visible);
  for (const pixel of batchList) {
    const key = pixel.fixKey;
    const mirroredSmoke = /^Left SmokeStack [5-8]$/.test(key)
      || /^Right SmokeStacks [1-4]$/.test(key);
    if (FRONT_MIRROR_GROUPS.includes(pixel.group) || mirroredSmoke) paint.add(pixel.i);
  }
  return [...paint].sort((a, b) => a - b);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalSource(text) {
  return text.replace(/\r\n?/g, '\n');
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fixtureKey(pixel) {
  const name = pixel && pixel.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`[touch-pixel-views] pixel ${pixel && pixel.i} has no fixture name`);
  }
  // LED strands intentionally serialize an empty fixtureType and already carry
  // their authored fixture name. Every typed fixture appends its model-pixel or
  // channel name after the final " - "; strip only that exporter-owned suffix.
  if (!pixel.fixtureType) return name;
  const dash = name.lastIndexOf(' - ');
  if (dash > 0) return name.slice(0, dash);
  const channel = name.match(/^(.*) \(Ch \d+\)$/);
  return channel ? channel[1] : name;
}

/**
 * Recreate the simulation's live batch list from the engine model without
 * changing model bytes. `fixIndex`/`fixKey` are display metadata normally
 * supplied by the scene exporter; world coordinates retain their canonical
 * values and pixel order.
 */
export function buildBatchList(pixels = modelPixels) {
  if (!Array.isArray(pixels) || pixels.length === 0) {
    throw new Error('[touch-pixel-views] Titanic model has no pixels');
  }
  const list = [];
  let fixIndex = -1;
  let currentKey = null;
  let expectedLocalIndex = 0;
  for (let index = 0; index < pixels.length; index++) {
    const pixel = pixels[index];
    if (!pixel || pixel.i !== index) {
      throw new Error(`[touch-pixel-views] model pixel identity/order mismatch at ${index}`);
    }
    for (const field of ['x', 'y', 'z', 'nx', 'ny', 'nz']) {
      if (!Number.isFinite(pixel[field])) {
        throw new Error(`[touch-pixel-views] pixel ${index}.${field} is not finite`);
      }
    }
    if (!Number.isInteger(pixel.localIndex) || pixel.localIndex < 0) {
      throw new Error(`[touch-pixel-views] pixel ${index}.localIndex is invalid`);
    }
    if (pixel.localIndex === 0) {
      fixIndex++;
      currentKey = fixtureKey(pixel);
      expectedLocalIndex = 0;
    }
    if (currentKey === null || pixel.localIndex !== expectedLocalIndex) {
      throw new Error(`[touch-pixel-views] fixture-local ordering breaks at pixel ${index}: ` +
        `expected ${expectedLocalIndex}, got ${pixel.localIndex}`);
    }
    expectedLocalIndex++;
    list.push({
      ...pixel,
      fixIndex,
      fixKey: currentKey,
      wx: pixel.x,
      wy: pixel.y,
      wz: pixel.z,
    });
  }
  return list;
}

export function topologyPayload(pixels) {
  if (!Array.isArray(pixels) || pixels.length === 0) {
    throw new Error('[touch-pixel-views] engine pixel layout is empty');
  }
  return pixels.map((pixel, index) => {
    if (!pixel || pixel.i !== index) {
      throw new Error(`[touch-pixel-views] engine pixel identity/order mismatch at ${index}`);
    }
    for (const field of ['x', 'y', 'z', 'nx', 'ny', 'nz']) {
      if (!Number.isFinite(pixel[field])) {
        throw new Error(`[touch-pixel-views] engine pixel ${index}.${field} is not finite`);
      }
    }
    if (!Number.isInteger(pixel.localIndex) || pixel.localIndex < 0) {
      throw new Error(`[touch-pixel-views] engine pixel ${index}.localIndex is invalid`);
    }
    return [
      pixel.i,
      pixel.x,
      pixel.y,
      pixel.z,
      pixel.nx,
      pixel.ny,
      pixel.nz,
      pixel.group ?? null,
      pixel.type ?? null,
      pixel.fixtureType ?? null,
      pixel.fId ?? null,
      pixel.sId ?? null,
      pixel.localIndex,
    ];
  });
}

export function topologyFingerprint(pixels) {
  return sha256(JSON.stringify(topologyPayload(pixels)));
}

function mergedPlacements(panel) {
  const placements = seedPanel(
    panel.def,
    panel.clusters,
    panel.batchList,
    DEFAULT_CANVAS.w,
    DEFAULT_CANVAS.h,
    panel.styles,
  );
  for (const cluster of panel.clusters) {
    const saved = panel.placements.get(cluster.fixKey);
    if (saved) placements.set(cluster.fixKey, { ...saved });
  }
  return placements;
}

function finiteGlyph(glyph, viewId, panelId) {
  for (const field of ['cx', 'cy', 'sizeX', 'sizeY', 'rot']) {
    if (!Number.isFinite(glyph[field])) {
      throw new Error(`[touch-pixel-views] ${viewId}/${panelId} glyph ${glyph.gi}.${field} ` +
        'is not finite');
    }
  }
}

function exportView(viewDef, clusters, batchList, viewRegistry) {
  const axes = VIEW_AXIS_PAIRS[viewDef.id];
  if (!axes) {
    throw new Error(`[touch-pixel-views] ${viewDef.id} has no authored Live Touch axis pair`);
  }
  const resolved = resolveView(viewDef, clusters, batchList, { viewRegistry });
  const used = new Set();
  const clusterByPixel = new Map();
  for (const cluster of clusters) {
    for (const pixel of cluster.pixels) clusterByPixel.set(pixel.gi, cluster);
  }
  const panels = resolved.panels.map((panel) => {
    if (panel.error) throw new Error(`[touch-pixel-views] ${viewDef.id}: ${panel.error}`);
    const placements = mergedPlacements({ ...panel, batchList });
    const expanded = expandPanel(
      panel.def,
      panel.clusters,
      batchList,
      placements,
      panel.styles,
      viewDef.offsets,
    );
    const glyphs = expanded.map((glyph) => {
      finiteGlyph(glyph, viewDef.id, panel.def.id);
      if (used.has(glyph.gi)) {
        throw new Error(`[touch-pixel-views] ${viewDef.id} renders pixel ${glyph.gi} twice`);
      }
      used.add(glyph.gi);
      const pixel = batchList[glyph.gi];
      const cluster = clusterByPixel.get(glyph.gi);
      if (!pixel || !cluster) {
        throw new Error(`[touch-pixel-views] ${viewDef.id} resolves unknown pixel ${glyph.gi}`);
      }
      return {
        pixelIndex: glyph.gi,
        fixtureKey: glyph.fixKey,
        fixtureType: cluster.fixtureType,
        kind: cluster.kind,
        group: cluster.group,
        x: glyph.cx,
        y: glyph.cy,
        sizeX: glyph.sizeX,
        sizeY: glyph.sizeY,
        shape: glyph.shape,
        effect: glyph.effect || null,
        rotation: glyph.rot,
        world: { nx: pixel.nx, ny: pixel.ny, nz: pixel.nz },
      };
    });
    return {
      id: panel.def.id,
      label: panel.def.label || panel.def.id,
      weight: panel.def.weight > 0 ? panel.def.weight : 1,
      glyphs,
    };
  });
  const framing = viewDef.framing || { zoom: 1, panX: 0, panY: 0 };
  const paintPixelIndices = viewDef.id === 'front'
    ? frontPaintPixelIndices(used, batchList)
    : [...used].sort((a, b) => a - b);
  return {
    id: resolved.id,
    label: resolved.label,
    axisX: axes[0],
    axisY: axes[1],
    framing: {
      zoom: framing.zoom,
      panX: framing.panX,
      panY: framing.panY,
    },
    pixelCount: used.size,
    paintPixelCount: paintPixelIndices.length,
    paintPixelIndices,
    panels,
  };
}

export function buildArtifact() {
  const pixelMapText = readUtf8(PIXEL_MAP_PATH);
  const camerasText = readUtf8(CAMERAS_PATH);
  const registryText = readUtf8(VIEW_REGISTRY_PATH);
  const modelText = readUtf8(MODEL_PATH);
  const resolverText = RESOLVER_PATHS.map((filePath) => canonicalSource(readUtf8(filePath)))
    .join('\n-- touch resolver boundary --\n');
  const pixelMapTree = yaml.load(pixelMapText);
  const registryTree = yaml.load(registryText);
  const views = createViewsContainer(pixelMapTree).views;
  const viewRegistry = createViewRegistry(registryTree && registryTree.views);
  const batchList = buildBatchList();
  const clusters = buildClusters(batchList);
  const exportedViews = views.map((view) => exportView(view, clusters, batchList, viewRegistry));
  const design = {
    width: DEFAULT_CANVAS.w,
    height: DEFAULT_CANVAS.h,
    panelGap: 8,
  };
  const resolvedFingerprint = sha256(JSON.stringify({
    modelPixelCount: modelPixels.length,
    design,
    views: exportedViews,
  }));
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedBy: 'simulation/tools/export_touch_control_pixel_views.mjs',
    source: {
      scene: 'titanic_normalized',
      modelPath: 'marsin_engine/models/titanic_normalized.js',
      pixelMapViewsPath: 'simulation/scenes/titanic_normalized/pixel_map_views.yaml',
      camerasPath: 'simulation/scenes/titanic_normalized/cameras.yaml',
      modelFingerprint: topologyFingerprint(modelPixels),
      modelSourceFingerprint: sha256(canonicalSource(modelText)),
      viewsFingerprint: sha256(canonicalSource(pixelMapText)),
      camerasFingerprint: sha256(canonicalSource(camerasText)),
      resolverFingerprint: sha256(resolverText),
      resolvedFingerprint,
    },
    modelPixelCount: modelPixels.length,
    design,
    views: exportedViews,
  };
}

export function serializeArtifact(artifact = buildArtifact()) {
  return `${JSON.stringify(artifact)}\n`;
}

function writeArtifact(serialized, outputPath) {
  // Idempotent by content: the save server re-runs this exporter at every
  // boot and after every input-mutating save, so an already-current artifact
  // must be a loud no-op, not a rewrite that churns mtimes on a tracked file.
  if (fs.existsSync(outputPath) && readUtf8(outputPath) === serialized) {
    process.stdout.write(`[touch-pixel-views] ${path.relative(REPO_ROOT, outputPath)} ` +
      'is already current (no write)\n');
    return;
  }
  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, outputPath);
  process.stdout.write(`[touch-pixel-views] wrote ${path.relative(REPO_ROOT, outputPath)}\n`);
}

function checkArtifact(serialized, outputPath) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(`[touch-pixel-views] missing ${path.relative(REPO_ROOT, outputPath)}; ` +
      'run npm run pixel-views:export');
  }
  if (readUtf8(outputPath) !== serialized) {
    throw new Error(`[touch-pixel-views] stale ${path.relative(REPO_ROOT, outputPath)}; ` +
      'run npm run pixel-views:export and review the resolved view change');
  }
  process.stdout.write('[touch-pixel-views] artifact is current\n');
}

// `--out <path>` redirects the write/check target. TEST-ONLY seam (same
// doctrine as SIM_SAVE_SERVER_ROOT in save-server.js): the save server passes
// it when its scene root is overridden onto a throwaway tree, so a test's
// artifact refresh can never touch the real tracked CaptainPad/live_touch artifact. Absent
// in production → the canonical OUTPUT_PATH, exactly as before. A dangling
// `--out` with no value fails loudly rather than guessing.
function resolveOutputPath(argv) {
  const flagIndex = argv.indexOf('--out');
  if (flagIndex === -1) return OUTPUT_PATH;
  const value = argv[flagIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('[touch-pixel-views] --out requires a target path');
  }
  return path.resolve(value);
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputPath = resolveOutputPath(process.argv);
  const serialized = serializeArtifact();
  if (process.argv.includes('--check')) checkArtifact(serialized, outputPath);
  else writeArtifact(serialized, outputPath);
}
