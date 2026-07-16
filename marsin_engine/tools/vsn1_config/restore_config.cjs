#!/usr/bin/env node
/*
  restore_config.cjs — replay a dumps/*.json (from read_config.cjs) back onto
  the VSN1: the ROLLBACK path for test deploys.

  For every element/event in the dump it re-sends the stored short-form action
  string via CONFIG/EXECUTE (awaiting each ACK), then commits the page with
  PAGESTORE/EXECUTE. The dump's own page number and module type are used and
  enforced against the live device.

  ── DRY-RUN IS THE DEFAULT. ──────────────────────────────────────────────────
  Without --live this tool never opens the serial port: it validates every
  action string in the dump (length vs the device CONFIG_LENGTH limit, frame
  encode + decode round-trip) and prints what it WOULD send. A real restore
  requires the explicit --live flag — the operator's (Sina's) call.

  Fail-loud: module mismatch, oversize string, encode/decode failure, missing
  ACK — all abort non-zero. On a mid-restore failure the tool tells you which
  events were already written and that PAGESTORE was not reached (so flash
  still holds the previous state until a PAGESTORE lands).
*/
'use strict';

const fs = require('fs');

const gs = require('./grid_serial.cjs');

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dumpFile: null, port: null, live: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '--live') {
      args.live = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (!a.startsWith('--') && args.dumpFile === null) {
      args.dumpFile = a;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
vsn1 restore_config — replay a read_config.cjs dump back to the device
(rollback path). DRY-RUN BY DEFAULT.

Usage:
  node restore_config.cjs <dumps/vsn1_...json> [--port <name>] [--live]

Options:
  --port <name>  Serial port override (default: auto-detect by VID:PID).
  --live         ACTUALLY WRITE. Without it, validates + prints only.
  -h, --help     Show this help.

Sequence (live): for each element/event in the dump: CONFIG/EXECUTE + ACK;
then PAGESTORE/EXECUTE + ACK (commits the page to flash).
`);
}

// Flatten the dump into an ordered list of writes.
function collectWrites(dump) {
  const writes = [];
  for (const el of dump.elements) {
    for (const ev of el.events) {
      writes.push({
        elementIndex: el.elementIndex,
        elementType: el.elementType,
        eventType: ev.eventType,
        eventKey: ev.eventKey,
        actionString: ev.shortLua,
      });
    }
  }
  return writes;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.dumpFile === null) {
    throw new Error('Missing dump file. Usage: node restore_config.cjs <dumps/...json> [--live]');
  }

  const gp = await import('@intechstudio/grid-protocol');
  const { grid } = gp;

  const dump = JSON.parse(fs.readFileSync(args.dumpFile, 'utf8'));
  if (!dump.module || !dump.module.type || dump.page === undefined || !dump.elements) {
    throw new Error(`${args.dumpFile} does not look like a read_config.cjs dump.`);
  }

  const page = dump.page;
  const writes = collectWrites(dump);
  const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));

  console.log(`Restore source : ${args.dumpFile}`);
  console.log(`Module         : ${dump.module.type} (fw at dump time ${dump.module.firmware})`);
  console.log(`Page           : ${page}`);
  console.log(`Action strings : ${writes.length}`);

  // ── Validate every write offline (both modes) ─────────────────────────────
  let totalBytes = 0;
  for (const w of writes) {
    if (typeof w.actionString !== 'string' || w.actionString.length === 0) {
      throw new Error(
        `Dump entry element ${w.elementIndex} event ${w.eventType} has an empty ` +
          `action string — refusing to restore a hole.`,
      );
    }
    if (w.actionString.length > maxLength) {
      throw new Error(
        `Dump entry element ${w.elementIndex} event ${w.eventType} is ` +
          `${w.actionString.length} chars (limit ${maxLength}).`,
      );
    }
    const descr = gs.configExecuteDescriptor(
      gp, 0, 0, page, w.elementIndex, w.eventType, w.actionString,
    );
    const packet = grid.encode_packet(descr);
    if (packet === undefined) {
      throw new Error(`encode failed for element ${w.elementIndex} event ${w.eventType}.`);
    }
    // Round-trip: our frame must decode back to the identical action string.
    const classArray = grid.decode_packet_frame([...packet.serial]);
    if (!classArray) {
      throw new Error(
        `round-trip decode failed for element ${w.elementIndex} event ${w.eventType}.`,
      );
    }
    grid.decode_packet_classes(classArray);
    const decoded = classArray.find((c) => c.class_name === 'CONFIG');
    if (!decoded || decoded.class_parameters.ACTIONSTRING !== w.actionString) {
      throw new Error(
        `round-trip MISMATCH for element ${w.elementIndex} event ${w.eventType}.`,
      );
    }
    totalBytes += packet.serial.length + 1;
    console.log(
      `  ok  el ${String(w.elementIndex).padStart(3)} (${w.elementType})` +
        `  ev ${w.eventType} (${w.eventKey})  ${w.actionString.length} chars`,
    );
  }
  console.log(`\nAll ${writes.length} action strings validated ` +
    `(${totalBytes} bytes of CONFIG frames + PAGESTORE).`);

  if (!args.live) {
    console.log('\nDRY RUN — nothing was sent. Add --live to restore to the device.');
    return 0;
  }

  // ── LIVE RESTORE (operator-invoked) ───────────────────────────────────────
  console.log('\n*** LIVE MODE: this will overwrite the device page and commit to flash. ***');

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);
  const conn = await gs.connect(gp, portPath);

  let written = 0;
  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`Module: ${dev.moduleType}  fw ${dev.firmware}  DX=${dev.dx} DY=${dev.dy}`);
    if (dev.moduleType !== dump.module.type) {
      throw new Error(
        `Connected module is ${dev.moduleType} but the dump is for ` +
          `${dump.module.type}. Refusing to restore.`,
      );
    }

    // Make the dump's page ACTIVE and wait for device confirmation. Firmware
    // facts (grid-fw): CONFIG writes to a non-active page are NACKed;
    // PAGEACTIVE is silently ignored while page changes are disabled (every
    // prior CONFIG write disables them — only a TYPE-255 editor heartbeat
    // re-enables); the active page flips only when the async page-load ends.
    console.log(`Activating page ${page} (editor heartbeat + PAGEACTIVE + confirm) ...`);
    await gs.activatePage(gp, conn, page);
    console.log(`Page ${page} confirmed active.`);

    // REFLASH SCREEN: paint the LCD "SYNCING…" state before the page writes.
    // Best-effort (IMMEDIATE gets no ACK) — a draw hiccup must never abort a
    // real deploy, so failures are logged, not thrown. Cleared after PAGESTORE.
    try {
      await gs.drawSyncScreen(gp, conn, dev.dx, dev.dy);
      console.log('LCD shows SYNCING… (reflash in progress).');
    } catch (e) {
      console.warn(`  (could not draw SYNCING screen: ${e.message} — continuing)`);
    }

    for (const w of writes) {
      process.stdout.write(
        `CONFIG/EXECUTE el ${w.elementIndex} ev ${w.eventType} (${w.eventKey}) ... `,
      );
      const ack = gs.waitForConfigAck(
        conn,
        gs.ACK_TIMEOUT_MS,
        `element ${w.elementIndex} event ${w.eventType} (${written} of ` +
          `${writes.length} writes already sent; PAGESTORE NOT sent, flash ` +
          `still holds the previous state — fix and re-run)`,
      );
      // Pre-handle: if the ack timer fires during the send await below, the
      // rejection would otherwise be unhandled and kill the process (see
      // grid_serial.cjs activatePage). `await ack` still observes it.
      ack.catch(() => {});
      await conn.send(gs.configExecuteDescriptor(
        gp, dev.dx, dev.dy, page, w.elementIndex, w.eventType, w.actionString,
      ));
      await ack;

      // READ-BACK VERIFY: the firmware ACKs a CONFIG write even when its Lua
      // registration silently fails (register_script only debug-prints on a
      // dostring error). FETCH reads the LIVE registration, so comparing it
      // to what we just wrote catches lost writes on the spot.
      const verify = conn.waitFor(
        (c) =>
          c.class_name === 'CONFIG' &&
          c.class_instr === 'REPORT' &&
          Number(c.class_parameters.ELEMENTNUMBER) === w.elementIndex &&
          Number(c.class_parameters.EVENTTYPE) === w.eventType,
        gs.FETCH_TIMEOUT_MS,
        `No read-back for element ${w.elementIndex} event ${w.eventType}.`,
      );
      verify.catch(() => {}); // same early-rejection guard as `ack` above
      await conn.send(gs.configFetchDescriptor(
        gp, dev.dx, dev.dy, page, w.elementIndex, w.eventType,
      ));
      const readBack = await verify;
      if (readBack.class_parameters.ACTIONSTRING !== w.actionString) {
        throw new Error(
          `READ-BACK MISMATCH for element ${w.elementIndex} event ` +
            `${w.eventType}: the device ACKed the write but its live Lua ` +
            `registration does not match (registration silently failed — ` +
            `usually a write during a still-running page load). ` +
            `${written} of ${writes.length} writes verified; PAGESTORE NOT ` +
            `sent. Re-run the restore.`,
        );
      }
      written++;
      console.log('ACK+verified');
    }

    console.log('PAGESTORE/EXECUTE (commit to flash) ...');
    const storeTimeout = gs.pageStoreTimeout(writes.length); // scales with page size
    const storeAck = conn.waitFor(
      (c) => c.class_name === 'PAGESTORE' && c.class_instr === 'ACKNOWLEDGE',
      storeTimeout,
      `No PAGESTORE/ACKNOWLEDGE within ${storeTimeout} ms — the page ` +
        `may not be persisted. Re-run the restore before power-cycling.`,
    );
    storeAck.catch(() => {}); // same early-rejection guard as `ack` above
    await conn.send(gs.pageStoreDescriptor());
    await storeAck;
    console.log('ACK. Page committed to flash.');

    // REFLASH SCREEN done: repaint the live screen, clearing the SYNCING
    // overlay. Best-effort — the new page's LCD DRAW also repaints on its own.
    try {
      await gs.clearSyncScreen(gp, conn, dev.dx, dev.dy);
      console.log('SYNCING screen cleared (live layout shown).');
    } catch (e) {
      console.warn(`  (could not clear SYNCING screen: ${e.message} — continuing)`);
    }

    console.log(`\nRestore complete: ${written}/${writes.length} action strings ` +
      `written to page ${page} and persisted.`);
    return 0;
  } finally {
    // ALWAYS re-enable page changes before closing — in the FINALLY, not the
    // success path (audit 2026-07-10, freeze-state #1): every CONFIG write
    // disables page changes on the device, and an abort mid-run (ACK timeout,
    // read-back mismatch, SIGINT, serial error) used to strand the device
    // page-locked — side button refused (purple flash), host page CCs silently
    // ignored — until a power-cycle. Best-effort: a failure here must not mask
    // the original error.
    try {
      await gs.enablePageChange(gp, conn);
      console.log('Page changes re-enabled (device-side page_load works).');
    } catch (e) {
      console.warn(`  (could not re-enable page changes: ${e.message} — ` +
        `if the side button refuses with a purple flash, run ` +
        `activate_page.cjs --page <n> or power-cycle the device)`);
    }
    await conn.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
