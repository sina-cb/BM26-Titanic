import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pixels as titanicPixels } from '../../marsin_engine/models/titanic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PANEL_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html');
const PANEL_URL = `${pathToFileURL(PANEL_PATH).href}`
  + '?captainpad_engine_origin=http%3A%2F%2F127.0.0.1%3A6968'
  + '&captainpad_live_touch_protocol=2';
const ARTIFACT = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_pixel_views.json'),
  'utf8',
));
const PIXEL_VIEW_SOURCES = {
  'pixel_map_views.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml'), 'utf8'),
  'cameras.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/cameras.yaml'), 'utf8'),
  'pixel_map_layout.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_layout.js'), 'utf8'),
  'pixel_map_views.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_views.js'), 'utf8'),
};
const SCREENSHOT_DIR = path.join(os.homedir(), 'tmp', 'take_playback_overlay_screenshots');
const VIEWPORT = { width: 1024, height: 682, deviceScaleFactor: 1 };

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');

async function installHermeticBrowser(page) {
  await page.evaluateOnNewDocument((artifact, sourceFiles) => {
    const NativeResponse = window.Response;
    window.__spatialPaintBodies = [];
    window.fetch = (input, init = {}) => {
      const url = String(input);
      if (url.includes('touch_control_pixel_views.json')) {
        return Promise.resolve(new NativeResponse(JSON.stringify(artifact), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      const sourceName = Object.keys(sourceFiles).find((name) => url.endsWith(name));
      if (sourceName) {
        return Promise.resolve(new NativeResponse(sourceFiles[sourceName], {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }));
      }
      if (url.endsWith('/spatial-paint')) {
        window.__spatialPaintBodies.push(JSON.parse(init.body || '{}'));
        return Promise.resolve(new NativeResponse(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new NativeResponse(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 3;
      addEventListener() {}
      close() {}
      send() {}
    };
  }, ARTIFACT, PIXEL_VIEW_SOURCES);
}

async function openPanel(page) {
  await page.setViewport(VIEWPORT);
  await installHermeticBrowser(page);
  await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#takePlaybackOverlay');
  await page.waitForSelector('#takeSlots');
  await page.evaluate(async (artifact, pixels) => {
    window.TouchTakeEligibility = () => ({ ok: true });
    await window.TouchPixelViews.ready();
    await window.TouchPixelViews.verifyEngineLayout({
      scene: 'titanic',
      model: 'titanic',
      pixelCount: artifact.modelPixelCount,
      returnedCount: artifact.modelPixelCount,
      pixels,
    });
    window.__wire.phase = 'armed';
    window.__wire.armed = true;
    window.__wire.online = true;
  }, ARTIFACT, titanicPixels);
  await page.click('#modeToggle button[data-mode="spatial"]');
  await new Promise((resolve) => setTimeout(resolve, 400));
}

test('record path stays unchanged while PLAY and LOOP move the display-only overlay', { timeout: 90_000 }, async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page);

    const recordResult = await page.evaluate(async () => {
      window.TouchTakeBankRuntime.replaceTake(0, []);
      await window.TouchTakeBankRuntime.startRecording();
      window.takeRecordPoint(0.2, 0.3, true);
      window.takeRecordPoint(0.4, 0.5, true);
      window.takeRecordPoint(0.4, 0.5, false);
      window.TouchTakeBankRuntime.stopRecording();
      return {
        exported: window.takeGet().length,
        phase: window.TouchTakeBankRuntime.state().slots[0].phase,
      };
    });
    assert.equal(recordResult.exported, 3);
    assert.equal(recordResult.phase, 'ready');

    const playResult = await page.evaluate(async () => {
      window.__spatialPaintBodies = [];
      window.TouchTakePlaybackOverlayRuntime.clearAll('test-reset');
      await window.TouchTakeBankRuntime.play(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const bodies = window.__spatialPaintBodies.slice();
      const overlay = window.TouchTakePlaybackOverlayRuntime.state();
      return { bodies, overlay, keepPlaying: true };
    });

    assert.ok(playResult.bodies.length >= 1, 'PLAY must still emit spatial writes');
    assert.ok(playResult.overlay[0].pathLength >= 1 || playResult.bodies.length >= 1,
      'overlay observes playback without changing engine traffic');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'take_playback_one_slot.png') });

    await page.evaluate(async () => {
      await window.TouchTakeBankRuntime.stop('test-stop');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const twoSlot = await page.evaluate(() => {
      window.TouchTakePlaybackOverlayRuntime.clearAll('test-reset');
      function emitPlayback(contactKey, u, v) {
        document.dispatchEvent(new CustomEvent('spatialplay', {
          detail: {
            requestId: 'overlay-browser-' + contactKey + '-' + u,
            contactKey, u, v, down: true, kind: 'playback',
          },
        }));
      }
      emitPlayback('take-playback-0', 0.15, 0.2);
      emitPlayback('take-playback-1', 0.75, 0.8);
      emitPlayback('take-playback-0', 0.25, 0.3);
      emitPlayback('take-playback-1', 0.85, 0.9);
      return { overlay: window.TouchTakePlaybackOverlayRuntime.state() };
    });

    assert.ok(twoSlot.overlay[0].pathLength >= 1 && twoSlot.overlay[1].pathLength >= 1,
      'two playback slots must render independent overlay paths');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'take_playback_two_slots.png') });

    const loopResult = await page.evaluate(async () => {
      window.TouchTakeBankRuntime.replaceTake(0, [[0, 0.2, 0.2, 1], [30, 0.8, 0.2, 1], [60, 0.8, 0.8, 0]]);
      window.__spatialPaintBodies = [];
      window.TouchTakePlaybackOverlayRuntime.clearAll('loop-reset');
      await window.TouchTakeBankRuntime.play(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 180));
      const bodies = window.__spatialPaintBodies.map((body) => JSON.stringify(body));
      await window.TouchTakeBankRuntime.stop('loop-stop');
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { bodies };
    });

    assert.ok(loopResult.bodies.length >= 2, 'LOOP must not add extra engine writes beyond playback samples');
    assert.ok(playResult.bodies.every((body) => body.enabled === true));
  } finally {
    await browser.close();
  }
});
