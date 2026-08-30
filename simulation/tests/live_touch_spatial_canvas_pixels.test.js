/**
 * live_touch_spatial_canvas_pixels.test.js — Live Touch spatial pad must render
 * every mapped physical pixel for the selected Titanic 2D preset, not sparse
 * fixture/group representatives.
 *
 * Root cause (report 20260815_239): multi-panel views (`front`, `te_sign`)
 * letterbox each panel independently in the exporter, but an early consumer
 * flattened all glyphs and fit one bounding box — panels drew on top of each
 * other and read as a sparse cloud (TE Sign's four fixture clusters looked
 * like "four dots"). The fix lives in the shared projection authority
 * (`CaptainPad/shared/pixel_view_projection.js` → `layoutView`) consumed by
 * `CaptainPad/live_touch/touch_control_pixel_views.js`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pixels as titanicPixels } from '../../marsin_engine/models/titanic_normalized.js';
import {
  buildArtifact,
  serializeArtifact,
} from '../tools/export_touch_control_pixel_views.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ARTIFACT_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.json');
const PANEL_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html');
const PANEL_URL = `${pathToFileURL(PANEL_PATH).href}`
  + '?captainpad_engine_origin=http%3A%2F%2F127.0.0.1%3A6968'
  + '&captainpad_live_touch_protocol=2';
const PROJECTION_PATH = path.join(REPO_ROOT, 'CaptainPad/shared/pixel_view_projection.js');
const RUNTIME_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.js');
const RENDER_DIR = path.join(REPO_ROOT, '.agent_renders');
const PIXEL_VIEW_SOURCES = {
  'pixel_map_views.yaml': fs.readFileSync(
    path.join(REPO_ROOT, 'simulation/scenes/titanic_normalized/pixel_map_views.yaml'), 'utf8'),
  'cameras.yaml': fs.readFileSync(
    path.join(REPO_ROOT, 'simulation/scenes/titanic_normalized/cameras.yaml'), 'utf8'),
  'pixel_map_layout.js': fs.readFileSync(
    path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_layout.js'), 'utf8'),
  'pixel_map_views.js': fs.readFileSync(
    path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_views.js'), 'utf8'),
};

const require = createRequire(import.meta.url);
const projection = require(PROJECTION_PATH);
globalThis.DeckPixelProjection = projection;
const runtime = require(RUNTIME_PATH);

/** Authoritative per-view visible pixel counts from the resolver/exporter. */
const VIEW_CONTRACTS = Object.freeze({
  top_down: Object.freeze({
    pixelCount: 964,
    axisX: 'nx',
    axisY: 'nz',
    samples: Object.freeze([
      { pixelIndex: 644, fixtureKey: 'Left_Front_Left', x: 230.74573974745786, y: 316.94352720974416 },
      { pixelIndex: 212, fixtureKey: 'Right Front Wall 4', x: 648.9683484188178, y: 348.4915772712035 },
      { pixelIndex: 643, fixtureKey: 'Right Small SmokeStack 4', x: 798.2473460721868, y: 229.53011509665888 },
    ]),
  }),
  front: Object.freeze({
    pixelCount: 470,
    paintPixelCount: 866,
    axisX: 'nx',
    axisY: 'ny',
    samples: Object.freeze([
      { pixelIndex: 644, fixtureKey: 'Left_Front_Left', x: 30, y: 388.9356696915571 },
      { pixelIndex: 884, fixtureKey: 'Right_Front_Right', x: 870, y: 359.46404341926734 },
      { pixelIndex: 245, fixtureKey: 'Right SmokeStacks 8', x: 530.1492537313433, y: 338.7856173677069 },
    ]),
  }),
  back: Object.freeze({
    pixelCount: 420,
    axisX: 'nx',
    axisY: 'ny',
    samples: Object.freeze([
      { pixelIndex: 286, fixtureKey: 'Left Back Wall 1', x: 707.6535137578807, y: 327.0783281989918 },
      { pixelIndex: 278, fixtureKey: 'Left Auditorium 1', x: 814, y: 295.4465488549013 },
      { pixelIndex: 804, fixtureKey: 'Right_Back_Left', x: 35.902631164329605, y: 297.4936190326138 },
    ]),
  }),
  strands: Object.freeze({
    pixelCount: 320,
    axisX: 'nx',
    axisY: 'nz',
    samples: Object.freeze([
      { pixelIndex: 644, fixtureKey: 'Left_Front_Left', x: 296.99999999999994, y: 252.2844768007833 },
      { pixelIndex: 804, fixtureKey: 'Right_Back_Left', x: 425.18984716228863, y: 157.88015912277518 },
      { pixelIndex: 963, fixtureKey: 'Right_Front_Left', x: 677.8191843428858, y: 269.2804035295799 },
    ]),
  }),
  te_sign: Object.freeze({
    pixelCount: 148,
    axisX: 'nz',
    axisY: 'ny',
    samples: Object.freeze([
      { pixelIndex: 0, fixtureKey: 'TE Sign V3 A', x: 507.44408945686916, y: 340.9664536741214 },
      { pixelIndex: 74, fixtureKey: 'TE Sign 2 V3 A', x: 523.0042575838212, y: 335.3552421500799 },
      { pixelIndex: 147, fixtureKey: 'TE Sign 2 V3 B', x: 336.6577967003725, y: 126.73629590207564 },
    ]),
  }),
});

function findView(artifact, id) {
  const view = artifact.views.find((candidate) => candidate.id === id);
  assert.ok(view, `artifact should contain '${id}'`);
  return view;
}

function glyphBox(glyph) {
  const halfX = Math.max(1.8, glyph.sizeX / 2);
  const halfY = Math.max(1.8, glyph.sizeY / 2);
  return {
    minX: glyph.x - halfX,
    maxX: glyph.x + halfX,
    minY: glyph.y - halfY,
    maxY: glyph.y + halfY,
  };
}

function boxesOverlap(a, b) {
  return !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY);
}

/** Historical broken consumer: one transform for all panels using merged bounds. */
function legacyMergedReproject(view, design, width, height) {
  const glyphs = view.panels.flatMap((panel) => panel.glyphs);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const glyph of glyphs) {
    const box = glyphBox(glyph);
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
  }
  const boxW = Math.max(1e-6, maxX - minX);
  const boxH = Math.max(1e-6, maxY - minY);
  const scale = Math.min(width * projection.FIT_FILL / boxW, height * projection.FIT_FILL / boxH);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return glyphs.map((glyph) => ({
    pixelIndex: glyph.pixelIndex,
    panelId: view.panels.find((panel) => panel.glyphs.some((g) => g.pixelIndex === glyph.pixelIndex)).id,
    x: (glyph.x - centerX) * scale + width / 2,
    y: (glyph.y - centerY) * scale + height / 2,
    sizeX: glyph.sizeX * scale,
    sizeY: glyph.sizeY * scale,
  }));
}

test('artifact freshness and full per-view glyph counts stay pinned to the exporter', () => {
  const artifact = buildArtifact();
  assert.equal(fs.readFileSync(ARTIFACT_PATH, 'utf8'), serializeArtifact(artifact));
  assert.equal(artifact.modelPixelCount, 964);
  assert.deepEqual(artifact.views.map((view) => view.id),
    ['top_down', 'front', 'back', 'strands', 'te_sign']);

  for (const [id, contract] of Object.entries(VIEW_CONTRACTS)) {
    const view = findView(artifact, id);
    const glyphs = view.panels.flatMap((panel) => panel.glyphs);
    assert.equal(view.pixelCount, contract.pixelCount);
    assert.equal(glyphs.length, contract.pixelCount);
    assert.equal(new Set(glyphs.map((glyph) => glyph.pixelIndex)).size, contract.pixelCount);
    assert.equal(view.axisX, contract.axisX);
    assert.equal(view.axisY, contract.axisY);
    if (contract.paintPixelCount) {
      assert.equal(view.paintPixelCount, contract.paintPixelCount);
    } else {
      assert.equal(view.paintPixelCount, contract.pixelCount);
    }
    for (const sample of contract.samples) {
      const glyph = glyphs.find((candidate) => candidate.pixelIndex === sample.pixelIndex);
      assert.ok(glyph, `${id} must expose pixel ${sample.pixelIndex}`);
      assert.equal(glyph.fixtureKey, sample.fixtureKey);
      assert.ok(Math.abs(glyph.x - sample.x) < 1e-9,
        `${id} pixel ${sample.pixelIndex} design x (${glyph.x} vs ${sample.x})`);
      assert.ok(Math.abs(glyph.y - sample.y) < 1e-9,
        `${id} pixel ${sample.pixelIndex} design y (${glyph.y} vs ${sample.y})`);
    }
  }
});

test('layoutView separates multi-panel views so every mapped pixel stays addressable', () => {
  const artifact = buildArtifact();
  const width = 733;
  const height = 411;
  for (const view of artifact.views) {
    const projected = runtime.reprojectView(view, artifact.design, width, height);
    assert.equal(projected.length, view.pixelCount, `${view.id} must reproject every visible pixel`);
    assert.deepEqual(
      [...new Set(projected.map((glyph) => glyph.pixelIndex))].sort((a, b) => a - b),
      view.panels.flatMap((panel) => panel.glyphs.map((glyph) => glyph.pixelIndex)).sort((a, b) => a - b),
    );
    if (view.panels.length === 2) {
      const left = projected.filter((glyph) => glyph.panelId === view.panels[0].id);
      const right = projected.filter((glyph) => glyph.panelId === view.panels[1].id);
      assert.equal(left.length + right.length, view.pixelCount);
      const leftBox = left.reduce((bounds, glyph) => {
        const box = glyphBox(glyph);
        return {
          minX: Math.min(bounds.minX, box.minX),
          maxX: Math.max(bounds.maxX, box.maxX),
          minY: Math.min(bounds.minY, box.minY),
          maxY: Math.max(bounds.maxY, box.maxY),
        };
      }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      const rightBox = right.reduce((bounds, glyph) => {
        const box = glyphBox(glyph);
        return {
          minX: Math.min(bounds.minX, box.minX),
          maxX: Math.max(bounds.maxX, box.maxX),
          minY: Math.min(bounds.minY, box.minY),
          maxY: Math.max(bounds.maxY, box.maxY),
        };
      }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      assert.ok(!boxesOverlap(leftBox, rightBox),
        `${view.id} panels must not stack on top of each other (${JSON.stringify({ leftBox, rightBox })})`);
    }
  }
});

test('legacy merged reprojection overlaps Front panels — the regression we refuse to ship', () => {
  const artifact = buildArtifact();
  const view = findView(artifact, 'front');
  const width = 733;
  const height = 411;
  const fixed = runtime.reprojectView(view, artifact.design, width, height);
  const legacy = legacyMergedReproject(view, artifact.design, width, height);
  assert.equal(fixed.length, 470);
  assert.equal(legacy.length, 470);

  const panelBounds = (panelId, glyphs) => glyphs.filter((glyph) => glyph.panelId === panelId).reduce((bounds, glyph) => {
    const box = glyphBox(glyph);
    return {
      minX: Math.min(bounds.minX, box.minX),
      maxX: Math.max(bounds.maxX, box.maxX),
      minY: Math.min(bounds.minY, box.minY),
      maxY: Math.max(bounds.maxY, box.maxY),
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  const fixedLeft = panelBounds('left', fixed);
  const fixedRight = panelBounds('right', fixed);
  const legacyLeft = panelBounds('left', legacy);
  const legacyRight = panelBounds('right', legacy);

  assert.ok(!boxesOverlap(fixedLeft, fixedRight), 'fixed Front keeps the hull halves apart');
  assert.ok(boxesOverlap(legacyLeft, legacyRight),
    'legacy merged fit stacks Front halves — the sparse-dot failure mode');
});

test('Live Touch panel cache-busts the shared projection authority with the runtime', () => {
  const html = fs.readFileSync(PANEL_PATH, 'utf8');
  assert.match(html, /pixel_view_projection\.js\?v=' \+ Date\.now\(\)/,
    'WKWebView must not reuse a stale projection script missing per-panel layout');
  assert.match(html, /touch_control_pixel_views\.js\?v=' \+ Date\.now\(\)/);
});

test('browser spatial canvas paints every mapped pixel for each Titanic 2D preset', { timeout: 90_000 }, async () => {
  const puppeteer = require('puppeteer');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  fs.mkdirSync(RENDER_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1194, height: 834, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((loadedArtifact, sourceFiles, modelPixels) => {
      window.__spatialCanvasArtifact = loadedArtifact;
      window.fetch = (input) => {
        const url = String(input);
        if (url.includes('touch_control_pixel_views.json')) {
          return Promise.resolve(new Response(JSON.stringify(loadedArtifact), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        const sourceName = Object.keys(sourceFiles).find((name) => url.endsWith(name));
        if (sourceName) {
          return Promise.resolve(new Response(sourceFiles[sourceName], {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }));
        }
        if (url.includes(':6968/model/pixel-layout')) {
          return Promise.resolve(new Response(JSON.stringify({
            scene: 'titanic_normalized',
            model: 'titanic_normalized',
            pixelCount: loadedArtifact.modelPixelCount,
            returnedCount: loadedArtifact.modelPixelCount,
            pixels: modelPixels,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.reject(new Error(`blocked fetch: ${url}`));
      };
    }, artifact, PIXEL_VIEW_SOURCES, titanicPixels);

    await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pixelViewSelect');
    await page.evaluate(async (modelPixels) => {
      await window.TouchPixelViews.ready();
      await window.TouchPixelViews.verifyEngineLayout({
        scene: 'titanic_normalized',
        model: 'titanic_normalized',
        pixelCount: modelPixels.length,
        returnedCount: modelPixels.length,
        pixels: modelPixels,
      });
    }, titanicPixels);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    for (const [viewId, contract] of Object.entries(VIEW_CONTRACTS)) {
      const result = await page.evaluate((id) => {
        window.TouchPixelViews.selectView(id);
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const runtimeView = window.TouchPixelViews.currentViewSpec();
          const pad = document.getElementById('xyPad');
          const canvas = document.getElementById('pixMap');
          const padRect = pad.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;
          const view = window.__spatialCanvasArtifact.views.find((candidate) => candidate.id === id);
          const projected = window.TouchPixelViews.reprojectView(
            view,
            window.__spatialCanvasArtifact.design,
            width,
            height,
          );
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0;
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > 0) painted += 1;
          }
          resolve({
            viewId: runtimeView.viewId,
            paintPixelCount: runtimeView.pixelIndices.length,
            projectedCount: projected.length,
            paintedPixels: painted,
            canvas: { width, height, pixelWidth: canvas.width, pixelHeight: canvas.height },
            pad: { width: padRect.width, height: padRect.height },
            canvasBox: {
              width: canvasRect.width,
              height: canvasRect.height,
            },
          });
        })));
      }, viewId);

      assert.equal(result.viewId, viewId);
      assert.equal(result.projectedCount, contract.pixelCount);
      if (contract.paintPixelCount) {
        assert.equal(result.paintPixelCount, contract.paintPixelCount);
      } else {
        assert.equal(result.paintPixelCount, contract.pixelCount);
      }
      assert.ok(result.canvas.width > 200 && result.canvas.height > 150,
        `${viewId} canvas must be measurable: ${JSON.stringify(result)}`);
      assert.ok(result.paintedPixels > contract.pixelCount * 0.35,
        `${viewId} must paint a dense pixel field, not fixture dots (${JSON.stringify(result)})`);

      const pad = await page.$('#xyPad');
      await pad.screenshot({
        path: path.join(RENDER_DIR, `live_touch_spatial_canvas_${viewId}.png`),
      });
    }
  } finally {
    await browser.close();
  }
});
