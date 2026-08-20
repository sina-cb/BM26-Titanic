#!/usr/bin/env node
/**
 * url_canonical_boot_verify.cjs — isolated visual proof that a bare sim URL
 * rewrites to the canonical show defaults and does not keep a stale bench mirror
 * banner when the bridge reports disarmed.
 *
 * Usage (sim HTTP already up on the chosen port):
 *   node url_canonical_boot_verify.cjs [--port 7869] [--out ~/tmp/url_canonical_boot.png]
 *
 * Does NOT touch the operator stack on :6969 unless --port 6969 is passed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const PORT = Number(argValue('--port') || '8769');
const SAVE_PORT = PORT + 1;
const SACN_PORT = PORT + 2;
const OUT = argValue('--out') || path.join(os.homedir(), 'tmp', 'url_canonical_boot.png');
const CANONICAL =
  'scene=titanic&profile=2d_pixels&lighting_mode=sacn_in&spotlights=0';
const BARE = `http://127.0.0.1:${PORT}/simulation/`;
const SCRATCH_CONFIG = [
  `http_port: ${PORT}`,
  `save_port: ${SAVE_PORT}`,
  `sacn_port: ${SACN_PORT}`,
  `sacn_output_port: ${SACN_PORT + 1}`,
  `marsin_engine_port: ${PORT - 1}`,
  '',
].join('\n');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.endsWith('/config.yaml') || url.includes('/config.yaml?')) {
        req.respond({
          status: 200,
          contentType: 'text/yaml',
          body: SCRATCH_CONFIG,
        });
        return;
      }
      req.continue();
    });

    await page.goto(BARE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__simUrlCanonicalBoot && window.__simUrlCanonicalBoot.changed === true,
      { timeout: 15000 },
    ).catch(() => {});

    // Give the pixel map, bridge status, and any stale-mirror disarm time to settle.
    await new Promise((r) => setTimeout(r, 6000));

    const probe = await page.evaluate((expected) => {
      const banner = document.getElementById('bench-mirror-banner');
      return {
        href: window.location.href,
        search: window.location.search,
        canonicalBoot: window.__simUrlCanonicalBoot || null,
        benchMirror: window.sacnInput && window.sacnInput.stats
          ? window.sacnInput.stats.benchMirror
          : null,
        bannerText: banner ? banner.textContent : '',
        bannerVisible: banner ? banner.style.opacity !== '0' : false,
        sceneSelect: document.getElementById('scene-select')?.value || null,
      };
    }, CANONICAL);

    const url = new URL(probe.href);
    assertContains(url.search.slice(1), CANONICAL, 'address bar query');
    assertEqual(probe.sceneSelect, 'titanic', 'HUD scene select');

    if (probe.bannerVisible && /BENCH MIRROR ACTIVE/.test(probe.bannerText || '')) {
      throw new Error(
        'bench mirror banner still visible on canonical default boot — stale mirror was not cleared',
      );
    }

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT, fullPage: false });

    console.log(JSON.stringify({
      ok: true,
      bareUrl: BARE,
      finalHref: probe.href,
      canonicalQuery: CANONICAL,
      benchMirrorArmed: probe.benchMirror ? probe.benchMirror.armed === true : null,
      screenshot: OUT,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

function assertContains(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${label}: expected ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
