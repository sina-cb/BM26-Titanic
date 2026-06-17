/**
 * browser_split.cjs — Best-effort side-by-side Chrome window placement.
 *
 * Chrome has no real "split view" API, so we fake it: launch two separate
 * Chrome windows with explicit `--window-position`/`--window-size`, tiling one
 * on the left half of the primary screen and one on the right. Purely cosmetic
 * — the launcher uses this to put the sim and CaptainPad next to each other.
 *
 * Everything here is best-effort and MUST degrade gracefully: if Chrome can't
 * be found or a window fails to spawn, the caller falls back to the normal
 * default-browser open. We never crash a stack launch over window placement.
 *
 * Zero dependencies, offline-safe — only spawns the local Chrome binary.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Half-screen defaults. We don't query the display geometry (it's fiddly and
// cross-platform-ugly); these are sane sizes for a 2560-wide screen and look
// fine on smaller ones too — Chrome clamps a window to the visible area.
const HALF_WIDTH = 1280;
const HALF_HEIGHT = 1400;

/**
 * Locate a Chrome (or Chromium) executable for this OS. Returns an absolute
 * path / command name, or null if none is found.
 * @returns {string|null}
 */
function findChrome() {
  if (IS_MAC) {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(macPath) ? macPath : null;
  }
  if (IS_WIN) {
    const candidates = [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  // Linux: prefer a real install path, else fall back to a PATH command name
  // (spawn resolves it; we can't fs.existsSync a bare command).
  const linuxPaths = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const candidate of linuxPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Open one Chrome window at an explicit position/size. Best-effort: returns
 * true if the process spawned, false if it errored synchronously.
 * @param {string} chrome  executable path/name from findChrome()
 * @param {string} url
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {boolean}
 */
function openChromeWindow(chrome, url, rect) {
  const args = [
    '--new-window',
    `--window-position=${rect.x},${rect.y}`,
    `--window-size=${rect.w},${rect.h}`,
    url,
  ];
  try {
    // Detached + unref'd: this is the operator's browser, not a stack child —
    // teardown must never touch it (mirrors launcher.js openInBrowser).
    const child = spawn(chrome, args, { stdio: 'ignore', detached: true, shell: false });
    let errored = false;
    child.on('error', () => { errored = true; });
    child.unref();
    return !errored;
  } catch (err) {
    return false;
  }
}

/**
 * Tile two URLs side-by-side in Chrome (left half / right half of the primary
 * screen). Best-effort — returns true only if Chrome was found AND both windows
 * spawned; otherwise false so the caller can fall back to the default browser.
 *
 * @param {string} leftUrl   tiled on the left half
 * @param {string} rightUrl  tiled on the right half
 * @param {object} [opts]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {boolean}
 */
function openSideBySide(leftUrl, rightUrl, opts = {}) {
  const log = opts.log || (() => {});
  const chrome = findChrome();
  if (!chrome) {
    log('split view: no Chrome/Chromium found — falling back to default browser.');
    return false;
  }
  const leftOk = openChromeWindow(chrome, leftUrl, { x: 0, y: 0, w: HALF_WIDTH, h: HALF_HEIGHT });
  const rightOk = openChromeWindow(chrome, rightUrl, { x: HALF_WIDTH, y: 0, w: HALF_WIDTH, h: HALF_HEIGHT });
  if (!leftOk || !rightOk) {
    log('split view: Chrome window placement failed — falling back to default browser.');
    return false;
  }
  log(`split view: tiled two Chrome windows side-by-side (${chrome}).`);
  return true;
}

module.exports = {
  findChrome,
  openSideBySide,
};
