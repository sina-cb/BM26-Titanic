/**
 * Live Touch brush/UI performance gate.
 *
 * Runs the real docs/ui surface from an ephemeral read-only HTTP origin, proves
 * narrow iframe layouts do not widen the document, verifies the generated
 * Titanic pixel artifact against the canonical model, then drives 1,200 pointer
 * samples (two per animation frame). The enforced invariants are intentionally
 * structural and SwiftShader-safe: one preview composite per rAF, no static-map
 * rebuild or backing-store resize during the gesture, bounded ink samples, and
 * complete linear trail retirement after the 1.5 s maximum fade.
 *
 * Usage: node agent_tools/live_touch_brush_perf_test.cjs
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

const SIMULATION_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SIMULATION_ROOT, '..');
const PAGE_PATH = '/docs/ui/touch_control.html';
const MODEL_PATH = path.join(REPO_ROOT, 'marsin_engine', 'models', 'titanic.js');
const RENDER_PATH = path.join(REPO_ROOT, '.agent_renders', 'live_touch_brush_perf.png');
const FULLSCREEN_RENDER_PATH = path.join(
  REPO_ROOT, '.agent_renders', 'live_touch_spatial_fullscreen.png');
const VIEW_RENDER_PATHS = Object.freeze({
  top_down: path.join(REPO_ROOT, '.agent_renders', 'live_touch_view_top_down.png'),
  front: path.join(REPO_ROOT, '.agent_renders', 'live_touch_view_front.png'),
  strands: path.join(REPO_ROOT, '.agent_renders', 'live_touch_view_strands.png'),
  te_sign: path.join(REPO_ROOT, '.agent_renders', 'live_touch_view_te_sign.png'),
});
const SAMPLE_FRAMES = 600;
const SAMPLES_PER_FRAME = 2;
const MAX_FADE_WAIT_MS = 1700;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
};

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function createStaticServer() {
  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch (error) {
      response.writeHead(400).end('invalid URL');
      return;
    }
    const filePath = path.resolve(REPO_ROOT, `.${pathname === '/' ? PAGE_PATH : pathname}`);
    const relative = path.relative(REPO_ROOT, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('outside repository');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      response.end(body);
    });
  });
}

async function listenEphemeral(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForPixelRuntime(page) {
  await page.waitForFunction(() => window.TouchPixelViews && typeof window.TouchPixelViews.ready === 'function', {
    timeout: 15000,
  });
  await page.evaluate(() => window.TouchPixelViews.ready());
}

async function geometryGate(page, url) {
  const viewports = [
    { width: 1366, height: 1024 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
    { width: 640, height: 780 },
  ];
  const results = [];
  for (const viewport of viewports) {
    await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#groupsGrid .fader-strip', { timeout: 10000 });
    const result = await page.evaluate(() => ({
      viewport: innerWidth,
      rootWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      workspaceMinWidth: getComputedStyle(document.querySelector('.workspace')).minWidth,
      bankClientWidth: document.getElementById('groupsGrid').clientWidth,
      bankScrollWidth: document.getElementById('groupsGrid').scrollWidth,
    }));
    results.push(result);
  }
  const failures = results.filter((result) => result.rootWidth > result.viewport ||
    result.bodyWidth > result.viewport || result.workspaceMinWidth !== '0px' ||
    result.bankScrollWidth <= result.bankClientWidth);
  if (failures.length) throw new Error(`layout containment failed: ${JSON.stringify(failures)}`);
  return results;
}

async function brushGate(page, url, layout) {
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitForPixelRuntime(page);
  await page.evaluate((engineLayout) => window.TouchPixelViews.verifyEngineLayout(engineLayout), layout);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const result = await page.evaluate(async ({ sampleFrames, samplesPerFrame, fadeWaitMs }) => {
    const pad = document.getElementById('xyPad');
    const modeButtons = document.querySelectorAll('#modeToggle button');
    modeButtons[1].click();
    const fade = document.getElementById('trailFade');
    fade.dataset.value = '1.5';
    document.getElementById('trailFadeVal').textContent = '1.5 s';

    /* Prime the overlay backing store before observing steady-state writes. */
    const inkCanvas = document.getElementById('inkTrail');
    const inkDpr = Math.min(devicePixelRatio || 1, 2);
    inkCanvas.width = Math.round(inkCanvas.clientWidth * inkDpr);
    inkCanvas.height = Math.round(inkCanvas.clientHeight * inkDpr);

    const idleFrameGaps = [];
    let idlePrevious = 0;
    for (let frame = 0; frame < 120; frame++) {
      const now = await new Promise((resolve) => requestAnimationFrame(resolve));
      if (idlePrevious) idleFrameGaps.push(now - idlePrevious);
      idlePrevious = now;
    }

    const canvasWrites = { pixMap: 0, inkTrail: 0 };
    ['width', 'height'].forEach((property) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          if (this.id === 'pixMap' || this.id === 'inkTrail') canvasWrites[this.id]++;
          return descriptor.set.call(this, value);
        },
      });
    });

    const longTasks = [];
    let observer = null;
    if (typeof PerformanceObserver === 'function' &&
        PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push(entry.duration));
      });
      observer.observe({ type: 'longtask', buffered: false });
    }

    const before = window.TouchPixelViews.state();
    const inkBefore = window.TouchInkDiagnostics();
    const rect = pad.getBoundingClientRect();
    const pointerId = 73;
    const dispatch = (type, x, y, down) => pad.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      pressure: down ? 0.65 : 0,
      buttons: down ? 1 : 0,
      button: type === 'pointerdown' ? 0 : -1,
    }));
    const pointAt = (sample) => {
      const t = sample / (sampleFrames * samplesPerFrame - 1);
      return {
        x: rect.left + rect.width * (0.08 + 0.84 * t),
        y: rect.top + rect.height * (0.50 + 0.32 * Math.sin(t * Math.PI * 8)),
      };
    };

    const first = pointAt(0);
    dispatch('pointerdown', first.x, first.y, true);
    const frameGaps = [];
    let previousFrame = 0;
    for (let frame = 0; frame < sampleFrames; frame++) {
      const now = await new Promise((resolve) => requestAnimationFrame(resolve));
      if (previousFrame) frameGaps.push(now - previousFrame);
      previousFrame = now;
      for (let sub = 0; sub < samplesPerFrame; sub++) {
        const sample = frame * samplesPerFrame + sub;
        const point = pointAt(sample);
        dispatch('pointermove', point.x, point.y, true);
      }
    }
    const last = pointAt(sampleFrames * samplesPerFrame - 1);
    dispatch('pointerup', last.x, last.y, false);
    await new Promise((resolve) => setTimeout(resolve, fadeWaitMs));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (observer) observer.disconnect();

    const after = window.TouchPixelViews.state();
    const inkAfter = window.TouchInkDiagnostics();
    return {
      samples: sampleFrames * samplesPerFrame,
      frames: sampleFrames,
      idleFrameGaps,
      frameGaps,
      longTasks,
      canvasWrites,
      runtimeDelta: {
        staticRenderCount: after.staticRenderCount - before.staticRenderCount,
        previewRenderCount: after.previewRenderCount - before.previewRenderCount,
        reprojectCount: after.reprojectCount - before.reprojectCount,
        canvasResizeCount: after.canvasResizeCount - before.canvasResizeCount,
      },
      pendingPreviewFrames: after.pendingPreviewFrames,
      pendingDrawFrames: after.pendingDrawFrames,
      inkAcceptedDelta: inkAfter.acceptedPointCount - inkBefore.acceptedPointCount,
      inkAfter,
    };
  }, { sampleFrames: SAMPLE_FRAMES, samplesPerFrame: SAMPLES_PER_FRAME, fadeWaitMs: MAX_FADE_WAIT_MS });

  result.frameP50Ms = percentile(result.frameGaps, 0.50);
  result.frameP95Ms = percentile(result.frameGaps, 0.95);
  result.frameMaxMs = Math.max(0, ...result.frameGaps);
  result.idleFrameP95Ms = percentile(result.idleFrameGaps, 0.95);
  result.longTaskMaxMs = Math.max(0, ...result.longTasks);
  const failures = [];
  if (result.runtimeDelta.previewRenderCount > SAMPLE_FRAMES + 2) failures.push('more than one preview composite/rAF');
  if (result.runtimeDelta.staticRenderCount !== 0 || result.runtimeDelta.reprojectCount !== 0) {
    failures.push('static map rebuilt during gesture');
  }
  if (result.runtimeDelta.canvasResizeCount !== 0 || result.canvasWrites.pixMap !== 0 ||
      result.canvasWrites.inkTrail !== 0) failures.push('canvas backing store resized during gesture');
  if (result.inkAcceptedDelta > SAMPLE_FRAMES + 2) failures.push('raw ink samples were not rAF-coalesced');
  if (result.inkAfter.pointCount !== 0 || result.inkAfter.inkFramePending ||
      result.inkAfter.inputFramePending) failures.push('maximum trail did not retire after 1.5 s');
  if (result.pendingPreviewFrames || result.pendingDrawFrames) failures.push('preview rAF remained queued after lift');
  if (result.longTasks.some((duration) => duration > 50)) failures.push('gesture produced a >50 ms long task');
  /* SwiftShader's full-page cadence is host-dependent. Absolute and idle-delta
     frame cadence are reported for hardware comparison; long tasks and the
     deterministic coalescing/rebuild bounds above remain enforced here. */
  if (failures.length) throw new Error(`${failures.join('; ')}\n${JSON.stringify(result, null, 2)}`);
  return result;
}

async function multitouchFullscreenGate(page, url, layout) {
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitForPixelRuntime(page);
  await page.evaluate((engineLayout) => window.TouchPixelViews.verifyEngineLayout(engineLayout), layout);
  return page.evaluate(async () => {
    const pad = document.getElementById('xyPad');
    const panel = document.querySelector('.spatial-panel');
    const fullscreen = document.getElementById('spatialFullscreen');
    const modes = document.querySelectorAll('#modeToggle button');
    modes[1].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (fullscreen.hidden) throw new Error('Spatial fullscreen control stayed hidden in Spatial mode');
    fullscreen.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const panelRect = panel.getBoundingClientRect();
    if (!panel.classList.contains('is-spatial-fullscreen') ||
        Math.abs(panelRect.width - innerWidth) > 1 || Math.abs(panelRect.height - innerHeight) > 1) {
      throw new Error(`Spatial fullscreen did not fill viewport: ${panelRect.width}x${panelRect.height}`);
    }

    const rect = pad.getBoundingClientRect();
    const emit = (type, pointerId, u, v, down) => pad.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch',
      isPrimary: pointerId === 101, clientX: rect.left + rect.width * u,
      clientY: rect.top + rect.height * v, pressure: down ? 0.7 : 0,
      buttons: down ? 1 : 0, button: type === 'pointerdown' ? 0 : -1,
    }));
    emit('pointerdown', 101, 0.2, 0.25, true);
    emit('pointerdown', 202, 0.8, 0.75, true);
    emit('pointermove', 101, 0.3, 0.3, true);
    emit('pointermove', 202, 0.7, 0.7, true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const two = window.TouchInkDiagnostics();
    const twoPreview = window.TouchPixelViews.state();
    const secondaryWhileDown = pad.querySelectorAll('.xy-handle.is-secondary').length;
    if (two.activePointers !== 2 || secondaryWhileDown !== 1
        || twoPreview.activePreviewPointers !== 2 || twoPreview.previewPixelCount === 0) {
      throw new Error(`expected two visual touches and a unioned pixel preview, got `
        + `${two.activePointers}/${secondaryWhileDown}/${JSON.stringify(twoPreview)}`);
    }
    emit('pointerup', 101, 0.3, 0.3, false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const onePreview = window.TouchPixelViews.state();
    if (window.TouchInkDiagnostics().activePointers !== 1
        || onePreview.activePreviewPointers !== 1 || onePreview.previewPixelCount === 0) {
      throw new Error('lifting one touch cancelled the other visual stroke');
    }
    emit('pointerup', 202, 0.7, 0.7, false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (window.TouchInkDiagnostics().activePointers !== 0) {
      throw new Error('final touch did not retire');
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (panel.classList.contains('is-spatial-fullscreen')) {
      throw new Error('Escape did not exit Spatial fullscreen');
    }
    modes[0].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!fullscreen.hidden) throw new Error('fullscreen control is visible in XY mode');
    return {
      viewport: [innerWidth, innerHeight],
      fullscreenRect: [panelRect.width, panelRect.height],
      simultaneousTouches: two.activePointers,
      secondaryHandles: secondaryWhileDown,
    };
  });
}

async function captureCanonicalViews(page, url, layout) {
  await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitForPixelRuntime(page);
  await page.evaluate((engineLayout) => window.TouchPixelViews.verifyEngineLayout(engineLayout), layout);
  await page.evaluate(() => {
    document.querySelectorAll('#modeToggle button')[1].click();
    document.getElementById('spatialFullscreen').click();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const panel = await page.$('.spatial-panel');
  if (!panel) throw new Error('Spatial panel is missing for canonical view screenshots');
  for (const [viewId, outputPath] of Object.entries(VIEW_RENDER_PATHS)) {
    await page.evaluate((id) => window.TouchPixelViews.selectView(id), viewId);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    )));
    await panel.screenshot({ path: outputPath, type: 'png' });
  }
  return { ...VIEW_RENDER_PATHS };
}

async function main() {
  const model = await import(pathToFileURL(MODEL_PATH).href);
  const layout = {
    scene: 'titanic',
    model: 'titanic',
    pixelCount: model.pixelCount,
    returnedCount: model.pixelCount,
    pixels: model.pixels,
  };
  const server = createStaticServer();
  const port = await listenEphemeral(server);
  const url = `http://127.0.0.1:${port}${PAGE_PATH}`;
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/^http:\/\/127\.0\.0\.1:6968\//.test(request.url())) request.abort();
      else request.continue();
    });
    page.on('pageerror', (error) => console.error(`[page error] ${error.message}`));

    const geometry = await geometryGate(page, url);
    const multitouch = await multitouchFullscreenGate(page, url, layout);
    const viewScreenshots = await captureCanonicalViews(page, url, layout);
    await page.evaluate(() => {
      document.querySelectorAll('#modeToggle button')[1].click();
      document.getElementById('spatialFullscreen').click();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await page.screenshot({ path: FULLSCREEN_RENDER_PATH });
    const brush = await brushGate(page, url, layout);
    await fs.promises.mkdir(path.dirname(RENDER_PATH), { recursive: true });
    await page.screenshot({ path: RENDER_PATH, fullPage: true });

    console.log('Live Touch brush/UI performance gate PASS');
    geometry.forEach((entry) => console.log(
      `  layout ${entry.viewport}px: root/body ${entry.rootWidth}/${entry.bodyWidth}, ` +
      `bank ${entry.bankClientWidth}/${entry.bankScrollWidth}`));
    console.log(`  samples: ${brush.samples}; preview composites: ${brush.runtimeDelta.previewRenderCount}; ` +
      `ink points accepted: ${brush.inkAcceptedDelta}`);
    console.log(`  multitouch: ${multitouch.simultaneousTouches} simultaneous handles; ` +
      `fullscreen ${multitouch.fullscreenRect.join('x')} at ${multitouch.viewport.join('x')}`);
    console.log(`  frame gap p50/p95/max: ${brush.frameP50Ms.toFixed(2)}/` +
      `${brush.frameP95Ms.toFixed(2)}/${brush.frameMaxMs.toFixed(2)} ms`);
    console.log(`  idle p95 / brush overhead: ${brush.idleFrameP95Ms.toFixed(2)} / ` +
      `${(brush.frameP95Ms - brush.idleFrameP95Ms).toFixed(2)} ms`);
    console.log(`  long tasks: ${brush.longTasks.length}; max ${brush.longTaskMaxMs.toFixed(2)} ms`);
    console.log(`  static rebuild/reproject/resize: ${brush.runtimeDelta.staticRenderCount}/` +
      `${brush.runtimeDelta.reprojectCount}/${brush.runtimeDelta.canvasResizeCount}`);
    console.log(`  final ink points/pending: ${brush.inkAfter.pointCount}/` +
      `${brush.inkAfter.inkFramePending || brush.inkAfter.inputFramePending}`);
    console.log(`  screenshot: ${RENDER_PATH}`);
    console.log(`  fullscreen screenshot: ${FULLSCREEN_RENDER_PATH}`);
    for (const [viewId, outputPath] of Object.entries(viewScreenshots)) {
      console.log(`  ${viewId} screenshot: ${outputPath}`);
    }
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
