/*
  activate_page.cjs — make a VSN1 page ACTIVE without writing any config.

  Why this exists (2026-07-10, the "device stuck on the wrong page" bug):
  restore_config.cjs MUST activate the page it writes (firmware NACKs CONFIG
  writes to a non-active page) and it leaves the device there. So a
  single-page auto-deploy of page N (e.g. an effect added on page 1) flips
  the device to page N and NEVER returns — the operator's device then shows
  a different page than the engine's effectsPage, and every key press maps
  to the wrong flat slot. deploy_layout.cjs now calls this after a live
  deploy to snap the device back to the engine's current page; it is also a
  standalone remedy:

    node activate_page.cjs --page 0 [--port COMx]

  No CONFIG writes, no PAGESTORE — page activation only (the same editor
  heartbeat + PAGEACTIVE + confirm dance restore_config uses). Page changes
  stay ENABLED afterwards (activatePage re-latches them every round).
*/
'use strict';

const gs = require('./grid_serial.cjs');

function parseArgs(argv) {
  const args = { page: null, port: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') {
      args.page = parseInt(argv[++i], 10);
    } else if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node activate_page.cjs --page <0..3> [--port <COMx>]');
    return 0;
  }
  if (!Number.isInteger(args.page) || args.page < 0 || args.page > 3) {
    throw new Error(`--page must be 0..3, got ${args.page}.`);
  }

  // Dynamic import: grid-protocol is ESM-only and this file is CJS — the
  // sanctioned CJS→ESM interop exception (same as deploy_layout.cjs).
  const gp = await import('@intechstudio/grid-protocol');
  await gp.initLuaFormatter();

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);
  const conn = await gs.connect(gp, portPath);
  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`Module: ${dev.moduleType}  fw ${dev.firmware}  DX=${dev.dx} DY=${dev.dy}`);
    console.log(`Activating page ${args.page} ...`);
    await gs.activatePage(gp, conn, args.page);
    console.log(`Page ${args.page} confirmed active.`);
    return 0;
  } finally {
    await conn.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
