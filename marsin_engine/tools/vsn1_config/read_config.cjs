#!/usr/bin/env node
/*
  read_config.cjs — headless READ / round-trip of an Intech VSN1 (Grid module)
  configuration over USB serial. NO GUI, NO writes to device flash.

  What it does (strictly read-only):
    1. Finds the VSN1 serial port by USB VID:PID (0x303A:0x8123), or uses --port.
    2. Opens the port at 2 000 000 baud and listens for the device HEARTBEAT to
       learn the module type (VSN1L / VSN1R) and firmware version.
    3. Enumerates every real element of the module and every event on each
       element, and for each (page, element, event) sends a CONFIG/FETCH packet
       and reads back the stored Lua action string (CONFIG/REPORT).
    4. Humanizes each action string (short opcodes -> readable Lua) and writes a
       timestamped JSON dump to ./dumps/.

  It NEVER sends CONFIG/EXECUTE, PAGESTORE, PAGEACTIVE, NVMERASE, or any other
  write/mutate instruction. The read path leaves device flash untouched (a
  CONFIG/FETCH is a pure query; nothing is persisted).

  Fail-loud: if no VSN1 is found, if the port is busy (e.g. the Grid Editor
  holds it), or if the device never answers, the tool prints the reason and
  exits non-zero. There are no silent fallbacks.

  Shared plumbing lives in grid_serial.cjs. Protocol reference: README.md.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const gs = require('./grid_serial.cjs');

const DUMP_DIR = path.join(__dirname, 'dumps');

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { port: null, page: 0, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '--page') {
      args.page = parseInt(argv[++i], 10);
    } else if (a === '--list-ports') {
      args.list = true;
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
vsn1 read_config — dump the live config of an Intech VSN1 over USB serial.

Usage:
  node read_config.cjs [--port <COMx|/dev/ttyACMx>] [--page <n>] [--list-ports]

Options:
  --port <name>    Use this serial port instead of auto-detecting by VID:PID.
  --page <n>       Config page to read (default 0). VSN1 has multiple pages;
                   this wave reads one page per run.
  --list-ports     List all serial ports with VID:PID and exit.
  -h, --help       Show this help.

Read-only: sends only CONFIG/FETCH queries. Never writes device flash.
`);
}

// ── The reader ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  // grid-protocol is ESM-only; bridge from this CJS entrypoint via dynamic import.
  const gp = await import('@intechstudio/grid-protocol');
  const { grid, GridScript } = gp;

  if (args.list) {
    const ports = await gs.listPorts();
    for (const p of ports) {
      const tag = gs.isVsn1(p) ? '  <-- VSN1' : '';
      console.log(
        `${p.path}\tVID:${gs.hex4(p.vid)} PID:${gs.hex4(p.pid)}\t${p.manufacturer || ''}${tag}`,
      );
    }
    return 0;
  }

  const portPath = args.port || (await gs.findVsn1Port());
  console.log(`Opening ${portPath} @ ${gs.BAUD_RATE} baud ...`);

  const conn = await gs.connect(gp, portPath);

  try {
    // ── 1. Learn the module type from a HEARTBEAT ────────────────────────────
    console.log('Waiting for device HEARTBEAT ...');
    const dev = await gs.waitForHeartbeat(gp, conn);
    console.log(
      `Module: ${dev.moduleType}  fw ${dev.firmware}  at position ` +
        `DX=${dev.dx} DY=${dev.dy} (hwcfg=${dev.hwcfg})`,
    );

    // ── 2. Initialize the Lua humanizer (WASM) ───────────────────────────────
    await gp.initLuaFormatter();

    // ── 3. Enumerate elements & events, FETCH each config ────────────────────
    const elementTypes = grid.get_module_element_list(dev.moduleType);
    const elements = [];
    for (let elementIndex = 0; elementIndex < elementTypes.length; elementIndex++) {
      const elementType = elementTypes[elementIndex];
      if (elementType === undefined) {
        continue; // padding slot — not a real control element
      }
      const events = grid.get_element_events(elementType);
      const eventDumps = [];
      for (const ev of events) {
        const eventType = ev.value;
        console.log(
          `  fetch page ${args.page} element ${elementIndex} (${elementType}) ` +
            `event ${eventType} (${ev.key}) ...`,
        );
        const descr = gs.configFetchDescriptor(
          gp,
          dev.dx,
          dev.dy,
          args.page,
          elementIndex,
          eventType,
        );
        const replyPromise = conn.waitFor(
          (c) =>
            c.class_name === 'CONFIG' &&
            c.class_instr === 'REPORT' &&
            Number(c.class_parameters.PAGENUMBER) === args.page &&
            Number(c.class_parameters.ELEMENTNUMBER) === elementIndex &&
            Number(c.class_parameters.EVENTTYPE) === eventType,
          gs.FETCH_TIMEOUT_MS,
          `No CONFIG/REPORT for element ${elementIndex} event ${eventType} ` +
            `(page ${args.page}) within ${gs.FETCH_TIMEOUT_MS} ms.`,
        );
        // Pre-handle: a timer firing during the send await would otherwise be
        // an unhandled rejection → process death (see grid_serial activatePage).
        replyPromise.catch(() => {});
        await conn.send(descr);
        const report = await replyPromise;

        const shortLua = report.class_parameters.ACTIONSTRING || '';
        eventDumps.push({
          eventType,
          eventKey: ev.key,
          eventDesc: ev.desc,
          actionLength: report.class_parameters.ACTIONLENGTH,
          shortLua,
          humanLua: shortLua ? GridScript.humanize(shortLua) : '',
        });
      }
      elements.push({ elementIndex, elementType, events: eventDumps });
    }

    // ── 4. Write the dump ────────────────────────────────────────────────────
    const dump = {
      tool: 'vsn1_config/read_config.cjs',
      generatedAt: new Date().toISOString(),
      port: portPath,
      module: {
        type: dev.moduleType,
        firmware: dev.firmware,
        hwcfg: dev.hwcfg,
        position: { dx: dev.dx, dy: dev.dy },
      },
      page: args.page,
      protocolVersion: grid.getProperty('VERSION'),
      elements,
    };

    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(DUMP_DIR, `vsn1_${dev.moduleType}_page${args.page}_${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
    console.log(`\nWrote ${elements.length} elements to ${outPath}`);
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
