import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pixels as titanicPixels } from '../../marsin_engine/models/titanic.js';
import { appendAutoViews } from '../../marsin_engine/lib/view_catalog.js';
import { buildMaskRegistry } from '../../marsin_engine/lib/mask_registry.js';
import { loadModelForGauge } from '../../marsin_engine/lib/model_loader.js';

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
const SCREENSHOT_DIR = path.join(os.homedir(), 'tmp', 'live_touch_stabilization_evidence');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
let groupCatalogPromise;

function groupCatalog() {
  if (groupCatalogPromise) return groupCatalogPromise;
  groupCatalogPromise = loadModelForGauge('titanic').then((model) => {
    appendAutoViews(model.pixels, model.viewMasks, model.groupBits);
    const registry = buildMaskRegistry({
      pixels: model.pixels,
      pixelCount: model.pixelCount,
      groupBits: model.groupBits,
      viewMasks: model.viewMasks,
    });
    const groupCounts = new Map();
    for (const pixel of model.pixels) {
      groupCounts.set(pixel.group, (groupCounts.get(pixel.group) || 0) + 1);
    }
    const namedViews = registry.names().map((name) => {
      const entry = registry.get(name);
      const counts = new Map();
      let memberCount = 0;
      entry.members.forEach((member, index) => {
        if (!member) return;
        memberCount += 1;
        const group = model.pixels[index].group;
        counts.set(group, (counts.get(group) || 0) + 1);
      });
      const groupNames = [];
      const partialGroupNames = [];
      for (const [group, count] of counts) {
        (count === groupCounts.get(group) ? groupNames : partialGroupNames).push(group);
      }
      return {
        name, kind: entry.kind, bit: entry.bit, memberCount,
        groupNames: groupNames.sort(), partialGroupNames: partialGroupNames.sort(),
      };
    });
    return { groups: [...groupCounts.keys()].sort(), namedViews };
  });
  return groupCatalogPromise;
}

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
  kickPunch: { name: 'Kick Punch', category: 'envelope', singleton: true, presets: { punch: { label: 'punch' } } },
};

for (const effect of Object.values(EFFECT_CATALOG)) {
  effect.behaviorTypes = ['toggle'];
  for (const preset of Object.values(effect.presets)) preset.defaultBehavior = 'toggle';
}
EFFECT_CATALOG.kickPunch.behaviorTypes = ['trigger'];
EFFECT_CATALOG.kickPunch.presets.punch.defaultBehavior = 'trigger';
EFFECT_CATALOG.freeze.behaviorTypes = ['hold'];
EFFECT_CATALOG.freeze.presets.hold.defaultBehavior = 'hold';

const CANONICAL_PERFORMANCE_SLOTS = [
  ['movementTrace', 'pulse_slow_fade'],
  ['movementTrace', 'every_other_repeat'],
  ['movementTrace', 'every_other_reverse'],
  ['movementTrace', 'every_other_two_tone'],
  ['movementTrace', 'one_per_color_repeat'],
  ['movementTrace', 'one_per_color_reverse'],
  ['movementTrace', 'one_per_color_double'],
  ['movementTrace', 'whole_group_repeat'],
  ['movementTrace', 'whole_group_reverse'],
  ['strobe', 'sync_4hz'],
  ['beatPump', 'soft'],
  ['breath', 'calm'],
  ['feedbackTrails', 'soft_afterimage'],
  ['feedbackTrails', 'ghost_ship'],
  ['waterlineSweep', 'shadow_pass'],
  ['freeze', 'hold'],
].map(([effectId, presetId], index) => ({
  slotId: index + 9,
  enabled: true,
  label: `${effectId} ${presetId}`,
  effectId,
  presetId,
  behavior: effectId === 'freeze' ? 'hold' : 'toggle',
  paramsOverride: {},
}));

async function installHermeticBrowser(page, nativeEmbed = false, catalog = null) {
  await page.evaluateOnNewDocument((artifact, sourceFiles, native, effects, groupViews, pixels) => {
    window.__layoutTestErrors = [];
    window.addEventListener('error', (event) => window.__layoutTestErrors.push(event.message));
    window.addEventListener('unhandledrejection', (event) => window.__layoutTestErrors.push(String(event.reason)));
    if (native) {
      window.__nativeBridgeMessages = [];
      window.ReactNativeWebView = {
        postMessage(raw) { window.__nativeBridgeMessages.push(JSON.parse(raw)); },
      };
    }
    const NativeResponse = window.Response;
    const response = (body) => Promise.resolve(new NativeResponse(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const cleanLayerState = {
      type: 'layerSettings', active: 'deck', target: 'deck', queued: null, transition: null,
      liveTouch: { armed: false, ownerId: null, ready: false, pattern: null, patternTransition: null, sessionRevision: 0 },
    };
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
      if (url.includes(':6968/')) {
        const path = url.slice(url.indexOf(':6968') + 5);
        if (path === '/status') return response({
          liveTouchProtocolVersion: 2,
          performanceMode: { active: false },
        });
        if (path === '/dimmer-groups' || path === '/dimmers') return response({});
        if (path === '/layers/state') return response(cleanLayerState);
        if (path === '/global-effect-library') return response({ effects });
        if (path === '/global-effect-slots') return response({ slots: [] });
        if (path === '/global-effect-slots/status') return response({ slots: [], controller: {} });
        if (path === '/globals') return response({ effects: {} });
        if (path === '/playlists/ambient') return response({ entries: [
          { id: 'golden-hour', pattern: '00_golden_hour_wash', label: 'Golden Hour Wash' },
          { id: 'blue-hour', pattern: '01_blue_hour', label: 'Blue Hour' },
        ] });
        if (path === '/model/view-selection-options') return response(groupViews || { groups: [], namedViews: [] });
        if (path === '/model/pixel-layout') return response({ scene: 'titanic', model: 'titanic', pixelCount: artifact.modelPixelCount, returnedCount: artifact.modelPixelCount, pixels });
        if (path === '/audio-sources') return response({ sources: [] });
        if (path === '/layers/live_touch/presets') return response({ entries: [] });
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
  }, ARTIFACT, PIXEL_VIEW_SOURCES, nativeEmbed, EFFECT_CATALOG, catalog, titanicPixels);
}

async function openPanel(page, viewport) {
  await page.setViewport(viewport);
  const catalog = await groupCatalog();
  await installHermeticBrowser(page, false, catalog);
  await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded' });
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
  const groupAccepted = await page.evaluate((value) => {
    window.TouchGroupProfiles.install(value);
    return document.getElementById('groupProfileSelect').value === 'instruments';
  }, catalog);
  assert.equal(groupAccepted, true, 'the authoritative Show instruments profile should open by default');
  await page.waitForFunction(() => document.querySelectorAll('#fxGrid .fx-face').length === 16);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function openWorkspacePanel(page, panelKey) {
  await page.evaluate((key) => {
    const chip = document.querySelector(`#workspaceScroll [data-workspace-panel="${key}"]`);
    if (!chip) throw new Error(`workspace chip missing for ${key}`);
    chip.click();
  }, panelKey);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function ensureWorkspacePanelOpen(page, panelKey) {
  await page.evaluate((key) => {
    const chip = document.querySelector(`#workspaceScroll [data-workspace-panel="${key}"]`);
    if (!chip) throw new Error(`workspace chip missing for ${key}`);
    if (chip.classList.contains('is-hidden')) chip.click();
  }, panelKey);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function captureEvidence(page, fileName) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: true });
}

async function captureViewportEvidence(page, fileName) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), captureBeyondViewport: false });
}

async function pointerDownUp(page, selector, holdMs = 0) {
  const element = await page.$(selector);
  assert.ok(element, `pointer target is missing: ${selector}`);
  await element.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
  const box = await element.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `pointer target is not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
  await page.mouse.up();
}

test('transient refresh failures use calm fail-closed UI and recover without a stale toast', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const failed = await page.evaluate(async () => {
      window.__refreshRecoveryFetch = window.fetch;
      window.fetch = async (input, options) => {
        const url = String(input);
        if (url.endsWith('/status')) {
          return new Response(JSON.stringify({ error: 'temporary test outage' }), { status: 503 });
        }
        return window.__refreshRecoveryFetch(input, options);
      };
      await window.__wire._refresh();
      return {
        available: window.__wire.surfaceAvailable,
        curtainHidden: document.getElementById('liveTouchUnavailable').hidden,
        pill: document.getElementById('wireStatus').textContent,
        error: window.__wire.lastError,
      };
    });
    await captureViewportEvidence(page, 'live_touch_refresh_fail_closed.png');
    const recovered = await page.evaluate(async () => {
      window.fetch = window.__refreshRecoveryFetch;
      delete window.__refreshRecoveryFetch;
      await window.__wire._refresh();
      const recoveredPill = document.getElementById('wireStatus');
      return {
        available: window.__wire.surfaceAvailable,
        curtainHidden: document.getElementById('liveTouchUnavailable').hidden,
        pillAttached: !!recoveredPill && recoveredPill.isConnected,
        error: window.__wire.lastError,
      };
    });
    await captureViewportEvidence(page, 'live_touch_refresh_recovered.png');
    assert.equal(failed.available, false);
    assert.equal(failed.curtainHidden, false);
    assert.match(failed.pill, /ENGINE OFFLINE/);
    assert.equal(failed.error, null);
    assert.doesNotMatch(failed.pill, /503|6000|\/status|\{.*error/i);
    assert.deepEqual(recovered, {
      available: true,
      curtainHidden: true,
      pillAttached: false,
      error: null,
    });
    await page.close();
  } finally {
    await browser.close();
  }
});

test('Live Touch fits the full professional workspace at iPad landscape and desktop widths', { timeout: 60_000 }, async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'ipad_1024_landscape', width: 1024, height: 682, deviceScaleFactor: 1 },
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
            const cell = face.closest('.fx-cell').getBoundingClientRect();
            const name = face.querySelector('.fx-name').getBoundingClientRect();
            const preset = face.querySelector('.fx-preset').getBoundingClientRect();
            const family = face.querySelector('.fx-family').getBoundingClientRect();
            const state = face.querySelector('.fx-state').getBoundingClientRect();
            return {
              width: r.width, height: r.height,
              contained: r.x >= cell.x - 1 && r.right <= cell.right + 1
                && r.y >= cell.y - 1 && r.bottom <= cell.bottom + 1,
              textContained: [name, preset, family, state].every((child) =>
                (child.width === 0 && child.height === 0)
                || (child.x >= cell.x - 1 && child.right <= cell.right + 1
                  && child.y >= cell.y - 1 && child.bottom <= cell.bottom + 1)),
            };
          }),
          effectStates: faces.map((face) => ({
            pressed: face.getAttribute('aria-pressed'),
            label: face.getAttribute('aria-label'),
          })),
          groups: (() => {
            const panel = document.querySelector('.groups-panel').getBoundingClientRect();
            const toolbar = document.querySelector('.groups-toolbar').getBoundingClientRect();
            const select = document.getElementById('groupProfileSelect');
            const strips = [...document.querySelectorAll('#groupProfileGrid .profile-view-strip')];
            return {
              selectedId: select.value,
              selectedLabel: select.options[select.selectedIndex]?.textContent,
              toolbarHeight: toolbar.height,
              toolbarContained: toolbar.x >= panel.x - 1 && toolbar.right <= panel.right + 1,
              stripCount: strips.length,
              stripWidths: strips.map((strip) => strip.getBoundingClientRect().width),
              sliders: strips.map((strip) => {
                const slider = strip.querySelector('[role=slider]').getBoundingClientRect();
                return { width: slider.width, height: slider.height };
              }),
            };
          })(),
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
      const evidenceName = viewport.name === 'ipad_1024_landscape'
        ? 'native_ipad_landscape_header_pattern_arm_spatial_colors_effects_groups_audio_presets.png'
        : (viewport.name === 'desktop'
          ? 'web_desktop_full_live_touch_instrument.png'
          : 'ipad_landscape_full_live_touch_instrument.png');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, evidenceName), fullPage: true });

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
      assert.ok(layout.faceSizes.every(({ contained, textContained }) => contained && textContained), `${viewport.name}: effect actions and their labels stay contained by uniform cards`);
      assert.ok(layout.effectStates.every(({ pressed, label }) => pressed === 'false' && label.endsWith('effect off')), `${viewport.name}: effects expose an explicit OFF state`);
      assert.equal(layout.groups.selectedId, 'instruments', `${viewport.name}: Groups opens on the authoritative instruments profile`);
      assert.match(layout.groups.selectedLabel, /^Show instruments\b/, `${viewport.name}: Groups identifies the default profile truthfully`);
      assert.equal(layout.groups.stripCount, 5, `${viewport.name}: Show instruments renders its five authored views`);
      assert.ok(layout.groups.toolbarHeight >= 44 && layout.groups.toolbarContained, `${viewport.name}: Groups toolbar is touch-safe and contained`);
      assert.ok(layout.groups.stripWidths.every((width) => width >= 72), `${viewport.name}: profile controls keep readable width`);
      assert.ok(layout.groups.sliders.every(({ width, height }) => width >= 44 && height >= 44), `${viewport.name}: every profile slider has a visible touch target (${JSON.stringify(layout.groups.sliders)})`);
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

      await page.click('#fxGrid .fx-face');
      const disarmedEffect = await page.$eval('#fxGrid .fx-cell', (cell) => ({
        on: cell.classList.contains('is-on'),
        pending: cell.classList.contains('is-pending'),
      }));
      assert.deepEqual(disarmedEffect, { on: false, pending: false },
        `${viewport.name}: a disarmed action never fakes pending or active engine state`);

      await page.evaluate(() => document.dispatchEvent(new CustomEvent('performancemode', {
        detail: { active: false },
      })));
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

      const behaviorProjection = await page.evaluate(() => {
        const cell = document.querySelector('#fxGrid .fx-cell');
        const select = cell.querySelector('.fx-pick');
        const kick = [...select.options].find((option) => option.textContent.includes('Kick Punch'));
        if (!kick) return null;
        select.value = kick.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return cell.dataset.behavior;
      });
      assert.equal(behaviorProjection, 'trigger', `${viewport.name}: preset-authored trigger behavior reaches the real action cell`);

      await page.evaluate(() => document.dispatchEvent(new CustomEvent('performancemode', {
        detail: { active: true },
      })));
      const performanceState = await page.evaluate(() => ({
        editHidden: document.getElementById('fxEditToggle').hidden,
        editing: document.querySelector('.effects-panel').classList.contains('is-editing'),
        pickDisplays: [...document.querySelectorAll('#fxGrid .fx-pick')]
          .map((pick) => getComputedStyle(pick).display),
        actionCount: document.querySelectorAll('#fxGrid .fx-face').length,
      }));
      assert.equal(performanceState.editHidden, true, `${viewport.name}: Performance hides effect configuration`);
      assert.equal(performanceState.editing, false, `${viewport.name}: Performance closes Edit immediately`);
      assert.ok(performanceState.pickDisplays.every((display) => display === 'none'), `${viewport.name}: Performance is action-only`);
      assert.equal(performanceState.actionCount, 16, `${viewport.name}: Performance keeps every action target mounted`);

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

test('native TAKE records and replays acknowledged endpoint frames with atomic clear', { timeout: 45_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 682, deviceScaleFactor: 1 });
    await installHermeticBrowser(page, true, await groupCatalog());
    await page.goto(`${PANEL_URL}&captainpad_embed=native`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const keys = ['text','background','tint','icon','surface','surfaceContainerLow','surfaceContainerLowest','surfaceContainerHigh','primary','onPrimary','secondary','tertiary','error','ghostBorder','ambientShadow'];
      const palette = Object.fromEntries(keys.map((key) => [key, '#282828']));
      Object.assign(palette, { text:'#ebdbb2', tint:'#fabd2f', icon:'#928374', surfaceContainerLow:'#32302f', surfaceContainerLowest:'#1d2021', surfaceContainerHigh:'#3c3836', primary:'#fabd2f', onPrimary:'#282828', secondary:'#a89984', tertiary:'#b8bb26', error:'#fb4934', ghostBorder:'rgba(168,153,132,.25)', ambientShadow:'rgba(0,0,0,.55)' });
      window.__captainpadDeliver({ type:'captainpad-theme', version:1, requestId:'take-theme', themeId:'gruvbox', resolvedThemeId:'gruvbox', scheme:'dark', palette });
    });
    await page.waitForFunction(() => window.TouchTake && window.TouchTakeBankRuntime && window.__wire
      && window.TouchPixelViews?.state().readyStatus === 'fulfilled');
    await page.evaluate(async (artifact, pixels) => {
      await window.TouchPixelViews.verifyEngineLayout({ scene: 'titanic', model: 'titanic',
        pixelCount: artifact.modelPixelCount, returnedCount: artifact.modelPixelCount, pixels });
      window.__takeRequests = [];
      window.__takeHoldLift = false;
      window.__takeReleaseLift = null;
    }, ARTIFACT, titanicPixels);
    const eligibilityReasons = await page.evaluate(() => {
      window.__wire.phase = 'armed'; window.__wire.armed = true; window.__wire.online = true;
      const lease = window.TouchTakeEligibility('PLAY');
      window.__wire.online = false;
      const offline = window.TouchTakeEligibility('PLAY');
      return { lease, offline };
    });
    assert.match(eligibilityReasons.lease.reason, /lease is not confirmed/);
    assert.match(eligibilityReasons.offline.reason, /connection is offline/);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('touchtransportstate')));
    assert.equal(await page.$eval('#recModes button[data-rec="arm"]', (button) => button.disabled), true,
      'transport event repaints TAKE as disabled after reconnect or lease loss');
    await page.evaluate(() => {
      window.__takeBaseFetch = window.fetch;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path !== '/spatial-paint') return window.__takeBaseFetch(input, options);
        const body = options.body ? JSON.parse(options.body) : null;
        if (path === '/spatial-paint') window.__takeRequests.push(body);
        return new Response('{"status":"ok"}', { status: 200,
          headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.evaluate(() => {
      window.__wire.phase = 'armed'; window.__wire.armed = true; window.__wire.online = true;
      window.TouchTakeEligibility = () => ({ ok: true });
      const arm = document.getElementById('arm');
      arm.classList.add('is-armed'); arm.setAttribute('aria-checked', 'true');
      document.getElementById('armState').textContent = 'ARMED';
      document.getElementById('shell').classList.remove('disarmed');
      window.TouchTake.replace([]);
    });
    await ensureWorkspacePanelOpen(page, 'spatial-panel');
    const takeDisclosure = await page.evaluate(() => ({
      expanded: document.getElementById('takeSummary').getAttribute('aria-expanded'),
      collapsed: document.getElementById('takeBody').classList.contains('is-take-collapsed'),
      status: document.getElementById('takeSummaryVal').textContent,
      sharedRow: Math.abs(
        document.getElementById('takeSummary').getBoundingClientRect().top
        - document.getElementById('brushSummary').getBoundingClientRect().top,
      ) <= 1,
    }));
    assert.deepEqual(takeDisclosure, {
      expanded: 'false', collapsed: true, status: 'S1 · EMPTY', sharedRow: true,
    });
    assert.deepEqual(await page.evaluate(() => ({
      top: document.querySelector('.pad-label.top').textContent,
      bottom: document.querySelector('.pad-label.bottom').textContent,
      left: document.querySelectorAll('.xy-frame .axis-label')[0].textContent,
      right: document.querySelectorAll('.xy-frame .axis-label')[1].textContent,
    })), { top: 'Z+ FRONT', bottom: 'Z− BACK', left: 'X−LEFT', right: 'X+RIGHT' });
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_01_empty.png');
    assert.equal(await page.$eval('#recModes button[data-rec="arm"]', (button) => button.disabled), false);
    const summaryHit = await page.$eval('#takeSummary', (button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: hit?.id, parentId: hit?.parentElement?.id, height: r.height };
    });
    assert.ok(summaryHit.height >= 35 && summaryHit.height <= 38, JSON.stringify(summaryHit));
    assert.ok(summaryHit.id === 'takeSummaryVal' || summaryHit.parentId === 'takeSummary', JSON.stringify(summaryHit));
    await page.$eval('#takeSummary', button => button.click());
    assert.equal(await page.$eval('#takeSummary', button => button.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval('#brushCluster', element => getComputedStyle(element).display), 'none');
    assert.equal(await page.$eval('#recModes button[data-rec="arm"]', (button) => button.disabled), false);
    await page.click('#recModes button[data-rec="arm"]');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const recordState = await page.evaluate(() => window.TouchTake.state());
    assert.equal(recordState.phase, 'recording', JSON.stringify(recordState));
    await page.$eval('#xyPad', (element) => element.scrollIntoView({ block: 'center' }));
    const pad = await page.$eval('#xyPad', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const point = (id, u, v) => ({ id, x: pad.x + pad.width * u, y: pad.y + pad.height * v,
      radiusX: 6, radiusY: 6, force: 1 });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(41, 0.25, 0.35)] });
    await page.waitForFunction(() => window.TouchTake.state().count >= 1);
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_02_recording.png');
    await new Promise((resolve) => setTimeout(resolve, 180));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(41, 0.62, 0.55)] });
    await new Promise((resolve) => setTimeout(resolve, 180));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.TouchSpatialContactGate.state().primary === null);
    await page.$eval('#recModes button[data-rec="arm"]', (button) => button.click());
    await page.waitForFunction(() => window.TouchTake.state().phase === 'ready');
    const recorded = await page.evaluate(() => window.TouchTake.exportTake());
    assert.ok(recorded.length >= 3 && recorded[0][0] === 0 && recorded[0][3] === 1);
    assert.ok(recorded.at(-1)[0] >= 300 && recorded.at(-1)[3] === 0);
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_03_ready.png');
    await page.evaluate(() => { window.__takeRequests = []; });
    await page.$eval('#recModes button[data-rec="play"]', (button) => button.click());
    await page.waitForFunction(() => window.TouchTake.state().phase === 'playing');
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_04_play_once.png');
    await page.waitForFunction(() => window.TouchTake.state().phase === 'ready', { timeout: 5000 });
    const playedFrames = await page.evaluate(() => window.__takeRequests);
    assert.ok(playedFrames.length >= recorded.length);
    assert.equal(playedFrames[0].touch, true);
    assert.equal(playedFrames.at(-1).touch, false);
    await page.evaluate(() => { window.__takeRequests = []; });
    await page.$eval('#recModes button[data-rec="loop"]', (button) => button.click());
    await page.waitForFunction(() => window.TouchTake.state().phase === 'looping');
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_05_looping.png');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const loopState = await page.evaluate(() => window.TouchTake.state());
    assert.ok(loopState.loopCount >= 1, JSON.stringify(loopState));
    const loopFrames = await page.evaluate(() => window.__takeRequests);
    const firstLoopLift = loopFrames.findIndex((frame) => frame.touch === false);
    assert.ok(firstLoopLift >= 0 && loopFrames[firstLoopLift + 1].touch === true,
      'loop waits for a terminal lift before beginning the next contact');
    await page.evaluate(() => {
      window.__takeHoldLift = true;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path !== '/spatial-paint') return window.__takeBaseFetch(input, options);
        const body = options.body ? JSON.parse(options.body) : null;
        if (path === '/spatial-paint') window.__takeRequests.push(body);
        if (path === '/spatial-paint' && body.touch === false && window.__takeHoldLift) {
          return new Promise((resolve) => { window.__takeReleaseLift = () => resolve(new Response(
            '{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } })); });
        }
        return new Response('{"status":"ok"}', { status: 200,
          headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.$eval('#recModes button[data-rec="clear"]', (button) => button.click());
    await page.waitForFunction(() => window.TouchTake.state().phase === 'settling');
    await page.waitForFunction(() => typeof window.__takeReleaseLift === 'function', { timeout: 5000 });
    const clearing = await page.evaluate(() => ({ take: window.TouchTake.exportTake(), label: document.getElementById('recVal').textContent }));
    assert.equal(clearing.take.length, recorded.length, 'CLEAR retains the take until lift acknowledgement');
    assert.match(clearing.label, /CLEARING/);
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_06_clearing.png');
    await page.evaluate(() => { window.__takeHoldLift = false; window.__takeReleaseLift(); });
    await page.waitForFunction(() => window.TouchTake.state().phase === 'empty');
    assert.deepEqual(await page.evaluate(() => window.TouchTake.exportTake()), []);
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_07_cleared.png');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('multi-take bank mixes two slots concurrently with isolated contact keys', { timeout: 45_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 682, deviceScaleFactor: 1 });
    await installHermeticBrowser(page, true, await groupCatalog());
    await page.goto(`${PANEL_URL}&captainpad_embed=native`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.TouchTakeBankRuntime && window.__wire
      && window.TouchPixelViews?.state().readyStatus === 'fulfilled');
    await page.evaluate(async (artifact, pixels) => {
      await window.TouchPixelViews.verifyEngineLayout({ scene: 'titanic', model: 'titanic',
        pixelCount: artifact.modelPixelCount, returnedCount: artifact.modelPixelCount, pixels });
      window.__takeRequests = [];
    }, ARTIFACT, titanicPixels);
    await page.evaluate(() => {
      window.__takeBaseFetch = window.fetch;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path !== '/spatial-paint') return window.__takeBaseFetch(input, options);
        const body = options.body ? JSON.parse(options.body) : null;
        window.__takeRequests.push(body);
        return new Response('{"status":"ok"}', { status: 200,
          headers: { 'Content-Type': 'application/json' } });
      };
      window.__wire.phase = 'armed'; window.__wire.armed = true; window.__wire.online = true;
      window.TouchTakeEligibility = () => ({ ok: true });
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('arm').setAttribute('aria-checked', 'true');
    });
    await ensureWorkspacePanelOpen(page, 'spatial-panel');
    await page.click('#modeToggle button[data-mode="spatial"]');
    await page.$eval('#takeSummary', button => button.click());
    const openDisclosure = await page.evaluate(() => ({
      takeExpanded: document.getElementById('takeSummary').getAttribute('aria-expanded'),
      takeClass: document.getElementById('takeCluster').className,
      brushClass: document.getElementById('brushCluster').className,
      brushDisplay: getComputedStyle(document.getElementById('brushCluster')).display,
      spatialClass: document.querySelector('#modeToggle button[data-mode="spatial"]').className,
      takeDisabled: document.getElementById('takeSummary').disabled,
    }));
    assert.equal(openDisclosure.brushDisplay, 'none',
      `opening TAKE must hide BRUSH so the pad keeps its height: ${JSON.stringify(openDisclosure)}`);
    const transportGeometry = await page.evaluate(() => {
      const host = document.getElementById('recModes').getBoundingClientRect();
      const cluster = document.getElementById('takeCluster').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('#recModes button[data-rec]')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { kind: button.dataset.rec, width: rect.width, height: rect.height };
      });
      const slots = [...document.querySelectorAll('.take-slot')].map((button) =>
        button.getBoundingClientRect().height);
      return { hostWidth: host.width, clusterWidth: cluster.width, buttons, slots };
    });
    assert.ok(transportGeometry.hostWidth >= transportGeometry.clusterWidth - 12,
      `TAKE transport must use the full disclosure width: ${JSON.stringify(transportGeometry)}`);
    assert.ok(transportGeometry.buttons.every((button) => button.width >= 44 && button.height >= 44),
      `TAKE transport buttons must be real 44px targets: ${JSON.stringify(transportGeometry.buttons)}`);
    assert.ok(transportGeometry.slots.every((height) => height >= 44),
      `TAKE slot buttons must be real 44px targets: ${JSON.stringify(transportGeometry.slots)}`);
    assert.equal(await page.$eval('#recModes button[data-rec="play"]', button => button.disabled), true,
      'revealing SPATIAL must preserve the EMPTY take transport gate');
    await page.evaluate(() => {
      window.TouchTakeBankRuntime.replaceTake(0, [[0, 0.1, 0.2, 1], [80, 0.2, 0.3, 0]]);
      window.TouchTakeBankRuntime.replaceTake(1, [[0, 0.7, 0.8, 1], [120, 0.8, 0.9, 0]]);
    });
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_bank_01_ready.png');
    await page.evaluate(async () => {
      window.__takeRequests = [];
      await window.TouchTakeBankRuntime.select(0);
      const first = window.TouchTakeBankRuntime.play(false);
      await window.TouchTakeBankRuntime.select(1);
      const second = window.TouchTakeBankRuntime.play(false);
      await Promise.all([first, second]);
      window.__takeMixPeak = window.TouchTakeBankRuntime.state().playingCount;
    });
    const mixPeak = await page.evaluate(() => window.__takeMixPeak);
    assert.ok(mixPeak >= 2, 'two slots must overlap during concurrent playback');
    await page.waitForFunction(() => window.__takeRequests.length >= 2, { timeout: 5000 });
    await page.waitForFunction(() => window.TouchTakeBankRuntime.state().playingCount === 0, { timeout: 5000 });
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_bank_02_mixing.png');
    const frames = await page.evaluate(() => window.__takeRequests);
    assert.ok(frames.length >= 2, 'concurrent playback must emit spatial writes for both slots');
    assert.ok(frames.some((frame) => frame.touch === true));
    assert.ok(frames.some((frame) => frame.touch === false));
    const completedMix = await page.evaluate(() => window.TouchTakeBankRuntime.state());
    assert.ok(completedMix.slots.slice(0, 2).every((slot) => slot.phase === 'ready'),
      `coalesced concurrent samples must complete both takes: ${JSON.stringify(completedMix)}`);
    assert.ok(completedMix.slots.slice(0, 2).every((slot) => slot.lastError === null),
      `expected multi-take coalescing must not become an output error: ${JSON.stringify(completedMix)}`);
    await page.evaluate(async () => {
      await window.TouchTakeBankRuntime.select(1);
      await window.TouchTakeBankRuntime.play(true);
    });
    await page.waitForFunction(() => window.TouchTakeBankRuntime.state().slots[1].phase === 'looping');
    await page.$eval('#takeSummary', button => button.click());
    const collapsedLoopStatus = await page.evaluate(() => ({
      expanded: document.getElementById('takeSummary').getAttribute('aria-expanded'),
      collapsed: document.getElementById('takeBody').classList.contains('is-take-collapsed'),
      looping: document.getElementById('takeSummary').classList.contains('is-looping'),
      status: document.getElementById('takeSummaryVal').textContent,
    }));
    assert.equal(collapsedLoopStatus.expanded, 'false');
    assert.equal(collapsedLoopStatus.collapsed, true);
    assert.equal(collapsedLoopStatus.looping, true);
    assert.match(collapsedLoopStatus.status, /S2 · LOOP/);
    assert.notEqual(await page.$eval('#brushCluster', element => getComputedStyle(element).display), 'none',
      'collapsing TAKE must restore both compact summaries');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('touchtransportstate', {
      detail: { armed: false, leaseAcquired: false, online: true, phase: 'disarmed' },
    })));
    await page.waitForFunction(() => window.TouchTakeBankRuntime.state().playingCount === 0);
    await captureViewportEvidence(page, 'native_ipad_1024x682_take_bank_03_lease_cleanup.png');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('expanded Brush controls are equal, touch-safe and contained at every supported allocation', { timeout: 60_000 }, async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'native_ipad_1024x682', width: 1024, height: 682, deviceScaleFactor: 1 },
      { name: 'native_ipad_1194x834', width: 1194, height: 834, deviceScaleFactor: 1 },
      { name: 'web_desktop_1440x900', width: 1440, height: 900, deviceScaleFactor: 1 },
      { name: 'constrained_split_760x620', width: 760, height: 620, deviceScaleFactor: 1 },
    ]) {
      const page = await browser.newPage();
      await openPanel(page, viewport);
      await ensureWorkspacePanelOpen(page, 'spatial-panel');
      const spatial = await page.$('.spatial-panel');
      await spatial.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.name}_spatial_brush_collapsed.png`),
      });
      const collapsed = await page.evaluate(() => ({
        expanded: document.getElementById('brushSummary').getAttribute('aria-expanded'),
        visibleRows: [...document.querySelectorAll('#brushGrid > .draw-row')]
          .filter((row) => getComputedStyle(row).display !== 'none').length,
        sharedRow: Math.abs(
          document.getElementById('takeSummary').getBoundingClientRect().top
          - document.getElementById('brushSummary').getBoundingClientRect().top,
        ) <= 1,
      }));
      assert.deepEqual(collapsed, { expanded: 'false', visibleRows: 0, sharedRow: true },
        `${viewport.name}: Brush boots compact with no hidden control consuming layout`);

      await page.$eval('#brushSummary', button => button.click());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.$eval('#takeCluster', element => getComputedStyle(element).display), 'none',
        `${viewport.name}: opening Brush hides TAKE instead of sacrificing the pad`);
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('.spatial-panel').getBoundingClientRect();
        const grid = document.getElementById('brushGrid').getBoundingClientRect();
        const requiredIds = ['sizeRow', 'fadeRow', 'speedRow', 'powerRow', 'stepRow'];
        const cards = requiredIds.map((id) => {
          const row = document.getElementById(id);
          const rect = row.getBoundingClientRect();
          const label = row.querySelector('.draw-cap');
          const buttons = [...row.querySelectorAll('.chips button')].map((button) => {
            const buttonRect = button.getBoundingClientRect();
            return { width: buttonRect.width, height: buttonRect.height };
          });
          return {
            id,
            display: getComputedStyle(row).display,
            x: rect.x, right: rect.right, width: rect.width, height: rect.height,
            labelFits: label.scrollWidth <= label.clientWidth,
            buttons,
          };
        });
        return {
          expanded: document.getElementById('brushSummary').getAttribute('aria-expanded'),
          panel: { x: panel.x, right: panel.right },
          scrollOwner: (() => {
            const body = document.querySelector('.spatial-panel .panel-body');
            return {
              overflowY: getComputedStyle(body).overflowY,
              scrollHeight: body.scrollHeight,
              clientHeight: body.clientHeight,
            };
          })(),
          grid: { x: grid.x, right: grid.right, scrollWidth: document.getElementById('brushGrid').scrollWidth,
            clientWidth: document.getElementById('brushGrid').clientWidth },
          cards,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.equal(geometry.expanded, 'true', `${viewport.name}: Brush announces expanded truthfully`);
      assert.ok(geometry.pageOverflow <= 1, `${viewport.name}: expanded Brush creates no page overflow`);
      assert.ok(geometry.grid.scrollWidth <= geometry.grid.clientWidth + 1,
        `${viewport.name}: expanded Brush creates no nested horizontal scroll`);
      assert.equal(geometry.scrollOwner.overflowY, 'auto',
        `${viewport.name}: Spatial body is the one deliberate vertical scroll owner`);
      assert.ok(geometry.cards.every((card) => card.display === 'grid' && card.labelFits),
        `${viewport.name}: every required Brush group and label is visible`);
      assert.ok(geometry.cards.every((card) => card.x >= geometry.panel.x - 1
        && card.right <= geometry.panel.right + 1), `${viewport.name}: every Brush group stays inside Spatial`);
      assert.ok(Math.max(...geometry.cards.map((card) => card.height))
        - Math.min(...geometry.cards.map((card) => card.height)) <= 1,
      `${viewport.name}: SIZE/FADE/SPEED/POWER/STEP use equal card heights`);
      assert.ok(geometry.cards.every((card) => card.buttons.length >= 4
        && card.buttons.every((button) => button.height >= 44)),
      `${viewport.name}: every segmented Brush choice has a 44px touch height`);
      assert.ok(geometry.cards.every((card) => {
        const widths = card.buttons.map((button) => button.width);
        return Math.max(...widths) - Math.min(...widths) <= 1;
      }), `${viewport.name}: choices within every Brush group have equal widths`);

      const sizeState = await page.evaluate(() => {
        const button = document.querySelector('#brushSizeChips button[data-v="0.35"]');
        button.click();
        return {
          value: document.getElementById('brushSize').dataset.value,
          active: button.classList.contains('is-active'),
          activeCount: document.querySelectorAll('#brushSizeChips button.is-active').length,
        };
      });
      assert.deepEqual(sizeState, { value: '0.35', active: true, activeCount: 1 },
        `${viewport.name}: segmented Brush choice remains a truthful value carrier`);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.name}_spatial_brush_expanded_top.png`),
      });
      const reachable = await page.evaluate(async () => {
        const body = document.querySelector('.spatial-panel .panel-body');
        const results = [];
        for (const id of ['sizeRow', 'fadeRow', 'speedRow', 'powerRow', 'stepRow']) {
          document.getElementById(id).scrollIntoView({ block: 'nearest' });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const row = document.getElementById(id).getBoundingClientRect();
          const owner = body.getBoundingClientRect();
          results.push({ id, reachable: row.top >= owner.top - 1 && row.bottom <= owner.bottom + 1 });
        }
        body.scrollTop = body.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          results,
          scrollTop: body.scrollTop,
          maxScroll: body.scrollHeight - body.clientHeight,
        };
      });
      assert.ok(reachable.results.every((row) => row.reachable),
        `${viewport.name}: every required Brush control is reachable through the one scroll owner`);
      if (viewport.name === 'native_ipad_1024x682') {
        assert.ok(reachable.maxScroll > 1,
          `${viewport.name}: the half-height panel exposes a real scroll range (${JSON.stringify(reachable)})`);
      }
      if (reachable.maxScroll > 1) {
        assert.ok(reachable.scrollTop >= reachable.maxScroll - 1,
          `${viewport.name}: the Spatial owner can settle at its true bottom`);
      }
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.name}_spatial_brush_expanded_bottom.png`),
      });
      await page.$eval('#brushSummary', button => button.click());
      assert.notEqual(await page.$eval('#takeCluster', element => getComputedStyle(element).display), 'none',
        `${viewport.name}: collapsing Brush restores TAKE`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('native touch events produce one canonical spatial contact and no ghost contacts', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      window.__spatialRequests = [];
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        const body = options.body ? JSON.parse(options.body) : null;
        window.__spatialRequests.push({ method: options.method || 'GET', path, body });
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      window.__wire.online = true;
      window.__singleContactErrors = [];
      window.__spatialContactNotices = [];
      document.addEventListener('panelerror', (event) => {
        if (/one contact/i.test(event.detail?.message || '')) {
          window.__singleContactErrors.push(event.detail.message);
        }
      });
      document.addEventListener('panelstatus', (event) => {
        const message = event.detail?.message || '';
        if (/SPATIAL contact limit reached/i.test(message)) {
          window.__spatialContactNotices.push(message);
        }
      });
    });
    const pad = await page.$eval('#xyPad', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    const point = (id, u, v) => ({
      id, x: pad.x + pad.width * u, y: pad.y + pad.height * v,
      radiusX: 6, radiusY: 6, force: 1,
    });
    const waitForSpatialDispatch = (count = 1) => page.waitForFunction(
      (expected) => window.__spatialRequests
        .filter((request) => request.path === '/spatial-paint').length >= expected,
      { timeout: 2_000 },
      count,
    );

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, 0.42, 0.35)] });
    await waitForSpatialDispatch();
    let snapshot = await page.evaluate(() => ({
      requests: window.__spatialRequests.slice(),
      visibleHandles: [...document.querySelectorAll('#xyPad .xy-handle')]
        .filter((element) => !element.hidden).length,
    }));
    let spatial = snapshot.requests.filter((request) => request.path === '/spatial-paint');
    assert.equal(spatial.length, 1, 'one physical pointerdown emits one spatial command');
    assert.equal(spatial[0].body.strokes.length, 1, 'one physical pointerdown owns one canonical contact');
    assert.equal(snapshot.visibleHandles, 1, 'one physical pointer renders one marker');
    assert.equal(snapshot.requests.some((request) => request.path === '/layers/live_touch/control'), false,
      'the same pointer is never duplicated into pattern 130 local controls');
    assert.equal(snapshot.requests.some((request) => request.path === '/param-center'), false,
      'pointerdown has no second palette command path');
    await captureViewportEvidence(page, 'native_ipad_1024x682_spatial_single_white_brush_active.png');

    await page.evaluate(() => { window.__spatialRequests = []; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, 0.58, 0.52)] });
    await waitForSpatialDispatch();
    spatial = await page.evaluate(() => window.__spatialRequests.filter((request) => request.path === '/spatial-paint'));
    assert.equal(spatial.length, 1, 'one physical move emits one spatial command');
    assert.equal(spatial[0].body.strokes.length, 1);
    assert.ok(Number.isInteger(spatial[0].body.strokes[0].id));

    await page.evaluate(() => { window.__spatialRequests = []; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitForSpatialDispatch();
    snapshot = await page.evaluate(() => ({
      requests: window.__spatialRequests.slice(),
      visibleHandles: [...document.querySelectorAll('#xyPad .xy-handle')]
        .filter((element) => !element.hidden).length,
    }));
    spatial = snapshot.requests.filter((request) => request.path === '/spatial-paint');
    assert.equal(spatial.length, 1, 'lift emits one canonical remaining-contact state');
    assert.equal(spatial[0].body.touch, false);
    assert.deepEqual(spatial[0].body.strokes, []);
    assert.equal(snapshot.visibleHandles, 0, 'lift leaves no marker');

    await page.evaluate(() => { window.__spatialRequests = []; });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(7, 0.3, 0.4), point(8, 0.7, 0.6)],
    });
    await waitForSpatialDispatch();
    snapshot = await page.evaluate(() => ({
      spatial: window.__spatialRequests.filter((request) => request.path === '/spatial-paint'),
      gate: window.TouchSpatialContactGate.state(),
      preview: window.TouchPixelViews.state(),
      ink: window.TouchInkDiagnostics(),
      errors: window.__singleContactErrors.slice(),
      spatialContactNotices: window.__spatialContactNotices.slice(),
      visibleHandles: [...document.querySelectorAll('#xyPad .xy-handle')]
        .filter((element) => !element.hidden).length,
    }));
    assert.equal(snapshot.spatial.at(-1).body.strokes.length, 1,
      'the accepted primary contact is the only engine stroke');
    assert.equal(snapshot.visibleHandles, 1, 'the accepted primary contact is the only marker');
    assert.equal(snapshot.preview.activePreviewPointers, 1, 'the canonical pixel preview accepts only the primary');
    assert.equal(snapshot.ink.activePointers, 1, 'the page ink input accepts only the primary');
    assert.equal(snapshot.gate.refusedCount, 1, 'the refusal remains owned until that contact lifts');
    assert.equal(snapshot.spatialContactNotices.length, 1,
      'the extra simultaneous contact publishes one transient status notice');
    assert.equal(snapshot.errors.length, 0, 'contact-limit refusal must not become a persistent panel fault');
    await page.evaluate(() => { window.__spatialRequests = []; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await waitForSpatialDispatch();
    snapshot = await page.evaluate(() => ({
      lastSpatial: window.__spatialRequests.filter((request) => request.path === '/spatial-paint').at(-1),
      visibleHandles: [...document.querySelectorAll('#xyPad .xy-handle')]
        .filter((element) => !element.hidden).length,
      gate: window.TouchSpatialContactGate.state(),
      preview: window.TouchPixelViews.state(),
      ink: window.TouchInkDiagnostics(),
      inkAlpha: (() => {
        const canvas = document.getElementById('inkTrail');
        if (canvas.width === 0 || canvas.height === 0) return 0;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let alpha = 0;
        for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
        return alpha;
      })(),
    }));
    assert.equal(snapshot.lastSpatial.body.touch, false, 'cancel clears engine contacts');
    assert.deepEqual(snapshot.lastSpatial.body.strokes, []);
    assert.equal(snapshot.visibleHandles, 0, 'cancel clears every visual contact');
    assert.equal(snapshot.gate.primary, null, 'cancel releases the shared primary owner');
    assert.equal(snapshot.gate.refusedCount, 0, 'cancel forgets rejected contacts');
    assert.equal(snapshot.preview.activePreviewPointers, 0, 'cancel clears canonical preview contacts');
    assert.equal(snapshot.preview.pendingPreviewFrames, 0, 'cancel leaves no pending preview frame');
    assert.equal(snapshot.ink.activePointers, 0, 'cancel clears page input contacts');
    assert.equal(snapshot.ink.inkFramePending, false, 'cancel leaves no obsolete ink frame');
    assert.equal(snapshot.ink.inputFramePending, false, 'cancel leaves no queued ink input');
    assert.equal(snapshot.inkAlpha, 0, 'the obsolete ink canvas remains fully transparent');
    await captureEvidence(page, 'native_ipad_1024x682_spatial_single_brush_cancelled_clear.png');

    await page.close();
  } finally {
    await browser.close();
  }
});

test('Spatial lifecycle cleanup clears every browser layer and pending frame', { timeout: 45_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({ status: 'ok' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      document.getElementById('xyPad').setPointerCapture = () => {};
    });
    let pointerId = 100;
    const begin = async () => {
      pointerId += 1;
      await page.evaluate((id) => {
        const pad = document.getElementById('xyPad');
        const rect = pad.getBoundingClientRect();
        pad.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: true,
          clientX: rect.left + rect.width * 0.45,
          clientY: rect.top + rect.height * 0.55,
          pressure: 1, buttons: 1,
        }));
      }, pointerId);
      await page.waitForFunction(() => window.TouchPixelViews.state().activePreviewPointers === 1);
    };
    const assertCleared = async (reason) => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await page.evaluate(() => ({
        gate: window.TouchSpatialContactGate.state(),
        pixel: window.TouchPixelViews.state(),
        ink: window.TouchInkDiagnostics(),
        wire: window.__wire._spatialPayloadForTest(),
        visibleHandles: [...document.querySelectorAll('#xyPad .xy-handle')]
          .filter((handle) => !handle.hidden).length,
      }));
      assert.equal(state.gate.primary, null, `${reason}: shared owner is clear`);
      assert.equal(state.gate.refusedCount, 0, `${reason}: refusals are clear`);
      assert.equal(state.pixel.activePreviewPointers, 0, `${reason}: pixel contacts are clear`);
      assert.equal(state.pixel.pendingPreviewFrames, 0, `${reason}: pixel frame is cancelled`);
      assert.equal(state.ink.activePointers, 0, `${reason}: page contacts are clear`);
      assert.equal(state.ink.inkFramePending, false, `${reason}: ink frame is cancelled`);
      assert.equal(state.ink.inputFramePending, false, `${reason}: input frame is cancelled`);
      assert.deepEqual(state.wire.strokes, [], `${reason}: engine payload has no contact`);
      assert.equal(state.visibleHandles, 0, `${reason}: white marker is hidden`);
    };

    for (const scenario of [
      ['ARM/DISARM transition', () => page.evaluate(() => window.__wire._clearTransientSpatialContacts('arm-idle', false))],
      ['visibility background/foreground', () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))],
      ['native foreground', () => page.evaluate(() => document.dispatchEvent(new CustomEvent('captainpad:surface-focus')))],
      ['mode change', () => page.click('#modeToggle button[data-mode="effect"]')],
      ['pagehide', () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')))],
    ]) {
      await begin();
      await scenario[1]();
      await assertCleared(scenario[0]);
      if (scenario[0] === 'mode change') await page.click('#modeToggle button[data-mode="spatial"]');
    }

    await begin();
    await page.setViewport({ width: 1024, height: 700, deviceScaleFactor: 1 });
    await assertCleared('same-width resize');

    await begin();
    await page.click('#workspaceScroll [data-workspace-panel="spatial-panel"]');
    await assertCleared('panel hide');
    await page.click('#workspaceScroll [data-workspace-panel="spatial-panel"]');
    await assertCleared('panel reopen');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('Ambient base selection waits for engine-confirmed crossfade landing and reverts on rejection', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      const group = document.getElementById('patternBackgroundGroup');
      for (const [value, pattern] of [['ambient-ok', '00_golden_hour_wash'], ['ambient-reject', '01_blue_hour']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.dataset.pattern = pattern;
        option.dataset.playlist = 'ambient';
        option.dataset.entryId = value;
        group.appendChild(option);
      }
      window.__patternRequests = [];
      window.__layerPoll = 0;
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      window.__wire.online = true;
      window.__wire.channelPattern = '130_spatial_paint';
      const layer = (pattern, transition) => ({
        type: 'layerSettings', active: 'live_touch', target: 'live_touch', queued: null,
        transition: null,
        liveTouch: {
          armed: true, ownerId: 'touch-control-prototype', ready: true,
          pattern, patternTransition: transition, sessionRevision: pattern === '130_spatial_paint' ? 4 : 5,
        },
      });
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        const body = options.body ? JSON.parse(options.body) : null;
        const method = options.method || 'GET';
        window.__patternRequests.push({ method, path, body });
        if (path === '/layers/live_touch/pattern' && body.pattern === '01_blue_hour') {
          return new Response('owner rejected test transition', { status: 409 });
        }
        if (path === '/layers/live_touch/pattern') {
          return new Response(JSON.stringify({
            status: 'transitioning', pattern: '130_spatial_paint',
            targetPattern: '00_golden_hour_wash', transitionId: 'lt-test-1', sessionRevision: 4,
            transition: {
              id: 'lt-test-1', fromPattern: '130_spatial_paint', toPattern: '00_golden_hour_wash',
              progress: 0, durationMs: 500, mode: 'trans_crossfade',
            },
          }), { status: 202, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/layers/state') {
          window.__layerPoll += 1;
          const pending = window.__layerPoll === 1;
          const transition = pending ? {
            id: 'lt-test-1', fromPattern: '130_spatial_paint', toPattern: '00_golden_hour_wash',
            progress: 0.6, durationMs: 500, mode: 'trans_crossfade',
          } : null;
          const value = pending
            ? layer('130_spatial_paint', transition)
            : layer('00_golden_hour_wash', null);
          return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      };
      const select = document.getElementById('patternSel');
      select.value = '130';
      select.dataset.confirmedPattern = '130_spatial_paint';
      select.value = 'ambient-ok';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const pendingSelection = await page.evaluate(() => ({
      selected: document.getElementById('patternSel').value,
      confirmedPattern: document.getElementById('patternSel').dataset.confirmedPattern,
      busy: document.getElementById('patternSel').getAttribute('aria-busy'),
      transition: document.getElementById('patternState').textContent,
    }));
    assert.equal(pendingSelection.selected, 'ambient-ok',
      'the chooser must keep the operator-selected target visible while the real transition runs');
    assert.equal(pendingSelection.confirmedPattern, '130_spatial_paint',
      'the pending target must not be misrepresented as engine-confirmed before landing');
    assert.equal(pendingSelection.busy, 'true');
    assert.match(pendingSelection.transition, /PREPARING|CROSSFADING/,
      'the UI must name the real in-flight phase instead of appearing inert');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const landing = await page.evaluate(() => ({
      pattern: window.__wire.channelPattern,
      selected: document.getElementById('patternSel').value,
      hidden: document.getElementById('patternState').hidden,
      requests: window.__patternRequests.slice(),
      error: document.getElementById('wireStatus')?.textContent || '',
      browserErrors: window.__layoutTestErrors.slice(),
    }));
    assert.deepEqual(
      { pattern: landing.pattern, selected: landing.selected, hidden: landing.hidden },
      { pattern: '00_golden_hour_wash', selected: 'golden-hour', hidden: true },
      `engine-confirmed B must land: ${JSON.stringify(landing)}`,
    );
    const success = await page.evaluate(() => ({
      puts: window.__patternRequests.filter((request) =>
        request.method === 'PUT' && request.path === '/layers/live_touch/pattern'),
      clears: window.__patternRequests.filter((request) =>
        request.method === 'POST' && request.path === '/spatial-paint'),
    }));
    assert.equal(success.puts.length, 1, 'one selector change sends one authoritative engine command');
    assert.deepEqual(success.puts[0].body, {
      pattern: '00_golden_hour_wash', playlist: 'ambient', entryId: 'ambient-ok',
      transition: { mode: 'trans_crossfade', durationMs: 500 },
    });
    assert.equal(success.clears.at(-1).body.touch, false, 'base change clears only transient contacts');
    assert.equal('clear' in success.clears.at(-1).body, false, 'base change preserves spatial heat/overlay');

    await page.evaluate(() => {
      window.__patternRequests = [];
      const select = document.getElementById('patternSel');
      select.value = 'ambient-reject';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const rejected = await page.evaluate(() => ({
      selected: document.getElementById('patternSel').value,
      confirmed: window.__wire.channelPattern,
      puts: window.__patternRequests.filter((request) =>
        request.method === 'PUT' && request.path === '/layers/live_touch/pattern').length,
      error: document.getElementById('wireStatus')?.textContent || '',
    }));
    assert.equal(rejected.puts, 1);
    assert.equal(rejected.selected, 'golden-hour', 'failed selection reverts to the confirmed authoritative B option');
    assert.equal(rejected.confirmed, '00_golden_hour_wash');
    assert.match(rejected.error, /pattern:/i, 'rejection is loud on the operator surface');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a retained Live pattern outside the chooser is passive until ARM restages the selected base', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(() => {
      const picker = document.getElementById('patternSel');
      picker.value = '130';
      picker.dataset.confirmedPattern = '130_spatial_paint';
      window.__wire.lastError = null;
      document.getElementById('wireStatus')?.remove();
      window.__wire._acceptPatternLayerState({
        liveTouch: {
          pattern: 'api_staged_pattern_outside_chooser',
          patternTransition: null,
        },
      });
      return {
        selected: picker.value,
        confirmedPattern: picker.dataset.confirmedPattern,
        channelPattern: window.__wire.channelPattern,
        error: window.__wire.lastError,
        errorVisible: !!document.getElementById('wireStatus'),
      };
    });
    assert.deepEqual(result, {
      selected: '130',
      confirmedPattern: '130_spatial_paint',
      channelPattern: 'api_staged_pattern_outside_chooser',
      error: null,
      errorVisible: false,
    }, 'passive startup must preserve the explicit chooser intent without inventing an error');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a malformed authoritative background catalog leaves no partial chooser and refuses ARM', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async (effects) => {
      window.fetch = async (input) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path === '/global-effect-library') return new Response(JSON.stringify({ effects }), { status: 200 });
        if (path === '/playlists/ambient') return new Response(JSON.stringify({ entries: [
          { id: 'valid', pattern: '00_golden_hour_wash' },
          { id: 'duplicate', pattern: '00_golden_hour_wash' },
        ] }), { status: 200 });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
      await window.__wire._loadFxCatalog();
      let catalogError = '';
      try { await window.__wire._loadBackgroundCatalog(); } catch (error) { catalogError = error.message; }
      let armError = '';
      try { await window.__wire._verifyArmReadiness(); } catch (error) { armError = error.message; }
      return { options: document.getElementById('patternBackgroundGroup').children.length, catalogError, armError };
    }, EFFECT_CATALOG);
    assert.equal(result.options, 0, 'a late duplicate must not leave earlier background options mounted');
    assert.match(result.catalogError, /repeats pattern/i, `catalog rejection should identify the malformed entry: ${result.catalogError}`);
    assert.match(result.armError, /repeats pattern|background catalog/i, `ARM must refuse an invalid chooser: ${result.armError}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('ARM joins slow pixel verification and retries a prior transient failure', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });

    const firstFailure = await page.evaluate(async () => {
      window.__wire._resetPixelViewVerificationForTest();
      window.fetch = async () => { throw new Error('transient pixel-layout link loss'); };
      try {
        await window.__wire._verifyPixelViewArmReadiness();
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.match(firstFailure, /canonical pixel-view verification failed: transient pixel-layout link loss/,
      'the exact rejected verification step reaches the ARM error');

    await page.evaluate((pixels) => {
      window.__layoutPixels = pixels;
      const views = window.TouchPixelViews;
      const originalVerify = views.verifyEngineLayout.bind(views);
      const originalCanArm = views.canArm.bind(views);
      let slowVerificationLanded = false;
      views.verifyEngineLayout = (layout) => new Promise((resolve, reject) => {
        setTimeout(() => {
          originalVerify(layout).then((value) => {
            slowVerificationLanded = true;
            resolve(value);
          }, reject);
        }, 250);
      });
      views.canArm = () => slowVerificationLanded && originalCanArm();
      window.__pixelLayoutRequestCache = null;
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        if (path !== '/model/pixel-layout') throw new Error(`unexpected ARM request ${path}`);
        window.__pixelLayoutRequestCache = options.cache || null;
        return new Response(JSON.stringify({
          scene: 'titanic', model: 'titanic', pixelCount: pixels.length,
          returnedCount: pixels.length, pixels,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__slowArmVerifySettled = false;
      window.__slowArmVerifyError = null;
      window.__wire._verifyPixelViewArmReadiness().then(() => {
        window.__slowArmVerifySettled = true;
      }, (error) => {
        window.__slowArmVerifySettled = true;
        window.__slowArmVerifyError = error.message;
      });
    }, titanicPixels);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const inFlight = await page.evaluate(() => ({
      settled: window.__slowArmVerifySettled,
      canArm: window.TouchPixelViews.canArm(),
    }));
    assert.deepEqual(inFlight, { settled: false, canArm: false },
      'an ARM tap waits instead of sampling canArm while verification is in flight');

    await page.waitForFunction(() => window.__slowArmVerifySettled, { timeout: 3000 });
    const landed = await page.evaluate(() => ({
      error: window.__slowArmVerifyError,
      canArm: window.TouchPixelViews.canArm(),
      state: window.TouchPixelViews.state(),
      requestCache: window.__pixelLayoutRequestCache,
    }));
    assert.equal(landed.error, null);
    assert.equal(landed.canArm, true, 'matching topology becomes ARM-ready after the shared promise lands');
    assert.equal(landed.state.engineVerified, true);
    assert.equal(landed.requestCache, 'no-store',
      'native topology verification must bypass WKWebView session cache');

    const mismatch = await page.evaluate(async () => {
      const pixels = window.__layoutPixels.map((pixel) => ({ ...pixel }));
      pixels[0].nx += 0.0001;
      try {
        await window.TouchPixelViews.verifyEngineLayout({
          scene: 'titanic', model: 'titanic', pixelCount: pixels.length,
          returnedCount: pixels.length, pixels,
        });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.match(mismatch, /engine model 'titanic' \(964 pixels\) topology does not match/);
    assert.match(mismatch, /cd simulation && npm run pixel-views:export/,
      'a true mismatch stays fail-closed and names the regeneration remedy');
    assert.doesNotMatch(mismatch, /f10607|\[\{|"pixels"/,
      'the operator error does not expose topology data or fingerprints');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('native ARM survives lost/reordered bridge readiness with one document-scoped verification', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 682, deviceScaleFactor: 1 });
    await installHermeticBrowser(page, true, await groupCatalog());
    await page.goto(`${PANEL_URL}&captainpad_embed=native`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.TouchPixelViews?.state().readyStatus === 'fulfilled' && window.__wire,
      { timeout: 5_000 },
    );

    await page.evaluate((pixels) => {
      window.__nativeBridgeMessages = [];
      window.__nativePixelRequests = [];
      window.__nativeVerifySettled = false;
      window.__nativeVerifyError = null;
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        if (path !== '/model/pixel-layout') throw new Error(`unexpected native verify request ${path}`);
        window.__nativePixelRequests.push({ path, cache: options.cache || null });
        return new Response(JSON.stringify({
          scene: 'titanic', model: 'titanic', pixelCount: pixels.length,
          returnedCount: pixels.length, pixels,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__wire._verifyPixelViewArmReadiness().then(() => {
        window.__nativeVerifySettled = true;
      }, (error) => {
        window.__nativeVerifySettled = true;
        window.__nativeVerifyError = error.message;
      });
    }, titanicPixels);

    /* Focus can arrive before theme-ready, onLoadEnd, or the verifier listener
       on WKWebView. It is deliberately irrelevant to the verifier protocol. */
    await page.evaluate(() => {
      window.__captainpadDeliver({
        type: 'captainpad-surface-focus', version: 1, requestId: 'early-native-focus',
      });
    });
    await page.waitForFunction(() => window.__nativeBridgeMessages.some(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ), { timeout: 2_000 });
    const firstReady = await page.evaluate(() => window.__nativeBridgeMessages.findLast(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ));
    assert.equal(typeof firstReady.documentId, 'string');

    /* Drop that ready message as if it were lost between WKWebView and React
       Native. The fully mounted wire must keep advertising the same document. */
    await page.evaluate(() => { window.__nativeBridgeMessages = []; });
    await page.waitForFunction(() => window.__nativeBridgeMessages.some(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ), { timeout: 2_000 });
    const replayedReady = await page.evaluate(() => window.__nativeBridgeMessages.findLast(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ));
    assert.equal(replayedReady.documentId, firstReady.documentId,
      'ready replay remains scoped to the same live JS document');

    await page.evaluate(() => {
      window.__captainpadDeliver({
        type: 'captainpad-pixel-verification-start', version: 1,
        documentId: 'reclaimed-stale-document', requestId: 'stale-request',
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const beforeAck = await page.evaluate(() => ({
      settled: window.__nativeVerifySettled,
      requests: window.__nativePixelRequests.length,
      statuses: window.__nativeBridgeMessages
        .filter((message) => message.type === 'touch-control-pixel-verification')
        .map((message) => message.status),
    }));
    assert.equal(beforeAck.settled, false, 'native ARM joins the acknowledged verifier start');
    assert.equal(beforeAck.requests, 0, 'a stale document ack cannot authorize verification');
    assert.deepEqual(beforeAck.statuses, []);

    await page.evaluate((documentId) => {
      const start = {
        type: 'captainpad-pixel-verification-start', version: 1,
        documentId, requestId: 'native-pixel-request-1',
      };
      /* Duplicate delivery is legal: CaptainPad retries until it sees a
         correlated state. It must not create a second topology request. */
      window.__captainpadDeliver(start);
      window.__captainpadDeliver(start);
    }, replayedReady.documentId);
    await page.waitForFunction(() => window.__nativeVerifySettled, { timeout: 3_000 });
    const afterAck = await page.evaluate(() => ({
      error: window.__nativeVerifyError,
      canArm: window.TouchPixelViews.canArm(),
      requests: window.__nativePixelRequests.slice(),
      states: window.__nativeBridgeMessages
        .filter((message) => message.type === 'touch-control-pixel-verification'),
    }));
    assert.equal(afterAck.error, null);
    assert.equal(afterAck.canArm, true);
    assert.deepEqual(afterAck.requests, [{ path: '/model/pixel-layout', cache: 'no-store' }]);
    assert.ok(afterAck.states.some((state) => state.status === 'checking'));
    assert.ok(afterAck.states.every((state) => (
      state.documentId === replayedReady.documentId
      && state.requestId === 'native-pixel-request-1'
    )), 'every diagnostic is correlated to the acknowledged document and request');
    const ready = afterAck.states.findLast((state) => state.status === 'ready');
    assert.deepEqual(ready && {
      phase: ready.phase,
      staticVerified: ready.staticVerified,
      engineVerified: ready.engineVerified,
      readyStatus: ready.readyStatus,
      error: ready.error,
    }, {
      phase: 'complete',
      staticVerified: true,
      engineVerified: true,
      readyStatus: 'fulfilled',
      error: null,
    });

    await page.evaluate(async (pixels) => {
      const mismatched = pixels.map((pixel) => ({ ...pixel }));
      mismatched[0].nx += 0.0001;
      try {
        await window.TouchPixelViews.verifyEngineLayout({
          scene: 'titanic', model: 'titanic', pixelCount: mismatched.length,
          returnedCount: mismatched.length, pixels: mismatched,
        });
      } catch {
        // This deliberately drops engineVerified so the next strict check runs.
      }
      window.__nativeBridgeMessages = [];
      window.__nativeFailureSettled = false;
      window.fetch = async () => { throw new Error('native topology link lost after remount'); };
      window.__wire._verifyPixelViewArmReadiness().catch(() => {
        window.__nativeFailureSettled = true;
      });
    }, titanicPixels);
    await page.waitForFunction(() => window.__nativeFailureSettled, { timeout: 3_000 });
    const reportedFailure = await page.evaluate(() => window.__nativeBridgeMessages
      .filter((message) => message.type === 'touch-control-pixel-verification')
      .findLast((message) => message.status === 'failed'));
    assert.deepEqual(reportedFailure && {
      documentId: reportedFailure.documentId,
      requestId: reportedFailure.requestId,
      phase: reportedFailure.phase,
      staticVerified: reportedFailure.staticVerified,
      engineVerified: reportedFailure.engineVerified,
      readyStatus: reportedFailure.readyStatus,
      error: reportedFailure.error,
    }, {
      documentId: replayedReady.documentId,
      requestId: 'native-pixel-request-1',
      phase: 'engine-layout-fetch',
      staticVerified: true,
      engineVerified: false,
      readyStatus: 'fulfilled',
      error: 'native topology link lost after remount',
    }, 'CaptainPad receives the exact native verifier failure and gate state');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('native ARM prepares safely when persisted layout hides Spatial before its first paint', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 682, deviceScaleFactor: 1 });
    await installHermeticBrowser(page, true, await groupCatalog());
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('bm26_touch_layout_v2', JSON.stringify(['spatial-panel']));
    });
    await page.goto(`${PANEL_URL}&captainpad_embed=native`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.TouchPixelViews?.state().readyStatus === 'fulfilled' && window.__wire,
      { timeout: 5_000 },
    );

    const beforeVerification = await page.evaluate(() => ({
      spatialHidden: document.querySelector('.spatial-panel').classList.contains('is-docked'),
      pixelState: window.TouchPixelViews.state(),
    }));
    assert.equal(beforeVerification.spatialHidden, true);
    assert.equal(beforeVerification.pixelState.staticVerified, true);
    assert.equal(beforeVerification.pixelState.staticRenderCount, 0,
      'native persisted layout hides the canvas before its first animation-frame projection');
    const preEngineRadiusError = await page.evaluate(() => {
      try {
        window.padBrushWorldCanonical();
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(preEngineRadiusError, 'pixel-view engine topology is not verified',
      'canvas independence must not weaken the live-topology ARM gate');

    await page.evaluate((pixels) => {
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        if (path !== '/model/pixel-layout') throw new Error(`unexpected native verify request ${path}`);
        if (options.cache !== 'no-store') throw new Error('native topology request was cacheable');
        return new Response(JSON.stringify({
          scene: 'titanic', model: 'titanic', pixelCount: pixels.length,
          returnedCount: pixels.length, pixels,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, titanicPixels);
    await page.waitForFunction(() => window.__nativeBridgeMessages.some(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ), { timeout: 2_000 });
    const documentId = await page.evaluate(() => window.__nativeBridgeMessages.findLast(
      (message) => message.type === 'touch-control-pixel-verifier-ready',
    ).documentId);
    await page.evaluate((liveDocumentId) => {
      window.__captainpadDeliver({
        type: 'captainpad-pixel-verification-start', version: 1,
        documentId: liveDocumentId, requestId: 'hidden-spatial-native-arm',
      });
    }, documentId);
    await page.waitForFunction(
      () => window.__nativeBridgeMessages.some((message) => (
        message.type === 'touch-control-pixel-verification' && message.status === 'ready'
      )),
      { timeout: 3_000 },
    );
    assert.equal(await page.evaluate(() => window.TouchPixelViews.canArm()), true);

    const prepared = await page.evaluate(() => {
      try {
        return { body: window.__wire._initialSpatialPrepareBody(), error: null };
      } catch (error) {
        return { body: null, error: error.message };
      }
    });
    assert.equal(prepared.error, null,
      'verified native ARM must not require display geometry from a hidden Spatial panel');
    assert.equal(prepared.body.touch, false);
    assert.equal(prepared.body.clear, true);
    assert.equal(prepared.body.pixelIndices.length, ARTIFACT.views[0].paintPixelCount);
    assert.ok(prepared.body.radius > 0 && prepared.body.radiusY > 0,
      'hidden native ARM stages complete brush geometry from the verified canonical view');
    const hiddenProjectionError = await page.evaluate(() => {
      try {
        window.padWorldPerPx(1, 1);
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(hiddenProjectionError, 'pixel view has no rendered display projection',
      'display projection failure is distinct from source/topology verification');

    await page.$eval(
      '#workspaceScroll [data-workspace-panel="spatial-panel"]',
      (chip) => chip.click(),
    );
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const restored = await page.evaluate(() => {
      const panel = document.querySelector('.spatial-panel');
      const canvas = document.getElementById('pixMap');
      const panelRect = panel.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        docked: panel.classList.contains('is-docked'),
        panel: { width: panelRect.width, height: panelRect.height },
        canvas: { width: canvasRect.width, height: canvasRect.height },
        pixelState: window.TouchPixelViews.state(),
        projected: window.TouchPixelViews.hasDisplayProjection(),
      };
    });
    assert.equal(restored.docked, false, JSON.stringify(restored));
    assert.equal(restored.projected, true, JSON.stringify(restored));
    const visibleBody = await page.evaluate(() => ({
      canonical: window.__wire._initialSpatialPrepareBody(),
      screen: window.padBrushWorld(),
    }));
    assert.ok(visibleBody.canonical.radius > 0 && visibleBody.canonical.radiusY > 0,
      'visible ARM keeps the verified canonical staging geometry');
    assert.ok(visibleBody.screen.x > 0 && visibleBody.screen.y > 0,
      'revealing Spatial restores the exact display-derived stroke projection');
    assert.equal(visibleBody.canonical.radius, prepared.body.radius,
      'canonical ARM geometry is independent of panel visibility and viewport size');
    assert.equal(visibleBody.canonical.radiusY, prepared.body.radiusY);

    await page.$eval(
      '#workspaceScroll [data-workspace-panel="spatial-panel"]',
      (chip) => chip.click(),
    );
    const hiddenAgain = await page.evaluate(() => ({
      docked: document.querySelector('.spatial-panel').classList.contains('is-docked'),
      projected: window.TouchPixelViews.hasDisplayProjection(),
      body: window.__wire._initialSpatialPrepareBody(),
    }));
    assert.equal(hiddenAgain.docked, true);
    assert.equal(hiddenAgain.projected, false,
      'cached glyphs are not a current display projection after Spatial is hidden again');
    assert.equal(hiddenAgain.body.radius, prepared.body.radius,
      'hidden ARM does not reuse stale display geometry from an earlier visible projection');
    assert.equal(hiddenAgain.body.radiusY, prepared.body.radiusY);
    await page.close();
  } finally {
    await browser.close();
  }
});

/* W4 bugfix bounds proof (docs/70 §4.2 / `_289`'s COLOR HUB panel,
   `#colorHubPanel`). The operator reported the HOLD duration row half-cut
   at the bottom edge of the COLOR card with content below it completely
   unreachable — no scroll, just clipped. Root cause: `.panel { overflow:
   hidden }` (this file's universal panel-clip contract) plus `.ch-*` row
   spacing that `_289` landed unconditionally, never checked against the
   tighter landscape-11" share `.colorhub-panel` shares with `.spatial-panel`
   in `.prow.prow-top`. This suite is the harness that can genuinely measure
   real boxes at a fixed viewport (`page.setViewport` + real
   `getBoundingClientRect`, per `openPanel`/`installHermeticBrowser` above),
   so it is the correct home for the proof rather than inventing a second
   stub layout engine.

   Checked at BOTH docs/66 11" acceptance viewports (1194x834 landscape,
   834x1194 portrait), for EVERY row of EVERY `[data-color-card]` card
   (TWO COLOUR / PALETTE TURNS / FOLLOW NOTE) — reached the same way the
   operator reaches them, by tapping the `#chTabs` pill — AND with the
   docs/61 §4.1 DRIVING strip (`#chStrip`) shown, since that is what turns
   the baseline overrun into the operator's reported severity: a family
   running from a card OTHER than the one on screen is a normal production
   state, not a contrived edge case, and it is what MEASURING (before the
   fix) showed pushing the FADE row half off the bottom edge and the
   RUN/START button entirely below it. The assertion is a plain box
   containment check against the panel's own client box, the box
   `overflow: hidden` actually clips against — no control's real box (not
   just its `::after` hit-region overlay, the box a finger can literally
   see and read) may cross it in any of the four directions. */
test('COLOR HUB card rows stay inside the panel client box at both iPad orientations (docs/70 W4 bugfix)', { timeout: 60_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'landscape_1194x834', width: 1194, height: 834, deviceScaleFactor: 1 },
      { name: 'portrait_834x1194', width: 834, height: 1194, deviceScaleFactor: 1 },
    ]) {
      const page = await browser.newPage();
      await openPanel(page, viewport);

      for (const drivingStripShown of [false, true]) {
        await page.evaluate((shown) => {
          const strip = document.getElementById('chStrip');
          strip.hidden = !shown;
          if (shown) {
            document.getElementById('chStripText').textContent =
              'PALETTE TURNS driving — started 0:42 ago';
          }
        }, drivingStripShown);

        for (const cardKey of ['two', 'turns', 'follow']) {
          await page.evaluate((key) => {
            document.querySelector(`#chTabs [data-card="${key}"]`).click();
          }, cardKey);
          await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }));

          const result = await page.evaluate((key) => {
            const cardId = key === 'two' ? 'chCardTwo' : key === 'turns' ? 'chCardTurns' : 'chCardFollow';
            const panel = document.getElementById('colorHubPanel');
            const panelBox = panel.getBoundingClientRect();
            const rowsOf = (el) => Array.from(el.children).map((child) => {
              const r = child.getBoundingClientRect();
              return {
                label: child.id || child.className || child.tagName,
                top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                width: r.width, height: r.height,
              };
            });
            const rows = [
              ...rowsOf(document.getElementById('chTabs')).map((r) => ({ ...r, label: 'chTabs > ' + r.label })),
              ...rowsOf(document.getElementById(cardId)).map((r) => ({ ...r, label: cardId + ' > ' + r.label })),
            ];
            const strip = document.getElementById('chStrip');
            if (!strip.hidden) {
              const r = strip.getBoundingClientRect();
              rows.push({
                label: 'chStrip', top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                width: r.width, height: r.height,
              });
            }
            return {
              panel: {
                top: panelBox.top, bottom: panelBox.bottom,
                left: panelBox.left, right: panelBox.right,
              },
              rows,
            };
          }, cardKey);

          for (const row of result.rows) {
            const context = `${viewport.name} strip=${drivingStripShown} card=${cardKey} row="${row.label}"`;
            assert.ok(row.top >= result.panel.top - 1,
              `${context}: top ${row.top.toFixed(1)} escapes panel top ${result.panel.top.toFixed(1)}`);
            assert.ok(row.bottom <= result.panel.bottom + 1,
              `${context}: bottom ${row.bottom.toFixed(1)} escapes panel bottom ${result.panel.bottom.toFixed(1)} (clipped/unreachable — the exact reported defect)`);
            assert.ok(row.left >= result.panel.left - 1,
              `${context}: left ${row.left.toFixed(1)} escapes panel left ${result.panel.left.toFixed(1)}`);
            assert.ok(row.right <= result.panel.right + 1,
              `${context}: right ${row.right.toFixed(1)} escapes panel right ${result.panel.right.toFixed(1)}`);
          }
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('an armed effect press enters a visible pending state before engine confirmation', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });

    const pressed = await page.evaluate(() => {
      const arm = document.getElementById('arm');
      arm.classList.add('is-armed');
      arm.setAttribute('aria-checked', 'true');
      const cell = document.querySelector('#fxGrid .fx-cell');
      const face = cell.querySelector('[data-role=fxface]');
      face.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 41,
        pointerType: 'touch',
        isPrimary: true,
      }));
      return {
        on: cell.classList.contains('is-on'),
        pending: cell.classList.contains('is-pending'),
        pressed: face.getAttribute('aria-pressed'),
      };
    });

    assert.deepEqual(pressed, { on: true, pending: true, pressed: 'true' },
      'an armed effect press must create truthful visible intent while the wire awaits readback');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('catalog hold actions serialize down then up, reconcile to inactive truth, and fail loudly', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const cell = document.querySelector('#fxGrid .fx-cell[data-slot="24"]');
      cell.dataset.behavior = 'hold';
      cell.dataset.fxkey = 'freeze';
      cell.dataset.preset = 'hold';
      const face = cell.querySelector('[data-role=fxface]');
      const calls = [];
      let active = false;
      let rejectDown = false;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET';
        calls.push({ method, path });
        if (path === '/global-effect-slots/24/down') {
          if (rejectDown) return new Response('owner rejected', { status: 409 });
          active = true;
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/global-effect-slots/24/up') {
          active = false;
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/global-effect-slots/status') {
          return new Response(JSON.stringify({
            slots: [{ slotId: 24, active }],
            controller: active ? { freeze: { slotId: 24, active: true } } : {},
          }), { status: 200 });
        }
        if (path === '/globals') return new Response(JSON.stringify({ effects: {} }), { status: 200 });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
      face.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 90, pointerType: 'touch', isPrimary: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      const disarmed = { calls: calls.length, on: cell.classList.contains('is-on'), pending: cell.classList.contains('is-pending') };
      window.__wire.phase = 'armed'; window.__wire.armed = true;
      face.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 91, pointerType: 'touch', isPrimary: true }));
      face.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 91, pointerType: 'touch', isPrimary: true }));
      await new Promise(resolve => setTimeout(resolve, 120));
      const settled = { on: cell.classList.contains('is-on'), pending: cell.classList.contains('is-pending') };
      rejectDown = true;
      face.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 92, pointerType: 'touch', isPrimary: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      return { calls, disarmed, settled, failed: { on: cell.classList.contains('is-on'), pending: cell.classList.contains('is-pending') }, error: document.getElementById('wireStatus').textContent };
    });
    const edges = result.calls.filter(call => /^\/global-effect-slots\/24\/(down|up|press)$/.test(call.path));
    assert.deepEqual(edges.slice(0, 2).map(call => call.path), ['/global-effect-slots/24/down', '/global-effect-slots/24/up'],
      `hold must use serialized down→up edges, never press: ${JSON.stringify(edges)}`);
    assert.equal(edges.some(call => call.path.endsWith('/press')), false, 'hold must not enter generic toggle reconciliation');
    assert.deepEqual(result.disarmed, { calls: 0, on: false, pending: false }, 'a disarmed hold has no owner-tagged edge and no optimistic latch');
    assert.deepEqual(result.settled, { on: false, pending: false }, 'release must end at confirmed inactive truth');
    assert.deepEqual(result.failed, { on: false, pending: false }, 'a rejected hold edge clears local intent');
    assert.match(result.error, /effect hold down/i, `hold failure must name the failed operation: ${result.error}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('disarmed Performance disables every effect card without requesting owner slots', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const requests = [];
      const errors = [];
      document.addEventListener('panelerror', event => errors.push(event.detail && event.detail.message));
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        requests.push({ method: options.method || 'GET', path });
        if (path === '/status') return new Response(JSON.stringify({
          liveTouchProtocolVersion: 2,
          performanceMode: { active: true },
        }), { status: 200 });
        if (path === '/layers/state') return new Response(JSON.stringify({
          type: 'layerSettings', active: 'deck', target: 'deck', queued: null,
          transition: null,
          liveTouch: {
            armed: false, ownerId: null, ready: false, pattern: null,
            patternTransition: null, sessionRevision: 0,
          },
        }), { status: 200 });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      window.__wire.phase = 'idle';
      window.__wire.armed = false;
      window.__wire._acceptPerformanceMode(true);
      window.__wire.phase = 'arming';
      window.__wire._acceptPerformanceMode(true);
      await new Promise(resolve => setTimeout(resolve, 80));
      const cells = [...document.querySelectorAll('#fxGrid .fx-cell')];
      return {
        requests,
        errors,
        disabled: cells.every(cell => cell.querySelector('[data-role=fxface]').disabled),
        boundCount: cells.filter(cell => cell.dataset.performanceBound === 'true').length,
        hint: getComputedStyle(document.getElementById('fxArmHint')).display,
        panelDisabled: document.querySelector('.effects-panel')
          .classList.contains('is-performance-disarmed'),
      };
    });
    assert.equal(result.requests.some(request => request.path.startsWith('/global-effect-slots')),
      false, `disarmed/arming Performance must not read the shared slot bank: ${JSON.stringify(result.requests)}`);
    assert.deepEqual(result.errors, [], `disarmed Performance must stay error-free: ${JSON.stringify(result.errors)}`);
    assert.equal(result.disabled, true, 'every disarmed Performance face must be natively disabled');
    assert.equal(result.boundCount, 0, 'disarmed Performance must expose no actionable slot binding');
    assert.equal(result.hint, 'flex', 'the operator must see the ARM-to-use-effects hint');
    assert.equal(result.panelDisabled, true, 'the complete Performance action bank must paint disabled');
    await captureEvidence(page, 'native_ipad_landscape_effects_performance_disarmed.png');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('real Performance effect buttons reconcile toggle and hold actions from pointer readback', { timeout: 45_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await page.evaluate(async (slots) => {
      window.__pointerRequests = [];
      window.__pointerActiveSlots = {};
      window.__pointerErrors = [];
      document.addEventListener('panelerror', event => {
        window.__pointerErrors.push(event.detail && event.detail.message);
      });
      window.__pointerBaseFetch = window.fetch;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET';
        window.__pointerRequests.push({ method, path });
        if (path === '/status') {
          return new Response(JSON.stringify({
            liveTouchProtocolVersion: 2,
            performanceMode: { active: true },
          }), { status: 200 });
        }
        if (path === '/global-effect-slots') {
          return new Response(JSON.stringify({ slots }), { status: 200 });
        }
        if (path === '/global-effect-slots/status') {
          return new Response(JSON.stringify({
            slots: slots.map(slot => ({
              ...slot,
              active: window.__pointerActiveSlots[slot.slotId] === true,
            })),
            controller: {},
          }), { status: 200 });
        }
        const action = path.match(/^\/global-effect-slots\/(\d+)\/(press|down|up)$/);
        if (action) {
          const slotId = Number(action[1]);
          if (action[2] === 'press') {
            window.__pointerActiveSlots[slotId] = !window.__pointerActiveSlots[slotId];
          } else {
            window.__pointerActiveSlots[slotId] = action[2] === 'down';
          }
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/globals') return new Response(JSON.stringify({ effects: {} }), { status: 200 });
        return window.__pointerBaseFetch(input, options);
      };
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('armState').textContent = 'ARMED';
      document.dispatchEvent(new CustomEvent('touchtransportstate', {
        detail: { online: true, phase: 'armed', armed: true, leaseAcquired: true },
      }));
      window.__wire._acceptPerformanceMode(true);
    }, CANONICAL_PERFORMANCE_SLOTS);
    await page.waitForFunction(() => {
      const face = document.querySelector('#fxGrid .fx-cell[data-slot="9"] [data-role=fxface]');
      return face && !face.disabled
        && face.closest('.fx-cell').dataset.performanceBound === 'true';
    });
    await captureEvidence(page, 'native_ipad_landscape_effects_performance_armed.png');

    const toggleSelector = '#fxGrid .fx-cell[data-slot="9"] [data-role=fxface]';
    await pointerDownUp(page, toggleSelector);
    await page.waitForFunction(() => window.__pointerRequests
      .filter(request => request.path === '/global-effect-slots/9/press').length === 1
      && document.querySelector('#fxGrid .fx-cell[data-slot="9"]').classList.contains('is-on'));
    await new Promise(resolve => setTimeout(resolve, 1900));
    await pointerDownUp(page, toggleSelector);
    await page.waitForFunction(() => window.__pointerRequests
      .filter(request => request.path === '/global-effect-slots/9/press').length === 2
      && !document.querySelector('#fxGrid .fx-cell[data-slot="9"]').classList.contains('is-on'));

    const holdSelector = '#fxGrid .fx-cell[data-slot="24"] [data-role=fxface]';
    await pointerDownUp(page, holdSelector, 90);
    await page.waitForFunction(() => {
      const edges = window.__pointerRequests
        .filter(request => /^\/global-effect-slots\/24\/(down|up)$/.test(request.path));
      return edges.length === 2
        && !document.querySelector('#fxGrid .fx-cell[data-slot="24"]').classList.contains('is-on');
    });
    const result = await page.evaluate(() => ({
      togglePresses: window.__pointerRequests
        .filter(request => request.path === '/global-effect-slots/9/press').length,
      holdEdges: window.__pointerRequests
        .filter(request => /^\/global-effect-slots\/24\/(down|up)$/.test(request.path))
        .map(request => request.path),
      activeSlots: Object.entries(window.__pointerActiveSlots)
        .filter(([, active]) => active).map(([slotId]) => Number(slotId)),
      errors: window.__pointerErrors,
    }));
    assert.equal(result.togglePresses, 2, 'two physical button presses must toggle ON then OFF once each');
    assert.deepEqual(result.holdEdges, [
      '/global-effect-slots/24/down',
      '/global-effect-slots/24/up',
    ], 'the physical hold button must serialize down then up');
    assert.deepEqual(result.activeSlots, [], 'toggle-off and hold release must leave no active slot');
    assert.deepEqual(result.errors, [], `physical Performance actions must stay error-free: ${JSON.stringify(result.errors)}`);

    const disarmed = await page.evaluate(() => {
      window.__wire.phase = 'idle';
      window.__wire.armed = false;
      document.getElementById('arm').classList.remove('is-armed');
      document.dispatchEvent(new CustomEvent('touchtransportstate', {
        detail: { online: true, phase: 'idle', armed: false, leaseAcquired: false },
      }));
      const cells = [...document.querySelectorAll('#fxGrid .fx-cell')];
      return {
        disabled: cells.every(cell => cell.querySelector('[data-role=fxface]').disabled),
        boundCount: cells.filter(cell => cell.dataset.performanceBound === 'true').length,
      };
    });
    assert.deepEqual(disarmed, { disabled: true, boundCount: 0 },
      'DISARM must return Performance to the disabled, unbound state');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('Performance effects require all canonical authoritative slots and send actions without configuration writes', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async (effectCatalog, canonicalSlots) => {
      const slots = canonicalSlots.map((slot) => ({ ...slot }));
      window.__performanceRequests = [];
      let capturedPerformancePreset = null;
      const activeSlots = {};
      const groups = {};
      [...document.querySelectorAll('#groupsGrid .fader-strip:not(.is-master)')].forEach((strip, index) => {
        groups[strip.querySelector('.fader-name').textContent] = index + 1;
      });
      const brightness = () => ({ active: true, ownerId: window.__wire.ownerId, revision: 5, rackRevision: 0, groups: {}, rackCeilings: {}, effectiveCaps: {} });
      const errors = [];
      document.addEventListener('panelerror', event => errors.push(event.detail && event.detail.message));
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        const method = options.method || 'GET';
        window.__performanceRequests.push({ method, path, body: options.body || null });
        if (path === '/layers/live_touch/presets' && method === 'POST') {
          capturedPerformancePreset = JSON.parse(options.body).state;
          return new Response(JSON.stringify({ status: 'ok', entry: { id: 'performance-saved', name: 'Performance saved', state: capturedPerformancePreset } }), { status: 200 });
        }
        if (path === '/global-effect-slots') {
          return new Response(JSON.stringify({ slots }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/global-effect-library') {
          return new Response(JSON.stringify({ effects: effectCatalog }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/global-effect-slots/status') {
          const controller = {};
          Object.keys(activeSlots).filter(slotId => activeSlots[slotId]).forEach((slotId) => {
            const slot = slots.find(item => item.slotId === Number(slotId));
            controller[slot.effectId] = { active: true, slotId: Number(slotId) };
          });
          return new Response(JSON.stringify({
            slots: slots.map(slot => ({ ...slot, active: !!activeSlots[slot.slotId] })),
            controller,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/globals') {
          return new Response(JSON.stringify({ effects: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/status') return new Response(JSON.stringify({
          liveTouchProtocolVersion: 2,
          performanceMode: { active: true },
        }), { status: 200 });
        if (path === '/dimmer-groups') return new Response(JSON.stringify(groups), { status: 200 });
        if (path === '/dimmers') return new Response(JSON.stringify({}), { status: 200 });
        if (path === '/layers/state') return new Response(JSON.stringify({ type: 'layerSettings', active: 'live_touch', target: 'live_touch', queued: null, transition: null, liveTouch: { armed: true, ready: true, ownerId: window.__wire.ownerId, pattern: '130_spatial_paint', patternTransition: null, sessionRevision: 4 } }), { status: 200 });
        if (path === '/touch-control/brightness') return new Response(JSON.stringify(brightness()), { status: 200 });
        if (/^\/global-effect-slots\/\d+\/press$/.test(path)) {
          const slotId = Number(path.split('/')[2]);
          activeSlots[slotId] = !activeSlots[slotId];
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      await window.__wire._loadFxCatalog();
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      window.__wire.liveBrightnessRevision = 4;
      window.__wire.sectionIds = groups;
      document.getElementById('arm').classList.add('is-armed');
      document.dispatchEvent(new CustomEvent('touchtransportstate', {
        detail: { online: true, phase: 'armed', armed: true, leaseAcquired: true },
      }));
      window.__wire._acceptPerformanceMode(true);
      await new Promise(resolve => setTimeout(resolve, 35));
      const visible = [...document.querySelectorAll('#fxGrid .fx-cell:not([hidden])')];
      await window.fetch('http://127.0.0.1:6968/global-effect-slots/9/press', { method: 'POST' });
      await window.__wire._refresh();
      const onBeforeSave = visible[0].classList.contains('is-on');
      document.getElementById('presetSave').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      await window.fetch('http://127.0.0.1:6968/global-effect-slots/9/press', { method: 'POST' });
      await window.__wire._refresh();
      await new Promise(resolve => setTimeout(resolve, 500));
      window.__performanceRequests = [];
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [{ id: 'performance-saved', name: 'Performance saved', state: capturedPerformancePreset }] } }));
      document.querySelector('.preset-row[data-preset-id="performance-saved"] .pr-recall').click();
      const preRecall = {
        savedFx: capturedPerformancePreset.fx.map(effect => [effect.slot, effect.e, effect.p, effect.on]),
        cells: [...document.querySelectorAll('#fxGrid .fx-cell:not([hidden])')].map(cell => [Number(cell.dataset.slot), cell.classList.contains('is-on'), cell.dataset.behavior]),
      };
      await new Promise(resolve => setTimeout(resolve, 3000));
      const recalledPerformance = {
        active: document.querySelector('.preset-row[data-preset-id="performance-saved"]').classList.contains('is-active'),
        identities: [...document.querySelectorAll('#fxGrid .fx-cell:not([hidden])')].map(cell => [Number(cell.dataset.slot), cell.dataset.fxkey, cell.dataset.preset]),
        activeSlots: Object.keys(activeSlots).filter(slotId => activeSlots[slotId]).map(Number),
        requests: window.__performanceRequests.slice(), errors: errors.slice(), preRecall, onBeforeSave,
      };
      const performanceUi = {
        visibleSlots: visible.map(cell => Number(cell.dataset.slot)),
        editHidden: document.getElementById('fxEditToggle').hidden,
        pickVisible: getComputedStyle(visible[0].querySelector('[data-role=fxpick]')).display,
      };
      window.__wire._acceptPerformanceMode(false);
      await new Promise(resolve => setTimeout(resolve, 35));
      const restoredSlots = [...document.querySelectorAll('#fxGrid .fx-cell:not([hidden])')].map(cell => Number(cell.dataset.slot));
      document.dispatchEvent(new CustomEvent('fxperformanceslots', { detail: { slots: [{ slotId: 9, enabled: true, label: 'Bad', effectId: 'missing', presetId: 'missing', behavior: 'toggle' }] } }));
      const recoveredCount = document.querySelectorAll('#fxGrid .fx-cell').length;
      return {
        ...performanceUi,
        requests: window.__performanceRequests.slice(), recalledPerformance,
        error: document.getElementById('wireStatus') && document.getElementById('wireStatus').textContent,
        restoredSlots, recoveredCount, capturedPerformancePreset,
      };
    }, EFFECT_CATALOG, CANONICAL_PERFORMANCE_SLOTS);
    assert.deepEqual(result.visibleSlots, Array.from({ length: 16 }, (_, index) => index + 9),
      `Performance must display all canonical engine-owned effect slots: ${JSON.stringify(result)}`);
    assert.equal(result.editHidden, true, 'Performance hides effect configuration');
    assert.equal(result.pickVisible, 'none', 'Performance presents an action surface, not a slot editor');
    assert.deepEqual(result.restoredSlots, Array.from({ length: 16 }, (_, index) => index + 9),
      'leaving canonical Performance projection restores the canonical Edit grid');
    assert.equal(result.recoveredCount, 16, 'a rejected Performance projection preserves a recoverable Edit grid');
    assert.deepEqual(result.capturedPerformancePreset.fx.map(effect => effect.slot), Array.from({ length: 16 }, (_, index) => index + 9),
      'a Performance preset captures the complete visible canonical topology without hidden Edit slots');
    assert.equal(result.recalledPerformance.onBeforeSave, true, 'the save observes authoritative ON truth for the permitted toggle');
    assert.equal(result.capturedPerformancePreset.fx.find(effect => effect.slot === 9).on, true,
      'the saved Performance payload retains authoritative toggle ON truth');
    assert.equal(result.recalledPerformance.active, true, `Performance recall must activate only after toggle readback: ${JSON.stringify(result.recalledPerformance)}`);
    assert.deepEqual(result.recalledPerformance.activeSlots, [9],
      `Performance recall restores its permitted toggle through /press and exact readback: ${JSON.stringify({ preRecall: result.recalledPerformance.preRecall, recalled: result.recalledPerformance })}`);
    assert.deepEqual(result.recalledPerformance.identities, CANONICAL_PERFORMANCE_SLOTS.map((slot) => [slot.slotId, slot.effectId, slot.presetId]),
      'Performance recall preserves the engine-projected slot identities');
    assert.equal(result.recalledPerformance.requests.filter(request => request.path === '/global-effect-slots/9/press').length, 1,
      `Performance recall must use exactly one permitted toggle press: ${JSON.stringify(result.recalledPerformance.requests)}`);
    assert.equal(result.recalledPerformance.requests.some(request => (request.method === 'PATCH'
      && /^\/global-effect-slots\/\d+$/.test(request.path))
      || request.path === '/effect-groups' || request.path.startsWith('/audio-bindings')
      || request.path === '/global-effects/disable-all'), false,
    `Performance preset recall must not mutate configuration: ${JSON.stringify(result.recalledPerformance.requests)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('Performance locks audio-binding configuration and restores it in Edit without PUTs', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const cell = document.querySelector('#fxGrid .fx-cell');
      const row = document.createElement('div');
      row.className = 'aud-row'; row.dataset.scope = 'effects'; row.dataset.bid = '9';
      row.innerHTML = '<select data-role="audpick"><option value="micKick">KICK</option></select><button data-role="audmode">LVL</button>';
      cell.appendChild(row);
      const calls = [];
      window.fetch = async (input, options = {}) => {
        calls.push({ path: String(input).slice(String(input).indexOf(':6968') + 5), method: options.method || 'GET' });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
      window.__wire._acceptPerformanceMode(true);
      row.querySelector('[data-role=audpick]').dispatchEvent(new Event('change', { bubbles: true }));
      row.querySelector('[data-role=audmode]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      const locked = { disabled: [...row.querySelectorAll('select,button')].every(control => control.disabled), label: row.querySelector('select').title };
      window.__wire._acceptPerformanceMode(false);
      row.querySelector('[data-role=audpick]').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      return { locked, unlocked: [...row.querySelectorAll('select,button')].every(control => !control.disabled), calls };
    });
    assert.equal(result.locked.disabled, true, 'Performance must disable audio configuration controls');
    assert.match(result.locked.label, /EDIT MODE REQUIRED/i, 'locked audio controls explain how to regain authority');
    assert.equal(result.calls.some(call => call.method === 'PUT' && call.path.startsWith('/audio-bindings/')), true,
      `Edit must restore binding interaction: ${JSON.stringify(result.calls)}`);
    assert.equal(result.calls.filter(call => call.method === 'PUT' && call.path.startsWith('/audio-bindings/')).length, 1,
      `Performance must emit zero audio PUTs: ${JSON.stringify(result.calls)}`);
    assert.equal(result.unlocked, true, 'leaving Performance re-enables audio configuration');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('Edit ARM prepare from the wire stages session palette before movementTrace slot PATCH without slot colours', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const wheelPalette = [
        { h: 0.00, s: 1, v: 1 },
        { h: 0.16, s: 1, v: 1 },
        { h: 0.33, s: 1, v: 1 },
        { h: 0.55, s: 1, v: 1 },
        { h: 0.78, s: 1, v: 1 },
      ];
      const slotsEl = document.getElementById('slots');
      slotsEl.dataset.palette = JSON.stringify(wheelPalette);
      const slot9Cell = document.querySelector('#fxGrid .fx-cell[data-slot="9"]');
      if (!slot9Cell || slot9Cell.dataset.fxkey !== 'movementTrace') {
        throw new Error('slot 9 must remain the canonical movementTrace action');
      }
      slot9Cell.classList.add('is-on');
      const groups = {};
      [...document.querySelectorAll('#groupsGrid .fader-strip:not(.is-master)')].forEach((strip, index) => {
        groups[strip.querySelector('.fader-name').textContent] = index + 1;
      });
      const slotRecords = {};
      let capturedPrepare = null;
      const brightnessPayload = () => ({
        active: true,
        ownerId: window.__wire.ownerId,
        revision: 5,
        rackRevision: 0,
        groups: {},
        rackCeilings: {},
        effectiveCaps: {},
      });
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET';
        if (path === '/touch-control/brightness') {
          return new Response(JSON.stringify(brightnessPayload()), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path === '/global-effect-slots' && method === 'GET') {
          return new Response(JSON.stringify({ slots: Object.values(slotRecords) }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (/^\/global-effect-slots\/\d+$/.test(path) && method === 'PATCH') {
          const slotId = Number(path.split('/').pop());
          slotRecords[slotId] = Object.assign({ slotId }, JSON.parse(options.body));
          return new Response(JSON.stringify(slotRecords[slotId]), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path === '/global-effect-slots/status' && method === 'GET') {
          return new Response(JSON.stringify({
            slots: Object.values(slotRecords).map(slot => ({ ...slot, active: false })),
            controller: {},
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path === '/layers/live_touch/prepare' && method === 'POST') {
          capturedPrepare = JSON.parse(options.body);
          for (const op of capturedPrepare.operations) {
            if (op.method === 'PATCH' && /^\/global-effect-slots\/\d+$/.test(op.path)) {
              const slotId = Number(op.path.split('/').pop());
              slotRecords[slotId] = Object.assign({ slotId }, op.body);
            }
          }
          return new Response(JSON.stringify({
            sessionRevision: 5,
            brightnessRevision: 6,
            operationCount: capturedPrepare.operations.length,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      };
      window.__wire.phase = 'arming';
      window.__wire.armed = false;
      window.__wire.performanceModeActive = false;
      window.__wire.sessionRevision = 4;
      window.__wire.liveBrightnessRevision = 4;
      window.__wire.sectionIds = groups;
      window.__wire.exports = {};
      await window.__wire._assertLiveSurfaceState();
      const operations = capturedPrepare && capturedPrepare.operations ? capturedPrepare.operations : [];
      const paletteIndex = operations.findIndex(op => op.method === 'POST' && op.path === '/layers/live_touch/palette');
      const slot9Index = operations.findIndex(op => op.method === 'PATCH' && op.path === '/global-effect-slots/9');
      const slot9Patch = slot9Index >= 0 ? operations[slot9Index] : null;
      const paletteOp = paletteIndex >= 0 ? operations[paletteIndex] : null;
      return {
        paletteIndex,
        slot9Index,
        wheelPalette,
        paletteBody: paletteOp && paletteOp.body,
        slot9Patch: slot9Patch ? {
          effectId: slot9Patch.body && slot9Patch.body.effectId,
          paramsOverride: slot9Patch.body && slot9Patch.body.paramsOverride,
        } : null,
        operationPaths: operations.map(op => `${op.method} ${op.path}`),
      };
    });
    assert.ok(result.paletteIndex >= 0, `prepare must include session palette: ${JSON.stringify(result.operationPaths)}`);
    assert.deepEqual(result.paletteBody, { colorPalette: result.wheelPalette },
      'prepare palette operation must carry the exact staged wheel colours');
    assert.ok(result.slot9Patch, `prepare must provision slot 9: ${JSON.stringify(result.operationPaths)}`);
    assert.equal(result.slot9Patch.effectId, 'movementTrace');
    assert.equal(result.slot9Patch.paramsOverride && result.slot9Patch.paramsOverride.colors, undefined,
      'movementTrace slot PATCH must not carry session-owned colours');
    assert.ok(result.paletteIndex < result.slot9Index,
      `palette must precede slot 9 PATCH: ${JSON.stringify(result.operationPaths)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a stale preset recall fails loudly without claiming the preset is active', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });

    const recalled = await page.evaluate(() => {
      window.__presetRecallErrors = [];
      document.addEventListener('panelerror', event => {
        window.__presetRecallErrors.push(event.detail && event.detail.message);
      });
      document.dispatchEvent(new CustomEvent('liveTouchPresets', {
        detail: {
          entries: [{
            id: 'stale-preset',
            name: 'Stale catalog identity',
            state: {
              v: 4,
              groups: [],
              fx: [{ slot: '9', e: 'removedEffect', p: 'removedPreset', on: true }],
            },
          }],
        },
      }));
      const transition = document.getElementById('presetXfade');
      for (let attempts = 0; attempts < 3 && transition.textContent !== 'SNAP'; attempts += 1) {
        transition.click();
      }
      const row = document.querySelector('.preset-row[data-preset-id="stale-preset"]');
      row.querySelector('.pr-recall').click();
      return {
        active: row.classList.contains('is-active'),
        errors: window.__presetRecallErrors.slice(),
      };
    });

    assert.equal(recalled.active, false,
      'a rejected preset must never be presented as the active engine look');
    assert.ok(recalled.errors.some(message => /missing|absent|refus/i.test(message)),
      `the rejected operation must explain the stale identity: ${JSON.stringify(recalled.errors)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('armed preset mutations carry the same owner identity as Live Touch output writes', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });

    const result = await page.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      window.__presetMutationRequests = [];
      window.fetch = async (input, options = {}) => {
        const rawUrl = String(input);
        const path = rawUrl.slice(rawUrl.indexOf(':6968') + 5);
        window.__presetMutationRequests.push({
          path,
          method: options.method || 'GET',
          owner: options.headers && (options.headers['X-Touch-Control-Owner']
            || options.headers['x-touch-control-owner']),
        });
        return new Response(JSON.stringify({
          status: 'ok',
          entry: { id: 'saved-owner-preset', name: 'Preset 1', state: {} },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('presetSave').click();
      await new Promise(resolve => setTimeout(resolve, 20));
      return window.__presetMutationRequests.find(request => (
        request.method === 'POST' && request.path === '/layers/live_touch/presets'
      ));
    });

    assert.ok(result, 'SAVE did not issue the preset create request');
    assert.match(result.owner || '', /^touch_control_/,
      `armed preset mutation omitted the Live lease owner: ${JSON.stringify(result)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('preset list save, broadcast reload, and confirmed delete stay engine-owned', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const calls = [];
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET'; calls.push({ path, method });
        if (path === '/layers/live_touch/presets' && method === 'POST') {
          return new Response(JSON.stringify({ status: 'ok', entry: { id: 'saved', name: 'Preset 1', state: {} } }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      document.getElementById('presetSave').click();
      await new Promise(resolve => setTimeout(resolve, 20));
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [{ id: 'saved', name: 'Preset 1', state: {} }] } }));
      const listedAfterReload = document.querySelectorAll('.preset-row').length;
      const deleteButton = document.querySelector('.preset-row[data-preset-id="saved"] .pr-delete');
      deleteButton.click(); deleteButton.click();
      await new Promise(resolve => setTimeout(resolve, 20));
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      return { calls, listedAfterReload, listedAfterDelete: document.querySelectorAll('.preset-row').length };
    });
    assert.equal(result.listedAfterReload, 1, 'the engine broadcast repopulates the saved preset list');
    assert.equal(result.listedAfterDelete, 0, 'the delete broadcast, not optimistic DOM state, clears the row');
    assert.ok(result.calls.some(call => call.path === '/layers/live_touch/presets' && call.method === 'POST'));
    assert.ok(result.calls.some(call => call.path === '/layers/live_touch/presets/saved' && call.method === 'DELETE'));
    await page.close();
  } finally { await browser.close(); }
});

test('extended Color Hub scheme survives save, color change, and preset recall', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      window.__wire.performanceModeActive = false;
      window.__wire._preflightPresetRecall = () => Promise.resolve();
      window.__wire._settlePresetRecall = () => Promise.resolve();
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('armState').textContent = 'ARMED';
      const errors = [];
      document.addEventListener('panelerror', event => errors.push(event.detail && event.detail.message));
      let captured = null;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET';
        if (path === '/layers/live_touch/presets' && method === 'POST') {
          captured = JSON.parse(options.body).state;
          return new Response(JSON.stringify({
            status: 'ok',
            entry: { id: 'golden-saved', name: 'Preset 1', state: captured },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      document.querySelector('#chSchemeActionsTwo [data-scheme="golden"]').click();
      const savedPalette = JSON.parse(document.getElementById('slots').dataset.palette);
      document.getElementById('presetSave').click();
      for (let attempts = 0; attempts < 40 && !captured; attempts += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      document.querySelector('#paletteActions [data-act="contrast"]').click();
      const changedPalette = JSON.parse(document.getElementById('slots').dataset.palette);
      document.dispatchEvent(new CustomEvent('liveTouchPresets', {
        detail: { entries: [{ id: 'golden-saved', name: 'Preset 1', state: captured }] },
      }));
      document.querySelector('.preset-row[data-preset-id="golden-saved"] .pr-recall').click();
      await new Promise(resolve => setTimeout(resolve, 200));
      return {
        savedGen: captured && captured.gen,
        savedFollow: captured && captured.follow,
        savedPalette,
        changedPalette,
        recalledPalette: JSON.parse(document.getElementById('slots').dataset.palette),
        active: document.querySelector('.preset-row[data-preset-id="golden-saved"]').classList.contains('is-active'),
        errors,
      };
    });
    assert.equal(result.savedGen, 'golden');
    assert.equal(result.savedFollow, false);
    assert.notDeepEqual(result.changedPalette, result.savedPalette,
      'the operator color change must differ from the saved look');
    assert.deepEqual(result.recalledPalette, result.savedPalette,
      'recall must restore the exact five staged colors from the extended generator');
    assert.equal(result.active, true, `successful color recall did not activate its row: ${JSON.stringify(result)}`);
    assert.equal(result.errors.some(message => /generator|follow/i.test(message)), false,
      `valid extended generator was rejected: ${JSON.stringify(result.errors)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a valid preset refuses recall while the Live lease is disarmed without mutating the active row', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const rejected = await page.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      let captured = null;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path === '/layers/live_touch/presets' && options.method === 'POST') {
          captured = JSON.parse(options.body).state;
          return new Response(JSON.stringify({ status: 'ok', entry: { id: 'captured', name: 'Preset 1', state: captured } }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      document.getElementById('presetSave').click();
      await new Promise(resolve => setTimeout(resolve, 20));
      document.dispatchEvent(new CustomEvent('liveTouchPresets', {
        detail: { entries: [{ id: 'lease-rejected', name: 'Lease rejected', state: captured }] },
      }));
      window.__presetLeaseErrors = [];
      document.addEventListener('panelerror', event => window.__presetLeaseErrors.push(event.detail && event.detail.message));
      window.__wire.phase = 'idle';
      window.__wire.armed = false;
      document.getElementById('arm').classList.remove('is-armed');
      document.querySelector('.preset-row[data-preset-id="lease-rejected"] .pr-recall').click();
      await new Promise(resolve => setTimeout(resolve, 20));
      const row = document.querySelector('.preset-row[data-preset-id="lease-rejected"]');
      return { active: row.classList.contains('is-active'), errors: window.__presetLeaseErrors };
    });
    assert.equal(rejected.active, false, 'a disarmed preset recall must not claim the engine look changed');
    assert.ok(rejected.errors.some(message => /ARM Live Touch|lease|refused/i.test(message)),
      `lease rejection must direct the operator to ARM: ${JSON.stringify(rejected.errors)}`);
    await ensureWorkspacePanelOpen(page, 'presets-panel');
    await captureEvidence(page, 'native_ipad_landscape_presets_lease_refusal_error.png');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('an armed captured preset validates canonically, becomes active only after the full barrier, and reports partial apply', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [] } }));
      const groups = {};
      [...document.querySelectorAll('#groupsGrid .fader-strip:not(.is-master)')].forEach((strip, index) => {
        groups[strip.querySelector('.fader-name').textContent] = index + 1;
      });
      window.__wire.phase = 'armed'; window.__wire.armed = true;
      window.__wire.performanceModeActive = false;
      window.__wire.sectionIds = groups;
      window.__wire.liveBrightnessRevision = 4;
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('armState').textContent = 'ARMED';
      let captured = null;
      let failSpatial = false;
      let failPattern = false;
      const slotRecords = {};
      const requests = [];
      const errors = [];
      document.addEventListener('panelerror', event => errors.push(event.detail && event.detail.message));
      const brightness = () => ({ active: true, ownerId: window.__wire.ownerId, revision: 5, rackRevision: 0, groups: {}, rackCeilings: {}, effectiveCaps: {} });
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        const method = options.method || 'GET';
        requests.push({ path, method });
        if (path === '/status') return new Response(JSON.stringify({ liveTouchProtocolVersion: 2, performanceMode: { active: false } }), { status: 200 });
        if (path === '/dimmer-groups') return new Response(JSON.stringify(groups), { status: 200 });
        if (path === '/dimmers') return new Response(JSON.stringify({}), { status: 200 });
        if (path === '/layers/state') return new Response(JSON.stringify({
          type: 'layerSettings', active: 'live_touch', target: 'live_touch', queued: null, transition: null,
          liveTouch: { armed: true, ownerId: window.__wire.ownerId, ready: true, pattern: '130_spatial_paint', patternTransition: null, sessionRevision: 4 },
        }), { status: 200 });
        if (path === '/layers/live_touch/presets' && method === 'POST') {
          captured = JSON.parse(options.body).state;
          return new Response(JSON.stringify({ status: 'ok', entry: { id: 'saved-ok', name: 'Saved', state: captured } }), { status: 200 });
        }
        if (path === '/global-effect-slots' && method === 'GET') {
          return new Response(JSON.stringify({ slots: Object.values(slotRecords) }), { status: 200 });
        }
        if (/^\/global-effect-slots\/\d+$/.test(path) && method === 'PATCH') {
          const slotId = Number(path.split('/').pop());
          slotRecords[slotId] = Object.assign({ slotId }, JSON.parse(options.body));
          return new Response(JSON.stringify(slotRecords[slotId]), { status: 200 });
        }
        if (path === '/touch-control/brightness') return new Response(JSON.stringify(brightness()), { status: 200 });
        if (path === '/layers/live_touch/pattern' && failPattern) return new Response('background transition rejected', { status: 409 });
        if (path === '/param-center' && failPattern) await new Promise(resolve => setTimeout(resolve, 40));
        if (path === '/spatial-paint' && failSpatial) return new Response('spatial rejected', { status: 409 });
        if (path === '/global-effect-slots/status') return new Response(JSON.stringify({
          slots: Object.values(slotRecords).map(slot => ({ ...slot, active: false })),
          controller: {},
        }), { status: 200 });
        if (path === '/globals') return new Response(JSON.stringify({ effects: {} }), { status: 200 });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
      document.getElementById('presetSave').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      const canonical = captured && {
        master: captured.groups.find(group => group.master),
        nonMasterNumeric: captured.groups.filter(group => !group.master).every(group => Number.isInteger(group.idx)),
      };
      const binding = document.querySelector('#fxGrid .fx-cell .fx-pick');
      const savedBinding = binding.value;
      const changedBinding = [...binding.options].find(option => option.value !== savedBinding);
      binding.value = changedBinding.value;
      binding.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 40));
      requests.length = 0;
      document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [{ id: 'saved-ok', name: 'Saved', state: captured }] } }));
      document.querySelector('.preset-row[data-preset-id="saved-ok"] .pr-recall').click();
      await new Promise(resolve => setTimeout(resolve, 3500));
      const successActive = document.querySelector('.preset-row[data-preset-id="saved-ok"]').classList.contains('is-active');
      const recalledBinding = document.querySelector('#fxGrid .fx-cell .fx-pick').value;
      window.__runAtomicPresetFailures = async () => {
        captured.background = { playlist: 'ambient', entryId: 'golden-hour' };
        failPattern = true;
        document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [
          { id: 'saved-ok', name: 'Saved', state: captured },
          { id: 'saved-pattern-fail', name: 'Pattern fails', state: captured },
        ] } }));
        document.querySelector('.preset-row[data-preset-id="saved-pattern-fail"] .pr-recall').click();
        await new Promise(resolve => setTimeout(resolve, 300));
        const failedPatternActive = document.querySelector('.preset-row[data-preset-id="saved-pattern-fail"]').classList.contains('is-active');
        failPattern = false;
        failSpatial = true;
        document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [
          { id: 'saved-ok', name: 'Saved', state: captured },
          { id: 'saved-fail', name: 'Fails', state: captured },
        ] } }));
        document.querySelector('.preset-row[data-preset-id="saved-fail"] .pr-recall').click();
        await new Promise(resolve => setTimeout(resolve, 1200));
        return { failedPatternActive, failedActive: document.querySelector('.preset-row[data-preset-id="saved-fail"]').classList.contains('is-active'), errors };
      };
      return { canonical, successActive, savedBinding, recalledBinding, recallRequests: requests.slice() };
    });
    await ensureWorkspacePanelOpen(page, 'presets-panel');
    await captureEvidence(page, 'native_ipad_landscape_presets_success_active.png');
    const failures = await page.evaluate(() => window.__runAtomicPresetFailures());
    await captureEvidence(page, 'native_ipad_landscape_presets_partial_apply_error.png');
    assert.equal(result.canonical.master.idx, -1, 'new captures encode the master as -1');
    assert.equal(result.canonical.master.master, true, 'new captures identify exactly one master');
    assert.equal(result.canonical.nonMasterNumeric, true, 'new captures use numeric non-master group identities');
    assert.equal(result.successActive, true, `the row becomes active only after all preset writes/readbacks resolve: ${JSON.stringify(result)}`);
    assert.equal(result.recalledBinding, result.savedBinding, 'Edit recall restores binding A after the operator changed it to B');
    assert.ok(result.recallRequests.some(request => request.method === 'PATCH' && /^\/global-effect-slots\/9$/.test(request.path)),
      `Edit recall must PATCH the restored slot identity: ${JSON.stringify(result.recallRequests)}`);
    assert.ok(result.recallRequests.some(request => request.method === 'GET' && request.path === '/global-effect-slots'),
      `Edit recall must read back restored slot identities before activation: ${JSON.stringify(result.recallRequests)}`);
    assert.equal(failures.failedPatternActive, false, 'a fast rejected background transition must fail the delayed preset barrier');
    assert.equal(failures.failedActive, false, 'a mid-apply rejection must never mark its row active');
    assert.ok(failures.errors.some(message => /partially applied.*DISARM.*ARM/i.test(message)),
      `partial apply must give recovery steps: ${JSON.stringify(failures.errors)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('constrained Color Hub uses one touch-scroll owner to reach every card action', { timeout: 60_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'ipad_1024x682', width: 1024, height: 682, deviceScaleFactor: 1 },
      { name: 'split_900x560', width: 900, height: 560, deviceScaleFactor: 1 },
    ]) {
      const page = await browser.newPage();
      await openPanel(page, viewport);

      for (const cardKey of ['two', 'turns', 'follow']) {
        const reachability = await page.evaluate((key) => {
          const panel = document.getElementById('colorHubPanel');
          const body = panel.querySelector(':scope > .panel-body');
          document.getElementById('chStrip').hidden = false;
          document.querySelector(`#chTabs [data-card="${key}"]`).click();
          const cardId = key === 'two' ? 'chCardTwo' : key === 'turns' ? 'chCardTurns' : 'chCardFollow';
          const card = document.getElementById(cardId);
          const actions = Array.from(card.querySelectorAll('button, [role="button"], input, select'))
            .filter(element => getComputedStyle(element).display !== 'none');
          const pageOwner = document.querySelector('.content-grid');
          const bodyNeedsScroll = body.scrollHeight > body.clientHeight + 1;
          const scrollOwner = bodyNeedsScroll ? body : pageOwner;
          const bodyBox = scrollOwner.getBoundingClientRect();
          let maxScrollTop = 0;
          const actionResults = actions.map(element => {
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            maxScrollTop = Math.max(maxScrollTop, scrollOwner.scrollTop);
            const box = element.getBoundingClientRect();
            return {
              id: element.id || element.textContent.trim(),
              top: box.top,
              bottom: box.bottom,
              visible: box.bottom <= bodyBox.bottom + 1 && box.top >= bodyBox.top - 1,
            };
          });
          return {
            overflowY: getComputedStyle(body).overflowY,
            needsScroll: scrollOwner.scrollHeight > scrollOwner.clientHeight + 1,
            scrollOwner: bodyNeedsScroll ? 'colorhub-body' : 'content-grid',
            scrollTop: maxScrollTop,
            nestedScrollOwners: Array.from(card.querySelectorAll('*')).filter(element => {
              const style = getComputedStyle(element);
              return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
            }).length,
            actions: actionResults,
          };
        }, cardKey);

        const context = `${viewport.name} card=${cardKey} ${JSON.stringify(reachability)}`;
        if (reachability.needsScroll) {
          if (reachability.scrollOwner === 'colorhub-body') {
            assert.match(reachability.overflowY, /auto|scroll/,
              `the Color Hub body must own vertical touch scrolling in the two-panel landscape layout: ${context}`);
          }
          assert.ok(reachability.scrollTop > 0, `the Color Hub body did not scroll: ${context}`);
        }
        assert.equal(reachability.nestedScrollOwners, 0,
          `Color Hub cards must not create nested-scroll traps: ${context}`);
        assert.ok(reachability.actions.length > 0, `card has no actionable controls: ${context}`);
        assert.ok(reachability.actions.every(action => action.visible),
          `the Color Hub scroll owner must make every active-card action individually reachable: ${context}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('Legacy Color and Color Hub share palette authority and settle an authoritative crossfade', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(() => {
      const slots = document.getElementById('slots');
      const schemes = [...document.querySelectorAll('#chSchemeActionsTwo [data-scheme]')]
        .map((button) => button.dataset.scheme);
      const sharedSchemes = window.ColorControlCore.SCHEME_IDS.slice();
      document.querySelector('#chSchemeActionsTwo [data-scheme="golden"]').click();
      const goldenPalette = JSON.parse(slots.dataset.palette);
      const before = slots.dataset.palette;
      document.querySelector('#paletteActions [data-act="contrast"]').click();
      const legacyPalette = slots.dataset.palette;
      const pair = [{ c1: { h: .12, s: .9, v: .8 }, c2: { h: .62, s: .9, v: .8 } },
        { c1: { h: .62, s: .9, v: .8 }, c2: { h: .12, s: .9, v: .8 } }];
      document.dispatchEvent(new CustomEvent('colorautopilot', { detail: {
        active: true, mode: 'palettes', palettes: pair, delay_s: 1, transitionMs: 500,
      } }));
      const running = document.getElementById('chRunTwo').textContent;
      const hubPalette = slots.dataset.palette;
      const abBadges = [...document.querySelectorAll('#chRingTwo .ch-swatch-btn')].map((btn, index) => ({
        index,
        isA: btn.classList.contains('is-a'),
        isB: btn.classList.contains('is-b'),
      }));
      document.dispatchEvent(new CustomEvent('colorautopilot', { detail: {
        active: false, mode: 'palettes', palettes: pair, delay_s: 1, transitionMs: 500,
      } }));
      return {
        before,
        legacyPalette,
        hubPalette,
        running,
        settled: document.getElementById('chRunTwo').textContent,
        schemes,
        sharedSchemes,
        goldenPalette,
        abBadges,
      };
    });
    assert.deepEqual(result.schemes, result.sharedSchemes,
      'Color Hub renders every scheme from the shared Deck authority');
    assert.equal(new Set(result.goldenPalette.map((colour) => colour.h)).size, 5,
      'the GOLDEN scheme publishes five distinct authoritative hue slots');
    assert.notEqual(result.legacyPalette, result.before, 'a Legacy Color action republishes the shared palette');
    assert.equal(result.running, 'STOP', 'authoritative crossfade state renders as running');
    assert.equal(result.hubPalette, result.legacyPalette,
      'two-colour crossfade keeps the exact-five ring unchanged while A/B transport updates');
    assert.ok(result.abBadges.some((entry) => entry.isA) && result.abBadges.some((entry) => entry.isB),
      'authoritative crossfade adopts A/B selection without replacing the five-slot ring');
    assert.equal(result.settled, 'RUN CROSSFADE', 'authoritative inactive state settles the crossfade control');
    await page.close();
  } finally { await browser.close(); }
});

test('operator evidence states open every Live Touch workspace with reachable controls', { timeout: 60_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const desktop = await browser.newPage();
    await openPanel(desktop, { width: 1440, height: 900, deviceScaleFactor: 1 });
    await captureEvidence(desktop, 'web_desktop_header_pattern_arm_disarmed.png');
    await desktop.evaluate(() => {
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      document.getElementById('arm').classList.add('is-armed');
      document.getElementById('armState').textContent = 'ARMED';
      const picker = document.getElementById('patternSel');
      const target = [...picker.options].find((option) => option.dataset.pattern === '00_golden_hour_wash');
      if (!target) throw new Error('evidence fixture is missing the Golden Hour background');
      picker.value = target.value;
      picker.dataset.confirmedPattern = '130_spatial_paint';
      window.__wire._acceptPatternLayerState({ liveTouch: {
        pattern: '130_spatial_paint',
        patternTransition: { id: 'evidence-crossfade', fromPattern: '130_spatial_paint', toPattern: '00_golden_hour_wash', mode: 'trans_crossfade', durationMs: 500, progress: 0.4 },
      } });
    });
    await captureEvidence(desktop, 'web_desktop_header_pattern_pending_a_to_b.png');
    await desktop.evaluate(() => {
      window.__wire.phase = 'idle';
      window.__wire.armed = false;
      document.getElementById('arm').classList.remove('is-armed');
      document.getElementById('armState').textContent = 'DISARMED';
      window.__wire._acceptPatternLayerState({ liveTouch: {
        pattern: '130_spatial_paint', patternTransition: null,
      } });
    });

    await openWorkspacePanel(desktop, 'spatial-panel');
    const spatialDock = await desktop.evaluate(() => document.querySelector('.spatial-panel').classList.contains('is-docked'));
    assert.equal(spatialDock, true, 'Spatial panel hides through the workspace control');
    await captureEvidence(desktop, 'web_desktop_spatial_hidden_workspace.png');
    await openWorkspacePanel(desktop, 'spatial-panel');
    assert.equal(await desktop.$eval('.spatial-panel', panel => panel.classList.contains('is-docked')), false,
      'Spatial panel reopens through the same workspace control');
    await captureEvidence(desktop, 'web_desktop_spatial_full_map_reopened.png');

    await desktop.evaluate(() => document.dispatchEvent(new CustomEvent('performancemode', { detail: { active: false } })));
    await desktop.click('#fxEditToggle');
    assert.equal(await desktop.$eval('.effects-panel', panel => panel.classList.contains('is-editing')), true,
      'Effects Edit exposes its configuration controls');
    await captureEvidence(desktop, 'web_desktop_effects_edit_controls.png');
    await desktop.evaluate(() => document.dispatchEvent(new CustomEvent('performancemode', { detail: { active: true } })));
    await desktop.evaluate(() => document.dispatchEvent(new CustomEvent('fxperformanceslots', { detail: { slots: [
      { slotId: 9, enabled: true, label: 'Pulse', effectId: 'movementTrace', presetId: 'pulse_slow_fade', behavior: 'toggle' },
      { slotId: 11, enabled: true, label: 'Kick', effectId: 'kickPunch', presetId: 'punch', behavior: 'trigger' },
      { slotId: 24, enabled: true, label: 'Freeze', effectId: 'freeze', presetId: 'hold', behavior: 'hold' },
    ] } })));
    assert.equal(await desktop.$eval('#fxEditToggle', button => button.hidden && button.disabled), true,
      'Performance removes effect configuration controls');
    await captureEvidence(desktop, 'web_desktop_effects_performance_trigger_only.png');

    await ensureWorkspacePanelOpen(desktop, 'groups-panel');
    const groupAction = await desktop.evaluate(() => {
      const panel = document.querySelector('.groups-panel');
      const action = panel.querySelector('#groupProfileSelect');
      const r = action.getBoundingClientRect(); const p = panel.getBoundingClientRect();
      return { docked: panel.classList.contains('is-docked'), actionable: r.width >= 44 && r.height >= 44, contained: r.left >= p.left && r.right <= p.right };
    });
    assert.deepEqual(groupAction, { docked: false, actionable: true, contained: true }, 'Groups controls are visible and touch-safe');
    await captureEvidence(desktop, 'web_desktop_groups_open_controls.png');

    await ensureWorkspacePanelOpen(desktop, 'meter-strip');
    const audioAction = await desktop.evaluate(() => {
      const panel = document.getElementById('meterStrip'); const r = panel.getBoundingClientRect();
      return { docked: panel.classList.contains('is-docked'), width: r.width, height: r.height, visibleRows: panel.querySelectorAll('.sig-row').length };
    });
    assert.equal(audioAction.docked, false, 'Audio workspace opens from its rail control');
    assert.ok(audioAction.width > 400 && audioAction.height > 40 && audioAction.visibleRows > 0, JSON.stringify(audioAction));
    await captureEvidence(desktop, 'web_desktop_audio_full_open.png');

    const ipad = await browser.newPage();
    await openPanel(ipad, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await captureEvidence(ipad, 'native_ipad_landscape_header_pattern_arm_disarmed.png');
    await captureEvidence(ipad, 'native_ipad_landscape_color_main_open.png');
    await ensureWorkspacePanelOpen(ipad, 'color-panel');
    await captureEvidence(ipad, 'native_ipad_landscape_legacy_color_open.png');
    await ensureWorkspacePanelOpen(ipad, 'presets-panel');
    await ipad.evaluate(() => document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: { entries: [
      { id: 'evidence-1', name: 'Harbor Recall', state: { mode: 'spatial' } },
      { id: 'evidence-2', name: 'Night Watch', state: { mode: 'effect' } },
    ] } })));
    await captureEvidence(ipad, 'native_ipad_landscape_presets_populated_list.png');

    const ipad1194 = await browser.newPage();
    await openPanel(ipad1194, { width: 1194, height: 834, deviceScaleFactor: 1 });
    await captureEvidence(ipad1194, 'native_ipad_landscape_1194x834_header_pattern_arm_disarmed.png');

    const split = await browser.newPage();
    await openPanel(split, { width: 900, height: 560, deviceScaleFactor: 1 });
    await ensureWorkspacePanelOpen(split, 'colorhub-panel');
    await split.evaluate(() => {
      const colorPanel = document.querySelector('.colorhub-panel');
      if (colorPanel.classList.contains('is-docked')) throw new Error('Color Hub did not open for constrained evidence');
      const body = document.querySelector('.colorhub-panel .panel-body');
      body.scrollTop = body.scrollHeight;
      document.querySelector('#chTabs [data-card="follow"]').click();
    });
    await (await split.$('.colorhub-panel')).screenshot({ path: path.join(SCREENSHOT_DIR, 'constrained_split_900x560_color_scrolled_bottom_actions.png') });
    await split.close(); await ipad1194.close(); await ipad.close(); await desktop.close();
  } finally {
    await browser.close();
  }
});

test('Color Hub COLOR TRANSITION fader is visible, touch-accessible, and mirrors Legacy Color', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await ensureWorkspacePanelOpen(page, 'colorhub-panel');
    const result = await page.evaluate(() => {
      const fader = document.getElementById('chColorTransitionFader');
      const label = document.getElementById('chColorTransitionVal');
      const legacyOut = document.getElementById('fadeVal');
      if (!fader || !label) throw new Error('Color Hub transition fader is missing');
      const before = window.ColorTransitionTiming.ms();
      fader.value = '875';
      fader.dispatchEvent(new Event('input', { bubbles: true }));
      const afterHub = window.ColorTransitionTiming.ms();
      const legacyMatches = legacyOut.textContent === window.ColorTransitionTiming.formatLabel(afterHub);
      document.querySelector('.slider-vertical.fade').dispatchEvent(new CustomEvent('sliderchange', { bubbles: true }));
      return {
        visible: fader.offsetParent !== null,
        width: fader.getBoundingClientRect().width,
        height: fader.getBoundingClientRect().height,
        label: label.textContent,
        before,
        afterHub,
        legacyMatches,
        ariaLive: document.getElementById('panelStatus').getAttribute('aria-live'),
      };
    });
    assert.ok(result.visible, 'Color Hub transition fader must render in the open panel');
    assert.ok(result.width >= 120 && result.height >= 32, JSON.stringify(result));
    assert.equal(result.label, '4.4s');
    assert.notEqual(result.afterHub, result.before);
    assert.equal(result.ariaLive, 'polite');
    await page.close();
  } finally { await browser.close(); }
});

test('Color Hub crossfade uses the shared fader and restages parallel five-colour targets', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await ensureWorkspacePanelOpen(page, 'colorhub-panel');
    const result = await page.evaluate(() => {
      const writes = [];
      document.addEventListener('colorautopilotwrite', (event) => {
        writes.push({
          method: event.detail.method,
          body: JSON.parse(JSON.stringify(event.detail.body)),
        });
      });

      const fader = document.getElementById('chColorTransitionFader');
      fader.value = '875';
      fader.dispatchEvent(new Event('input', { bubbles: true }));
      const startTimingMs = window.ColorTransitionTiming.ms();
      document.getElementById('chRunTwo').click();
      const start = writes.find((write) => write.method === 'POST' && write.body.active === true);
      if (!start) throw new Error('RUN CROSSFADE did not publish a start request');

      document.dispatchEvent(new CustomEvent('colorautopilot', {
        detail: {
          active: true,
          mode: 'palettes',
          palettes: start.body.palettes,
          delay_s: start.body.delay_s,
          transitionMs: start.body.transitionMs,
        },
      }));
      fader.value = '500';
      fader.dispatchEvent(new Event('input', { bubbles: true }));
      const activeTimingMs = window.ColorTransitionTiming.ms();
      const timingPatch = writes.find((write) => (
        write.method === 'PATCH'
        && write.body.transitionMs === activeTimingMs
        && write.body.palettes === undefined
      ));
      if (!timingPatch) throw new Error('running crossfade did not accept the shared fader timing');
      document.querySelector('#paletteActions [data-act="contrast"]').click();
      const restage = writes.find((write) => write.method === 'PATCH' && Array.isArray(write.body.palettes));
      if (!restage) throw new Error('running crossfade did not publish a palette restage');

      return {
        startTimingMs,
        activeTimingMs,
        timingPatch: timingPatch.body,
        start: start.body,
        restage: restage.body,
      };
    });

    assert.equal(result.start.transitionMs, result.startTimingMs,
      'RUN CROSSFADE must use the visible COLOR TRANSITION fader');
    assert.equal(result.timingPatch.transitionMs, result.activeTimingMs,
      'moving the shared fader must retune a running crossfade');
    assert.equal(result.start.palettes.length, result.start.livePalettes.length);
    result.start.livePalettes.forEach((palette) => assert.equal(palette.length, 5));
    assert.equal(result.restage.palettes.length, result.restage.livePalettes.length,
      'a live restage must keep palettes and livePalettes parallel');
    result.restage.livePalettes.forEach((palette) => assert.equal(palette.length, 5));
    await page.close();
  } finally { await browser.close(); }
});

test('Color Hub A/B selection, capability depth, live feedback, and Follow Note readback stay coherent', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    await ensureWorkspacePanelOpen(page, 'colorhub-panel');
    const result = await page.evaluate(() => {
      const writes = [];
      document.addEventListener('colorautopilotwrite', (event) => {
        writes.push({
          method: event.detail.method,
          body: JSON.parse(JSON.stringify(event.detail.body)),
        });
      });

      const ring = JSON.parse(document.getElementById('slots').dataset.palette);
      document.getElementById('chArmBTwo').click();
      document.querySelectorAll('#chRingTwo .ch-swatch-btn')[4].click();
      const armedB = document.getElementById('chArmBTwo');
      const selection = JSON.parse(document.getElementById('slots').dataset.paletteSelection);
      document.getElementById('chRunTwo').click();
      const start = writes.find((write) => write.method === 'POST' && write.body.active === true);
      if (!start) throw new Error('crossfade start was not published');

      document.dispatchEvent(new CustomEvent('livecolorcapability', {
        detail: { outputSlots: 2, complete: true },
      }));
      const twoDepth = {
        label: document.getElementById('chCapability').textContent,
        stagedOnly: document.querySelectorAll('#chRingTwo .is-staged-only').length,
      };
      document.dispatchEvent(new CustomEvent('livecolorcapability', {
        detail: { outputSlots: 5, complete: true },
      }));
      const fiveDepth = {
        label: document.getElementById('chCapability').textContent,
        stagedOnly: document.querySelectorAll('#chRingTwo .is-staged-only').length,
      };

      const beforeArmA = document.getElementById('chArmATwo').style.background;
      const beforeArmB = document.getElementById('chArmBTwo').style.background;
      document.dispatchEvent(new CustomEvent('colorautopilot', {
        detail: {
          active: true,
          mode: 'palettes',
          palettes: start.body.palettes,
          livePalettes: start.body.livePalettes,
          delay_s: start.body.delay_s,
          transitionMs: start.body.transitionMs,
          colorTransition: {
            id: 'ui-feedback',
            status: 'running',
            params: {
              colorPalette1: { h: 0.22, s: 1, v: 1 },
              colorPalette2: { h: 0.77, s: 1, v: 1 },
            },
          },
        },
      }));
      const liveFeedback = {
        armAChanged: document.getElementById('chArmATwo').style.background !== beforeArmA,
        armBChanged: document.getElementById('chArmBTwo').style.background !== beforeArmB,
        selected: JSON.parse(document.getElementById('slots').dataset.paletteSelection),
      };

      document.dispatchEvent(new CustomEvent('colorautopilot', {
        detail: {
          active: true,
          mode: 'followNote',
          followNote: {
            schemes: ['complement', 'contrast'],
            methodHoldS: 30,
            methodFadeS: 3,
            noteFadeMs: 400,
            sel: [1, 4],
            shuffle: false,
          },
          currentScheme: 'contrast',
          notePc: 4,
          noteHue: 0.35,
          nextMethodAtMs: null,
        },
      }));
      document.querySelector('#chTabs [data-card="follow"]').click();
      const followBefore = {
        count: document.querySelectorAll('#chRingFollow .ch-swatch-btn').length,
        a: [...document.querySelectorAll('#chRingFollow .ch-swatch-btn')]
          .findIndex((button) => button.classList.contains('is-a')),
        b: [...document.querySelectorAll('#chRingFollow .ch-swatch-btn')]
          .findIndex((button) => button.classList.contains('is-b')),
      };
      document.getElementById('chArmAFollow').click();
      document.querySelectorAll('#chRingFollow .ch-swatch-btn')[2].click();
      const followPatch = writes.findLast((write) => (
        write.method === 'PATCH' && write.body.followNote && Array.isArray(write.body.followNote.sel)
      ));

      return {
        activeArmPainted: armedB.classList.contains('is-active')
          && armedB.style.borderColor !== '',
        selection,
        ring,
        start: start.body,
        twoDepth,
        fiveDepth,
        liveFeedback,
        followBefore,
        followPatch: followPatch && followPatch.body,
      };
    });

    assert.equal(result.activeArmPainted, true, 'ARM B must visibly arm with its assigned colour');
    assert.deepEqual(result.selection, [0, 4]);
    assert.deepEqual(result.start.palettes[0].c1, result.ring[0]);
    assert.deepEqual(result.start.palettes[0].c2, result.ring[4]);
    assert.deepEqual(result.start.livePalettes[0].slice(0, 2),
      [result.start.palettes[0].c1, result.start.palettes[0].c2]);
    assert.equal(result.twoDepth.stagedOnly, 3);
    assert.match(result.twoDepth.label, /2-COLOUR PATTERN/);
    assert.equal(result.fiveDepth.stagedOnly, 0);
    assert.match(result.fiveDepth.label, /ALL 5 SAMPLES OUTPUT/);
    assert.equal(result.liveFeedback.armAChanged, true);
    assert.equal(result.liveFeedback.armBChanged, true);
    assert.deepEqual(result.liveFeedback.selected, [0, 4],
      'engine readback must not remap the operator A/B indices');
    assert.deepEqual(result.followBefore, { count: 5, a: 1, b: 4 });
    assert.deepEqual(result.followPatch.followNote.sel, [2, 4]);
    await page.close();
  } finally { await browser.close(); }
});

test('spatial contact limit shows a transient status notice without faulting ARM', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const errors = [];
      document.addEventListener('panelerror', (event) => errors.push(event.detail.message));
      window.TouchSpatialContactGate.begin(1);
      window.TouchSpatialContactGate.begin(2);
      window.TouchSpatialContactGate.begin(3);
      const status = document.getElementById('panelStatus');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const first = {
        message: status.textContent,
        hidden: status.hidden,
        role: status.getAttribute('role'),
        ariaLive: status.getAttribute('aria-live'),
        errors,
        armed: document.getElementById('armState').textContent,
      };
      await new Promise((resolve) => setTimeout(resolve, 3100));
      return {
        first,
        cleared: status.hidden || status.textContent === '',
      };
    });
    assert.match(result.first.message, /SPATIAL contact limit reached/);
    assert.equal(result.first.hidden, false);
    assert.equal(result.first.role, 'status');
    assert.equal(result.first.ariaLive, 'polite');
    assert.deepEqual(result.first.errors, []);
    assert.equal(result.first.armed, 'DISARMED');
    assert.equal(result.cleared, true);
    await page.close();
  } finally { await browser.close(); }
});

test('Live Touch errors have a dismiss button and a distinct new fault reopens the toast', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('panelerror', {
        detail: { message: 'test dismissible Live Touch fault' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const firstPill = document.getElementById('wireStatus');
      const dismiss = firstPill && firstPill.querySelector('button[aria-label="Dismiss Live Touch error"]');
      const first = {
        attached: !!(firstPill && firstPill.isConnected),
        message: firstPill ? firstPill.textContent : '',
        hasDismiss: !!dismiss,
      };
      if (dismiss) dismiss.click();
      const dismissed = !!(firstPill && firstPill.isConnected);
      document.dispatchEvent(new CustomEvent('panelerror', {
        detail: { message: 'test dismissible Live Touch fault' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const sameFaultStayedDismissed = !firstPill.isConnected;
      document.dispatchEvent(new CustomEvent('panelerror', {
        detail: { message: 'different Live Touch fault' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const reopened = document.getElementById('wireStatus');
      return {
        first,
        dismissed,
        sameFaultStayedDismissed,
        reopened: !!(reopened && reopened.isConnected),
        reopenedMessage: reopened ? reopened.textContent : '',
      };
    });
    assert.equal(result.first.attached, true);
    assert.match(result.first.message, /test dismissible Live Touch fault/);
    assert.equal(result.first.hasDismiss, true);
    assert.equal(result.dismissed, false);
    assert.equal(result.sameFaultStayedDismissed, true);
    assert.equal(result.reopened, true);
    assert.match(result.reopenedMessage, /different Live Touch fault/);
    await page.close();
  } finally { await browser.close(); }
});

test('strict preset effect reconciliation waits for an ordinary reconcile already in progress', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      const baseFetch = window.fetch;
      let releaseFirstStatus;
      const firstStatusGate = new Promise((resolve) => { releaseFirstStatus = resolve; });
      let statusCalls = 0;
      window.fetch = async (input, options = {}) => {
        const path = String(input).slice(String(input).indexOf(':6968') + 5);
        if (path === '/global-effect-slots/status') {
          statusCalls += 1;
          if (statusCalls === 1) await firstStatusGate;
          return new Response(JSON.stringify({ slots: [], controller: {} }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        return baseFetch(input, options);
      };
      const ordinary = window.__wire._reconcileEffectsForTest(false);
      await Promise.resolve();
      const strict = window.__wire._reconcileEffectsForTest(true);
      releaseFirstStatus();
      await Promise.all([ordinary, strict]);
      return { statusCalls };
    });
    assert.ok(result.statusCalls >= 4,
      `strict recall must perform a fresh readback after the active reconcile: ${JSON.stringify(result)}`);
    await page.close();
  } finally { await browser.close(); }
});

test('manual palette change keeps the shared transition timing authority', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(() => {
      window.ColorTransitionTiming.setMs(1500, 'test');
      document.querySelector('#paletteActions [data-act="contrast"]').click();
      return {
        ms: window.ColorTransitionTiming.ms(),
        palette: document.getElementById('slots').dataset.palette,
      };
    });
    assert.equal(result.ms, 1500);
    assert.equal(JSON.parse(result.palette).length, 5);
    await page.close();
  } finally { await browser.close(); }
});

test('opening Presets keeps Spatial open, evicts Color Hub first, and does not clear contacts', { timeout: 45_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const viewport of [
      { name: '1024x682', width: 1024, height: 682 },
      { name: '1194x834', width: 1194, height: 834 },
    ]) {
      const page = await browser.newPage();
      await openPanel(page, { ...viewport, deviceScaleFactor: 1 });
      await page.evaluate(() => {
        window.__layoutPresetClears = [];
        document.addEventListener('spatialcontactclearrequest', (event) => {
          window.__layoutPresetClears.push(event.detail && event.detail.reason);
        });
        window.TouchSpatialContactGate.begin(7);
      });
      await ensureWorkspacePanelOpen(page, 'presets-panel');
      const layout = await page.evaluate(() => {
        const spatial = document.querySelector('.spatial-panel');
        const presets = document.getElementById('presetsPanel');
        const colorHub = document.getElementById('colorHubPanel');
        return {
          clears: window.__layoutPresetClears.slice(),
          spatialOpen: spatial && !spatial.classList.contains('is-docked'),
          presetsOpen: presets && !presets.classList.contains('is-docked'),
          colorHubDocked: colorHub && colorHub.classList.contains('is-docked'),
          spatialWidth: spatial ? spatial.getBoundingClientRect().width : 0,
          presetsWidth: presets ? presets.getBoundingClientRect().width : 0,
          hasPresetsLayoutClass: document.querySelector('.prow-top')?.classList.contains('has-presets-open'),
          gatePrimary: window.TouchSpatialContactGate.state().primary,
        };
      });
      assert.deepEqual(layout.clears, [], `opening Presets must not clear Spatial contacts at ${viewport.name}`);
      assert.equal(layout.spatialOpen, true, `Spatial must stay open beside Presets at ${viewport.name}`);
      assert.equal(layout.presetsOpen, true, `Presets must open at ${viewport.name}`);
      assert.equal(layout.colorHubDocked, true, `Color Hub must be evicted before Presets at ${viewport.name}`);
      assert.equal(layout.gatePrimary, 7, `live Spatial contact must survive Presets open at ${viewport.name}`);
      assert.ok(layout.spatialWidth > 0 && layout.presetsWidth > 0,
        `Spatial and Presets must both be visible at ${viewport.name}: ${JSON.stringify(layout)}`);
      assert.equal(layout.hasPresetsLayoutClass, true,
        `top row must enter Presets layout mode at ${viewport.name}`);
      assert.ok(layout.spatialWidth >= layout.presetsWidth,
        `Spatial must remain at least as wide as Presets at ${viewport.name}: ${JSON.stringify({ spatial: layout.spatialWidth, presets: layout.presetsWidth })}`);
      await captureViewportEvidence(page, `native_ipad_landscape_${viewport.name}_spatial_presets_side_by_side.png`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('preset recall preflight refuses store and disarmed states before mutation', { timeout: 30_000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPanel(page, { width: 1024, height: 682, deviceScaleFactor: 1 });
    const result = await page.evaluate(async () => {
      const errors = [];
      window.__wire.phase = 'armed';
      window.__wire.armed = true;
      await window.__wire._preflightPresetRecall({
        storeReady: false,
        storeError: null,
        fxCatalogReady: true,
      }).catch((error) => errors.push(error.message));
      window.__wire.phase = 'idle';
      window.__wire.armed = false;
      await window.__wire._preflightPresetRecall({
        storeReady: true,
        storeError: null,
        fxCatalogReady: true,
      }).catch((error) => errors.push(error.message));
      return { errors };
    });
    assert.ok(result.errors.some((message) => /preset store to confirm/i.test(message)),
      `store preflight must refuse loudly: ${JSON.stringify(result.errors)}`);
    assert.ok(result.errors.some((message) => /ARM Live Touch/i.test(message)),
      `disarmed preflight must refuse loudly: ${JSON.stringify(result.errors)}`);
    await page.close();
  } finally {
    await browser.close();
  }
});
