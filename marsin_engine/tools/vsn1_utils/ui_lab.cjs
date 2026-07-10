#!/usr/bin/env node
/*
  ui_lab.cjs — VSN1 LCD "UI lab": push EXPERIMENTAL screen designs to a live
  VSN1 in seconds so the loop is  flash → look at the device → tweak → reflash.
  Winning designs get folded into the real templates (tools/vsn1_config/
  templates/effects_layout/) afterward.

  HOW IT WORKS — replace the LCD DRAW handler, DON'T commit to flash:
    A variant is an LCD DRAW handler (element 13, event 8) written in the
    `self:` element form. We CONFIG/EXECUTE it onto the device but DELIBERATELY
    skip PAGESTORE — so the new handler runs live in the module's Lua VM and
    HOLDS on screen, but is never persisted. Therefore:
      - EPHEMERAL: a power-cycle (or `--restore`) brings the real effects
        screen back. Flash still holds the production page 0 — we never wrote it.
      - It STICKS (unlike a one-shot IMMEDIATE draw, which the live DRAW loop
        repaints over): the variant IS the DRAW handler now, so every render
        tick paints it. Variants draw unconditionally + self:draw_swap().
    We reuse the PROVEN serial plumbing in ../vsn1_config/grid_serial.cjs and
    add NO new protocol code — same path write_config.cjs uses, minus the
    flash-commit.

  `--restore` re-writes the PRODUCTION lcd_draw.lua handler (also no-store) so
  the live effects screen returns without a power-cycle.

  COM12 IS A SINGLE-HOLDER PORT. The engine's auto-deploy opens it on layout
  changes. Before opening we ask the engine whether a deploy is in flight
  (GET /global-effects/layout → deploy.deploying) and REFUSE if so. Also don't
  edit slot layouts in CaptainPad while iterating here.

  Usage:
    node ui_lab.cjs --list                  list variants
    node ui_lab.cjs --variant grid_bright    push a variant (sticks on screen)
    node ui_lab.cjs --restore                repaint the live effects screen
    node ui_lab.cjs --variant X --port COM12 --no-engine-check

  Fail-loud everywhere. No fallbacks. Never PAGESTORE (that is the operator's
  production deploy, not a lab experiment).
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const gs = require('../vsn1_config/grid_serial.cjs');

// @intechstudio/grid-protocol is installed only under vsn1_config/node_modules
// (the whole VSN1 toolchain lives there). Resolve it from that location rather
// than duplicating the dependency — mirrors how the sibling vsn1_config tools
// pick it up by running from that dir.
const vsn1ConfigRequire = createRequire(require.resolve('../vsn1_config/grid_serial.cjs'));
async function importGridProtocol() {
  const resolved = vsn1ConfigRequire.resolve('@intechstudio/grid-protocol');
  return import(pathToFileURL(resolved).href);
}

const VARIANT_DIR = path.join(__dirname, 'variants');
const PROD_LCD_DRAW = path.join(
  __dirname, '..', 'vsn1_config', 'templates', 'effects_layout', 'lcd_draw.lua',
);
const ENGINE_URL = process.env.MARSIN_ENGINE_URL || 'http://127.0.0.1:6968';

// VSN1L LCD element / DRAW event (fixed; matches deploy_layout.cjs element 13,
// eventType 8, and write_config's hello_world lcd/DRAW resolution).
const LCD_ELEMENT = 13;
const DRAW_EVENT = 8;

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { variant: null, list: false, restore: false, port: null, engineCheck: true, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variant' || a === '-v') args.variant = argv[++i];
    else if (a === '--list' || a === '-l') args.list = true;
    else if (a === '--restore') args.restore = true;
    else if (a === '--port') args.port = argv[++i];
    else if (a === '--no-engine-check') args.engineCheck = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
vsn1 ui_lab — push experimental LCD screens to a live VSN1 (ephemeral, sticks).

  node ui_lab.cjs --list                list variants in ${path.relative(process.cwd(), VARIANT_DIR)}/
  node ui_lab.cjs --variant <name>      push that variant; it HOLDS on screen
  node ui_lab.cjs --restore             repaint the live effects screen

Options:
  --port <name>        Serial port (default: auto-detect the VSN1 by VID:PID).
  --no-engine-check    Skip the "is a deploy in flight?" COM12 guard.
  -h, --help           This help.

A variant is variants/<name>.lua — an LCD DRAW handler in self: form. It is
written WITHOUT a flash-commit, so it sticks on screen until --restore or a
power-cycle. Nothing is ever persisted.
`);
}

// ── Variant loading ───────────────────────────────────────────────────────────
function listVariants() {
  if (!fs.existsSync(VARIANT_DIR)) return [];
  return fs.readdirSync(VARIANT_DIR)
    .filter((f) => f.endsWith('.lua'))
    .map((f) => f.replace(/\.lua$/, ''))
    .sort();
}

function variantFile(name) {
  const file = path.join(VARIANT_DIR, `${name}.lua`);
  if (!fs.existsSync(file)) {
    const have = listVariants();
    throw new Error(`Variant "${name}" not found at ${file}. Available: ${have.join(', ') || '(none)'}`);
  }
  return file;
}

// ── Engine COM12 guard ────────────────────────────────────────────────────────
async function assertNoDeployInFlight() {
  let data;
  try {
    const res = await fetch(`${ENGINE_URL}/global-effects/layout`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.log(`  (engine unreachable at ${ENGINE_URL} — no auto-deploy can be running; proceeding)`);
    return;
  }
  const deploy = data && data.deploy;
  if (deploy && deploy.deploying) {
    throw new Error(
      `A VSN1 auto-deploy is IN FLIGHT (engine holds COM12). Refusing to open ` +
        `the port. Wait for it to finish (deploy.deploying=false) and retry.`,
    );
  }
  if (deploy) console.log(`  engine deploy idle (last: ${deploy.lastResult || 'none'}) — COM12 free.`);
}

// ── Write ONE LCD DRAW handler, NO flash-commit ────────────────────────────────
// activatePage(0) → CONFIG/EXECUTE (await ACK) → read-back verify → re-enable
// page changes. No PAGESTORE: the handler runs live but is not persisted.
async function writeDrawHandler(gp, portPath, luaSource, label) {
  const { grid } = gp;
  const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
  const actionString = gs.buildActionStringFromLua(gp, luaSource, maxLength);
  console.log(`  compiled: ${actionString.length}/${maxLength} chars`);

  const conn = await gs.connect(gp, portPath);
  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`  device: ${dev.moduleType} fw ${dev.firmware} @ DX=${dev.dx} DY=${dev.dy}`);
    if (dev.moduleType !== 'VSN1L') {
      throw new Error(`Connected module is ${dev.moduleType}, expected VSN1L.`);
    }

    await gs.activatePage(gp, conn, 0);

    const ack = gs.waitForConfigAck(
      conn, gs.ACK_TIMEOUT_MS,
      `LCD DRAW write (element ${LCD_ELEMENT} event ${DRAW_EVENT})`,
    );
    ack.catch(() => {}); // early-rejection guard (see grid_serial.activatePage)
    await conn.send(gs.configExecuteDescriptor(
      gp, dev.dx, dev.dy, 0, LCD_ELEMENT, DRAW_EVENT, actionString,
    ));
    await ack;

    // Read-back verify: the firmware ACKs even when Lua registration silently
    // fails, so FETCH the live registration and compare.
    const verify = gs.waitForConfigAck
      ? conn.waitFor(
        (c) => c.class_name === 'CONFIG' && c.class_instr === 'REPORT' &&
          Number(c.class_parameters.ELEMENTNUMBER) === LCD_ELEMENT &&
          Number(c.class_parameters.EVENTTYPE) === DRAW_EVENT,
        gs.FETCH_TIMEOUT_MS,
        `No read-back for LCD DRAW.`,
      )
      : null;
    if (verify) {
      verify.catch(() => {});
      await conn.send(gs.configFetchDescriptor(gp, dev.dx, dev.dy, 0, LCD_ELEMENT, DRAW_EVENT));
      const rb = await verify;
      if (rb.class_parameters.ACTIONSTRING !== actionString) {
        throw new Error('READ-BACK MISMATCH: device did not register the DRAW handler as written.');
      }
    }

    // NO PAGESTORE — ephemeral by design.
    console.log(`  ✅ ${label} is live on screen (NOT saved — --restore or power-cycle reverts).`);
  } finally {
    // ALWAYS re-enable page changes — in the FINALLY (audit 2026-07-10,
    // freeze-state #1): CONFIG writes disable them, and an abort (ACK timeout,
    // read-back mismatch) used to strand the device page-locked until a
    // power-cycle. Best-effort so a failure here never masks the original one.
    try {
      await gs.enablePageChange(gp, conn);
    } catch (e) {
      console.warn(`  (could not re-enable page changes: ${e.message} — ` +
        `run vsn1_config/activate_page.cjs --page 0 or power-cycle the device)`);
    }
    await conn.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  if (args.list) {
    const v = listVariants();
    console.log(v.length ? `Variants:\n${v.map((n) => `  ${n}`).join('\n')}` : 'No variants yet.');
    return 0;
  }
  if (!args.variant && !args.restore) {
    printHelp();
    throw new Error('Nothing to do: pass --variant <name>, --restore, or --list.');
  }

  const gp = await importGridProtocol();
  await gp.initLuaFormatter();

  if (args.engineCheck) await assertNoDeployInFlight();

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);

  if (args.restore) {
    console.log('Restoring the production LCD DRAW handler ...');
    const prod = fs.readFileSync(PROD_LCD_DRAW, 'utf8');
    await writeDrawHandler(gp, portPath, prod, 'production effects screen');
    return 0;
  }

  const file = variantFile(args.variant);
  console.log(`Variant: ${args.variant}  (${path.relative(process.cwd(), file)})`);
  await writeDrawHandler(gp, portPath, fs.readFileSync(file, 'utf8'), args.variant);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
