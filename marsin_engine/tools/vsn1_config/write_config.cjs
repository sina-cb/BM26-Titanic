#!/usr/bin/env node
/*
  write_config.cjs — headless WRITE of ONE action string to an Intech VSN1
  (Grid module) over USB serial, following the documented Grid Editor sequence:

      PAGEACTIVE/EXECUTE  { page }              (broadcast)
      CONFIG/EXECUTE      { page, element, event, ACTIONSTRING }   -> await ACK
      PAGESTORE/EXECUTE   {}                    (broadcast)        -> await ACK

  ── DRY-RUN IS THE DEFAULT. ──────────────────────────────────────────────────
  Without --live this tool NEVER opens the serial port. It compiles the Lua,
  validates it against the real device constraints (single-line, syntax,
  CONFIG_LENGTH limit), prints the exact frames it WOULD send (hex + decoded
  summary), and proves the CONFIG frame decodes back to the identical action
  string. A real device write requires the explicit --live flag — that run is
  the operator's (Sina's) to perform, not an agent's.

  Only the ONE targeted (page, element, event) action string is written; every
  other element/event on the device is untouched. Rollback: restore_config.cjs
  with a factory dump from dumps/.

  Fail-loud everywhere: unknown element/event, oversize or syntactically
  invalid Lua, encode failure, missing ACK, wrong module type — all abort
  non-zero. No fallbacks.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const gs = require('./grid_serial.cjs');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

// First-class templates: name -> { file, targetElementType, targetEventKey }.
// hello_world targets the LCD element's DRAW event — element index and event
// type are RESOLVED from grid-protocol's module map (and match the factory
// dump: element 13 (lcd), event 8 (DRAW) on a VSN1L).
const TEMPLATES = {
  hello_world: {
    file: path.join(TEMPLATE_DIR, 'hello_world.lua'),
    elementType: 'lcd',
    eventKey: 'DRAW',
  },
};

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    port: null,
    page: 0,
    live: false,
    template: null,
    element: null,
    event: null,
    luaFile: null,
    module: 'VSN1L', // module map used for offline (dry-run) target resolution
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '--page') {
      args.page = parseInt(argv[++i], 10);
    } else if (a === '--live') {
      args.live = true;
    } else if (a === '--template') {
      args.template = argv[++i];
    } else if (a === '--element') {
      args.element = parseInt(argv[++i], 10);
    } else if (a === '--event') {
      args.event = argv[++i];
    } else if (a === '--lua') {
      args.luaFile = argv[++i];
    } else if (a === '--module') {
      args.module = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
vsn1 write_config — write ONE action string to a VSN1. DRY-RUN BY DEFAULT.

Usage:
  node write_config.cjs --template hello_world [--page <n>] [--live]
  node write_config.cjs --element <N> --event <KEY|num> --lua <file> [--page <n>] [--live]

Targets:
  --template hello_world   The LCD element's DRAW event (resolved from the
                           module map; element 13 / event 8 on a VSN1).
  --element <N>            Element index (0..13, 255 = system on a VSN1).
  --event <KEY|num>        Event key (INIT, BC, TIMER, ENDLESS, DRAW, MAP)
                           or the numeric event type.
  --lua <file>             Human-readable Lua file to compile + write.

Options:
  --page <n>       Target page (default 0).
  --module <type>  Module map for dry-run target resolution (default VSN1L).
                   In --live mode the real module type from the device
                   HEARTBEAT is authoritative and must match.
  --port <name>    Serial port override (default: auto-detect by VID:PID).
  --live           ACTUALLY WRITE to the device. Without this flag nothing
                   touches the serial port. Live runs are the operator's call.
  -h, --help       Show this help.

Sequence (live): PAGEACTIVE/EXECUTE -> CONFIG/EXECUTE (await ACK)
                 -> PAGESTORE/EXECUTE (await ACK; commits to flash).
Rollback: node restore_config.cjs <dumps/factory.json> --live
`);
}

// ── Target resolution ─────────────────────────────────────────────────────────
// Resolve (elementIndex, eventType, luaFile) from --template or --element/
// --event/--lua, validated against the grid-protocol module map.
function resolveTarget(gp, args) {
  const { grid, ModuleType } = gp;

  const moduleType = ModuleType[args.module];
  if (moduleType === undefined) {
    throw new Error(
      `Unknown module type "${args.module}". Valid: ${Object.keys(ModuleType).join(', ')}`,
    );
  }
  const elementTypes = grid.get_module_element_list(moduleType);

  let elementIndex;
  let eventKeyWanted;
  let luaFile;

  if (args.template !== null) {
    const tpl = TEMPLATES[args.template];
    if (tpl === undefined) {
      throw new Error(
        `Unknown template "${args.template}". Available: ${Object.keys(TEMPLATES).join(', ')}`,
      );
    }
    if (args.element !== null || args.event !== null || args.luaFile !== null) {
      throw new Error('--template cannot be combined with --element/--event/--lua.');
    }
    // Find the (single) element of the template's element type in the map.
    const matches = [];
    for (let i = 0; i < elementTypes.length; i++) {
      if (elementTypes[i] === tpl.elementType) {
        matches.push(i);
      }
    }
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one "${tpl.elementType}" element on ${args.module}; ` +
          `found ${matches.length}.`,
      );
    }
    elementIndex = matches[0];
    eventKeyWanted = tpl.eventKey;
    luaFile = tpl.file;
  } else {
    if (args.element === null || args.event === null || args.luaFile === null) {
      throw new Error('Need --template, or all of --element, --event and --lua.');
    }
    elementIndex = args.element;
    eventKeyWanted = args.event;
    luaFile = args.luaFile;
  }

  const elementType = elementTypes[elementIndex];
  if (elementType === undefined) {
    throw new Error(
      `Element ${elementIndex} does not exist on ${args.module} ` +
        `(real elements: ${elementTypes.map((t, i) => (t ? i : null)).filter((x) => x !== null).join(', ')}).`,
    );
  }

  // Resolve the event by key or number, against this element's real event list.
  const events = grid.get_element_events(elementType);
  let eventEntry;
  if (/^\d+$/.test(String(eventKeyWanted))) {
    eventEntry = events.find((e) => Number(e.value) === parseInt(eventKeyWanted, 10));
  } else {
    eventEntry = events.find((e) => e.key === String(eventKeyWanted).toUpperCase());
  }
  if (eventEntry === undefined) {
    throw new Error(
      `Event "${eventKeyWanted}" not valid for element ${elementIndex} ` +
        `(${elementType}). Valid: ${events.map((e) => `${e.key}(${e.value})`).join(', ')}`,
    );
  }

  return {
    moduleType,
    elementIndex,
    elementType,
    eventType: Number(eventEntry.value),
    eventKey: eventEntry.key,
    luaFile,
  };
}

// ── Dry-run rendering ────────────────────────────────────────────────────────
function printPlannedFrame(gp, label, descr) {
  const packet = gp.grid.encode_packet(descr);
  if (packet === undefined) {
    throw new Error(`encode_packet failed for ${label}.`);
  }
  console.log(`\n[${label}] ${descr.class_name}/${descr.class_instr}`);
  console.log(`  params: ${JSON.stringify(descr.class_parameters)}`);
  console.log(`  frame (${packet.serial.length + 1} bytes on wire, incl. LF):`);
  console.log(gs.frameToHex(packet.serial));
  return packet;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const gp = await import('@intechstudio/grid-protocol');
  const { grid } = gp;
  await gp.initLuaFormatter();

  const target = resolveTarget(gp, args);
  const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    throw new Error(`Bad CONFIG_LENGTH from grid-protocol: ${maxLength}`);
  }

  // ── Compile the Lua into a device action string ───────────────────────────
  const luaSource = fs.readFileSync(target.luaFile, 'utf8');
  const actionString = gs.buildActionStringFromLua(gp, luaSource, maxLength);
  const humanBack = gs.toHumanActionString(gp, actionString);

  console.log(`Target : page ${args.page}, element ${target.elementIndex} ` +
    `(${target.elementType}), event ${target.eventType} (${target.eventKey})`);
  console.log(`Source : ${target.luaFile}`);
  console.log(`Action : ${actionString.length}/${maxLength} chars (device short form)`);
  console.log(`\n  short : ${actionString}`);
  console.log(`\n  human : ${humanBack}`);

  // ── Build the three descriptors of the write sequence ────────────────────
  // Dry-run uses DX=0, DY=0 (a directly-attached module reports SX/SY 0,0 —
  // verified live); in --live mode the heartbeat's real position replaces it.
  const mkDescriptors = (dx, dy) => ({
    pageActive: gs.pageActiveDescriptor(args.page),
    configExec: gs.configExecuteDescriptor(
      gp, dx, dy, args.page, target.elementIndex, target.eventType, actionString,
    ),
    pageStore: gs.pageStoreDescriptor(),
  });

  if (!args.live) {
    // ── DRY RUN ───────────────────────────────────────────────────────────
    const d = mkDescriptors(0, 0);
    printPlannedFrame(gp, '1/3', d.pageActive);
    const cfgPacket = printPlannedFrame(gp, '2/3', d.configExec);
    printPlannedFrame(gp, '3/3', d.pageStore);

    // Round-trip proof: decode our own CONFIG frame and compare the action
    // string that a device would receive against what we intended to send.
    const classArray = grid.decode_packet_frame([...cfgPacket.serial]);
    if (!classArray) {
      throw new Error('Round-trip FAILED: our CONFIG frame did not decode (checksum/framing).');
    }
    grid.decode_packet_classes(classArray);
    const decoded = classArray.find((c) => c.class_name === 'CONFIG');
    if (!decoded || decoded.class_instr !== 'EXECUTE') {
      throw new Error('Round-trip FAILED: decoded frame is not CONFIG/EXECUTE.');
    }
    const rxAction = decoded.class_parameters.ACTIONSTRING;
    if (rxAction !== actionString) {
      throw new Error(
        `Round-trip FAILED: decoded ACTIONSTRING differs from intended.\n` +
          `  sent   : ${actionString}\n  decoded: ${rxAction}`,
      );
    }
    if (Number(decoded.class_parameters.ELEMENTNUMBER) !== target.elementIndex ||
        Number(decoded.class_parameters.EVENTTYPE) !== target.eventType ||
        Number(decoded.class_parameters.PAGENUMBER) !== args.page) {
      throw new Error('Round-trip FAILED: decoded page/element/event differ from intended.');
    }

    console.log('\nRound-trip check: CONFIG frame decodes back to the identical');
    console.log(`action string + target (page ${args.page}, element ${target.elementIndex}, ` +
      `event ${target.eventType}). OK.`);
    console.log('\nDRY RUN — nothing was sent. Add --live to write to the device.');
    return 0;
  }

  // ── LIVE WRITE (operator-invoked) ─────────────────────────────────────────
  console.log('\n*** LIVE MODE: this will write to the device and commit to flash. ***');

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);
  const conn = await gs.connect(gp, portPath);

  try {
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(`Module: ${dev.moduleType}  fw ${dev.firmware}  DX=${dev.dx} DY=${dev.dy}`);
    if (dev.moduleType !== target.moduleType) {
      throw new Error(
        `Connected module is ${dev.moduleType} but the target was resolved for ` +
          `${target.moduleType}. Re-run with --module ${dev.moduleType}.`,
      );
    }

    const d = mkDescriptors(dev.dx, dev.dy);

    // 1/3 PAGEACTIVE — no ACK defined for this instruction (grid-editor sends
    // it fire-and-forget); the firmware NACKs CONFIG writes to a non-active
    // page and silently ignores PAGEACTIVE while page changes are disabled,
    // so activate + confirm via the heartbeat piggyback (see grid_serial).
    console.log(`1/3 Activating page ${args.page} (heartbeat + PAGEACTIVE + confirm) ...`);
    await gs.activatePage(gp, conn, args.page);
    console.log(`    Page ${args.page} confirmed active.`);

    // 2/3 CONFIG/EXECUTE — must be acknowledged (NACK = loud failure).
    console.log(`2/3 CONFIG/EXECUTE element ${target.elementIndex} event ${target.eventType} ...`);
    const cfgAck = gs.waitForConfigAck(
      conn,
      gs.ACK_TIMEOUT_MS,
      `element ${target.elementIndex} event ${target.eventType} (the write was ` +
        `NOT confirmed; re-read the page to check)`,
    );
    // Pre-handle: a timer firing during the send await would otherwise be an
    // unhandled rejection → process death (see grid_serial.cjs activatePage).
    cfgAck.catch(() => {});
    await conn.send(d.configExec);
    await cfgAck;
    console.log('    ACK received.');

    // 3/3 PAGESTORE/EXECUTE — commits to non-volatile memory.
    console.log('3/3 PAGESTORE/EXECUTE (commit to flash) ...');
    const storeTimeout = gs.pageStoreTimeout(1);
    const storeAck = conn.waitFor(
      (c) => c.class_name === 'PAGESTORE' && c.class_instr === 'ACKNOWLEDGE',
      storeTimeout,
      `No PAGESTORE/ACKNOWLEDGE within ${storeTimeout} ms — the page ` +
        `may not be persisted. Power-cycling now could lose the change.`,
    );
    storeAck.catch(() => {}); // same early-rejection guard as cfgAck above
    await conn.send(d.pageStore);
    await storeAck;
    console.log('    ACK received. Config committed to flash.');

    console.log(`\nDone. Wrote 1 action string to page ${args.page}, ` +
      `element ${target.elementIndex}, event ${target.eventType}.`);
    console.log('Verify: the LCD should update when the draw event next fires; ' +
      'read back with read_config.cjs to confirm the stored string.');
    return 0;
  } finally {
    // ALWAYS re-enable page changes — in the FINALLY (audit 2026-07-10,
    // freeze-state #1): an abort after the CONFIG ACK used to strand the
    // device page-locked until a power-cycle. Best-effort so a failure here
    // never masks the original error.
    try {
      await gs.enablePageChange(gp, conn);
      console.log('    Page changes re-enabled.');
    } catch (e) {
      console.warn(`    (could not re-enable page changes: ${e.message} — ` +
        `run activate_page.cjs --page <n> or power-cycle the device)`);
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
