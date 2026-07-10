/*
  soft_reset.cjs — soft-REBOOT the VSN1 over serial (hands-free unplug/replug).

  Why (2026-07-10, the initial-load pad wedge — docs/42 Known issues): the
  boot deploy's back-to-back multi-page flash can wedge the device's pad scan
  (8 main pads + encoder dead; everything else alive). The only known cure was
  a physical USB unplug/replug. The grid protocol's RESET/EXECUTE class is the
  grid-editor "restart module" action — an MCU reboot that re-inits the pad
  scan without hands. PAGESTORE'd config in NVM survives the reboot.

    node soft_reset.cjs [--port <COMx>] [--no-verify]

  Flow: connect → send RESET (fire-and-forget; a rebooting device can't ACK)
  → close → poll for the port to re-enumerate → wait for a fresh HEARTBEAT →
  (default) read back one element's stored config to prove NVM survived.
  Fails LOUD if the device doesn't come back within the window.
*/
'use strict';

const gs = require('./grid_serial.cjs');

const REBOOT_POLL_MS = 500;
const REBOOT_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const args = { port: null, verify: true, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '--no-verify') {
      args.verify = false;
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
    console.log('Usage: node soft_reset.cjs [--port <COMx>] [--no-verify]');
    return 0;
  }

  // Dynamic import: grid-protocol is ESM-only and this file is CJS — the
  // sanctioned CJS→ESM interop exception (same as deploy_layout.cjs).
  const gp = await import('@intechstudio/grid-protocol');
  await gp.initLuaFormatter();

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);
  let conn = await gs.connect(gp, portPath);
  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`Module: ${dev.moduleType}  fw ${dev.firmware}  — sending RESET (soft reboot) ...`);
    await conn.send(gs.resetDescriptor());
  } finally {
    // Close immediately — the port is about to drop out from under us.
    try { await conn.close(); } catch { /* already gone */ }
  }

  // Wait for the device to disappear and come back (re-enumeration).
  console.log('Waiting for the device to reboot and re-enumerate ...');
  const deadline = Date.now() + REBOOT_TIMEOUT_MS;
  let backPort = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, REBOOT_POLL_MS));
    try {
      backPort = await gs.findVsn1Port();
      if (backPort) break;
    } catch { /* not back yet */ }
  }
  if (!backPort) {
    throw new Error(
      `Device did not re-enumerate within ${REBOOT_TIMEOUT_MS} ms of the RESET. ` +
        `If it stays gone, unplug/replug the USB.`,
    );
  }

  conn = await gs.connect(gp, backPort);
  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`Back: ${dev.moduleType}  fw ${dev.firmware}  on ${backPort}.`);
    if (args.verify) {
      // NVM survival proof: fetch one stored element (page 0, key 0, BC) and
      // require a non-empty action string — a factory-wiped device would
      // return the stock default, but an EMPTY/failed read means trouble.
      const rep = conn.waitFor(
        (c) =>
          c.class_name === 'CONFIG' &&
          c.class_instr === 'REPORT' &&
          Number(c.class_parameters.ELEMENTNUMBER) === 0 &&
          Number(c.class_parameters.EVENTTYPE) === 3,
        gs.FETCH_TIMEOUT_MS,
        'No CONFIG read-back after the reboot.',
      );
      rep.catch(() => {});
      await conn.send(gs.configFetchDescriptor(gp, dev.dx, dev.dy, 0, 0, 3));
      const r = await rep;
      const s = r.class_parameters.ACTIONSTRING || '';
      console.log(`NVM check: page 0 key 0 BC = ${s.length} chars ${s.length > 0 ? '(config survived)' : '(EMPTY — investigate!)'}`);
    }
    console.log('\nSoft reset complete — pad scan re-initialized (hands-free unplug/replug).');
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
