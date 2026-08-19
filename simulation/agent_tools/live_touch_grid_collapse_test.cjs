/**
 * Live Touch grid-collapse DOM/layout regression.
 *
 * Serves the checked-in panel on a private high port, without an engine, then
 * proves that docking all but Spatial leaves one full workspace cell, restores
 * every individual panel, and retains Spatial's true fullscreen takeover.
 *
 * Usage: node agent_tools/live_touch_grid_collapse_test.cjs [--out <directory>]
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const puppeteer = require('puppeteer');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'tmp', 'live_touch_grid_collapse');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function outputDirectory() {
  const outputIndex = process.argv.indexOf('--out');
  if (outputIndex === -1) return DEFAULT_OUTPUT_DIR;
  if (!process.argv[outputIndex + 1]) throw new Error('--out needs a directory');
  return path.resolve(process.argv[outputIndex + 1]);
}

function createPanelServer() {
  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch (error) {
      response.writeHead(400).end('invalid URL');
      return;
    }
    const requestedPath = pathname === '/' ? '/CaptainPad/live_touch/touch_control.html' : pathname;
    const filePath = path.resolve(REPO_ROOT, `.${requestedPath}`);
    const relativePath = path.relative(REPO_ROOT, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      response.writeHead(403).end('outside repository');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      response.end(content);
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`${label} timed out`);
}

function requireLayout(condition, message) {
  if (!condition) throw new Error(`layout contract failed: ${message}`);
}

async function main() {
  const outputDir = outputDirectory();
  fs.mkdirSync(outputDir, { recursive: true });
  const server = createPanelServer();
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => localStorage.removeItem('bm26_touch_layout_v2'));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('http://127.0.0.1:6968/')) {
        request.abort();
        return;
      }
      request.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/CaptainPad/live_touch/touch_control.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.prow > .panel').length === 5),
      'Live Touch panel layout bootstrap');

    for (const selector of ['.color-panel', '.effects-panel', '.groups-panel']) {
      await page.evaluate((panelSelector) => {
        const button = document.querySelector(`${panelSelector} [data-collapse]`);
        if (!button) throw new Error(`collapse button missing for ${panelSelector}`);
        button.click();
      }, selector);
    }
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.prow > .panel:not(.is-docked)').length === 1),
      'one expanded Live Touch panel');
    const collapsed = await page.evaluate(() => {
      const rectangle = (selector) => {
        const element = document.querySelector(selector);
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      return {
        open: Array.from(document.querySelectorAll('.prow > .panel:not(.is-docked)'))
          .map((panel) => panel.className),
        grid: rectangle('.content-grid'),
        survivor: rectangle('.spatial-panel'),
        topRowEmpty: document.querySelector('.prow-top').classList.contains('is-empty'),
        bottomRowDisplay: getComputedStyle(document.querySelector('.prow-bottom')).display,
        railTabs: Array.from(document.querySelectorAll('.rail-tab')).map((tab) => tab.dataset.for),
      };
    });
    requireLayout(collapsed.open.length === 1 && collapsed.open[0].includes('spatial-panel'),
      'Spatial must be the only expanded panel');
    requireLayout(!collapsed.topRowEmpty, 'the survivor row must remain active');
    requireLayout(collapsed.bottomRowDisplay === 'none', 'the empty sibling row must not retain height');
    requireLayout(Math.abs(collapsed.survivor.left - collapsed.grid.left) <= 1
      && Math.abs(collapsed.survivor.right - collapsed.grid.right) <= 1,
    'the survivor must take the complete grid width');
    requireLayout(Math.abs(collapsed.survivor.bottom - collapsed.grid.bottom) <= 1,
      'the survivor must take the complete grid height below the meter strip');
    await page.screenshot({ path: path.join(outputDir, '01_one_panel_full_workspace.png'), fullPage: true });

    for (const key of ['color-panel', 'effects-panel', 'groups-panel']) {
      await page.evaluate((panelKey) => {
        const tab = document.querySelector(`.rail-tab[data-for="${panelKey}"]`);
        if (!tab) throw new Error(`restore tab missing for ${panelKey}`);
        tab.click();
      }, key);
    }
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.prow > .panel:not(.is-docked)').length === 4),
      'individual panel restores');
    const restored = await page.evaluate(() => ({
      open: Array.from(document.querySelectorAll('.prow > .panel:not(.is-docked)'))
        .map((panel) => panel.className),
      presetDocked: document.querySelector('.presets-panel').classList.contains('is-docked'),
    }));
    requireLayout(restored.open.some((className) => className.includes('color-panel'))
      && restored.open.some((className) => className.includes('effects-panel'))
      && restored.open.some((className) => className.includes('groups-panel')),
    'each individually docked panel must restore from its rail tab');
    requireLayout(restored.presetDocked, 'unrelated docked panels must remain docked');
    await page.screenshot({ path: path.join(outputDir, '02_panels_restored.png'), fullPage: true });

    await page.evaluate(() => document.querySelectorAll('#modeToggle button')[1].click());
    await waitFor(() => page.evaluate(() => !document.getElementById('spatialFullscreen').hidden),
      'Spatial fullscreen control');
    await page.click('#spatialFullscreen');
    await waitFor(() => page.evaluate(() => document.querySelector('.spatial-panel').classList.contains('is-spatial-fullscreen')),
      'Spatial fullscreen entry');
    await page.screenshot({ path: path.join(outputDir, '03_spatial_fullscreen.png'), fullPage: true });
    await page.click('#spatialFullscreen');
    await waitFor(() => page.evaluate(() => !document.querySelector('.spatial-panel').classList.contains('is-spatial-fullscreen')
      && document.querySelector('.spatial-panel').closest('.prow-top') !== null), 'Spatial fullscreen exit');

    const evidence = {
      result: 'PASS',
      collapsed,
      restored,
      screenshots: [
        '01_one_panel_full_workspace.png',
        '02_panels_restored.png',
        '03_spatial_fullscreen.png',
      ],
    };
    fs.writeFileSync(path.join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Live Touch grid-collapse PASS ${JSON.stringify(evidence)}`);
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
