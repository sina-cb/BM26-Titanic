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
const PANEL_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control.html');
const ARTIFACT = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'docs/ui/touch_control_pixel_views.json'),
  'utf8',
));
const PIXEL_VIEW_SOURCES = {
  'pixel_map_views.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/pixel_map_views.yaml'), 'utf8'),
  'cameras.yaml': fs.readFileSync(path.join(REPO_ROOT, 'simulation/scenes/titanic/cameras.yaml'), 'utf8'),
  'pixel_map_layout.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_layout.js'), 'utf8'),
  'pixel_map_views.js': fs.readFileSync(path.join(REPO_ROOT, 'simulation/src/gui/pixel_map/pixel_map_views.js'), 'utf8'),
};
const SCREENSHOT_DIR = path.join(os.homedir(), 'tmp', 'live_touch_ui_redesign');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');

const EFFECT_CATALOG = {
  movementTrace: {
    name: 'Movement Trace',
    category: 'movement',
    singleton: true,
    presets: Object.fromEntries([
      'pulse_slow_fade', 'every_other_repeat', 'every_other_reverse',
      'every_other_two_tone', 'one_per_color_repeat', 'one_per_color_reverse',
      'one_per_color_double', 'whole_group_repeat', 'whole_group_reverse',
    ].map((id) => [id, { label: id.replaceAll('_', ' ') }])),
  },
  strobe: { name: 'Strobe', category: 'legacy', singleton: true, presets: { sync_4hz: { label: 'sync 4hz' } } },
  beatPump: { name: 'Beat Pump', category: 'envelope', singleton: true, presets: { soft: { label: 'soft' } } },
  breath: { name: 'Breath', category: 'envelope', singleton: true, presets: { calm: { label: 'calm' } } },
  feedbackTrails: {
    name: 'Feedback Trails',
    category: 'feedback',
    singleton: false,
    presets: { soft_afterimage: { label: 'soft afterimage' }, ghost_ship: { label: 'ghost ship' } },
  },
  waterlineSweep: { name: 'Waterline Sweep', category: 'overlay', singleton: false, presets: { shadow_pass: { label: 'shadow pass' } } },
  freeze: { name: 'Freeze', category: 'time', singleton: true, presets: { hold: { label: 'hold' } } },
};

async function installHermeticBrowser(page) {
  await page.evaluateOnNewDocument((artifact, sourceFiles) => {
    window.__layoutTestErrors = [];
    window.addEventListener('error', (event) => window.__layoutTestErrors.push(event.message));
    window.addEventListener('unhandledrejection', (event) => window.__layoutTestErrors.push(String(event.reason)));
    const NativeResponse = window.Response;
    window.fetch = (input) => {
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
      return Promise.reject(new Error(`Hermetic layout test blocked network request: ${url}`));
    };
    window.__hermeticSockets = [];
    window.WebSocket = class HermeticWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 3;
      constructor(url) {
        this.url = String(url);
        this.listeners = new Map();
        window.__hermeticSockets.push(this);
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
      }
      emit(type, event = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
      close() {}
      send() { throw new Error('Hermetic layout test blocked WebSocket send'); }
    };
  }, ARTIFACT, PIXEL_VIEW_SOURCES);
}

async function openPanel(page, viewport) {
  await page.setViewport(viewport);
  await installHermeticBrowser(page);
  await page.goto(pathToFileURL(PANEL_PATH).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#workspaceScroll .workspace-chip');
  await page.evaluate(async (artifact, pixels) => {
    await window.TouchPixelViews.ready();
    await window.TouchPixelViews.verifyEngineLayout({
      scene: 'titanic',
      model: 'titanic',
      pixelCount: artifact.modelPixelCount,
      returnedCount: artifact.modelPixelCount,
      pixels,
    });
  }, ARTIFACT, titanicPixels);
  const accepted = await page.evaluate((effects) => {
    const detail = { effects };
    document.dispatchEvent(new CustomEvent('fxcatalog', { detail }));
    return detail.accepted === true && !detail.error;
  }, EFFECT_CATALOG);
  assert.equal(accepted, true, 'the production effects renderer should accept the hermetic catalog');
  await page.waitForFunction(() => document.querySelectorAll('#fxGrid .fx-face').length === 16);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

test('Live Touch fits the full professional workspace at iPad landscape and desktop widths', { timeout: 60_000 }, async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'ipad_landscape', width: 1194, height: 834, deviceScaleFactor: 1 },
      { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
    ]) {
      const page = await browser.newPage();
      await openPanel(page, viewport);

      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const faces = [...document.querySelectorAll('#fxGrid .fx-face')];
        const canvas = document.getElementById('pixMap');
        const context = canvas.getContext('2d');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let paintedPixels = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) paintedPixels += 1;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          topbar: rect('.topbar'),
          workspaceBar: rect('#workspaceBar'),
          workspace: rect('.workspace'),
          spatial: rect('.spatial-panel'),
          pad: rect('#xyPad'),
          canvas: rect('#pixMap'),
          chipHeights: [...document.querySelectorAll('#workspaceScroll button.workspace-chip')]
            .map((chip) => chip.getBoundingClientRect().height),
          faceSizes: faces.map((face) => {
            const r = face.getBoundingClientRect();
            return { width: r.width, height: r.height };
          }),
          effectStates: faces.map((face) => ({
            pressed: face.getAttribute('aria-pressed'),
            label: face.getAttribute('aria-label'),
          })),
          paintedPixels,
          pixelViewState: window.TouchPixelViews?.state(),
          panelError: document.getElementById('pixelMapError')?.textContent,
          browserErrors: window.__layoutTestErrors,
          removedControlCount: document.querySelectorAll(
            '#settingsBtn, #reloadPanel, #helpToggle, #statusBtn, #bpmSync, #bpmVal, [data-lock], [data-collapse], #panelRail',
          ).length,
        };
      });

      const audioGeometry = await page.evaluate(async () => {
        const socket = window.__hermeticSockets.find((candidate) => candidate.url.endsWith('/ws/signals'));
        if (!socket) throw new Error('hermetic signal socket was not mounted');
        const strip = document.getElementById('meterStrip');
        const initialRows = [...document.querySelectorAll('#meterBars .sig-row')];
        const waitForPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const snapshots = [];
        const sample = async (name, params) => {
          if (params) socket.emit('message', { data: JSON.stringify({ params }) });
          await waitForPaint();
          const stripRect = strip.getBoundingClientRect();
          const barsRect = document.getElementById('meterBars').getBoundingClientRect();
          const state = document.getElementById('meterState');
          snapshots.push({
            name,
            strip: { y: stripRect.y, height: stripRect.height, bottom: stripRect.bottom },
            bars: { y: barsRect.y, height: barsRect.height, bottom: barsRect.bottom },
            rowHeights: [...document.querySelectorAll('#meterBars .sig-row')]
              .map((row) => row.getBoundingClientRect().height),
            nameWhiteSpace: [...document.querySelectorAll('#meterBars .sig-name')]
              .map((label) => getComputedStyle(label).whiteSpace),
            valueWhiteSpace: [...document.querySelectorAll('#meterBars .sig-val')]
              .map((value) => getComputedStyle(value).whiteSpace),
            stateWhiteSpace: getComputedStyle(state).whiteSpace,
            transitionProperty: getComputedStyle(strip).transitionProperty,
            animationName: getComputedStyle(strip).animationName,
          });
        };
        await sample('waiting', null);
        await sample('low-values', {
          micLow: { value: 0.01 }, micMid: { value: 0.2 }, micHigh: { value: 0.55 },
          micKick: { value: 1 }, micFlux: { value: 0.4 },
          micDomFreq1: { value: 98 }, micDomFreq2: { value: 999 },
          micDomEnergy1: { value: 0.33 }, micDomEnergy2: { value: 0.77 },
        });
        await sample('wide-frequency-values', {
          micLow: { value: 1 }, micMid: { value: 0 }, micHigh: { value: 0.05 },
          micKick: { value: 0.98 }, micFlux: { value: 0.02 },
          micDomFreq1: { value: 10000 }, micDomFreq2: { value: 20000 },
          micDomEnergy1: { value: 1 }, micDomEnergy2: { value: 0 },
        });
        await sample('partial-frame', { micLow: { value: 0.5 }, micDomFreq1: { value: 440 } });
        socket.emit('close');
        await sample('waiting-after-close', null);
        return {
          snapshots,
          rowsStayedMounted: initialRows.every((row, index) => row === document.querySelectorAll('#meterBars .sig-row')[index]),
        };
      });

      await page.addStyleTag({ content: '#wireStatus { display: none !important; }' });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}.png`), fullPage: true });

      assert.ok(layout.topbar.bottom <= layout.workspaceBar.y + 1, `${viewport.name}: workspace bar follows the top bar`);
      assert.ok(layout.workspaceBar.bottom <= layout.workspace.y + 1, `${viewport.name}: panels begin below the workspace bar`);
      assert.ok(layout.documentWidth <= layout.viewport.width + 1, `${viewport.name}: no page-level horizontal clipping`);
      assert.equal(layout.removedControlCount, 0, `${viewport.name}: removed local controls stay absent`);
      assert.ok(layout.chipHeights.every((height) => height >= 44), `${viewport.name}: every actionable workspace chip is at least 44px tall`);
      assert.ok(layout.pad.x >= layout.spatial.x && layout.pad.right <= layout.spatial.right + 1, `${viewport.name}: spatial pad stays inside its panel horizontally`);
      assert.ok(layout.pad.y >= layout.spatial.y && layout.pad.bottom <= layout.spatial.bottom + 1, `${viewport.name}: spatial pad stays inside its panel vertically`);
      assert.ok(layout.canvas.x >= layout.pad.x && layout.canvas.right <= layout.pad.right + 1, `${viewport.name}: ship canvas fits the pad width`);
      assert.ok(layout.canvas.y >= layout.pad.y && layout.canvas.bottom <= layout.pad.bottom + 1, `${viewport.name}: ship canvas fits the pad height`);
      assert.ok(layout.paintedPixels > 100, `${viewport.name}: the fitted 2D ship view is visibly painted (${JSON.stringify({ state: layout.pixelViewState, error: layout.panelError, browserErrors: layout.browserErrors })})`);
      assert.ok(layout.faceSizes.every(({ width, height }) => width >= 44 && height >= 44), `${viewport.name}: effect actions meet the touch target floor`);
      assert.ok(layout.effectStates.every(({ pressed, label }) => pressed === 'false' && label.endsWith('effect off')), `${viewport.name}: effects expose an explicit OFF state`);
      const audioStripHeights = audioGeometry.snapshots.map(({ strip }) => strip.height);
      const audioStripPositions = audioGeometry.snapshots.map(({ strip }) => strip.y);
      assert.equal(new Set(audioStripHeights).size, 1, `${viewport.name}: AUDIO strip height is invariant while signal values stream (${audioStripHeights.join(', ')})`);
      assert.equal(new Set(audioStripPositions).size, 1, `${viewport.name}: AUDIO strip position is invariant while signal values stream (${audioStripPositions.join(', ')})`);
      assert.equal(audioGeometry.rowsStayedMounted, true, `${viewport.name}: signal updates do not remount meter cards`);
      for (const snapshot of audioGeometry.snapshots) {
        assert.equal(new Set(snapshot.rowHeights).size, 1, `${viewport.name}/${snapshot.name}: all meter cards have one fixed height`);
        assert.ok(snapshot.nameWhiteSpace.every((value) => value === 'nowrap'), `${viewport.name}/${snapshot.name}: labels never wrap`);
        assert.ok(snapshot.valueWhiteSpace.every((value) => value === 'nowrap'), `${viewport.name}/${snapshot.name}: values never wrap`);
        assert.equal(snapshot.stateWhiteSpace, 'nowrap', `${viewport.name}/${snapshot.name}: waiting state never wraps`);
        assert.ok(!snapshot.transitionProperty.split(',').map((value) => value.trim()).some((value) => value === 'all' || value === 'height' || value === 'min-height' || value === 'max-height'), `${viewport.name}/${snapshot.name}: strip has no height-changing transition`);
        assert.equal(snapshot.animationName, 'none', `${viewport.name}/${snapshot.name}: strip has no layout animation`);
      }

      await page.click('#fxEditToggle');
      const editState = await page.evaluate(() => ({
        pressed: document.getElementById('fxEditToggle').getAttribute('aria-pressed'),
        pickDisplays: [...document.querySelectorAll('#fxGrid .fx-pick')]
          .map((pick) => getComputedStyle(pick).display),
        pickHeights: [...document.querySelectorAll('#fxGrid .fx-pick')]
          .map((pick) => pick.getBoundingClientRect().height),
      }));
      assert.equal(editState.pressed, 'true', `${viewport.name}: EDIT exposes configuration explicitly`);
      assert.ok(editState.pickDisplays.every((display) => display !== 'none'), `${viewport.name}: effect selectors appear only in EDIT`);
      assert.ok(editState.pickHeights.every((height) => height >= 44), `${viewport.name}: EDIT selectors remain touch-safe`);

      const effectChip = await page.$('#workspaceScroll [data-workspace-panel="effects-panel"]');
      assert.ok(effectChip, `${viewport.name}: effects has a workspace chip`);
      await effectChip.click();
      assert.equal(await page.$eval('.effects-panel', (panel) => panel.classList.contains('is-docked')), true, `${viewport.name}: workspace chip hides without unmounting effects`);
      await page.click('#workspaceScroll [data-workspace-panel="effects-panel"]');
      assert.equal(await page.$eval('.effects-panel', (panel) => panel.classList.contains('is-docked')), false, `${viewport.name}: hidden chip restores the same effects mount`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
});
