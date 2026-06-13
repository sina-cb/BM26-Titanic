/**
 * capture_control_schema.cjs — Dump the live control tree as JSON.
 *
 * Parity oracle tooling for the UI rehaul (tasks 015/018): run once
 * against the legacy UI and once against the modern UI on the SAME scene,
 * then diff the two JSON files to prove control-level parity.
 *
 * Usage (servers must be running, see 00_see_the_world.md):
 *   node capture_control_schema.cjs [--url <sim-url>] [--out <file.json>]
 *
 * Defaults: legacy titanic scene URL; output to
 * ../../.agent_renders/control_schema_<unix>.json
 */

const fs = require('fs');
const path = require('path');

const puppeteer = require('puppeteer');

const DEFAULT_URL = 'http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] || null;
}

const SIM_URL = argValue('--url') || DEFAULT_URL;
const OUT_PATH = argValue('--out')
  || path.join(__dirname, '..', '..', '.agent_renders', `control_schema_${Math.floor(Date.now() / 1000)}.json`);

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--use-angle=swiftshader', '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.accept());
    await page.setViewport({ width: 1280, height: 720 });

    console.log(`📡 Navigating to ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(
      () => document.getElementById('loading-overlay')?.classList.contains('hidden'),
      { timeout: 90000 },
    );
    await page.waitForFunction(() => !!window.guiInstance, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    const schema = await page.evaluate(() => window.__captureControlSchema());
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(schema, null, 2));
    console.log(`✅ ${schema.controlCount} controls → ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
