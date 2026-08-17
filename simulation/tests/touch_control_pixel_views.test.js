import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { pixels as titanicPixels } from '../../marsin_engine/models/titanic.js';
import { applySpatialPaint } from '../../marsin_engine/effects/spatial_paint.js';
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
import {
  buildArtifact,
  buildBatchList,
  serializeArtifact,
  topologyFingerprint,
} from '../tools/export_touch_control_pixel_views.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ARTIFACT_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control_pixel_views.json');
const PANEL_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control.html');
const RUNTIME_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control_pixel_views.js');
const PIXEL_MAP_PATH = path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml');
const VIEW_REGISTRY_PATH = path.join(REPO_ROOT, 'simulation/scenes/titanic/views.yaml');
const require = createRequire(import.meta.url);
const runtime = require(RUNTIME_PATH);
const VIEW_CONTRACTS = new Map([
  ['top_down', { pixelCount: 720, axisX: 'nx', axisY: 'nz' }],
  ['front', { pixelCount: 396, axisX: 'nx', axisY: 'ny' }],
  ['strands', { pixelCount: 320, axisX: 'nx', axisY: 'nz' }],
  ['te_sign', { pixelCount: 148, axisX: 'nz', axisY: 'ny' }],
]);

function countGlyphs(view) {
  return view.panels.reduce((count, panel) => count + panel.glyphs.length, 0);
}

function findView(artifact, id) {
  const view = artifact.views.find((candidate) => candidate.id === id);
  assert.ok(view, `artifact should contain '${id}'`);
  return view;
}

function glyphExtents(glyph) {
  const radians = glyph.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = Math.max(1.8, glyph.sizeX / 2);
  const halfHeight = Math.max(1.8, glyph.sizeY / 2);
  return {
    x: cos * halfWidth + sin * halfHeight,
    y: sin * halfWidth + cos * halfHeight,
  };
}

function glyphBounds(glyphs) {
  return glyphs.reduce((bounds, glyph) => {
    const extent = glyphExtents(glyph);
    return {
      minX: Math.min(bounds.minX, glyph.x - extent.x),
      maxX: Math.max(bounds.maxX, glyph.x + extent.x),
      minY: Math.min(bounds.minY, glyph.y - extent.y),
      maxY: Math.max(bounds.maxY, glyph.y + extent.y),
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function uniqueScreenSamples(glyphs) {
  const counts = new Map();
  for (const glyph of glyphs) {
    const key = `${glyph.x},${glyph.y}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const unique = glyphs.filter((glyph) => counts.get(`${glyph.x},${glyph.y}`) === 1);
  assert.ok(unique.length >= 3, 'view should expose at least three uniquely addressable glyph centres');
  return [unique[0], unique[Math.floor(unique.length / 2)], unique[unique.length - 1]];
}

test('resolved artifact is deterministic and byte-current', () => {
  const first = serializeArtifact(buildArtifact());
  const second = serializeArtifact(buildArtifact());
  assert.equal(first, second);
  assert.equal(fs.readFileSync(ARTIFACT_PATH, 'utf8'), first,
    'run npm run pixel-views:export after changing the model, resolver, or view settings');
});

test('artifact is resolved from all authored Titanic pixel-map views', () => {
  const artifact = buildArtifact();
  assert.equal(artifact.schemaVersion, 4);
  assert.equal(artifact.modelPixelCount, 964);
  assert.deepEqual(artifact.views.map((view) => view.id),
    ['top_down', 'front', 'strands', 'te_sign']);

  for (const [id, contract] of VIEW_CONTRACTS) {
    const view = findView(artifact, id);
    assert.equal(view.pixelCount, contract.pixelCount);
    assert.equal(countGlyphs(view), contract.pixelCount);
    assert.equal(view.axisX, contract.axisX, `${id} horizontal engine axis`);
    assert.equal(view.axisY, contract.axisY, `${id} vertical engine axis`);
    assert.ok(view.paintPixelCount >= view.pixelCount);
    assert.equal(view.paintPixelIndices.length, view.paintPixelCount);
    const identities = view.panels.flatMap((panel) =>
      panel.glyphs.map((glyph) => glyph.pixelIndex));
    assert.equal(new Set(identities).size, identities.length,
      `${id} must preserve one unique engine pixel identity per glyph`);
  }

  const top = findView(artifact, 'top_down');
  const authoredTop = yaml.load(fs.readFileSync(PIXEL_MAP_PATH, 'utf8')).views
    .find((view) => view.id === 'top_down');
  assert.deepEqual(top.framing, authoredTop.framing,
    'resolved artifact must carry the authored Top-Down framing unchanged');
  assert.equal(new Set(top.panels[0].glyphs.map((glyph) => glyph.group)).size, 18);
  assert.ok(top.panels[0].glyphs.every((glyph) =>
    glyph.fixtureType !== 'TeSignV3A40' && glyph.fixtureType !== 'TeSignV3B34'));
  assert.ok(top.panels[0].glyphs.every((glyph) => glyph.fixtureType !== 'VintageLed'));
  for (const group of ['Left Auditorium', 'Right Auditorium']) {
    assert.equal(top.panels[0].glyphs.filter((glyph) => glyph.group === group).length, 8,
      `${group} must contribute all eight uplights to Top-Down`);
  }

  const front = findView(artifact, 'front');
  assert.equal(front.paintPixelCount, 792,
    'Front brush mask must include the corresponding Back surface pixels');
  assert.ok(front.paintPixelIndices.some((index) => titanicPixels[index].group === 'Left Back Wall'));
  assert.ok(front.paintPixelIndices.some((index) => titanicPixels[index].group === 'Right Back Wall'));
  const upwash = front.panels.flatMap((panel) => panel.glyphs)
    .filter((glyph) => glyph.effect === 'upwash');
  assert.equal(upwash.length, 8);
  assert.deepEqual(new Set(upwash.map((glyph) => glyph.rotation)), new Set([-30, 33]));
});

function correlation(a, b) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0, varianceA = 0, varianceB = 0;
  for (let index = 0; index < a.length; index++) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    numerator += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return numerator / Math.sqrt(varianceA * varianceB);
}

test('Live display orientation preserves authoritative 3D axes beneath authored offsets', () => {
  const artifact = buildArtifact();
  const authoredViews = yaml.load(fs.readFileSync(PIXEL_MAP_PATH, 'utf8')).views;
  const removeOffsets = (glyphs, viewId) => {
    const view = authoredViews.find((candidate) => candidate.id === viewId);
    assert.ok(view, `authored view '${viewId}' must exist`);
    return glyphs.map((glyph) => {
      const offset = view.offsets?.[glyph.fixtureKey];
      return {
        ...glyph,
        x: glyph.x - (offset?.dx ?? 0),
        y: glyph.y - (offset?.dy ?? 0),
      };
    });
  };

  const topGlyphs = findView(artifact, 'top_down').panels[0].glyphs;
  assert.ok(topGlyphs.some((glyph) => {
    const offset = authoredViews.find((view) => view.id === 'top_down')
      .offsets?.[glyph.fixtureKey];
    return (offset?.dx ?? 0) !== 0 || (offset?.dy ?? 0) !== 0;
  }), 'the test must exercise the operator-authored offset feature');
  const top = removeOffsets(topGlyphs, 'top_down');
  assert.ok(correlation(top.map((glyph) => glyph.x), top.map((glyph) => glyph.world.nx)) > 0.999);
  assert.ok(correlation(top.map((glyph) => glyph.y), top.map((glyph) => glyph.world.nz)) > 0.999,
    'Aerial-facing +Z/front must be consistently down-screen on both hulls');

  for (const panel of findView(artifact, 'front').panels) {
    const glyphs = removeOffsets(panel.glyphs, 'front');
    assert.ok(correlation(glyphs.map((glyph) => glyph.x),
      glyphs.map((glyph) => glyph.world.nx)) > 0.998);
    assert.ok(correlation(glyphs.map((glyph) => glyph.y),
      glyphs.map((glyph) => glyph.world.ny)) < -0.995);
  }

  for (const panel of findView(artifact, 'te_sign').panels) {
    assert.ok(Math.abs(correlation(panel.glyphs.map((glyph) => glyph.x),
      panel.glyphs.map((glyph) => glyph.world.nz))) > 0.999);
    assert.ok(correlation(panel.glyphs.map((glyph) => glyph.y),
      panel.glyphs.map((glyph) => glyph.world.ny)) < -0.999);
  }
});

test('Live Touch serializes the exact simulator-resolved glyph geometry', () => {
  const artifact = buildArtifact();
  const viewDefs = createViewsContainer(
    yaml.load(fs.readFileSync(PIXEL_MAP_PATH, 'utf8'))).views;
  const viewRegistry = createViewRegistry(
    yaml.load(fs.readFileSync(VIEW_REGISTRY_PATH, 'utf8')).views);
  const batchList = buildBatchList(titanicPixels);
  const clusters = buildClusters(batchList);

  for (const viewDef of viewDefs) {
    const exported = findView(artifact, viewDef.id);
    const resolved = resolveView(viewDef, clusters, batchList, { viewRegistry });
    assert.equal(exported.panels.length, resolved.panels.length);
    for (let panelIndex = 0; panelIndex < resolved.panels.length; panelIndex++) {
      const panel = resolved.panels[panelIndex];
      const placements = seedPanel(panel.def, panel.clusters, batchList,
        DEFAULT_CANVAS.w, DEFAULT_CANVAS.h, panel.styles);
      for (const cluster of panel.clusters) {
        const saved = panel.placements.get(cluster.fixKey);
        if (saved) placements.set(cluster.fixKey, { ...saved });
      }
      const simulator = expandPanel(panel.def, panel.clusters, batchList,
        placements, panel.styles, viewDef.offsets);
      const live = exported.panels[panelIndex].glyphs;
      assert.equal(live.length, simulator.length);
      for (let index = 0; index < simulator.length; index++) {
        assert.equal(live[index].pixelIndex, simulator[index].gi);
        assert.equal(live[index].x, simulator[index].cx,
          `${viewDef.id}/${panel.def.id} pixel ${simulator[index].gi} x`);
        assert.equal(live[index].y, simulator[index].cy,
          `${viewDef.id}/${panel.def.id} pixel ${simulator[index].gi} y`);
        assert.equal(live[index].sizeX, simulator[index].sizeX);
        assert.equal(live[index].sizeY, simulator[index].sizeY);
        assert.equal(live[index].rotation, simulator[index].rot);
      }
    }
  }
});

test('runtime projection preserves identities and fits every view to the centered Live viewport', () => {
  const artifact = runtime.validateArtifact(buildArtifact());
  const width = 733;
  const height = 411;
  for (const view of artifact.views) {
    const first = runtime.reprojectView(view, artifact.design, width, height);
    const second = runtime.reprojectView(view, artifact.design, width, height);
    assert.deepEqual(second, first, `${view.id} projection must be deterministic`);
    assert.equal(first.length, view.pixelCount);
    assert.deepEqual(first.map((glyph) => glyph.pixelIndex).sort((a, b) => a - b),
      view.panels.flatMap((panel) => panel.glyphs.map((glyph) => glyph.pixelIndex))
        .sort((a, b) => a - b));
    for (const glyph of first) {
      assert.ok(Number.isFinite(glyph.x));
      assert.ok(Number.isFinite(glyph.y));
      assert.ok(Number.isFinite(glyph.sizeX));
      assert.ok(Number.isFinite(glyph.sizeY));
    }

    const bounds = glyphBounds(first);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const fillX = (bounds.maxX - bounds.minX) / width;
    const fillY = (bounds.maxY - bounds.minY) / height;
    assert.ok(Math.abs(centerX - width / 2) < 1,
      `${view.id} visible glyph bounds must be horizontally centered (got ${centerX})`);
    assert.ok(Math.abs(centerY - height / 2) < 1,
      `${view.id} visible glyph bounds must be vertically centered (got ${centerY})`);
    assert.ok(Math.max(fillX, fillY) >= 0.90 && Math.max(fillX, fillY) <= 0.921,
      `${view.id} must fit about 92% of the Live viewport (got ${fillX}, ${fillY})`);
    assert.ok(fillX <= 0.921 && fillY <= 0.921,
      `${view.id} must not clip visible glyph extents (got ${fillX}, ${fillY})`);
  }
});

test('pan is display-only and pure screen mapping preserves pixel identity and view axes', () => {
  assert.equal(typeof runtime.screenPointToTarget, 'function',
    'runtime must export screenPointToTarget(screenGlyphs, view, x, y)');
  const artifact = runtime.validateArtifact(buildArtifact());
  const width = 733;
  const height = 411;
  const panX = 47;
  const panY = -31;

  for (const view of artifact.views) {
    const base = runtime.reprojectView(view, artifact.design, width, height);
    const shifted = runtime.reprojectView(view, artifact.design, width, height, panX, panY);
    assert.equal(shifted.length, base.length);
    for (let index = 0; index < base.length; index++) {
      assert.equal(shifted[index].pixelIndex, base[index].pixelIndex);
      assert.equal(shifted[index].world, base[index].world,
        `${view.id} pan must retain the canonical world object`);
      assert.ok(Math.abs(shifted[index].x - base[index].x - panX) < 1e-9);
      assert.ok(Math.abs(shifted[index].y - base[index].y - panY) < 1e-9);
    }

    for (const glyph of uniqueScreenSamples(shifted)) {
      const target = runtime.screenPointToTarget(shifted, view, glyph.x, glyph.y);
      assert.equal(target.pixelIndex, glyph.pixelIndex);
      assert.equal(target.axisX, view.axisX);
      assert.equal(target.axisY, view.axisY);
      assert.equal(target.targetX, glyph.world[view.axisX]);
      assert.equal(target.targetY, glyph.world[view.axisY],
        `${view.id} must map the displayed glyph back to its canonical engine target`);
    }
  }
});

test('zoom is display-only, bounded, and keeps its finger anchor fixed', () => {
  const artifact = runtime.validateArtifact(buildArtifact());
  const view = findView(artifact, 'top_down');
  const width = 733;
  const height = 411;
  const base = runtime.reprojectView(view, artifact.design, width, height, 0, 0, 1);
  const zoomed = runtime.reprojectView(view, artifact.design, width, height, 0, 0, 2);
  assert.equal(zoomed.length, base.length);
  for (let index = 0; index < base.length; index++) {
    assert.equal(zoomed[index].pixelIndex, base[index].pixelIndex);
    assert.equal(zoomed[index].world, base[index].world);
    assert.ok(Math.abs((zoomed[index].x - width / 2) -
      (base[index].x - width / 2) * 2) < 1e-9);
    assert.ok(Math.abs((zoomed[index].y - height / 2) -
      (base[index].y - height / 2) * 2) < 1e-9);
    assert.ok(Math.abs(zoomed[index].sizeX - base[index].sizeX * 2) < 1e-9);
    assert.ok(Math.abs(zoomed[index].sizeY - base[index].sizeY * 2) < 1e-9);
  }

  const start = { zoom: 1.25, panX: 31, panY: -17 };
  const anchor = { x: 608, y: 93 };
  const next = runtime.zoomAroundPoint(
    start.zoom, start.panX, start.panY, 2.5,
    anchor.x, anchor.y, width, height,
  );
  const modelX = (anchor.x - width / 2 - start.panX) / start.zoom;
  const modelY = (anchor.y - height / 2 - start.panY) / start.zoom;
  assert.ok(Math.abs(width / 2 + modelX * next.zoom + next.panX - anchor.x) < 1e-9);
  assert.ok(Math.abs(height / 2 + modelY * next.zoom + next.panY - anchor.y) < 1e-9);
  assert.equal(runtime.clampZoom(0.01), 0.5);
  assert.equal(runtime.clampZoom(99), 4);
});

test('runtime refuses malformed identities and tampered resolved geometry', async () => {
  const invalidIdentity = structuredClone(buildArtifact());
  invalidIdentity.views[0].panels[0].glyphs[0].pixelIndex = invalidIdentity.modelPixelCount;
  assert.throws(() => runtime.validateArtifact(invalidIdentity), /invalid pixel identity/);

  const tamperedGeometry = structuredClone(buildArtifact());
  tamperedGeometry.views[0].panels[0].glyphs[0].x += 1;
  await assert.rejects(runtime.verifyResolvedFingerprint(tamperedGeometry),
    /resolved geometry fingerprint/);

  const tamperedAxes = structuredClone(buildArtifact());
  tamperedAxes.views.find((view) => view.id === 'front').axisY = 'nz';
  assert.throws(() => runtime.validateArtifact(tamperedAxes), /canonical axis pair/);
});

test('brush preview uses the engine spatial ellipse and swept-segment contract', () => {
  const glyphs = [
    { pixelIndex: 0, world: { nx: 0.5, nz: 0.5 } },
    { pixelIndex: 1, world: { nx: 0.59, nz: 0.5 } },
    { pixelIndex: 2, world: { nx: 0.5, nz: 0.69 } },
    { pixelIndex: 3, world: { nx: 0.8, nz: 0.5 } },
  ];
  assert.deepEqual(runtime.affectedPixelIndices(
    glyphs,
    {
      axisX: 'nx', axisY: 'nz', targetX: 0.5, targetY: 0.5,
      radius: 0.1, radiusY: 0.2,
    },
  ), new Set([0, 1, 2]));

  assert.deepEqual(runtime.affectedPixelIndices(
    glyphs,
    {
      axisX: 'nx', axisY: 'nz', targetX: 0.8, targetY: 0.5,
      radius: 0.05, radiusY: 0.05, prevX: 0.5, prevY: 0.5,
    },
  ), new Set([0, 1, 3]), 'the preview includes pixels swept between samples');
});

test('preview and engine select the same visible pixels while Front also mirrors Back', () => {
  const artifact = runtime.validateArtifact(buildArtifact());
  for (const view of artifact.views) {
    const glyphs = view.panels.flatMap((panel) => panel.glyphs);
    const target = glyphs[Math.floor(glyphs.length * 0.62)];
    const previous = glyphs[Math.floor(glyphs.length * 0.38)];
    const options = {
      axisX: view.axisX,
      axisY: view.axisY,
      targetX: target.world[view.axisX],
      targetY: target.world[view.axisY],
      prevX: previous.world[view.axisX],
      prevY: previous.world[view.axisY],
      radius: 0.055,
      radiusY: 0.07,
    };
    const preview = runtime.affectedPixelIndices(glyphs, options);
    const pixels = titanicPixels.map((pixel) => ({
      ...pixel, r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
    }));
    const heat = new Float32Array(pixels.length);
    const pixelMask = new Uint8Array(pixels.length);
    for (const pixelIndex of view.paintPixelIndices) pixelMask[pixelIndex] = 1;
    applySpatialPaint({
      pixels, heat, pixelMask,
      ...options,
      amount: 1,
      touch: true,
      mode: 'trail',
      color6: [1, 1, 1, 0, 0, 0],
      fadeStep: 0,
    });
    const engine = new Set();
    heat.forEach((value, index) => { if (value > 0) engine.add(index); });
    const visibleEngine = new Set([...engine].filter((index) =>
      glyphs.some((glyph) => glyph.pixelIndex === index)));
    assert.deepEqual(visibleEngine, preview, `${view.id} visible preview must equal engine selection`);
    if (view.id === 'front') {
      assert.ok([...engine].some((index) => / Back |Back_/.test(titanicPixels[index].group)),
        'Front stroke must also reach the corresponding hidden Back surface');
    } else {
      assert.deepEqual(engine, preview, `${view.id} must not paint hidden pixels`);
    }
  }
});

test('TE Sign XS brush remains a local circle instead of selecting a full LED row', () => {
  const artifact = runtime.validateArtifact(buildArtifact());
  const view = findView(artifact, 'te_sign');
  const width = 733;
  const height = 411;
  const glyphs = runtime.reprojectView(view, artifact.design, width, height);
  const panelGlyphs = glyphs.filter((glyph) => glyph.panelId === view.panels[0].id);
  const target = panelGlyphs[Math.floor(panelGlyphs.length / 2)];
  const range = (values) => Math.max(...values) - Math.min(...values);
  const radiusPx = (0.02 + 0.05 * 0.30) * width;
  const radius = radiusPx * range(panelGlyphs.map((glyph) => glyph.world.nz)) /
    range(panelGlyphs.map((glyph) => glyph.x));
  const radiusY = radiusPx * range(panelGlyphs.map((glyph) => glyph.world.ny)) /
    range(panelGlyphs.map((glyph) => glyph.y));
  const selected = runtime.affectedPixelIndices(glyphs, {
    axisX: 'nz', axisY: 'ny', targetX: target.world.nz, targetY: target.world.ny,
    radius, radiusY,
  });
  const selectedGlyphs = glyphs.filter((glyph) => selected.has(glyph.pixelIndex));

  assert.ok(selectedGlyphs.length >= 1 && selectedGlyphs.length <= 9,
    `XS should select only a local handful of sign LEDs (got ${selectedGlyphs.length})`);
  assert.deepEqual(new Set(selectedGlyphs.map((glyph) => glyph.panelId)),
    new Set([target.panelId]), 'a local sign brush must not spill into another sign panel');
  for (const glyph of selectedGlyphs) {
    assert.ok(Math.hypot(glyph.x - target.x, glyph.y - target.y) < radiusPx + 0.001,
      `pixel ${glyph.pixelIndex} must be inside the visible brush circle`);
  }
});

test('topology fingerprint pins pixel order, identity, and coordinates', () => {
  const artifact = buildArtifact();
  assert.equal(topologyFingerprint(titanicPixels), artifact.source.modelFingerprint);

  const changed = titanicPixels.map((pixel) => ({ ...pixel }));
  changed[0].nx += 0.0001;
  assert.notEqual(topologyFingerprint(changed), artifact.source.modelFingerprint);

  const reordered = titanicPixels.map((pixel) => ({ ...pixel }));
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => topologyFingerprint(reordered), /identity\/order mismatch/);
});

test('runtime topology fingerprint matches the exporter implementation', async () => {
  const expected = topologyFingerprint(titanicPixels);
  const actual = await runtime.topologyFingerprint(titanicPixels);
  assert.equal(actual, expected);
});

test('artifact source fingerprint pins current pixel_map_views.yaml bytes', () => {
  const artifact = buildArtifact();
  const sourcePath = path.join(REPO_ROOT, artifact.source.pixelMapViewsPath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const fingerprint = crypto.createHash('sha256')
    .update(source.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
  assert.equal(fingerprint, artifact.source.viewsFingerprint);
});

test('artifact source fingerprint pins the authoritative Aerial camera orientation', () => {
  const artifact = buildArtifact();
  const sourcePath = path.join(REPO_ROOT, artifact.source.camerasPath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const fingerprint = crypto.createHash('sha256')
    .update(source.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
  assert.equal(fingerprint, artifact.source.camerasFingerprint);
  assert.match(source, /name:\s*Aerial[\s\S]*?position:[\s\S]*?z:\s*80\.146/,
    'Aerial camera remains on the +Z/front side that defines down-screen');
});

test('Live Touch contains no baked pixel geometry and loads verifier before use', () => {
  const html = fs.readFileSync(PANEL_PATH, 'utf8');
  assert.doesNotMatch(html, /\bPIXMAP(?:_WORLD|_GROUPS|_W|_H)?\b/);
  assert.doesNotMatch(html, /padChartGroups/);
  const loader = html.indexOf('<script src="touch_control_pixel_views.js"></script>');
  const mount = html.indexOf('window.TouchPixelViews.mount({');
  assert.ok(loader >= 0 && mount > loader);
  assert.match(html, /id="pixelMapError" role="alert"/);
});
